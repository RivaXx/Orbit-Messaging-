package com.orbit.messenger

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.os.Handler
import android.os.Looper
import android.app.KeyguardManager
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.view.inputmethod.InputConnectionCompat
import androidx.core.view.inputmethod.InputContentInfoCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.StandardMessageCodec
import io.flutter.plugin.platform.PlatformView
import io.flutter.plugin.platform.PlatformViewFactory
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors
import java.util.UUID

class OrbitActivity : FlutterFragmentActivity() {
    private companion object {
        const val ORIGIN = "https://appassets.androidplatform.net"
        const val APP_PAGE = "/assets/index.html"
        const val INVITE = "https://orbit-messaging.vercel.app/"
    }
    private val vault by lazy { DeviceVault(this) }
    private val noteKeys by lazy { NoteKeyVault(this) }
    private val shares by lazy { GalleryShare(this) }
    private val richContent by lazy { OrbitRichContent(this) }
    private val stickerShare by lazy { OrbitStickerShare(this) }
    private data class DocumentExport(val file: java.io.File, val label: String)
    private var documentExport: DocumentExport? = null
    private val saveOrbitDocument = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uri = if (result.resultCode == RESULT_OK) result.data?.data else null
        val export = documentExport ?: return@registerForActivityResult
        documentExport = null
        work.execute {
            val saved = uri != null && runCatching {
                val output = contentResolver.openOutputStream(uri) ?: error("Could not create the export file.")
                output.use { stream -> export.file.inputStream().use { it.copyTo(stream) } }
            }.isSuccess
            export.file.delete()
            if (uri != null) runOnUiThread { Toast.makeText(this, if (saved) "${export.label} exported." else "Could not export ${export.label.lowercase()}.", Toast.LENGTH_SHORT).show() }
        }
    }
    private val work = Executors.newSingleThreadExecutor()
    private val updateWork = Executors.newSingleThreadExecutor()
    private val updater: OrbitUpdater by lazy { OrbitUpdater(this, updateWork) { updatePermission.launch(it) } }
    private val notifications by lazy { OrbitNotifications(this) }
    private var notificationPermissionResult: ((Boolean) -> Unit)? = null
    private var page: WebView? = null
    private var pendingNote: String? = null
    private var pageStarted = false
    @Volatile private var unlocked = false
    private var stoppedAt = 0L
    private var picker: ValueCallback<Array<Uri>>? = null
    private var permissionResult: (() -> Unit)? = null
    private var channel: MethodChannel? = null
    private data class Incoming(val id: String, val name: String, val preview: Boolean, val expires: Long, val token: String)
    private var incoming: Incoming? = null
    private var answerOnUnlock = false
    private var fullCallPresentation = false
    private val callHandler = Handler(Looper.getMainLooper())
    private val expireCall = Runnable { clearIncomingCall() }
    private val assetLoader by lazy {
        WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
    }
    @Suppress("DEPRECATION")
    private val installedPackage by lazy { packageManager.getPackageInfo(packageName, 0) }
    @Suppress("DEPRECATION")
    private fun installedVersionCode() = if (Build.VERSION.SDK_INT >= 28) installedPackage.longVersionCode else installedPackage.versionCode.toLong()
    private val chooseFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val files = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        picker?.onReceiveValue(files?.takeIf { it.all { uri -> uri.scheme == "content" && uri.authority?.startsWith(packageName) == false } })
        picker = null
    }
    private val requestPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        permissionResult?.invoke()
        permissionResult = null
    }
    private val updatePermission = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { updater.resumePermission() }
    private val requestNotification = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        notificationPermissionResult?.invoke(notifications.enabled())
        notificationPermissionResult = null
    }

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false)
        work.execute { shares.clearStaleFiles(); richContent.clearAfterProcessDeath() }
        pendingNote = OrbitNoteAlarms.noteLink(this, intent)
        if (savedInstanceState == null) captureShare(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        captureShare(intent)
        handleCallIntent(intent)
        OrbitNoteAlarms.noteLink(this, intent)?.let { pendingNote = it; openPendingNote() }
    }

    override fun onStop() {
        stoppedAt = SystemClock.elapsedRealtime()
        page?.evaluateJavascript("window.OrbitAndroidBackground=true;window.dispatchEvent(new Event('orbit-android-pause'))", null)
        super.onStop()
    }

    override fun onDestroy() {
        richContent.clear()
        callHandler.removeCallbacks(expireCall)
        work.shutdownNow()
        updateWork.shutdownNow()
        super.onDestroy()
    }

    override fun onStart() {
        super.onStart()
        if (stoppedAt > 0 && SystemClock.elapsedRealtime() - stoppedAt >= 30000 && (unlocked || changingPin)) {
            changingPin = false
            lock()
        }
        stoppedAt = 0L
        page?.evaluateJavascript("window.OrbitAndroidBackground=false; if(window.OrbitDevice)window.dispatchEvent(new Event('orbit-android-resume'))", null)
        incoming?.let { if (!answerOnUnlock) paintIncoming(it, fullCallPresentation) }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        flutterEngine.platformViewsController.registry.registerViewFactory("orbit-messaging", object : PlatformViewFactory(StandardMessageCodec.INSTANCE) {
            override fun create(context: Context, viewId: Int, args: Any?): PlatformView {
                val view = createWebView()
                page = view
                pageStarted = false
                view.visibility = if (unlocked) View.VISIBLE else View.INVISIBLE
                if (unlocked) startPage(view)
                return object : PlatformView {
                    override fun getView() = view
                    override fun dispose() {
                        if (page === view) { page = null; pageStarted = false }
                        view.destroy()
                    }
                }
            }
        })
        channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.orbit.messenger/device")
        channel?.setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "state" -> {
                        val canBio = BiometricManager.from(this).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS
                        result.success(mapOf("hasPin" to vault.hasPin, "biometrics" to canBio))
                    }
                    "createPin" -> {
                        check(!vault.hasPin || unlocked && changingPin) { "Confirm your existing PIN first." }
                        vault.setPin(call.arguments as String)
                        changingPin = false
                        unlock()
                        result.success(null)
                    }
                    "checkPin" -> {
                        val error = vault.verify(call.arguments as String)
                        if (error == null) unlock()
                        result.success(error)
                    }
                    "cancelPinChange" -> {
                        changingPin = false
                        if (unlocked) unlock()
                        result.success(unlocked)
                    }
                    "biometrics" -> authenticateBiometric(result)
                    "keyboardViewport" -> {
                        val height = (call.arguments as? Int ?: 0).coerceIn(0, 10000)
                        page?.evaluateJavascript("window.OrbitAndroidVisibleHeight=$height; window.orbitUpdateChatViewport?.(); window.orbitUpdateNotesViewport?.()", null)
                        result.success(null)
                    }
                    "callAction" -> {
                        val action = call.argument<String>("action") ?: ""
                        val id = call.argument<String>("id") ?: ""
                        result.success(handleCallAction(id, action))
                    }
                    "pickerAction" -> {
                        val action = call.arguments as? String ?: "{}"
                        if (!unlocked || page == null || action.length > 1000) { result.success(false); return@setMethodCallHandler }
                        val payload = JSONObject(action).toString()
                        page?.evaluateJavascript("window.OrbitPicker?.action(JSON.parse(${JSONObject.quote(payload)}))", null)
                        result.success(true)
                    }
                    "back" -> {
                        val view = page
                        if (!unlocked || view == null) { result.success(false); return@setMethodCallHandler }
                        view.evaluateJavascript("Boolean(window.orbitAndroidBack?.())") { result.success(it == "true") }
                    }
                    else -> result.notImplemented()
                }
            } catch (failure: Exception) { result.error("device", failure.message ?: "Android security is unavailable.", null) }
        }
    }

    @Volatile private var changingPin = false

    private fun lock(notify: Boolean = true) {
        unlocked = false
        stickerShare.cancel()
        (page as? OrbitComposerWebView)?.composerToken = null
        richContent.clear()
        page?.visibility = View.INVISIBLE
        page?.evaluateJavascript("window.OrbitCrypto?.lock()", null)
        if (notify) channel?.invokeMethod("locked", null)
    }

    private fun unlock() {
        unlocked = true
        if (changingPin) return
        page?.let { view ->
            view.visibility = View.VISIBLE
            if (!pageStarted) startPage(view)
            else view.evaluateJavascript("window.OrbitCrypto?.restoreTrusted(); window.dispatchEvent(new Event('orbit-android-share'))", null)
        }
        openPendingNote()
        if (answerOnUnlock) incoming?.let { handleCallAction(it.id, "answer") }
    }

    private fun startPage(view: WebView) {
        pageStarted = true
        view.loadUrl("$ORIGIN$APP_PAGE?android=${installedVersionCode()}")
    }

    private fun openPendingNote() {
        val id = pendingNote ?: return
        if (!unlocked || !pageStarted) return
        page?.evaluateJavascript(
            "(function(id){if(!window.orbitOpenNoteLink)return false;window.orbitOpenNoteLink(id);return true})(" + JSONObject.quote(id) + ")",
        ) { if (it == "true" && pendingNote == id) pendingNote = null }
    }

    private fun showIncomingCall(args: JSONObject): Boolean {
        val id = UUID.fromString(args.getString("id")).toString()
        val remaining = (args.getLong("expires") - System.currentTimeMillis()).coerceAtMost(47_000)
        if (remaining <= 0) return false
        if (incoming?.id != id) { clearIncomingCall(); incoming = Incoming(id, args.optString("title", "Orbit caller").take(80), args.optBoolean("preview"), SystemClock.elapsedRealtime() + remaining, UUID.randomUUID().toString()) }
        val call = incoming ?: return false
        callHandler.removeCallbacks(expireCall)
        callHandler.postDelayed(expireCall, (call.expires - SystemClock.elapsedRealtime()).coerceAtLeast(1))
        if (!args.optBoolean("background")) paintIncoming(call, false)
        val title = if (unlocked && call.preview) call.name else "Orbit caller"
        if (args.optBoolean("notify")) runCatching { notifications.incomingCall(id, title, call.token, args.optBoolean("silent"), remaining) }
        return true
    }

    private fun paintIncoming(call: Incoming, full: Boolean) {
        fullCallPresentation = full
        if (full && Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        val locked = getSystemService(KeyguardManager::class.java).isKeyguardLocked
        channel?.invokeMethod("incomingCall", mapOf("id" to call.id, "title" to if (unlocked && !locked && call.preview) call.name else "Orbit caller", "full" to full))
    }

    private fun handleCallIntent(intent: Intent) {
        val call = incoming ?: return
        val path = intent.data?.pathSegments ?: return
        if (intent.action != "com.orbit.messenger.CALL" || intent.getStringExtra("orbit-call-token") != call.token || path.size != 2 || path[0] != call.id) return
        if (path[1] == "view") paintIncoming(call, true) else handleCallAction(call.id, path[1])
    }

    private fun handleCallAction(id: String, action: String): Boolean {
        val call = incoming ?: return false
        if (id != call.id || call.expires <= SystemClock.elapsedRealtime() || action !in setOf("answer", "decline")) return false
        val keyguard = getSystemService(KeyguardManager::class.java)
        if (action == "answer" && Build.VERSION.SDK_INT >= 26 && keyguard.isKeyguardLocked) {
            keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() { handleCallAction(id, action) }
            })
            return true
        }
        if (action == "answer" && !unlocked) {
            answerOnUnlock = true
            channel?.invokeMethod("incomingCallCleared", null)
            return true
        }
        val view = page ?: return false
        view.evaluateJavascript("window.orbitHandleAndroidCall?.(${JSONObject.quote(id)},${JSONObject.quote(action)})", null)
        clearIncomingCall()
        return true
    }

    private fun clearIncomingCall() {
        val call = incoming ?: return
        callHandler.removeCallbacks(expireCall)
        incoming = null
        answerOnUnlock = false
        fullCallPresentation = false
        notifications.clear("orbit-call-" + call.id)
        channel?.invokeMethod("incomingCallCleared", null)
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(false); setTurnScreenOn(false) }
    }

    private fun authenticateBiometric(result: MethodChannel.Result) {
        if (!vault.hasPin) { result.success(false); return }
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(value: BiometricPrompt.AuthenticationResult) {
                vault.clearFailures()
                unlock()
                result.success(true)
            }
            override fun onAuthenticationError(code: Int, text: CharSequence) { result.success(false) }
        })
        prompt.authenticate(BiometricPrompt.PromptInfo.Builder().setTitle("Unlock Orbit")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButtonText("Use PIN").build())
    }

    private fun captureShare(intent: Intent) {
        if (intent.action != Intent.ACTION_SEND && intent.action != Intent.ACTION_SEND_MULTIPLE) return
        work.execute {
            val result = runCatching { shares.capture(intent) }
            runOnUiThread {
                result.onSuccess {
                    if (unlocked) page?.evaluateJavascript("window.dispatchEvent(new Event('orbit-android-share'))", null)
                }.onFailure { Toast.makeText(this, it.message ?: "Could not read shared photos.", Toast.LENGTH_LONG).show() }
            }
        }
    }

    private fun bundled(uri: Uri) = uri.scheme == "https" && uri.encodedAuthority == "appassets.androidplatform.net"

    private fun receiveComposerContent(info: InputContentInfoCompat, flags: Int, token: String): Boolean {
        if (!unlocked || changingPin || isDestroyed) return false
        val uri = info.contentUri
        if (uri.scheme != "content" || uri.authority.isNullOrEmpty() || uri.authority.orEmpty().startsWith(packageName)) return false
        val mime = OrbitRichContent.mimeTypes.firstOrNull { info.description.hasMimeType(it) } ?: return false
        if (!richContent.begin()) {
            Toast.makeText(this, "Wait for the current keyboard media to load.", Toast.LENGTH_SHORT).show()
            return true
        }
        val granted = flags and InputConnectionCompat.INPUT_CONTENT_GRANT_READ_URI_PERMISSION != 0
        try {
            if (granted) info.requestPermission()
            work.execute {
                val result = runCatching { richContent.copy(uri, mime) }
                if (granted) runCatching { info.releasePermission() }
                runOnUiThread {
                    richContent.finish()
                    val file = result.getOrNull()
                    val view = page
                    if (!unlocked || changingPin || view == null || isDestroyed) { file?.delete(); return@runOnUiThread }
                    if (file == null) {
                        val message = (result.exceptionOrNull() as? IllegalArgumentException)?.message
                        Toast.makeText(this, message ?: "Orbit could not read the keyboard media.", Toast.LENGTH_SHORT).show()
                        return@runOnUiThread
                    }
                    val id = richContent.stage(file, mime)
                    val event = JSONObject().put("id", id).put("token", token)
                    view.evaluateJavascript("window.OrbitRichInput?.receive($event)", null)
                    callHandler.postDelayed({ richContent.discard(id) }, 30000)
                }
            }
            return true
        } catch (_: Exception) {
            if (granted) runCatching { info.releasePermission() }
            richContent.finish()
            Toast.makeText(this, "Orbit could not access the keyboard media.", Toast.LENGTH_SHORT).show()
            return true
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() = OrbitComposerWebView(this, ::receiveComposerContent).apply {
        setBackgroundColor(Color.rgb(8, 8, 12))
        isVerticalScrollBarEnabled = false
        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = false
            userAgentString += " OrbitApp/${installedPackage.versionName} (Android Flutter)"
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(this, "OrbitDevicePort", setOf(ORIGIN)) { view, message, _, mainFrame, reply ->
                if (!mainFrame || Uri.parse(view.url.orEmpty()).path != APP_PAGE) return@addWebMessageListener
                val request = runCatching { JSONObject(message.data ?: "") }.getOrNull() ?: return@addWebMessageListener
                val method = request.optString("method")
                if ((!unlocked || changingPin) && method !in setOf("showNotification", "clearNotification", "incomingCall")) return@addWebMessageListener
                val answer = JSONObject().put("id", request.optInt("id"))
                try {
                    if (method == "rememberNoteKey" || method == "unlockNoteKey") {
                        val args = request.getJSONObject("args")
                        val key = if (method == "rememberNoteKey") args.getString("key").also { require(it.length == 44) } else null
                        noteKeys.authenticate(args.getString("account"),args.getString("id"),key) { result ->
                            if (!unlocked || changingPin || isDestroyed) answer.put("error","Orbit is locked.")
                            else result.fold({ answer.put("value",it) },{ answer.put("error",it.message ?: "Biometric authorization failed.") })
                            reply.postMessage(answer.toString())
                        }
                        return@addWebMessageListener
                    }
                    if (method in setOf("startStickerShare", "writeStickerShare", "finishStickerShare", "finishStickerPackExport", "finishNotesExport", "cancelStickerShare")) {
                        val args = request.getJSONObject("args")
                        work.execute {
                            val result = runCatching {
                                check(unlocked && !changingPin && !isDestroyed) { "Unlock Orbit to share this media." }
                                when (method) {
                                    "startStickerShare" -> stickerShare.start(args.getString("mime"), args.getLong("size"))
                                    "writeStickerShare" -> stickerShare.append(args.getString("id"), args.getLong("offset"), args.getString("data"))
                                    "finishStickerShare" -> stickerShare.finish(args.getString("id"))
                                    "finishStickerPackExport" -> stickerShare.takePack(args.getString("id"))
                                    "finishNotesExport" -> stickerShare.takePack(args.getString("id"),args.optString("mime","application/json"))
                                    else -> stickerShare.cancel(args.getString("id"))
                                }
                            }
                            runOnUiThread {
                                runCatching {
                                    check(unlocked && !changingPin && !isDestroyed)
                                    val value = result.getOrThrow()
                                    if (value is Intent) startActivity(value)
                                    if (value is java.io.File) {
                                        if (documentExport != null) { value.delete(); error("Finish the current export first.") }
                                        val isNotes = method == "finishNotesExport"
                                        documentExport = DocumentExport(value, if (isNotes) "Notes backup" else "Sticker pack")
                                        try {
                                            val mime = if (isNotes) args.optString("mime","application/json") else "application/json"
                                            val suffix = mapOf("application/json" to "json","application/zip" to "zip","application/pdf" to "pdf",
                                                "text/plain" to "txt","text/markdown" to "md")[mime] ?: error("Unsupported document type.")
                                            saveOrbitDocument.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).setType(mime)
                                                .addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,
                                                    if (isNotes) "Orbit notes.$suffix" else "Orbit sticker pack.orbitstickers.json"))
                                        }
                                        catch (failure: Exception) { documentExport = null; value.delete(); throw failure }
                                    }
                                    answer.put("value", if (value is String) value else true)
                                }.onFailure { answer.put("error", it.message ?: "Android could not share this media.") }
                                reply.postMessage(answer.toString())
                            }
                        }
                        return@addWebMessageListener
                    }
                    if (method == "requestNotifications") {
                        check(notificationPermissionResult == null) { "Android is already checking notification permission." }
                        notifications.request({ permission ->
                            notificationPermissionResult = { allowed -> reply.postMessage(answer.put("value", allowed).toString()) }
                            try { requestNotification.launch(permission) }
                            catch (failure: Exception) { notificationPermissionResult = null; throw failure }
                        }) { allowed -> reply.postMessage(answer.put("value", allowed).toString()) }
                        return@addWebMessageListener
                    }
                    answer.put("value", handlePageRequest(request) ?: JSONObject.NULL)
                }
                catch (failure: Exception) { answer.put("error", failure.message ?: "Android could not complete the request.") }
                reply.postMessage(answer.toString())
            }
        }
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val uri = request.url
                if (!bundled(uri)) return null
                if (uri.path.orEmpty().startsWith(OrbitRichContent.pathPrefix)) {
                    return if (unlocked && !changingPin && !request.isForMainFrame) richContent.response(uri.path.orEmpty()) ?: missing() else missing()
                }
                if (uri.path.orEmpty().startsWith("/_orbit-native-share/")) {
                    return if (unlocked && !changingPin && !request.isForMainFrame) shares.response(uri.path.orEmpty()) ?: missing() else missing()
                }
                val response = assetLoader.shouldInterceptRequest(uri) ?: return missing()
                if (uri.path.orEmpty().endsWith(".mjs")) response.mimeType = "text/javascript"
                if (uri.path == "/assets/assets/notes-ocr/worker.min.js") response.responseHeaders = mapOf(
                    "X-Content-Type-Options" to "nosniff",
                    "Content-Security-Policy" to "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'"
                )
                if (uri.path == APP_PAGE) response.responseHeaders = mapOf(
                    "Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff", "Referrer-Policy" to "no-referrer",
                    "Content-Security-Policy" to "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.sheetjs.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; media-src 'self' https: data: blob:; connect-src 'self' blob: https: wss:; worker-src 'self' blob: https://cdnjs.cloudflare.com; frame-src https://www.openstreetmap.org; object-src 'none'; base-uri 'self'; form-action 'self'"
                )
                return response
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                val uri = request.url
                if (bundled(uri) && uri.path == APP_PAGE) return false
                if (uri.scheme == "https" && !bundled(uri)) openExternal(uri)
                return true
            }
        }
        webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                if (!unlocked || !bundled(Uri.parse(view.url.orEmpty()))) return false
                picker?.onReceiveValue(null)
                picker = callback
                try { chooseFile.launch(params.createIntent()) }
                catch (_: Exception) { picker = null; callback.onReceiveValue(null) }
                return true
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                if (!unlocked || !bundled(request.origin)) { request.deny(); return }
                val pairs = request.resources.mapNotNull { resource ->
                    when (resource) {
                        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> resource to Manifest.permission.RECORD_AUDIO
                        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> resource to Manifest.permission.CAMERA
                        else -> null
                    }
                }
                if (pairs.isEmpty()) { request.deny(); return }
                if (!askForPermissions(pairs.map { it.second }) {
                    val allowed = pairs.filter { granted(it.second) }.map { it.first }
                    if (unlocked && allowed.isNotEmpty()) request.grant(allowed.toTypedArray()) else request.deny()
                }) request.deny()
            }

            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                val fine = Manifest.permission.ACCESS_FINE_LOCATION
                val coarse = Manifest.permission.ACCESS_COARSE_LOCATION
                if (!unlocked || !bundled(Uri.parse(origin)) || !askForPermissions(listOf(fine, coarse)) {
                    callback.invoke(origin, unlocked && (granted(fine) || granted(coarse)), false)
                }) callback.invoke(origin, false, false)
            }
        }
    }

    private fun granted(permission: String) = ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun askForPermissions(permissions: List<String>, callback: () -> Unit): Boolean {
        if (permissionResult != null) return false
        val missing = permissions.filterNot(::granted)
        if (missing.isEmpty()) callback()
        else { permissionResult = callback; requestPermissions.launch(missing.toTypedArray()) }
        return true
    }

    private fun missing() = WebResourceResponse("text/plain", "UTF-8", 404, "Not found", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(ByteArray(0)))

    private fun openExternal(uri: Uri) {
        try { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
        catch (_: Exception) { Toast.makeText(this, "No browser is available.", Toast.LENGTH_SHORT).show() }
    }

    private fun handlePageRequest(request: JSONObject): Any? {
        val args = request.optJSONObject("args") ?: JSONObject()
        fun account(): String = args.getString("account").also { require(Regex("[0-9a-f-]{36}").matches(it)) }
        return when (request.getString("method")) {
            "remember" -> vault.remember(account(), args)
            "restore" -> vault.restore(account())
            "forget" -> vault.forget(account())
            "lockChats" -> lock()
            "versionCode" -> installedVersionCode()
            "changePin" -> {
                changingPin = true
                lock(notify = false)
                channel?.invokeMethod("changePin", null)
                null
            }
            "pendingShare" -> shares.list()
            "discardShare" -> shares.discard(args.getString("id"))
            "richComposerFocus" -> {
                val token = args.optString("token").takeIf { it.matches(Regex("[a-f0-9-]{36}")) }
                (page as? OrbitComposerWebView)?.composerToken = token
                null
            }
            "discardRichContent" -> richContent.discard(args.getString("id"))
            "shareNoteText" -> {
                val content = args.getString("text")
                require(content.length in 1..52000)
                startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_TEXT,content), "Share Orbit note"))
                true
            }
            "shareGiphyLink" -> {
                val id = args.getString("id")
                require(id.matches(Regex("[a-zA-Z0-9]{1,48}")))
                startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, "https://giphy.com/gifs/$id")
                }, "Share GIF"))
                true
            }
            "shareInvite" -> startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, "Join me on Orbit Messenger. $INVITE")
            }, "Invite to Orbit"))
            "downloadUpdate" -> updater.start(args)
            "pendingNoteReminder" -> pendingNote.also { pendingNote = null }
            "scheduleNoteReminders" -> {
                OrbitNoteAlarms.sync(this, account(), args.getJSONArray("rows"))
                true
            }
            "cancelNoteReminders" -> { OrbitNoteAlarms.clear(this, account()); true }
            "noteAlarmSettings" -> {
                if (Build.VERSION.SDK_INT >= 31) startActivity(Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
                true
            }
            "notificationStatus" -> notifications.enabled()
            "fullScreenCallSettings" -> {
                if (Build.VERSION.SDK_INT >= 34) startActivity(Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$packageName")))
                else Toast.makeText(this, "Incoming call display uses your notification settings.", Toast.LENGTH_SHORT).show()
            }
            "showNotification" -> notifications.show(args, unlocked && !changingPin)
            "incomingCall" -> showIncomingCall(args)
            "openChatPicker" -> {
                val payload = args.toString()
                check(payload.length <= 1_500_000) { "The picker list is too large." }
                page?.let { getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(it.windowToken, 0) }
                channel?.invokeMethod("openChatPicker", payload)
                channel != null
            }
            "clearNotification" -> {
                val tag = args.getString("tag")
                if (tag == "orbit-call-" + incoming?.id) clearIncomingCall() else notifications.clear(tag)
            }
            "clearNotifications" -> notifications.clearAll()
            else -> error("Unknown Android action.")
        }.let { if (it == Unit) null else it }
    }
}

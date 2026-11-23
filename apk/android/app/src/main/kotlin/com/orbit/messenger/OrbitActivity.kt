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
import android.view.View
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

class OrbitActivity : FlutterFragmentActivity() {
    private companion object {
        const val ORIGIN = "https://appassets.androidplatform.net"
        const val APP_PAGE = "/assets/index.html"
        const val INVITE = "https://orbit-messaging.vercel.app/"
        const val RELEASES = "https://github.com/RivaXx/Orbit-Messaging-/releases/download/"
    }
    private val vault by lazy { DeviceVault(this) }
    private val shares by lazy { GalleryShare(this) }
    private val work = Executors.newSingleThreadExecutor()
    private var page: WebView? = null
    @Volatile private var unlocked = false
    private var stoppedAt = 0L
    private var picker: ValueCallback<Array<Uri>>? = null
    private var permissionResult: (() -> Unit)? = null
    private var channel: MethodChannel? = null
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

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false)
        work.execute { shares.clearStaleFiles() }
        if (savedInstanceState == null) captureShare(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        captureShare(intent)
    }

    override fun onStop() {
        stoppedAt = SystemClock.elapsedRealtime()
        super.onStop()
    }

    override fun onStart() {
        super.onStart()
        if (stoppedAt > 0 && SystemClock.elapsedRealtime() - stoppedAt >= 30000 && (unlocked || changingPin)) {
            changingPin = false
            lock()
        }
        stoppedAt = 0L
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        flutterEngine.platformViewsController.registry.registerViewFactory("orbit-messaging", object : PlatformViewFactory(StandardMessageCodec.INSTANCE) {
            override fun create(context: Context, viewId: Int, args: Any?): PlatformView {
                val view = createWebView()
                page = view
                return object : PlatformView {
                    override fun getView() = view
                    override fun dispose() { if (page === view) page = null; view.destroy() }
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
        page?.visibility = View.INVISIBLE
        page?.evaluateJavascript("window.OrbitCrypto?.lock()", null)
        if (notify) channel?.invokeMethod("locked", null)
    }

    private fun unlock() {
        unlocked = true
        if (changingPin) return
        page?.visibility = View.VISIBLE
        page?.evaluateJavascript("window.OrbitCrypto?.restoreTrusted(); window.dispatchEvent(new Event('orbit-android-share'))", null)
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

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() = WebView(this).apply {
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
                if (!mainFrame || !unlocked || changingPin || Uri.parse(view.url.orEmpty()).path != APP_PAGE) return@addWebMessageListener
                val request = runCatching { JSONObject(message.data ?: "") }.getOrNull() ?: return@addWebMessageListener
                val answer = JSONObject().put("id", request.optInt("id"))
                try { answer.put("value", handlePageRequest(request) ?: JSONObject.NULL) }
                catch (failure: Exception) { answer.put("error", failure.message ?: "Android could not complete the request.") }
                reply.postMessage(answer.toString())
            }
        }
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val uri = request.url
                if (!bundled(uri)) return null
                if (uri.path.orEmpty().startsWith("/_orbit-native-share/")) {
                    return if (unlocked && !changingPin && !request.isForMainFrame) shares.response(uri.path.orEmpty()) ?: missing() else missing()
                }
                val response = assetLoader.shouldInterceptRequest(uri) ?: return missing()
                if (uri.path.orEmpty().endsWith(".mjs")) response.mimeType = "text/javascript"
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
        loadUrl("$ORIGIN$APP_PAGE?android=${installedVersionCode()}")
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
            "versionCode" -> installedVersionCode()
            "changePin" -> {
                changingPin = true
                lock(notify = false)
                channel?.invokeMethod("changePin", null)
                null
            }
            "pendingShare" -> shares.list()
            "discardShare" -> shares.discard(args.getString("id"))
            "shareInvite" -> startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, "Join me on Orbit Messenger. $INVITE")
            }, "Invite to Orbit"))
            "openUpdate" -> {
                val url = args.getString("url")
                require(url.startsWith(RELEASES) && Regex("v[0-9.]+/Orbit-Messenger-v[0-9.]+\\.apk").matches(url.removePrefix(RELEASES)))
                openExternal(Uri.parse(url))
            }
            else -> error("Unknown Android action.")
        }.let { if (it == Unit) null else it }
    }
}

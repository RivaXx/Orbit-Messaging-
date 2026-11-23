package com.orbit.messenger

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

internal class OrbitUpdater(
    private val activity: Activity,
    private val executor: Executor,
    private val openPermission: (Intent) -> Unit,
) {
    private companion object {
        const val REPOSITORY = "https://github.com/RivaXx/Orbit-Messaging-/releases/download/"
        const val MAX_APK_SIZE = 128L * 1024 * 1024
        val cdnHosts = setOf("release-assets.githubusercontent.com", "objects.githubusercontent.com")
    }
    private data class Release(val code: Long, val name: String, val url: String, val sha256: String)
    private val packages get() = activity.packageManager
    private var waitingForPermission: Release? = null
    private var running = false

    fun start(info: JSONObject) {
        check(!running && waitingForPermission == null) { "An Orbit update is already in progress." }
        val name = info.getString("versionName")
        val code = info.getLong("versionCode")
        val url = info.getString("downloadUrl")
        val sha256 = info.getString("sha256").lowercase()
        require(Regex("[0-9]+\\.[0-9]+\\.[0-9]+").matches(name) && code > version(packages.getPackageInfo(activity.packageName, 0))) { "The update version is invalid." }
        require(url == "${REPOSITORY}v$name/Orbit-Messenger-v$name.apk" && Regex("[0-9a-f]{64}").matches(sha256)) { "The update source could not be verified." }
        val release = Release(code, name, url, sha256)
        if (Build.VERSION.SDK_INT >= 26 && !packages.canRequestPackageInstalls()) {
            AlertDialog.Builder(activity).setTitle("Allow Orbit to install updates")
                .setMessage("Turn on Allow from this source for Orbit, then return to continue this update.")
                .setNegativeButton("Cancel", null).setPositiveButton("Open settings") { _, _ ->
                    waitingForPermission = release
                    try { openPermission(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))) }
                    catch (_: Exception) { waitingForPermission = null; message("Orbit could not open Android’s install settings.") }
                }.show()
            return
        }
        download(release)
    }

    fun resumePermission() {
        val release = waitingForPermission ?: return
        waitingForPermission = null
        if (Build.VERSION.SDK_INT < 26 || packages.canRequestPackageInstalls()) download(release)
        else message("Install permission is still off. You can try again from Settings.")
    }

    private fun download(release: Release) {
        running = true
        val cancelled = AtomicBoolean(false)
        val density = activity.resources.displayMetrics.density
        val content = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((24*density).toInt(), (16*density).toInt(), (24*density).toInt(), 0)
        }
        val status = TextView(activity).apply { text = "Connecting to GitHub…" }
        val bar = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply { isIndeterminate = true; max = 100 }
        content.addView(status)
        content.addView(bar)
        val progress = AlertDialog.Builder(activity).setTitle("Downloading Orbit ${release.name}").setView(content)
            .setCancelable(false).setNegativeButton("Cancel") { _, _ -> cancelled.set(true) }.show()
        executor.execute {
            val folder = File(activity.cacheDir, "orbit-update")
            val file = File(folder, "orbit-update.apk")
            val result = runCatching {
                check(folder.isDirectory || folder.mkdirs()) { "Orbit could not prepare storage for the update." }
                downloadVerified(release, file, cancelled) { percent -> activity.runOnUiThread {
                    if (activity.isDestroyed || cancelled.get()) return@runOnUiThread
                    bar.isIndeterminate = percent == null
                    if (percent != null) bar.progress = percent
                    status.text = percent?.let { if (it == 100) "Verifying the signed APK…" else "$it% downloaded" } ?: "Downloading…"
                } }
                verifyPackage(file, release.code)
            }
            if (result.isFailure || cancelled.get()) file.delete()
            activity.runOnUiThread {
                running = false
                if (activity.isDestroyed) return@runOnUiThread
                progress.dismiss()
                if (cancelled.get()) return@runOnUiThread
                result.onFailure { message(it.message ?: "The download failed. Try again.") }
                    .onSuccess { confirmInstall(file, release.name) }
            }
        }
    }

    private fun connection(url: String): HttpURLConnection {
        var current = URL(url)
        repeat(5) { hop ->
            check(current.protocol == "https" && current.userInfo == null && current.port in listOf(-1,443) &&
                if (hop == 0) current.host == "github.com" else current.host in cdnHosts) { "The APK download redirected to an unexpected host." }
            val response = (current.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 20000
                readTimeout = 20000
                setRequestProperty("Accept-Encoding", "identity")
            }
            val code = try { response.responseCode } catch (failure: Exception) { response.disconnect(); throw failure }
            if (code == 200) return response
            val next = response.getHeaderField("Location")
            response.disconnect()
            check(code in listOf(301,302,303,307,308) && next != null) { "GitHub could not provide this update." }
            current = URL(current, next)
        }
        error("Too many redirects while downloading Orbit.")
    }

    private fun downloadVerified(release: Release, file: File, cancelled: AtomicBoolean, progress: (Int?) -> Unit) {
        val response = connection(release.url)
        val digest = MessageDigest.getInstance("SHA-256")
        try {
            val length = response.contentLengthLong
            check(length <= MAX_APK_SIZE) { "The update exceeds the allowed download size." }
            var size = 0L
            var previous = -1
            progress(null)
            response.inputStream.buffered().use { input -> file.outputStream().buffered().use { output ->
                val buffer = ByteArray(128 * 1024)
                while (!cancelled.get()) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    size += count
                    check(size <= MAX_APK_SIZE) { "The update exceeds the allowed download size." }
                    output.write(buffer, 0, count)
                    digest.update(buffer, 0, count)
                    if (length > 0) {
                        val percent = (size * 100 / length).toInt().coerceAtMost(99)
                        if (percent != previous) { previous = percent; progress(percent) }
                    }
                }
            } }
            check(!cancelled.get())
            check(size > 0 && (length < 0 || size == length)) { "The update download is incomplete." }
            progress(100)
            val expected = release.sha256.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
            check(MessageDigest.isEqual(expected, digest.digest())) { "The downloaded APK did not match the published checksum." }
        } finally { response.disconnect() }
    }

    @Suppress("DEPRECATION")
    private fun verifyPackage(file: File, code: Long) {
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val installed = packages.getPackageInfo(activity.packageName, flags)
        val incoming = packages.getPackageArchiveInfo(file.absolutePath, flags) ?: error("The downloaded file is not an Android package.")
        check(incoming.packageName == installed.packageName && version(incoming) == code && version(incoming) > version(installed)) { "The APK is for a different app or version." }
        val expected = signers(installed)
        check(expected.isNotEmpty() && signers(incoming) == expected) { "The APK signing certificate does not match this Orbit installation." }
    }

    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo): Set<android.content.pm.Signature> =
        (if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures)?.toSet().orEmpty()

    @Suppress("DEPRECATION")
    private fun version(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

    private fun confirmInstall(file: File, name: String) {
        AlertDialog.Builder(activity).setTitle("Orbit $name is ready")
            .setMessage("Android will ask you to confirm installation. Orbit will close during the update.")
            .setNegativeButton("Later") { _, _ -> file.delete() }.setPositiveButton("Install") { _, _ ->
                try {
                    val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", file)
                    activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                } catch (_: Exception) { message("Android could not open the installer. Check install permission and try again.") }
            }.show()
    }

    private fun message(text: String) {
        AlertDialog.Builder(activity).setTitle("Orbit update").setMessage(text).setPositiveButton("OK", null).show()
    }
}

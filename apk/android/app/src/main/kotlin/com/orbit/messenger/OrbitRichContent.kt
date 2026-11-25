package com.orbit.messenger

import android.content.Context
import android.net.Uri
import android.os.SystemClock
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.core.view.inputmethod.EditorInfoCompat
import androidx.core.view.inputmethod.InputConnectionCompat
import androidx.core.view.inputmethod.InputContentInfoCompat
import java.io.File
import java.util.UUID

internal class OrbitComposerWebView(
    context: Context,
    private val receive: (InputContentInfoCompat, Int, String) -> Boolean,
) : WebView(context) {
    var composerToken: String? = null
        set(value) {
            if (field == value) return
            field = value
            if (value != null && hasFocus()) {
                context.getSystemService(InputMethodManager::class.java).restartInput(this)
            }
        }

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        val connection = super.onCreateInputConnection(outAttrs) ?: return null
        val token = composerToken ?: return connection
        EditorInfoCompat.setContentMimeTypes(outAttrs, OrbitRichContent.mimeTypes)
        return InputConnectionCompat.createWrapper(connection, outAttrs) { info, flags, _ ->
            composerToken == token && receive(info, flags, token)
        }
    }
}

internal class OrbitRichContent(private val context: Context) {
    companion object {
        val mimeTypes = arrayOf("image/gif", "image/png", "image/webp", "image/jpeg")
        const val pathPrefix = "/_orbit-composer-media/"
        private const val maxBytes = 12 * 1024 * 1024L
    }

    private data class Staged(val file: File, val mime: String, val expires: Long)
    private var staged: Staged? = null
    private var copying = false

    @Synchronized fun begin(): Boolean {
        if (copying) return false
        copying = true
        return true
    }

    @Synchronized fun finish() { copying = false }

    fun copy(uri: Uri, mime: String): File {
        val file = File(context.cacheDir, "orbit-ime-" + UUID.randomUUID())
        try {
            val source = context.contentResolver.openInputStream(uri)
                ?: error("The keyboard photo could not be opened.")
            source.use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(32 * 1024)
                    var size = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        size += count
                        require(size <= maxBytes) { "Choose media under 12 MB." }
                        output.write(buffer, 0, count)
                    }
                    require(size > 0) { "The keyboard sent an empty file." }
                }
            }
            require(mime in mimeTypes) { "Unsupported keyboard media." }
            return file
        } catch (failure: Exception) {
            file.delete()
            throw failure
        }
    }

    @Synchronized fun stage(file: File, mime: String): String {
        clear()
        staged = Staged(file, mime, SystemClock.elapsedRealtime() + 30000)
        return file.name
    }

    @Synchronized fun response(path: String): WebResourceResponse? {
        val item = staged ?: return null
        if (SystemClock.elapsedRealtime() >= item.expires) { clear(); return null }
        if (path != pathPrefix + item.file.name) return null
        return runCatching {
            WebResourceResponse(item.mime, null, 200, "OK",
                mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff"),
                item.file.inputStream())
        }.getOrNull()
    }

    @Synchronized fun discard(id: String) {
        if (staged?.file?.name == id) clear()
    }

    @Synchronized fun clear() {
        staged?.file?.delete()
        staged = null
    }

    fun clearAfterProcessDeath() {
        context.cacheDir.listFiles()?.filter { it.name.startsWith("orbit-ime-") }?.forEach { it.delete() }
    }
}

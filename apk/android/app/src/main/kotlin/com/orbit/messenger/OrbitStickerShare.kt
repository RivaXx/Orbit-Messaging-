package com.orbit.messenger

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.util.Base64
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID

internal class OrbitStickerShare(private val activity: Activity) {
    private data class Pending(val id: String, val file: File, val mime: String, val total: Long, var written: Long = 0)
    private val directory = File(activity.cacheDir, "orbit-shared-media")
    private var pending: Pending? = null

    @Synchronized fun start(mime: String, size: Long): String {
        val extension = when (mime) {
            "image/gif" -> "gif"
            "image/webp" -> "webp"
            "image/png" -> "png"
            "image/jpeg" -> "jpg"
            "application/json" -> "orbitstickers.json"
            "application/zip" -> "zip"
            "application/pdf" -> "pdf"
            "text/plain" -> "txt"
            "text/markdown" -> "md"
            else -> error("Unsupported share format.")
        }
        val limit = (if (mime.startsWith("image/")) 12 else 35) * 1024 * 1024L
        require(size in 1..limit) { "The file exceeds the export size limit." }
        cancel()
        directory.mkdirs()
        val oldest = System.currentTimeMillis() - 3600000
        directory.listFiles()?.filter { it.lastModified() < oldest }?.forEach { it.delete() }
        val id = UUID.randomUUID().toString()
        pending = Pending(id, File(directory, "Orbit-media-$id.$extension"), mime, size)
        return id
    }

    @Synchronized fun append(id: String, offset: Long, base64: String) {
        val item = pending?.takeIf { it.id == id } ?: error("The share expired.")
        require(offset == item.written && base64.length in 1..65536) { "Invalid media chunk." }
        val bytes = Base64.decode(base64, Base64.NO_WRAP)
        require(bytes.isNotEmpty() && item.written + bytes.size <= item.total) { "Invalid share size." }
        item.file.appendBytes(bytes)
        item.written += bytes.size
    }

    @Synchronized fun finish(id: String): Intent {
        val item = pending?.takeIf { it.id == id } ?: error("The share expired.")
        check(item.mime.startsWith("image/")) { "Use Export pack to save this document." }
        check(item.written == item.total) { "The media did not finish loading." }
        val uri = FileProvider.getUriForFile(activity, activity.packageName + ".updates", item.file)
        pending = null
        return Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            type = item.mime
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newUri(activity.contentResolver, "Orbit media", uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }, "Share Orbit media")
    }

    @Synchronized fun takePack(id: String, mime: String = "application/json"): File {
        val item = pending?.takeIf { it.id == id && it.mime == mime } ?: error("The export expired.")
        check(item.written == item.total) { "The pack did not finish loading." }
        pending = null
        return item.file
    }

    @Synchronized fun cancel(id: String? = null) {
        val item = pending ?: return
        if (id != null && item.id != id) return
        item.file.delete()
        pending = null
    }
}

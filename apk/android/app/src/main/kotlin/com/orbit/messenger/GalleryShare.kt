package com.orbit.messenger

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.WebResourceResponse
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

internal class GalleryShare(private val context: Context) {
    private data class Photo(val key: String, val file: File, val name: String, val type: String)
    private data class Batch(val id: String, val photos: List<Photo>, val received: Long)
    private val directory = File(context.cacheDir, "incoming-gallery")
    @Volatile private var pending: Batch? = null
    private val ttl = 15 * 60 * 1000L
    private val imageTypes = setOf("image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif", "image/bmp", "image/tiff")

    private fun detectPhoto(header: ByteArray): String? {
        fun tag(offset: Int, value: String) = header.size >= offset + value.length &&
            value.indices.all { header[offset + it].toInt() == value[it].code }
        return when {
            header.size >= 3 && (header[0].toInt() and 255) == 255 && (header[1].toInt() and 255) == 216 && (header[2].toInt() and 255) == 255 -> "image/jpeg"
            header.size >= 8 && (header[0].toInt() and 255) == 137 && tag(1, "PNG\r\n\u001a\n") -> "image/png"
            tag(0, "GIF87a") || tag(0, "GIF89a") -> "image/gif"
            tag(0, "RIFF") && tag(8, "WEBP") -> "image/webp"
            tag(0, "BM") -> "image/bmp"
            tag(0, "II*\u0000") || tag(0, "MM\u0000*") -> "image/tiff"
            tag(4, "ftyp") && (tag(8, "avif") || tag(8, "avis")) -> "image/avif"
            tag(4, "ftyp") && (tag(8, "heic") || tag(8, "heix") || tag(8, "mif1")) -> "image/heic"
            else -> null
        }
    }

    fun clearStaleFiles() {
        val now = System.currentTimeMillis()
        directory.listFiles()?.filter { now - it.lastModified() !in 0 until ttl }?.forEach { it.delete() }
    }

    @Suppress("DEPRECATION")
    fun capture(intent: Intent) {
        val uris = linkedSetOf<Uri>()
        if (intent.action == Intent.ACTION_SEND) {
            runCatching { intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) }.getOrNull()?.let(uris::add)
        } else if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
            runCatching { intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) }.getOrNull()?.let(uris::addAll)
        } else return
        intent.clipData?.let { clip ->
            require(clip.itemCount <= 20) { "Choose at most 20 photos." }
            for (index in 0 until clip.itemCount) clip.getItemAt(index).uri?.let(uris::add)
        }
        require(uris.isNotEmpty() && uris.size <= 20) { "Choose between 1 and 20 photos." }
        directory.mkdirs()
        val current = pending?.photos?.map { it.file }?.toSet().orEmpty()
        directory.listFiles()?.filter { it !in current }?.forEach { it.delete() }
        val photos = mutableListOf<Photo>()
        var total = 0L
        try {
            for (uri in uris) {
                require(uri.scheme == "content") { "Android could not open the shared photo." }
                val resolver = context.contentResolver
                val declaredType = runCatching { resolver.getType(uri) }.getOrNull()?.substringBefore(';')?.trim()?.lowercase()
                val name = runCatching {
                    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                        if (it.moveToFirst()) it.getString(0) else null
                    }
                }.getOrNull()?.replace(Regex("[\\p{Cntrl}/\\\\]"), "_")?.take(128) ?: "Shared photo"
                val key = UUID.randomUUID().toString()
                val file = File(directory, key)
                val stream = resolver.openInputStream(uri) ?: error("Android could not read the shared photo.")
                stream.buffered().use { input ->
                    input.mark(32)
                    val header = ByteArray(32)
                    var count = 0
                    while (count < header.size) {
                        val read = input.read(header, count, header.size - count)
                        if (read <= 0) break
                        count += read
                    }
                    input.reset()
                    val type = detectPhoto(header.copyOf(count)) ?: declaredType?.takeIf { it in imageTypes }
                    require(type != null) { "The shared file is not a supported photo." }
                    photos += Photo(key, file, name, type)
                    file.outputStream().use { output ->
                        val buffer = ByteArray(128 * 1024)
                        var size = 0L
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            size += read
                            total += read
                            require(size <= 49L*1024*1024 && total <= 50L*1024*1024) { "Share up to 50 MB of photos at once." }
                            output.write(buffer, 0, read)
                        }
                        require(size > 0) { "A shared photo was empty." }
                    }
                }
            }
            synchronized(this) {
                val previous = pending
                pending = Batch(UUID.randomUUID().toString(), photos, System.currentTimeMillis())
                previous?.photos?.forEach { it.file.delete() }
            }
        } catch (error: Exception) {
            photos.forEach { it.file.delete() }
            throw error
        }
    }

    @Synchronized fun list(): JSONObject? {
        val batch = validBatch() ?: return null
        val photos = JSONArray(batch.photos.map { photo ->
            JSONObject().put("path", "/_orbit-native-share/${photo.key}").put("name", photo.name).put("type", photo.type)
        })
        return JSONObject().put("id", batch.id).put("files", photos)
    }

    @Synchronized fun discard(id: String) {
        val batch = pending ?: return
        if (id != batch.id) return
        pending = null
        batch.photos.forEach { it.file.delete() }
    }

    @Synchronized fun response(path: String): WebResourceResponse? {
        val photo = validBatch()?.photos?.firstOrNull { path == "/_orbit-native-share/${it.key}" } ?: return null
        if (!photo.file.isFile) return null
        return WebResourceResponse(photo.type, null, 200, "OK", mapOf("Cache-Control" to "no-store"), photo.file.inputStream())
    }

    private fun validBatch(): Batch? {
        val batch = pending ?: return null
        if (System.currentTimeMillis() - batch.received in 0 until ttl) return batch
        discard(batch.id)
        return null
    }
}

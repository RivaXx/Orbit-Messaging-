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

    fun clearStaleFiles() {
        val now = System.currentTimeMillis()
        directory.listFiles()?.filter { now - it.lastModified() !in 0 until ttl }?.forEach { it.delete() }
    }

    @Suppress("DEPRECATION")
    fun capture(intent: Intent) {
        val uris = linkedSetOf<Uri>()
        if (intent.action == Intent.ACTION_SEND) {
            intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.let(uris::add)
        } else if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
            intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.let(uris::addAll)
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
                val type = resolver.getType(uri) ?: intent.type.orEmpty()
                require(Regex("image/(jpeg|png|webp|gif|avif|heic|heif|bmp|tiff)", RegexOption.IGNORE_CASE).matches(type)) {
                    "The shared file is not a supported photo."
                }
                val name = runCatching {
                    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                        if (it.moveToFirst()) it.getString(0) else null
                    }
                }.getOrNull()?.replace(Regex("[\\p{Cntrl}/\\\\]"), "_")?.take(128) ?: "Shared photo"
                val key = UUID.randomUUID().toString()
                val file = File(directory, key)
                photos += Photo(key, file, name, type)
                val stream = resolver.openInputStream(uri) ?: error("Android could not read the shared photo.")
                stream.use { input ->
                    file.outputStream().use { output ->
                        val buffer = ByteArray(128 * 1024)
                        var size = 0L
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            size += count
                            total += count
                            require(size <= 49L*1024*1024 && total <= 50L*1024*1024) { "Share up to 50 MB of photos at once." }
                            output.write(buffer, 0, count)
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

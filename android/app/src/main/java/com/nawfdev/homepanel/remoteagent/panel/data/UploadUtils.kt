package com.nawfdev.homepanel.remoteagent.panel.data

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source

/** Resolves a content:// picker result to its display filename (falls back
 * to the last path segment when the provider doesn't expose one). */
fun resolveFileName(context: Context, uri: Uri): String {
    context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (nameIndex >= 0 && cursor.moveToFirst()) return cursor.getString(nameIndex)
    }
    return uri.lastPathSegment ?: "file"
}

/**
 * Streams a content:// Uri straight into the multipart body instead of
 * buffering it into memory first — movie files can be several GB, and
 * ExoPlayer-style in-memory ByteArray upload would OOM on a phone.
 */
fun uriToMultipart(context: Context, uri: Uri, partName: String, mimeType: String?): MultipartBody.Part {
    val fileName = resolveFileName(context, uri)
    val length = context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
    val body = object : RequestBody() {
        override fun contentType() = mimeType?.toMediaTypeOrNull()
        override fun contentLength() = length
        override fun writeTo(sink: BufferedSink) {
            context.contentResolver.openInputStream(uri)?.use { input ->
                sink.writeAll(input.source())
            }
        }
    }
    return MultipartBody.Part.createFormData(partName, fileName, body)
}

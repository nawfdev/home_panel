package com.nawfdev.homepanel.remoteagent.panel.data

import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import java.net.URLEncoder
import okhttp3.OkHttpClient

/**
 * Authenticated playback helpers shared by the Stream (progressive file) and
 * TV (DASH/HLS, possibly DRM) players. be/internal/handlers/auth.go's
 * RequireAuth accepts either the browser session cookie or an
 * `Authorization: Bearer <token>` header — the web app relies on the cookie
 * for <video>/<img> tags (which can't set headers), but ExoPlayer's
 * DataSource can, so every manifest/segment/license request here just
 * carries the same bearer token ApiClient attaches to REST calls.
 */
@UnstableApi
fun PanelPrefs.mediaDataSourceFactory(extraHeaders: Map<String, String> = emptyMap()): OkHttpDataSource.Factory {
    val client = OkHttpClient.Builder().build()
    val headers = buildMap {
        token?.let { put("Authorization", "Bearer $it") }
        putAll(extraHeaders)
    }
    return OkHttpDataSource.Factory(client).setDefaultRequestProperties(headers)
}

/** Resolves a server-relative URL (e.g. a Job.poster, already shaped like
 * `/api/files/download?path=...`) against the configured panel base URL. */
fun PanelPrefs.absoluteUrl(relative: String): String {
    if (relative.isBlank()) return ""
    val base = baseUrl?.trimEnd('/') ?: return relative
    return if (relative.startsWith("http://") || relative.startsWith("https://")) relative else "$base$relative"
}

/** Builds the Range-capable download/stream URL for a library file's raw
 * filesystem `dest` path (see be/internal/handlers/files.go's ServeFile). */
fun PanelPrefs.downloadUrl(destPath: String): String {
    val base = baseUrl?.trimEnd('/') ?: return ""
    return "$base/api/files/download?path=${URLEncoder.encode(destPath, "UTF-8")}"
}

/** Builds the URL for a sidecar subtitle track, converted to VTT on the fly
 * server-side (be/internal/handlers/files.go's subtitle handler). */
fun PanelPrefs.subtitleUrl(destPath: String, name: String): String {
    val base = baseUrl?.trimEnd('/') ?: return ""
    return "$base/api/files/subtitle?path=${URLEncoder.encode(destPath, "UTF-8")}&name=${URLEncoder.encode(name, "UTF-8")}"
}

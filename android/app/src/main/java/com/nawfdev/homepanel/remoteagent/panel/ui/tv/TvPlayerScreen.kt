package com.nawfdev.homepanel.remoteagent.panel.ui.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.dash.DashMediaSource
import androidx.media3.exoplayer.drm.DefaultDrmSessionManager
import androidx.media3.exoplayer.drm.DrmSessionManagerProvider
import androidx.media3.exoplayer.drm.FrameworkMediaDrm
import androidx.media3.exoplayer.drm.HttpMediaDrmCallback
import androidx.media3.exoplayer.drm.LocalMediaDrmCallback
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.ui.PlayerView
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.Channel
import com.nawfdev.homepanel.remoteagent.panel.data.DrmInfo
import com.nawfdev.homepanel.remoteagent.panel.data.PanelPrefs
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized
import com.nawfdev.homepanel.remoteagent.panel.data.mediaDataSourceFactory
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.LoadingState
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelBg
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextMuted
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextPrimary

/**
 * Live channel playback — DASH channels (and any with a `drm` block) use
 * DashMediaSource + a DrmSessionManager (Widevine via the platform
 * MediaDrm/L3, or a locally-supplied ClearKey); plain HLS/TS channels use
 * HlsMediaSource/progressive extraction. Mirrors fe/src/pages/TvPlayer.tsx's
 * Shaka(DASH+DRM)/hls.js(HLS) split, but skips the backend's /tv-proxy
 * header-rewrite trick entirely — ExoPlayer's HttpDataSource can already set
 * arbitrary request headers (Referer/User-Agent/Authorization) directly.
 */
@OptIn(UnstableApi::class)
@Composable
fun TvPlayerScreen(channelId: String, apiClient: ApiClient, prefs: PanelPrefs, onUnauthorized: () -> Unit, onBack: () -> Unit) {
    var channel by remember { mutableStateOf<Channel?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(channelId) {
        try {
            val res = apiClient.api().tvChannels()
            channel = res.channels.firstOrNull { it.id == channelId }
            if (channel == null) error = "Channel not found"
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load channel"
        }
    }

    Column(modifier = Modifier
        .fillMaxSize()
        .background(PanelBg)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Filled.ArrowBack, contentDescription = "Back", tint = PanelTextPrimary)
            }
            Column(modifier = Modifier.padding(start = 4.dp)) {
                Text(channel?.name ?: "", style = MaterialTheme.typography.titleMedium, color = PanelTextPrimary)
                channel?.group?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = PanelTextMuted) }
            }
        }

        val current = channel
        when {
            error != null -> ErrorText(error!!, modifier = Modifier.padding(16.dp))
            current == null -> LoadingState()
            else -> TvVideoPlayer(channel = current, prefs = prefs, onError = { error = it })
        }
    }
}

@OptIn(UnstableApi::class)
@Composable
private fun TvVideoPlayer(channel: Channel, prefs: PanelPrefs, onError: (String) -> Unit) {
    val context = LocalContext.current
    val exoPlayer = remember(channel.id) {
        ExoPlayer.Builder(context).build().apply {
            try {
                setMediaSource(buildChannelMediaSource(channel, prefs))
                prepare()
                playWhenReady = true
            } catch (e: Exception) {
                onError(e.message ?: "Couldn't start playback")
            }
        }
    }

    DisposableEffect(channel.id) {
        onDispose { exoPlayer.release() }
    }

    Box(modifier = Modifier
        .fillMaxWidth()
        .padding(top = 8.dp)) {
        AndroidView(
            factory = {
                PlayerView(it).apply {
                    player = exoPlayer
                    useController = true
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f),
        )
    }
}

@UnstableApi
private fun buildChannelMediaSource(channel: Channel, prefs: PanelPrefs): MediaSource {
    val dataSourceFactory = prefs.mediaDataSourceFactory(channel.headers ?: emptyMap())
    val mimeType = when (channel.type) {
        "dash" -> MimeTypes.APPLICATION_MPD
        "hls" -> MimeTypes.APPLICATION_M3U8
        else -> null
    }
    val mediaItem = MediaItem.Builder().setUri(channel.url).apply { mimeType?.let(::setMimeType) }.build()

    val sourceFactory: MediaSource.Factory = when (channel.type) {
        "dash" -> DashMediaSource.Factory(dataSourceFactory)
        "hls" -> HlsMediaSource.Factory(dataSourceFactory)
        else -> ProgressiveMediaSource.Factory(dataSourceFactory)
    }

    channel.drm?.let { drm ->
        buildDrmSessionManagerProvider(drm, prefs)?.let { sourceFactory.setDrmSessionManagerProvider(it) }
    }

    return sourceFactory.createMediaSource(mediaItem)
}

@UnstableApi
private fun buildDrmSessionManagerProvider(drm: DrmInfo, prefs: PanelPrefs): DrmSessionManagerProvider? = when (drm.system) {
    "widevine" -> {
        val serverUrl = drm.serverUrl
        if (serverUrl.isNullOrBlank()) {
            null
        } else {
            val callback = HttpMediaDrmCallback(serverUrl, prefs.mediaDataSourceFactory())
            val manager = DefaultDrmSessionManager.Builder()
                .setUuidAndExoMediaDrmProvider(C.WIDEVINE_UUID, FrameworkMediaDrm.DEFAULT_PROVIDER)
                .build(callback)
            DrmSessionManagerProvider { manager }
        }
    }
    "clearkey" -> {
        val keys = drm.clearKeys
        if (keys.isNullOrEmpty()) {
            null
        } else {
            val callback = LocalMediaDrmCallback(clearKeyJson(keys).toByteArray(Charsets.UTF_8))
            val manager = DefaultDrmSessionManager.Builder()
                .setUuidAndExoMediaDrmProvider(C.CLEARKEY_UUID, FrameworkMediaDrm.DEFAULT_PROVIDER)
                .build(callback)
            DrmSessionManagerProvider { manager }
        }
    }
    else -> null
}

/** Builds a W3C ClearKey license JSON from the hex KID:KEY pairs parsed out
 * of the channel's `#KODIPROP:...clearkeys` line (be/internal/tv/m3u.go). */
private fun clearKeyJson(keys: Map<String, String>): String {
    fun hexToBase64Url(hex: String): String {
        val clean = hex.trim()
        val bytes = ByteArray(clean.length / 2) { i ->
            ((Character.digit(clean[i * 2], 16) shl 4) + Character.digit(clean[i * 2 + 1], 16)).toByte()
        }
        return android.util.Base64.encodeToString(bytes, android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP)
    }
    val keyObjects = keys.entries.joinToString(",") { (kid, key) ->
        "{\"kty\":\"oct\",\"kid\":\"${hexToBase64Url(kid)}\",\"k\":\"${hexToBase64Url(key)}\"}"
    }
    return "{\"keys\":[$keyObjects],\"type\":\"temporary\"}"
}

package com.nawfdev.homepanel.remoteagent.panel.ui.stream

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import android.net.Uri
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.Job
import com.nawfdev.homepanel.remoteagent.panel.data.MediaInfoRequest
import com.nawfdev.homepanel.remoteagent.panel.data.PanelPrefs
import com.nawfdev.homepanel.remoteagent.panel.data.SubtitleTrack
import com.nawfdev.homepanel.remoteagent.panel.data.downloadUrl
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized
import com.nawfdev.homepanel.remoteagent.panel.data.mediaDataSourceFactory
import com.nawfdev.homepanel.remoteagent.panel.data.subtitleUrl
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.LoadingState
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelBg
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextPrimary

/** Progressive (Range-capable) file playback for one library entry — the
 * source is a plain MP4/MKV/WebM served by GET /api/files/download. Soft
 * subtitles are sidecar files the backend converts to VTT on the fly (see
 * fe/src/pages/Watch.tsx's use of POST /api/files/media-info + GET
 * /api/files/subtitle) — probed here the same way and attached to the
 * MediaItem as external subtitle tracks. */
@OptIn(UnstableApi::class)
@Composable
fun StreamWatchScreen(jobId: String, apiClient: ApiClient, prefs: PanelPrefs, onUnauthorized: () -> Unit, onBack: () -> Unit) {
    var job by remember { mutableStateOf<Job?>(null) }
    var subtitles by remember { mutableStateOf<List<SubtitleTrack>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(jobId) {
        try {
            val found = apiClient.api().listDownloads().jobs.firstOrNull { it.id == jobId }
            job = found
            if (found == null) {
                error = "Movie not found"
            } else {
                try {
                    subtitles = apiClient.api().mediaInfo(MediaInfoRequest(found.dest)).subtitles
                } catch (e: Exception) {
                    // Subtitle probing is best-effort — missing/failed media-info
                    // shouldn't block playback of the video itself.
                }
            }
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load movie"
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
            Text(
                job?.title ?: "",
                style = MaterialTheme.typography.titleMedium,
                color = PanelTextPrimary,
                modifier = Modifier.padding(start = 4.dp),
            )
        }

        val current = job
        when {
            error != null -> ErrorText(error!!, modifier = Modifier.padding(16.dp))
            current == null -> LoadingState()
            else -> VideoPlayer(url = prefs.downloadUrl(current.dest), destPath = current.dest, subtitles = subtitles, prefs = prefs)
        }
    }
}

@OptIn(UnstableApi::class)
@Composable
private fun VideoPlayer(url: String, destPath: String, subtitles: List<SubtitleTrack>, prefs: PanelPrefs) {
    val context = LocalContext.current
    val exoPlayer = remember {
        val dataSourceFactory = prefs.mediaDataSourceFactory()
        val subtitleConfigs = subtitles.mapIndexed { index, track ->
            MediaItem.SubtitleConfiguration.Builder(Uri.parse(prefs.subtitleUrl(destPath, track.name)))
                .setMimeType(MimeTypes.TEXT_VTT)
                .setLabel(track.label.ifBlank { track.name })
                .setSelectionFlags(if (index == 0) C.SELECTION_FLAG_DEFAULT else 0)
                .build()
        }
        val mediaItem = MediaItem.Builder()
            .setUri(url)
            .setSubtitleConfigurations(subtitleConfigs)
            .build()
        // DefaultMediaSourceFactory (rather than a bare ProgressiveMediaSource)
        // is what actually merges the external subtitle tracks above into
        // playback — the leaf source factories don't do that on their own.
        val mediaSource = DefaultMediaSourceFactory(dataSourceFactory).createMediaSource(mediaItem)
        ExoPlayer.Builder(context).build().apply {
            setMediaSource(mediaSource)
            prepare()
            playWhenReady = true
        }
    }

    DisposableEffect(Unit) {
        onDispose { exoPlayer.release() }
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp),
    ) {
        AndroidView(
            factory = {
                PlayerView(it).apply {
                    player = exoPlayer
                    useController = true
                    setShowSubtitleButton(true)
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f),
        )
    }
}

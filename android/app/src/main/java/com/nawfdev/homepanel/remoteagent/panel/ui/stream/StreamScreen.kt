package com.nawfdev.homepanel.remoteagent.panel.ui.stream

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.Job
import com.nawfdev.homepanel.remoteagent.panel.data.MovieRenameRequest
import com.nawfdev.homepanel.remoteagent.panel.data.PanelPrefs
import com.nawfdev.homepanel.remoteagent.panel.data.absoluteUrl
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized
import com.nawfdev.homepanel.remoteagent.panel.data.resolveFileName
import com.nawfdev.homepanel.remoteagent.panel.data.uriToMultipart
import com.nawfdev.homepanel.remoteagent.panel.ui.components.AuthAsyncImage
import com.nawfdev.homepanel.remoteagent.panel.ui.components.DangerButton
import com.nawfdev.homepanel.remoteagent.panel.ui.components.EmptyState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.LoadingState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PanelDialog
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PanelTextField
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PrimaryButton
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ScreenHeader
import com.nawfdev.homepanel.remoteagent.panel.ui.components.SecondaryButton
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextMuted
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextPrimary
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody

/** Media library: every finished download, as a poster grid — parity with
 * fe/src/pages/Stream.tsx. Playback opens [StreamWatchScreen] separately. */
@Composable
fun StreamScreen(apiClient: ApiClient, prefs: PanelPrefs, onUnauthorized: () -> Unit, onOpenWatch: (String) -> Unit) {
    val scope = rememberCoroutineScope()

    var jobs by remember { mutableStateOf<List<Job>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    var addOpen by remember { mutableStateOf(false) }
    var editTarget by remember { mutableStateOf<Job?>(null) }
    var deleteTarget by remember { mutableStateOf<Job?>(null) }

    suspend fun load() {
        try {
            jobs = apiClient.api().listDownloads().jobs.filter { it.status == "done" }
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else { jobs = emptyList(); error = e.message ?: "Failed to load library" }
        }
    }

    LaunchedEffect(Unit) { load() }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        ScreenHeader("Stream", "Your downloaded movies, ready to watch") {
            IconButton(onClick = { addOpen = true }) { Icon(Icons.Filled.Add, contentDescription = "Add movie", tint = PanelTextPrimary) }
            IconButton(onClick = { scope.launch { load() } }) { Icon(Icons.Filled.Refresh, contentDescription = "Refresh", tint = PanelTextPrimary) }
        }

        val current = jobs
        when {
            error != null -> ErrorText(error!!)
            current == null -> LoadingState()
            current.isEmpty() -> EmptyState("No finished downloads yet — start one from Movies, or add a file manually.")
            else -> LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.padding(top = 16.dp),
            ) {
                items(current, key = { it.id }) { job ->
                    PosterTile(
                        job = job,
                        prefs = prefs,
                        onClick = { onOpenWatch(job.id) },
                        onEdit = { editTarget = job },
                        onDelete = { deleteTarget = job },
                    )
                }
            }
        }
    }

    if (addOpen) {
        AddMovieDialog(
            apiClient = apiClient,
            onDismiss = { addOpen = false },
            onAdded = { addOpen = false; scope.launch { load() } },
            onUnauthorized = onUnauthorized,
        )
    }

    editTarget?.let { job ->
        EditMovieDialog(
            job = job,
            apiClient = apiClient,
            onDismiss = { editTarget = null },
            onSaved = { editTarget = null; scope.launch { load() } },
            onUnauthorized = onUnauthorized,
        )
    }

    deleteTarget?.let { job ->
        var deleting by remember { mutableStateOf(false) }
        var deleteError by remember { mutableStateOf<String?>(null) }
        PanelDialog(title = "Delete movie", onDismiss = { if (!deleting) deleteTarget = null }) {
            Text("Delete \"${job.title}\"? This removes the file from disk and can't be undone.", style = MaterialTheme.typography.bodyMedium, color = PanelTextMuted)
            deleteError?.let { ErrorText(it) }
            Row(modifier = Modifier.padding(top = 16.dp)) {
                DangerButton(
                    text = if (deleting) "Deleting…" else "Delete",
                    loading = deleting,
                    enabled = !deleting,
                    modifier = Modifier.weight(1f),
                    onClick = {
                        deleting = true
                        scope.launch {
                            try {
                                apiClient.api().deleteMovie(job.id)
                                deleteTarget = null
                                load()
                            } catch (e: Exception) {
                                if (e.isUnauthorized()) onUnauthorized() else deleteError = e.message ?: "Couldn't delete"
                            } finally {
                                deleting = false
                            }
                        }
                    },
                )
                SecondaryButton(
                    text = "Cancel",
                    enabled = !deleting,
                    modifier = Modifier.padding(start = 8.dp).weight(1f),
                    onClick = { deleteTarget = null },
                )
            }
        }
    }
}

@Composable
private fun PosterTile(job: Job, prefs: PanelPrefs, onClick: () -> Unit, onEdit: () -> Unit, onDelete: () -> Unit) {
    Column(modifier = Modifier.clickable(onClick = onClick)) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .background(PanelTextMuted.copy(alpha = 0.08f), RoundedCornerShape(8.dp)),
        ) {
            val poster = job.poster
            if (!poster.isNullOrBlank()) {
                AuthAsyncImage(
                    url = prefs.absoluteUrl(poster),
                    prefs = prefs,
                    contentDescription = job.title,
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                Icon(Icons.Filled.Movie, contentDescription = null, tint = PanelTextMuted, modifier = Modifier.align(Alignment.Center).size(32.dp))
            }
            Icon(
                Icons.Filled.PlayArrow,
                contentDescription = null,
                tint = Color.White,
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(28.dp)
                    .background(Color.Black.copy(alpha = 0.45f), CircleShape)
                    .padding(4.dp),
            )
            Row(modifier = Modifier.align(Alignment.TopEnd).padding(4.dp)) {
                TileIconButton(Icons.Filled.Edit, "Edit", onEdit)
                TileIconButton(Icons.Filled.Delete, "Delete", onDelete, modifier = Modifier.padding(start = 4.dp))
            }
        }
        Text(
            job.title,
            style = MaterialTheme.typography.bodySmall,
            color = PanelTextPrimary,
            maxLines = 2,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

@Composable
private fun TileIconButton(icon: ImageVector, description: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(26.dp)
            .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(6.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = description, tint = Color.White, modifier = Modifier.size(14.dp))
    }
}

@Composable
private fun AddMovieDialog(apiClient: ApiClient, onDismiss: () -> Unit, onAdded: () -> Unit, onUnauthorized: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    var videoUri by remember { mutableStateOf<android.net.Uri?>(null) }
    var posterUri by remember { mutableStateOf<android.net.Uri?>(null) }
    var uploading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val videoPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { videoUri = it }
    val posterPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { posterUri = it }

    PanelDialog(title = "Add movie manually", onDismiss = { if (!uploading) onDismiss() }) {
        PanelTextField(value = title, onValueChange = { title = it }, label = "Title")
        SecondaryButton(
            text = videoUri?.let { resolveFileName(context, it) } ?: "Select video file",
            onClick = { videoPicker.launch("video/*") },
            enabled = !uploading,
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        )
        SecondaryButton(
            text = posterUri?.let { resolveFileName(context, it) } ?: "Select thumbnail (optional)",
            onClick = { posterPicker.launch("image/*") },
            enabled = !uploading,
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        )
        error?.let { ErrorText(it) }
        if (uploading) LoadingState()
        Row(modifier = Modifier.padding(top = 16.dp)) {
            PrimaryButton(
                text = if (uploading) "Uploading…" else "Add",
                loading = uploading,
                enabled = !uploading,
                modifier = Modifier.weight(1f),
                onClick = {
                    val video = videoUri
                    if (title.isBlank()) { error = "Please enter a title"; return@PrimaryButton }
                    if (video == null) { error = "Please select a video file"; return@PrimaryButton }
                    uploading = true
                    error = null
                    scope.launch {
                        try {
                            val titleBody = title.trim().toRequestBody("text/plain".toMediaTypeOrNull())
                            val videoPart = uriToMultipart(context, video, "file", "video/*")
                            val posterPart = posterUri?.let { uriToMultipart(context, it, "poster", "image/*") }
                            apiClient.api().addMovieManual(titleBody, videoPart, posterPart)
                            onAdded()
                        } catch (e: Exception) {
                            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Upload failed"
                        } finally {
                            uploading = false
                        }
                    }
                },
            )
            SecondaryButton(text = "Cancel", enabled = !uploading, modifier = Modifier.padding(start = 8.dp).weight(1f), onClick = onDismiss)
        }
    }
}

@Composable
private fun EditMovieDialog(job: Job, apiClient: ApiClient, onDismiss: () -> Unit, onSaved: () -> Unit, onUnauthorized: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf(job.title) }
    var posterUri by remember { mutableStateOf<android.net.Uri?>(null) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val posterPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { posterUri = it }

    PanelDialog(title = "Edit movie", onDismiss = { if (!saving) onDismiss() }) {
        PanelTextField(value = title, onValueChange = { title = it }, label = "Title")
        SecondaryButton(
            text = posterUri?.let { resolveFileName(context, it) } ?: "Replace thumbnail (optional)",
            onClick = { posterPicker.launch("image/*") },
            enabled = !saving,
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        )
        error?.let { ErrorText(it) }
        Row(modifier = Modifier.padding(top = 16.dp)) {
            PrimaryButton(
                text = if (saving) "Saving…" else "Save",
                loading = saving,
                enabled = !saving,
                modifier = Modifier.weight(1f),
                onClick = {
                    if (title.isBlank()) { error = "Please enter a title"; return@PrimaryButton }
                    saving = true
                    error = null
                    scope.launch {
                        try {
                            if (title.trim() != job.title) apiClient.api().renameMovie(job.id, MovieRenameRequest(title.trim()))
                            posterUri?.let { apiClient.api().updateMovieThumbnail(job.id, uriToMultipart(context, it, "file", "image/*")) }
                            onSaved()
                        } catch (e: Exception) {
                            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Couldn't save changes"
                        } finally {
                            saving = false
                        }
                    }
                },
            )
            SecondaryButton(text = "Cancel", enabled = !saving, modifier = Modifier.padding(start = 8.dp).weight(1f), onClick = onDismiss)
        }
    }
}

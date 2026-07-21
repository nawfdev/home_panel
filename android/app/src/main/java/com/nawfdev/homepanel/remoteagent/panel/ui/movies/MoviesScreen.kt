package com.nawfdev.homepanel.remoteagent.panel.ui.movies

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.DownloadOption
import com.nawfdev.homepanel.remoteagent.panel.data.Film
import com.nawfdev.homepanel.remoteagent.panel.data.Job
import com.nawfdev.homepanel.remoteagent.panel.data.MovieDetailRequest
import com.nawfdev.homepanel.remoteagent.panel.data.MovieSearchRequest
import com.nawfdev.homepanel.remoteagent.panel.data.MovieStartDownloadRequest
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized
import com.nawfdev.homepanel.remoteagent.panel.ui.components.EmptyState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.LoadingState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.Panel
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PanelTextField
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PrimaryButton
import com.nawfdev.homepanel.remoteagent.panel.ui.components.SecondaryButton
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelBg
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextMuted
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextPrimary
import kotlinx.coroutines.launch

/** Search + download-queue management. In-app playback of finished downloads
 * lives in the Stream tab (poster library + player), wired from the "Movies"
 * nav group alongside this screen. */
@Composable
fun MoviesScreen(apiClient: ApiClient, onUnauthorized: () -> Unit) {
    var tab by remember { mutableStateOf(0) }

    Column(modifier = Modifier.fillMaxSize()) {
        TabRow(
            selectedTabIndex = tab,
            containerColor = PanelBg,
            contentColor = PanelTextPrimary,
        ) {
            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Search") }, selectedContentColor = PanelTextPrimary, unselectedContentColor = PanelTextMuted)
            Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Downloads") }, selectedContentColor = PanelTextPrimary, unselectedContentColor = PanelTextMuted)
        }
        if (tab == 0) SearchTab(apiClient, onUnauthorized) else DownloadsTab(apiClient, onUnauthorized)
    }
}

@Composable
private fun SearchTab(apiClient: ApiClient, onUnauthorized: () -> Unit) {
    var query by remember { mutableStateOf("") }
    var films by remember { mutableStateOf<List<Film>>(emptyList()) }
    var selected by remember { mutableStateOf<Film?>(null) }
    var options by remember { mutableStateOf<List<DownloadOption>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun search() {
        loading = true
        error = null
        selected = null
        scope.launch {
            try {
                val res = apiClient.api().moviesSearch(MovieSearchRequest(query))
                if (res.success) films = res.films else error = res.error ?: "Search failed"
            } catch (e: Exception) {
                if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Search failed"
            } finally {
                loading = false
            }
        }
    }

    fun openDetail(film: Film) {
        selected = film
        loading = true
        scope.launch {
            try {
                val res = apiClient.api().movieDetail(MovieDetailRequest(film.detailUrl))
                if (res.success) options = res.options else error = res.error ?: "Failed to load options"
            } catch (e: Exception) {
                if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load options"
            } finally {
                loading = false
            }
        }
    }

    fun startDownload(option: DownloadOption) {
        val film = selected ?: return
        scope.launch {
            try {
                apiClient.api().startMovieDownload(MovieStartDownloadRequest(film.title, option.link, film.poster))
                selected = null
            } catch (e: Exception) {
                if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to start download"
            }
        }
    }

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        Row {
            PanelTextField(
                value = query,
                onValueChange = { query = it },
                label = "Search movies",
                modifier = Modifier.weight(1f),
            )
            SecondaryButton(text = "Go", onClick = ::search, modifier = Modifier.padding(start = 8.dp))
        }
        error?.let { ErrorText(it) }

        val film = selected
        if (film != null) {
            Text(film.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp))
            if (loading) {
                LoadingState()
            } else {
                options.forEach { option ->
                    Panel(
                        modifier = Modifier
                            .clickable { startDownload(option) }
                            .padding(top = 8.dp),
                    ) {
                        Text("${option.quality} · ${option.host}", style = MaterialTheme.typography.titleSmall)
                        Text(option.size, style = MaterialTheme.typography.bodySmall, color = PanelTextMuted, modifier = Modifier.padding(top = 2.dp))
                    }
                }
            }
        } else if (loading) {
            LoadingState()
        } else {
            LazyColumn(modifier = Modifier.padding(top = 12.dp)) {
                items(films, key = { it.detailUrl }) { f ->
                    Panel(
                        modifier = Modifier
                            .clickable { openDetail(f) }
                            .padding(bottom = 8.dp),
                    ) {
                        Text(f.title, style = MaterialTheme.typography.titleSmall)
                        Text(f.year, style = MaterialTheme.typography.bodySmall, color = PanelTextMuted, modifier = Modifier.padding(top = 2.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun DownloadsTab(apiClient: ApiClient, onUnauthorized: () -> Unit) {
    var jobs by remember { mutableStateOf<List<Job>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun reload() {
        try {
            jobs = apiClient.api().listDownloads().jobs
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load downloads"
        }
    }

    LaunchedEffect(Unit) { reload() }

    fun act(block: suspend () -> Unit) {
        scope.launch {
            try {
                block()
                reload()
            } catch (e: Exception) {
                if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Action failed"
            }
        }
    }

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        error?.let { ErrorText(it) }
        if (jobs.isEmpty()) {
            EmptyState("No downloads yet")
        } else {
            LazyColumn {
                items(jobs, key = { it.id }) { job ->
                    Panel(modifier = Modifier.padding(top = 8.dp)) {
                        Text(job.title, style = MaterialTheme.typography.titleSmall)
                        Text(job.status, style = MaterialTheme.typography.bodySmall, color = PanelTextMuted, modifier = Modifier.padding(top = 2.dp))
                        if (job.total > 0) {
                            LinearProgressIndicator(
                                progress = { (job.downloaded.toFloat() / job.total.toFloat()).coerceIn(0f, 1f) },
                                color = PanelTextPrimary,
                                trackColor = PanelTextMuted.copy(alpha = 0.2f),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 8.dp),
                            )
                        }
                        Row(modifier = Modifier.padding(top = 10.dp)) {
                            if (job.status == "paused") {
                                SecondaryButton(text = "Resume", onClick = { act { apiClient.api().resumeDownload(job.id) } })
                            } else if (job.status == "downloading") {
                                SecondaryButton(text = "Pause", onClick = { act { apiClient.api().pauseDownload(job.id) } })
                            }
                            SecondaryButton(
                                text = "Cancel",
                                onClick = { act { apiClient.api().cancelDownload(job.id) } },
                                modifier = Modifier.padding(start = 8.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

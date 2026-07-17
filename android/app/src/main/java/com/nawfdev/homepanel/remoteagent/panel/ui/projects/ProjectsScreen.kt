package com.nawfdev.homepanel.remoteagent.panel.ui.projects

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.unit.dp
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.Project
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized
import kotlinx.coroutines.launch

@Composable
fun ProjectsScreen(apiClient: ApiClient, onUnauthorized: () -> Unit) {
    var projects by remember { mutableStateOf<List<Project>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busyId by remember { mutableStateOf<Int?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun reload() {
        try {
            projects = apiClient.api().listProjects()
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load projects"
        }
    }

    LaunchedEffect(Unit) { reload() }

    fun act(id: Int, action: suspend () -> Unit) {
        busyId = id
        scope.launch {
            try {
                action()
                reload()
            } catch (e: Exception) {
                if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Action failed"
            } finally {
                busyId = null
            }
        }
    }

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        Text("Projects", style = MaterialTheme.typography.headlineSmall)

        val current = projects
        when {
            error != null -> Text(error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 16.dp))
            current == null -> CircularProgressIndicator(modifier = Modifier.padding(top = 24.dp))
            current.isEmpty() -> Text("No projects", color = MaterialTheme.colorScheme.secondary, modifier = Modifier.padding(top = 16.dp))
            else -> LazyColumn(modifier = Modifier.padding(top = 12.dp)) {
                items(current, key = { it.id }) { project ->
                    Card(modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 8.dp)) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(project.name, style = MaterialTheme.typography.titleSmall)
                            Text(
                                "${project.status} · port ${project.port}${if (project.domain.isNotBlank()) " · ${project.domain}" else ""}",
                                style = MaterialTheme.typography.bodySmall,
                                color = if (project.status == "running") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary,
                            )
                            Row(
                                modifier = Modifier.padding(top = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                val busy = busyId == project.id
                                if (project.status == "running") {
                                    OutlinedButton(onClick = { act(project.id) { apiClient.api().stopProject(project.id) } }, enabled = !busy) {
                                        Text("Stop")
                                    }
                                } else {
                                    OutlinedButton(onClick = { act(project.id) { apiClient.api().startProject(project.id) } }, enabled = !busy) {
                                        Text("Start")
                                    }
                                }
                                OutlinedButton(
                                    onClick = { act(project.id) { apiClient.api().restartProject(project.id) } },
                                    enabled = !busy,
                                    modifier = Modifier.padding(start = 8.dp),
                                ) {
                                    Text("Restart")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

package com.nawfdev.homepanel.remoteagent.panel.ui.docker

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.unit.dp
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.DockerContainer
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized
import com.nawfdev.homepanel.remoteagent.panel.ui.components.EmptyState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.LoadingState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.Panel
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PillTone
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ScreenHeader
import com.nawfdev.homepanel.remoteagent.panel.ui.components.SecondaryButton
import com.nawfdev.homepanel.remoteagent.panel.ui.components.StatusPill
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextMuted
import kotlinx.coroutines.launch

@Composable
fun DockerScreen(apiClient: ApiClient, onUnauthorized: () -> Unit) {
    var containers by remember { mutableStateOf<List<DockerContainer>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busyId by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun reload() {
        try {
            val res = apiClient.api().dockerContainers()
            if (res.success) containers = res.containers else error = res.error ?: "Failed to load containers"
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load containers"
        }
    }

    LaunchedEffect(Unit) { reload() }

    fun act(id: String, action: suspend () -> Unit) {
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
        ScreenHeader("Docker")

        val current = containers
        when {
            error != null -> ErrorText(error!!)
            current == null -> LoadingState()
            current.isEmpty() -> EmptyState("No containers")
            else -> LazyColumn(modifier = Modifier.padding(top = 16.dp)) {
                items(current, key = { it.id }) { c ->
                    val busy = busyId == c.id
                    Panel(modifier = Modifier.padding(bottom = 10.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column {
                                Text(c.name, style = MaterialTheme.typography.titleMedium)
                                Text(
                                    "${c.image} · ${c.status}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = PanelTextMuted,
                                    modifier = Modifier.padding(top = 2.dp),
                                )
                            }
                            StatusPill(
                                c.state,
                                if (c.state == "running") PillTone.Success else PillTone.Neutral,
                            )
                        }
                        Row(modifier = Modifier.padding(top = 12.dp)) {
                            if (c.state == "running") {
                                SecondaryButton(text = "Stop", onClick = { act(c.id) { apiClient.api().dockerStop(c.id) } }, enabled = !busy)
                            } else {
                                SecondaryButton(text = "Start", onClick = { act(c.id) { apiClient.api().dockerStart(c.id) } }, enabled = !busy)
                            }
                            SecondaryButton(
                                text = "Restart",
                                onClick = { act(c.id) { apiClient.api().dockerRestart(c.id) } },
                                enabled = !busy,
                                modifier = Modifier.padding(start = 8.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

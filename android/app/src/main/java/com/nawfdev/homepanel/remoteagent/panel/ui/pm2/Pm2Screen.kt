package com.nawfdev.homepanel.remoteagent.panel.ui.pm2

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
import com.nawfdev.homepanel.remoteagent.panel.data.Pm2Process
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
fun Pm2Screen(apiClient: ApiClient, onUnauthorized: () -> Unit) {
    var processes by remember { mutableStateOf<List<Pm2Process>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busyName by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun reload() {
        try {
            val res = apiClient.api().pm2Processes()
            if (res.success) processes = res.processes else error = res.error ?: "Failed to load processes"
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load processes"
        }
    }

    LaunchedEffect(Unit) { reload() }

    fun act(name: String, action: suspend () -> Unit) {
        busyName = name
        scope.launch {
            try {
                action()
                reload()
            } catch (e: Exception) {
                if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Action failed"
            } finally {
                busyName = null
            }
        }
    }

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        ScreenHeader("PM2")

        val current = processes
        when {
            error != null -> ErrorText(error!!)
            current == null -> LoadingState()
            current.isEmpty() -> EmptyState("No PM2 processes")
            else -> LazyColumn(modifier = Modifier.padding(top = 16.dp)) {
                items(current, key = { it.name }) { proc ->
                    val busy = busyName == proc.name
                    Panel(modifier = Modifier.padding(bottom = 10.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column {
                                Text(proc.name, style = MaterialTheme.typography.titleMedium)
                                Text(
                                    "${proc.restarts} restarts · up ${proc.uptime}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = PanelTextMuted,
                                    modifier = Modifier.padding(top = 2.dp),
                                )
                            }
                            StatusPill(
                                proc.status,
                                if (proc.status == "online") PillTone.Success else PillTone.Neutral,
                            )
                        }
                        Row(modifier = Modifier.padding(top = 12.dp)) {
                            if (proc.status == "online") {
                                SecondaryButton(text = "Stop", onClick = { act(proc.name) { apiClient.api().pm2Stop(proc.name) } }, enabled = !busy)
                            } else {
                                SecondaryButton(text = "Start", onClick = { act(proc.name) { apiClient.api().pm2Start(proc.name) } }, enabled = !busy)
                            }
                            SecondaryButton(
                                text = "Restart",
                                onClick = { act(proc.name) { apiClient.api().pm2Restart(proc.name) } },
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

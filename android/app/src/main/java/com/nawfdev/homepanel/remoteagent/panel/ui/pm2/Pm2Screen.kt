package com.nawfdev.homepanel.remoteagent.panel.ui.pm2

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
import com.nawfdev.homepanel.remoteagent.panel.data.Pm2Process
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized
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
        Text("PM2", style = MaterialTheme.typography.headlineSmall)

        val current = processes
        when {
            error != null -> Text(error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 16.dp))
            current == null -> CircularProgressIndicator(modifier = Modifier.padding(top = 24.dp))
            current.isEmpty() -> Text("No PM2 processes", color = MaterialTheme.colorScheme.secondary, modifier = Modifier.padding(top = 16.dp))
            else -> LazyColumn(modifier = Modifier.padding(top = 12.dp)) {
                items(current, key = { it.name }) { proc ->
                    Card(modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 8.dp)) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(proc.name, style = MaterialTheme.typography.titleSmall)
                            Text(
                                "${proc.status} · ${proc.restarts} restarts · up ${proc.uptime}",
                                style = MaterialTheme.typography.bodySmall,
                                color = if (proc.status == "online") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary,
                            )
                            Row(
                                modifier = Modifier.padding(top = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                val busy = busyName == proc.name
                                if (proc.status == "online") {
                                    OutlinedButton(onClick = { act(proc.name) { apiClient.api().pm2Stop(proc.name) } }, enabled = !busy) {
                                        Text("Stop")
                                    }
                                } else {
                                    OutlinedButton(onClick = { act(proc.name) { apiClient.api().pm2Start(proc.name) } }, enabled = !busy) {
                                        Text("Start")
                                    }
                                }
                                OutlinedButton(
                                    onClick = { act(proc.name) { apiClient.api().pm2Restart(proc.name) } },
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

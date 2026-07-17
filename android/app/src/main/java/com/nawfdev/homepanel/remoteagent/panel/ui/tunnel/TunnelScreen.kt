package com.nawfdev.homepanel.remoteagent.panel.ui.tunnel

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.TunnelStatus
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized

@Composable
fun TunnelScreen(apiClient: ApiClient, onUnauthorized: () -> Unit) {
    var status by remember { mutableStateOf<TunnelStatus?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            status = apiClient.api().tunnelStatus()
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load tunnel status"
        }
    }

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        Text("Tunnel", style = MaterialTheme.typography.headlineSmall)

        val current = status
        when {
            error != null -> Text(error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 16.dp))
            current == null -> CircularProgressIndicator(modifier = Modifier.padding(top = 24.dp))
            else -> {
                InfoCard("Status", if (current.processRunning) "Running" else "Stopped")
                InfoCard("Ready", if (current.isReady) "Yes" else "No")
                InfoCard("Auto-restart", if (current.autoRestart) "Enabled" else "Disabled")
                InfoCard("Restart count", current.restartCount.toString())
                current.pid?.let { InfoCard("PID", it.toString()) }
                InfoCard(
                    "cloudflared",
                    if (current.cloudflared.installed) "Installed (${current.cloudflared.version ?: "unknown version"})" else "Not installed",
                )
            }
        }
    }
}

@Composable
private fun InfoCard(label: String, value: String) {
    Card(modifier = Modifier
        .fillMaxWidth()
        .padding(top = 12.dp)) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary)
            Text(value, style = MaterialTheme.typography.titleMedium)
        }
    }
}

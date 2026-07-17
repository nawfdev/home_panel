package com.nawfdev.homepanel.remoteagent.panel.ui.dashboard

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
import com.nawfdev.homepanel.remoteagent.panel.data.DashboardResponse
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized
import kotlin.math.roundToInt

@Composable
fun DashboardScreen(apiClient: ApiClient, onUnauthorized: () -> Unit) {
    var data by remember { mutableStateOf<DashboardResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            data = apiClient.api().dashboard()
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load dashboard"
        }
    }

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        Text("Dashboard", style = MaterialTheme.typography.headlineSmall)

        val current = data
        when {
            error != null -> Text(error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 16.dp))
            current == null -> CircularProgressIndicator(modifier = Modifier.padding(top = 24.dp))
            else -> {
                StatCard("Host", current.system.os.hostname.ifBlank { "-" })
                StatCard("CPU", "${current.system.cpu.usage.roundToInt()}% (${current.system.cpu.cores} cores)")
                StatCard(
                    "Memory",
                    "${current.system.memory.usagePercent.roundToInt()}% used " +
                        "(${bytesToGb(current.system.memory.used)} / ${bytesToGb(current.system.memory.total)} GB)",
                )
                StatCard("Uptime", formatUptime(current.system.uptime))
                StatCard("Tunnel", if (current.tunnel.processRunning) "Running" else if (current.tunnel.configured) "Stopped" else "Not configured")
                StatCard("Projects", "${current.projects.running} running / ${current.projects.total} total")
            }
        }
    }
}

@Composable
private fun StatCard(label: String, value: String) {
    Card(modifier = Modifier
        .fillMaxWidth()
        .padding(top = 12.dp)) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary)
            Text(value, style = MaterialTheme.typography.titleMedium)
        }
    }
}

private fun bytesToGb(bytes: Long): String = "%.1f".format(bytes / 1024.0 / 1024.0 / 1024.0)

private fun formatUptime(seconds: Long): String {
    val days = seconds / 86400
    val hours = (seconds % 86400) / 3600
    return if (days > 0) "${days}d ${hours}h" else "${hours}h ${(seconds % 3600) / 60}m"
}

package com.nawfdev.homepanel.remoteagent.panel.ui.dashboard

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
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
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.InfoRow
import com.nawfdev.homepanel.remoteagent.panel.ui.components.LoadingState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.MetricStrip
import com.nawfdev.homepanel.remoteagent.panel.ui.components.Panel
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ScreenHeader
import com.nawfdev.homepanel.remoteagent.panel.ui.components.SectionLabel
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

    val current = data
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
    ) {
        item { ScreenHeader("Dashboard", "Live status of this machine") }

        when {
            error != null -> item { ErrorText(error!!) }
            current == null -> item { LoadingState() }
            else -> {
                item {
                    MetricStrip(
                        items = listOf(
                            "CPU" to "${current.system.cpu.usage.roundToInt()}%",
                            "Memory" to "${current.system.memory.usagePercent.roundToInt()}%",
                            "Uptime" to formatUptime(current.system.uptime),
                        ),
                        modifier = Modifier.padding(top = 16.dp),
                    )
                }
                item {
                    Column(modifier = Modifier.padding(top = 20.dp)) {
                        SectionLabel("System")
                        Panel {
                            InfoRow("Host", current.system.os.hostname.ifBlank { "-" })
                            InfoRow(
                                "CPU",
                                "${current.system.cpu.usage.roundToInt()}% · ${current.system.cpu.cores} cores",
                            )
                            InfoRow(
                                "Memory",
                                "${bytesToGb(current.system.memory.used)} / ${bytesToGb(current.system.memory.total)} GB",
                            )
                            InfoRow("Uptime", formatUptime(current.system.uptime), showDivider = false)
                        }
                    }
                }
                item {
                    Column(modifier = Modifier.padding(top = 20.dp)) {
                        SectionLabel("Services")
                        Panel {
                            InfoRow(
                                "Tunnel",
                                if (current.tunnel.processRunning) "Running" else if (current.tunnel.configured) "Stopped" else "Not configured",
                            )
                            InfoRow("Projects", "${current.projects.running} running / ${current.projects.total} total", showDivider = false)
                        }
                    }
                }
            }
        }
    }
}

private fun bytesToGb(bytes: Long): String = "%.1f".format(bytes / 1024.0 / 1024.0 / 1024.0)

private fun formatUptime(seconds: Long): String {
    val days = seconds / 86400
    val hours = (seconds % 86400) / 3600
    return if (days > 0) "${days}d ${hours}h" else "${hours}h ${(seconds % 3600) / 60}m"
}

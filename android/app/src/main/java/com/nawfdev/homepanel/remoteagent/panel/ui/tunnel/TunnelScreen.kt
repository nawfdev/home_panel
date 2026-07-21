package com.nawfdev.homepanel.remoteagent.panel.ui.tunnel

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
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
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.InfoRow
import com.nawfdev.homepanel.remoteagent.panel.ui.components.LoadingState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.Panel
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PillTone
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ScreenHeader
import com.nawfdev.homepanel.remoteagent.panel.ui.components.StatusPill

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
        ScreenHeader("Tunnel")

        val current = status
        when {
            error != null -> ErrorText(error!!)
            current == null -> LoadingState()
            else -> Panel(modifier = Modifier.padding(top = 16.dp)) {
                InfoRow("Status", "") {
                    StatusPill(
                        if (current.processRunning) "Running" else "Stopped",
                        if (current.processRunning) PillTone.Success else PillTone.Neutral,
                    )
                }
                InfoRow("Ready", if (current.isReady) "Yes" else "No")
                InfoRow("Auto-restart", if (current.autoRestart) "Enabled" else "Disabled")
                InfoRow("Restart count", current.restartCount.toString())
                current.pid?.let { InfoRow("PID", it.toString()) }
                InfoRow(
                    "cloudflared",
                    if (current.cloudflared.installed) "Installed (${current.cloudflared.version ?: "unknown version"})" else "Not installed",
                    showDivider = false,
                )
            }
        }
    }
}

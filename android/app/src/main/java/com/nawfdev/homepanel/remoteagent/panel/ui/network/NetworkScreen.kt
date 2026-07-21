package com.nawfdev.homepanel.remoteagent.panel.ui.network

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
import com.nawfdev.homepanel.remoteagent.panel.data.NetworkInfo
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.InfoRow
import com.nawfdev.homepanel.remoteagent.panel.ui.components.LoadingState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.Panel
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PillTone
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ScreenHeader
import com.nawfdev.homepanel.remoteagent.panel.ui.components.StatusPill

@Composable
fun NetworkScreen(apiClient: ApiClient, onUnauthorized: () -> Unit) {
    var info by remember { mutableStateOf<NetworkInfo?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            val res = apiClient.api().networkInfo()
            if (res.success) info = res.network else error = "Failed to load network info"
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load network info"
        }
    }

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        ScreenHeader("Network")

        val current = info
        when {
            error != null -> ErrorText(error!!)
            current == null -> LoadingState()
            else -> {
                Panel(modifier = Modifier.padding(top = 16.dp)) {
                    InfoRow("Connectivity", "") {
                        StatusPill(
                            if (current.connectivity) "Online" else "Offline",
                            if (current.connectivity) PillTone.Success else PillTone.Danger,
                        )
                    }
                    InfoRow("Public IP", current.publicIp.ifBlank { "-" })
                    InfoRow("Gateway", current.gateway ?: "-")
                    InfoRow("Active TCP connections", current.connections.toString(), showDivider = false)
                }
                if (current.interfaces.isNotEmpty()) {
                    Panel(modifier = Modifier.padding(top = 16.dp)) {
                        current.interfaces.forEachIndexed { index, iface ->
                            InfoRow(
                                iface.name,
                                listOfNotNull(iface.ip4, iface.ip6).ifEmpty { listOf("-") }.joinToString(", "),
                                showDivider = index != current.interfaces.lastIndex,
                            )
                        }
                    }
                }
            }
        }
    }
}

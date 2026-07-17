package com.nawfdev.homepanel.remoteagent.panel.ui.network

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
import com.nawfdev.homepanel.remoteagent.panel.data.NetworkInfo
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized

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
        Text("Network", style = MaterialTheme.typography.headlineSmall)

        val current = info
        when {
            error != null -> Text(error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 16.dp))
            current == null -> CircularProgressIndicator(modifier = Modifier.padding(top = 24.dp))
            else -> {
                InfoCard("Public IP", current.publicIp.ifBlank { "-" })
                InfoCard("Connectivity", if (current.connectivity) "Online" else "Offline")
                InfoCard("Gateway", current.gateway ?: "-")
                InfoCard("Active TCP connections", current.connections.toString())
                current.interfaces.forEach { iface ->
                    InfoCard(iface.name, listOfNotNull(iface.ip4, iface.ip6).ifEmpty { listOf("-") }.joinToString(", "))
                }
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

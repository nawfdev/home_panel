package com.nawfdev.homepanel.remoteagent.panel.ui.aigateway

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
import com.nawfdev.homepanel.remoteagent.panel.data.AiProviderView
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized

@Composable
fun AiGatewayScreen(apiClient: ApiClient, onUnauthorized: () -> Unit) {
    var providers by remember { mutableStateOf<List<AiProviderView>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            val res = apiClient.api().aiGatewayProviders()
            if (res.success) providers = res.providers else error = "Failed to load providers"
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load providers"
        }
    }

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        Text("AI Gateway", style = MaterialTheme.typography.headlineSmall)

        val current = providers
        when {
            error != null -> Text(error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 16.dp))
            current == null -> CircularProgressIndicator(modifier = Modifier.padding(top = 24.dp))
            current.isEmpty() -> Text("No providers configured", color = MaterialTheme.colorScheme.secondary, modifier = Modifier.padding(top = 16.dp))
            else -> current.forEach { provider ->
                Card(modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp)) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(provider.name, style = MaterialTheme.typography.titleSmall)
                        Text(
                            "${provider.kind} · ${provider.keys.size} key(s) · ${if (provider.enabled) "enabled" else "disabled"}",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (provider.enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary,
                        )
                    }
                }
            }
        }
    }
}

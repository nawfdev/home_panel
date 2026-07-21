package com.nawfdev.homepanel.remoteagent.panel.ui.aigateway

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.nawfdev.homepanel.remoteagent.panel.data.AiProviderView
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized
import com.nawfdev.homepanel.remoteagent.panel.ui.components.EmptyState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.LoadingState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.Panel
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PillTone
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ScreenHeader
import com.nawfdev.homepanel.remoteagent.panel.ui.components.StatusPill
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextMuted

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
        ScreenHeader("AI Gateway")

        val current = providers
        when {
            error != null -> ErrorText(error!!)
            current == null -> LoadingState()
            current.isEmpty() -> EmptyState("No providers configured")
            else -> current.forEach { provider ->
                Panel(modifier = Modifier.padding(top = 16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column {
                            Text(provider.name, style = MaterialTheme.typography.titleMedium)
                            Text(
                                "${provider.kind} · ${provider.keys.size} key(s)",
                                style = MaterialTheme.typography.bodySmall,
                                color = PanelTextMuted,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                        StatusPill(
                            if (provider.enabled) "Enabled" else "Disabled",
                            if (provider.enabled) PillTone.Success else PillTone.Neutral,
                        )
                    }
                }
            }
        }
    }
}

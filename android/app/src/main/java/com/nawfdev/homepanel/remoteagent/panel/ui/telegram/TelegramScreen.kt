package com.nawfdev.homepanel.remoteagent.panel.ui.telegram

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
import com.nawfdev.homepanel.remoteagent.panel.data.TelegramStatus
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.InfoRow
import com.nawfdev.homepanel.remoteagent.panel.ui.components.LoadingState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.Panel
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PillTone
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ScreenHeader
import com.nawfdev.homepanel.remoteagent.panel.ui.components.StatusPill

@Composable
fun TelegramScreen(apiClient: ApiClient, onUnauthorized: () -> Unit) {
    var status by remember { mutableStateOf<TelegramStatus?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            status = apiClient.api().telegramStatus()
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load Telegram status"
        }
    }

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        ScreenHeader("Telegram")

        val current = status
        when {
            error != null -> ErrorText(error!!)
            current == null -> LoadingState()
            else -> Panel(modifier = Modifier.padding(top = 16.dp)) {
                InfoRow("Connected", "") {
                    StatusPill(
                        if (current.connected) "Yes" else "No",
                        if (current.connected) PillTone.Success else PillTone.Danger,
                    )
                }
                InfoRow("Configured", if (current.configured) "Yes" else "No")
                InfoRow("Notifications", if (current.notificationsEnabled) "Enabled" else "Disabled")
                InfoRow("Monitoring", if (current.monitoring) "Active" else "Inactive", showDivider = current.chatId != null)
                current.chatId?.let { InfoRow("Chat ID", it, showDivider = false) }
            }
        }
    }
}

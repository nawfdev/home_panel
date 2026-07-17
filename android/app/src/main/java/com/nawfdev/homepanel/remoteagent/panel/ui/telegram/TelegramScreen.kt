package com.nawfdev.homepanel.remoteagent.panel.ui.telegram

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
import com.nawfdev.homepanel.remoteagent.panel.data.TelegramStatus
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized

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
        Text("Telegram", style = MaterialTheme.typography.headlineSmall)

        val current = status
        when {
            error != null -> Text(error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 16.dp))
            current == null -> CircularProgressIndicator(modifier = Modifier.padding(top = 24.dp))
            else -> {
                InfoCard("Configured", if (current.configured) "Yes" else "No")
                InfoCard("Connected", if (current.connected) "Yes" else "No")
                InfoCard("Notifications", if (current.notificationsEnabled) "Enabled" else "Disabled")
                InfoCard("Monitoring", if (current.monitoring) "Active" else "Inactive")
                current.chatId?.let { InfoCard("Chat ID", it) }
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

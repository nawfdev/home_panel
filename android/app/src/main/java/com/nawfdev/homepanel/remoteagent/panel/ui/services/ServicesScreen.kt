package com.nawfdev.homepanel.remoteagent.panel.ui.services

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.ServiceInfo
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized
import com.nawfdev.homepanel.remoteagent.panel.ui.components.EmptyState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.LoadingState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.Panel
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PillTone
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ScreenHeader
import com.nawfdev.homepanel.remoteagent.panel.ui.components.SecondaryButton
import com.nawfdev.homepanel.remoteagent.panel.ui.components.StatusPill
import kotlinx.coroutines.launch

@Composable
fun ServicesScreen(apiClient: ApiClient, onUnauthorized: () -> Unit) {
    var services by remember { mutableStateOf<List<ServiceInfo>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busyName by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun reload() {
        try {
            val res = apiClient.api().services()
            if (res.success) services = res.services else error = res.error ?: "Failed to load services"
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load services"
        }
    }

    LaunchedEffect(Unit) { reload() }

    fun toggle(service: ServiceInfo) {
        busyName = service.name
        scope.launch {
            try {
                if (service.status == "running") apiClient.api().stopService(service.name) else apiClient.api().startService(service.name)
                reload()
            } catch (e: Exception) {
                if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Action failed"
            } finally {
                busyName = null
            }
        }
    }

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        ScreenHeader("Services")

        val current = services
        when {
            error != null -> ErrorText(error!!)
            current == null -> LoadingState()
            current.isEmpty() -> EmptyState("No services found")
            else -> LazyColumn(modifier = Modifier.padding(top = 16.dp)) {
                items(current, key = { it.name }) { service ->
                    Panel(modifier = Modifier.padding(bottom = 10.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column {
                                Text(service.name, style = MaterialTheme.typography.titleMedium)
                                StatusPill(
                                    if (service.status == "running") "Running" else service.status,
                                    if (service.status == "running") PillTone.Success else PillTone.Neutral,
                                    modifier = Modifier.padding(top = 6.dp),
                                )
                            }
                            SecondaryButton(
                                text = if (service.status == "running") "Stop" else "Start",
                                onClick = { toggle(service) },
                                enabled = busyName != service.name,
                                loading = busyName == service.name,
                            )
                        }
                    }
                }
            }
        }
    }
}

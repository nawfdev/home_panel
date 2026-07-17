package com.nawfdev.homepanel.remoteagent.panel.ui.services

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
        Text("Services", style = MaterialTheme.typography.headlineSmall)

        val current = services
        when {
            error != null -> Text(error!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 16.dp))
            current == null -> CircularProgressIndicator(modifier = Modifier.padding(top = 24.dp))
            else -> LazyColumn(modifier = Modifier.padding(top = 12.dp)) {
                items(current, key = { it.name }) { service ->
                    Card(modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 8.dp)) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(service.name, style = MaterialTheme.typography.titleSmall)
                                Text(
                                    service.status,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (service.status == "running") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary,
                                )
                            }
                            OutlinedButton(onClick = { toggle(service) }, enabled = busyName != service.name) {
                                Text(if (service.status == "running") "Stop" else "Start")
                            }
                        }
                    }
                }
            }
        }
    }
}

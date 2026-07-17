package com.nawfdev.homepanel.remoteagent.panel.ui.remotedesktop

import android.content.Intent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.nawfdev.homepanel.remoteagent.DeviceStore
import com.nawfdev.homepanel.remoteagent.MainActivity as RemoteAgentActivity

/**
 * Thin wrapper around the existing, unmodified remote-desktop viewer
 * (com.nawfdev.homepanel.remoteagent.MainActivity) — this screen previews
 * saved devices and hands off to that Activity, which still owns its own
 * New Connection / History UI and the touch/cursor/audio viewer itself.
 */
@Composable
fun RemoteDesktopScreen() {
    val context = LocalContext.current
    val devices = remember(context) { DeviceStore(context).list() }

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        Text("Remote Desktop", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Control a saved LAN device, or add a new one.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.secondary,
        )

        if (devices.isNotEmpty()) {
            LazyColumn(modifier = Modifier.padding(top = 16.dp)) {
                items(devices) { device ->
                    Card(modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 8.dp)) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(device.name, style = MaterialTheme.typography.titleSmall)
                            Text(
                                "${device.host}:${device.port}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.secondary,
                            )
                        }
                    }
                }
            }
        }

        Button(
            onClick = { context.startActivity(Intent(context, RemoteAgentActivity::class.java)) },
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 16.dp),
        ) {
            Text("Open Remote Desktop")
        }
    }
}

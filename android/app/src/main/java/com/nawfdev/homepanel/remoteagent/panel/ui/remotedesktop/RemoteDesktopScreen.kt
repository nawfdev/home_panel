package com.nawfdev.homepanel.remoteagent.panel.ui.remotedesktop

import android.content.Intent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.nawfdev.homepanel.remoteagent.DeviceStore
import com.nawfdev.homepanel.remoteagent.MainActivity as RemoteAgentActivity
import com.nawfdev.homepanel.remoteagent.panel.ui.components.Panel
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PrimaryButton
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ScreenHeader
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextMuted

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
        ScreenHeader("Remote Desktop", "Control a saved LAN device, or add a new one")

        if (devices.isNotEmpty()) {
            LazyColumn(modifier = Modifier.padding(top = 16.dp)) {
                items(devices) { device ->
                    Panel(modifier = Modifier.padding(bottom = 10.dp)) {
                        Text(device.name, style = MaterialTheme.typography.titleMedium)
                        Text(
                            "${device.host}:${device.port}",
                            style = MaterialTheme.typography.bodySmall,
                            color = PanelTextMuted,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                }
            }
        }

        PrimaryButton(
            text = "Open Remote Desktop",
            onClick = { context.startActivity(Intent(context, RemoteAgentActivity::class.java)) },
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 16.dp),
        )
    }
}

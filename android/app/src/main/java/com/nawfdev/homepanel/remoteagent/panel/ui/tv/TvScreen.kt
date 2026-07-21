package com.nawfdev.homepanel.remoteagent.panel.ui.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material3.Icon
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
import coil.compose.AsyncImage
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.Channel
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized
import com.nawfdev.homepanel.remoteagent.panel.ui.components.EmptyState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.LoadingState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.Panel
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PanelTextField
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ScreenHeader
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextMuted
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextPrimary

/** Channel list — parity with fe/src/pages/TV.tsx. Channel logos come from
 * the source M3U playlist (public URLs, not behind our backend auth), so a
 * plain (unauthenticated) Coil AsyncImage is enough here — playback URLs
 * are a different story, see TvPlayerScreen. */
@Composable
fun TvScreen(apiClient: ApiClient, onUnauthorized: () -> Unit, onOpenChannel: (String) -> Unit) {
    var channels by remember { mutableStateOf<List<Channel>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        try {
            val res = apiClient.api().tvChannels()
            if (res.success) channels = res.channels else error = "Failed to load channels"
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load channels"
        }
    }

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        ScreenHeader("Live TV")

        val current = channels
        when {
            error != null -> ErrorText(error!!)
            current == null -> LoadingState()
            current.isEmpty() -> EmptyState("No channels available")
            else -> {
                PanelTextField(value = query, onValueChange = { query = it }, label = "Search channels", modifier = Modifier.padding(top = 16.dp))
                val filtered = if (query.isBlank()) current else current.filter { it.name.contains(query, ignoreCase = true) || it.group?.contains(query, ignoreCase = true) == true }
                if (filtered.isEmpty()) {
                    EmptyState("No channels match \"$query\"")
                } else {
                    LazyColumn(modifier = Modifier.padding(top = 12.dp)) {
                        items(filtered, key = { it.id }) { channel ->
                            Panel(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { onOpenChannel(channel.id) }
                                    .padding(bottom = 8.dp),
                                padding = 10.dp,
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    ChannelLogo(channel)
                                    Column(modifier = Modifier.padding(start = 12.dp)) {
                                        Text(channel.name, style = MaterialTheme.typography.titleSmall, color = PanelTextPrimary)
                                        if (!channel.group.isNullOrBlank()) {
                                            Text(channel.group, style = MaterialTheme.typography.bodySmall, color = PanelTextMuted, modifier = Modifier.padding(top = 2.dp))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ChannelLogo(channel: Channel) {
    if (!channel.logo.isNullOrBlank()) {
        AsyncImage(
            model = channel.logo,
            contentDescription = channel.name,
            modifier = Modifier
                .size(40.dp)
                .background(PanelTextMuted.copy(alpha = 0.08f), RoundedCornerShape(6.dp)),
        )
    } else {
        Column(
            modifier = Modifier
                .size(40.dp)
                .background(PanelTextMuted.copy(alpha = 0.08f), RoundedCornerShape(6.dp)),
        ) {
            Icon(Icons.Filled.LiveTv, contentDescription = null, tint = PanelTextMuted, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 8.dp))
        }
    }
}

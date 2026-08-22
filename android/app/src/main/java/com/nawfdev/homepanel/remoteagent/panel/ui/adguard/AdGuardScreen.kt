package com.nawfdev.homepanel.remoteagent.panel.ui.adguard

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.QueryStats
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nawfdev.homepanel.remoteagent.panel.data.AdGuardStats
import com.nawfdev.homepanel.remoteagent.panel.data.AdGuardStatus
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.ProtectionRequest
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PanelCard
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelBg
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelStatusGreen
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelStatusGreenBg
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelStatusRed
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelStatusRedBg
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextFaint
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextMuted
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextPrimary
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextSecondary
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun AdGuardScreen(apiClient: ApiClient) {
    var status by remember { mutableStateOf<AdGuardStatus?>(null) }
    var stats by remember { mutableStateOf<AdGuardStats?>(null) }
    var loading by remember { mutableStateOf(true) }
    var toggling by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun loadData() {
        scope.launch {
            try {
                val api = apiClient.api()
                status = api.getAdGuardStatus()
                stats = api.getAdGuardStats()
                error = null
            } catch (e: Exception) {
                error = e.message ?: "Failed to load AdGuard Home data"
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(Unit) {
        loadData()
        while (true) {
            delay(10000)
            try {
                val api = apiClient.api()
                status = api.getAdGuardStatus()
                stats = api.getAdGuardStats()
            } catch (_: Exception) {}
        }
    }

    fun toggleProtection(target: Boolean) {
        if (toggling) return
        toggling = true
        scope.launch {
            try {
                apiClient.api().setAdGuardProtection(ProtectionRequest(target))
                status = status?.copy(protectionEnabled = target)
            } catch (e: Exception) {
                error = e.message ?: "Failed to change protection status"
            } finally {
                toggling = false
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(PanelBg)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        error?.let { ErrorText(it) }

        if (loading && status == null) {
            Box(modifier = Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Color.White)
            }
        } else {
            val currentStatus = status
            val currentStats = stats

            // 1. Protection Toggle Banner Card
            PanelCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                        val isProtected = currentStatus?.protectionEnabled == true
                        Box(
                            modifier = Modifier
                                .size(44.dp)
                                .background(if (isProtected) PanelStatusGreenBg else PanelStatusRedBg, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                imageVector = if (isProtected) Icons.Filled.Security else Icons.Filled.Block,
                                contentDescription = null,
                                tint = if (isProtected) PanelStatusGreen else PanelStatusRed,
                                modifier = Modifier.size(24.dp),
                            )
                        }
                        Spacer(modifier = Modifier.width(14.dp))
                        Column {
                            Text(
                                text = if (isProtected) "Protection is ON" else "Protection is OFF",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = if (isProtected) PanelStatusGreen else PanelStatusRed,
                            )
                            Text(
                                text = if (isProtected) "Blocking ads, malware & trackers" else "DNS filtering currently paused",
                                style = MaterialTheme.typography.bodySmall,
                                color = PanelTextMuted,
                            )
                        }
                    }

                    Switch(
                        checked = currentStatus?.protectionEnabled == true,
                        onCheckedChange = { toggleProtection(it) },
                        enabled = !toggling && currentStatus != null,
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = Color.White,
                            checkedTrackColor = PanelStatusGreen,
                            uncheckedThumbColor = PanelTextMuted,
                            uncheckedTrackColor = PanelStatusRedBg,
                        ),
                    )
                }
            }

            // 2. Metrics 24h Stats Grid
            if (currentStats != null) {
                val totalQueries = currentStats.numDnsQueries
                val blockedQueries = currentStats.numBlockedFiltering
                val blockedPct = if (totalQueries > 0) (blockedQueries.toDouble() / totalQueries * 100) else 0.0

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    StatBox(
                        title = "DNS Queries (24h)",
                        value = "%,d".format(totalQueries),
                        icon = Icons.Filled.QueryStats,
                        accentColor = Color(0xFF60A5FA),
                        modifier = Modifier.weight(1f),
                    )
                    StatBox(
                        title = "Blocked Ads",
                        value = "%,d".format(blockedQueries),
                        subValue = "%.1f%%".format(blockedPct),
                        icon = Icons.Filled.Block,
                        accentColor = Color(0xFFF87171),
                        modifier = Modifier.weight(1f),
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    StatBox(
                        title = "Malware / Phishing",
                        value = "%,d".format(currentStats.numReplacedSafebrowsing),
                        icon = Icons.Filled.Security,
                        accentColor = Color(0xFFFBBF24),
                        modifier = Modifier.weight(1f),
                    )
                    StatBox(
                        title = "Avg Processing",
                        value = "%.2f ms".format(currentStats.avgProcessingTime * 1000),
                        icon = Icons.Filled.Speed,
                        accentColor = Color(0xFF34D399),
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            // 3. DNS Server Addresses Card
            if (currentStatus != null && currentStatus.dnsAddresses.isNotEmpty()) {
                PanelCard {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 10.dp)) {
                        Icon(
                            imageVector = Icons.Filled.Dns,
                            contentDescription = null,
                            tint = Color(0xFF60A5FA),
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            "DNS Listening Addresses (Port ${currentStatus.dnsPort})",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = PanelTextPrimary,
                        )
                    }

                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        currentStatus.dnsAddresses.take(6).forEach { ip ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color(0x0FFFFFFF), MaterialTheme.shapes.small)
                                    .padding(horizontal = 10.dp, vertical = 6.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = ip,
                                    style = MaterialTheme.typography.bodySmall,
                                    fontFamily = FontFamily.Monospace,
                                    color = PanelTextSecondary,
                                )
                                Text(
                                    text = if (ip.contains(":")) "IPv6" else "IPv4",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = PanelTextFaint,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatBox(
    title: String,
    value: String,
    subValue: String? = null,
    icon: ImageVector,
    accentColor: Color,
    modifier: Modifier = Modifier,
) {
    PanelCard(modifier = modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title.uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = PanelTextMuted,
                    letterSpacing = 0.5.sp,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = value,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = PanelTextPrimary,
                )
                if (subValue != null) {
                    Text(
                        text = "$subValue blocked",
                        style = MaterialTheme.typography.labelSmall,
                        color = accentColor,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .background(accentColor.copy(alpha = 0.15f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = accentColor,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
    }
}

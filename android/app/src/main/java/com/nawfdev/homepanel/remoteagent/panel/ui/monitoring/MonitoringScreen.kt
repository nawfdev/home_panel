package com.nawfdev.homepanel.remoteagent.panel.ui.monitoring

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SignalCellularAlt
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.HeartbeatDto
import com.nawfdev.homepanel.remoteagent.panel.data.MonitorDto
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PanelCard
import com.nawfdev.homepanel.remoteagent.panel.ui.components.StatusPill
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelBg
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelStatusGreen
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelStatusRed
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextFaint
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextMuted
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextPrimary
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextSecondary
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun MonitoringScreen(apiClient: ApiClient) {
    var monitors by remember { mutableStateOf<List<MonitorDto>>(emptyList()) }
    var upCount by remember { mutableStateOf(0) }
    var downCount by remember { mutableStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var checkingId by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun loadData() {
        scope.launch {
            try {
                val res = apiClient.api().getMonitors()
                monitors = res.monitors
                upCount = res.upCount
                downCount = res.downCount
                error = null
            } catch (e: Exception) {
                error = e.message ?: "Failed to load monitors"
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(Unit) {
        loadData()
        while (true) {
            delay(15000)
            try {
                val res = apiClient.api().getMonitors()
                monitors = res.monitors
                upCount = res.upCount
                downCount = res.downCount
            } catch (_: Exception) {}
        }
    }

    fun checkProbe(id: String) {
        if (checkingId != null) return
        checkingId = id
        scope.launch {
            try {
                apiClient.api().checkMonitor(id)
                loadData()
            } catch (e: Exception) {
                error = e.message ?: "Failed to check probe"
            } finally {
                checkingId = null
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

        if (loading && monitors.isEmpty()) {
            Box(modifier = Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Color.White)
            }
        } else {
            val avgSla = if (monitors.isNotEmpty()) {
                monitors.map { it.uptime24h }.average()
            } else 100.0

            // 1. Overall SLA Summary Card
            PanelCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column {
                        Text(
                            "OVERALL 24H SLA",
                            style = MaterialTheme.typography.labelSmall,
                            color = PanelTextMuted,
                            letterSpacing = 0.5.sp,
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "%.2f%%".format(avgSla),
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                            color = if (avgSla >= 99.0) PanelStatusGreen else if (avgSla >= 95.0) Color(0xFFFACC15) else PanelStatusRed,
                        )
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatusCountBadge(label = "UP", count = upCount, color = PanelStatusGreen)
                        StatusCountBadge(label = "DOWN", count = downCount, color = PanelStatusRed)
                    }
                }
            }

            // 2. Monitored Services Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Monitored Services (${monitors.size})",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = PanelTextPrimary,
                )
                IconButton(onClick = ::loadData, modifier = Modifier.size(32.dp)) {
                    Icon(
                        imageVector = Icons.Filled.Refresh,
                        contentDescription = "Refresh",
                        tint = PanelTextMuted,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            // 3. Monitor Cards List
            monitors.forEach { mon ->
                MonitorCard(
                    monitor = mon,
                    isChecking = checkingId == mon.id,
                    onCheck = { checkProbe(mon.id) },
                )
            }
        }
    }
}

@Composable
private fun StatusCountBadge(label: String, count: Int, color: Color) {
    Box(
        modifier = Modifier
            .background(color.copy(alpha = 0.15f), RoundedCornerShape(8.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Box(modifier = Modifier.size(6.dp).background(color, CircleShape))
            Text(
                text = "$count $label",
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = color,
                fontFamily = FontFamily.Monospace,
            )
        }
    }
}

@Composable
private fun MonitorCard(
    monitor: MonitorDto,
    isChecking: Boolean,
    onCheck: () -> Unit,
) {
    var selectedHb by remember { mutableStateOf<HeartbeatDto?>(null) }
    val isUp = monitor.status == "up"

    PanelCard {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Header Row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                    Icon(
                        imageVector = if (isUp) Icons.Filled.CheckCircle else Icons.Filled.Error,
                        contentDescription = null,
                        tint = if (isUp) PanelStatusGreen else PanelStatusRed,
                        modifier = Modifier.size(20.dp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Column {
                        Text(
                            text = monitor.name,
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = PanelTextPrimary,
                        )
                        Text(
                            text = "${monitor.type.uppercase()} · ${monitor.target}",
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                            color = PanelTextFaint,
                        )
                    }
                }

                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatusPill(status = monitor.status)
                    Text(
                        text = "%.1f%%".format(monitor.uptime24h),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace,
                        color = PanelStatusGreen,
                    )
                }
            }

            // Interactive Detail Bar / Inspection
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (selectedHb != null) {
                    val hb = selectedHb!!
                    val sdf = SimpleDateFormat("dd/MM HH:mm:ss", Locale.getDefault())
                    val timeStr = sdf.format(Date(hb.timestamp))
                    Row(
                        modifier = Modifier
                            .background(Color(0x1AFFFFFF), RoundedCornerShape(6.dp))
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .background(if (hb.status == "up") PanelStatusGreen else PanelStatusRed, CircleShape)
                        )
                        Text(
                            text = "${hb.status.uppercase()} · $timeStr${if (hb.latencyMs > 0) " · %.1fms".format(hb.latencyMs) else ""}",
                            style = MaterialTheme.typography.labelSmall,
                            fontFamily = FontFamily.Monospace,
                            color = PanelTextSecondary,
                        )
                    }
                } else {
                    Text(
                        text = "30-Day Heartbeats (Tap pill to inspect)",
                        style = MaterialTheme.typography.labelSmall,
                        color = PanelTextMuted,
                    )
                }

                if (isChecking) {
                    CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp, color = Color.White)
                } else {
                    Text(
                        text = "Check now",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFF60A5FA),
                        modifier = Modifier.clickable(onClick = onCheck),
                    )
                }
            }

            // Heartbeat Pills (30 items)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(24.dp)
                    .background(Color(0x26000000), RoundedCornerShape(6.dp))
                    .padding(3.dp),
                horizontalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                val history = monitor.history
                val totalPills = 30
                for (i in 0 until totalPills) {
                    val historyIdx = history.size - totalPills + i
                    val hb = if (historyIdx in history.indices) history[historyIdx] else null
                    val isSelected = selectedHb == hb && hb != null

                    val pillColor = when {
                        hb == null -> Color(0x14FFFFFF)
                        hb.status == "up" -> if (isSelected) Color(0xFF86EFAC) else Color(0xCC22C55E)
                        else -> if (isSelected) Color(0xFFFCA5A5) else Color(0xFFEF4444)
                    }

                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxSize()
                            .background(pillColor, RoundedCornerShape(2.dp))
                            .clickable(enabled = hb != null) {
                                selectedHb = if (selectedHb == hb) null else hb
                            },
                    )
                }
            }
        }
    }
}

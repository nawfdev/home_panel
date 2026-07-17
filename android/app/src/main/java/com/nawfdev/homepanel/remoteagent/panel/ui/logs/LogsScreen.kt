package com.nawfdev.homepanel.remoteagent.panel.ui.logs

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.LogSource
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized

@Composable
fun LogsScreen(apiClient: ApiClient, onUnauthorized: () -> Unit) {
    var sources by remember { mutableStateOf<List<LogSource>>(emptyList()) }
    var selected by remember { mutableStateOf<LogSource?>(null) }
    var expanded by remember { mutableStateOf(false) }
    var content by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        try {
            val res = apiClient.api().logSources()
            sources = res.sources
            selected = res.sources.firstOrNull { it.available }
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load log sources"
        }
    }

    LaunchedEffect(selected) {
        val source = selected ?: return@LaunchedEffect
        loading = true
        error = null
        try {
            // "panel" needs no target; docker/pm2 targets are a Stage 3 follow-up
            // (this pass shows the first available target, if any, automatically).
            val target = if (source.type != "file") {
                apiClient.api().logTargets(source.id).targets.firstOrNull()?.id
            } else null
            val res = apiClient.api().logContent(source.id, target = target)
            content = if (res.success) res.logs else "No logs available"
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load logs"
        } finally {
            loading = false
        }
    }

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        Text("Logs", style = MaterialTheme.typography.headlineSmall)

        Box(modifier = Modifier.padding(top = 12.dp)) {
            Card(modifier = Modifier
                .fillMaxWidth()
                .clickable { expanded = true }) {
                Text(
                    selected?.name ?: "Select a source",
                    modifier = Modifier.padding(12.dp),
                )
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                sources.forEach { source ->
                    DropdownMenuItem(
                        text = { Text(if (source.available) source.name else "${source.name} (unavailable)") },
                        enabled = source.available,
                        onClick = {
                            selected = source
                            expanded = false
                        },
                    )
                }
            }
        }

        Row(modifier = Modifier.padding(top = 12.dp)) {
            if (loading) CircularProgressIndicator()
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }

        SelectionContainer {
            Column(modifier = Modifier
                .padding(top = 12.dp)
                .verticalScroll(rememberScrollState())) {
                Text(content, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

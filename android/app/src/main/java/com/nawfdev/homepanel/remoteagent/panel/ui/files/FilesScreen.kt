package com.nawfdev.homepanel.remoteagent.panel.ui.files

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
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
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.FileItem
import com.nawfdev.homepanel.remoteagent.panel.data.FilesListRequest
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized
import com.nawfdev.homepanel.remoteagent.panel.ui.components.EmptyState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.LoadingState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ScreenHeader
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelBorder
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextMuted
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextPrimary
import kotlin.math.roundToInt

@Composable
fun FilesScreen(apiClient: ApiClient, onUnauthorized: () -> Unit) {
    var relativePath by remember { mutableStateOf("") }
    var items by remember { mutableStateOf<List<FileItem>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(relativePath) {
        items = null
        error = null
        try {
            val res = apiClient.api().filesList(FilesListRequest(relativePath))
            if (res.success) items = res.items else error = res.error ?: "Failed to list files"
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to list files"
        }
    }

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        ScreenHeader("Files", "/${relativePath}".trimEnd('/').ifEmpty { "/" })

        if (relativePath.isNotEmpty()) {
            Text(
                "‹ Up",
                style = MaterialTheme.typography.bodyMedium,
                color = PanelTextMuted,
                modifier = Modifier
                    .clickable { relativePath = relativePath.substringBeforeLast('/', "") }
                    .padding(top = 12.dp, bottom = 4.dp),
            )
        }

        when {
            error != null -> ErrorText(error!!)
            items == null -> LoadingState()
            items!!.isEmpty() -> EmptyState("Empty folder")
            else -> LazyColumn(modifier = Modifier.padding(top = 8.dp)) {
                items(items!!, key = { it.path }) { item ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = item.isDirectory) {
                                relativePath = if (relativePath.isEmpty()) item.name else "$relativePath/${item.name}"
                            }
                            .padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            if (item.isDirectory) Icons.Filled.Folder else Icons.Filled.Description,
                            contentDescription = null,
                            tint = PanelTextMuted,
                            modifier = Modifier.padding(end = 14.dp),
                        )
                        Column {
                            Text(item.name, style = MaterialTheme.typography.bodyLarge, color = PanelTextPrimary)
                            if (!item.isDirectory) {
                                Text(
                                    formatSize(item.size),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = PanelTextMuted,
                                    modifier = Modifier.padding(top = 2.dp),
                                )
                            }
                        }
                    }
                    androidx.compose.material3.Surface(
                        color = PanelBorder,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = 38.dp)
                            .height(1.dp),
                    ) {}
                }
            }
        }
    }
}

private fun formatSize(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val kb = bytes / 1024.0
    if (kb < 1024) return "${kb.roundToInt()} KB"
    val mb = kb / 1024.0
    if (mb < 1024) return "%.1f MB".format(mb)
    return "%.2f GB".format(mb / 1024.0)
}

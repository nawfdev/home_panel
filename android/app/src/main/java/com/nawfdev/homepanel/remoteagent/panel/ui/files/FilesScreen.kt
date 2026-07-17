package com.nawfdev.homepanel.remoteagent.panel.ui.files

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
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
import com.nawfdev.homepanel.remoteagent.panel.data.FileItem
import com.nawfdev.homepanel.remoteagent.panel.data.FilesListRequest
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized
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
        Text("Files", style = MaterialTheme.typography.headlineSmall)
        Text(
            "/${relativePath}".trimEnd('/').ifEmpty { "/" },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.secondary,
            modifier = Modifier.padding(bottom = 12.dp),
        )

        if (relativePath.isNotEmpty()) {
            Text(
                "‹ Up",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier
                    .clickable { relativePath = relativePath.substringBeforeLast('/', "") }
                    .padding(vertical = 8.dp),
            )
        }

        when {
            error != null -> Text(error!!, color = MaterialTheme.colorScheme.error)
            items == null -> CircularProgressIndicator(modifier = Modifier.padding(top = 16.dp))
            items!!.isEmpty() -> Text("Empty folder", color = MaterialTheme.colorScheme.secondary)
            else -> LazyColumn {
                items(items!!, key = { it.path }) { item ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = item.isDirectory) {
                                relativePath = if (relativePath.isEmpty()) item.name else "$relativePath/${item.name}"
                            }
                            .padding(vertical = 10.dp),
                    ) {
                        Icon(
                            if (item.isDirectory) Icons.Filled.Folder else Icons.Filled.Description,
                            contentDescription = null,
                            modifier = Modifier.padding(end = 12.dp),
                        )
                        Column {
                            Text(item.name, style = MaterialTheme.typography.bodyLarge)
                            if (!item.isDirectory) {
                                Text(
                                    formatSize(item.size),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.secondary,
                                )
                            }
                        }
                    }
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

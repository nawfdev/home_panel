package com.nawfdev.homepanel.remoteagent.panel.ui.terminal

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.nawfdev.homepanel.remoteagent.panel.data.PanelPrefs
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

// Not a real PTY — the backend (be/internal/terminal/terminal.go) runs each
// message as one full shell command with a 30s timeout and streams back the
// combined stdout/stderr, so this renders as a scrolling log rather than an
// interactive shell. Server output is ANSI-colored; we strip escape codes
// for plain monospace text rather than implementing a color-aware renderer.
private val ansiRegex = Regex("\\[[0-9;]*[A-Za-z]")

@Composable
fun TerminalScreen(prefs: PanelPrefs) {
    var log by remember { mutableStateOf("") }
    var command by remember { mutableStateOf("") }
    var socket by remember { mutableStateOf<WebSocket?>(null) }
    val scrollState = rememberScrollState()

    DisposableEffect(prefs.baseUrl, prefs.token) {
        val baseUrl = prefs.baseUrl
        val token = prefs.token
        var ws: WebSocket? = null
        if (baseUrl != null && token != null) {
            val wsUrl = baseUrl.replaceFirst("http", "ws").trimEnd('/') + "/terminal"
            val client = OkHttpClient.Builder().build()
            val request = Request.Builder().url(wsUrl).addHeader("Authorization", "Bearer $token").build()
            ws = client.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    socket = webSocket
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (text.contains("[2J")) {
                        log = ""
                    } else {
                        log += ansiRegex.replace(text, "")
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    log += "\n[connection error: ${t.message}]\n"
                }
            })
        }
        onDispose { ws?.close(1000, "leaving screen") }
    }

    LaunchedEffect(log) { scrollState.animateScrollTo(scrollState.maxValue) }

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        Text("Terminal", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Each command runs once, no interactive shell (30s timeout, dangerous commands blocked server-side).",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.secondary,
        )

        SelectionContainer(modifier = Modifier
            .weight(1f)
            .padding(top = 12.dp)) {
            Column(modifier = Modifier.verticalScroll(scrollState)) {
                Text(log.ifEmpty { "Connecting..." }, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
            }
        }

        Row(modifier = Modifier.padding(top = 8.dp)) {
            OutlinedTextField(
                value = command,
                onValueChange = { command = it },
                modifier = Modifier.weight(1f),
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
            )
            Button(
                onClick = {
                    socket?.send(command)
                    command = ""
                },
                modifier = Modifier.padding(start = 8.dp),
            ) { Text("Run") }
        }
    }
}

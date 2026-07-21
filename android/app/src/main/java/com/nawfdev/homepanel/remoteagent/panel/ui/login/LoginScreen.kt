package com.nawfdev.homepanel.remoteagent.panel.ui.login

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.LoginRequest
import com.nawfdev.homepanel.remoteagent.panel.data.PanelPrefs
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PanelTextField
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PrimaryButton
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelBg
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextMuted
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(prefs: PanelPrefs, apiClient: ApiClient, onLoggedIn: () -> Unit) {
    var baseUrl by remember { mutableStateOf(prefs.baseUrl ?: "") }
    var username by remember { mutableStateOf(prefs.username ?: "") }
    var password by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun submit() {
        val host = baseUrl.trim()
        if (host.isEmpty() || username.isBlank() || password.isEmpty()) {
            error = "Panel address, username and password are required"
            return
        }
        val normalized = if (host.startsWith("http://") || host.startsWith("https://")) host else "http://$host"
        loading = true
        error = null
        scope.launch {
            try {
                prefs.baseUrl = normalized
                apiClient.invalidate()
                val res = apiClient.api().login(LoginRequest(username.trim(), password))
                prefs.token = res.token
                prefs.username = res.user.username
                prefs.role = res.user.role
                prefs.features = res.user.features.toSet()
                onLoggedIn()
            } catch (e: Exception) {
                prefs.baseUrl = null
                error = e.message ?: "Login failed"
            } finally {
                loading = false
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(PanelBg)
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Home Panel", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Sign in with your family account",
            style = MaterialTheme.typography.bodyMedium,
            color = PanelTextMuted,
            modifier = Modifier.padding(top = 4.dp),
        )

        PanelTextField(
            value = baseUrl,
            onValueChange = { baseUrl = it },
            label = "Panel address (e.g. 192.168.1.10:9689)",
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.padding(top = 28.dp),
        )
        PanelTextField(
            value = username,
            onValueChange = { username = it },
            label = "Username",
            modifier = Modifier.padding(top = 12.dp),
        )
        PanelTextField(
            value = password,
            onValueChange = { password = it },
            label = "Password",
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.padding(top = 12.dp),
        )

        error?.let { ErrorText(it) }

        PrimaryButton(
            text = if (loading) "Signing in…" else "Sign in",
            onClick = ::submit,
            enabled = !loading,
            loading = loading,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 20.dp),
        )
    }
}

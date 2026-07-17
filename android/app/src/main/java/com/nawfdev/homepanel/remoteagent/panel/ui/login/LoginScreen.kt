package com.nawfdev.homepanel.remoteagent.panel.ui.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Home Panel", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Sign in with your family account",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.secondary,
        )

        OutlinedTextField(
            value = baseUrl,
            onValueChange = { baseUrl = it },
            label = { Text("Panel address (e.g. 192.168.1.10:9689)") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 24.dp),
        )
        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            label = { Text("Username") },
            singleLine = true,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp),
        )

        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp))
        }

        Button(
            onClick = ::submit,
            enabled = !loading,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 20.dp),
        ) {
            if (loading) {
                CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp))
            }
            Text(if (loading) "Signing in..." else "Sign in")
        }
    }
}

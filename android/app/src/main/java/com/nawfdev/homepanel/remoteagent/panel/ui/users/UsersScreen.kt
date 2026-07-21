package com.nawfdev.homepanel.remoteagent.panel.ui.users

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.CreateUserRequest
import com.nawfdev.homepanel.remoteagent.panel.data.FamilyUser
import com.nawfdev.homepanel.remoteagent.panel.data.Role
import com.nawfdev.homepanel.remoteagent.panel.data.UpdateRoleRequest
import com.nawfdev.homepanel.remoteagent.panel.data.UpdateUserRequest
import com.nawfdev.homepanel.remoteagent.panel.data.isUnauthorized
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ErrorText
import com.nawfdev.homepanel.remoteagent.panel.ui.components.LoadingState
import com.nawfdev.homepanel.remoteagent.panel.ui.components.Panel
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PanelTextField
import com.nawfdev.homepanel.remoteagent.panel.ui.components.PrimaryButton
import com.nawfdev.homepanel.remoteagent.panel.ui.components.ScreenHeader
import com.nawfdev.homepanel.remoteagent.panel.ui.components.SecondaryButton
import com.nawfdev.homepanel.remoteagent.panel.ui.components.SectionLabel
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextMuted
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextPrimary
import kotlinx.coroutines.launch

/** Admin-only: manage family accounts and role feature grants (mirrors the FE Settings > Users tab). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun UsersScreen(apiClient: ApiClient, onUnauthorized: () -> Unit) {
    var users by remember { mutableStateOf<List<FamilyUser>>(emptyList()) }
    var roles by remember { mutableStateOf<List<Role>>(emptyList()) }
    var featureKeys by remember { mutableStateOf<List<String>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var newUsername by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    suspend fun reload() {
        users = apiClient.api().listUsers()
        val rolesRes = apiClient.api().listRoles()
        roles = rolesRes.roles
        featureKeys = rolesRes.featureKeys
    }

    LaunchedEffect(Unit) {
        try {
            reload()
        } catch (e: Exception) {
            if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Failed to load users"
        } finally {
            loading = false
        }
    }

    fun runAction(block: suspend () -> Unit) {
        scope.launch {
            try {
                block()
                reload()
            } catch (e: Exception) {
                if (e.isUnauthorized()) onUnauthorized() else error = e.message ?: "Action failed"
            }
        }
    }

    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        ScreenHeader("Family accounts")
        error?.let { ErrorText(it) }

        if (loading) {
            LoadingState()
        } else {
            LazyColumn(modifier = Modifier
                .fillMaxWidth()
                .padding(top = 16.dp)) {
                items(users, key = { it.id }) { user ->
                    Panel(modifier = Modifier.padding(bottom = 10.dp)) {
                        Text(user.username, style = MaterialTheme.typography.titleMedium)
                        Text(
                            "Role: ${user.role}",
                            style = MaterialTheme.typography.bodySmall,
                            color = PanelTextMuted,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                        FlowRow(modifier = Modifier.padding(top = 10.dp)) {
                            roles.filter { it.id != user.role }.forEach { role ->
                                SecondaryButton(
                                    text = "→ ${role.label}",
                                    onClick = { runAction { apiClient.api().updateUser(user.id, UpdateUserRequest(role = role.id)) } },
                                    modifier = Modifier.padding(end = 8.dp, bottom = 8.dp),
                                )
                            }
                            SecondaryButton(text = "Remove", onClick = { runAction { apiClient.api().deleteUser(user.id) } })
                        }
                    }
                }
            }

            Panel(modifier = Modifier.padding(top = 6.dp)) {
                Text("Add family member", style = MaterialTheme.typography.titleMedium)
                PanelTextField(
                    value = newUsername,
                    onValueChange = { newUsername = it },
                    label = "Username",
                    modifier = Modifier.padding(top = 12.dp),
                )
                PanelTextField(
                    value = newPassword,
                    onValueChange = { newPassword = it },
                    label = "Password",
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.padding(top = 10.dp),
                )
                PrimaryButton(
                    text = "Add",
                    onClick = {
                        val defaultRole = roles.firstOrNull { !it.locked }?.id ?: return@PrimaryButton
                        runAction {
                            apiClient.api().createUser(CreateUserRequest(newUsername.trim(), newPassword, defaultRole))
                            newUsername = ""
                            newPassword = ""
                        }
                    },
                    enabled = newUsername.isNotBlank() && newPassword.isNotEmpty(),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 12.dp),
                )
            }

            SectionLabel("Roles", modifier = Modifier.padding(top = 24.dp))
            roles.forEach { role ->
                Panel(modifier = Modifier.padding(bottom = 10.dp)) {
                    Text(
                        if (role.locked) "${role.label} (full access, locked)" else role.label,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    if (!role.locked) {
                        FlowRow(modifier = Modifier.padding(top = 10.dp)) {
                            featureKeys.forEach { key ->
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.padding(end = 12.dp),
                                ) {
                                    Checkbox(
                                        checked = role.features.contains(key),
                                        onCheckedChange = { checked ->
                                            val updated = if (checked) role.features + key else role.features - key
                                            runAction {
                                                apiClient.api().updateRole(role.id, UpdateRoleRequest(updated))
                                            }
                                        },
                                        colors = CheckboxDefaults.colors(checkedColor = PanelTextPrimary, uncheckedColor = PanelTextMuted),
                                    )
                                    Text(key, style = MaterialTheme.typography.bodySmall, color = PanelTextMuted)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

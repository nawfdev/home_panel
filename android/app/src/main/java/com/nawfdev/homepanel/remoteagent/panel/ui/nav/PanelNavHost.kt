package com.nawfdev.homepanel.remoteagent.panel.ui.nav

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.DesktopWindows
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.MiscellaneousServices
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Cable
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.PanelPrefs
import com.nawfdev.homepanel.remoteagent.panel.ui.aigateway.AiGatewayScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.cloudflare.CloudflareScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.dashboard.DashboardScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.docker.DockerScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.files.FilesScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.login.LoginScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.logs.LogsScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.movies.MoviesScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.network.NetworkScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.pm2.Pm2Screen
import com.nawfdev.homepanel.remoteagent.panel.ui.projects.ProjectsScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.remotedesktop.RemoteDesktopScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.services.ServicesScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.telegram.TelegramScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.terminal.TerminalScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.tunnel.TunnelScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.users.UsersScreen

private enum class AuthState { CHECKING, LOGGED_OUT, LOGGED_IN }

private data class PanelScreen(
    val route: String,
    val label: String,
    val icon: ImageVector,
    val feature: String?,   // null = always available to any authenticated user
    val adminOnly: Boolean = false,
    val primary: Boolean = false, // shown directly in the bottom bar; rest live under "More"
)

// Only implemented screens are listed — features without a screen yet just
// don't show up in nav, rather than pointing at a placeholder.
private val SCREENS = listOf(
    PanelScreen("dashboard", "Dashboard", Icons.Filled.Dashboard, feature = null, primary = true),
    PanelScreen("files", "Files", Icons.Filled.Folder, feature = "files", primary = true),
    PanelScreen("remote-desktop", "Remote", Icons.Filled.DesktopWindows, feature = "remote-desktop", primary = true),
    PanelScreen("network", "Network", Icons.Filled.Wifi, feature = "network"),
    PanelScreen("services", "Services", Icons.Filled.MiscellaneousServices, feature = "services"),
    PanelScreen("logs", "Logs", Icons.Filled.Description, feature = "logs"),
    PanelScreen("pm2", "PM2", Icons.Filled.Dns, feature = "pm2"),
    PanelScreen("docker", "Docker", Icons.Filled.Cable, feature = "docker"),
    PanelScreen("tunnel", "Tunnel", Icons.Filled.Wifi, feature = "tunnel"),
    PanelScreen("cloudflare", "Cloudflare", Icons.Filled.Cloud, feature = "cloudflare"),
    PanelScreen("telegram", "Telegram", Icons.Filled.Send, feature = "telegram"),
    PanelScreen("projects", "Projects", Icons.Filled.Layers, feature = "projects"),
    PanelScreen("ai-gateway", "AI Gateway", Icons.Filled.AutoAwesome, feature = "ai-gateway"),
    PanelScreen("terminal", "Terminal", Icons.Filled.Terminal, feature = "terminal"),
    PanelScreen("movies", "Movies", Icons.Filled.Movie, feature = "movies"),
    PanelScreen("users", "Users", Icons.Filled.Group, feature = null, adminOnly = true),
)

@Composable
fun PanelNavHost(prefs: PanelPrefs, apiClient: ApiClient) {
    var authState by remember { mutableStateOf(if (prefs.isLoggedIn) AuthState.CHECKING else AuthState.LOGGED_OUT) }

    fun logout() {
        prefs.clear()
        apiClient.invalidate()
        authState = AuthState.LOGGED_OUT
    }

    LaunchedEffect(authState) {
        if (authState == AuthState.CHECKING) {
            try {
                val me = apiClient.api().me()
                prefs.role = me.user.role
                prefs.features = me.user.features.toSet()
                authState = AuthState.LOGGED_IN
            } catch (e: Exception) {
                logout()
            }
        }
    }

    when (authState) {
        AuthState.CHECKING -> Box(Modifier.fillMaxSize()) {
            CircularProgressIndicator(Modifier.align(Alignment.Center))
        }
        AuthState.LOGGED_OUT -> LoginScreen(prefs, apiClient) { authState = AuthState.LOGGED_IN }
        AuthState.LOGGED_IN -> PanelShell(prefs, apiClient, onLogout = ::logout)
    }
}

private fun PanelScreen.isVisible(prefs: PanelPrefs): Boolean {
    val isAdmin = prefs.role == "admin"
    if (adminOnly) return isAdmin
    return feature == null || isAdmin || prefs.features.contains(feature)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PanelShell(prefs: PanelPrefs, apiClient: ApiClient, onLogout: () -> Unit) {
    val navController = rememberNavController()
    val visible = SCREENS.filter { it.isVisible(prefs) }
    val primaryTabs = visible.filter { it.primary }
    val moreScreens = visible.filter { !it.primary }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Home Panel") },
                actions = {
                    IconButton(onClick = onLogout) {
                        Icon(Icons.Filled.Logout, contentDescription = "Log out")
                    }
                },
            )
        },
        bottomBar = {
            val backStackEntry by navController.currentBackStackEntryAsState()
            val currentRoute = backStackEntry?.destination
            NavigationBar {
                primaryTabs.forEach { screen ->
                    NavigationBarItem(
                        selected = currentRoute?.hierarchy?.any { it.route == screen.route } == true,
                        onClick = {
                            navController.navigate(screen.route) {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(screen.icon, contentDescription = screen.label) },
                        label = { Text(screen.label) },
                    )
                }
                if (moreScreens.isNotEmpty()) {
                    NavigationBarItem(
                        selected = currentRoute?.hierarchy?.any { it.route == "more" } == true,
                        onClick = {
                            navController.navigate("more") {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(Icons.Filled.MoreHoriz, contentDescription = "More") },
                        label = { Text("More") },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = "dashboard",
            modifier = Modifier.padding(padding),
        ) {
            composable("dashboard") { DashboardScreen(apiClient) { onLogout() } }
            if (visible.any { it.route == "files" }) composable("files") { FilesScreen(apiClient) { onLogout() } }
            if (visible.any { it.route == "network" }) composable("network") { NetworkScreen(apiClient) { onLogout() } }
            if (visible.any { it.route == "services" }) composable("services") { ServicesScreen(apiClient) { onLogout() } }
            if (visible.any { it.route == "logs" }) composable("logs") { LogsScreen(apiClient) { onLogout() } }
            if (visible.any { it.route == "pm2" }) composable("pm2") { Pm2Screen(apiClient) { onLogout() } }
            if (visible.any { it.route == "docker" }) composable("docker") { DockerScreen(apiClient) { onLogout() } }
            if (visible.any { it.route == "tunnel" }) composable("tunnel") { TunnelScreen(apiClient) { onLogout() } }
            if (visible.any { it.route == "cloudflare" }) composable("cloudflare") { CloudflareScreen(apiClient) { onLogout() } }
            if (visible.any { it.route == "telegram" }) composable("telegram") { TelegramScreen(apiClient) { onLogout() } }
            if (visible.any { it.route == "projects" }) composable("projects") { ProjectsScreen(apiClient) { onLogout() } }
            if (visible.any { it.route == "ai-gateway" }) composable("ai-gateway") { AiGatewayScreen(apiClient) { onLogout() } }
            if (visible.any { it.route == "terminal" }) composable("terminal") { TerminalScreen(prefs) }
            if (visible.any { it.route == "movies" }) composable("movies") { MoviesScreen(apiClient) { onLogout() } }
            if (visible.any { it.route == "users" }) composable("users") { UsersScreen(apiClient) { onLogout() } }
            if (visible.any { it.route == "remote-desktop" }) composable("remote-desktop") { RemoteDesktopScreen() }
            if (moreScreens.isNotEmpty()) {
                composable("more") {
                    MoreScreen(moreScreens) { route ->
                        navController.navigate(route) { launchSingleTop = true }
                    }
                }
            }
        }
    }
}

@Composable
private fun MoreScreen(screens: List<PanelScreen>, onOpen: (String) -> Unit) {
    Column(modifier = Modifier
        .fillMaxSize()
        .padding(16.dp)) {
        Text("More", style = MaterialTheme.typography.headlineSmall)
        LazyColumn(modifier = Modifier.padding(top = 12.dp)) {
            items(screens, key = { it.route }) { screen ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onOpen(screen.route) }
                        .padding(vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(screen.icon, contentDescription = null, modifier = Modifier.padding(end = 16.dp))
                    Text(screen.label)
                }
            }
        }
    }
}


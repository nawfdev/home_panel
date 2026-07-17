package com.nawfdev.homepanel.remoteagent.panel.ui.nav

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.DesktopWindows
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.PanelPrefs
import com.nawfdev.homepanel.remoteagent.panel.ui.dashboard.DashboardScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.login.LoginScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.remotedesktop.RemoteDesktopScreen

private enum class AuthState { CHECKING, LOGGED_OUT, LOGGED_IN }

private data class PanelTab(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector, val feature: String?)

// Only implemented screens are listed — features without a screen yet just
// don't show up in nav, rather than pointing at a placeholder. Dashboard has
// feature = null (always available, matches the backend's always-on grant).
private val TABS = listOf(
    PanelTab("dashboard", "Dashboard", Icons.Filled.Dashboard, null),
    PanelTab("remote-desktop", "Remote", Icons.Filled.DesktopWindows, "remote-desktop"),
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PanelShell(prefs: PanelPrefs, apiClient: ApiClient, onLogout: () -> Unit) {
    val navController = rememberNavController()
    val visibleTabs = TABS.filter { it.feature == null || prefs.role == "admin" || prefs.features.contains(it.feature) }

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
            if (visibleTabs.size > 1) {
                val backStackEntry by navController.currentBackStackEntryAsState()
                val currentRoute = backStackEntry?.destination
                NavigationBar {
                    visibleTabs.forEach { tab ->
                        NavigationBarItem(
                            selected = currentRoute?.hierarchy?.any { it.route == tab.route } == true,
                            onClick = {
                                navController.navigate(tab.route) {
                                    popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(tab.icon, contentDescription = tab.label) },
                            label = { Text(tab.label) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = "dashboard",
            modifier = Modifier.padding(padding),
        ) {
            composable("dashboard") {
                DashboardScreen(apiClient) { onLogout() }
            }
            if (visibleTabs.any { it.route == "remote-desktop" }) {
                composable("remote-desktop") { RemoteDesktopScreen() }
            }
        }
    }
}

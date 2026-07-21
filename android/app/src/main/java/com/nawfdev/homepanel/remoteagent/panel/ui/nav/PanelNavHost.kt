package com.nawfdev.homepanel.remoteagent.panel.ui.nav

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Cable
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.DesktopWindows
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MiscellaneousServices
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
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
import com.nawfdev.homepanel.remoteagent.panel.ui.stream.StreamScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.stream.StreamWatchScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.telegram.TelegramScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.terminal.TerminalScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.tv.TvPlayerScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.tv.TvScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelBg
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelBorder
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelSurface
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextMuted
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextPrimary
import com.nawfdev.homepanel.remoteagent.panel.ui.tunnel.TunnelScreen
import com.nawfdev.homepanel.remoteagent.panel.ui.users.UsersScreen
import kotlinx.coroutines.launch

private enum class AuthState { CHECKING, LOGGED_OUT, LOGGED_IN }

private data class PanelScreen(
    val route: String,
    val label: String,
    val icon: ImageVector,
    val feature: String?,   // null = always available to any authenticated user
    val adminOnly: Boolean = false,
)

// Only implemented screens are listed — features without a screen yet just
// don't show up in nav, rather than pointing at a placeholder.
private val SCREENS = listOf(
    PanelScreen("dashboard", "Dashboard", Icons.Filled.Dashboard, feature = null),
    PanelScreen("files", "Files", Icons.Filled.Folder, feature = "files"),
    PanelScreen("projects", "Projects", Icons.Filled.Layers, feature = "projects"),
    PanelScreen("tunnel", "Tunnel", Icons.Filled.Wifi, feature = "tunnel"),
    PanelScreen("cloudflare", "Cloudflare", Icons.Filled.Cloud, feature = "cloudflare"),
    PanelScreen("network", "Network", Icons.Filled.Wifi, feature = "network"),
    PanelScreen("docker", "Docker", Icons.Filled.Cable, feature = "docker"),
    PanelScreen("pm2", "PM2", Icons.Filled.Dns, feature = "pm2"),
    PanelScreen("services", "Services", Icons.Filled.MiscellaneousServices, feature = "services"),
    PanelScreen("logs", "Logs", Icons.Filled.Description, feature = "logs"),
    PanelScreen("terminal", "Terminal", Icons.Filled.Terminal, feature = "terminal"),
    PanelScreen("remote-desktop", "Remote Desktop", Icons.Filled.DesktopWindows, feature = "remote-desktop"),
    PanelScreen("ai-gateway", "AI Gateway", Icons.Filled.AutoAwesome, feature = "ai-gateway"),
    PanelScreen("telegram", "Telegram", Icons.Filled.Send, feature = "telegram"),
    PanelScreen("movies", "Movies", Icons.Filled.Movie, feature = "movies"),
    PanelScreen("stream", "Stream", Icons.Filled.PlayCircle, feature = "movies"),
    PanelScreen("tv", "Live TV", Icons.Filled.LiveTv, feature = "tv"),
    PanelScreen("users", "Users", Icons.Filled.Group, feature = null, adminOnly = true),
)

// Presentation-only grouping of the routes above into a left-hand nav drawer
// (parity with fe/src/components/layout/Sidebar.tsx's collapsible groups) —
// routes/features/adminOnly all stay defined once in SCREENS above.
private sealed class NavLayoutItem {
    data class Single(val route: String) : NavLayoutItem()
    data class Group(val label: String, val icon: ImageVector, val routes: List<String>) : NavLayoutItem()
}

private val NAV_LAYOUT = listOf(
    NavLayoutItem.Single("dashboard"),
    NavLayoutItem.Group("Networking", Icons.Filled.Wifi, listOf("tunnel", "cloudflare", "network")),
    NavLayoutItem.Group("Processes", Icons.Filled.MiscellaneousServices, listOf("docker", "pm2", "services")),
    NavLayoutItem.Group("Diagnostics", Icons.Filled.Description, listOf("logs", "terminal", "remote-desktop")),
    NavLayoutItem.Group("Files", Icons.Filled.Folder, listOf("files", "projects")),
    NavLayoutItem.Single("ai-gateway"),
    NavLayoutItem.Single("telegram"),
    NavLayoutItem.Group("Movies", Icons.Filled.Movie, listOf("movies", "stream", "tv")),
    NavLayoutItem.Single("users"),
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
    val visibleByRoute = visible.associateBy { it.route }
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()

    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    val expandedGroups = remember {
        mutableStateMapOf<String, Boolean>().apply {
            NAV_LAYOUT.filterIsInstance<NavLayoutItem.Group>().forEach { group ->
                this[group.label] = group.routes.contains(currentRoute)
            }
        }
    }

    fun navigate(route: String) {
        navController.navigate(route) {
            popUpTo(navController.graph.findStartDestination().id) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
        scope.launch { drawerState.close() }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet(
                drawerContainerColor = PanelSurface,
                drawerContentColor = PanelTextPrimary,
                modifier = Modifier.width(260.dp),
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Text("Home Panel", style = MaterialTheme.typography.titleLarge)
                    prefs.username?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 2.dp))
                    }
                }
                Surface(color = PanelBorder, modifier = Modifier.fillMaxWidth().height(1.dp)) {}
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .verticalScroll(rememberScrollState())
                        .padding(vertical = 8.dp, horizontal = 8.dp),
                ) {
                    NAV_LAYOUT.forEach { item ->
                        when (item) {
                            is NavLayoutItem.Single -> {
                                val screen = visibleByRoute[item.route] ?: return@forEach
                                DrawerLeaf(screen, selected = currentRoute == screen.route, onClick = { navigate(screen.route) })
                            }
                            is NavLayoutItem.Group -> {
                                val children = item.routes.mapNotNull { visibleByRoute[it] }
                                if (children.isEmpty()) return@forEach
                                val expanded = expandedGroups[item.label] == true
                                NavigationDrawerItem(
                                    label = { Text(item.label, style = MaterialTheme.typography.bodyLarge) },
                                    icon = { Icon(item.icon, contentDescription = null) },
                                    badge = { Icon(if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, contentDescription = null, tint = PanelTextMuted) },
                                    selected = false,
                                    onClick = { expandedGroups[item.label] = !expanded },
                                    colors = drawerItemColors(),
                                    modifier = Modifier.padding(vertical = 2.dp),
                                )
                                if (expanded) {
                                    children.forEach { screen ->
                                        DrawerLeaf(
                                            screen,
                                            selected = currentRoute == screen.route,
                                            onClick = { navigate(screen.route) },
                                            indent = true,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
                Surface(color = PanelBorder, modifier = Modifier.fillMaxWidth().height(1.dp)) {}
                NavigationDrawerItem(
                    label = { Text("Log out", style = MaterialTheme.typography.bodyLarge) },
                    icon = { Icon(Icons.Filled.Logout, contentDescription = null) },
                    selected = false,
                    onClick = onLogout,
                    colors = drawerItemColors(),
                    modifier = Modifier.padding(8.dp),
                )
            }
        },
    ) {
        Scaffold(
            containerColor = PanelBg,
            topBar = {
                TopAppBar(
                    title = {
                        val activeLabel = visible.firstOrNull { it.route == currentRoute }?.label ?: "Home Panel"
                        Text(activeLabel, style = MaterialTheme.typography.titleLarge)
                    },
                    navigationIcon = {
                        IconButton(onClick = { scope.launch { drawerState.open() } }) {
                            Icon(Icons.Filled.Menu, contentDescription = "Menu", tint = PanelTextPrimary)
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = PanelBg,
                        titleContentColor = PanelTextPrimary,
                    ),
                )
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
                if (visible.any { it.route == "stream" }) {
                    composable("stream") {
                        StreamScreen(apiClient, prefs, onLogout, onOpenWatch = { id -> navController.navigate("stream/watch/$id") })
                    }
                    composable(
                        "stream/watch/{id}",
                        arguments = listOf(navArgument("id") { type = NavType.StringType }),
                    ) { entry ->
                        val id = entry.arguments?.getString("id") ?: return@composable
                        StreamWatchScreen(id, apiClient, prefs, onLogout, onBack = { navController.popBackStack() })
                    }
                }
                if (visible.any { it.route == "tv" }) {
                    composable("tv") {
                        TvScreen(apiClient, onLogout, onOpenChannel = { id -> navController.navigate("tv/watch/$id") })
                    }
                    composable(
                        "tv/watch/{id}",
                        arguments = listOf(navArgument("id") { type = NavType.StringType }),
                    ) { entry ->
                        val id = entry.arguments?.getString("id") ?: return@composable
                        TvPlayerScreen(id, apiClient, prefs, onLogout, onBack = { navController.popBackStack() })
                    }
                }
            }
        }
    }
}

@Composable
private fun drawerItemColors() = NavigationDrawerItemDefaults.colors(
    selectedContainerColor = PanelBorder,
    unselectedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
    selectedTextColor = PanelTextPrimary,
    unselectedTextColor = PanelTextPrimary,
    selectedIconColor = PanelTextPrimary,
    unselectedIconColor = PanelTextMuted,
)

@Composable
private fun DrawerLeaf(screen: PanelScreen, selected: Boolean, onClick: () -> Unit, indent: Boolean = false) {
    NavigationDrawerItem(
        label = { Text(screen.label, style = MaterialTheme.typography.bodyLarge) },
        icon = { Icon(screen.icon, contentDescription = null, modifier = Modifier.size(20.dp)) },
        selected = selected,
        onClick = onClick,
        colors = drawerItemColors(),
        modifier = Modifier
            .padding(vertical = 2.dp)
            .let { if (indent) it.padding(start = 16.dp) else it },
    )
}


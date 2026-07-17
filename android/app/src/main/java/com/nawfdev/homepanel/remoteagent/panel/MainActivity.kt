package com.nawfdev.homepanel.remoteagent.panel

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.nawfdev.homepanel.remoteagent.panel.data.ApiClient
import com.nawfdev.homepanel.remoteagent.panel.data.PanelPrefs
import com.nawfdev.homepanel.remoteagent.panel.ui.nav.PanelNavHost
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.HomePanelTheme

/** New launcher Activity — the panel app shell. See remoteagent.MainActivity for the untouched remote-desktop viewer, launched from here via Intent. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = PanelPrefs(applicationContext)
        val apiClient = ApiClient(prefs)

        setContent {
            HomePanelTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    PanelNavHost(prefs, apiClient)
                }
            }
        }
    }
}

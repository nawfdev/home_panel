package com.nawfdev.homepanel.remoteagent.panel.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Mirrors android/app/src/main/res/values/colors.xml, which itself mirrors
// fe/src/index.css's neutral/zinc dark theme — keep both in sync by hand.
val PanelBg = Color(0xFF0A0A0B)
val PanelSurface = Color(0xFF131316)
val PanelBorder = Color(0x1AFFFFFF)
val PanelInputBg = Color(0x08FFFFFF)
val PanelTextPrimary = Color(0xFFFAFAFA)
val PanelTextSecondary = Color(0xFFD4D4D8)
val PanelTextMuted = Color(0xFFA1A1AA)
val PanelBtnPrimaryBg = Color(0xFFFAFAFA)
val PanelBtnPrimaryText = Color(0xFF0E0E10)
val PanelStatusGreen = Color(0xFF4ADE80)
val PanelStatusRed = Color(0xFFF87171)

private val PanelDarkScheme = darkColorScheme(
    background = PanelBg,
    surface = PanelSurface,
    primary = PanelBtnPrimaryBg,
    onPrimary = PanelBtnPrimaryText,
    onBackground = PanelTextPrimary,
    onSurface = PanelTextPrimary,
    outline = PanelBorder,
    secondary = PanelTextSecondary,
    error = PanelStatusRed,
)

// The panel is dark-only today (see colors.xml) — no separate light palette
// has been designed yet, so light mode falls back to the same dark scheme
// rather than guessing at colors nobody has reviewed.
private val PanelLightScheme = PanelDarkScheme

@Composable
fun HomePanelTheme(content: @Composable () -> Unit) {
    val colorScheme = if (isSystemInDarkTheme()) PanelDarkScheme else PanelLightScheme
    MaterialTheme(colorScheme = colorScheme, content = content)
}

package com.nawfdev.homepanel.remoteagent.panel.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.RoundedCornerShape

// Mirrors android/app/src/main/res/values/colors.xml, which itself mirrors
// fe/src/index.css's neutral/zinc dark theme — keep all three in sync by hand.
val PanelBg = Color(0xFF0A0A0B)
val PanelSurface = Color(0xFF131316)
val PanelBorder = Color(0x1AFFFFFF)
val PanelInputBg = Color(0x08FFFFFF)
val PanelInputBorder = Color(0xFF27272A)
val PanelTextPrimary = Color(0xFFFAFAFA)
val PanelTextSecondary = Color(0xFFD4D4D8)
val PanelTextMuted = Color(0xFFA1A1AA)
val PanelTextFaint = Color(0xFF71717A)
val PanelBtnPrimaryBg = Color(0xFFFAFAFA)
val PanelBtnPrimaryText = Color(0xFF0E0E10)
val PanelBtnSecondaryBg = Color(0x0FFFFFFF)
val PanelBtnSecondaryText = Color(0xFFF4F4F5)
val PanelBtnDangerBg = Color(0x1FEF4444)
val PanelBtnDangerText = Color(0xFFF87171)
val PanelStatusGreenBg = Color(0x2622C55E)
val PanelStatusGreen = Color(0xFF4ADE80)
val PanelStatusYellowBg = Color(0x26EAB308)
val PanelStatusYellow = Color(0xFFFACC15)
val PanelStatusRedBg = Color(0x26EF4444)
val PanelStatusRed = Color(0xFFF87171)

private val PanelDarkScheme = darkColorScheme(
    background = PanelBg,
    surface = PanelSurface,
    surfaceVariant = PanelSurface,
    primary = PanelBtnPrimaryBg,
    onPrimary = PanelBtnPrimaryText,
    onBackground = PanelTextPrimary,
    onSurface = PanelTextPrimary,
    outline = PanelBorder,
    secondary = PanelTextSecondary,
    tertiary = PanelTextMuted,
    error = PanelStatusRed,
)

// The panel is dark-only today (see colors.xml) — no separate light palette
// has been designed yet, so light mode falls back to the same dark scheme
// rather than guessing at colors nobody has reviewed.
private val PanelLightScheme = PanelDarkScheme

// Flat, hairline-cornered — the web design system uses small radii (6-10px)
// and never a pill/stadium shape except on true pills (status badges).
val PanelShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(10.dp),
    large = RoundedCornerShape(12.dp),
    extraLarge = RoundedCornerShape(16.dp),
)

private val defaultType = TextStyle(letterSpacing = 0.sp)

val PanelTypography = Typography(
    headlineSmall = defaultType.copy(fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = PanelTextPrimary),
    titleLarge = defaultType.copy(fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = PanelTextPrimary),
    titleMedium = defaultType.copy(fontSize = 15.sp, fontWeight = FontWeight.Medium, color = PanelTextPrimary),
    titleSmall = defaultType.copy(fontSize = 13.sp, fontWeight = FontWeight.Medium, color = PanelTextPrimary),
    bodyLarge = defaultType.copy(fontSize = 15.sp, color = PanelTextSecondary),
    bodyMedium = defaultType.copy(fontSize = 13.sp, color = PanelTextSecondary),
    bodySmall = defaultType.copy(fontSize = 12.sp, color = PanelTextMuted),
    labelLarge = defaultType.copy(fontSize = 13.sp, fontWeight = FontWeight.Medium, color = PanelTextPrimary),
    labelMedium = defaultType.copy(fontSize = 11.sp, fontWeight = FontWeight.Medium, color = PanelTextMuted, letterSpacing = 0.4.sp),
    labelSmall = defaultType.copy(fontSize = 10.sp, fontWeight = FontWeight.Medium, color = PanelTextFaint, letterSpacing = 0.4.sp),
)

@Composable
fun HomePanelTheme(content: @Composable () -> Unit) {
    val colorScheme = if (isSystemInDarkTheme()) PanelDarkScheme else PanelLightScheme
    MaterialTheme(colorScheme = colorScheme, shapes = PanelShapes, typography = PanelTypography, content = content)
}

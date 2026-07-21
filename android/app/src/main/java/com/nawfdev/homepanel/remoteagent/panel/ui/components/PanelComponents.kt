package com.nawfdev.homepanel.remoteagent.panel.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelBorder
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelBtnDangerBg
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelBtnDangerText
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelBtnPrimaryBg
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelBtnPrimaryText
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelBtnSecondaryBg
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelBtnSecondaryText
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelInputBg
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelInputBorder
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelStatusGreen
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelStatusGreenBg
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelStatusRed
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelStatusRedBg
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelStatusYellow
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelStatusYellowBg
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelSurface
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextFaint
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextMuted
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextPrimary
import com.nawfdev.homepanel.remoteagent.panel.ui.theme.PanelTextSecondary

/**
 * Shared building blocks for every panel screen — flat surfaces, hairline
 * borders, no shadows/tonal-elevation. Mirrors the web design system in
 * fe/src/index.css (Panel, .btn-primary/.btn-secondary/.btn-danger,
 * .info-row, .metric-strip, status pills). Screens should compose these
 * instead of reaching for stock Material3 Card/Button/TabRow, which default
 * to the generic Material look this redesign replaces.
 */

// --- Screen header -----------------------------------------------------

@Composable
fun ScreenHeader(
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column {
            Text(title, style = MaterialTheme.typography.headlineSmall)
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), content = actions)
    }
}

// --- Panel / card --------------------------------------------------------

@Composable
fun Panel(
    modifier: Modifier = Modifier,
    padding: Dp = 16.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = PanelSurface,
        shape = MaterialTheme.shapes.medium,
        border = BorderStroke(1.dp, PanelBorder),
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
    ) {
        Column(modifier = Modifier.padding(padding), content = content)
    }
}

// --- Buttons ---------------------------------------------------------------

@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    icon: ImageVector? = null,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier,
        shape = MaterialTheme.shapes.small,
        colors = ButtonDefaults.buttonColors(
            containerColor = PanelBtnPrimaryBg,
            contentColor = PanelBtnPrimaryText,
            disabledContainerColor = PanelBtnPrimaryBg.copy(alpha = 0.4f),
            disabledContentColor = PanelBtnPrimaryText.copy(alpha = 0.6f),
        ),
        elevation = ButtonDefaults.buttonElevation(0.dp, 0.dp, 0.dp, 0.dp, 0.dp),
    ) {
        ButtonContent(text, loading, icon, PanelBtnPrimaryText)
    }
}

@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    icon: ImageVector? = null,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier,
        shape = MaterialTheme.shapes.small,
        colors = ButtonDefaults.buttonColors(
            containerColor = PanelBtnSecondaryBg,
            contentColor = PanelBtnSecondaryText,
            disabledContainerColor = PanelBtnSecondaryBg,
            disabledContentColor = PanelBtnSecondaryText.copy(alpha = 0.5f),
        ),
        border = BorderStroke(1.dp, PanelBorder),
        elevation = ButtonDefaults.buttonElevation(0.dp, 0.dp, 0.dp, 0.dp, 0.dp),
    ) {
        ButtonContent(text, loading, icon, PanelBtnSecondaryText)
    }
}

@Composable
fun DangerButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    icon: ImageVector? = null,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier,
        shape = MaterialTheme.shapes.small,
        colors = ButtonDefaults.buttonColors(
            containerColor = PanelBtnDangerBg,
            contentColor = PanelBtnDangerText,
            disabledContainerColor = PanelBtnDangerBg,
            disabledContentColor = PanelBtnDangerText.copy(alpha = 0.5f),
        ),
        border = BorderStroke(1.dp, PanelBtnDangerText.copy(alpha = 0.3f)),
        elevation = ButtonDefaults.buttonElevation(0.dp, 0.dp, 0.dp, 0.dp, 0.dp),
    ) {
        ButtonContent(text, loading, icon, PanelBtnDangerText)
    }
}

@Composable
private fun ButtonContent(text: String, loading: Boolean, icon: ImageVector?, contentColor: Color) {
    if (loading) {
        CircularProgressIndicator(
            modifier = Modifier.size(16.dp),
            strokeWidth = 2.dp,
            color = contentColor,
        )
        Spacer(Modifier.width(8.dp))
    } else if (icon != null) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
    }
    Text(text, style = MaterialTheme.typography.labelLarge, color = contentColor)
}

// --- Text field --------------------------------------------------------

@Composable
fun PanelTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    enabled: Boolean = true,
    visualTransformation: androidx.compose.ui.text.input.VisualTransformation = androidx.compose.ui.text.input.VisualTransformation.None,
    keyboardOptions: androidx.compose.foundation.text.KeyboardOptions = androidx.compose.foundation.text.KeyboardOptions.Default,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = singleLine,
        enabled = enabled,
        visualTransformation = visualTransformation,
        keyboardOptions = keyboardOptions,
        shape = MaterialTheme.shapes.small,
        modifier = modifier.fillMaxWidth(),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = PanelInputBg,
            unfocusedContainerColor = PanelInputBg,
            disabledContainerColor = PanelInputBg,
            focusedBorderColor = PanelTextPrimary.copy(alpha = 0.4f),
            unfocusedBorderColor = PanelInputBorder,
            focusedTextColor = PanelTextPrimary,
            unfocusedTextColor = PanelTextPrimary,
            cursorColor = PanelTextPrimary,
            focusedLabelColor = PanelTextMuted,
            unfocusedLabelColor = PanelTextMuted,
        ),
    )
}

// --- Status pill ---------------------------------------------------------

enum class PillTone { Success, Warning, Danger, Neutral }

@Composable
fun StatusPill(text: String, tone: PillTone, modifier: Modifier = Modifier) {
    val (bg, fg) = when (tone) {
        PillTone.Success -> PanelStatusGreenBg to PanelStatusGreen
        PillTone.Warning -> PanelStatusYellowBg to PanelStatusYellow
        PillTone.Danger -> PanelStatusRedBg to PanelStatusRed
        PillTone.Neutral -> PanelInputBg to PanelTextMuted
    }
    Surface(color = bg, shape = MaterialTheme.shapes.extraLarge, modifier = modifier) {
        Text(
            text,
            style = MaterialTheme.typography.labelMedium,
            color = fg,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

// --- Info row (label-left / value-right list row) -----------------------

@Composable
fun InfoRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color = PanelTextPrimary,
    showDivider: Boolean = true,
    trailing: (@Composable () -> Unit)? = null,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = PanelTextMuted)
            if (trailing != null) {
                trailing()
            } else {
                Text(value, style = MaterialTheme.typography.titleSmall, color = valueColor, textAlign = TextAlign.End)
            }
        }
        if (showDivider) {
            Surface(color = PanelBorder, modifier = Modifier.fillMaxWidth().height(1.dp)) {}
        }
    }
}

// --- Metric strip (hairline-divided horizontal stat row) ----------------

@Composable
fun MetricStrip(items: List<Pair<String, String>>, modifier: Modifier = Modifier) {
    Panel(modifier = modifier, padding = 0.dp) {
        Row(modifier = Modifier.fillMaxWidth()) {
            items.forEachIndexed { index, (label, value) ->
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .padding(16.dp),
                ) {
                    Text(value, style = MaterialTheme.typography.titleLarge)
                    Text(
                        label.uppercase(),
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                if (index != items.lastIndex) {
                    Surface(
                        color = PanelBorder,
                        modifier = Modifier
                            .fillMaxHeight()
                            .width(1.dp)
                            .padding(vertical = 12.dp),
                    ) {}
                }
            }
        }
    }
}

// --- States ---------------------------------------------------------------

@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.bodyMedium, modifier = modifier.padding(vertical = 16.dp))
}

@Composable
fun ErrorText(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = PanelStatusRed, modifier = modifier.padding(top = 8.dp))
}

@Composable
fun LoadingState(modifier: Modifier = Modifier) {
    Box(modifier = modifier.padding(vertical = 24.dp)) {
        CircularProgressIndicator(color = PanelTextPrimary, modifier = Modifier.size(28.dp), strokeWidth = 2.dp)
    }
}

// --- Dialog (parity with fe/src/components/ui/Modal.tsx) -----------------

@Composable
fun PanelDialog(
    title: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        Surface(
            modifier = modifier.fillMaxWidth(),
            color = PanelSurface,
            shape = MaterialTheme.shapes.large,
            border = BorderStroke(1.dp, PanelBorder),
        ) {
            Column(modifier = Modifier.padding(20.dp)) {
                Text(title, style = MaterialTheme.typography.titleLarge)
                Column(modifier = Modifier.padding(top = 16.dp), content = content)
            }
        }
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        modifier = modifier.padding(bottom = 8.dp),
    )
}

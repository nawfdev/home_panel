package com.nawfdev.homepanel.remoteagent.panel.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Encrypted local storage for the panel connection: base URL, bearer token
 * (issued by POST /api/auth/login — see be/internal/handlers/auth.go) and a
 * cached copy of the current user's role/features so the nav shell can
 * render before the first /api/auth/me round-trip completes.
 */
class PanelPrefs(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "panel_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var baseUrl: String?
        get() = prefs.getString(KEY_BASE_URL, null)
        set(value) = prefs.edit().putString(KEY_BASE_URL, value).apply()

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_TOKEN, value).apply()

    var username: String?
        get() = prefs.getString(KEY_USERNAME, null)
        set(value) = prefs.edit().putString(KEY_USERNAME, value).apply()

    var role: String?
        get() = prefs.getString(KEY_ROLE, null)
        set(value) = prefs.edit().putString(KEY_ROLE, value).apply()

    var features: Set<String>
        get() = prefs.getStringSet(KEY_FEATURES, emptySet()) ?: emptySet()
        set(value) = prefs.edit().putStringSet(KEY_FEATURES, value).apply()

    val isLoggedIn: Boolean
        get() = !baseUrl.isNullOrBlank() && !token.isNullOrBlank()

    fun clear() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val KEY_BASE_URL = "base_url"
        const val KEY_TOKEN = "token"
        const val KEY_USERNAME = "username"
        const val KEY_ROLE = "role"
        const val KEY_FEATURES = "features"
    }
}

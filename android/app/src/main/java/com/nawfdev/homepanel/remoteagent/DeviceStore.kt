package com.nawfdev.homepanel.remoteagent

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class SavedDevice(val name: String, val host: String, val port: Int, val token: String)

// Local-only connection history — never synced with the panel backend, just
// a convenience list of previously used host/port/token combos so returning
// to a device is a single tap instead of retyping everything.
class DeviceStore(context: Context) {
    private val prefs = context.getSharedPreferences("remote_agent_devices", Context.MODE_PRIVATE)

    fun list(): List<SavedDevice> {
        val raw = prefs.getString("devices", "[]") ?: "[]"
        val arr = runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            SavedDevice(o.getString("name"), o.getString("host"), o.getInt("port"), o.getString("token"))
        }
    }

    fun upsert(device: SavedDevice) {
        val devices = list().filterNot { it.host == device.host && it.port == device.port }.toMutableList()
        devices.add(0, device)
        save(devices)
    }

    fun remove(device: SavedDevice) {
        save(list().filterNot { it.host == device.host && it.port == device.port })
    }

    private fun save(devices: List<SavedDevice>) {
        val arr = JSONArray()
        devices.forEach {
            arr.put(
                JSONObject()
                    .put("name", it.name)
                    .put("host", it.host)
                    .put("port", it.port)
                    .put("token", it.token)
            )
        }
        prefs.edit().putString("devices", arr.toString()).apply()
    }
}

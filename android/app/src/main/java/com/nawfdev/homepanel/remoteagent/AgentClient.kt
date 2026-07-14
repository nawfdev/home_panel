package com.nawfdev.homepanel.remoteagent

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit

private const val FRAME_TAG: Byte = 0x01
private const val FILE_CHUNK_TAG: Byte = 0x02

/**
 * Talks the remoteagent WebSocket protocol directly (same wire format the
 * web panel's viewer uses) — no panel backend involved, same-LAN only.
 */
class AgentClient(
    private val host: String,
    private val port: Int,
    private val token: String,
    private val onStatus: (String) -> Unit,
    private val onFrame: (Bitmap) -> Unit,
    private val onClipboard: (String) -> Unit,
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()
    private var ws: WebSocket? = null

    fun connect() {
        val url = "ws://$host:$port/ws?token=$token"
        val request = Request.Builder().url(url).build()
        onStatus("connecting")
        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                mainHandler.post { onStatus("connected") }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val msg = runCatching { JSONObject(text) }.getOrNull() ?: return
                if (msg.optString("type") == "clipboard") {
                    val value = msg.optString("text")
                    mainHandler.post { onClipboard(value) }
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                if (bytes.size < 1 || bytes[0] != FRAME_TAG) return
                val jpeg = bytes.substring(1).toByteArray()
                val bmp = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size) ?: return
                mainHandler.post { onFrame(bmp) }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                mainHandler.post { onStatus("disconnected") }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                mainHandler.post { onStatus("error") }
            }
        })
    }

    fun close() {
        ws?.close(1000, "bye")
        ws = null
    }

    private fun sendJson(obj: JSONObject) {
        ws?.send(obj.toString())
    }

    fun mouseMove(xNorm: Float, yNorm: Float) {
        sendJson(JSONObject().put("type", "mouse_move").put("x", xNorm).put("y", yNorm))
    }

    fun mouseDown(button: String, xNorm: Float, yNorm: Float) {
        sendJson(JSONObject().put("type", "mouse_down").put("button", button).put("x", xNorm).put("y", yNorm))
    }

    fun mouseUp(button: String, xNorm: Float, yNorm: Float) {
        sendJson(JSONObject().put("type", "mouse_up").put("button", button).put("x", xNorm).put("y", yNorm))
    }

    fun scroll(dy: Float) {
        sendJson(JSONObject().put("type", "scroll").put("dy", dy))
    }

    fun typeText(text: String) {
        if (text.isEmpty()) return
        sendJson(JSONObject().put("type", "type_text").put("text", text))
    }

    fun keyCode(code: String, down: Boolean) {
        sendJson(JSONObject().put("type", if (down) "key_down" else "key_up").put("code", code))
    }

    fun sendClipboard(text: String) {
        sendJson(JSONObject().put("type", "clipboard").put("text", text))
    }

    fun sendFile(name: String, size: Long, bytes: ByteArray) {
        sendJson(JSONObject().put("type", "file_offer").put("name", name).put("size", size))
        var offset = 0
        val chunkSize = 64 * 1024
        while (offset < bytes.size) {
            val end = minOf(offset + chunkSize, bytes.size)
            val framed = ByteArray(end - offset + 1)
            framed[0] = FILE_CHUNK_TAG
            System.arraycopy(bytes, offset, framed, 1, end - offset)
            ws?.send(ByteString.of(*framed))
            offset = end
        }
        sendJson(JSONObject().put("type", "file_end"))
    }
}

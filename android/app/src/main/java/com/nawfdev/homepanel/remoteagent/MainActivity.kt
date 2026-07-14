package com.nawfdev.homepanel.remoteagent

import android.content.Context
import android.graphics.Bitmap
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.nawfdev.homepanel.remoteagent.databinding.ActivityMainBinding

private const val PREFS = "remote_agent_prefs"

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private lateinit var deviceStore: DeviceStore
    private var client: AgentClient? = null
    private var lastNormX = 0.5f
    private var lastNormY = 0.5f
    private lateinit var gestureDetector: GestureDetector

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        deviceStore = DeviceStore(this)

        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        binding.nameInput.setText(prefs.getString("name", ""))
        binding.hostInput.setText(prefs.getString("host", ""))
        binding.portInput.setText(prefs.getString("port", "8791"))
        binding.tokenInput.setText(prefs.getString("token", ""))

        binding.connectButton.setOnClickListener { connect(prefs) }
        binding.backButton.setOnClickListener { disconnect() }
        binding.keyboardButton.setOnClickListener { showKeyboard() }
        binding.tabNewButton.setOnClickListener { showTab(showHistory = false) }
        binding.tabHistoryButton.setOnClickListener { showTab(showHistory = true) }

        setupTouch()
        setupImeCapture()
    }

    private fun showTab(showHistory: Boolean) {
        binding.newConnectionSection.visibility = if (showHistory) View.GONE else View.VISIBLE
        binding.historySection.visibility = if (showHistory) View.VISIBLE else View.GONE
        binding.tabNewButton.background = getDrawable(if (showHistory) R.drawable.bg_button_secondary else R.drawable.bg_button_primary)
        binding.tabNewButton.setTextColor(getColor(if (showHistory) R.color.btn_secondary_text else R.color.btn_primary_text))
        binding.tabHistoryButton.background = getDrawable(if (showHistory) R.drawable.bg_button_primary else R.drawable.bg_button_secondary)
        binding.tabHistoryButton.setTextColor(getColor(if (showHistory) R.color.btn_primary_text else R.color.btn_secondary_text))
        if (showHistory) renderHistory()
    }

    private fun renderHistory() {
        val container = binding.historySection
        container.removeAllViews()
        val devices = deviceStore.list()
        if (devices.isEmpty()) {
            container.addView(TextView(this).apply {
                text = "No saved connections yet. Connect once from \"New Connection\" and it'll show up here."
                setTextColor(getColor(R.color.text_faint))
                textSize = 13f
            })
            return
        }
        for (device in devices) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, 12, 0, 12)
                gravity = android.view.Gravity.CENTER_VERTICAL
            }
            val label = TextView(this).apply {
                text = "${device.name}\n${device.host}:${device.port}"
                setTextColor(getColor(R.color.text_primary))
                textSize = 13f
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            val deleteButton = Button(this).apply {
                text = "Remove"
                textSize = 11f
                isAllCaps = false
                background = getDrawable(R.drawable.bg_button_secondary)
                setTextColor(getColor(R.color.btn_secondary_text))
                setOnClickListener {
                    deviceStore.remove(device)
                    renderHistory()
                }
            }
            row.setOnClickListener { connectToSaved(device) }
            row.addView(label)
            row.addView(deleteButton)
            container.addView(row)
        }
    }

    private fun connectToSaved(device: SavedDevice) {
        binding.nameInput.setText(device.name)
        binding.hostInput.setText(device.host)
        binding.portInput.setText(device.port.toString())
        binding.tokenInput.setText(device.token)
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        connect(prefs)
    }

    private fun connect(prefs: android.content.SharedPreferences) {
        val name = binding.nameInput.text.toString().trim()
        val host = binding.hostInput.text.toString().trim()
        val portStr = binding.portInput.text.toString().trim()
        val token = binding.tokenInput.text.toString().trim()
        val port = portStr.toIntOrNull()
        if (host.isEmpty() || port == null || token.isEmpty()) {
            binding.statusText.text = "Host, port, and token are required"
            return
        }
        val displayName = name.ifEmpty { host }
        prefs.edit()
            .putString("name", name)
            .putString("host", host)
            .putString("port", portStr)
            .putString("token", token)
            .apply()
        deviceStore.upsert(SavedDevice(displayName, host, port, token))

        binding.connectForm.visibility = View.GONE
        binding.viewerContainer.visibility = View.VISIBLE
        binding.deviceNameText.text = displayName
        enterFullscreen()

        client = AgentClient(
            host = host,
            port = port,
            token = token,
            onStatus = ::updateStatus,
            onFrame = ::showFrame,
            onClipboard = { /* v1: clipboard from remote is shown nowhere yet; extend if needed */ },
        )
        client?.connect()
    }

    private fun disconnect() {
        client?.close()
        client = null
        binding.viewerContainer.visibility = View.GONE
        binding.connectForm.visibility = View.VISIBLE
        binding.screenImage.setImageBitmap(null)
        exitFullscreen()
    }

    private fun enterFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, binding.root)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    private fun exitFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(window, true)
        WindowInsetsControllerCompat(window, binding.root).show(WindowInsetsCompat.Type.systemBars())
    }

    private fun updateStatus(status: String) {
        binding.connStatusText.text = status
        val (bg, fg) = when (status) {
            "connected" -> R.color.status_green_bg to R.color.status_green_text
            "connecting" -> R.color.status_yellow_bg to R.color.status_yellow_text
            else -> R.color.status_red_bg to R.color.status_red_text
        }
        binding.connStatusText.background.setTint(getColor(bg))
        binding.connStatusText.setTextColor(getColor(fg))
    }

    private fun showFrame(bmp: Bitmap) {
        binding.screenImage.setImageBitmap(bmp)
    }

    private fun setupTouch() {
        gestureDetector = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onLongPress(e: MotionEvent) {
                client?.mouseDown("right", lastNormX, lastNormY)
                client?.mouseUp("right", lastNormX, lastNormY)
            }
        })

        binding.screenImage.setOnTouchListener { view, event ->
            if (view.width == 0 || view.height == 0) return@setOnTouchListener true
            lastNormX = (event.x / view.width).coerceIn(0f, 1f)
            lastNormY = (event.y / view.height).coerceIn(0f, 1f)
            gestureDetector.onTouchEvent(event)
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    client?.mouseMove(lastNormX, lastNormY)
                    client?.mouseDown("left", lastNormX, lastNormY)
                }
                MotionEvent.ACTION_MOVE -> client?.mouseMove(lastNormX, lastNormY)
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL ->
                    client?.mouseUp("left", lastNormX, lastNormY)
            }
            true
        }
    }

    private fun showKeyboard() {
        binding.imeCapture.requestFocus()
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        imm.showSoftInput(binding.imeCapture, InputMethodManager.SHOW_IMPLICIT)
    }

    // The IME field is a relay, not a real text buffer. It always holds a
    // single zero-width placeholder character so backspace on an otherwise
    // "empty" field still has something to delete — a truly empty EditText
    // never fires a change event on backspace. inputType=textMultiLine (set
    // in the layout) makes Enter insert a literal '\n' instead of firing a
    // "Done" IME action, which is what let Enter silently do nothing before.
    private val imePlaceholder = "​"
    private var imeGuard = false

    private fun setupImeCapture() {
        binding.imeCapture.setText(imePlaceholder)
        binding.imeCapture.setSelection(imePlaceholder.length)

        binding.imeCapture.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}

            override fun afterTextChanged(s: Editable?) {
                if (imeGuard) return
                val text = s?.toString().orEmpty()

                when {
                    text.length > imePlaceholder.length && text.startsWith(imePlaceholder) ->
                        relayTypedText(text.substring(imePlaceholder.length))
                    text.length < imePlaceholder.length || !text.startsWith(imePlaceholder) -> {
                        client?.keyCode("Backspace", true)
                        client?.keyCode("Backspace", false)
                    }
                }

                imeGuard = true
                s?.replace(0, s.length, imePlaceholder)
                binding.imeCapture.setSelection(imePlaceholder.length)
                imeGuard = false
            }
        })
    }

    // Splits typed text on '\n' so Enter is sent as a real key event (some
    // apps on the remote end care about an actual Enter keypress, not a
    // pasted newline character) while everything else still goes through
    // Unicode injection.
    private fun relayTypedText(added: String) {
        val buffer = StringBuilder()
        for (ch in added) {
            if (ch == '\n') {
                if (buffer.isNotEmpty()) {
                    client?.typeText(buffer.toString())
                    buffer.clear()
                }
                client?.keyCode("Enter", true)
                client?.keyCode("Enter", false)
            } else {
                buffer.append(ch)
            }
        }
        if (buffer.isNotEmpty()) client?.typeText(buffer.toString())
    }

    override fun onDestroy() {
        super.onDestroy()
        client?.close()
    }
}

package com.nawfdev.homepanel.remoteagent

import android.content.Context
import android.graphics.Bitmap
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.inputmethod.InputMethodManager
import androidx.appcompat.app.AppCompatActivity
import com.nawfdev.homepanel.remoteagent.databinding.ActivityMainBinding

private const val PREFS = "remote_agent_prefs"

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private var client: AgentClient? = null
    private var lastNormX = 0.5f
    private var lastNormY = 0.5f
    private lateinit var gestureDetector: GestureDetector

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        binding.hostInput.setText(prefs.getString("host", ""))
        binding.portInput.setText(prefs.getString("port", "8791"))
        binding.tokenInput.setText(prefs.getString("token", ""))

        binding.connectButton.setOnClickListener { connect(prefs) }
        binding.backButton.setOnClickListener { disconnect() }
        binding.keyboardButton.setOnClickListener { showKeyboard() }

        setupTouch()
        setupImeCapture()
    }

    private fun connect(prefs: android.content.SharedPreferences) {
        val host = binding.hostInput.text.toString().trim()
        val portStr = binding.portInput.text.toString().trim()
        val token = binding.tokenInput.text.toString().trim()
        val port = portStr.toIntOrNull()
        if (host.isEmpty() || port == null || token.isEmpty()) {
            binding.statusText.text = "Host, port, and token are required"
            return
        }
        prefs.edit().putString("host", host).putString("port", portStr).putString("token", token).apply()

        binding.connectForm.visibility = android.view.View.GONE
        binding.viewerContainer.visibility = android.view.View.VISIBLE
        binding.deviceNameText.text = host

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
        binding.viewerContainer.visibility = android.view.View.GONE
        binding.connectForm.visibility = android.view.View.VISIBLE
        binding.screenImage.setImageBitmap(null)
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
    // "empty" field still has something to delete — an EditText that's
    // truly empty never fires a change event on backspace, which is why
    // deleting used to silently do nothing after typing.
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
                        client?.typeText(text.substring(imePlaceholder.length))
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

    override fun onDestroy() {
        super.onDestroy()
        client?.close()
    }
}

//go:build windows

package main

import (
	"sync"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

var (
	user32        = syscall.NewLazyDLL("user32.dll")
	procSendInput = user32.NewProc("SendInput")
)

const (
	inputMouse    uint32 = 0
	inputKeyboard uint32 = 1

	mouseEventfMove      uint32 = 0x0001
	mouseEventfAbsolute  uint32 = 0x8000
	mouseEventfLeftDown  uint32 = 0x0002
	mouseEventfLeftUp    uint32 = 0x0004
	mouseEventfRightDown uint32 = 0x0008
	mouseEventfRightUp   uint32 = 0x0010
	mouseEventfMidDown   uint32 = 0x0020
	mouseEventfMidUp     uint32 = 0x0040
	mouseEventfWheel     uint32 = 0x0800

	keyEventfKeyUp   uint32 = 0x0002
	keyEventfUnicode uint32 = 0x0004
)

// mouseInput/keybdInput/rawInput mirror the win32 MOUSEINPUT/KEYBDINPUT/INPUT
// structs closely enough (same field order, Go's own alignment matches the
// C ABI here) that SendInput accepts them directly via unsafe.Pointer.
type mouseInput struct {
	dx, dy      int32
	mouseData   uint32
	dwFlags     uint32
	time        uint32
	dwExtraInfo uintptr
}

type keybdInput struct {
	wVk         uint16
	wScan       uint16
	dwFlags     uint32
	time        uint32
	dwExtraInfo uintptr
}

type mouseRawInput struct {
	typ uint32
	_   uint32
	mi  mouseInput
}

type keybdRawInput struct {
	typ uint32
	_   uint32
	ki  keybdInput
	_   [8]byte // pad union to MOUSEINPUT's size so cbSize matches real INPUT
}

func sendMouseRaw(mi mouseInput) {
	in := mouseRawInput{typ: inputMouse, mi: mi}
	procSendInput.Call(1, uintptr(unsafe.Pointer(&in)), unsafe.Sizeof(in))
}

func sendKeybdRaw(ki keybdInput) {
	in := keybdRawInput{typ: inputKeyboard, ki: ki}
	procSendInput.Call(1, uintptr(unsafe.Pointer(&in)), unsafe.Sizeof(in))
}

func sendMouseMove(xNorm, yNorm float64) {
	sendMouseRaw(mouseInput{
		dx:      int32(clamp01(xNorm) * 65535),
		dy:      int32(clamp01(yNorm) * 65535),
		dwFlags: mouseEventfMove | mouseEventfAbsolute,
	})
}

func sendMouseButton(button string, down bool) {
	var flags uint32
	switch button {
	case "right":
		if down {
			flags = mouseEventfRightDown
		} else {
			flags = mouseEventfRightUp
		}
	case "middle":
		if down {
			flags = mouseEventfMidDown
		} else {
			flags = mouseEventfMidUp
		}
	default:
		if down {
			flags = mouseEventfLeftDown
		} else {
			flags = mouseEventfLeftUp
		}
	}
	sendMouseRaw(mouseInput{dwFlags: flags})
}

func sendScroll(dy float64) {
	// WHEEL_DELTA is 120 per notch; the browser sends raw deltaY, so this
	// isn't pixel-perfect but tracks direction/magnitude well enough for v1.
	sendMouseRaw(mouseInput{dwFlags: mouseEventfWheel, mouseData: uint32(int32(-dy))})
}

var (
	heldKeysMu sync.Mutex
	heldKeys   = map[uint16]bool{}
)

func sendKey(code string, down bool) {
	vk, ok := keyCodeToVK[code]
	if !ok {
		return
	}
	flags := uint32(0)
	if !down {
		flags = keyEventfKeyUp
	}
	sendKeybdRaw(keybdInput{wVk: vk, dwFlags: flags})

	heldKeysMu.Lock()
	if down {
		heldKeys[vk] = true
	} else {
		delete(heldKeys, vk)
	}
	heldKeysMu.Unlock()
}

// sendUnicodeText injects arbitrary text via KEYEVENTF_UNICODE instead of
// virtual-key codes — this is what mobile soft keyboards need, since IME
// input arrives as committed text (InputConnection.commitText), not the
// discrete physical KeyEvents the code-based keyCodeToVK path expects.
func sendUnicodeText(text string) {
	for _, u16 := range utf16.Encode([]rune(text)) {
		sendKeybdRaw(keybdInput{wScan: u16, dwFlags: keyEventfUnicode})
		sendKeybdRaw(keybdInput{wScan: u16, dwFlags: keyEventfUnicode | keyEventfKeyUp})
	}
}

// releaseAllKeys is the disconnect safety net: without it a viewer that
// drops mid-keypress (closed tab, network blip) could leave a modifier or
// letter key "stuck" down on the controlled machine indefinitely.
func releaseAllKeys() {
	heldKeysMu.Lock()
	vks := make([]uint16, 0, len(heldKeys))
	for vk := range heldKeys {
		vks = append(vks, vk)
	}
	heldKeys = map[uint16]bool{}
	heldKeysMu.Unlock()

	for _, vk := range vks {
		sendKeybdRaw(keybdInput{wVk: vk, dwFlags: keyEventfKeyUp})
	}
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// keyCodeToVK maps JS KeyboardEvent.code (layout-independent) to Windows
// virtual-key codes. Covers standard typing/navigation; exotic keys are
// simply dropped by sendKey's ok check.
var keyCodeToVK = buildKeyMap()

func buildKeyMap() map[string]uint16 {
	m := map[string]uint16{
		"Enter": 0x0D, "Escape": 0x1B, "Backspace": 0x08, "Tab": 0x09, "Space": 0x20,
		"ShiftLeft": 0xA0, "ShiftRight": 0xA1, "ControlLeft": 0xA2, "ControlRight": 0xA3,
		"AltLeft": 0xA4, "AltRight": 0xA5, "MetaLeft": 0x5B, "MetaRight": 0x5C,
		"ArrowUp": 0x26, "ArrowDown": 0x28, "ArrowLeft": 0x25, "ArrowRight": 0x27,
		"Home": 0x24, "End": 0x23, "PageUp": 0x21, "PageDown": 0x22,
		"Delete": 0x2E, "Insert": 0x2D, "CapsLock": 0x14,
		"Minus": 0xBD, "Equal": 0xBB, "BracketLeft": 0xDB, "BracketRight": 0xDD,
		"Backslash": 0xDC, "Semicolon": 0xBA, "Quote": 0xDE,
		"Comma": 0xBC, "Period": 0xBE, "Slash": 0xBF, "Backquote": 0xC0,
	}
	for c := byte('A'); c <= 'Z'; c++ {
		m["Key"+string(c)] = uint16(c)
	}
	for d := byte('0'); d <= '9'; d++ {
		m["Digit"+string(d)] = uint16(d)
	}
	for n := 0; n <= 9; n++ {
		m["Numpad"+string(rune('0'+n))] = uint16(0x60 + n)
	}
	for f := 1; f <= 12; f++ {
		m["F"+itoa(f)] = uint16(0x70 + f - 1)
	}
	return m
}

func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	return string(rune('0'+n/10)) + string(rune('0'+n%10))
}

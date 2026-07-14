//go:build !windows

package main

// Input injection is Windows-only for v1 (the panel's stated target). These
// no-op stubs just keep `go build ./...` green on other platforms.
func sendMouseMove(xNorm, yNorm float64)       {}
func sendMouseButton(button string, down bool) {}
func sendScroll(dy float64)                    {}
func sendKey(code string, down bool)           {}
func sendUnicodeText(text string)              {}
func releaseAllKeys()                          {}

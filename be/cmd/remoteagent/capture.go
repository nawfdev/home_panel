package main

import (
	"bytes"
	"image/jpeg"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kbinani/screenshot"
)

const frameInterval = 120 * time.Millisecond // ~8fps, tuned for LAN JPEG streaming

// frameTag/fileChunkTag prefix binary WS messages so the reader can tell them
// apart without a second control channel.
const (
	frameTag     byte = 0x01
	fileChunkTag byte = 0x02
)

// streamScreen pushes JPEG-encoded frames of the primary display until ctx
// (via done) closes or the write fails.
func streamScreen(conn *websocket.Conn, done <-chan struct{}, writeMu *sendLock) {
	ticker := time.NewTicker(frameInterval)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			img, err := screenshot.CaptureDisplay(0)
			if err != nil {
				continue
			}
			var buf bytes.Buffer
			buf.WriteByte(frameTag)
			if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 45}); err != nil {
				continue
			}
			if !writeMu.writeBinary(conn, buf.Bytes()) {
				return
			}
		}
	}
}

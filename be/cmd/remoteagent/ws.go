package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/atotto/clipboard"
	"github.com/gorilla/websocket"
)

// sendLock serializes writes to a *websocket.Conn: gorilla/websocket forbids
// concurrent writers, and the frame loop, clipboard loop and read loop (for
// acks) all write to the same connection.
type sendLock struct{ mu sync.Mutex }

func (s *sendLock) writeBinary(conn *websocket.Conn, data []byte) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return conn.WriteMessage(websocket.BinaryMessage, data) == nil
}

func (s *sendLock) writeJSON(conn *websocket.Conn, v any) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return conn.WriteJSON(v) == nil
}

// clientMsg covers every JSON control message in both directions; only the
// fields relevant to Type are populated.
type clientMsg struct {
	Type   string  `json:"type"`
	X      float64 `json:"x,omitempty"`
	Y      float64 `json:"y,omitempty"`
	Button string  `json:"button,omitempty"`
	Dy     float64 `json:"dy,omitempty"`
	Code   string  `json:"code,omitempty"`
	Text   string  `json:"text,omitempty"`
	Name   string  `json:"name,omitempty"`
	Size   int64   `json:"size,omitempty"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin:     func(r *http.Request) bool { return true }, // LAN-only agent, no browser session to check against
	ReadBufferSize:  1 << 16,
	WriteBufferSize: 1 << 16,
}

func wsHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("token") != cfg.Token {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		log.Println("remote-desktop viewer connected")

		var lock sendLock
		done := make(chan struct{})
		var once sync.Once
		closeDone := func() { once.Do(func() { close(done) }) }

		go streamScreen(conn, done, &lock)
		go clipboardWatcher(conn, done, &lock)

		var receiving *receivingFile
		lastClipboardFromViewer = ""

		for {
			msgType, data, err := conn.ReadMessage()
			if err != nil {
				break
			}
			if msgType == websocket.BinaryMessage {
				if receiving != nil {
					receiving.write(data)
				}
				continue
			}
			var msg clientMsg
			if json.Unmarshal(data, &msg) != nil {
				continue
			}
			switch msg.Type {
			case "mouse_move":
				sendMouseMove(msg.X, msg.Y)
			case "mouse_down":
				sendMouseButton(msg.Button, true)
			case "mouse_up":
				sendMouseButton(msg.Button, false)
			case "scroll":
				sendScroll(msg.Dy)
			case "key_down":
				sendKey(msg.Code, true)
			case "key_up":
				sendKey(msg.Code, false)
			case "type_text":
				sendUnicodeText(msg.Text)
			case "clipboard":
				lastClipboardFromViewer = msg.Text
				_ = clipboard.WriteAll(msg.Text)
			case "file_offer":
				receiving = newReceivingFile(msg.Name, msg.Size)
			case "file_end":
				if receiving != nil {
					receiving.finish()
					receiving = nil
				}
			}
		}

		closeDone()
		releaseAllKeys()
		log.Println("remote-desktop viewer disconnected")
	}
}

// lastClipboardFromViewer suppresses the echo where writing the viewer's
// clipboard text back to the OS clipboard triggers our own poll loop to
// re-broadcast it as if the agent's clipboard had changed independently.
var lastClipboardFromViewer string

func clipboardWatcher(conn *websocket.Conn, done <-chan struct{}, lock *sendLock) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	last, _ := clipboard.ReadAll()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			cur, err := clipboard.ReadAll()
			if err != nil || cur == last || cur == lastClipboardFromViewer {
				continue
			}
			last = cur
			if !lock.writeJSON(conn, clientMsg{Type: "clipboard", Text: cur}) {
				return
			}
		}
	}
}

// receivingFile buffers an in-flight upload from the viewer and flushes it to
// disk on file_end. Filenames are sanitized to a bare basename so a remote
// peer can't write outside the target directory.
type receivingFile struct {
	f *os.File
}

func newReceivingFile(name string, _ int64) *receivingFile {
	dir := filepath.Join(os.Getenv("USERPROFILE"), "Downloads", "RemoteAgentReceived")
	if dir == "" {
		dir = "RemoteAgentReceived"
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Printf("remote-desktop: mkdir received dir: %v", err)
		return nil
	}
	safeName := filepath.Base(name)
	f, err := os.Create(filepath.Join(dir, safeName))
	if err != nil {
		log.Printf("remote-desktop: create received file: %v", err)
		return nil
	}
	return &receivingFile{f: f}
}

func (r *receivingFile) write(data []byte) {
	if r == nil || r.f == nil || len(data) == 0 {
		return
	}
	// Strip the leading tag byte set by the browser's chunk framing.
	if data[0] == fileChunkTag {
		data = data[1:]
	}
	_, _ = r.f.Write(data)
}

func (r *receivingFile) finish() {
	if r == nil || r.f == nil {
		return
	}
	name := r.f.Name()
	_ = r.f.Close()
	log.Printf("remote-desktop: received file saved to %s", name)
}

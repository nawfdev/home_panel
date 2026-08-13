package terminal

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/nawfdev/home-panel/internal/audit"
	"github.com/nawfdev/home-panel/internal/session"
	"github.com/nawfdev/home-panel/internal/store"
)

func TestLocalTerminalWebSocketIsInteractive(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "db.json"))
	if err != nil {
		t.Fatal(err)
	}
	auditLog, err := audit.Open(filepath.Join(t.TempDir(), "audit.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	service := New(nil, nil, st, auditLog)
	user := session.SessionUser{ID: 1, Username: "tester", Role: "admin"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		service.Handler(w, r.WithContext(session.WithUser(r.Context(), user)))
	}))
	defer server.Close()

	wsURL, _ := url.Parse(server.URL)
	wsURL.Scheme = "ws"
	wsURL.RawQuery = "cols=90&rows=25"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL.String(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.SetReadDeadline(time.Now().Add(10 * time.Second)); err != nil {
		t.Fatal(err)
	}

	marker := "HOMEPANEL_PTY_OK"
	command := []byte("echo " + marker + "\r")
	if err := conn.WriteMessage(websocket.BinaryMessage, command); err != nil {
		t.Fatal(err)
	}
	resize, _ := json.Marshal(resizeMessage{Type: "resize", Cols: 120, Rows: 40})
	if err := conn.WriteMessage(websocket.TextMessage, resize); err != nil {
		t.Fatal(err)
	}

	var output bytes.Buffer
	for !bytes.Contains(output.Bytes(), []byte(marker)) {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read terminal output: %v; output=%q", err, output.String())
		}
		output.Write(payload)
	}
}

func TestHandleControlValidatesResize(t *testing.T) {
	terminal := &fakeTerminal{}
	if err := handleControl(terminal, []byte(`{"type":"resize","cols":132,"rows":43}`)); err != nil {
		t.Fatal(err)
	}
	if terminal.cols != 132 || terminal.rows != 43 {
		t.Fatalf("resize = %dx%d, want 132x43", terminal.cols, terminal.rows)
	}
	if err := handleControl(terminal, []byte(`{"type":"resize","cols":0,"rows":43}`)); err != nil {
		t.Fatal(err)
	}
	if terminal.resizeCalls != 1 {
		t.Fatalf("invalid resize reached terminal: calls=%d", terminal.resizeCalls)
	}
}

type fakeTerminal struct {
	cols, rows  uint16
	resizeCalls int
}

func (f *fakeTerminal) Read([]byte) (int, error)    { return 0, io.EOF }
func (f *fakeTerminal) Write(p []byte) (int, error) { return len(p), nil }
func (f *fakeTerminal) Close() error                { return nil }
func (f *fakeTerminal) Wait() error                 { return nil }
func (f *fakeTerminal) Resize(cols, rows uint16) error {
	f.cols, f.rows = cols, rows
	f.resizeCalls++
	return nil
}

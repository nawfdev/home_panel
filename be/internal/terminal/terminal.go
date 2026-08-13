// Package terminal exposes authenticated interactive shell sessions over WebSocket.
package terminal

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/nawfdev/home-panel/internal/audit"
	"github.com/nawfdev/home-panel/internal/session"
	"github.com/nawfdev/home-panel/internal/sshmgr"
	"github.com/nawfdev/home-panel/internal/store"
	"golang.org/x/crypto/ssh"
)

const (
	defaultCols = 100
	defaultRows = 30
	maxCols     = 500
	maxRows     = 200
)

type resizeMessage struct {
	Type string `json:"type"`
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

type terminalSession interface {
	io.ReadWriteCloser
	Resize(cols, rows uint16) error
	Wait() error
}

type Service struct {
	sshMgr   *sshmgr.Manager
	store    *store.Store
	audit    *audit.Logger
	upgrader websocket.Upgrader
}

func New(_ *session.Manager, sshMgr *sshmgr.Manager, st *store.Store, auditLog *audit.Logger) *Service {
	return &Service{
		sshMgr: sshMgr,
		store:  st,
		audit:  auditLog,
		upgrader: websocket.Upgrader{
			CheckOrigin: sameOrigin,
		},
	}
}

func (s *Service) Handler(w http.ResponseWriter, r *http.Request) {
	user, ok := session.FromContext(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	hostID, host, ok := s.resolveHost(r)
	if !ok {
		http.Error(w, "unknown host", http.StatusNotFound)
		return
	}
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	cols, rows := dimensions(r)
	term, err := s.startSession(hostID, host, cols, rows)
	if err != nil {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[31mTerminal unavailable: "+err.Error()+"\x1b[0m\r\n"))
		s.audit.Record(r, "terminal.session", sessionTarget(hostID, host), hostID, "failure", err.Error())
		return
	}
	defer term.Close()

	log.Printf("Terminal connected [%s]: host=%d", user.Username, hostID)
	s.audit.Record(r, "terminal.session", sessionTarget(hostID, host), hostID, "started", "")

	var writeMu sync.Mutex
	writeWS := func(messageType int, payload []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteMessage(messageType, payload)
	}

	outputDone := make(chan error, 1)
	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, readErr := term.Read(buf)
			if n > 0 {
				if err := writeWS(websocket.BinaryMessage, buf[:n]); err != nil {
					outputDone <- err
					return
				}
			}
			if readErr != nil {
				outputDone <- readErr
				return
			}
		}
	}()

	processDone := make(chan error, 1)
	go func() { processDone <- term.Wait() }()

	inputDone := make(chan error, 1)
	go func() {
		for {
			messageType, payload, readErr := conn.ReadMessage()
			if readErr != nil {
				inputDone <- readErr
				return
			}
			switch messageType {
			case websocket.BinaryMessage:
				_, readErr = term.Write(payload)
			case websocket.TextMessage:
				readErr = handleControl(term, payload)
			}
			if readErr != nil {
				inputDone <- readErr
				return
			}
		}
	}()

	select {
	case <-inputDone:
	case <-outputDone:
	case <-processDone:
	}
	s.audit.Record(r, "terminal.session", sessionTarget(hostID, host), hostID, "ended", "")
	log.Printf("Terminal disconnected [%s]: host=%d", user.Username, hostID)
}

func (s *Service) resolveHost(r *http.Request) (int, store.Host, bool) {
	value := r.URL.Query().Get("host")
	if value == "" {
		return 0, store.Host{}, true
	}
	hostID, err := strconv.Atoi(value)
	if err != nil || hostID <= 0 {
		return 0, store.Host{}, false
	}
	host, ok := s.store.GetHost(hostID)
	return hostID, host, ok
}

func (s *Service) startSession(hostID int, host store.Host, cols, rows uint16) (terminalSession, error) {
	if hostID == 0 {
		return startLocalTerminal(cols, rows)
	}
	sess, stdin, stdout, err := s.sshMgr.StartTerminal(host, uint32(rows), uint32(cols))
	if err != nil {
		return nil, err
	}
	return &sshTerminal{session: sess, stdin: stdin, stdout: stdout}, nil
}

type sshTerminal struct {
	session *ssh.Session
	stdin   io.WriteCloser
	stdout  io.Reader
}

func (t *sshTerminal) Read(p []byte) (int, error)  { return t.stdout.Read(p) }
func (t *sshTerminal) Write(p []byte) (int, error) { return t.stdin.Write(p) }
func (t *sshTerminal) Resize(cols, rows uint16) error {
	return t.session.WindowChange(int(rows), int(cols))
}
func (t *sshTerminal) Wait() error { return t.session.Wait() }
func (t *sshTerminal) Close() error {
	_ = t.stdin.Close()
	return t.session.Close()
}

func handleControl(term terminalSession, payload []byte) error {
	var message resizeMessage
	if err := json.Unmarshal(payload, &message); err != nil || message.Type != "resize" {
		return nil
	}
	if message.Cols == 0 || message.Rows == 0 || message.Cols > maxCols || message.Rows > maxRows {
		return nil
	}
	return term.Resize(message.Cols, message.Rows)
}

func dimensions(r *http.Request) (uint16, uint16) {
	cols := queryDimension(r, "cols", defaultCols, maxCols)
	rows := queryDimension(r, "rows", defaultRows, maxRows)
	return cols, rows
}

func queryDimension(r *http.Request, key string, fallback, maximum uint16) uint16 {
	value, err := strconv.ParseUint(r.URL.Query().Get(key), 10, 16)
	if err != nil || value == 0 || value > uint64(maximum) {
		return fallback
	}
	return uint16(value)
}

func sessionTarget(hostID int, host store.Host) string {
	if hostID == 0 {
		return "local"
	}
	return fmt.Sprintf("%s@%s", host.User, host.Address)
}

func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	return err == nil && u.Host == r.Host
}

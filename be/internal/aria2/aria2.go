// Package aria2 manages a local aria2c process and talks to it over its
// JSON-RPC interface, so movie downloads can use a lighter, resumable,
// multi-connection downloader instead of the hand-rolled single-connection
// one in internal/movies. aria2c is an optional dependency, same spirit as
// ffmpeg in internal/files/remux.go: when it isn't on PATH, callers fall
// back to the existing downloader instead of failing.
//
// aria2c does its own DNS resolution and network I/O outside this process,
// so unlike the custom downloader's per-redirect-redial SSRF guard, it is
// NOT protected against being pointed at a local/private address beyond the
// synchronous pre-check the caller (movies.Service.Start) already does. This
// is an accepted, deliberate limitation for a personal panel rather than a
// silent gap.
package aria2

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"strconv"
	"sync"
	"time"
)

// Available reports whether aria2c is on PATH, checked once at process
// start (same pattern as ffmpegAvailable).
var Available = func() bool {
	_, err := exec.LookPath("aria2c")
	return err == nil
}()

// Manager owns a single lazily-spawned aria2c child process and its RPC
// client. Zero value is not usable; construct with New().
type Manager struct {
	mu     sync.Mutex
	cmd    *exec.Cmd
	port   int
	secret string
	http   *http.Client
}

func New() *Manager {
	return &Manager{http: &http.Client{Timeout: 15 * time.Second}}
}

// Status is a snapshot of one aria2 download, shaped to slot into
// movies.Job's progress fields.
type Status struct {
	State           string // active, waiting, paused, error, complete, removed
	CompletedLength int64
	TotalLength     int64
	DownloadSpeed   int64
	ErrorMessage    string
	FollowedBy      []string // set on a magnet's metadata-fetch GID once aria2 hands off to the real download GID
	Files           []string // on-disk path(s), populated once data has been written
}

// freePort asks the OS for an unused loopback port. There's an inherent
// race between closing this listener and aria2c binding the same port, but
// it's the standard trick and good enough for a single-user local panel.
func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func randomSecret() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// ensureRunning spawns aria2c if it isn't already up, or restarts it if the
// previous process died. Must be called with mu held.
func (m *Manager) ensureRunning() error {
	if m.cmd != nil && m.cmd.Process != nil {
		if _, err := m.call("aria2.getVersion", nil); err == nil {
			return nil // already running and responsive
		}
		m.cmd = nil // stale handle; fall through and respawn
	}

	port, err := freePort()
	if err != nil {
		return fmt.Errorf("aria2: couldn't find a free port: %w", err)
	}
	secret, err := randomSecret()
	if err != nil {
		return fmt.Errorf("aria2: couldn't generate rpc secret: %w", err)
	}

	cmd := exec.Command("aria2c",
		"--enable-rpc=true",
		"--rpc-listen-all=false",
		"--rpc-listen-port="+strconv.Itoa(port),
		"--rpc-secret="+secret,
		"--continue=true",
		"--max-connection-per-server=5",
		"--split=5",
		"--allow-overwrite=true",
		"--quiet=true",
	)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("aria2: failed to start aria2c: %w", err)
	}
	m.cmd = cmd
	m.port = port
	m.secret = secret

	// Give it a moment to bind the RPC port before the first real call.
	deadline := time.Now().Add(2 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		if _, err := m.call("aria2.getVersion", nil); err == nil {
			return nil
		} else {
			lastErr = err
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("aria2: rpc didn't come up in time: %w", lastErr)
}

// EnsureRunning is the exported, locked entry point callers use before
// AddURI so a broken/missing aria2c is surfaced as an error the caller can
// fall back on, rather than failing deep inside AddURI.
func (m *Manager) EnsureRunning() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.ensureRunning()
}

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      string `json:"id"`
	Method  string `json:"method"`
	Params  []any  `json:"params"`
}

type rpcResponse struct {
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// call issues one JSON-RPC request. params should NOT include the auth
// token; call prepends "token:<secret>" itself. Safe to call without mu held
// (used internally by ensureRunning while mu IS held, and by exported
// methods that don't need to touch m.cmd).
func (m *Manager) call(method string, params []any) (json.RawMessage, error) {
	full := append([]any{"token:" + m.secret}, params...)
	body, err := json.Marshal(rpcRequest{JSONRPC: "2.0", ID: "homepanel", Method: method, Params: full})
	if err != nil {
		return nil, err
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/jsonrpc", m.port)
	resp, err := m.http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var rpcResp rpcResponse
	if err := json.NewDecoder(resp.Body).Decode(&rpcResp); err != nil {
		return nil, err
	}
	if rpcResp.Error != nil {
		return nil, fmt.Errorf("aria2 rpc: %s", rpcResp.Error.Message)
	}
	return rpcResp.Result, nil
}

// AddURI starts a new download. Call EnsureRunning first. filename is
// optional ("out" option) — pass "" for magnet links, where BitTorrent
// metadata determines the real file name(s) rather than us; forcing "out" on
// a magnet either gets ignored or breaks multi-file torrents.
func (m *Manager) AddURI(rawURL, dir, filename string) (gid string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	options := map[string]string{"dir": dir}
	if filename != "" {
		options["out"] = filename
	}
	result, err := m.call("aria2.addUri", []any{[]string{rawURL}, options})
	if err != nil {
		return "", err
	}
	if err := json.Unmarshal(result, &gid); err != nil {
		return "", fmt.Errorf("aria2 addUri response: %w", err)
	}
	return gid, nil
}

type tellStatusResult struct {
	Status          string   `json:"status"`
	CompletedLength string   `json:"completedLength"`
	TotalLength     string   `json:"totalLength"`
	DownloadSpeed   string   `json:"downloadSpeed"`
	ErrorMessage    string   `json:"errorMessage"`
	FollowedBy      []string `json:"followedBy"`
	Files           []struct {
		Path string `json:"path"`
	} `json:"files"`
}

// Status returns gid's current progress. FollowedBy/Files matter for
// BitTorrent downloads: adding a magnet link returns a GID for a short-lived
// "fetch metadata" task; once that finishes, aria2 auto-starts the real
// download under a *new* GID listed in FollowedBy. Files lists the on-disk
// path(s) once a download (torrent or not) has data written.
func (m *Manager) Status(gid string) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	result, err := m.call("aria2.tellStatus", []any{gid,
		[]string{"status", "completedLength", "totalLength", "downloadSpeed", "errorMessage", "followedBy", "files"},
	})
	if err != nil {
		return Status{}, err
	}
	var r tellStatusResult
	if err := json.Unmarshal(result, &r); err != nil {
		return Status{}, fmt.Errorf("aria2 tellStatus response: %w", err)
	}
	parseInt := func(s string) int64 {
		n, _ := strconv.ParseInt(s, 10, 64)
		return n
	}
	files := make([]string, 0, len(r.Files))
	for _, f := range r.Files {
		files = append(files, f.Path)
	}
	return Status{
		State:           r.Status,
		CompletedLength: parseInt(r.CompletedLength),
		TotalLength:     parseInt(r.TotalLength),
		DownloadSpeed:   parseInt(r.DownloadSpeed),
		ErrorMessage:    r.ErrorMessage,
		FollowedBy:      r.FollowedBy,
		Files:           files,
	}, nil
}

// Remove force-cancels an in-flight download.
func (m *Manager) Remove(gid string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, err := m.call("aria2.forceRemove", []any{gid})
	return err
}

// Shutdown stops the aria2c child process, if one is running. Best-effort
// RPC shutdown first (lets it exit cleanly), then a hard kill if it's still
// alive after a short grace period.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cmd == nil || m.cmd.Process == nil {
		return
	}
	_, _ = m.call("aria2.shutdown", nil)
	done := make(chan error, 1)
	go func() { done <- m.cmd.Wait() }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		_ = m.cmd.Process.Kill()
	}
	m.cmd = nil
}

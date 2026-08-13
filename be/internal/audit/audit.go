// Package audit records security-relevant panel actions in an append-only JSONL file.
package audit

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nawfdev/home-panel/internal/session"
)

const maxEvents = 10000

// Event is one immutable audit record.
type Event struct {
	ID        int64  `json:"id"`
	Timestamp string `json:"timestamp"`
	UserID    int    `json:"userId,omitempty"`
	Username  string `json:"username,omitempty"`
	IP        string `json:"ip"`
	Action    string `json:"action"`
	Target    string `json:"target,omitempty"`
	HostID    int    `json:"hostId"`
	Result    string `json:"result"`
	Details   string `json:"details,omitempty"`
}

// Logger keeps a bounded in-memory index while persisting every event to disk.
type Logger struct {
	mu     sync.RWMutex
	file   string
	events []Event
	nextID int64
}

func Open(file string) (*Logger, error) {
	l := &Logger{file: file, nextID: 1}
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return nil, err
	}
	f, err := os.Open(file)
	if err == nil {
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			var event Event
			if json.Unmarshal(scanner.Bytes(), &event) == nil {
				l.events = append(l.events, event)
				if event.ID >= l.nextID {
					l.nextID = event.ID + 1
				}
			}
		}
		_ = f.Close()
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if len(l.events) > maxEvents {
		l.events = append([]Event(nil), l.events[len(l.events)-maxEvents:]...)
		if err := l.rewrite(); err != nil {
			return nil, err
		}
	}
	return l, nil
}

func clientIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	host := strings.TrimSpace(r.RemoteAddr)
	if i := strings.LastIndex(host, ":"); i >= 0 {
		if _, err := strconv.Atoi(host[i+1:]); err == nil {
			host = strings.Trim(host[:i], "[]")
		}
	}
	return host
}

// Record appends an event. It intentionally never returns an error to request handlers:
// an audit-disk failure must not turn a completed control operation into a false failure.
func (l *Logger) Record(r *http.Request, action, target string, hostID int, result, details string) {
	if l == nil {
		return
	}
	event := Event{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		IP:        clientIP(r),
		Action:    action,
		Target:    target,
		HostID:    hostID,
		Result:    result,
		Details:   details,
	}
	if r != nil {
		if user, ok := session.FromContext(r.Context()); ok {
			event.UserID = user.ID
			event.Username = user.Username
		}
	}
	l.append(event)
}

// RecordActor records events before authentication has established a request context.
func (l *Logger) RecordActor(r *http.Request, username, action, target, result, details string) {
	if l == nil {
		return
	}
	event := Event{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Username:  username,
		IP:        clientIP(r),
		Action:    action,
		Target:    target,
		Result:    result,
		Details:   details,
	}
	l.append(event)
}

func (l *Logger) append(event Event) {
	l.mu.Lock()
	defer l.mu.Unlock()
	event.ID = l.nextID
	l.nextID++
	l.events = append(l.events, event)
	if len(l.events) > maxEvents {
		l.events = append([]Event(nil), l.events[len(l.events)-maxEvents:]...)
		_ = l.rewrite()
		return
	}
	f, err := os.OpenFile(l.file, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	_ = json.NewEncoder(f).Encode(event)
	_ = f.Close()
}

func (l *Logger) rewrite() error {
	tmp := l.file + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(f)
	for _, event := range l.events {
		if err := encoder.Encode(event); err != nil {
			_ = f.Close()
			_ = os.Remove(tmp)
			return err
		}
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, l.file)
}

// List returns newest-first matching records.
func (l *Logger) List(limit int, action, username string) []Event {
	if l == nil {
		return []Event{}
	}
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	l.mu.RLock()
	defer l.mu.RUnlock()
	out := make([]Event, 0, limit)
	for i := len(l.events) - 1; i >= 0 && len(out) < limit; i-- {
		event := l.events[i]
		if action != "" && !strings.Contains(strings.ToLower(event.Action), strings.ToLower(action)) {
			continue
		}
		if username != "" && !strings.EqualFold(event.Username, username) {
			continue
		}
		out = append(out, event)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ID > out[j].ID })
	return out
}

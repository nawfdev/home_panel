// Package session provides authenticated browser sessions backed by signed cookies.
package session

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/sessions"
)

const cookieName = "homepanel.sid"

type SessionUser struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

type Info struct {
	ID         string `json:"id"`
	UserID     int    `json:"userId"`
	Username   string `json:"username"`
	IP         string `json:"ip"`
	UserAgent  string `json:"userAgent"`
	RememberMe bool   `json:"rememberMe"`
	CreatedAt  string `json:"createdAt"`
	LastSeen   string `json:"lastSeen"`
	Current    bool   `json:"current"`
}

type record struct {
	Info
	expires time.Time
}

type Manager struct {
	store  *sessions.CookieStore
	maxAge time.Duration
	mu     sync.RWMutex
	active map[string]record
}

func New(secret string, maxAgeMs int64) *Manager {
	cs := sessions.NewCookieStore([]byte(secret))
	cs.Options = &sessions.Options{Path: "/", HttpOnly: true, MaxAge: int(maxAgeMs / 1000), SameSite: http.SameSiteLaxMode}
	return &Manager{store: cs, maxAge: time.Duration(maxAgeMs) * time.Millisecond, active: map[string]record{}}
}

func (m *Manager) get(r *http.Request) *sessions.Session {
	s, _ := m.store.Get(r, cookieName)
	return s
}

func requestSecure(r *http.Request) bool {
	proto := strings.ToLower(r.Header.Get("X-Forwarded-Proto"))
	return r.TLS != nil || r.URL.Scheme == "https" || proto == "https" || strings.Contains(r.Header.Get("CF-Visitor"), "https")
}

func requestIP(r *http.Request) string {
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i >= 0 {
		host = strings.Trim(host[:i], "[]")
	}
	return host
}

func sessionID() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

const (
	defaultMaxAge  = 24 * time.Hour      // 24 hours if not remembered
	rememberMaxAge = 30 * 24 * time.Hour // 30 days when rememberMe is enabled
)

func (m *Manager) Login(w http.ResponseWriter, r *http.Request, u SessionUser, rememberMe bool) error {
	id, err := sessionID()
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	ttl := defaultMaxAge
	if rememberMe {
		ttl = rememberMaxAge
	}
	s := m.get(r)
	s.Options.Path = "/"
	s.Options.HttpOnly = true
	s.Options.SameSite = http.SameSiteLaxMode
	s.Options.Secure = requestSecure(r)
	s.Options.MaxAge = int(ttl.Seconds())
	s.Values["id"] = u.ID
	s.Values["username"] = u.Username
	s.Values["role"] = u.Role
	s.Values["session_id"] = id
	s.Values["remember_me"] = rememberMe
	if err := s.Save(r, w); err != nil {
		return err
	}
	m.mu.Lock()
	m.active[id] = record{
		Info: Info{
			ID:         id,
			UserID:     u.ID,
			Username:   u.Username,
			IP:         requestIP(r),
			UserAgent:  r.UserAgent(),
			RememberMe: rememberMe,
			CreatedAt:  now.Format(time.RFC3339),
			LastSeen:   now.Format(time.RFC3339),
		},
		expires: now.Add(ttl),
	}
	m.mu.Unlock()
	return nil
}

func (m *Manager) Logout(w http.ResponseWriter, r *http.Request) error {
	s := m.get(r)
	if id, ok := s.Values["session_id"].(string); ok {
		m.mu.Lock()
		delete(m.active, id)
		m.mu.Unlock()
	}
	s.Options.MaxAge = -1
	s.Options.Secure = requestSecure(r)
	s.Values = map[interface{}]interface{}{}
	return s.Save(r, w)
}

func (m *Manager) Current(r *http.Request) (SessionUser, bool) {
	s := m.get(r)
	id, ok := s.Values["id"].(int)
	if !ok || id == 0 {
		return SessionUser{}, false
	}
	username, _ := s.Values["username"].(string)
	role, _ := s.Values["role"].(string)
	now := time.Now().UTC()

	sid, hasSid := s.Values["session_id"].(string)
	if !hasSid || sid == "" {
		if newSid, err := sessionID(); err == nil {
			sid = newSid
			s.Values["session_id"] = newSid
		}
	}

	if sid != "" {
		m.mu.Lock()
		rec, exists := m.active[sid]
		if !exists {
			rem, _ := s.Values["remember_me"].(bool)
			ttl := defaultMaxAge
			if rem {
				ttl = rememberMaxAge
			}
			// Auto-restore session in memory after server restart so active sessions tracking is never lost
			rec = record{
				Info: Info{
					ID:         sid,
					UserID:     id,
					Username:   username,
					IP:         requestIP(r),
					UserAgent:  r.UserAgent(),
					RememberMe: rem,
					CreatedAt:  now.Format(time.RFC3339),
					LastSeen:   now.Format(time.RFC3339),
				},
				expires: now.Add(ttl),
			}
		} else if time.Now().After(rec.expires) {
			delete(m.active, sid)
			m.mu.Unlock()
			return SessionUser{}, false
		} else {
			rem, _ := s.Values["remember_me"].(bool)
			ttl := defaultMaxAge
			if rem {
				ttl = rememberMaxAge
			}
			rec.LastSeen = now.Format(time.RFC3339)
			rec.expires = now.Add(ttl)
		}
	}

	return SessionUser{ID: id, Username: username, Role: role}, true
}

func (m *Manager) List(r *http.Request, userID int, admin bool) []Info {
	current, _ := m.get(r).Values["session_id"].(string)
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Info{}
	for id, rec := range m.active {
		if now.After(rec.expires) {
			delete(m.active, id)
			continue
		}
		if admin || rec.UserID == userID {
			info := rec.Info
			info.Current = id == current
			out = append(out, info)
		}
	}
	return out
}

func (m *Manager) Revoke(id string, userID int, admin bool) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.active[id]
	if !ok || (!admin && rec.UserID != userID) {
		return false
	}
	delete(m.active, id)
	return true
}

type ctxKey struct{}

func WithUser(ctx context.Context, u SessionUser) context.Context {
	return context.WithValue(ctx, ctxKey{}, u)
}

func FromContext(ctx context.Context) (SessionUser, bool) {
	u, ok := ctx.Value(ctxKey{}).(SessionUser)
	return u, ok
}

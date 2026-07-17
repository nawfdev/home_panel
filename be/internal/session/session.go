// Package session provides server-side-equivalent auth state via a signed cookie.
// express-session used a server memory store + sid cookie; for a single-user
// homelab panel a signed cookie store is equivalent and simpler, and big-bang
// migration means users re-login once anyway.
package session

import (
	"context"
	"net/http"

	"github.com/gorilla/sessions"
)

const cookieName = "homepanel.sid"

// SessionUser is the payload stored in req.session.user by the Node backend.
type SessionUser struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

type Manager struct {
	store *sessions.CookieStore
}

// New builds a manager. maxAgeMs matches config.session.maxAge (milliseconds).
func New(secret string, maxAgeMs int64) *Manager {
	cs := sessions.NewCookieStore([]byte(secret))
	cs.Options = &sessions.Options{
		Path:     "/",
		HttpOnly: true,
		Secure:   false, // matches Node cookie.secure:false
		MaxAge:   int(maxAgeMs / 1000),
		SameSite: http.SameSiteLaxMode,
	}
	return &Manager{store: cs}
}

func (m *Manager) get(r *http.Request) *sessions.Session {
	// CookieStore.Get never returns a usable-nil session; the error only signals
	// a tampered/old cookie, in which case we still get a fresh empty session.
	s, _ := m.store.Get(r, cookieName)
	return s
}

// Login stores the user and writes the cookie.
func (m *Manager) Login(w http.ResponseWriter, r *http.Request, u SessionUser) error {
	s := m.get(r)
	s.Values["id"] = u.ID
	s.Values["username"] = u.Username
	s.Values["role"] = u.Role
	return s.Save(r, w)
}

// Logout clears the session cookie.
func (m *Manager) Logout(w http.ResponseWriter, r *http.Request) error {
	s := m.get(r)
	s.Options.MaxAge = -1
	s.Values = map[interface{}]interface{}{}
	return s.Save(r, w)
}

// Current returns the logged-in user, or ok=false when unauthenticated.
func (m *Manager) Current(r *http.Request) (SessionUser, bool) {
	s := m.get(r)
	id, ok := s.Values["id"].(int)
	if !ok || id == 0 {
		return SessionUser{}, false
	}
	username, _ := s.Values["username"].(string)
	role, _ := s.Values["role"].(string)
	return SessionUser{ID: id, Username: username, Role: role}, true
}

// ctxKey holds the resolved SessionUser on the request context. RequireAuth
// resolves the caller once (cookie session or bearer token, either path) and
// stashes the result here so downstream handlers don't care which auth
// method was used.
type ctxKey struct{}

func WithUser(ctx context.Context, u SessionUser) context.Context {
	return context.WithValue(ctx, ctxKey{}, u)
}

func FromContext(ctx context.Context) (SessionUser, bool) {
	u, ok := ctx.Value(ctxKey{}).(SessionUser)
	return u, ok
}

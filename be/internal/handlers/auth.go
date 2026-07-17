// Package handlers contains the HTTP handlers, ported route-by-route from
// backend/routes/*.js. This file ports backend/routes/auth.js.
package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"slices"
	"strings"

	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/session"
	"github.com/nawfdev/home-panel/internal/store"
	"golang.org/x/crypto/bcrypt"
)

type Auth struct {
	Store    *store.Store
	Sessions *session.Manager
}

// RequireAuth accepts either the browser's session cookie or a native
// client's `Authorization: Bearer <token>` header (issued at login — see
// Login below), and stashes the resolved user on the request context so
// every downstream handler/middleware uses session.FromContext regardless of
// which auth method was used.
func (a *Auth) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u, ok := a.Sessions.Current(r); ok {
			next.ServeHTTP(w, r.WithContext(session.WithUser(r.Context(), u)))
			return
		}
		if token, ok := bearerToken(r); ok {
			if user, ok := a.Store.GetUserByToken(token); ok {
				su := session.SessionUser{ID: user.ID, Username: user.Username, Role: user.Role}
				next.ServeHTTP(w, r.WithContext(session.WithUser(r.Context(), su)))
				return
			}
		}
		log.Println("[Auth] Unauthorized - no session, cookie, or bearer token")
		httpx.Error(w, http.StatusUnauthorized, "Unauthorized")
	})
}

func bearerToken(r *http.Request) (string, bool) {
	h := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(h, prefix) {
		return "", false
	}
	token := strings.TrimSpace(strings.TrimPrefix(h, prefix))
	return token, token != ""
}

// RequireRole must run after RequireAuth. It rejects any caller whose role
// doesn't exactly match, for admin-only surfaces like user/role management.
func (a *Auth) RequireRole(role string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u, ok := session.FromContext(r.Context())
			if !ok || u.Role != role {
				httpx.Error(w, http.StatusForbidden, "Forbidden")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireFeature must run after RequireAuth. The "admin" role always passes;
// every other role is checked against its stored Role.Features.
func (a *Auth) RequireFeature(key string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u, ok := session.FromContext(r.Context())
			if !ok {
				httpx.Error(w, http.StatusUnauthorized, "Unauthorized")
				return
			}
			if u.Role == "admin" {
				next.ServeHTTP(w, r)
				return
			}
			if slices.Contains(a.Store.ResolveFeatures(u.Role), key) {
				next.ServeHTTP(w, r)
				return
			}
			httpx.Error(w, http.StatusForbidden, "Forbidden")
		})
	}
}

func (a *Auth) Login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	if body.Username == "" || body.Password == "" {
		httpx.Error(w, http.StatusBadRequest, "Username and password required")
		return
	}

	user, ok := a.Store.GetUserByUsername(body.Username)
	if !ok || bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(body.Password)) != nil {
		httpx.Error(w, http.StatusUnauthorized, "Invalid credentials")
		return
	}

	su := session.SessionUser{ID: user.ID, Username: user.Username, Role: user.Role}
	if err := a.Sessions.Login(w, r, su); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Login failed")
		return
	}

	// Also issue a bearer token so native clients (Android) can authenticate
	// without a cookie jar. Browsers ignore this field.
	token, err := a.Store.IssueUserToken(user.ID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Login failed")
		return
	}

	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"user":    meResponse(a.Store, su),
		"token":   token,
	})
}

func (a *Auth) Logout(w http.ResponseWriter, r *http.Request) {
	// Not behind RequireAuth (logout is a no-op success even with a stale/no
	// session), so resolve the caller directly instead of via request context.
	if u, ok := a.Sessions.Current(r); ok {
		_ = a.Store.ClearUserToken(u.ID)
	} else if token, ok := bearerToken(r); ok {
		if user, ok := a.Store.GetUserByToken(token); ok {
			_ = a.Store.ClearUserToken(user.ID)
		}
	}
	if err := a.Sessions.Logout(w, r); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Logout failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (a *Auth) Me(w http.ResponseWriter, r *http.Request) {
	u, _ := session.FromContext(r.Context()) // RequireAuth guarantees presence
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"user": meResponse(a.Store, u)})
}

// meResponse resolves the current feature grant alongside the user payload
// so clients (browser + Android) know what to show without re-deriving role
// logic themselves.
func meResponse(s *store.Store, u session.SessionUser) map[string]interface{} {
	return map[string]interface{}{
		"id":       u.ID,
		"username": u.Username,
		"role":     u.Role,
		"features": s.ResolveFeatures(u.Role),
	}
}

func (a *Auth) ChangePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	if body.CurrentPassword == "" || body.NewPassword == "" {
		httpx.Error(w, http.StatusBadRequest, "Current and new password required")
		return
	}

	cur, _ := session.FromContext(r.Context())
	user, ok := a.Store.GetUserByID(cur.ID)
	if !ok || bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(body.CurrentPassword)) != nil {
		httpx.Error(w, http.StatusUnauthorized, "Current password is incorrect")
		return
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), 10)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Failed to hash password")
		return
	}
	if err := a.Store.UpdateUserPassword(user.ID, string(hashed)); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Failed to update password")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "message": "Password changed successfully"})
}

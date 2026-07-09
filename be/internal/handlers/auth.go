// Package handlers contains the HTTP handlers, ported route-by-route from
// backend/routes/*.js. This file ports backend/routes/auth.js.
package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/kaysa/home-panel/internal/httpx"
	"github.com/kaysa/home-panel/internal/session"
	"github.com/kaysa/home-panel/internal/store"
	"golang.org/x/crypto/bcrypt"
)

type Auth struct {
	Store    *store.Store
	Sessions *session.Manager
}

// RequireAuth is the middleware equivalent of isAuthenticated in auth.js.
func (a *Auth) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := a.Sessions.Current(r)
		if !ok {
			log.Println("[Auth] Unauthorized - no session or user")
			httpx.Error(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		log.Printf("[Auth] Authenticated: userId=%d username=%s", u.ID, u.Username)
		next.ServeHTTP(w, r)
	})
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
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "user": su})
}

func (a *Auth) Logout(w http.ResponseWriter, r *http.Request) {
	if err := a.Sessions.Logout(w, r); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Logout failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (a *Auth) Me(w http.ResponseWriter, r *http.Request) {
	u, _ := a.Sessions.Current(r) // RequireAuth guarantees presence
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"user": u})
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

	cur, _ := a.Sessions.Current(r)
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

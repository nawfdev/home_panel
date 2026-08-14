package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nawfdev/home-panel/internal/audit"
	"github.com/nawfdev/home-panel/internal/authsec"
	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/session"
	"github.com/nawfdev/home-panel/internal/store"
	"golang.org/x/crypto/bcrypt"
)

// Auth handles user authentication, TOTP 2FA, session lifecycle, and RBAC guards.
type Auth struct {
	Store   *store.Store
	Session *session.Manager
	Audit   *audit.Logger
}

// RequireAuth guards endpoints by session cookie or bearer token.
func (a *Auth) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u, ok := a.Session.Current(r); ok {
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

// RequireRole checks that the authenticated user has the required role.
func (a *Auth) RequireRole(role string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u, ok := session.FromContext(r.Context())
			if !ok {
				httpx.Error(w, http.StatusUnauthorized, "Unauthorized")
				return
			}
			if u.Role != role && u.Role != "admin" {
				httpx.Error(w, http.StatusForbidden, "Forbidden")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireFeature checks that the user's role grants access to the specified feature.
func (a *Auth) RequireFeature(feature string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u, ok := session.FromContext(r.Context())
			if !ok {
				httpx.Error(w, http.StatusUnauthorized, "Unauthorized")
				return
			}
			// Admins bypass feature checks entirely
			if u.Role == "admin" {
				next.ServeHTTP(w, r)
				return
			}
			features := a.Store.ResolveFeatures(u.Role)
			for _, f := range features {
				if f == feature {
					next.ServeHTTP(w, r)
					return
				}
			}
			httpx.Error(w, http.StatusForbidden, "Forbidden")
		})
	}
}

func (a *Auth) Login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Username == "" || body.Password == "" {
		a.Audit.RecordActor(r, body.Username, "auth.login", "panel", "failure", "missing credentials")
		httpx.Error(w, http.StatusBadRequest, "Username and password required")
		return
	}
	user, ok := a.Store.GetUserByUsername(body.Username)
	if !ok || bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(body.Password)) != nil {
		a.Audit.RecordActor(r, body.Username, "auth.login", "panel", "failure", "invalid credentials")
		httpx.Error(w, http.StatusUnauthorized, "Invalid credentials")
		return
	}
	if user.TOTPSecret != "" {
		valid := authsec.Validate(user.TOTPSecret, body.Code, time.Now())
		if !valid && authsec.IsRecoveryCode(body.Code) {
			valid = a.Store.ConsumeRecoveryCode(user.ID, authsec.HashRecoveryCode(body.Code))
		}
		if !valid {
			a.Audit.RecordActor(r, user.Username, "auth.login", "panel", "failure", "two-factor code required")
			httpx.JSON(w, http.StatusUnauthorized, map[string]any{"success": false, "error": "Two-factor code required", "requiresTwoFactor": true})
			return
		}
	}
	su := session.SessionUser{ID: user.ID, Username: user.Username, Role: user.Role}
	if err := a.Session.Login(w, r, su); err != nil {
		a.Audit.RecordActor(r, user.Username, "auth.login", "panel", "failure", "session creation failed")
		httpx.Error(w, http.StatusInternalServerError, "Login failed")
		return
	}
	token, err := a.Store.IssueUserToken(user.ID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Login failed")
		return
	}
	a.Audit.RecordActor(r, user.Username, "auth.login", "panel", "success", "")
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "user": meResponse(a.Store, su), "token": token})
}

func (a *Auth) Logout(w http.ResponseWriter, r *http.Request) {
	username := ""
	if u, ok := a.Session.Current(r); ok {
		username = u.Username
		_ = a.Store.ClearUserToken(u.ID)
	} else if token, ok := bearerToken(r); ok {
		if user, ok := a.Store.GetUserByToken(token); ok {
			username = user.Username
			_ = a.Store.ClearUserToken(user.ID)
		}
	}
	if err := a.Session.Logout(w, r); err != nil {
		a.Audit.RecordActor(r, username, "auth.logout", "panel", "failure", err.Error())
		httpx.Error(w, http.StatusInternalServerError, "Logout failed")
		return
	}
	a.Audit.RecordActor(r, username, "auth.logout", "panel", "success", "")
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
		httpx.Error(w, http.StatusBadRequest, "Both current and new password are required")
		return
	}
	current, _ := session.FromContext(r.Context())
	user, ok := a.Store.GetUserByID(current.ID)
	if !ok {
		user, ok = a.Store.GetUserByUsername(current.Username)
	}
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
	a.Audit.Record(r, "security.password.change", current.Username, 0, "success", "")
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "message": "Password changed successfully"})
}

func (a *Auth) TOTPStatus(w http.ResponseWriter, r *http.Request) {
	current, ok := session.FromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	user, ok := a.Store.GetUserByID(current.ID)
	if !ok {
		user, ok = a.Store.GetUserByUsername(current.Username)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"enabled": ok && user.TOTPSecret != ""})
}

func (a *Auth) TOTPSetup(w http.ResponseWriter, r *http.Request) {
	current, _ := session.FromContext(r.Context())
	secret, err := authsec.NewSecret()
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Failed to generate TOTP secret")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"secret": secret, "uri": authsec.URI(current.Username, secret)})
}

func (a *Auth) TOTPEnable(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Secret string `json:"secret"`
		Code   string `json:"code"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if !authsec.Validate(body.Secret, body.Code, time.Now()) {
		httpx.Error(w, http.StatusBadRequest, "Invalid verification code")
		return
	}
	current, _ := session.FromContext(r.Context())
	plain, hashed, err := authsec.RecoveryCodes(8)
	if err != nil || a.Store.SetUserTOTP(current.ID, body.Secret, hashed) != nil {
		httpx.Error(w, http.StatusInternalServerError, "Failed to enable TOTP")
		return
	}
	a.Audit.Record(r, "security.totp.enable", current.Username, 0, "success", "")
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "recoveryCodes": plain})
}

func (a *Auth) TOTPDisable(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	current, _ := session.FromContext(r.Context())
	user, ok := a.Store.GetUserByID(current.ID)
	if !ok {
		user, ok = a.Store.GetUserByUsername(current.Username)
	}
	if !ok || bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(body.Password)) != nil {
		httpx.Error(w, http.StatusUnauthorized, "Current password is incorrect")
		return
	}
	if err := a.Store.SetUserTOTP(current.ID, "", nil); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Failed to disable TOTP")
		return
	}
	a.Audit.Record(r, "security.totp.disable", current.Username, 0, "success", "")
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (a *Auth) ListSessions(w http.ResponseWriter, r *http.Request) {
	current, _ := session.FromContext(r.Context())
	httpx.JSON(w, http.StatusOK, map[string]any{"sessions": a.Session.List(r, current.ID, current.Role == "admin")})
}

func (a *Auth) RevokeSession(w http.ResponseWriter, r *http.Request) {
	current, _ := session.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	if !a.Session.Revoke(id, current.ID, current.Role == "admin") {
		httpx.Error(w, http.StatusNotFound, "Session not found")
		return
	}
	a.Audit.Record(r, "security.session.revoke", id, 0, "success", "")
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nawfdev/home-panel/internal/audit"
	"github.com/nawfdev/home-panel/internal/authsec"
	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/session"
	"github.com/nawfdev/home-panel/internal/store"
)

type Passkeys struct {
	Store   *store.Store
	Session *session.Manager
	Audit   *audit.Logger
}

func (h *Passkeys) List(w http.ResponseWriter, r *http.Request) {
	current, ok := session.FromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	passkeys := h.Store.ListUserPasskeys(current.ID)
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "passkeys": passkeys})
}

func (h *Passkeys) RegisterBegin(w http.ResponseWriter, r *http.Request) {
	current, ok := session.FromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	challenge, err := authsec.GenerateChallenge(current.ID, current.Username)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Failed to generate challenge")
		return
	}

	rpID := r.Host
	if idx := strings.Index(rpID, ":"); idx != -1 {
		rpID = rpID[:idx]
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"success": true,
		"options": map[string]any{
			"challenge": challenge,
			"rp": map[string]string{
				"name": "Nestcore Server Management",
				"id":   rpID,
			},
			"user": map[string]any{
				"id":          fmt.Sprintf("user-%d", current.ID),
				"name":        current.Username,
				"displayName": current.Username,
			},
			"pubKeyCredParams": []map[string]any{
				{"type": "public-key", "alg": -7},   // ES256
				{"type": "public-key", "alg": -257}, // RS256
				{"type": "public-key", "alg": -8},   // Ed25519
			},
			"authenticatorSelection": map[string]any{
				"residentKey":      "preferred",
				"userVerification": "preferred",
			},
			"timeout": 60000,
		},
	})
}

func (h *Passkeys) RegisterFinish(w http.ResponseWriter, r *http.Request) {
	current, ok := session.FromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	var body struct {
		Nickname string          `json:"nickname"`
		Response json.RawMessage `json:"response"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Error(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	credID, pubKey, err := authsec.VerifyRegistration(string(body.Response), current.ID)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "Verification failed: "+err.Error())
		return
	}

	nickname := strings.TrimSpace(body.Nickname)
	if nickname == "" {
		nickname = "Biometric Passkey"
	}

	pk := store.Passkey{
		ID:        fmt.Sprintf("pk-%d", time.Now().UnixNano()),
		Nickname:  nickname,
		CredID:    credID,
		PublicKey: pubKey,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}

	if err := h.Store.AddUserPasskey(current.ID, pk); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Failed to save passkey")
		return
	}

	h.Audit.Record(r, "security.passkey.register", current.Username, 0, "success", nickname)
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "passkey": pk})
}

func (h *Passkeys) Delete(w http.ResponseWriter, r *http.Request) {
	current, ok := session.FromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	id := chi.URLParam(r, "id")
	if err := h.Store.DeleteUserPasskey(current.ID, id); err != nil {
		httpx.Error(w, http.StatusNotFound, "Passkey not found")
		return
	}
	h.Audit.Record(r, "security.passkey.delete", current.Username, 0, "success", id)
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Passkeys) LoginBegin(w http.ResponseWriter, r *http.Request) {
	challenge, err := authsec.GenerateChallenge(0, "")
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Failed to generate login challenge")
		return
	}

	rpID := r.Host
	if idx := strings.Index(rpID, ":"); idx != -1 {
		rpID = rpID[:idx]
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"success": true,
		"options": map[string]any{
			"challenge":        challenge,
			"rpId":             rpID,
			"userVerification": "preferred",
			"timeout":          60000,
		},
	})
}

func (h *Passkeys) LoginFinish(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Response json.RawMessage `json:"response"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Error(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	credID, err := authsec.VerifyAuthentication(string(body.Response))
	if err != nil {
		httpx.Error(w, http.StatusUnauthorized, "Biometric authentication failed: "+err.Error())
		return
	}

	user, _, ok := h.Store.GetUserByPasskeyCredID(credID)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "Passkey not recognized or not enrolled")
		return
	}

	su := session.SessionUser{ID: user.ID, Username: user.Username, Role: user.Role}
	if err := h.Session.Login(w, r, su, true); err != nil {
		return
	}

	token, err := h.Store.IssueUserToken(user.ID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Token issue failed")
		return
	}

	h.Audit.RecordActor(r, user.Username, "auth.login.passkey", "panel", "success", "")
	httpx.JSON(w, http.StatusOK, map[string]any{
		"success": true,
		"user": map[string]any{
			"id":       su.ID,
			"username": su.Username,
			"role":     su.Role,
			"features": h.Store.ResolveFeatures(su.Role),
		},
		"token": token,
	})
}

// Package handlers: admin-only family account + role management, backing
// the Settings > Users tab. Every route here additionally requires
// auth.RequireRole("admin") — see server.go wiring.
package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/session"
	"github.com/nawfdev/home-panel/internal/store"
)

type Users struct {
	Store *store.Store
}

type userDTO struct {
	ID        int    `json:"id"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at,omitempty"`
}

func toUserDTO(u store.User) userDTO {
	return userDTO{ID: u.ID, Username: u.Username, Role: u.Role, CreatedAt: u.CreatedAt}
}

func (h *Users) List(w http.ResponseWriter, r *http.Request) {
	users := h.Store.ListUsers()
	out := make([]userDTO, len(users))
	for i, u := range users {
		out[i] = toUserDTO(u)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Users) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Username == "" || body.Password == "" || body.Role == "" {
		httpx.Error(w, http.StatusBadRequest, "Username, password and role are required")
		return
	}
	if _, ok := h.Store.GetRole(body.Role); !ok {
		httpx.Error(w, http.StatusBadRequest, "Unknown role")
		return
	}
	hashed, err := store.HashPassword(body.Password)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Failed to hash password")
		return
	}
	u, err := h.Store.CreateUser(body.Username, hashed, body.Role)
	if err != nil {
		if errors.Is(err, store.ErrUsernameTaken) {
			httpx.Error(w, http.StatusConflict, "Username already taken")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "Failed to create user")
		return
	}
	httpx.JSON(w, http.StatusCreated, toUserDTO(u))
}

func (h *Users) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "Invalid id")
		return
	}
	var body struct {
		Role        string `json:"role"`
		NewPassword string `json:"newPassword"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	if body.Role != "" {
		if _, ok := h.Store.GetRole(body.Role); !ok {
			httpx.Error(w, http.StatusBadRequest, "Unknown role")
			return
		}
		if err := h.Store.UpdateUserRole(id, body.Role); err != nil {
			httpx.Error(w, http.StatusNotFound, "User not found")
			return
		}
	}
	if body.NewPassword != "" {
		hashed, err := store.HashPassword(body.NewPassword)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "Failed to hash password")
			return
		}
		if err := h.Store.UpdateUserPassword(id, hashed); err != nil {
			httpx.Error(w, http.StatusNotFound, "User not found")
			return
		}
	}
	u, ok := h.Store.GetUserByID(id)
	if !ok {
		httpx.Error(w, http.StatusNotFound, "User not found")
		return
	}
	httpx.JSON(w, http.StatusOK, toUserDTO(u))
}

func (h *Users) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "Invalid id")
		return
	}
	if cur, ok := session.FromContext(r.Context()); ok && cur.ID == id {
		httpx.Error(w, http.StatusBadRequest, "Cannot delete your own account")
		return
	}
	if err := h.Store.DeleteUser(id); err != nil {
		if errors.Is(err, store.ErrLastAdmin) {
			httpx.Error(w, http.StatusBadRequest, "Cannot remove the last admin")
			return
		}
		httpx.Error(w, http.StatusNotFound, "User not found")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

type Roles struct {
	Store *store.Store
}

func (h *Roles) List(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"roles":       h.Store.ListRoles(),
		"featureKeys": store.FeatureKeys,
	})
}

func (h *Roles) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID       string   `json:"id"`
		Label    string   `json:"label"`
		Features []string `json:"features"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.ID == "" || body.Label == "" {
		httpx.Error(w, http.StatusBadRequest, "id and label are required")
		return
	}
	role, err := h.Store.CreateRole(body.ID, body.Label, sanitizeFeatures(body.Features))
	if err != nil {
		httpx.Error(w, http.StatusConflict, "Role id already exists")
		return
	}
	httpx.JSON(w, http.StatusCreated, role)
}

func (h *Roles) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Features []string `json:"features"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if err := h.Store.UpdateRoleFeatures(id, sanitizeFeatures(body.Features)); err != nil {
		if errors.Is(err, store.ErrRoleLocked) {
			httpx.Error(w, http.StatusBadRequest, "This role is locked")
			return
		}
		httpx.Error(w, http.StatusNotFound, "Role not found")
		return
	}
	role, _ := h.Store.GetRole(id)
	httpx.JSON(w, http.StatusOK, role)
}

func (h *Roles) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.Store.DeleteRole(id); err != nil {
		switch {
		case errors.Is(err, store.ErrRoleLocked):
			httpx.Error(w, http.StatusBadRequest, "This role is locked")
		case errors.Is(err, store.ErrRoleInUse):
			httpx.Error(w, http.StatusBadRequest, "Role is still assigned to a user")
		default:
			httpx.Error(w, http.StatusNotFound, "Role not found")
		}
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

// sanitizeFeatures drops anything not in the fixed FeatureKeys list, so a
// role can never be granted a made-up or admin-only surface via this API.
func sanitizeFeatures(in []string) []string {
	out := make([]string, 0, len(in))
	for _, f := range in {
		if slices.Contains(store.FeatureKeys, f) {
			out = append(out, f)
		}
	}
	return out
}

package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/prober"
	"github.com/nawfdev/home-panel/internal/sshmgr"
	"github.com/nawfdev/home-panel/internal/store"
)

// Hosts manages saved SSH targets (e.g. a secondary STB) the panel can run
// terminal commands and browse files on.
type Hosts struct {
	Store  *store.Store
	SSH    *sshmgr.Manager
	Prober *prober.Manager
}

func (h *Hosts) List(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, h.Store.ListHosts())
}

func (h *Hosts) ensureMonitor(host store.Host) {
	if h.Prober == nil {
		return
	}
	h.Prober.EnsureHostMonitor(prober.HostSeed{ID: host.ID, Name: host.Name, Address: host.Address, Port: host.Port})
}

// Create bootstraps a new host: the supplied password is used once to
// install the panel's SSH public key into the target, then discarded. It is
// never written to disk or the store.
func (h *Hosts) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string  `json:"name"`
		Address  string  `json:"address"`
		Port     float64 `json:"port"`
		User     string  `json:"user"`
		Password string  `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Name == "" || body.Address == "" || body.User == "" || body.Password == "" {
		httpx.Error(w, http.StatusBadRequest, "name, address, user, and password required")
		return
	}
	port := int(body.Port)
	if port == 0 {
		port = 22
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	host, err := h.SSH.Bootstrap(ctx, body.Name, body.Address, port, body.User, body.Password)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	h.ensureMonitor(host)
	httpx.JSON(w, http.StatusOK, host)
}

// Update edits an existing host's configuration (name, address, port, user)
// and optionally reinstalls the SSH key if a new password is provided.
func (h *Hosts) Update(w http.ResponseWriter, r *http.Request) {
	id := idParam(r)
	host, ok := h.Store.GetHost(id)
	if !ok {
		httpx.Error(w, http.StatusNotFound, "host not found")
		return
	}

	var body struct {
		Name     *string `json:"name"`
		Address  *string `json:"address"`
		Port     *int    `json:"port"`
		User     *string `json:"user"`
		Password *string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.Name != nil && strings.TrimSpace(*body.Name) != "" {
		host.Name = strings.TrimSpace(*body.Name)
	}
	if body.Address != nil && strings.TrimSpace(*body.Address) != "" {
		host.Address = strings.TrimSpace(*body.Address)
	}
	if body.Port != nil && *body.Port > 0 && *body.Port <= 65535 {
		host.Port = *body.Port
	}
	if body.User != nil && strings.TrimSpace(*body.User) != "" {
		host.User = strings.TrimSpace(*body.User)
	}

	// If a password is provided, reinstall SSH key with updated credentials
	if body.Password != nil && strings.TrimSpace(*body.Password) != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		updatedHost, err := h.SSH.Bootstrap(ctx, host.Name, host.Address, host.Port, host.User, *body.Password)
		if err != nil {
			httpx.Error(w, http.StatusBadGateway, "Failed to connect and install SSH key: "+err.Error())
			return
		}
		host.ID = id
		if err := h.Store.UpdateHost(host); err != nil {
			httpx.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		h.ensureMonitor(host)
		httpx.JSON(w, http.StatusOK, updatedHost)
		return
	}

	if err := h.Store.UpdateHost(host); err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.ensureMonitor(host)
	httpx.JSON(w, http.StatusOK, host)
}

func (h *Hosts) Delete(w http.ResponseWriter, r *http.Request) {
	id := idParam(r)
	h.SSH.Remove(id)
	if err := h.Store.DeleteHost(id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if h.Prober != nil {
		h.Prober.RemoveHostMonitor(id)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true})
}

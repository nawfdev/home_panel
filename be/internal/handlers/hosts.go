package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/sshmgr"
	"github.com/nawfdev/home-panel/internal/store"
)

// Hosts manages saved SSH targets (e.g. a secondary STB) the panel can run
// terminal commands and browse files on.
type Hosts struct {
	Store *store.Store
	SSH   *sshmgr.Manager
}

func (h *Hosts) List(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, h.Store.ListHosts())
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
	httpx.JSON(w, http.StatusOK, host)
}

func (h *Hosts) Delete(w http.ResponseWriter, r *http.Request) {
	id := idParam(r)
	h.SSH.Remove(id)
	if err := h.Store.DeleteHost(id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true})
}

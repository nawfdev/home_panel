package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	cfapi "github.com/nawfdev/home-panel/internal/cloudflare"
	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/store"
)

type cloudflareService interface {
	VerifyToken(ctx context.Context) (bool, error)
	ListTunnels(ctx context.Context) ([]cfapi.Tunnel, error)
	ListZones(ctx context.Context) ([]cfapi.Zone, error)
	GetTunnelConnections(ctx context.Context, tunnelID string) (cfapi.TunnelDetail, error)
	DeleteTunnel(ctx context.Context, tunnelID string) error
	GetTunnelConfig(ctx context.Context, tunnelID string) (map[string]any, error)
	UpdateTunnelConfig(ctx context.Context, tunnelID string, config map[string]any) (map[string]any, error)
}

// Cloudflare ports backend/routes/cloudflare.js.
type Cloudflare struct {
	Store *store.Store
	Svc   cloudflareService
}

func (c *Cloudflare) Status(w http.ResponseWriter, r *http.Request) {
	cf := c.setting()
	apiToken, _ := cf["apiToken"].(string)
	configured := apiToken != ""
	accountID, _ := cf["accountId"].(string)

	connected := false
	connectError := ""
	if configured {
		var err error
		connected, err = c.Svc.VerifyToken(r.Context())
		if err != nil {
			connectError = err.Error()
		}
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"configured": configured,
		"connected":  connected,
		"error":      connectError,
		"accountId":  accountID,
	})
}

func (c *Cloudflare) ListTunnels(w http.ResponseWriter, r *http.Request) {
	tunnels, err := c.Svc.ListTunnels(r.Context())
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "tunnels": tunnels})
}

func (c *Cloudflare) ListZones(w http.ResponseWriter, r *http.Request) {
	zones, err := c.Svc.ListZones(r.Context())
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "zones": zones})
}

func (c *Cloudflare) GetTunnel(w http.ResponseWriter, r *http.Request) {
	tunnel, err := c.Svc.GetTunnelConnections(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "tunnel": tunnel})
}

func (c *Cloudflare) DeleteTunnel(w http.ResponseWriter, r *http.Request) {
	if err := c.Svc.DeleteTunnel(r.Context(), chi.URLParam(r, "id")); err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Tunnel deleted"})
}

func (c *Cloudflare) GetTunnelConfig(w http.ResponseWriter, r *http.Request) {
	config, err := c.Svc.GetTunnelConfig(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "config": config})
}

func (c *Cloudflare) UpdateTunnelConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Config map[string]any `json:"config"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Config == nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "config required"})
		return
	}
	config, err := c.Svc.UpdateTunnelConfig(r.Context(), chi.URLParam(r, "id"), body.Config)
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "config": config})
}

func (c *Cloudflare) setting() map[string]any {
	v, ok := c.Store.GetSetting("cloudflare")
	if !ok {
		return map[string]any{}
	}
	m, ok := v.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return m
}

package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/kaysa/home-panel/internal/httpx"
	"github.com/kaysa/home-panel/internal/tunnel"
)

// Tunnel ports backend/routes/tunnel.js.
type Tunnel struct {
	Svc *tunnel.Service
}

func (t *Tunnel) Status(w http.ResponseWriter, r *http.Request) {
	status := t.Svc.GetStatus(r.Context())
	installed := t.Svc.CheckInstalled(r.Context())
	httpx.JSON(w, http.StatusOK, map[string]any{
		"configured":     status.Configured,
		"tunnel":         status.Tunnel,
		"processRunning": status.ProcessRunning,
		"pid":            status.Pid,
		"isReady":        status.IsReady,
		"autoRestart":    status.AutoRestart,
		"restartCount":   status.RestartCount,
		"nextRetryIn":    status.NextRetryIn,
		"downtime":       status.Downtime,
		"cloudflared":    installed,
	})
}

func (t *Tunnel) List(w http.ResponseWriter, r *http.Request) {
	result, err := t.Svc.ListTunnels(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, result)
}

func (t *Tunnel) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	result, err := t.Svc.CreateTunnel(r.Context(), req.Name)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, result)
}

func (t *Tunnel) Configure(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TunnelID  string `json:"tunnelId"`
		Domain    string `json:"domain"`
		LocalPort int    `json:"localPort"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	result, err := t.Svc.ConfigureTunnel(req.TunnelID, req.Domain, req.LocalPort)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, result)
}

func (t *Tunnel) Route(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TunnelID string `json:"tunnelId"`
		Domain   string `json:"domain"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	result, err := t.Svc.RouteTunnel(r.Context(), req.TunnelID, req.Domain)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, result)
}

func (t *Tunnel) Start(w http.ResponseWriter, r *http.Request) {
	result, _ := t.Svc.StartTunnel(r.Context())
	httpx.JSON(w, http.StatusOK, result)
}

func (t *Tunnel) Stop(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, t.Svc.StopTunnel())
}

func (t *Tunnel) SystemdStatus(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, t.Svc.SystemdStatus(r.Context()))
}

func (t *Tunnel) SystemdRestart(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, t.Svc.SystemdAction(r.Context(), "restart"))
}

func (t *Tunnel) SystemdStop(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, t.Svc.SystemdAction(r.Context(), "stop"))
}

func (t *Tunnel) SystemdStart(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, t.Svc.SystemdAction(r.Context(), "start"))
}

func (t *Tunnel) SystemdProtocol(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Protocol string `json:"protocol"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	httpx.JSON(w, http.StatusOK, t.Svc.SetSystemdProtocol(r.Context(), req.Protocol))
}

func (t *Tunnel) Metrics(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, t.Svc.Metrics(r.Context()))
}

func (t *Tunnel) SetAutoRestart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	httpx.JSON(w, http.StatusOK, t.Svc.SetAutoRestart(req.Enabled))
}

func (t *Tunnel) Logs(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	httpx.JSON(w, http.StatusOK, t.Svc.Logs(r.Context(), limit))
}

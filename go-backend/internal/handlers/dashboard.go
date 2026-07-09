package handlers

import (
	"context"
	"net/http"
	"time"

	cfapi "github.com/kaysa/home-panel/internal/cloudflare"
	"github.com/kaysa/home-panel/internal/httpx"
	"github.com/kaysa/home-panel/internal/projects"
	"github.com/kaysa/home-panel/internal/store"
	"github.com/kaysa/home-panel/internal/sysstats"
	"github.com/kaysa/home-panel/internal/tunnel"
)

// Dashboard ports backend/routes/dashboard.js.
type Dashboard struct {
	Cloudflare *cfapi.Service
	Store      *store.Store
	Tunnel     *tunnel.Service
	Projects   *projects.Manager
}

func (d *Dashboard) Index(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()

	stats, err := sysstats.GetSystemStats(ctx)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Failed to get dashboard data")
		return
	}
	tunnelStatus := d.Tunnel.GetStatus(ctx)
	cloudflared := d.Tunnel.CheckInstalled(ctx)
	temperature := sysstats.GetTemperature(ctx)

	all := d.Projects.GetAll()
	running := 0
	for _, p := range all {
		if p.Status == "running" {
			running++
		}
	}

	tunnelInfo := map[string]any{
		"configured":     tunnelStatus.Configured,
		"tunnel":         tunnelStatus.Tunnel,
		"processRunning": tunnelStatus.ProcessRunning,
		"pid":            tunnelStatus.Pid,
		"isReady":        tunnelStatus.IsReady,
		"autoRestart":    tunnelStatus.AutoRestart,
		"restartCount":   tunnelStatus.RestartCount,
		"nextRetryIn":    tunnelStatus.NextRetryIn,
		"downtime":       tunnelStatus.Downtime,
	}
	if d.hasCloudflareToken() && d.Cloudflare != nil {
		if tunnels, err := d.Cloudflare.ListTunnels(ctx); err == nil && len(tunnels) > 0 {
			healthy := 0
			for _, t := range tunnels {
				if t.Status == "healthy" {
					healthy++
				}
			}
			tunnelInfo["configured"] = true
			tunnelInfo["processRunning"] = healthy > 0
			tunnelInfo["apiConnected"] = true
			tunnelInfo["tunnels"] = tunnels
			tunnelInfo["healthyCount"] = healthy
			tunnelInfo["totalCount"] = len(tunnels)
		}
	}

	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"system":      stats,
		"tunnel":      tunnelInfo,
		"cloudflared": cloudflared,
		"temperature": temperature,
		"projects": map[string]int{
			"total":   len(all),
			"running": running,
		},
	})
}

func (d *Dashboard) hasCloudflareToken() bool {
	if d.Store == nil {
		return false
	}
	v, ok := d.Store.GetSetting("cloudflare")
	if !ok {
		return false
	}
	m, ok := v.(map[string]any)
	if !ok {
		return false
	}
	token, _ := m["apiToken"].(string)
	return token != ""
}

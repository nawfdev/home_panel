package handlers

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/netinfo"
	"github.com/nawfdev/home-panel/internal/tunnel"
)

// Network ports backend/routes/network.js.
type Network struct {
	Tunnel *tunnel.Service
}

// cloudflareInfo mirrors getCloudflareInfo() in network.js.
func (n *Network) cloudflareInfo(ctx context.Context) interface{} {
	st := n.Tunnel.GetStatus(ctx)
	if !st.ProcessRunning {
		return nil
	}
	tunnelID := "N/A"
	if st.Pid != nil {
		tunnelID = strconv.Itoa(*st.Pid)
	}
	return map[string]interface{}{
		"domain":   "Systemd/External",
		"tunnelId": tunnelID,
		"status":   "running",
		"pid":      st.Pid,
	}
}

func (n *Network) Info(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	info := netinfo.GetInfo(ctx)
	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"network": map[string]interface{}{
			"publicIp":     info.PublicIP,
			"interfaces":   info.Interfaces,
			"connections":  info.Connections,
			"stats":        info.Stats,
			"cloudflare":   n.cloudflareInfo(ctx),
			"connectivity": netinfo.TestConnectivity(ctx),
			"dns":          netinfo.GetDNSServers(ctx),
			"gateway":      netinfo.GetGateway(ctx),
		},
	})
}

func (n *Network) PublicIP(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "publicIp": netinfo.GetPublicIP(r.Context())})
}

func (n *Network) Interfaces(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "interfaces": netinfo.GetLocalInterfaces()})
}

func (n *Network) Connectivity(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "connected": netinfo.TestConnectivity(r.Context())})
}

package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/netinfo"
	"github.com/nawfdev/home-panel/internal/sshmgr"
	"github.com/nawfdev/home-panel/internal/store"
	"github.com/nawfdev/home-panel/internal/tunnel"
)

// Network ports backend/routes/network.js.
type Network struct {
	Tunnel *tunnel.Service
	Store  *store.Store
	SSH    *sshmgr.Manager

	mu         sync.Mutex
	remotePrev map[int]remoteSample
}

type remoteSample struct {
	at    time.Time
	stats map[string]netinfo.NetStat
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

func hostID(r *http.Request) (int, error) {
	value := r.URL.Query().Get("host")
	if value == "" {
		return 0, nil
	}
	id, err := strconv.Atoi(value)
	if err != nil || id < 0 {
		return 0, fmt.Errorf("invalid host")
	}
	return id, nil
}

func (n *Network) remoteSnapshot(ctx context.Context, hostID int) (netinfo.Snapshot, store.Host, error) {
	host, ok := n.Store.GetHost(hostID)
	if !ok {
		return netinfo.Snapshot{}, store.Host{}, fmt.Errorf("host not found")
	}
	addresses, routes, resolvConf, netDev, err := n.SSH.NetworkInfo(ctx, host)
	if err != nil {
		return netinfo.Snapshot{}, host, err
	}
	snapshot, err := netinfo.ParseLinuxSnapshot(addresses, routes, resolvConf, netDev)
	if err != nil {
		return netinfo.Snapshot{}, host, err
	}
	n.applyRemoteRates(hostID, snapshot.Stats)
	return snapshot, host, nil
}

func (n *Network) applyRemoteRates(hostID int, stats []netinfo.NetStat) {
	now := time.Now()
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.remotePrev == nil {
		n.remotePrev = make(map[int]remoteSample)
	}
	previous, hasPrevious := n.remotePrev[hostID]
	elapsed := now.Sub(previous.at).Seconds()
	current := make(map[string]netinfo.NetStat, len(stats))
	for i := range stats {
		current[stats[i].Interface] = stats[i]
		if old, ok := previous.stats[stats[i].Interface]; hasPrevious && ok && elapsed > 0 {
			if stats[i].RxBytes >= old.RxBytes {
				stats[i].RxSec = float64(stats[i].RxBytes-old.RxBytes) / elapsed
			}
			if stats[i].TxBytes >= old.TxBytes {
				stats[i].TxSec = float64(stats[i].TxBytes-old.TxBytes) / elapsed
			}
		}
	}
	n.remotePrev[hostID] = remoteSample{at: now, stats: current}
}

func (n *Network) Info(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	id, err := hostID(r)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if id != 0 {
		snapshot, host, err := n.remoteSnapshot(ctx, id)
		if err != nil {
			httpx.Error(w, http.StatusBadGateway, err.Error())
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]interface{}{
			"success": true,
			"network": map[string]interface{}{
				"publicIp":     fmt.Sprintf("%s (%s:%d)", host.Name, host.Address, host.Port),
				"interfaces":   snapshot.Interfaces,
				"connections":  0,
				"stats":        snapshot.Stats,
				"cloudflare":   nil,
				"connectivity": true,
				"dns":          snapshot.DNS,
				"gateway":      snapshot.Gateway,
			},
		})
		return
	}
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

func (n *Network) Stats(w http.ResponseWriter, r *http.Request) {
	id, err := hostID(r)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if id != 0 {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		snapshot, _, err := n.remoteSnapshot(ctx, id)
		if err != nil {
			httpx.Error(w, http.StatusBadGateway, err.Error())
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "stats": snapshot.Stats})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"stats":   netinfo.GetNetworkStats(r.Context()),
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

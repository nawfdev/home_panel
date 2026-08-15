package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/prober"
	"github.com/nawfdev/home-panel/internal/store"
)

type Monitors struct {
	Prober *prober.Manager
	Store  *store.Store
}

func (h *Monitors) List(w http.ResponseWriter, r *http.Request) {
	list := h.Prober.List()
	upCount := 0
	downCount := 0
	for _, m := range list {
		if m.Status == prober.StatusUp {
			upCount++
		} else if m.Status == prober.StatusDown {
			downCount++
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"success":   true,
		"monitors":  list,
		"upCount":   upCount,
		"downCount": downCount,
		"total":     len(list),
	})
}

func (h *Monitors) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string             `json:"name"`
		Type        prober.MonitorType `json:"type"`
		Target      string             `json:"target"`
		IntervalSec int                `json:"intervalSec"`
		TimeoutSec  int                `json:"timeoutSec"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Error(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	mon, err := h.Prober.Add(body.Name, body.Type, body.Target, body.IntervalSec, body.TimeoutSec)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]interface{}{"success": true, "monitor": mon})
}

func (h *Monitors) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Name        string             `json:"name"`
		Type        prober.MonitorType `json:"type"`
		Target      string             `json:"target"`
		IntervalSec int                `json:"intervalSec"`
		TimeoutSec  int                `json:"timeoutSec"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Error(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	mon, err := h.Prober.Update(id, body.Name, body.Type, body.Target, body.IntervalSec, body.TimeoutSec)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "monitor": mon})
}

// SetPublic toggles whether a monitor is exposed on the unauthenticated
// status page (GET /api/status/public).
func (h *Monitors) SetPublic(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Public bool `json:"public"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Error(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	mon, err := h.Prober.SetPublic(id, body.Public)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "monitor": mon})
}

func (h *Monitors) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.Prober.Delete(id); err != nil {
		httpx.Error(w, http.StatusNotFound, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true})
}

func (h *Monitors) Check(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	mon, err := h.Prober.ExecuteCheck(id)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "monitor": mon})
}

func (h *Monitors) WakeOnLAN(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MAC       string `json:"mac"`
		Broadcast string `json:"broadcast"`
		HostID    int    `json:"hostId,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Error(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if body.HostID > 0 && body.MAC == "" {
		if host, ok := h.Store.GetHost(body.HostID); ok {
			body.Broadcast = host.Address
		}
	}

	if err := prober.SendWakeOnLAN(body.MAC, body.Broadcast); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}

	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Wake-on-LAN magic packet broadcasted successfully",
	})
}

// publicHeartbeat strips latency/message from a heartbeat before it can ever
// reach an unauthenticated visitor — an error message like "dial tcp
// 192.168.1.5:22: connection refused" would leak an internal address.
type publicHeartbeat struct {
	Timestamp int64  `json:"timestamp"`
	Status    string `json:"status"`
}

// publicMonitor is the status-page projection of a Monitor: it deliberately
// omits Target (often an internal IP/hostname/URL) and heartbeat messages.
type publicMonitor struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Type        string            `json:"type"`
	Status      string            `json:"status"`
	LatencyMs   float64           `json:"latencyMs"`
	LastChecked string            `json:"lastChecked,omitempty"`
	Uptime24h   float64           `json:"uptime24h"`
	Uptime30d   float64           `json:"uptime30d"`
	History     []publicHeartbeat `json:"history"`
}

// PublicStatus serves the unauthenticated status page's data — every
// monitor an admin flagged Public, sanitized of internal target details.
func (h *Monitors) PublicStatus(w http.ResponseWriter, r *http.Request) {
	list := h.Prober.List()
	out := make([]publicMonitor, 0, len(list))
	upCount, downCount := 0, 0
	for _, m := range list {
		if !m.Public {
			continue
		}
		history := make([]publicHeartbeat, len(m.History))
		for i, hb := range m.History {
			history[i] = publicHeartbeat{Timestamp: hb.Timestamp, Status: string(hb.Status)}
		}
		out = append(out, publicMonitor{
			ID:          m.ID,
			Name:        m.Name,
			Type:        string(m.Type),
			Status:      string(m.Status),
			LatencyMs:   m.LatencyMs,
			LastChecked: m.LastChecked,
			Uptime24h:   m.Uptime24h,
			Uptime30d:   m.Uptime30d,
			History:     history,
		})
		if m.Status == prober.StatusUp {
			upCount++
		} else if m.Status == prober.StatusDown {
			downCount++
		}
	}

	overall := "operational"
	if downCount > 0 && upCount == 0 {
		overall = "outage"
	} else if downCount > 0 {
		overall = "degraded"
	}

	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"success":   true,
		"overall":   overall,
		"monitors":  out,
		"upCount":   upCount,
		"downCount": downCount,
		"total":     len(out),
	})
}

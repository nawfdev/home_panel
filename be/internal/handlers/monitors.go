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

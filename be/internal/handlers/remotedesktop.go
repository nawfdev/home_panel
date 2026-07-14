package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/remotedesktop"
)

// RemoteDesktop lists/manages saved remoteagent peers.
type RemoteDesktop struct {
	Mgr *remotedesktop.Manager
}

func (h *RemoteDesktop) List(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, h.Mgr.GetAll())
}

func (h *RemoteDesktop) Get(w http.ResponseWriter, r *http.Request) {
	d, ok := h.Mgr.Get(idParam(r))
	if !ok {
		httpx.Error(w, http.StatusNotFound, "Device not found")
		return
	}
	httpx.JSON(w, http.StatusOK, d)
}

func (h *RemoteDesktop) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name  string  `json:"name"`
		Host  string  `json:"host"`
		Port  float64 `json:"port"`
		Token string  `json:"token"`
		Notes string  `json:"notes"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Name == "" || body.Host == "" || body.Port == 0 || body.Token == "" {
		httpx.Error(w, http.StatusBadRequest, "name, host, port, and token required")
		return
	}
	d, err := h.Mgr.Add(body.Name, body.Host, int(body.Port), body.Token, body.Notes)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, d)
}

func (h *RemoteDesktop) Update(w http.ResponseWriter, r *http.Request) {
	var body map[string]interface{}
	_ = json.NewDecoder(r.Body).Decode(&body)
	d, _ := h.Mgr.Update(idParam(r), body)
	httpx.JSON(w, http.StatusOK, d)
}

func (h *RemoteDesktop) Delete(w http.ResponseWriter, r *http.Request) {
	if err := h.Mgr.Delete(idParam(r)); err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true})
}

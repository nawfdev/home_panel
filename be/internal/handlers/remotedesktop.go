package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/remotedesktop"
)

// RemoteDesktop lists/manages saved RustDesk peers.
type RemoteDesktop struct {
	Mgr *remotedesktop.Manager
}

func (h *RemoteDesktop) List(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, h.Mgr.GetAll())
}

func (h *RemoteDesktop) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name       string `json:"name"`
		RustdeskID string `json:"rustdesk_id"`
		Server     string `json:"server"`
		Key        string `json:"key"`
		Notes      string `json:"notes"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Name == "" || body.RustdeskID == "" {
		httpx.Error(w, http.StatusBadRequest, "name and rustdesk_id required")
		return
	}
	d, err := h.Mgr.Add(body.Name, body.RustdeskID, body.Server, body.Key, body.Notes)
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

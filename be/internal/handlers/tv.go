package handlers

import (
	"net/http"

	"github.com/nawfdev/home-panel/internal/httpx"
	tvsvc "github.com/nawfdev/home-panel/internal/tv"
)

// TV exposes the dhanytv-sourced live channel list and the header/DRM
// playback proxy — see package tv for the M3U parsing and proxy logic.
type TV struct {
	Svc *tvsvc.Service
}

func (t *TV) Channels(w http.ResponseWriter, r *http.Request) {
	channels, err := t.Svc.Channels()
	if err != nil {
		httpx.JSON(w, http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "channels": channels})
}

func (t *TV) Proxy(w http.ResponseWriter, r *http.Request) {
	t.Svc.Proxy(w, r)
}

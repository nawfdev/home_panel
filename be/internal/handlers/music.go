package handlers

import (
	"net/http"

	"github.com/nawfdev/home-panel/internal/httpx"
	musicsvc "github.com/nawfdev/home-panel/internal/music"
)

// Music exposes go-librespot's local API (reverse-proxied) and the live
// audio relay under /api/music. See internal/music for the whole design.
type Music struct{ Svc *musicsvc.Service }

// Librespot reverse-proxies everything under /api/music/librespot/* to
// go-librespot's own API (status, transport controls, and its own
// /web-api/* proxy to Spotify).
func (m *Music) Librespot(w http.ResponseWriter, r *http.Request) {
	m.Svc.Handler().ServeHTTP(w, r)
}

// Stream serves the live MP3 relay for the panel's mini-player.
func (m *Music) Stream(w http.ResponseWriter, r *http.Request) {
	m.Svc.StreamAudio(w, r)
}

// AvailableStatus reports whether the music feature is usable on this
// install (the go-librespot binary is present) — the frontend uses this to
// decide whether to show setup instructions instead of the player.
func (m *Music) AvailableStatus(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{"available": m.Svc.Available()})
}

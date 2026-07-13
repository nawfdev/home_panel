package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nawfdev/home-panel/internal/httpx"
	moviesvc "github.com/nawfdev/home-panel/internal/movies"
	"github.com/nawfdev/home-panel/internal/torrentsearch"
)

// Movies exposes the pahe.ink scraper, torrent-search-api-backed torrent
// search, and the server-side download queue. Downloaded files land under
// the SafePath allowlist, so the existing file player and share endpoints
// serve them without extra wiring.
type Movies struct {
	Svc      *moviesvc.Service
	Torrents *torrentsearch.Service
}

// Search browses/searches pahe.ink. Empty query => homepage.
func (m *Movies) Search(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Query string `json:"query"`
		Page  int    `json:"page"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.Page < 1 {
		req.Page = 1
	}
	films, err := moviesvc.Search(req.Query, req.Page)
	if err != nil {
		httpx.JSON(w, http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()})
		return
	}
	if films == nil {
		films = []moviesvc.Film{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "films": films})
}

// Detail returns the download options for a film's detail page.
func (m *Movies) Detail(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	opts, err := moviesvc.Detail(req.URL)
	if err != nil {
		httpx.JSON(w, http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()})
		return
	}
	if opts == nil {
		opts = []moviesvc.DownloadOption{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "options": opts})
}

// StartDownload enqueues a server-side download.
func (m *Movies) StartDownload(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title  string `json:"title"`
		URL    string `json:"url"`
		Poster string `json:"poster"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	job, err := m.Svc.Start(req.Title, req.URL, req.Poster)
	if err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "job": job})
}

// ListDownloads returns all jobs (newest first).
func (m *Movies) ListDownloads(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "jobs": m.Svc.List()})
}

// CancelDownload cancels an in-flight job.
func (m *Movies) CancelDownload(w http.ResponseWriter, r *http.Request) {
	if err := m.Svc.Cancel(chi.URLParam(r, "id")); err != nil {
		httpx.JSON(w, http.StatusNotFound, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Download canceled"})
}

// TorrentSearch runs a query through the torrent-search-api sidecar (across
// every provider it has enabled) and returns results with resolved magnets.
func (m *Movies) TorrentSearch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Query string `json:"query"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	results, err := m.Torrents.Search(req.Query)
	if err != nil {
		httpx.JSON(w, http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()})
		return
	}
	if results == nil {
		results = []torrentsearch.Result{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "results": results})
}

// StartTorrentDownload enqueues a magnet download, handled by aria2.
func (m *Movies) StartTorrentDownload(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title  string `json:"title"`
		URL    string `json:"url"`
		Poster string `json:"poster"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	job, err := m.Svc.StartTorrent(req.Title, req.URL, req.Poster)
	if err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "job": job})
}

// DownloadsStream is a Server-Sent Events feed of the job list, pushed once a
// second so the UI shows live progress without polling.
func (m *Movies) DownloadsStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	writeSnapshot := func() bool {
		payload, err := json.Marshal(map[string]any{"jobs": m.Svc.List()})
		if err != nil {
			return false
		}
		if _, err := fmt.Fprintf(w, "data: %s\n\n", payload); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	if !writeSnapshot() {
		return
	}
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			if !writeSnapshot() {
				return
			}
		}
	}
}

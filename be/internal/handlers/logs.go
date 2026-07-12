package handlers

import (
	"context"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/nawfdev/home-panel/internal/httpx"
	logsvc "github.com/nawfdev/home-panel/internal/logs"
)

type logsService interface {
	Sources(ctx context.Context) []logsvc.Source
	Targets(ctx context.Context, sourceID string) []logsvc.Target
	Logs(ctx context.Context, sourceID, target string, lines int) string
}

// Logs ports backend/routes/logs.js.
type Logs struct {
	Svc logsService
}

func (l *Logs) Sources(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "sources": l.Svc.Sources(r.Context())})
}

func (l *Logs) Targets(w http.ResponseWriter, r *http.Request) {
	targets := l.Svc.Targets(r.Context(), chi.URLParam(r, "sourceId"))
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "targets": targets})
}

func (l *Logs) Source(w http.ResponseWriter, r *http.Request) {
	lines := 100
	if raw := r.URL.Query().Get("lines"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			lines = parsed
		}
	}

	out := l.Svc.Logs(r.Context(), chi.URLParam(r, "sourceId"), r.URL.Query().Get("target"), lines)
	if search := r.URL.Query().Get("search"); search != "" {
		out = logsvc.Search(out, search)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "logs": out})
}

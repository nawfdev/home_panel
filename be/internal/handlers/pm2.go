package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/kaysa/home-panel/internal/httpx"
	"github.com/kaysa/home-panel/internal/pm2"
)

type pm2Service interface {
	Check(ctx context.Context) pm2.Status
	List(ctx context.Context) ([]pm2.Process, error)
	Get(ctx context.Context, nameOrID string) (pm2.Process, error)
	Start(ctx context.Context, name string) (pm2.Result, error)
	Stop(ctx context.Context, name string) (pm2.Result, error)
	Restart(ctx context.Context, name string) (pm2.Result, error)
	Delete(ctx context.Context, name string) (pm2.Result, error)
	Logs(ctx context.Context, name string, lines int) (string, error)
	StartNew(ctx context.Context, name, script string) (pm2.Result, error)
}

// PM2 ports backend/routes/pm2-routes.js.
type PM2 struct {
	Svc pm2Service
}

func (p *PM2) Processes(w http.ResponseWriter, r *http.Request) {
	processes, err := p.Svc.List(r.Context())
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error(), "pm2Available": false})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "processes": processes})
}

func (p *PM2) StartNew(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name   string `json:"name"`
		Script string `json:"script"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err.Error() != "EOF" {
		httpx.Error(w, http.StatusBadRequest, "Invalid JSON")
		return
	}
	if req.Script == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "Script path is required"})
		return
	}
	result, err := p.Svc.StartNew(r.Context(), req.Name, req.Script)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "App started", "result": result})
}

func (p *PM2) Get(w http.ResponseWriter, r *http.Request) {
	proc, err := p.Svc.Get(r.Context(), chi.URLParam(r, "name"))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "process": proc})
}

func (p *PM2) Start(w http.ResponseWriter, r *http.Request) {
	p.action(w, r, p.Svc.Start, "Process started")
}

func (p *PM2) Stop(w http.ResponseWriter, r *http.Request) {
	p.action(w, r, p.Svc.Stop, "Process stopped")
}

func (p *PM2) Restart(w http.ResponseWriter, r *http.Request) {
	p.action(w, r, p.Svc.Restart, "Process restarted")
}

func (p *PM2) Delete(w http.ResponseWriter, r *http.Request) {
	p.action(w, r, p.Svc.Delete, "Process deleted")
}

func (p *PM2) Logs(w http.ResponseWriter, r *http.Request) {
	lines := 100
	if raw := r.URL.Query().Get("lines"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			lines = parsed
		}
	}
	logs, err := p.Svc.Logs(r.Context(), chi.URLParam(r, "name"), lines)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "logs": logs})
}

func (p *PM2) Status(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, p.Svc.Check(r.Context()))
}

func (p *PM2) action(w http.ResponseWriter, r *http.Request, fn func(context.Context, string) (pm2.Result, error), message string) {
	result, err := fn(r.Context(), chi.URLParam(r, "name"))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": message, "result": result})
}

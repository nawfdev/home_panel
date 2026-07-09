package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	dockersvc "github.com/kaysa/home-panel/internal/docker"
	"github.com/kaysa/home-panel/internal/httpx"
)

type dockerService interface {
	Check(ctx context.Context) dockersvc.Status
	List(ctx context.Context, all bool) ([]dockersvc.Container, error)
	Get(ctx context.Context, nameOrID string) (map[string]any, error)
	Start(ctx context.Context, id string) (dockersvc.Result, error)
	Stop(ctx context.Context, id string) (dockersvc.Result, error)
	Restart(ctx context.Context, id string) (dockersvc.Result, error)
	Remove(ctx context.Context, id string) (dockersvc.Result, error)
	Logs(ctx context.Context, id string, lines int) (string, error)
	Stats(ctx context.Context, id string) (dockersvc.Stats, error)
	Run(ctx context.Context, name, image, ports string) (dockersvc.Result, error)
}

// Docker ports backend/routes/docker-routes.js.
type Docker struct {
	Svc dockerService
}

func (d *Docker) Containers(w http.ResponseWriter, r *http.Request) {
	containers, err := d.Svc.List(r.Context(), true)
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error(), "dockerAvailable": false})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "containers": containers})
}

func (d *Docker) Run(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name  string `json:"name"`
		Image string `json:"image"`
		Ports string `json:"ports"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err.Error() != "EOF" {
		httpx.Error(w, http.StatusBadRequest, "Invalid JSON")
		return
	}
	if req.Image == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "Image is required"})
		return
	}
	result, err := d.Svc.Run(r.Context(), req.Name, req.Image, req.Ports)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Container started", "result": result})
}

func (d *Docker) Remove(w http.ResponseWriter, r *http.Request) {
	result, err := d.Svc.Remove(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Container removed", "result": result})
}

func (d *Docker) Get(w http.ResponseWriter, r *http.Request) {
	container, err := d.Svc.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "container": container})
}

func (d *Docker) Start(w http.ResponseWriter, r *http.Request) {
	d.action(w, r, d.Svc.Start, "Container started")
}

func (d *Docker) Stop(w http.ResponseWriter, r *http.Request) {
	d.action(w, r, d.Svc.Stop, "Container stopped")
}

func (d *Docker) Restart(w http.ResponseWriter, r *http.Request) {
	d.action(w, r, d.Svc.Restart, "Container restarted")
}

func (d *Docker) Logs(w http.ResponseWriter, r *http.Request) {
	lines := 100
	if raw := r.URL.Query().Get("lines"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			lines = parsed
		}
	}
	logs, err := d.Svc.Logs(r.Context(), chi.URLParam(r, "id"), lines)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "logs": logs})
}

func (d *Docker) Stats(w http.ResponseWriter, r *http.Request) {
	stats, err := d.Svc.Stats(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "stats": stats})
}

func (d *Docker) Status(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, d.Svc.Check(r.Context()))
}

func (d *Docker) action(w http.ResponseWriter, r *http.Request, fn func(context.Context, string) (dockersvc.Result, error), message string) {
	result, err := fn(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": message, "result": result})
}

package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	dockersvc "github.com/nawfdev/home-panel/internal/docker"
	"github.com/nawfdev/home-panel/internal/httpx"
)

type Docker struct {
	Svc     *dockersvc.Service
	RootDir string
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

// --- Compose Stacks & App Templates Handlers ---

func (d *Docker) ListStacks(w http.ResponseWriter, r *http.Request) {
	stacks, err := d.Svc.ListStacks(r.Context(), d.RootDir)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "stacks": stacks})
}

func (d *Docker) GetStack(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	stack, err := d.Svc.GetStack(d.RootDir, name)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "stack": stack})
}

func (d *Docker) SaveStack(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name    string `json:"name"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Error(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if strings.TrimSpace(body.Name) == "" || strings.TrimSpace(body.Content) == "" {
		httpx.Error(w, http.StatusBadRequest, "Stack name and compose YAML content are required")
		return
	}
	if err := d.Svc.SaveStack(d.RootDir, body.Name, body.Content); err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Compose stack saved"})
}

func (d *Docker) UpStack(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	out, err := d.Svc.UpStack(r.Context(), d.RootDir, name)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Stack deployed successfully", "output": out})
}

func (d *Docker) DownStack(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	out, err := d.Svc.DownStack(r.Context(), d.RootDir, name)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Stack stopped", "output": out})
}

func (d *Docker) RestartStack(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	out, err := d.Svc.RestartStack(r.Context(), d.RootDir, name)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Stack restarted", "output": out})
}

func (d *Docker) DeleteStack(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := d.Svc.DeleteStack(r.Context(), d.RootDir, name); err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Stack deleted"})
}

func (d *Docker) Templates(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "templates": d.Svc.ListTemplates()})
}

func (d *Docker) action(w http.ResponseWriter, r *http.Request, fn func(context.Context, string) (dockersvc.Result, error), message string) {
	result, err := fn(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": message, "result": result})
}

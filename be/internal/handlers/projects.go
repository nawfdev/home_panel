package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/kaysa/home-panel/internal/httpx"
	"github.com/kaysa/home-panel/internal/projects"
)

// Projects ports backend/routes/projects.js.
type Projects struct {
	Mgr *projects.Manager
}

func idParam(r *http.Request) int {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	return id
}

func (p *Projects) List(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, p.Mgr.GetAll())
}

func (p *Projects) Get(w http.ResponseWriter, r *http.Request) {
	proj, ok := p.Mgr.Get(idParam(r))
	if !ok {
		httpx.Error(w, http.StatusNotFound, "Project not found")
		return
	}
	httpx.JSON(w, http.StatusOK, proj)
}

func (p *Projects) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name   string  `json:"name"`
		Path   string  `json:"path"`
		Port   float64 `json:"port"`
		Domain string  `json:"domain"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Name == "" || body.Path == "" || body.Port == 0 {
		httpx.Error(w, http.StatusBadRequest, "name, path, and port required")
		return
	}
	proj, err := p.Mgr.Add(body.Name, body.Path, int(body.Port), body.Domain)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, proj)
}

func (p *Projects) Update(w http.ResponseWriter, r *http.Request) {
	var body map[string]interface{}
	_ = json.NewDecoder(r.Body).Decode(&body)
	proj, _ := p.Mgr.Update(idParam(r), body)
	httpx.JSON(w, http.StatusOK, proj)
}

func (p *Projects) Delete(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, p.Mgr.Delete(idParam(r)))
}

func (p *Projects) Start(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, p.Mgr.Start(idParam(r)))
}

func (p *Projects) Stop(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, p.Mgr.Stop(idParam(r)))
}

func (p *Projects) Restart(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, p.Mgr.Restart(idParam(r)))
}

func (p *Projects) Logs(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, p.Mgr.Logs(idParam(r)))
}

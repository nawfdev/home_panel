package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/projects"
)

// Projects serves the hosting-sites API. The /projects path remains the
// persisted feature key and route for a clean data-compatible migration.
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
	site, ok := p.Mgr.Get(idParam(r))
	if !ok {
		httpx.Error(w, http.StatusNotFound, "Site not found")
		return
	}
	httpx.JSON(w, http.StatusOK, site)
}

func decodeSiteInput(w http.ResponseWriter, r *http.Request) (projects.SiteInput, bool) {
	var body projects.SiteInput
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		httpx.Error(w, http.StatusBadRequest, "Invalid site payload: "+err.Error())
		return body, false
	}
	return body, true
}

func (p *Projects) Create(w http.ResponseWriter, r *http.Request) {
	body, ok := decodeSiteInput(w, r)
	if !ok {
		return
	}
	site, err := p.Mgr.Add(body)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, site)
}

func (p *Projects) Update(w http.ResponseWriter, r *http.Request) {
	body, ok := decodeSiteInput(w, r)
	if !ok {
		return
	}
	site, err := p.Mgr.Update(idParam(r), body)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "site not found" {
			status = http.StatusNotFound
		}
		httpx.Error(w, status, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, site)
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

func (p *Projects) Deploy(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, p.Mgr.Deploy(r.Context(), idParam(r)))
}

func (p *Projects) Rollback(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, p.Mgr.Rollback(r.Context(), idParam(r)))
}

func (p *Projects) Configure(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, p.Mgr.Configure(r.Context(), idParam(r)))
}

func (p *Projects) Health(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, p.Mgr.Health(r.Context(), idParam(r)))
}

func (p *Projects) Logs(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, p.Mgr.Logs(idParam(r)))
}

package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"time"

	"github.com/nawfdev/home-panel/internal/audit"
	"github.com/nawfdev/home-panel/internal/backup"
	"github.com/nawfdev/home-panel/internal/hosthealth"
	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/networkhistory"
)

type AuditLog struct{ Log *audit.Logger }

func (h *AuditLog) List(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	httpx.JSON(w, http.StatusOK, map[string]any{"events": h.Log.List(limit, r.URL.Query().Get("action"), r.URL.Query().Get("username"))})
}

type NetworkHistory struct{ Collector *networkhistory.Collector }

func (h *NetworkHistory) History(w http.ResponseWriter, r *http.Request) {
	hostID, err := hostID(r)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	period := r.URL.Query().Get("period")
	if period != "1h" && period != "24h" && period != "7d" {
		period = "24h"
	}
	series, totals := h.Collector.History(hostID, r.URL.Query().Get("interface"), period)
	httpx.JSON(w, http.StatusOK, map[string]any{"series": series, "totals": totals, "period": period})
}

type Health struct{ Service *hosthealth.Service }

func (h *Health) List(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{"hosts": h.Service.All(r.Context()), "timestamp": time.Now().UTC().Format(time.RFC3339)})
}

type Backups struct {
	Service *backup.Service
	Audit   *audit.Logger
}

func (h *Backups) List(w http.ResponseWriter, r *http.Request) {
	items, err := h.Service.List()
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"backups": items})
}

func (h *Backups) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	info, err := h.Service.Create(body.Password)
	if err != nil {
		h.Audit.Record(r, "backup.create", "Nestcore", 0, "failure", err.Error())
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	h.Audit.Record(r, "backup.create", info.Name, 0, "success", "")
	httpx.JSON(w, http.StatusCreated, map[string]any{"success": true, "backup": info})
}

func (h *Backups) Download(w http.ResponseWriter, r *http.Request) {
	path, err := h.Service.Open(r.URL.Query().Get("name"))
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "Backup not found")
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="`+filepath.Base(path)+`"`)
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, path)
}

func (h *Backups) Restore(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 128<<20)
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		httpx.Error(w, http.StatusBadRequest, "Invalid backup upload")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "Backup file required")
		return
	}
	defer file.Close()
	payload, err := io.ReadAll(io.LimitReader(file, 128<<20))
	if err == nil {
		err = h.Service.Restore(payload, r.FormValue("password"))
	}
	if err != nil {
		h.Audit.Record(r, "backup.restore", "Nestcore", 0, "failure", err.Error())
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	h.Audit.Record(r, "backup.restore", "Nestcore", 0, "success", "restart required")
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Backup restored. Restart Nestcore to load restored configuration."})
}

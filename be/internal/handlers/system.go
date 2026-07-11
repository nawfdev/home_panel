package handlers

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kaysa/home-panel/internal/httpx"
	"github.com/kaysa/home-panel/internal/platform"
	"github.com/kaysa/home-panel/internal/store"
	"github.com/kaysa/home-panel/internal/sysstats"
)

// System ports backend/routes/system.js.
type System struct {
	Store *store.Store
	PM2   pm2Service // nil-safe: only needed when panelService.manager == "pm2"
}

func (System) Stats(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	stats, err := sysstats.GetSystemStats(ctx)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, stats)
}

func (System) Processes(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	procs, err := sysstats.GetProcessList(ctx)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, procs)
}

// RestartPanel restarts the panel's own process via whichever supervisor is
// configured in Settings (systemd unit or PM2 process name). The response is
// sent before the restart runs, since the process issuing "systemctl restart"
// on itself may not survive long enough to answer the request otherwise.
func (s System) RestartPanel(w http.ResponseWriter, r *http.Request) {
	m := settingMap(s.Store, "panelService")
	manager := str(m, "manager")
	name := strings.TrimSpace(str(m, "name"))
	if manager == "" || name == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"error":   "Panel service is not configured yet. Set the process manager and service/process name in Settings first.",
		})
		return
	}
	if manager != "systemd" && manager != "pm2" {
		httpx.JSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "Unknown process manager: " + manager})
		return
	}
	if manager == "pm2" && s.PM2 == nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": "PM2 integration not available"})
		return
	}

	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Restarting panel now — this page will disconnect for a few seconds.",
	})

	go func() {
		time.Sleep(700 * time.Millisecond) // let the response above actually reach the client first
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if manager == "pm2" {
			_, _ = s.PM2.Restart(ctx, name)
		} else {
			_ = platform.Controller().Restart(ctx, name)
		}
	}()
}

// Services ports backend/routes/services.js + system-services.js.
type Services struct{}

var serviceNameRe = regexp.MustCompile(`^[a-zA-Z0-9_\-.@]+$`)

func sanitizeServiceName(name string) bool { return serviceNameRe.MatchString(name) }

func (Services) List(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	services, err := platform.ListServices(ctx)
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	osName := "linux"
	if platform.IsWindows() {
		osName = "windows"
	}
	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true, "services": services, "platform": osName,
	})
}

func (sv Services) Start(w http.ResponseWriter, r *http.Request) {
	sv.control(w, r, "start")
}
func (sv Services) Stop(w http.ResponseWriter, r *http.Request) {
	sv.control(w, r, "stop")
}

func (sv Services) control(w http.ResponseWriter, r *http.Request, action string) {
	name := chi.URLParam(r, "name")
	if !sanitizeServiceName(name) {
		httpx.JSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false, "error": "Invalid service name format"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	var err error
	ctrl := platform.Controller()
	if action == "start" {
		err = ctrl.Start(ctx, name)
	} else {
		err = ctrl.Stop(ctx, name)
	}
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	msg := "Service started"
	if action == "stop" {
		msg = "Service stopped"
	}
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "message": msg})
}

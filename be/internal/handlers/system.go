package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/platform"
	"github.com/nawfdev/home-panel/internal/store"
	"github.com/nawfdev/home-panel/internal/sysstats"
)

// triggerPanelRestart looks up the panelService setting and restarts the
// panel process in the background via the configured supervisor. Returns
// triggered=false (no error) when nothing is configured yet, so callers can
// fall back to telling the operator to restart manually.
func triggerPanelRestart(st *store.Store, pm2Svc pm2Service) (triggered bool, err error) {
	m := settingMap(st, "panelService")
	manager := str(m, "manager")
	name := strings.TrimSpace(str(m, "name"))
	if manager == "" || name == "" {
		return false, nil
	}
	if manager != "systemd" && manager != "pm2" {
		return false, fmt.Errorf("unknown process manager: %s", manager)
	}
	if manager == "pm2" && pm2Svc == nil {
		return false, fmt.Errorf("PM2 integration not available")
	}

	go func() {
		time.Sleep(700 * time.Millisecond) // let the HTTP response reach the client first
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		// Errors here used to be silently discarded: the HTTP response already
		// told the operator "restarting now" before this runs, so a failure
		// (wrong unit name, systemctl needing a password, PM2 process not
		// found) previously vanished — the update looked successful but the
		// old code just kept serving. Logging it is the only way to surface
		// that after the fact, since there's no request left to answer.
		var restartErr error
		if manager == "pm2" {
			_, restartErr = pm2Svc.Restart(ctx, name)
		} else {
			restartErr = platform.Controller().Restart(ctx, name)
		}
		if restartErr != nil {
			log.Printf("[PanelRestart] failed to restart %s (manager=%s): %v", name, manager, restartErr)
		}
	}()
	return true, nil
}

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
	triggered, err := triggerPanelRestart(s.Store, s.PM2)
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	if !triggered {
		httpx.JSON(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"error":   "Panel service is not configured yet. Set the process manager and service/process name in Settings first.",
		})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Restarting panel now — this page will disconnect for a few seconds.",
	})
}

// RebootHost restarts the entire host machine — every service here (panel
// included) goes down until it comes back up. Requires an explicit
// {"confirm": true} body so it can't be triggered by an empty/accidental POST.
func (s System) RebootHost(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Confirm bool `json:"confirm"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if !body.Confirm {
		httpx.JSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "confirm must be true"})
		return
	}

	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Rebooting the host now — everything here, including this panel, will be unreachable until it comes back up.",
	})

	go func() {
		time.Sleep(700 * time.Millisecond) // let the response above actually reach the client first
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = platform.Reboot(ctx)
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

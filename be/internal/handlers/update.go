package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/kaysa/home-panel/internal/httpx"
	"github.com/kaysa/home-panel/internal/store"
	"github.com/kaysa/home-panel/internal/updater"
)

// Update ports backend/routes/update.js.
type Update struct {
	Updater *updater.Updater
	Store   *store.Store
	PM2     pm2Service // nil-safe: only needed to auto-restart when manager == "pm2"
}

func (u *Update) Check(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, u.Updater.CheckForUpdates(r.Context()))
}

func (u *Update) Info(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, u.Updater.GetGitInfo(r.Context()))
}

func (u *Update) Apply(w http.ResponseWriter, r *http.Request) {
	// Deliberately detached from r.Context(): git pull + npm install + npm
	// run build can run for minutes, and must not be killed mid-build just
	// because the browser tab closed or a reverse proxy cut the connection —
	// that leaves a half-written, stale dist/ silently serving old code.
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	result := u.Updater.ApplyUpdates(ctx)
	success, _ := result["success"].(bool)
	message, _ := result["message"].(string)
	buildErr, hasBuildErr := result["frontendBuildError"].(string)

	switch {
	case !success:
		// nothing applied — leave result as-is.
	case hasBuildErr:
		// Don't restart into a half-rebuilt or stale frontend; the git pull
		// already succeeded, but serving it needs a manual look first.
		result["message"] = message + " Frontend rebuild failed (" + buildErr + ") — not restarting automatically; check server logs and restart manually once it's fixed."
	default:
		// If the operator recorded a fixed binary path (systemd running a
		// precompiled binary rather than `go run`), rebuild it before
		// restarting — otherwise restarting just re-executes the same old
		// binary and none of the pulled Go changes actually take effect.
		if binaryPath := strings.TrimSpace(str(settingMap(u.Store, "panelService"), "binaryPath")); binaryPath != "" {
			if _, err := u.Updater.BuildBackendBinary(ctx, binaryPath); err != nil {
				result["message"] = message + " Backend binary rebuild failed (" + err.Error() + ") — the old binary is still running; fix the build error and restart manually."
				result["binaryBuildError"] = err.Error()
				httpx.JSON(w, http.StatusOK, result)
				return
			}
			result["binaryRebuilt"] = true
		}

		switch triggered, err := triggerPanelRestart(u.Store, u.PM2); {
		case err != nil:
			result["message"] = message + " Auto-restart failed (" + err.Error() + ") — restart the panel manually."
		case triggered:
			result["message"] = message + " Restarting automatically now — this page will disconnect for a few seconds."
			result["autoRestarting"] = true
		default:
			result["message"] = message + " Configure \"Panel process\" in Settings > Updates to auto-restart after future updates, or restart it manually now."
		}
	}

	httpx.JSON(w, http.StatusOK, result)
}

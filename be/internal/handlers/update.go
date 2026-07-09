package handlers

import (
	"net/http"

	"github.com/kaysa/home-panel/internal/httpx"
	"github.com/kaysa/home-panel/internal/updater"
)

// Update ports backend/routes/update.js.
type Update struct {
	Updater *updater.Updater
}

func (u *Update) Check(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, u.Updater.CheckForUpdates(r.Context()))
}

func (u *Update) Info(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, u.Updater.GetGitInfo(r.Context()))
}

func (u *Update) Apply(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, u.Updater.ApplyUpdates(r.Context()))
}

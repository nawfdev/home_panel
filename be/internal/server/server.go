// Package server wires routes, middleware and static file serving together,
// replacing backend/server.js.
package server

import (
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/kaysa/home-panel/internal/cloudflare"
	"github.com/kaysa/home-panel/internal/config"
	dockersvc "github.com/kaysa/home-panel/internal/docker"
	filesvc "github.com/kaysa/home-panel/internal/files"
	"github.com/kaysa/home-panel/internal/handlers"
	"github.com/kaysa/home-panel/internal/httpx"
	"github.com/kaysa/home-panel/internal/logs"
	"github.com/kaysa/home-panel/internal/metrics"
	pm2svc "github.com/kaysa/home-panel/internal/pm2"
	"github.com/kaysa/home-panel/internal/projects"
	"github.com/kaysa/home-panel/internal/session"
	"github.com/kaysa/home-panel/internal/store"
	"github.com/kaysa/home-panel/internal/telegram"
	termsvc "github.com/kaysa/home-panel/internal/terminal"
	"github.com/kaysa/home-panel/internal/tunnel"
	"github.com/kaysa/home-panel/internal/updater"
)

// Deps holds everything the router needs.
type Deps struct {
	Cloudflare *cloudflare.Service
	Config     *config.Config
	Docker     *dockersvc.Service
	Files      *filesvc.Service
	Paths      config.Paths
	Store      *store.Store
	Sessions   *session.Manager
	Metrics    *metrics.Collector
	Logs       *logs.Service
	PM2        *pm2svc.Service
	Projects   *projects.Manager
	Telegram   *telegram.Service
	Terminal   *termsvc.Service
	Tunnel     *tunnel.Service
	Updater    *updater.Updater
}

// New builds the top-level http.Handler.
func New(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(httpx.SecurityHeaders)

	auth := &handlers.Auth{Store: d.Store, Sessions: d.Sessions}
	system := handlers.System{Store: d.Store, PM2: d.PM2}
	services := handlers.Services{}
	metricsH := &handlers.Metrics{Collector: d.Metrics}
	logsH := &handlers.Logs{Svc: d.Logs}
	pm2H := &handlers.PM2{Svc: d.PM2}
	dockerH := &handlers.Docker{Svc: d.Docker}
	filesH := &handlers.Files{Svc: d.Files}
	tunnelH := &handlers.Tunnel{Svc: d.Tunnel}
	projectsH := &handlers.Projects{Mgr: d.Projects}
	networkH := &handlers.Network{Tunnel: d.Tunnel}
	dashboardH := &handlers.Dashboard{Cloudflare: d.Cloudflare, Store: d.Store, Tunnel: d.Tunnel, Projects: d.Projects}
	updateH := &handlers.Update{Updater: d.Updater}
	cloudflareH := &handlers.Cloudflare{Store: d.Store, Svc: d.Cloudflare}
	settingsH := &handlers.Settings{Store: d.Store, Telegram: d.Telegram}
	telegramH := &handlers.Telegram{Bot: d.Telegram}
	exportH := handlers.Export{}

	// Rate limiters mirror express-rate-limit windows from server.js.
	apiLimiter := httpx.NewRateLimiter(15*time.Minute, 500, false,
		"Too many requests from this IP, please try again later.")
	loginLimiter := httpx.NewRateLimiter(15*time.Minute, 10, true,
		"Too many login attempts, please try again later.")

	r.Get("/terminal", d.Terminal.Handler)

	r.Route("/api", func(api chi.Router) {
		api.Use(apiLimiter.Middleware)

		api.Route("/auth", func(ar chi.Router) {
			ar.With(loginLimiter.Middleware).Post("/login", auth.Login)
			ar.Post("/logout", auth.Logout)
			ar.With(auth.RequireAuth).Get("/me", auth.Me)
			ar.With(auth.RequireAuth).Post("/change-password", auth.ChangePassword)
		})

		api.Route("/system", func(sr chi.Router) {
			sr.Use(auth.RequireAuth)
			sr.Get("/stats", system.Stats)
			sr.Get("/processes", system.Processes)
			sr.Post("/restart-panel", system.RestartPanel)
			sr.Post("/reboot-host", system.RebootHost)
		})

		api.Route("/services", func(sr chi.Router) {
			sr.Use(auth.RequireAuth)
			sr.Get("/", services.List)
			sr.Post("/{name}/start", services.Start)
			sr.Post("/{name}/stop", services.Stop)
		})

		api.Route("/metrics", func(mr chi.Router) {
			mr.Use(auth.RequireAuth)
			mr.Get("/cpu", metricsH.CPU)
			mr.Get("/memory", metricsH.Memory)
			mr.Get("/network", metricsH.Network)
			mr.Get("/temperature", metricsH.Temperature)
		})

		api.With(auth.RequireAuth).Get("/dashboard", dashboardH.Index)

		api.Route("/tunnel", func(tr chi.Router) {
			tr.Use(auth.RequireAuth)
			tr.Get("/status", tunnelH.Status)
			tr.Get("/list", tunnelH.List)
			tr.Post("/create", tunnelH.Create)
			tr.Post("/configure", tunnelH.Configure)
			tr.Post("/route", tunnelH.Route)
			tr.Post("/start", tunnelH.Start)
			tr.Post("/stop", tunnelH.Stop)
			tr.Get("/systemd/status", tunnelH.SystemdStatus)
			tr.Post("/systemd/restart", tunnelH.SystemdRestart)
			tr.Post("/systemd/stop", tunnelH.SystemdStop)
			tr.Post("/systemd/start", tunnelH.SystemdStart)
			tr.Post("/systemd/protocol", tunnelH.SystemdProtocol)
			tr.Get("/metrics", tunnelH.Metrics)
			tr.Post("/set-autorestart", tunnelH.SetAutoRestart)
			tr.Get("/logs", tunnelH.Logs)
		})

		api.Route("/projects", func(pr chi.Router) {
			pr.Use(auth.RequireAuth)
			pr.Get("/", projectsH.List)
			pr.Post("/", projectsH.Create)
			pr.Get("/{id}", projectsH.Get)
			pr.Put("/{id}", projectsH.Update)
			pr.Delete("/{id}", projectsH.Delete)
			pr.Post("/{id}/start", projectsH.Start)
			pr.Post("/{id}/stop", projectsH.Stop)
			pr.Post("/{id}/restart", projectsH.Restart)
			pr.Get("/{id}/logs", projectsH.Logs)
		})

		api.Route("/network", func(nr chi.Router) {
			nr.Use(auth.RequireAuth)
			nr.Get("/info", networkH.Info)
			nr.Get("/public-ip", networkH.PublicIP)
			nr.Get("/interfaces", networkH.Interfaces)
			nr.Get("/connectivity", networkH.Connectivity)
		})

		api.Route("/update", func(ur chi.Router) {
			ur.Use(auth.RequireAuth)
			ur.Get("/check", updateH.Check)
			ur.Get("/info", updateH.Info)
			ur.Post("/apply", updateH.Apply)
		})

		api.Route("/settings", func(sr chi.Router) {
			sr.Use(auth.RequireAuth)
			sr.Get("/cloudflare", settingsH.GetCloudflare)
			sr.Post("/cloudflare", settingsH.SaveCloudflare)
			sr.Get("/telegram", settingsH.GetTelegram)
			sr.Post("/telegram", settingsH.SaveTelegram)
			sr.Get("/paths", settingsH.GetPaths)
			sr.Post("/paths", settingsH.SavePaths)
			sr.Get("/paths/detect/{service}", settingsH.DetectPath)
			sr.Get("/panel-service", settingsH.GetPanelService)
			sr.Post("/panel-service", settingsH.SavePanelService)
		})

		api.Route("/telegram", func(tr chi.Router) {
			tr.Use(auth.RequireAuth)
			tr.Get("/status", telegramH.Status)
			tr.Post("/test", telegramH.Test)
			tr.Post("/send", telegramH.Send)
		})

		api.Route("/cloudflare", func(cr chi.Router) {
			cr.Use(auth.RequireAuth)
			cr.Get("/status", cloudflareH.Status)
			cr.Get("/tunnels", cloudflareH.ListTunnels)
			cr.Get("/zones", cloudflareH.ListZones)
			cr.Get("/tunnels/{id}", cloudflareH.GetTunnel)
			cr.Delete("/tunnels/{id}", cloudflareH.DeleteTunnel)
			cr.Get("/tunnels/{id}/config", cloudflareH.GetTunnelConfig)
			cr.Put("/tunnels/{id}/config", cloudflareH.UpdateTunnelConfig)
		})

		api.Route("/export", func(er chi.Router) {
			er.Use(auth.RequireAuth)
			er.Get("/pm2/{name}", exportH.PM2)
			er.Get("/docker/{id}", exportH.Docker)
		})

		api.Route("/logs", func(lr chi.Router) {
			lr.Use(auth.RequireAuth)
			lr.Get("/sources", logsH.Sources)
			lr.Get("/sources/{sourceId}/targets", logsH.Targets)
			lr.Get("/sources/{sourceId}", logsH.Source)
		})

		api.Route("/pm2", func(pr chi.Router) {
			pr.Use(auth.RequireAuth)
			pr.Get("/processes", pm2H.Processes)
			pr.Post("/start", pm2H.StartNew)
			pr.Get("/processes/{name}", pm2H.Get)
			pr.Post("/processes/{name}/start", pm2H.Start)
			pr.Post("/processes/{name}/stop", pm2H.Stop)
			pr.Post("/processes/{name}/restart", pm2H.Restart)
			pr.Delete("/processes/{name}", pm2H.Delete)
			pr.Get("/processes/{name}/logs", pm2H.Logs)
			pr.Get("/status", pm2H.Status)
		})

		api.Route("/docker", func(dr chi.Router) {
			dr.Use(auth.RequireAuth)
			dr.Get("/containers", dockerH.Containers)
			dr.Post("/run", dockerH.Run)
			dr.Delete("/containers/{id}", dockerH.Remove)
			dr.Get("/containers/{id}", dockerH.Get)
			dr.Post("/containers/{id}/start", dockerH.Start)
			dr.Post("/containers/{id}/stop", dockerH.Stop)
			dr.Post("/containers/{id}/restart", dockerH.Restart)
			dr.Get("/containers/{id}/logs", dockerH.Logs)
			dr.Get("/containers/{id}/stats", dockerH.Stats)
			dr.Get("/status", dockerH.Status)
		})

		api.Route("/files", func(fr chi.Router) {
			fr.Use(auth.RequireAuth)
			fr.Post("/list", filesH.List)
			fr.Post("/read", filesH.Read)
			fr.Post("/write", filesH.Write)
			fr.Post("/delete", filesH.Delete)
			fr.Get("/download", filesH.Download)
			fr.Post("/upload", filesH.Upload)
		})
	})

	// Static frontend + SPA fallback (replaces express.static + app.get("*"))
	r.NotFound(spaHandler(d.Paths.Frontend))

	return r
}

// spaHandler serves files from the frontend dir, falling back to index.html for
// any unmatched path, matching the Node catch-all behavior.
func spaHandler(dir string) http.HandlerFunc {
	fileServer := http.FileServer(http.Dir(dir))
	indexPath := filepath.Join(dir, "index.html")
	return func(w http.ResponseWriter, r *http.Request) {
		clean := filepath.Join(dir, filepath.Clean(r.URL.Path))
		if info, err := os.Stat(clean); err == nil && !info.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, indexPath)
	}
}

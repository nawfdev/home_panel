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
	"github.com/nawfdev/home-panel/internal/aigateway"
	"github.com/nawfdev/home-panel/internal/cloudflare"
	"github.com/nawfdev/home-panel/internal/config"
	dockersvc "github.com/nawfdev/home-panel/internal/docker"
	filesvc "github.com/nawfdev/home-panel/internal/files"
	"github.com/nawfdev/home-panel/internal/handlers"
	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/logs"
	"github.com/nawfdev/home-panel/internal/metrics"
	moviesvc "github.com/nawfdev/home-panel/internal/movies"
	pm2svc "github.com/nawfdev/home-panel/internal/pm2"
	"github.com/nawfdev/home-panel/internal/projects"
	"github.com/nawfdev/home-panel/internal/remotedesktop"
	"github.com/nawfdev/home-panel/internal/session"
	"github.com/nawfdev/home-panel/internal/store"
	"github.com/nawfdev/home-panel/internal/telegram"
	termsvc "github.com/nawfdev/home-panel/internal/terminal"
	"github.com/nawfdev/home-panel/internal/torrentsearch"
	"github.com/nawfdev/home-panel/internal/tunnel"
	"github.com/nawfdev/home-panel/internal/updater"
)

// Deps holds everything the router needs.
type Deps struct {
	AiGateway     *aigateway.Service
	Cloudflare    *cloudflare.Service
	Config        *config.Config
	Docker        *dockersvc.Service
	Files         *filesvc.Service
	Movies        *moviesvc.Service
	TorrentSearch *torrentsearch.Service
	Paths         config.Paths
	Store         *store.Store
	Sessions      *session.Manager
	Metrics       *metrics.Collector
	Logs          *logs.Service
	PM2           *pm2svc.Service
	Projects      *projects.Manager
	RemoteDesktop *remotedesktop.Manager
	Telegram      *telegram.Service
	Terminal      *termsvc.Service
	Tunnel        *tunnel.Service
	Updater       *updater.Updater
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
	remoteDesktopH := &handlers.RemoteDesktop{Mgr: d.RemoteDesktop}
	networkH := &handlers.Network{Tunnel: d.Tunnel}
	dashboardH := &handlers.Dashboard{Cloudflare: d.Cloudflare, Store: d.Store, Tunnel: d.Tunnel, Projects: d.Projects}
	updateH := &handlers.Update{Updater: d.Updater, Store: d.Store, PM2: d.PM2}
	cloudflareH := &handlers.Cloudflare{Store: d.Store, Svc: d.Cloudflare}
	settingsH := &handlers.Settings{Store: d.Store, Telegram: d.Telegram}
	telegramH := &handlers.Telegram{Bot: d.Telegram}
	exportH := handlers.Export{}
	aigatewayH := &handlers.AiGateway{Svc: d.AiGateway}
	gatewayAuth := &handlers.GatewayAuth{Svc: d.AiGateway}
	moviesH := &handlers.Movies{Svc: d.Movies, Torrents: d.TorrentSearch, Files: d.Files}
	subtitlesH := &handlers.Subtitles{}
	usersH := &handlers.Users{Store: d.Store}
	rolesH := &handlers.Roles{Store: d.Store}

	// Rate limiters mirror express-rate-limit windows from server.js.
	apiLimiter := httpx.NewRateLimiter(15*time.Minute, 500, false,
		"Too many requests from this IP, please try again later.")
	loginLimiter := httpx.NewRateLimiter(15*time.Minute, 10, true,
		"Too many login attempts, please try again later.")

	r.With(auth.RequireAuth, auth.RequireFeature("terminal")).Get("/terminal", d.Terminal.Handler)

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
			sr.Use(auth.RequireAuth, auth.RequireFeature("services"))
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

		api.Route("/users", func(ur chi.Router) {
			ur.Use(auth.RequireAuth, auth.RequireRole("admin"))
			ur.Get("/", usersH.List)
			ur.Post("/", usersH.Create)
			ur.Put("/{id}", usersH.Update)
			ur.Delete("/{id}", usersH.Delete)
		})

		api.Route("/roles", func(rr chi.Router) {
			rr.Use(auth.RequireAuth, auth.RequireRole("admin"))
			rr.Get("/", rolesH.List)
			rr.Post("/", rolesH.Create)
			rr.Put("/{id}", rolesH.Update)
			rr.Delete("/{id}", rolesH.Delete)
		})

		api.Route("/tunnel", func(tr chi.Router) {
			tr.Use(auth.RequireAuth, auth.RequireFeature("tunnel"))
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
			pr.Use(auth.RequireAuth, auth.RequireFeature("projects"))
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

		api.Route("/remote-desktop", func(rr chi.Router) {
			rr.Use(auth.RequireAuth, auth.RequireFeature("remote-desktop"))
			rr.Get("/", remoteDesktopH.List)
			rr.Post("/", remoteDesktopH.Create)
			rr.Get("/{id}", remoteDesktopH.Get)
			rr.Put("/{id}", remoteDesktopH.Update)
			rr.Delete("/{id}", remoteDesktopH.Delete)
		})

		api.Route("/network", func(nr chi.Router) {
			nr.Use(auth.RequireAuth, auth.RequireFeature("network"))
			nr.Get("/info", networkH.Info)
			nr.Get("/public-ip", networkH.PublicIP)
			nr.Get("/interfaces", networkH.Interfaces)
			nr.Get("/connectivity", networkH.Connectivity)
		})

		api.Route("/update", func(ur chi.Router) {
			ur.Use(auth.RequireAuth, auth.RequireRole("admin"))
			ur.Get("/check", updateH.Check)
			ur.Get("/info", updateH.Info)
			ur.Post("/apply", updateH.Apply)
		})

		api.Route("/settings", func(sr chi.Router) {
			sr.Use(auth.RequireAuth, auth.RequireRole("admin"))
			sr.Get("/cloudflare", settingsH.GetCloudflare)
			sr.Post("/cloudflare", settingsH.SaveCloudflare)
			sr.Get("/telegram", settingsH.GetTelegram)
			sr.Post("/telegram", settingsH.SaveTelegram)
			sr.Get("/paths", settingsH.GetPaths)
			sr.Post("/paths", settingsH.SavePaths)
			sr.Get("/paths/detect/{service}", settingsH.DetectPath)
			sr.Get("/panel-service", settingsH.GetPanelService)
			sr.Post("/panel-service", settingsH.SavePanelService)
			sr.Get("/file-manager", settingsH.GetFileManager)
			sr.Post("/file-manager", settingsH.SaveFileManager)
			sr.Get("/subsource", settingsH.GetSubsource)
			sr.Post("/subsource", settingsH.SaveSubsource)
		})

		api.Route("/telegram", func(tr chi.Router) {
			tr.Use(auth.RequireAuth, auth.RequireFeature("telegram"))
			tr.Get("/status", telegramH.Status)
			tr.Post("/test", telegramH.Test)
			tr.Post("/send", telegramH.Send)
		})

		api.Route("/cloudflare", func(cr chi.Router) {
			cr.Use(auth.RequireAuth, auth.RequireFeature("cloudflare"))
			cr.Get("/status", cloudflareH.Status)
			cr.Get("/tunnels", cloudflareH.ListTunnels)
			cr.Get("/zones", cloudflareH.ListZones)
			cr.Get("/tunnels/{id}", cloudflareH.GetTunnel)
			cr.Delete("/tunnels/{id}", cloudflareH.DeleteTunnel)
			cr.Get("/tunnels/{id}/config", cloudflareH.GetTunnelConfig)
			cr.Put("/tunnels/{id}/config", cloudflareH.UpdateTunnelConfig)
		})

		api.Route("/ai-gateway", func(gr chi.Router) {
			gr.Use(auth.RequireAuth, auth.RequireFeature("ai-gateway"))
			gr.Get("/providers", aigatewayH.ListProviders)
			gr.Post("/providers", aigatewayH.CreateProvider)
			gr.Put("/providers/{id}", aigatewayH.UpdateProvider)
			gr.Delete("/providers/{id}", aigatewayH.DeleteProvider)
			gr.Post("/providers/{id}/keys", aigatewayH.AddKey)
			gr.Delete("/providers/{id}/keys/{keyId}", aigatewayH.DeleteKey)
			gr.Get("/providers/{id}/status", aigatewayH.ProviderStatus)
			gr.Get("/usage", aigatewayH.Usage)
			gr.Get("/pricing", aigatewayH.GetPricing)
			gr.Put("/pricing", aigatewayH.SavePricing)
			gr.Get("/compression", aigatewayH.GetCompression)
			gr.Put("/compression", aigatewayH.SaveCompression)
			gr.Get("/gateway-key", aigatewayH.GetGatewayKey)
			gr.Post("/gateway-key/rotate", aigatewayH.RotateGatewayKey)
		})

		api.Route("/export", func(er chi.Router) {
			er.Use(auth.RequireAuth, auth.RequireRole("admin"))
			er.Get("/pm2/{name}", exportH.PM2)
			er.Get("/docker/{id}", exportH.Docker)
		})

		api.Route("/logs", func(lr chi.Router) {
			lr.Use(auth.RequireAuth, auth.RequireFeature("logs"))
			lr.Get("/sources", logsH.Sources)
			lr.Get("/sources/{sourceId}/targets", logsH.Targets)
			lr.Get("/sources/{sourceId}", logsH.Source)
		})

		api.Route("/pm2", func(pr chi.Router) {
			pr.Use(auth.RequireAuth, auth.RequireFeature("pm2"))
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
			dr.Use(auth.RequireAuth, auth.RequireFeature("docker"))
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
			fr.Use(auth.RequireAuth, auth.RequireFeature("files"))
			fr.Post("/list", filesH.List)
			fr.Post("/read", filesH.Read)
			fr.Post("/write", filesH.Write)
			fr.Post("/delete", filesH.Delete)
			fr.Get("/download", filesH.Download)
			fr.Post("/upload", filesH.Upload)
			fr.Post("/share", filesH.CreateShare)
			fr.Get("/shares", filesH.ListShares)
			fr.Delete("/shares/{token}", filesH.RevokeShare)
			fr.Post("/media-info", filesH.MediaInfo)
			fr.Get("/subtitle", filesH.Subtitle)
		})

		// Movie section: scrape pahe.ink + server-side download queue. Finished
		// files land under the SafePath allowlist, so they reuse the /files
		// player, streaming and share endpoints above with no extra wiring.
		api.Route("/movies", func(mr chi.Router) {
			mr.Use(auth.RequireAuth, auth.RequireFeature("movies"))
			mr.Post("/search", moviesH.Search)
			mr.Post("/detail", moviesH.Detail)
			mr.Post("/download", moviesH.StartDownload)
			mr.Get("/downloads", moviesH.ListDownloads)
			mr.Get("/downloads/stream", moviesH.DownloadsStream)
			mr.Delete("/downloads/{id}", moviesH.CancelDownload)
			mr.Post("/downloads/{id}/pause", moviesH.PauseDownload)
			mr.Post("/downloads/{id}/resume", moviesH.ResumeDownload)
			// Stream library management: add a file manually, rename, re-thumbnail,
			// or delete a finished movie outright (unlike CancelDownload above,
			// which only stops an in-flight download).
			mr.Post("/manual", moviesH.ManualAdd)
			mr.Patch("/library/{id}", moviesH.UpdateLibraryItem)
			mr.Post("/library/{id}/thumbnail", moviesH.UploadThumbnail)
			mr.Delete("/library/{id}", moviesH.DeleteLibraryItem)
			// Subtitle search/download (subsource.net) — saves sidecars next to a
			// downloaded movie so the player's existing subtitle detection picks
			// them up with no extra wiring.
			mr.Post("/subtitles/search", subtitlesH.Search)
			mr.Post("/subtitles/download", subtitlesH.Download)
			// Torrent search (torrent-search-api sidecar) + magnet download via
			// aria2, tracked through the same Job list/SSE stream as above.
			mr.Post("/torrents/search", moviesH.TorrentSearch)
			mr.Post("/torrents/download", moviesH.StartTorrentDownload)
		})
	})

	// Public file share links: intentionally OUTSIDE /api and its auth — anyone
	// with the link can fetch the shared file/folder, which is the whole point.
	// Mounted on r directly, like /terminal and the ai-gateway proxy.
	r.Get("/share/{token}", filesH.ServePublicShare)
	r.Get("/share/{token}/*", filesH.ServePublicShare)

	// AI Gateway proxy: called by an external client app (not the browser),
	// so it deliberately sits outside apiLimiter's per-IP human-traffic budget
	// and uses its own gateway-key auth instead of the cookie session — same
	// reasoning as /terminal being mounted directly on r instead of under /api.
	r.Route("/api/ai-gateway/v1", func(gwr chi.Router) {
		gwr.Use(gatewayAuth.RequireGatewayKey)
		gwr.Post("/chat/completions", aigatewayH.ChatCompletions)
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

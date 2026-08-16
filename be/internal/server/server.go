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
	"github.com/nawfdev/home-panel/internal/audit"
	"github.com/nawfdev/home-panel/internal/backup"
	"github.com/nawfdev/home-panel/internal/cloudflare"
	"github.com/nawfdev/home-panel/internal/config"
	dockersvc "github.com/nawfdev/home-panel/internal/docker"
	filesvc "github.com/nawfdev/home-panel/internal/files"
	"github.com/nawfdev/home-panel/internal/handlers"
	"github.com/nawfdev/home-panel/internal/hosthealth"
	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/logs"
	"github.com/nawfdev/home-panel/internal/metrics"
	moviesvc "github.com/nawfdev/home-panel/internal/movies"
	musicsvc "github.com/nawfdev/home-panel/internal/music"
	"github.com/nawfdev/home-panel/internal/networkhistory"
	pm2svc "github.com/nawfdev/home-panel/internal/pm2"
	"github.com/nawfdev/home-panel/internal/prober"
	"github.com/nawfdev/home-panel/internal/projects"
	"github.com/nawfdev/home-panel/internal/remotedesktop"
	"github.com/nawfdev/home-panel/internal/session"
	"github.com/nawfdev/home-panel/internal/smartdisk"
	"github.com/nawfdev/home-panel/internal/sshmgr"
	"github.com/nawfdev/home-panel/internal/store"
	"github.com/nawfdev/home-panel/internal/telegram"
	termsvc "github.com/nawfdev/home-panel/internal/terminal"
	"github.com/nawfdev/home-panel/internal/torrentsearch"
	"github.com/nawfdev/home-panel/internal/tunnel"
	tvsvc "github.com/nawfdev/home-panel/internal/tv"
	"github.com/nawfdev/home-panel/internal/updater"
)

// Deps holds everything the router needs.
type Deps struct {
	AiGateway      *aigateway.Service
	Audit          *audit.Logger
	Backups        *backup.Service
	Cloudflare     *cloudflare.Service
	Config         *config.Config
	Docker         *dockersvc.Service
	Files          *filesvc.Service
	Health         *hosthealth.Service
	Movies         *moviesvc.Service
	Music          *musicsvc.Service
	NetworkHistory *networkhistory.Collector
	Prober         *prober.Manager
	Storage        *smartdisk.Service
	TorrentSearch  *torrentsearch.Service
	Paths          config.Paths
	Hosts          *sshmgr.Manager
	Store          *store.Store
	Sessions       *session.Manager
	Metrics        *metrics.Collector
	Logs           *logs.Service
	PM2            *pm2svc.Service
	Projects       *projects.Manager
	RemoteDesktop  *remotedesktop.Manager
	Telegram       *telegram.Service
	Terminal       *termsvc.Service
	TV             *tvsvc.Service
	Tunnel         *tunnel.Service
	Updater        *updater.Updater
}

// New builds the top-level http.Handler.
func New(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(httpx.NewIPAllowlist(d.Config.Security.AllowedIPs).Middleware)
	r.Use(httpx.TrustedProxy)
	r.Use(middleware.Recoverer)
	r.Use(httpx.SecurityHeaders)
	r.Use(httpx.CSRFProtection)

	auth := &handlers.Auth{Store: d.Store, Session: d.Sessions, Audit: d.Audit}
	passkeysH := &handlers.Passkeys{Store: d.Store, Session: d.Sessions, Audit: d.Audit}
	system := handlers.System{Store: d.Store, PM2: d.PM2}
	services := handlers.Services{Audit: d.Audit}
	metricsH := &handlers.Metrics{Collector: d.Metrics}
	logsH := &handlers.Logs{Svc: d.Logs}
	pm2H := &handlers.PM2{Svc: d.PM2}
	dockerH := &handlers.Docker{Svc: d.Docker, RootDir: d.Paths.Root}
	filesH := &handlers.Files{Svc: d.Files, Audit: d.Audit}
	tunnelH := &handlers.Tunnel{Svc: d.Tunnel}
	projectsH := &handlers.Projects{Mgr: d.Projects}
	remoteDesktopH := &handlers.RemoteDesktop{Mgr: d.RemoteDesktop}
	networkH := &handlers.Network{Tunnel: d.Tunnel, Store: d.Store, SSH: d.Hosts}
	dashboardH := &handlers.Dashboard{Cloudflare: d.Cloudflare, Store: d.Store, Tunnel: d.Tunnel, Projects: d.Projects}
	updateH := &handlers.Update{Updater: d.Updater, Store: d.Store, PM2: d.PM2}
	cloudflareH := &handlers.Cloudflare{Store: d.Store, Svc: d.Cloudflare}
	settingsH := &handlers.Settings{Store: d.Store, Telegram: d.Telegram}
	telegramH := &handlers.Telegram{Bot: d.Telegram}
	exportH := handlers.Export{}
	aigatewayH := &handlers.AiGateway{Svc: d.AiGateway}
	gatewayAuth := &handlers.GatewayAuth{Svc: d.AiGateway}
	moviesH := &handlers.Movies{Svc: d.Movies, Torrents: d.TorrentSearch, Files: d.Files}
	musicH := &handlers.Music{Svc: d.Music}
	subtitlesH := &handlers.Subtitles{}
	tvH := &handlers.TV{Svc: d.TV}
	usersH := &handlers.Users{Store: d.Store}
	rolesH := &handlers.Roles{Store: d.Store}
	hostsH := &handlers.Hosts{Store: d.Store, SSH: d.Hosts, Prober: d.Prober}
	auditH := &handlers.AuditLog{Log: d.Audit}
	backupH := &handlers.Backups{Service: d.Backups, Audit: d.Audit}
	healthH := &handlers.Health{Service: d.Health}
	networkHistoryH := &handlers.NetworkHistory{Collector: d.NetworkHistory}
	monitorsH := &handlers.Monitors{Prober: d.Prober, Store: d.Store}
	storageH := &handlers.Storage{Svc: d.Storage}
	terminalExtraH := &handlers.TerminalExtra{Store: d.Store, SSH: d.Hosts}

	// Rate limiters mirror express-rate-limit windows from server.js.
	apiLimiter := httpx.NewRateLimiter(15*time.Minute, 500, false,
		"Too many requests from this IP, please try again later.")
	loginLimiter := httpx.NewRateLimiter(15*time.Minute, 10, true,
		"Too many login attempts, please try again later.")

	r.With(auth.RequireAuth, auth.RequireFeature("terminal")).Get("/terminal/ws", d.Terminal.Handler)
	tvProxy := r.With(auth.RequireAuth, auth.RequireFeature("tv"))
	tvProxy.Get("/tv-proxy", tvH.Proxy)
	tvProxy.Post("/tv-proxy", tvH.Proxy)

	r.Route("/api", func(api chi.Router) {
		api.Use(apiLimiter.Middleware)

		api.Route("/auth", func(ar chi.Router) {
			ar.With(loginLimiter.Middleware).Post("/login", auth.Login)
			ar.Post("/logout", auth.Logout)
			ar.With(auth.RequireAuth).Get("/me", auth.Me)
			ar.With(auth.RequireAuth).Post("/change-password", auth.ChangePassword)
			ar.With(auth.RequireAuth).Get("/totp", auth.TOTPStatus)
			ar.With(auth.RequireAuth).Post("/totp/setup", auth.TOTPSetup)
			ar.With(auth.RequireAuth).Post("/totp/enable", auth.TOTPEnable)
			ar.With(auth.RequireAuth).Post("/totp/disable", auth.TOTPDisable)
			ar.With(auth.RequireAuth).Get("/sessions", auth.ListSessions)
			ar.With(auth.RequireAuth).Delete("/sessions/{id}", auth.RevokeSession)

			// WebAuthn Passkeys & Biometric Auth
			ar.With(auth.RequireAuth).Get("/passkeys", passkeysH.List)
			ar.With(auth.RequireAuth).Post("/passkeys/register/begin", passkeysH.RegisterBegin)
			ar.With(auth.RequireAuth).Post("/passkeys/register/finish", passkeysH.RegisterFinish)
			ar.With(auth.RequireAuth).Delete("/passkeys/{id}", passkeysH.Delete)
			ar.With(loginLimiter.Middleware).Post("/passkeys/login/begin", passkeysH.LoginBegin)
			ar.With(loginLimiter.Middleware).Post("/passkeys/login/finish", passkeysH.LoginFinish)
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

		api.With(auth.RequireAuth).Get("/health/hosts", healthH.List)

		// Uptime Kuma SLA Prober & Monitors
		api.Route("/monitors", func(mr chi.Router) {
			mr.Use(auth.RequireAuth, auth.RequireFeature("monitoring"))
			mr.Get("/", monitorsH.List)
			mr.With(auth.RequireRole("admin")).Post("/", monitorsH.Create)
			mr.With(auth.RequireRole("admin")).Put("/{id}", monitorsH.Update)
			mr.With(auth.RequireRole("admin")).Patch("/{id}/public", monitorsH.SetPublic)
			mr.With(auth.RequireRole("admin")).Delete("/{id}", monitorsH.Delete)
			mr.Post("/{id}/check", monitorsH.Check)
		})
		api.With(auth.RequireAuth).Post("/wol/wake", monitorsH.WakeOnLAN)

		// Public Uptime Status Page (no auth) - shows only monitors flagged Public
		api.Get("/status/public", monitorsH.PublicStatus)

		// S.M.A.R.T. Disk Health & Storage Overview
		api.Route("/storage", func(sr chi.Router) {
			sr.Use(auth.RequireAuth, auth.RequireFeature("storage"))
			sr.Get("/disks", storageH.Disks)
		})

		// Terminal SFTP Upload & Custom Snippets
		api.Route("/terminal", func(tr chi.Router) {
			tr.Use(auth.RequireAuth, auth.RequireFeature("terminal"))
			tr.Post("/upload", terminalExtraH.Upload)
		})
		api.Route("/snippets", func(sr chi.Router) {
			sr.Use(auth.RequireAuth)
			sr.Get("/", terminalExtraH.ListSnippets)
			sr.Post("/", terminalExtraH.SaveSnippet)
			sr.Delete("/{id}", terminalExtraH.DeleteSnippet)
		})

		api.Route("/audit", func(ar chi.Router) {
			ar.Use(auth.RequireAuth, auth.RequireRole("admin"))
			ar.Get("/", auditH.List)
		})
		api.Route("/backups", func(br chi.Router) {
			br.Use(auth.RequireAuth, auth.RequireRole("admin"))
			br.Get("/", backupH.List)
			br.Post("/", backupH.Create)
			br.Get("/download", backupH.Download)
			br.Post("/restore", backupH.Restore)
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

		api.Route("/hosts", func(hr chi.Router) {
			hr.Use(auth.RequireAuth)
			hr.Get("/", hostsH.List)
			hr.With(auth.RequireRole("admin")).Post("/", hostsH.Create)
			hr.With(auth.RequireRole("admin")).Patch("/{id}", hostsH.Update)
			hr.With(auth.RequireRole("admin")).Put("/{id}", hostsH.Update)
			hr.With(auth.RequireRole("admin")).Delete("/{id}", hostsH.Delete)
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
			pr.With(auth.RequireRole("admin")).Post("/", projectsH.Create)
			pr.Get("/{id}", projectsH.Get)
			pr.With(auth.RequireRole("admin")).Put("/{id}", projectsH.Update)
			pr.With(auth.RequireRole("admin")).Delete("/{id}", projectsH.Delete)
			pr.With(auth.RequireRole("admin")).Post("/{id}/start", projectsH.Start)
			pr.With(auth.RequireRole("admin")).Post("/{id}/stop", projectsH.Stop)
			pr.With(auth.RequireRole("admin")).Post("/{id}/restart", projectsH.Restart)
			pr.Get("/{id}/logs", projectsH.Logs)
			pr.With(auth.RequireRole("admin")).Post("/{id}/deploy", projectsH.Deploy)
			pr.With(auth.RequireRole("admin")).Post("/{id}/rollback", projectsH.Rollback)
			pr.With(auth.RequireRole("admin")).Post("/{id}/configure", projectsH.Configure)
			pr.Get("/{id}/health", projectsH.Health)
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
			nr.Get("/stats", networkH.Stats)
			nr.Get("/public-ip", networkH.PublicIP)
			nr.Get("/interfaces", networkH.Interfaces)
			nr.Get("/connectivity", networkH.Connectivity)
			nr.Get("/history", networkHistoryH.History)
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

			// Docker Compose Stacks & App Templates
			dr.Get("/compose/stacks", dockerH.ListStacks)
			dr.Get("/compose/stacks/{name}", dockerH.GetStack)
			dr.With(auth.RequireRole("admin")).Post("/compose/stacks", dockerH.SaveStack)
			dr.With(auth.RequireRole("admin")).Post("/compose/stacks/{name}/up", dockerH.UpStack)
			dr.With(auth.RequireRole("admin")).Post("/compose/stacks/{name}/down", dockerH.DownStack)
			dr.With(auth.RequireRole("admin")).Post("/compose/stacks/{name}/restart", dockerH.RestartStack)
			dr.With(auth.RequireRole("admin")).Delete("/compose/stacks/{name}", dockerH.DeleteStack)
			dr.Get("/compose/templates", dockerH.Templates)
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
			mr.Post("/manual", moviesH.ManualAdd)
			mr.Patch("/library/{id}", moviesH.UpdateLibraryItem)
			mr.Post("/library/{id}/thumbnail", moviesH.UploadThumbnail)
			mr.Delete("/library/{id}", moviesH.DeleteLibraryItem)
			mr.Post("/subtitles/search", subtitlesH.Search)
			mr.Post("/subtitles/download", subtitlesH.Download)
			mr.Post("/torrents/search", moviesH.TorrentSearch)
			mr.Post("/torrents/download", moviesH.StartTorrentDownload)
		})

		api.Route("/music", func(mur chi.Router) {
			mur.Use(auth.RequireAuth, auth.RequireFeature("music"))
			mur.Get("/available", musicH.AvailableStatus)
			mur.Handle("/librespot/*", http.StripPrefix("/api/music/librespot", http.HandlerFunc(musicH.Librespot)))
			mur.Get("/stream", musicH.Stream)
		})

		api.Route("/tv", func(tr chi.Router) {
			tr.Use(auth.RequireAuth, auth.RequireFeature("tv"))
			tr.Get("/channels", tvH.Channels)
		})
	})

	r.Get("/share/{token}", filesH.ServePublicShare)
	r.Get("/share/{token}/*", filesH.ServePublicShare)

	r.Route("/api/ai-gateway/v1", func(gwr chi.Router) {
		gwr.Use(gatewayAuth.RequireGatewayKey)
		gwr.Post("/chat/completions", aigatewayH.ChatCompletions)
	})

	r.NotFound(spaHandler(d.Paths.Frontend))

	return r
}

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

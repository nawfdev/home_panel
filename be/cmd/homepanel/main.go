// Command homepanel is the Go rewrite of the Home Panel server (formerly
// backend/server.js). Run it from the project root, or set HOMEPANEL_ROOT.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/nawfdev/home-panel/internal/aigateway"
	"github.com/nawfdev/home-panel/internal/alerts"
	"github.com/nawfdev/home-panel/internal/cloudflare"
	"github.com/nawfdev/home-panel/internal/config"
	"github.com/nawfdev/home-panel/internal/docker"
	"github.com/nawfdev/home-panel/internal/files"
	"github.com/nawfdev/home-panel/internal/logs"
	"github.com/nawfdev/home-panel/internal/metrics"
	"github.com/nawfdev/home-panel/internal/movies"
	"github.com/nawfdev/home-panel/internal/pm2"
	"github.com/nawfdev/home-panel/internal/projects"
	"github.com/nawfdev/home-panel/internal/server"
	"github.com/nawfdev/home-panel/internal/session"
	"github.com/nawfdev/home-panel/internal/store"
	"github.com/nawfdev/home-panel/internal/telegram"
	"github.com/nawfdev/home-panel/internal/terminal"
	"github.com/nawfdev/home-panel/internal/tunnel"
	"github.com/nawfdev/home-panel/internal/updater"
)

func main() {
	paths := config.ResolvePaths()

	cfg, err := config.Load(paths.ConfigFile)
	if err != nil {
		log.Fatalf("failed to load config (%s): %v", paths.ConfigFile, err)
	}

	st, err := store.Open(paths.DataFile)
	if err != nil {
		log.Fatalf("failed to open data store (%s): %v", paths.DataFile, err)
	}
	if err := st.InitDefaultAdmin(cfg.DefaultAdmin.Username, cfg.DefaultAdmin.Password); err != nil {
		log.Fatalf("failed to init default admin: %v", err)
	}

	sess := session.New(cfg.Session.Secret, cfg.Session.MaxAge)
	tg := telegram.New(st)
	term := terminal.New(sess)

	// Background metrics collection (replaces startMetricsCollection in server.js).
	mc := metrics.New()
	mc.Start(context.Background())
	log.Println("Starting metrics collection (every 60s)...")

	tun := tunnel.New()
	proj := projects.New(st)
	alerts.New(cfg, tg, tun).Start(context.Background())

	aigw := aigateway.New(st)
	aigw.StartUsageFlusher(context.Background(), 30*time.Second)

	mov := movies.New()

	handler := server.New(server.Deps{
		AiGateway:  aigw,
		Cloudflare: cloudflare.New(st),
		Config:     cfg,
		Docker:     docker.New(),
		Files:      files.New(st),
		Movies:     mov,
		Paths:      paths,
		Store:      st,
		Sessions:   sess,
		Metrics:    mc,
		Logs:       logs.New(paths.Root),
		PM2:        pm2.New(),
		Projects:   proj,
		Telegram:   tg,
		Terminal:   term,
		Tunnel:     tun,
		Updater:    updater.New(paths.Root),
	})

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	srv := &http.Server{Addr: addr, Handler: handler}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Println("Nestcore - Server Started")
		log.Printf("URL: http://%s", addr)
		log.Println("Default Login: admin / admin123")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("Shutting down: stopping tunnel and project processes...")
	tun.Shutdown()
	proj.StopAll()
	aigw.FlushUsage()
	mov.Shutdown()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown error: %v", err)
	}
}

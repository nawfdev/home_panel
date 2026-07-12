// Package alerts ports backend/services/alerts.js as a background monitor.
package alerts

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/nawfdev/home-panel/internal/config"
	"github.com/nawfdev/home-panel/internal/sysstats"
	"github.com/nawfdev/home-panel/internal/telegram"
	"github.com/nawfdev/home-panel/internal/tunnel"
)

type Config struct {
	Enabled    bool          `json:"enabled"`
	Cooldown   time.Duration `json:"-"`
	CooldownMS int64         `json:"cooldown"`
	Thresholds struct {
		CPU struct {
			Warning  float64 `json:"warning"`
			Critical float64 `json:"critical"`
		} `json:"cpu"`
		Memory struct {
			Warning  float64 `json:"warning"`
			Critical float64 `json:"critical"`
		} `json:"memory"`
		Disk struct {
			Warning  float64 `json:"warning"`
			Critical float64 `json:"critical"`
		} `json:"disk"`
		Temperature struct {
			Warning  float64 `json:"warning"`
			Critical float64 `json:"critical"`
		} `json:"temperature"`
	} `json:"thresholds"`
}

type state struct {
	Triggered    bool
	LastAlert    time.Time
	LastRestart  time.Time
	RestartCount int
}

type Service struct {
	cfg      Config
	telegram *telegram.Service
	tunnel   *tunnel.Service
	mu       sync.Mutex
	states   map[string]*state
}

func New(appCfg *config.Config, tg *telegram.Service, tun *tunnel.Service) *Service {
	cfg := defaultConfig()
	if len(appCfg.Alerts) > 0 {
		_ = json.Unmarshal(appCfg.Alerts, &cfg)
	}
	if cfg.CooldownMS <= 0 {
		cfg.CooldownMS = 300000
	}
	cfg.Cooldown = time.Duration(cfg.CooldownMS) * time.Millisecond
	return &Service{cfg: cfg, telegram: tg, tunnel: tun, states: map[string]*state{"cpu": {}, "memory": {}, "disk": {}, "temperature": {}, "tunnel": {}}}
}

func defaultConfig() Config {
	var cfg Config
	cfg.Enabled = false
	cfg.CooldownMS = 300000
	cfg.Thresholds.CPU.Warning = 70
	cfg.Thresholds.CPU.Critical = 85
	cfg.Thresholds.Memory.Warning = 75
	cfg.Thresholds.Memory.Critical = 90
	cfg.Thresholds.Disk.Warning = 80
	cfg.Thresholds.Disk.Critical = 90
	cfg.Thresholds.Temperature.Warning = 70
	cfg.Thresholds.Temperature.Critical = 85
	return cfg
}

func (s *Service) Start(ctx context.Context) {
	if !s.cfg.Enabled {
		log.Println("Alert monitoring disabled in config")
		return
	}
	if s.telegram != nil {
		s.telegram.SetMonitoring(true)
	}
	log.Println("Starting alert threshold monitoring...")
	go func() {
		s.check(ctx)
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				if s.telegram != nil {
					s.telegram.SetMonitoring(false)
				}
				return
			case <-ticker.C:
				s.check(ctx)
			}
		}
	}()
}

func (s *Service) check(ctx context.Context) {
	stats, err := sysstats.GetSystemStats(ctx)
	if err != nil {
		log.Println("Alert monitoring error:", err)
		return
	}
	now := time.Now()
	s.threshold(ctx, "cpu", stats.CPU.Usage, s.cfg.Thresholds.CPU.Warning, s.cfg.Thresholds.CPU.Critical, "%", now)
	s.threshold(ctx, "memory", stats.Memory.UsagePercent, s.cfg.Thresholds.Memory.Warning, s.cfg.Thresholds.Memory.Critical, "%", now)
	if len(stats.Disk) > 0 {
		s.threshold(ctx, "disk", stats.Disk[0].UsagePercent, s.cfg.Thresholds.Disk.Warning, s.cfg.Thresholds.Disk.Critical, "%", now)
	}
	if temp := sysstats.GetTemperature(ctx); temp.Available && temp.Main != nil {
		s.threshold(ctx, "temperature", *temp.Main, s.cfg.Thresholds.Temperature.Warning, s.cfg.Thresholds.Temperature.Critical, "°C", now)
	}
	s.checkTunnel(ctx, now)
}

func (s *Service) threshold(ctx context.Context, metric string, current, warning, critical float64, unit string, now time.Time) {
	level := ""
	threshold := 0.0
	if critical > 0 && current >= critical {
		level, threshold = "critical", critical
	} else if warning > 0 && current >= warning {
		level, threshold = "warning", warning
	}
	if level == "" {
		s.recover(ctx, metric, current, unit)
		return
	}
	st := s.getState(metric)
	if st.Triggered && now.Sub(st.LastAlert) < s.cfg.Cooldown {
		return
	}
	st.Triggered = true
	st.LastAlert = now
	emoji := "⚠️"
	if level == "critical" {
		emoji = "🔴"
	}
	msg := fmt.Sprintf("%s *%s: High %s Usage*\n\n%s: %.1f%s (threshold: %.0f%s)\nTime: %s", emoji, upper(level), title(metric), upper(metric), current, unit, threshold, unit, now.Format("15:04:05"))
	log.Printf("Alert: %s %s - %.1f%s", metric, level, current, unit)
	s.notify(ctx, msg)
}

func (s *Service) recover(ctx context.Context, metric string, current float64, unit string) {
	st := s.getState(metric)
	if !st.Triggered {
		return
	}
	st.Triggered = false
	msg := fmt.Sprintf("✅ *Resolved: %s Back to Normal*\n\n%s: %.1f%s\nTime: %s", title(metric), upper(metric), current, unit, time.Now().Format("15:04:05"))
	log.Printf("Recovery: %s - %.1f%s", metric, current, unit)
	s.notify(ctx, msg)
}

func (s *Service) checkTunnel(ctx context.Context, now time.Time) {
	st := s.getState("tunnel")
	status := s.tunnel.GetStatus(ctx)
	if status.ProcessRunning || status.IsReady {
		if st.Triggered {
			st.Triggered = false
			s.notify(ctx, "✅ *Tunnel Recovered*\n\nCloudflare tunnel is now healthy.\nTime: "+now.Format("15:04:05"))
		}
		if now.Sub(st.LastRestart) > 10*time.Minute {
			st.RestartCount = 0
		}
		return
	}
	if now.Sub(st.LastRestart) < 2*time.Minute {
		return
	}
	if st.RestartCount >= 5 {
		if !st.Triggered {
			st.Triggered = true
			st.LastAlert = now
			s.notify(ctx, "🔴 *Tunnel Auto-Recovery Failed*\n\nTunnel unhealthy after 5 restart attempts.\nPlease check manually.\nTime: "+now.Format("15:04:05"))
		}
		return
	}
	_, _ = s.tunnel.StartTunnel(ctx)
	st.LastRestart = now
	st.RestartCount++
	s.notify(ctx, fmt.Sprintf("🔄 *Tunnel Auto-Restart*\n\nTunnel was unhealthy, attempting restart...\nAttempt: %d/5\nTime: %s", st.RestartCount, now.Format("15:04:05")))
}

func (s *Service) getState(metric string) *state {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.states[metric]
	if st == nil {
		st = &state{}
		s.states[metric] = st
	}
	return st
}

func (s *Service) notify(ctx context.Context, msg string) {
	if s.telegram == nil {
		return
	}
	if err := s.telegram.SendNotification(ctx, msg); err != nil {
		log.Println("Telegram notification failed:", err)
	}
}

func title(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func upper(s string) string { return strings.ToUpper(s) }

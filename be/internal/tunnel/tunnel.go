// Package tunnel ports backend/services/cloudflared.js.
package tunnel

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/kaysa/home-panel/internal/platform"
)

const (
	metricsPort = 36500
	metricsURL  = "http://127.0.0.1:36500"
	serviceUnit = "cloudflared"
)

type DowntimeEvent struct {
	Start       int64 `json:"start"`
	End         int64 `json:"end"`
	DurationMs  int64 `json:"durationMs"`
	DurationSec int64 `json:"durationSec"`
}

// Downtime mirrors the downtime sub-object in getTunnelStatus.
type Downtime struct {
	IsDown             bool            `json:"isDown"`
	CurrentDowntimeMs  int64           `json:"currentDowntimeMs"`
	CurrentDowntimeSec int64           `json:"currentDowntimeSec"`
	TotalDowntimeMs    int64           `json:"totalDowntimeMs"`
	TotalDowntimeSec   int64           `json:"totalDowntimeSec"`
	History            []DowntimeEvent `json:"history,omitempty"`
}

// Status mirrors the object returned by getTunnelStatus in cloudflared.js.
type Status struct {
	Configured     bool        `json:"configured"`
	Tunnel         interface{} `json:"tunnel"`
	ProcessRunning bool        `json:"processRunning"`
	Pid            *int        `json:"pid"`
	IsReady        bool        `json:"isReady"`
	AutoRestart    bool        `json:"autoRestart"`
	RestartCount   int         `json:"restartCount"`
	NextRetryIn    int64       `json:"nextRetryIn"`
	Downtime       *Downtime   `json:"downtime,omitempty"`
}

// CloudflaredInfo mirrors checkCloudflaredInstalled().
type CloudflaredInfo struct {
	Installed bool   `json:"installed"`
	Version   string `json:"version,omitempty"`
	Path      string `json:"path,omitempty"`
}

type Result map[string]any

type Metrics struct {
	Connections          int            `json:"connections"`
	ActiveConnections    int            `json:"activeConnections"`
	Requests             int            `json:"requests"`
	Errors               int            `json:"errors"`
	BytesIn              int64          `json:"bytesIn"`
	BytesOut             int64          `json:"bytesOut"`
	ConnectionsPerRegion map[string]int `json:"connectionsPerRegion"`
	Uptime               int64          `json:"uptime"`
	BuildVersion         string         `json:"buildVersion"`
}

// SystemdStatus is the shape consumed by frontend/js/app.js.
type SystemdStatus struct {
	Available bool      `json:"available"`
	Reason    string    `json:"reason,omitempty"`
	Active    bool      `json:"active"`
	IsActive  bool      `json:"isActive"`
	State     string    `json:"state"`
	SubState  string    `json:"subState"`
	PID       any       `json:"pid"`
	StartTime string    `json:"startTime,omitempty"`
	Protocol  string    `json:"protocol"`
	Downtime  *Downtime `json:"downtime,omitempty"`
}

// Service holds runtime tunnel state.
type Service struct {
	mu             sync.Mutex
	autoRestart    bool
	restartCount   int
	lastRestart    time.Time
	cmd            *exec.Cmd
	downtimeStart  time.Time
	totalDowntime  time.Duration
	downtimeEvents []DowntimeEvent
}

func New() *Service { return &Service{autoRestart: true} }

// ready probes the local cloudflared metrics /ready endpoint.
func ready(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, metricsURL+"/ready", nil)
	if err != nil {
		return false
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

// GetStatus reports whether cloudflared is running and whether it is ready.
func (s *Service) GetStatus(ctx context.Context) Status {
	s.mu.Lock()
	st := Status{AutoRestart: s.autoRestart, RestartCount: s.restartCount, Tunnel: nil}
	if s.cmd != nil && s.cmd.Process != nil {
		pid := s.cmd.Process.Pid
		st.Pid = &pid
		st.ProcessRunning = true
	}
	st.Downtime = s.downtimeLocked()
	if s.autoRestart && s.cmd == nil && s.restartCount > 0 && !s.lastRestart.IsZero() {
		delays := []time.Duration{5 * time.Second, 10 * time.Second, 30 * time.Second, time.Minute, 5 * time.Minute}
		delay := delays[min(s.restartCount-1, len(delays)-1)]
		next := s.lastRestart.Add(delay)
		if time.Now().Before(next) {
			st.NextRetryIn = int64(time.Until(next).Seconds())
		}
	}
	s.mu.Unlock()

	svc, err := platform.Controller().Status(ctx, serviceUnit)
	if err == nil && svc.Available && svc.Active {
		st.ProcessRunning = true
		if svc.PID > 0 {
			pid := svc.PID
			st.Pid = &pid
		}
	}
	if ready(ctx) {
		st.ProcessRunning = true
		st.IsReady = true
	}
	return st
}

// CheckInstalled mirrors checkCloudflaredInstalled(): `cloudflared --version` + common paths.
func (s *Service) CheckInstalled(ctx context.Context) CloudflaredInfo {
	if out, err := run(ctx, "cloudflared", "--version"); err == nil && strings.TrimSpace(out) != "" {
		return CloudflaredInfo{Installed: true, Version: strings.TrimSpace(out)}
	}
	for _, p := range commonCloudflaredPaths() {
		if _, err := os.Stat(p); err != nil {
			continue
		}
		out, err := run(ctx, p, "--version")
		version := "Unknown"
		if err == nil && strings.TrimSpace(out) != "" {
			version = strings.TrimSpace(out)
		}
		return CloudflaredInfo{Installed: true, Version: version, Path: p}
	}
	return CloudflaredInfo{Installed: false}
}

func (s *Service) ListTunnels(ctx context.Context) (Result, error) {
	out, err := run(ctx, "cloudflared", "tunnel", "list")
	if err != nil {
		return nil, err
	}
	return Result{"success": true, "output": out}, nil
}

func (s *Service) CreateTunnel(ctx context.Context, name string) (Result, error) {
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("Tunnel name required")
	}
	out, err := run(ctx, "cloudflared", "tunnel", "create", name)
	if err != nil {
		return nil, err
	}
	return Result{"success": true, "tunnelId": parseTunnelID(out), "output": out}, nil
}

func (s *Service) ConfigureTunnel(tunnelID, domain string, localPort int) (Result, error) {
	if tunnelID == "" || domain == "" || localPort == 0 {
		return nil, fmt.Errorf("tunnelId, domain, and localPort required")
	}
	configDir := filepath.Join(homeDir(), ".cloudflared")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return nil, err
	}
	configPath := filepath.Join(configDir, "config.yml")
	content := fmt.Sprintf("tunnel: %s\ncredentials-file: %s\n\ningress:\n  - hostname: %s\n    service: http://localhost:%d\n  - service: http_status:404\n", tunnelID, filepath.Join(configDir, tunnelID+".json"), domain, localPort)
	if err := os.WriteFile(configPath, []byte(content), 0o644); err != nil {
		return nil, err
	}
	return Result{"success": true, "configPath": configPath}, nil
}

func (s *Service) RouteTunnel(ctx context.Context, tunnelID, domain string) (Result, error) {
	if tunnelID == "" || domain == "" {
		return nil, fmt.Errorf("tunnelId and domain required")
	}
	out, err := run(ctx, "cloudflared", "tunnel", "route", "dns", tunnelID, domain)
	if err != nil {
		return nil, err
	}
	return Result{"success": true, "output": out}, nil
}

func (s *Service) StartTunnel(ctx context.Context) (Result, error) {
	s.mu.Lock()
	if s.cmd != nil && s.cmd.Process != nil {
		s.mu.Unlock()
		return Result{"success": false, "message": "Tunnel is already running"}, nil
	}
	args := []string{"tunnel", "run", "--protocol", "http2", "--metrics", fmt.Sprintf("127.0.0.1:%d", metricsPort)}
	if configPath := firstConfigPath(); configPath != "" {
		args = append(args, "--config", configPath)
	}
	cmd := exec.CommandContext(context.Background(), "cloudflared", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		s.mu.Unlock()
		return Result{"success": false, "message": err.Error()}, nil
	}
	s.cmd = cmd
	pid := cmd.Process.Pid
	s.endDowntimeLocked()
	s.mu.Unlock()

	go s.waitAndMaybeRestart(cmd)
	return Result{"success": true, "pid": pid, "message": "Tunnel started successfully"}, nil
}

func (s *Service) StopTunnel() Result {
	s.mu.Lock()
	cmd := s.cmd
	if cmd == nil || cmd.Process == nil {
		s.mu.Unlock()
		return Result{"success": false, "message": "No tunnel process running"}
	}
	wasAuto := s.autoRestart
	s.autoRestart = false
	proc := cmd.Process
	// Prefer SIGTERM so cloudflared can drain connections gracefully; only
	// hard-kill if the signal itself can't be delivered (e.g. unsupported
	// on Windows) or the process ignores it past the grace period.
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		_ = proc.Kill()
	}
	s.cmd = nil
	s.startDowntimeLocked()
	s.mu.Unlock()

	go func() {
		time.Sleep(5 * time.Second)
		_ = proc.Kill()
	}()

	go func() {
		time.Sleep(2 * time.Second)
		s.mu.Lock()
		s.autoRestart = wasAuto
		s.mu.Unlock()
	}()
	return Result{"success": true, "message": "Tunnel stopped"}
}

// Shutdown terminates a locally-spawned cloudflared process on panel exit, so
// a `systemctl restart homepanel` doesn't orphan it holding the tunnel/port.
func (s *Service) Shutdown() {
	s.mu.Lock()
	cmd := s.cmd
	s.autoRestart = false
	s.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return
	}
	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		_ = cmd.Process.Kill()
	}
}

func (s *Service) SetAutoRestart(enabled bool) Result {
	s.mu.Lock()
	s.autoRestart = enabled
	s.mu.Unlock()
	return Result{"success": true, "autoRestart": enabled}
}

func (s *Service) SystemdStatus(ctx context.Context) SystemdStatus {
	if runtime.GOOS != "linux" {
		return SystemdStatus{Available: false, Reason: "Systemd only available on Linux"}
	}
	svc, err := platform.Controller().Status(ctx, serviceUnit)
	if err != nil || !svc.Available {
		reason := "service not available"
		if err != nil {
			reason = err.Error()
		}
		return SystemdStatus{Available: false, Reason: reason}
	}
	state, subState := "inactive", "dead"
	if svc.Active {
		state, subState = "active", "running"
	}
	pid := any(nil)
	if svc.PID > 0 {
		pid = svc.PID
	}
	s.mu.Lock()
	dt := s.downtimeLocked()
	s.mu.Unlock()
	return SystemdStatus{Available: true, Active: svc.Active, IsActive: svc.Active, State: state, SubState: subState, PID: pid, StartTime: svc.Since, Protocol: systemdProtocol(), Downtime: dt}
}

func (s *Service) SystemdAction(ctx context.Context, action string) Result {
	if runtime.GOOS != "linux" {
		return Result{"success": false, "error": "Systemd only available on Linux"}
	}
	ctrl := platform.Controller()
	var err error
	switch action {
	case "start":
		err = ctrl.Start(ctx, serviceUnit)
	case "stop":
		err = ctrl.Stop(ctx, serviceUnit)
	case "restart":
		err = ctrl.Restart(ctx, serviceUnit)
	default:
		return Result{"success": false, "error": "unknown action"}
	}
	if err != nil {
		return Result{"success": false, "error": err.Error()}
	}
	return Result{"success": true, "message": "Cloudflared service " + action + "ed"}
}

func (s *Service) SetSystemdProtocol(ctx context.Context, protocol string) Result {
	if runtime.GOOS != "linux" {
		return Result{"success": false, "error": "Systemd only available on Linux"}
	}
	if protocol != "http2" && protocol != "quic" && protocol != "auto" {
		return Result{"success": false, "error": "Invalid protocol. Use: http2, quic, or auto"}
	}
	servicePath := "/etc/systemd/system/cloudflared.service"
	raw, err := os.ReadFile(servicePath)
	if err != nil {
		return Result{"success": false, "error": err.Error()}
	}
	content := string(raw)
	content = strings.ReplaceAll(content, "--protocol http2 ", "")
	content = strings.ReplaceAll(content, "--protocol quic ", "")
	if protocol != "auto" {
		content = strings.Replace(content, "tunnel run", "--protocol "+protocol+" tunnel run", 1)
	}
	tmp := filepath.Join(os.TempDir(), "cloudflared.service.tmp")
	if err := os.WriteFile(tmp, []byte(content), 0o644); err != nil {
		return Result{"success": false, "error": err.Error()}
	}
	// Only escalate via sudo when not already root: a non-root systemd unit
	// (the recommended hardened deployment) has no TTY for sudo to prompt on,
	// so an unconditional sudo call here fails outright in that setup.
	maybeSudo := func(args ...string) []string {
		if os.Geteuid() == 0 {
			return args
		}
		return append([]string{"sudo"}, args...)
	}
	cpArgs := maybeSudo("cp", tmp, servicePath)
	if _, err := run(ctx, cpArgs[0], cpArgs[1:]...); err != nil {
		return Result{"success": false, "error": err.Error()}
	}
	reloadArgs := maybeSudo("systemctl", "daemon-reload")
	_, _ = run(ctx, reloadArgs[0], reloadArgs[1:]...)
	restartArgs := maybeSudo("systemctl", "restart", serviceUnit)
	_, _ = run(ctx, restartArgs[0], restartArgs[1:]...)
	return Result{"success": true, "message": fmt.Sprintf("Protocol changed to %s. Service restarted.", protocol)}
}

func (s *Service) Metrics(ctx context.Context) Result {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, metricsURL+"/metrics", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return Result{"success": false, "error": err.Error()}
	}
	defer resp.Body.Close()
	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(resp.Body)
	metrics := parseMetrics(buf.String())
	if svc, err := platform.Controller().Status(ctx, serviceUnit); err == nil && svc.Since != "" {
		if started, err := time.Parse("Mon 2006-01-02 15:04:05 MST", svc.Since); err == nil {
			metrics.Uptime = int64(time.Since(started).Seconds())
		}
	}
	return Result{"success": true, "metrics": metrics}
}

func (s *Service) Logs(ctx context.Context, limit int) Result {
	if limit <= 0 {
		limit = 50
	}
	if limit > 5000 {
		limit = 5000
	}
	logs, err := platform.Controller().Logs(ctx, serviceUnit, limit)
	if err != nil {
		return Result{"success": true, "logs": []platform.LogEntry{}}
	}
	return Result{"success": true, "logs": logs}
}

func (s *Service) waitAndMaybeRestart(cmd *exec.Cmd) {
	_ = cmd.Wait()
	s.mu.Lock()
	if s.cmd == cmd {
		s.cmd = nil
	}
	s.startDowntimeLocked()
	auto := s.autoRestart
	if auto {
		s.restartCount++
		s.lastRestart = time.Now()
	}
	restarts := s.restartCount
	s.mu.Unlock()
	if !auto {
		return
	}
	delays := []time.Duration{5 * time.Second, 10 * time.Second, 30 * time.Second, time.Minute, 5 * time.Minute}
	time.Sleep(delays[min(restarts-1, len(delays)-1)])
	_, _ = s.StartTunnel(context.Background())
}

func (s *Service) startDowntimeLocked() {
	if s.downtimeStart.IsZero() {
		s.downtimeStart = time.Now()
	}
}

func (s *Service) endDowntimeLocked() {
	if s.downtimeStart.IsZero() {
		return
	}
	end := time.Now()
	duration := end.Sub(s.downtimeStart)
	s.totalDowntime += duration
	s.downtimeEvents = append(s.downtimeEvents, DowntimeEvent{Start: s.downtimeStart.UnixMilli(), End: end.UnixMilli(), DurationMs: duration.Milliseconds(), DurationSec: int64(duration.Seconds())})
	if len(s.downtimeEvents) > 10 {
		s.downtimeEvents = s.downtimeEvents[len(s.downtimeEvents)-10:]
	}
	s.downtimeStart = time.Time{}
}

func (s *Service) downtimeLocked() *Downtime {
	cur := int64(0)
	if !s.downtimeStart.IsZero() {
		cur = time.Since(s.downtimeStart).Milliseconds()
	}
	history := append([]DowntimeEvent(nil), s.downtimeEvents...)
	if len(history) > 5 {
		history = history[len(history)-5:]
	}
	return &Downtime{IsDown: !s.downtimeStart.IsZero(), CurrentDowntimeMs: cur, CurrentDowntimeSec: cur / 1000, TotalDowntimeMs: s.totalDowntime.Milliseconds(), TotalDowntimeSec: int64(s.totalDowntime.Seconds()), History: history}
}

func parseMetrics(text string) Metrics {
	m := Metrics{ConnectionsPerRegion: map[string]int{}, BuildVersion: "Unknown"}
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		name := fields[0]
		value, _ := strconv.ParseFloat(fields[1], 64)
		switch {
		case strings.HasPrefix(name, "cloudflared_tunnel_ha_connections"):
			m.ActiveConnections = int(value)
		case strings.HasPrefix(name, "cloudflared_tunnel_total_requests"):
			m.Requests = int(value)
		case strings.HasPrefix(name, "cloudflared_tunnel_request_errors"):
			m.Errors = int(value)
		case strings.HasPrefix(name, "cloudflared_tunnel_concurrent_requests_per_tunnel"):
			m.Connections = int(value)
		case strings.Contains(name, "build_info"):
			if v := labelValue(name, "version"); v != "" {
				m.BuildVersion = v
			}
		case strings.HasPrefix(name, "cloudflared_tunnel_server_locations"):
			if region := labelValue(name, "edge_location"); region != "" {
				m.ConnectionsPerRegion[region]++
			}
		case strings.Contains(name, "bytes") && strings.Contains(name, "in"):
			m.BytesIn += int64(value)
		case strings.Contains(name, "bytes") && strings.Contains(name, "out"):
			m.BytesOut += int64(value)
		}
	}
	return m
}

func labelValue(metric, label string) string {
	needle := label + "=\""
	idx := strings.Index(metric, needle)
	if idx < 0 {
		return ""
	}
	rest := metric[idx+len(needle):]
	end := strings.Index(rest, "\"")
	if end < 0 {
		return ""
	}
	return rest[:end]
}

func parseTunnelID(out string) string {
	for _, line := range strings.Split(out, "\n") {
		if idx := strings.Index(line, "Created tunnel "); idx >= 0 {
			rest := strings.TrimSpace(line[idx+len("Created tunnel "):])
			fields := strings.Fields(rest)
			if len(fields) > 0 {
				return strings.Trim(fields[0], ".")
			}
		}
	}
	return ""
}

func firstConfigPath() string {
	candidates := []string{
		filepath.Join(homeDir(), ".cloudflared", "config.yml"),
		filepath.Join(homeDir(), ".cloudflared", "config.yaml"),
		"/etc/cloudflared/config.yml",
		"/root/.cloudflared/config.yml",
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func commonCloudflaredPaths() []string {
	if runtime.GOOS == "windows" {
		return []string{`C:\Program Files\Cloudflare\cloudflared.exe`, `C:\Program Files (x86)\Cloudflare\cloudflared.exe`, filepath.Join(os.Getenv("USERPROFILE"), "cloudflared.exe")}
	}
	return []string{"/usr/local/bin/cloudflared", "/usr/bin/cloudflared", "/opt/cloudflared/cloudflared", filepath.Join(homeDir(), ".cloudflared", "bin", "cloudflared")}
}

func systemdProtocol() string {
	raw, err := os.ReadFile("/etc/systemd/system/cloudflared.service")
	if err != nil {
		return "auto"
	}
	text := string(raw)
	if strings.Contains(text, "--protocol http2") {
		return "http2"
	}
	if strings.Contains(text, "--protocol quic") {
		return "quic"
	}
	return "auto"
}

func homeDir() string {
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return h
	}
	if runtime.GOOS == "windows" {
		return os.Getenv("USERPROFILE")
	}
	return "/root"
}

func run(ctx context.Context, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return out.String(), fmt.Errorf("%s", strings.TrimSpace(out.String()+" "+err.Error()))
	}
	return out.String(), nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

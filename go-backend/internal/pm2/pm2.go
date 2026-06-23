package pm2

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Service struct {
	mu      sync.RWMutex
	command string
}

func New() *Service { return &Service{command: "pm2"} }

type Install struct {
	Command string `json:"command"`
	Note    string `json:"note"`
}

type Status struct {
	Available bool     `json:"available"`
	Version   string   `json:"version,omitempty"`
	Path      string   `json:"path,omitempty"`
	Method    string   `json:"method,omitempty"`
	Install   *Install `json:"install,omitempty"`
	Error     string   `json:"error,omitempty"`
}

type Process struct {
	Name     string `json:"name"`
	PID      int    `json:"pid"`
	Status   string `json:"status"`
	CPU      any    `json:"cpu"`
	Memory   int64  `json:"memory"`
	Uptime   string `json:"uptime"`
	Restarts int    `json:"restarts"`
	Mode     string `json:"mode"`
	Port     any    `json:"port"`
	Cwd      any    `json:"cwd"`
}

type Result struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

var portRE = regexp.MustCompile(`(?i)(?:--port|-p)\s*[=\s]?\s*(\d+)`)

func (s *Service) Check(ctx context.Context) Status {
	candidates := s.candidates()
	for _, c := range candidates {
		out, err := run(ctx, c.command, "--version")
		if err == nil && strings.TrimSpace(out) != "" {
			s.mu.Lock()
			s.command = c.command
			s.mu.Unlock()
			return Status{Available: true, Version: strings.TrimSpace(out), Path: c.path, Method: c.method}
		}
	}
	return Status{Available: false, Install: &Install{Command: "npm install -g pm2", Note: "Requires Node.js and npm to be installed"}}
}

func (s *Service) List(ctx context.Context) ([]Process, error) {
	if st := s.Check(ctx); !st.Available {
		return nil, errors.New("PM2 not available")
	}
	out, err := s.exec(ctx, "jlist")
	if err != nil {
		return nil, fmt.Errorf("Failed to list PM2 processes: %w", err)
	}
	return parseList(out)
}

func (s *Service) Get(ctx context.Context, nameOrID string) (Process, error) {
	processes, err := s.List(ctx)
	if err != nil {
		return Process{}, fmt.Errorf("Failed to get process info: %w", err)
	}
	for _, p := range processes {
		if p.Name == nameOrID || strconv.Itoa(p.PID) == nameOrID {
			return p, nil
		}
	}
	return Process{}, fmt.Errorf("Failed to get process info: Process %q not found", nameOrID)
}

func (s *Service) Start(ctx context.Context, name string) (Result, error) {
	return s.action(ctx, "start", name, fmt.Sprintf("Process %q started", name), "Failed to start process")
}

func (s *Service) Stop(ctx context.Context, name string) (Result, error) {
	return s.action(ctx, "stop", name, fmt.Sprintf("Process %q stopped", name), "Failed to stop process")
}

func (s *Service) Restart(ctx context.Context, name string) (Result, error) {
	return s.action(ctx, "restart", name, fmt.Sprintf("Process %q restarted", name), "Failed to restart process")
}

func (s *Service) Delete(ctx context.Context, name string) (Result, error) {
	return s.action(ctx, "delete", name, fmt.Sprintf("Process %q deleted", name), "Failed to delete process")
}

func (s *Service) Logs(ctx context.Context, name string, lines int) (string, error) {
	if st := s.Check(ctx); !st.Available {
		return "", errors.New("PM2 not available")
	}
	out, err := s.exec(ctx, "logs", name, "--lines", strconv.Itoa(clampLines(lines)), "--nostream")
	if err != nil {
		return "", fmt.Errorf("Failed to get logs: %w", err)
	}
	return out, nil
}

func (s *Service) StartNew(ctx context.Context, name, script string) (Result, error) {
	if st := s.Check(ctx); !st.Available {
		return Result{}, errors.New("PM2 not available")
	}
	if strings.TrimSpace(script) == "" {
		return Result{}, errors.New("Script path is required")
	}
	args := []string{"start", script}
	if strings.TrimSpace(name) != "" {
		args = append(args, "--name", name)
	}
	if _, err := s.exec(ctx, args...); err != nil {
		return Result{}, fmt.Errorf("Failed to start app: %w", err)
	}
	label := script
	if name != "" {
		label = name
	}
	return Result{Success: true, Message: "App started: " + label}, nil
}

func (s *Service) action(ctx context.Context, op, name, msg, prefix string) (Result, error) {
	if st := s.Check(ctx); !st.Available {
		return Result{}, errors.New("PM2 not available")
	}
	if strings.TrimSpace(name) == "" {
		return Result{}, errors.New("Process name is required")
	}
	if _, err := s.exec(ctx, op, name); err != nil {
		return Result{}, fmt.Errorf("%s: %w", prefix, err)
	}
	return Result{Success: true, Message: msg}, nil
}

func (s *Service) exec(ctx context.Context, args ...string) (string, error) {
	s.mu.RLock()
	cmd := s.command
	s.mu.RUnlock()
	out, err := run(ctx, cmd, args...)
	if err == nil {
		return out, nil
	}
	if runtime.GOOS != "windows" && cmd != "pm2" {
		if fallback, ferr := run(ctx, "pm2", args...); ferr == nil {
			return fallback, nil
		}
	}
	return out, err
}

type candidate struct{ command, path, method string }

func (s *Service) candidates() []candidate {
	var out []candidate
	out = append(out, candidate{command: "pm2"})
	if runtime.GOOS == "windows" {
		for _, p := range []string{filepath.Join(os.Getenv("APPDATA"), "npm", "pm2.cmd"), filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming", "npm", "pm2.cmd")} {
			if p != "" && fileExists(p) {
				out = append(out, candidate{command: p, path: p})
			}
		}
		return out
	}
	known := []string{"/root/.nvm/versions/node/v20.19.6/bin/pm2", "/root/.nvm/versions/node/v22.0.0/bin/pm2", "/root/.nvm/versions/node/v21.0.0/bin/pm2", "/root/.nvm/versions/node/v18.0.0/bin/pm2"}
	for _, p := range known {
		if fileExists(p) {
			out = append(out, candidate{command: p, path: p})
		}
	}
	for _, base := range []string{filepath.Join(homeDir(), ".nvm", "versions", "node"), "/root/.nvm/versions/node"} {
		for _, p := range nvmPM2Paths(base) {
			out = append(out, candidate{command: p, path: p})
		}
	}
	for _, p := range []string{"/usr/local/bin/pm2", "/usr/bin/pm2", filepath.Join(homeDir(), ".npm-global", "bin", "pm2")} {
		if fileExists(p) {
			out = append(out, candidate{command: p, path: p})
		}
	}
	return out
}

func parseList(out string) ([]Process, error) {
	var raw []struct {
		Name  string `json:"name"`
		PID   int    `json:"pid"`
		Monit struct {
			CPU    any     `json:"cpu"`
			Memory float64 `json:"memory"`
		} `json:"monit"`
		PM2Env struct {
			Status     string         `json:"status"`
			PMUptime   int64          `json:"pm_uptime"`
			Restart    int            `json:"restart_time"`
			ExecMode   string         `json:"exec_mode"`
			Cwd        any            `json:"pm_cwd"`
			PMExecPath string         `json:"pm_exec_path"`
			Port       any            `json:"PORT"`
			Env        map[string]any `json:"env"`
			Args       any            `json:"args"`
		} `json:"pm2_env"`
	}
	if err := json.Unmarshal([]byte(out), &raw); err != nil {
		return nil, fmt.Errorf("Failed to parse PM2 output: %w", err)
	}
	processes := make([]Process, 0, len(raw))
	for _, p := range raw {
		processes = append(processes, Process{Name: p.Name, PID: p.PID, Status: p.PM2Env.Status, CPU: p.Monit.CPU, Memory: int64(p.Monit.Memory / 1024 / 1024), Uptime: formatUptime(p.PM2Env.PMUptime), Restarts: p.PM2Env.Restart, Mode: p.PM2Env.ExecMode, Port: extractPort(p.PM2Env.Env, p.PM2Env.Port, p.PM2Env.Args, p.PM2Env.PMExecPath), Cwd: p.PM2Env.Cwd})
	}
	return processes, nil
}

func extractPort(env map[string]any, direct, args any, execPath string) any {
	if env != nil && env["PORT"] != nil && fmt.Sprint(env["PORT"]) != "" {
		return env["PORT"]
	}
	if direct != nil && fmt.Sprint(direct) != "" {
		return direct
	}
	if args != nil {
		var s string
		switch v := args.(type) {
		case []any:
			parts := make([]string, 0, len(v))
			for _, a := range v {
				parts = append(parts, fmt.Sprint(a))
			}
			s = strings.Join(parts, " ")
		default:
			s = fmt.Sprint(v)
		}
		if m := portRE.FindStringSubmatch(s); len(m) == 2 {
			return m[1]
		}
	}
	if i := strings.LastIndex(execPath, ":"); i >= 0 && i+1 < len(execPath) {
		p := execPath[i+1:]
		if _, err := strconv.Atoi(p); err == nil {
			return p
		}
	}
	return nil
}

func formatUptime(ms int64) string {
	if ms <= 0 {
		return "N/A"
	}
	d := time.Since(time.UnixMilli(ms))
	if d < 0 {
		return "N/A"
	}
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60
	seconds := int(d.Seconds()) % 60
	if days > 0 {
		return fmt.Sprintf("%dd %dh", days, hours)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, minutes)
	}
	if minutes > 0 {
		return fmt.Sprintf("%dm", minutes)
	}
	return fmt.Sprintf("%ds", seconds)
}

func run(ctx context.Context, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return out.String(), errors.New(strings.TrimSpace(out.String() + " " + err.Error()))
	}
	return out.String(), nil
}

func nvmPM2Paths(base string) []string {
	entries, err := os.ReadDir(base)
	if err != nil {
		return nil
	}
	versions := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			versions = append(versions, e.Name())
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(versions)))
	paths := make([]string, 0, len(versions))
	for _, v := range versions {
		p := filepath.Join(base, v, "bin", "pm2")
		if fileExists(p) {
			paths = append(paths, p)
		}
	}
	return paths
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }
func homeDir() string {
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return h
	}
	return "/root"
}
func clampLines(lines int) int {
	if lines <= 0 {
		return 100
	}
	if lines > 5000 {
		return 5000
	}
	return lines
}

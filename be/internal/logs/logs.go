package logs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type Service struct {
	root string
}

func New(root string) *Service { return &Service{root: root} }

type Source struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Available bool   `json:"available,omitempty"`
}

type Target struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (s *Service) Sources(ctx context.Context) []Source {
	return []Source{
		{ID: "panel", Name: "Panel Application", Type: "file"},
		{ID: "docker", Name: "Docker Containers", Type: "docker", Available: commandAvailable(ctx, "docker", "version")},
		{ID: "pm2", Name: "PM2 Processes", Type: "pm2", Available: commandAvailable(ctx, "pm2", "-v")},
	}
}

func (s *Service) Logs(ctx context.Context, sourceID, target string, lines int) string {
	lines = clampLines(lines)
	switch sourceID {
	case "panel":
		return s.panelLogs(lines)
	case "docker":
		if target == "" {
			return "Please specify a container name"
		}
		return dockerLogs(ctx, target, lines)
	case "pm2":
		if target == "" {
			return "Please specify a process name"
		}
		return pm2Logs(ctx, target, lines)
	default:
		return "Unknown log source"
	}
}

func (s *Service) Targets(ctx context.Context, sourceID string) []Target {
	switch sourceID {
	case "docker":
		return dockerTargets(ctx)
	case "pm2":
		return pm2Targets(ctx)
	default:
		return []Target{}
	}
}

func Search(logs, query string) string {
	if query == "" {
		return logs
	}
	q := strings.ToLower(query)
	var out []string
	for _, line := range strings.Split(logs, "\n") {
		if strings.Contains(strings.ToLower(line), q) {
			out = append(out, line)
		}
	}
	return strings.Join(out, "\n")
}

func (s *Service) panelLogs(lines int) string {
	p := filepath.Join(s.root, "logs", "panel.log")
	b, err := os.ReadFile(p)
	if os.IsNotExist(err) {
		return "No logs available yet"
	}
	if err != nil {
		return "Error reading logs: " + err.Error()
	}
	return lastLines(string(b), lines)
}

func dockerLogs(ctx context.Context, containerName string, lines int) string {
	if !targetExists(ctx, "docker", containerName) {
		return fmt.Sprintf("Container %q not found", containerName)
	}
	out, err := run(ctx, "docker", "logs", "--tail", fmt.Sprint(lines), containerName)
	if err != nil {
		return "Error reading Docker logs: " + err.Error()
	}
	return out
}

func pm2Logs(ctx context.Context, processName string, lines int) string {
	out, err := run(ctx, "pm2", "logs", processName, "--lines", fmt.Sprint(lines), "--nostream", "--raw")
	if err != nil {
		return "Error reading PM2 logs: " + err.Error()
	}
	return out
}

func dockerTargets(ctx context.Context) []Target {
	out, err := run(ctx, "docker", "ps", "-a", "--format", "{{.Names}}")
	if err != nil {
		return []Target{}
	}
	var targets []Target
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		name := strings.TrimSpace(line)
		if name != "" {
			targets = append(targets, Target{ID: name, Name: name})
		}
	}
	return targets
}

func pm2Targets(ctx context.Context) []Target {
	out, err := run(ctx, "pm2", "jlist")
	if err != nil {
		return []Target{}
	}
	var processes []struct {
		Name string `json:"name"`
	}
	if json.Unmarshal([]byte(out), &processes) != nil {
		return []Target{}
	}
	targets := make([]Target, 0, len(processes))
	for _, p := range processes {
		if p.Name != "" {
			targets = append(targets, Target{ID: p.Name, Name: p.Name})
		}
	}
	return targets
}

func targetExists(ctx context.Context, source, target string) bool {
	for _, t := range dockerTargets(ctx) {
		if source == "docker" && t.Name == target {
			return true
		}
	}
	return false
}

func commandAvailable(ctx context.Context, name string, args ...string) bool {
	if _, err := exec.LookPath(name); err != nil {
		return false
	}
	_, err := run(ctx, name, args...)
	return err == nil
}

func run(ctx context.Context, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	if runtime.GOOS != "windows" {
		cmd.Env = os.Environ()
	}
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return out.String(), err
	}
	return out.String(), nil
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

func lastLines(s string, n int) string {
	parts := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
	if len(parts) > 0 && parts[len(parts)-1] == "" {
		parts = parts[:len(parts)-1]
	}
	if len(parts) > n {
		parts = parts[len(parts)-n:]
	}
	return strings.Join(parts, "\n")
}

package docker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type Service struct{}

func New() *Service { return &Service{} }

type Install struct {
	Command string `json:"command"`
	Note    string `json:"note"`
}

type Status struct {
	Available bool     `json:"available"`
	Version   string   `json:"version,omitempty"`
	Method    string   `json:"method,omitempty"`
	Reason    string   `json:"reason,omitempty"`
	Install   *Install `json:"install,omitempty"`
	Error     string   `json:"error,omitempty"`
}

type Container struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Image  string `json:"image"`
	State  string `json:"state"`
	Status string `json:"status"`
	Uptime string `json:"uptime"`
	Ports  string `json:"ports"`
}

type Result struct {
	Success     bool   `json:"success"`
	Message     string `json:"message,omitempty"`
	ContainerID string `json:"containerId,omitempty"`
}

type Stats struct {
	CPU     string         `json:"cpu"`
	Memory  MemoryStats    `json:"memory"`
	Network map[string]any `json:"network"`
}

type MemoryStats struct {
	Usage   uint64 `json:"usage"`
	Limit   uint64 `json:"limit"`
	Percent string `json:"percent"`
}

func (s *Service) Check(ctx context.Context) Status {
	out, err := run(ctx, "docker", "info", "--format", "{{.ServerVersion}}")
	if err == nil && strings.TrimSpace(out) != "" {
		return Status{Available: true, Version: strings.TrimSpace(out), Method: "cli"}
	}
	out, err = run(ctx, "docker", "--version")
	if err == nil && strings.Contains(out, "Docker") {
		return Status{Available: false, Reason: "Docker installed but daemon not running. Start Docker Desktop or run: sudo systemctl start docker", Install: installCommand()}
	}
	return Status{Available: false, Reason: "Docker not installed", Install: installCommand()}
}

func (s *Service) List(ctx context.Context, all bool) ([]Container, error) {
	if st := s.Check(ctx); !st.Available {
		return nil, errors.New("Docker is not available")
	}
	args := []string{"ps", "--format", "{{json .}}"}
	if all {
		args = []string{"ps", "-a", "--format", "{{json .}}"}
	}
	out, err := run(ctx, "docker", args...)
	if err != nil {
		return nil, fmt.Errorf("Failed to list containers: %w", err)
	}
	return parseContainers(out), nil
}

func (s *Service) Get(ctx context.Context, nameOrID string) (map[string]any, error) {
	id, err := s.resolve(ctx, nameOrID)
	if err != nil {
		return nil, fmt.Errorf("Failed to get container: %w", err)
	}
	out, err := run(ctx, "docker", "inspect", id)
	if err != nil {
		return nil, fmt.Errorf("Failed to get container: %w", err)
	}
	var arr []map[string]any
	if err := json.Unmarshal([]byte(out), &arr); err != nil || len(arr) == 0 {
		return nil, fmt.Errorf("Failed to get container: invalid inspect output")
	}
	return arr[0], nil
}

func (s *Service) Start(ctx context.Context, id string) (Result, error) {
	return s.action(ctx, "start", id, fmt.Sprintf("Container %q started", id), "Failed to start container")
}

func (s *Service) Stop(ctx context.Context, id string) (Result, error) {
	return s.action(ctx, "stop", id, fmt.Sprintf("Container %q stopped", id), "Failed to stop container")
}

func (s *Service) Restart(ctx context.Context, id string) (Result, error) {
	return s.action(ctx, "restart", id, fmt.Sprintf("Container %q restarted", id), "Failed to restart container")
}

func (s *Service) Remove(ctx context.Context, id string) (Result, error) {
	resolved, err := s.resolve(ctx, id)
	if err != nil {
		return Result{}, fmt.Errorf("Failed to remove container: %w", err)
	}
	_, _ = run(ctx, "docker", "stop", resolved)
	if _, err := run(ctx, "docker", "rm", resolved); err != nil {
		return Result{}, fmt.Errorf("Failed to remove container: %w", err)
	}
	return Result{Success: true, Message: fmt.Sprintf("Container %q removed", id)}, nil
}

func (s *Service) Logs(ctx context.Context, id string, lines int) (string, error) {
	resolved, err := s.resolve(ctx, id)
	if err != nil {
		return "", fmt.Errorf("Failed to get logs: %w", err)
	}
	out, err := run(ctx, "docker", "logs", "--tail", strconv.Itoa(clampLines(lines)), resolved)
	if err != nil {
		return "", fmt.Errorf("Failed to get logs: %w", err)
	}
	return out, nil
}

func (s *Service) Stats(ctx context.Context, id string) (Stats, error) {
	resolved, err := s.resolve(ctx, id)
	if err != nil {
		return Stats{}, fmt.Errorf("Failed to get stats: %w", err)
	}
	out, err := run(ctx, "docker", "stats", "--no-stream", "--format", "{{json .}}", resolved)
	if err != nil {
		return Stats{}, fmt.Errorf("Failed to get stats: %w", err)
	}
	var raw struct {
		CPUPerc  string `json:"CPUPerc"`
		MemUsage string `json:"MemUsage"`
		MemPerc  string `json:"MemPerc"`
		NetIO    string `json:"NetIO"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &raw); err != nil {
		return Stats{}, fmt.Errorf("Failed to get stats: %w", err)
	}
	usage, limit := parseMemUsage(raw.MemUsage)
	return Stats{CPU: strings.TrimSuffix(raw.CPUPerc, "%"), Memory: MemoryStats{Usage: usage, Limit: limit, Percent: strings.TrimSuffix(raw.MemPerc, "%")}, Network: map[string]any{"io": raw.NetIO}}, nil
}

func (s *Service) Run(ctx context.Context, name, image, ports string) (Result, error) {
	if st := s.Check(ctx); !st.Available {
		return Result{}, errors.New("Docker is not available")
	}
	if strings.TrimSpace(image) == "" {
		return Result{}, errors.New("Image is required")
	}
	_, _ = run(ctx, "docker", "pull", image)
	args := []string{"run", "-d", "--restart", "unless-stopped"}
	if strings.TrimSpace(name) != "" {
		args = append(args, "--name", name)
	}
	for _, mapping := range parsePorts(ports) {
		args = append(args, "-p", mapping)
	}
	args = append(args, image)
	out, err := run(ctx, "docker", args...)
	if err != nil {
		return Result{}, fmt.Errorf("Failed to run container: %w", err)
	}
	return Result{Success: true, ContainerID: strings.TrimSpace(out)}, nil
}

func (s *Service) action(ctx context.Context, op, id, msg, prefix string) (Result, error) {
	resolved, err := s.resolve(ctx, id)
	if err != nil {
		return Result{}, fmt.Errorf("%s: %w", prefix, err)
	}
	if _, err := run(ctx, "docker", op, resolved); err != nil {
		return Result{}, fmt.Errorf("%s: %w", prefix, err)
	}
	return Result{Success: true, Message: msg}, nil
}

func (s *Service) resolve(ctx context.Context, nameOrID string) (string, error) {
	containers, err := s.List(ctx, true)
	if err != nil {
		return "", err
	}
	needle := strings.TrimPrefix(strings.TrimSpace(nameOrID), "/")
	for _, c := range containers {
		if strings.HasPrefix(c.ID, needle) || c.Name == needle || strings.Contains(c.Name, needle) {
			return c.ID, nil
		}
	}
	return "", fmt.Errorf("Container %q not found", nameOrID)
}

func parseContainers(out string) []Container {
	var containers []Container
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var raw struct {
			ID     string `json:"ID"`
			Names  string `json:"Names"`
			Image  string `json:"Image"`
			State  string `json:"State"`
			Status string `json:"Status"`
			Ports  string `json:"Ports"`
		}
		if json.Unmarshal([]byte(line), &raw) != nil {
			continue
		}
		containers = append(containers, Container{ID: raw.ID, Name: strings.TrimPrefix(raw.Names, "/"), Image: raw.Image, State: raw.State, Status: raw.Status, Uptime: raw.Status, Ports: dockerPorts(raw.Ports)})
	}
	return containers
}

func dockerPorts(s string) string {
	if s == "" {
		return ""
	}
	parts := strings.Split(s, ",")
	for i, p := range parts {
		p = strings.TrimSpace(p)
		if strings.Contains(p, "->") {
			left := strings.SplitN(p, "->", 2)[0]
			right := strings.SplitN(strings.SplitN(p, "->", 2)[1], "/", 2)[0]
			if idx := strings.LastIndex(left, ":"); idx >= 0 {
				parts[i] = left[idx+1:] + ":" + right
			}
		} else {
			parts[i] = p
		}
	}
	return strings.Join(parts, ", ")
}

func parsePorts(ports string) []string {
	var out []string
	for _, p := range strings.Split(ports, ",") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		parts := strings.Split(p, ":")
		if len(parts) == 1 {
			out = append(out, parts[0]+":"+parts[0])
		} else {
			out = append(out, parts[0]+":"+parts[1])
		}
	}
	return out
}

func parseMemUsage(s string) (uint64, uint64) {
	parts := strings.Split(s, "/")
	if len(parts) != 2 {
		return 0, 0
	}
	return parseSize(parts[0]), parseSize(parts[1])
}

func parseSize(s string) uint64 {
	s = strings.TrimSpace(strings.ReplaceAll(s, "iB", "B"))
	fields := strings.Fields(s)
	if len(fields) != 1 {
		return 0
	}
	unitStart := len(fields[0])
	for i, r := range fields[0] {
		if (r < '0' || r > '9') && r != '.' {
			unitStart = i
			break
		}
	}
	num, _ := strconv.ParseFloat(fields[0][:unitStart], 64)
	unit := strings.ToUpper(fields[0][unitStart:])
	mult := float64(1)
	switch unit {
	case "KB":
		mult = 1000
	case "MB":
		mult = 1000 * 1000
	case "GB":
		mult = 1000 * 1000 * 1000
	case "KIB":
		mult = 1024
	case "MIB":
		mult = 1024 * 1024
	case "GIB":
		mult = 1024 * 1024 * 1024
	}
	return uint64(num * mult)
}

func installCommand() *Install {
	switch runtime.GOOS {
	case "windows":
		return &Install{Command: "Download from https://www.docker.com/products/docker-desktop", Note: "Install Docker Desktop for Windows"}
	case "darwin":
		return &Install{Command: "brew install --cask docker", Note: "Or download from https://www.docker.com/products/docker-desktop"}
	default:
		return &Install{Command: "curl -fsSL https://get.docker.com | sh", Note: "Then run: sudo usermod -aG docker $USER && newgrp docker"}
	}
}

func run(ctx context.Context, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
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

func clampLines(lines int) int {
	if lines <= 0 {
		return 100
	}
	if lines > 5000 {
		return 5000
	}
	return lines
}

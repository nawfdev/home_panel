//go:build linux

package platform

import (
	"context"
	"encoding/json"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// linuxController drives systemd via systemctl/journalctl, matching the commands
// the Node backend (cloudflared.js) ran directly.
type linuxController struct{}

func newController() ServiceController { return linuxController{} }

func (linuxController) Status(ctx context.Context, unit string) (ServiceStatus, error) {
	active, _ := exec.CommandContext(ctx, "systemctl", "is-active", unit).Output()
	isActive := strings.TrimSpace(string(active)) == "active"

	st := ServiceStatus{Available: true, Active: isActive}

	out, err := exec.CommandContext(ctx, "systemctl", "show", unit,
		"--property=MainPID", "--property=ActiveEnterTimestamp").Output()
	if err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			k, v, ok := strings.Cut(strings.TrimSpace(line), "=")
			if !ok {
				continue
			}
			switch k {
			case "MainPID":
				st.PID, _ = strconv.Atoi(v)
			case "ActiveEnterTimestamp":
				st.Since = v
			}
		}
	}
	return st, nil
}

func isWindows() bool { return false }

// listServices ports listServicesLinux: systemctl list-units, capped at 50.
func listServices(ctx context.Context) ([]ServiceInfo, error) {
	out, err := exec.CommandContext(ctx, "systemctl",
		"list-units", "--type=service", "--all", "--no-pager", "--no-legend").Output()
	if err != nil {
		return []ServiceInfo{}, nil // systemctl unavailable -> empty, like the JS
	}
	var services []ServiceInfo
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.Contains(line, ".service") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 4 {
			continue
		}
		name := strings.TrimSuffix(parts[0], ".service")
		load, active, sub := parts[1], parts[2], parts[3]
		status := "stopped"
		if active == "active" && sub == "running" {
			status = "running"
		}
		services = append(services, ServiceInfo{
			Name: name, Status: status, Type: "service", Load: load, Active: active,
		})
		if len(services) >= 50 {
			break
		}
	}
	return services, nil
}

func (linuxController) Start(ctx context.Context, unit string) error {
	return exec.CommandContext(ctx, "systemctl", "start", unit).Run()
}

func (linuxController) Stop(ctx context.Context, unit string) error {
	return exec.CommandContext(ctx, "systemctl", "stop", unit).Run()
}

func (linuxController) Restart(ctx context.Context, unit string) error {
	return exec.CommandContext(ctx, "systemctl", "restart", unit).Run()
}

func reboot(ctx context.Context) error {
	return exec.CommandContext(ctx, "systemctl", "reboot").Run()
}

func (linuxController) Logs(ctx context.Context, unit string, limit int) ([]LogEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	// limit is bounded and rendered as a base-10 integer: no shell, no injection
	// (this was a command-injection sink in the Node version).
	out, err := exec.CommandContext(ctx, "journalctl", "-u", unit,
		"-n", strconv.Itoa(limit), "--no-pager", "-o", "json").Output()
	if err != nil {
		return []LogEntry{}, nil // journalctl unavailable -> empty, like the JS fallback
	}

	var entries []LogEntry
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		var raw map[string]json.RawMessage
		if json.Unmarshal([]byte(line), &raw) != nil {
			continue
		}
		entries = append(entries, LogEntry{
			Timestamp: journalTime(raw["__REALTIME_TIMESTAMP"]),
			Message:   jsonString(raw["MESSAGE"]),
			Priority:  jsonString(raw["PRIORITY"]),
			Unit:      firstNonEmpty(jsonString(raw["_SYSTEMD_UNIT"]), unit),
		})
	}
	// newest last (reverse of journalctl's newest-first? journalctl -n is oldest..newest already)
	return entries, nil
}

func journalTime(raw json.RawMessage) string {
	s := jsonString(raw)
	if s == "" {
		return time.Now().UTC().Format(time.RFC3339)
	}
	micros, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return time.Now().UTC().Format(time.RFC3339)
	}
	return time.UnixMicro(micros).UTC().Format(time.RFC3339)
}

// jsonString decodes a journal field that may be a quoted string or a raw number.
func jsonString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return strings.Trim(string(raw), `"`)
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

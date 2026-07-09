//go:build windows

package platform

import (
	"context"
	"os/exec"
	"strconv"
	"strings"
)

// windowsController drives the Windows Service Control Manager via `sc`.
// cloudflared installs itself as a Windows service, so the unit name maps to a
// service name. journalctl has no equivalent; logs return empty (best-effort).
type windowsController struct{}

func newController() ServiceController { return windowsController{} }

func (windowsController) Status(ctx context.Context, unit string) (ServiceStatus, error) {
	out, err := exec.CommandContext(ctx, "sc", "query", unit).Output()
	if err != nil {
		// Service not installed on this host.
		return ServiceStatus{Available: false}, nil
	}
	text := string(out)
	st := ServiceStatus{Available: true}
	if strings.Contains(text, "RUNNING") {
		st.Active = true
	}
	if pidOut, err := exec.CommandContext(ctx, "sc", "queryex", unit).Output(); err == nil {
		for _, line := range strings.Split(string(pidOut), "\n") {
			if strings.Contains(line, "PID") {
				_, v, ok := strings.Cut(line, ":")
				if ok {
					st.PID, _ = strconv.Atoi(strings.TrimSpace(v))
				}
			}
		}
	}
	return st, nil
}

func isWindows() bool { return true }

// listServices ports listServicesWindows: `sc query`, capped at 50.
func listServices(ctx context.Context) ([]ServiceInfo, error) {
	out, err := exec.CommandContext(ctx, "sc", "query", "type=", "service", "state=", "all").Output()
	if err != nil {
		return nil, err
	}
	var services []ServiceInfo
	var cur *ServiceInfo
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "SERVICE_NAME:") {
			if cur != nil {
				services = append(services, *cur)
			}
			_, name, _ := strings.Cut(line, ":")
			cur = &ServiceInfo{Name: strings.TrimSpace(name), Status: "unknown", Type: "service"}
		}
		if strings.Contains(line, "STATE") && cur != nil {
			if strings.Contains(line, "RUNNING") {
				cur.Status = "running"
			} else {
				cur.Status = "stopped"
			}
		}
	}
	if cur != nil {
		services = append(services, *cur)
	}
	if len(services) > 50 {
		services = services[:50]
	}
	return services, nil
}

func (windowsController) Start(ctx context.Context, unit string) error {
	return exec.CommandContext(ctx, "sc", "start", unit).Run()
}

func (windowsController) Stop(ctx context.Context, unit string) error {
	return exec.CommandContext(ctx, "sc", "stop", unit).Run()
}

func (windowsController) Restart(ctx context.Context, unit string) error {
	if err := exec.CommandContext(ctx, "sc", "stop", unit).Run(); err != nil {
		return err
	}
	return exec.CommandContext(ctx, "sc", "start", unit).Run()
}

func (windowsController) Logs(ctx context.Context, unit string, limit int) ([]LogEntry, error) {
	// No journald on Windows; the UI degrades gracefully to "no logs", exactly
	// like the Node backend did on non-Linux platforms.
	return []LogEntry{}, nil
}

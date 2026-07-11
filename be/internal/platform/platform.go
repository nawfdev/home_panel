// Package platform abstracts OS-specific service control so the rest of the code
// never branches on runtime.GOOS. The Node backend hard-coded systemctl/journalctl,
// which do not exist on Windows; here Linux and Windows each provide their own
// implementation behind ServiceController.
package platform

import "context"

// ServiceStatus is the cross-platform view of a managed service (e.g. cloudflared).
type ServiceStatus struct {
	Available bool   // service manager exists for this unit on this OS
	Active    bool   // currently running
	PID       int    // 0 when unknown
	Since     string // human-readable start time, empty when unknown
}

// LogEntry is one normalized log line from the platform's logging facility.
type LogEntry struct {
	Timestamp string `json:"timestamp"`
	Message   string `json:"message"`
	Priority  string `json:"priority"`
	Unit      string `json:"unit"`
}

// ServiceController controls a single named OS service.
type ServiceController interface {
	Status(ctx context.Context, unit string) (ServiceStatus, error)
	Start(ctx context.Context, unit string) error
	Stop(ctx context.Context, unit string) error
	Restart(ctx context.Context, unit string) error
	// Logs returns up to limit recent entries, newest last.
	Logs(ctx context.Context, unit string, limit int) ([]LogEntry, error)
}

// Controller returns the ServiceController for the current OS.
// Implemented in platform_linux.go and platform_windows.go.
func Controller() ServiceController { return newController() }

// ServiceInfo is one entry in the system service list (ports system-services.js).
type ServiceInfo struct {
	Name   string `json:"name"`
	Status string `json:"status"` // "running" | "stopped"
	Type   string `json:"type"`
	Load   string `json:"load,omitempty"`
	Active string `json:"active,omitempty"`
}

// ListServices returns up to 50 OS services (systemd units / Windows services).
func ListServices(ctx context.Context) ([]ServiceInfo, error) { return listServices(ctx) }

// IsWindows reports whether the host service manager is the Windows SCM.
func IsWindows() bool { return isWindows() }

// Reboot restarts the entire host machine (not just a managed unit/service).
// Implemented in platform_linux.go and platform_windows.go.
func Reboot(ctx context.Context) error { return reboot(ctx) }

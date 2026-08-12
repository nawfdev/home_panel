// Package projects manages local processes and remote hosting sites.
package projects

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	cfapi "github.com/nawfdev/home-panel/internal/cloudflare"
	"github.com/nawfdev/home-panel/internal/sshmgr"
	"github.com/nawfdev/home-panel/internal/store"
)

const (
	defaultTunnelConfig  = "/etc/cloudflared/config.yml"
	defaultTunnelService = "cloudflared"
)

var domainPattern = regexp.MustCompile(`^(?i:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$`)

type LogLine struct {
	Type string `json:"type"`
	Data string `json:"data"`
	Time string `json:"time"`
}

type running struct {
	cmd  *exec.Cmd
	mu   sync.Mutex
	logs []LogLine
}

func (r *running) push(kind, data string) {
	r.mu.Lock()
	r.logs = append(r.logs, LogLine{Type: kind, Data: data, Time: time.Now().Format(time.RFC3339)})
	if len(r.logs) > 500 {
		r.logs = r.logs[len(r.logs)-500:]
	}
	r.mu.Unlock()
}

func (r *running) snapshot() []LogLine {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]LogLine(nil), r.logs...)
}

type Manager struct {
	store      *store.Store
	ssh        *sshmgr.Manager
	cloudflare *cfapi.Service
	mu         sync.Mutex
	running    map[int]*running
	logs       map[int][]LogLine
}

func New(s *store.Store, ssh *sshmgr.Manager, cloudflare *cfapi.Service) *Manager {
	return &Manager{store: s, ssh: ssh, cloudflare: cloudflare, running: map[int]*running{}, logs: map[int][]LogLine{}}
}

type SiteInput struct {
	Name          string   `json:"name"`
	HostID        int      `json:"hostId"`
	Type          string   `json:"type"`
	Path          string   `json:"path"`
	SourcePath    string   `json:"sourcePath"`
	BuildCommand  string   `json:"buildCommand"`
	StartCommand  string   `json:"startCommand"`
	PublishDir    string   `json:"publishDir"`
	Port          int      `json:"port"`
	Domains       []string `json:"domains"`
	TunnelID      string   `json:"tunnelId"`
	TunnelConfig  string   `json:"tunnelConfig"`
	TunnelService string   `json:"tunnelService"`
}

type Result struct {
	Success bool           `json:"success"`
	PID     int            `json:"pid,omitempty"`
	Message string         `json:"message,omitempty"`
	Output  string         `json:"output,omitempty"`
	Site    *store.Project `json:"site,omitempty"`
}

type HealthResult struct {
	Healthy    bool   `json:"healthy"`
	StatusCode int    `json:"statusCode,omitempty"`
	Message    string `json:"message"`
}

func (m *Manager) GetAll() []store.Project          { return m.store.ListProjects() }
func (m *Manager) Get(id int) (store.Project, bool) { return m.store.GetProject(id) }

func normalizeInput(in SiteInput) (SiteInput, error) {
	in.Name = strings.TrimSpace(in.Name)
	in.Type = strings.ToLower(strings.TrimSpace(in.Type))
	if in.Type == "" {
		in.Type = "static"
	}
	switch in.Type {
	case "static", "node", "proxy", "php":
	default:
		return in, fmt.Errorf("type must be static, node, proxy, or php")
	}
	if in.Name == "" {
		return in, fmt.Errorf("name required")
	}
	in.Path = strings.TrimSpace(in.Path)
	if strings.ContainsAny(in.Path, "\r\n\t") || (!strings.HasPrefix(in.Path, "/") && !filepath.IsAbs(in.Path)) {
		return in, fmt.Errorf("path must be absolute")
	}
	if strings.HasPrefix(in.Path, "/") {
		in.Path = path.Clean(in.Path)
	} else {
		in.Path = filepath.Clean(in.Path)
	}
	if in.SourcePath != "" {
		in.SourcePath = strings.TrimSpace(in.SourcePath)
		if strings.ContainsAny(in.SourcePath, "\r\n\t") || (!strings.HasPrefix(in.SourcePath, "/") && !filepath.IsAbs(in.SourcePath)) {
			return in, fmt.Errorf("sourcePath must be absolute")
		}
		if strings.HasPrefix(in.SourcePath, "/") {
			in.SourcePath = path.Clean(in.SourcePath)
		} else {
			in.SourcePath = filepath.Clean(in.SourcePath)
		}
	}
	in.PublishDir = strings.Trim(strings.TrimSpace(in.PublishDir), "/")
	if in.PublishDir == "." {
		in.PublishDir = ""
	}
	if strings.Contains(in.PublishDir, "..") || strings.ContainsAny(in.PublishDir, "\r\n") {
		return in, fmt.Errorf("publishDir must stay inside sourcePath")
	}
	if (in.Type == "node" || in.Type == "proxy") && (in.Port < 1 || in.Port > 65535) {
		return in, fmt.Errorf("node and proxy sites require a valid port")
	}
	if strings.ContainsAny(in.BuildCommand+in.StartCommand, "\r\n") {
		return in, fmt.Errorf("commands must be single-line")
	}
	seen := map[string]bool{}
	domains := make([]string, 0, len(in.Domains))
	for _, raw := range in.Domains {
		d := strings.ToLower(strings.TrimSpace(raw))
		if d == "" || seen[d] {
			continue
		}
		if !domainPattern.MatchString(d) {
			return in, fmt.Errorf("invalid domain %q", d)
		}
		seen[d] = true
		domains = append(domains, d)
	}
	in.Domains = domains
	in.TunnelID = strings.TrimSpace(in.TunnelID)
	in.TunnelConfig = strings.TrimSpace(in.TunnelConfig)
	if in.TunnelConfig == "" {
		in.TunnelConfig = defaultTunnelConfig
	}
	if !strings.HasPrefix(in.TunnelConfig, "/") || strings.ContainsAny(in.TunnelConfig, "\r\n\t ") {
		return in, fmt.Errorf("tunnelConfig must be an absolute POSIX path without whitespace")
	}
	in.TunnelService = strings.TrimSpace(in.TunnelService)
	if in.TunnelService == "" {
		in.TunnelService = defaultTunnelService
	}
	if strings.ContainsAny(in.TunnelService, " /\r\n\t") {
		return in, fmt.Errorf("invalid tunnel service")
	}
	return in, nil
}

func (m *Manager) validate(in SiteInput, exceptID int) error {
	if in.HostID != 0 {
		if _, ok := m.store.GetHost(in.HostID); !ok {
			return fmt.Errorf("host not found")
		}
	}
	for _, existing := range m.store.ListProjects() {
		if existing.ID == exceptID {
			continue
		}
		for _, a := range existing.Domains {
			for _, b := range in.Domains {
				if strings.EqualFold(a, b) {
					return fmt.Errorf("domain %s is already assigned to %s", b, existing.Name)
				}
			}
		}
	}
	return nil
}

func projectFromInput(in SiteInput) store.Project {
	p := store.Project{
		Name: in.Name, HostID: in.HostID, Type: in.Type, Path: in.Path,
		SourcePath: in.SourcePath, BuildCommand: in.BuildCommand,
		StartCommand: in.StartCommand, PublishDir: in.PublishDir, Port: in.Port,
		Domains: append([]string(nil), in.Domains...), TunnelID: in.TunnelID,
		TunnelConfig: in.TunnelConfig, TunnelService: in.TunnelService, Status: "stopped",
	}
	if len(p.Domains) > 0 {
		p.Domain = p.Domains[0]
	}
	return p
}

func (m *Manager) Add(in SiteInput) (store.Project, error) {
	in, err := normalizeInput(in)
	if err != nil {
		return store.Project{}, err
	}
	if err := m.validate(in, 0); err != nil {
		return store.Project{}, err
	}
	id, err := m.store.InsertProject(projectFromInput(in))
	if err != nil {
		return store.Project{}, err
	}
	p, _ := m.store.GetProject(id)
	return p, nil
}

func (m *Manager) Update(id int, in SiteInput) (store.Project, error) {
	old, ok := m.store.GetProject(id)
	if !ok {
		return store.Project{}, fmt.Errorf("site not found")
	}
	in, err := normalizeInput(in)
	if err != nil {
		return store.Project{}, err
	}
	if err := m.validate(in, id); err != nil {
		return store.Project{}, err
	}
	next := projectFromInput(in)
	next.ID, next.CreatedAt, next.Status, next.Health = old.ID, old.CreatedAt, old.Status, old.Health
	next.LastDeployedAt, next.CurrentRelease, next.PreviousRelease = old.LastDeployedAt, old.CurrentRelease, old.PreviousRelease
	next.AppliedDomains = old.AppliedDomains
	if err := m.store.UpdateProject(id, func(p *store.Project) { *p = next }); err != nil {
		return store.Project{}, err
	}
	p, _ := m.store.GetProject(id)
	return p, nil
}

func (m *Manager) Delete(id int) Result {
	p, ok := m.store.GetProject(id)
	if !ok {
		return Result{Success: false, Message: "Site not found"}
	}
	if p.HostID == 0 && p.Status == "running" {
		m.Stop(id)
	}
	if p.HostID != 0 {
		if err := m.removeRemoteConfig(context.Background(), p); err != nil {
			return Result{Success: false, Message: "Remote cleanup failed; site was not removed: " + err.Error()}
		}
	}
	if err := m.store.DeleteProject(id); err != nil {
		return Result{Success: false, Message: err.Error()}
	}
	return Result{Success: true, Message: "Site removed; deployed files were preserved"}
}

func (m *Manager) appendLog(id int, kind, data string) {
	if strings.TrimSpace(data) == "" {
		return
	}
	m.mu.Lock()
	m.logs[id] = append(m.logs[id], LogLine{Type: kind, Data: strings.TrimSpace(data), Time: time.Now().Format(time.RFC3339)})
	if len(m.logs[id]) > 500 {
		m.logs[id] = m.logs[id][len(m.logs[id])-500:]
	}
	m.mu.Unlock()
}

func (m *Manager) setStatus(id int, status string, pid int) {
	_ = m.store.UpdateProject(id, func(p *store.Project) {
		p.Status, p.Pid = status, pid
	})
}

func shellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

func (m *Manager) remoteHost(p store.Project) (store.Host, error) {
	if p.HostID == 0 {
		return store.Host{}, fmt.Errorf("site is local")
	}
	h, ok := m.store.GetHost(p.HostID)
	if !ok {
		return store.Host{}, fmt.Errorf("host not found")
	}
	return h, nil
}

func (m *Manager) runRemote(ctx context.Context, p store.Project, command string) (string, error) {
	h, err := m.remoteHost(p)
	if err != nil {
		return "", err
	}
	stdout, stderr, code, err := m.ssh.RunCommand(ctx, h, command)
	m.appendLog(p.ID, "stdout", stdout)
	m.appendLog(p.ID, "stderr", stderr)
	if err != nil {
		return stdout + stderr, err
	}
	if code != 0 {
		return stdout + stderr, fmt.Errorf("remote command exited %d: %s", code, strings.TrimSpace(stderr))
	}
	return stdout + stderr, nil
}

func webRoot(p store.Project) string {
	if p.CurrentRelease != "" {
		return path.Join(p.Path, "current")
	}
	return p.Path
}

func (m *Manager) Deploy(ctx context.Context, id int) Result {
	p, ok := m.store.GetProject(id)
	if !ok {
		return Result{Success: false, Message: "Site not found"}
	}
	if p.HostID == 0 {
		return Result{Success: false, Message: "Release deployment is available for remote sites"}
	}
	if p.SourcePath == "" {
		return Result{Success: false, Message: "Set a source path before deploying"}
	}
	if p.SourcePath == p.Path || strings.HasPrefix(p.SourcePath, p.Path+"/") {
		return Result{Success: false, Message: "Source path must be outside the release destination"}
	}
	m.setStatus(id, "deploying", 0)
	releaseID := time.Now().UTC().Format("20060102T150405Z")
	releaseDir := path.Join(p.Path, "releases", releaseID)
	source := p.SourcePath
	if p.BuildCommand != "" {
		if _, err := m.runRemote(ctx, p, "cd "+shellQuote(source)+" && "+p.BuildCommand); err != nil {
			m.setStatus(id, "failed", 0)
			return Result{Success: false, Message: "Build failed: " + err.Error()}
		}
	}
	publish := source
	if p.PublishDir != "" {
		publish = path.Join(source, p.PublishDir)
	}
	command := "test -d " + shellQuote(publish) + " && mkdir -p " + shellQuote(releaseDir) +
		" && tar -C " + shellQuote(publish) + " -cf - . | tar -C " + shellQuote(releaseDir) + " -xf -" +
		" && ln -sfn " + shellQuote(releaseDir) + " " + shellQuote(path.Join(p.Path, "current.next")) +
		" && mv -Tf " + shellQuote(path.Join(p.Path, "current.next")) + " " + shellQuote(path.Join(p.Path, "current"))
	out, err := m.runRemote(ctx, p, command)
	if err != nil {
		m.setStatus(id, "failed", 0)
		return Result{Success: false, Message: "Deploy failed: " + err.Error(), Output: out}
	}
	previous := p.CurrentRelease
	now := time.Now().UTC().Format(time.RFC3339)
	releases := append([]store.Release{{ID: releaseID, Path: releaseDir, DeployedAt: now}}, p.Releases...)
	if len(releases) > 10 {
		releases = releases[:10]
	}
	_ = m.store.UpdateProject(id, func(site *store.Project) {
		site.PreviousRelease, site.CurrentRelease = previous, releaseDir
		site.LastDeployedAt, site.Releases, site.Status = now, releases, "stopped"
	})
	p, _ = m.store.GetProject(id)
	if configured := m.Configure(ctx, id); !configured.Success {
		m.setStatus(id, "failed", 0)
		return configured
	}
	if p.Type == "node" && p.StartCommand != "" {
		if started := m.Start(id); !started.Success {
			return started
		}
	}
	fresh, _ := m.store.GetProject(id)
	return Result{Success: true, Message: "Release " + releaseID + " deployed", Output: out, Site: &fresh}
}

func (m *Manager) Rollback(ctx context.Context, id int) Result {
	p, ok := m.store.GetProject(id)
	if !ok {
		return Result{Success: false, Message: "Site not found"}
	}
	if p.HostID == 0 || p.PreviousRelease == "" {
		return Result{Success: false, Message: "No previous remote release available"}
	}
	cmd := "test -d " + shellQuote(p.PreviousRelease) + " && ln -sfn " + shellQuote(p.PreviousRelease) + " " + shellQuote(path.Join(p.Path, "current.next")) + " && mv -Tf " + shellQuote(path.Join(p.Path, "current.next")) + " " + shellQuote(path.Join(p.Path, "current"))
	if _, err := m.runRemote(ctx, p, cmd); err != nil {
		return Result{Success: false, Message: err.Error()}
	}
	current := p.CurrentRelease
	_ = m.store.UpdateProject(id, func(site *store.Project) {
		site.CurrentRelease, site.PreviousRelease = p.PreviousRelease, current
		site.LastDeployedAt = time.Now().UTC().Format(time.RFC3339)
	})
	if p.Type == "node" && p.StartCommand != "" {
		return m.Restart(id)
	}
	fresh, _ := m.store.GetProject(id)
	return Result{Success: true, Message: "Rolled back to " + path.Base(fresh.CurrentRelease), Site: &fresh}
}

func nginxConfig(p store.Project) string {
	domains := strings.Join(p.Domains, " ")
	root := webRoot(p)
	var body string
	switch p.Type {
	case "node", "proxy":
		body = fmt.Sprintf("    location / {\n        proxy_pass http://127.0.0.1:%d;\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection $connection_upgrade;\n    }\n", p.Port)
	case "php":
		body = fmt.Sprintf("    root %s;\n    index index.php index.html;\n    client_max_body_size 128m;\n    location / { try_files $uri $uri/ /index.php?$query_string; }\n    location ~ \\.php$ {\n        include snippets/fastcgi-php.conf;\n        fastcgi_pass unix:/run/php/php8.3-fpm.sock;\n    }\n    location ~ /\\. { deny all; }\n", root)
	default:
		body = fmt.Sprintf("    root %s;\n    index index.html;\n    location / { try_files $uri $uri/ /index.html; }\n    location ~ /\\. { deny all; }\n", root)
	}
	return fmt.Sprintf("# Managed by Nestcore site %d\nserver {\n    listen 80;\n    listen [::]:80;\n    server_name %s;\n%s}\n", p.ID, domains, body)
}

func (m *Manager) writeRemoteFile(p store.Project, target, content string, mode os.FileMode) error {
	h, err := m.remoteHost(p)
	if err != nil {
		return err
	}
	client, err := m.ssh.SFTPClient(h)
	if err != nil {
		return err
	}
	defer client.Close()
	tmp := target + ".nestcore.tmp"
	f, err := client.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return err
	}
	if _, err = f.Write([]byte(content)); err == nil {
		err = f.Chmod(mode)
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = client.Remove(tmp)
		return err
	}
	if err := client.PosixRename(tmp, target); err == nil {
		return nil
	}
	_ = client.Remove(target)
	if err := client.Rename(tmp, target); err != nil {
		_ = client.Remove(tmp)
		return err
	}
	return nil
}

func (m *Manager) Configure(ctx context.Context, id int) Result {
	p, ok := m.store.GetProject(id)
	if !ok {
		return Result{Success: false, Message: "Site not found"}
	}
	if p.HostID == 0 {
		return Result{Success: false, Message: "Hosting configuration is available for remote sites"}
	}
	available := fmt.Sprintf("/etc/nginx/sites-available/nestcore-site-%d", p.ID)
	enabled := fmt.Sprintf("/etc/nginx/sites-enabled/nestcore-site-%d", p.ID)
	if len(p.Domains) == 0 {
		if _, err := m.runRemote(ctx, p, "rm -f "+shellQuote(available)+" "+shellQuote(enabled)+" && nginx -t && systemctl reload nginx"); err != nil {
			return Result{Success: false, Message: "Nginx update failed: " + err.Error()}
		}
	} else {
		if err := m.writeRemoteFile(p, available, nginxConfig(p), 0o644); err != nil {
			return Result{Success: false, Message: "Write Nginx config failed: " + err.Error()}
		}
		cmd := "ln -sfn " + shellQuote(available) + " " + shellQuote(enabled) + " && nginx -t && systemctl reload nginx"
		if _, err := m.runRemote(ctx, p, cmd); err != nil {
			_, _ = m.runRemote(ctx, p, "rm -f "+shellQuote(enabled)+" && nginx -t && systemctl reload nginx")
			return Result{Success: false, Message: "Nginx validation failed: " + err.Error()}
		}
	}
	if err := m.syncTunnel(ctx, p.HostID); err != nil {
		return Result{Success: false, Message: "Tunnel update failed: " + err.Error()}
	}
	if p.TunnelID != "" && m.cloudflare != nil {
		for _, domain := range p.Domains {
			if err := m.cloudflare.UpsertTunnelDNS(ctx, domain, p.TunnelID); err != nil {
				return Result{Success: false, Message: "DNS route failed for " + domain + ": " + err.Error()}
			}
		}
		active := make(map[string]bool, len(p.Domains))
		for _, domain := range p.Domains {
			active[domain] = true
		}
		for _, domain := range p.AppliedDomains {
			if !active[domain] {
				if err := m.cloudflare.DeleteTunnelDNS(ctx, domain, p.TunnelID); err != nil {
					return Result{Success: false, Message: "DNS cleanup failed for " + domain + ": " + err.Error()}
				}
			}
		}
	}
	health := m.Health(ctx, id)
	status := "running"
	if !health.Healthy {
		status = "degraded"
	}
	_ = m.store.UpdateProject(id, func(site *store.Project) {
		site.Status, site.Health = status, health.Message
		site.AppliedDomains = append([]string(nil), p.Domains...)
	})
	fresh, _ := m.store.GetProject(id)
	return Result{Success: true, Message: "Nginx, tunnel ingress, and DNS routes synchronized", Site: &fresh}
}

const tunnelBegin = "  # BEGIN NESTCORE MANAGED SITES"
const tunnelEnd = "  # END NESTCORE MANAGED SITES"

func replaceManagedIngress(config string, domains []string) (string, error) {
	lines := strings.Split(strings.ReplaceAll(config, "\r\n", "\n"), "\n")
	out := make([]string, 0, len(lines)+len(domains)*2)
	inside := false
	inserted := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if line == tunnelBegin {
			inside = true
			continue
		}
		if line == tunnelEnd {
			inside = false
			continue
		}
		if inside {
			continue
		}
		if !inserted && strings.HasPrefix(trimmed, "- service:") {
			out = append(out, tunnelBegin)
			for _, d := range domains {
				out = append(out, "  - hostname: "+d, "    service: http://127.0.0.1:80")
			}
			out = append(out, tunnelEnd)
			inserted = true
		}
		out = append(out, line)
	}
	if !inserted {
		return "", fmt.Errorf("tunnel config has no catch-all service rule")
	}
	return strings.Join(out, "\n"), nil
}

func (m *Manager) readRemoteFile(p store.Project, target string) (string, error) {
	h, err := m.remoteHost(p)
	if err != nil {
		return "", err
	}
	client, err := m.ssh.SFTPClient(h)
	if err != nil {
		return "", err
	}
	defer client.Close()
	f, err := client.Open(target)
	if err != nil {
		return "", err
	}
	defer f.Close()
	raw, err := io.ReadAll(f)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func (m *Manager) syncTunnel(ctx context.Context, hostID int) error {
	sites := m.store.ListProjects()
	var exemplar *store.Project
	domainSet := map[string]bool{}
	for i := range sites {
		if sites[i].HostID != hostID {
			continue
		}
		if exemplar == nil {
			exemplar = &sites[i]
		}
		for _, d := range sites[i].Domains {
			domainSet[d] = true
		}
	}
	if exemplar == nil {
		return nil
	}
	domains := make([]string, 0, len(domainSet))
	for d := range domainSet {
		domains = append(domains, d)
	}
	sort.Strings(domains)
	configPath := exemplar.TunnelConfig
	if configPath == "" {
		configPath = defaultTunnelConfig
	}
	old, err := m.readRemoteFile(*exemplar, configPath)
	if err != nil {
		return err
	}
	next, err := replaceManagedIngress(old, domains)
	if err != nil {
		return err
	}
	if next == old {
		return nil
	}
	if err := m.writeRemoteFile(*exemplar, configPath, next, 0o640); err != nil {
		return err
	}
	service := exemplar.TunnelService
	if service == "" {
		service = defaultTunnelService
	}
	cmd := "cloudflared --config " + shellQuote(configPath) + " tunnel ingress validate && systemctl restart " + shellQuote(service)
	if _, err := m.runRemote(ctx, *exemplar, cmd); err != nil {
		_ = m.writeRemoteFile(*exemplar, configPath, old, 0o640)
		_, _ = m.runRemote(ctx, *exemplar, "systemctl restart "+shellQuote(service))
		return err
	}
	return nil
}

func (m *Manager) removeRemoteConfig(ctx context.Context, p store.Project) error {
	available := fmt.Sprintf("/etc/nginx/sites-available/nestcore-site-%d", p.ID)
	enabled := fmt.Sprintf("/etc/nginx/sites-enabled/nestcore-site-%d", p.ID)
	unit := fmt.Sprintf("nestcore-site-%d.service", p.ID)
	_, err := m.runRemote(ctx, p, "systemctl disable --now "+shellQuote(unit)+" >/dev/null 2>&1 || true; rm -f "+shellQuote("/etc/systemd/system/"+unit)+" "+shellQuote(available)+" "+shellQuote(enabled)+"; systemctl daemon-reload; nginx -t && systemctl reload nginx")
	if syncErr := m.syncTunnel(ctx, p.HostID); err == nil {
		err = syncErr
	}
	return err
}

func (m *Manager) Start(id int) Result {
	p, ok := m.store.GetProject(id)
	if !ok {
		return Result{Success: false, Message: "Site not found"}
	}
	if p.HostID != 0 {
		return m.startRemote(context.Background(), p)
	}
	return m.startLocal(p)
}

func (m *Manager) startRemote(ctx context.Context, p store.Project) Result {
	if p.Type != "node" || p.StartCommand == "" {
		configured := m.Configure(ctx, p.ID)
		if configured.Success {
			configured.Message = "Site enabled"
		}
		return configured
	}
	unit := fmt.Sprintf("nestcore-site-%d.service", p.ID)
	workDir := webRoot(p)
	content := fmt.Sprintf(`[Unit]
Description=Nestcore site %s
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%s
Environment=NODE_ENV=production
Environment=HOSTNAME=127.0.0.1
Environment=PORT=%d
ExecStart=/bin/sh -lc %s
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
`, p.Name, workDir, p.Port, shellQuote(p.StartCommand))
	if err := m.writeRemoteFile(p, "/etc/systemd/system/"+unit, content, 0o644); err != nil {
		return Result{Success: false, Message: err.Error()}
	}
	out, err := m.runRemote(ctx, p, "systemctl daemon-reload && systemctl enable --now "+shellQuote(unit))
	if err != nil {
		m.setStatus(p.ID, "failed", 0)
		return Result{Success: false, Message: err.Error(), Output: out}
	}
	configured := m.Configure(ctx, p.ID)
	if !configured.Success {
		return configured
	}
	m.setStatus(p.ID, "running", 0)
	return Result{Success: true, Message: "Site service started", Output: out}
}

func (m *Manager) startLocal(p store.Project) Result {
	if _, err := os.Stat(p.Path); err != nil {
		return Result{Success: false, Message: "Project path does not exist"}
	}
	if p.Type == "static" || p.Type == "php" {
		m.setStatus(p.ID, "running", 0)
		return Result{Success: true, Message: "Local site enabled"}
	}
	startCmd := p.StartCommand
	if startCmd == "" {
		startCmd = "npm start"
		if pkgRaw, err := os.ReadFile(filepath.Join(p.Path, "package.json")); err == nil {
			var pkg struct {
				Scripts map[string]string `json:"scripts"`
			}
			if json.Unmarshal(pkgRaw, &pkg) == nil {
				if _, has := pkg.Scripts["start"]; !has {
					if _, hasDev := pkg.Scripts["dev"]; hasDev {
						startCmd = "npm run dev"
					}
				}
			}
		}
	}
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd", "/c", startCmd)
	} else {
		cmd = exec.Command("sh", "-c", startCmd)
	}
	cmd.Dir = p.Path
	cmd.Env = append(os.Environ(), "PORT="+strconv.Itoa(p.Port))
	setDetached(cmd)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		return Result{Success: false, Message: err.Error()}
	}
	r := &running{cmd: cmd}
	go streamLogs(r, stdout, "stdout")
	go streamLogs(r, stderr, "stderr")
	m.mu.Lock()
	m.running[p.ID] = r
	m.mu.Unlock()
	pid := cmd.Process.Pid
	m.setStatus(p.ID, "running", pid)
	go func() {
		_ = cmd.Wait()
		m.mu.Lock()
		delete(m.running, p.ID)
		m.mu.Unlock()
		m.setStatus(p.ID, "stopped", 0)
	}()
	return Result{Success: true, PID: pid, Message: "Project " + p.Name + " started on port " + strconv.Itoa(p.Port)}
}

func streamLogs(r *running, rc interface{ Read([]byte) (int, error) }, kind string) {
	sc := bufio.NewScanner(rc)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		r.push(kind, sc.Text())
	}
}

func (m *Manager) Stop(id int) Result {
	p, ok := m.store.GetProject(id)
	if !ok {
		return Result{Success: false, Message: "Site not found"}
	}
	if p.HostID != 0 {
		if p.Type == "node" && p.StartCommand != "" {
			unit := fmt.Sprintf("nestcore-site-%d.service", p.ID)
			if _, err := m.runRemote(context.Background(), p, "systemctl stop "+shellQuote(unit)); err != nil {
				return Result{Success: false, Message: err.Error()}
			}
		}
		m.setStatus(id, "stopped", 0)
		return Result{Success: true, Message: "Site stopped"}
	}
	if p.Type == "static" || p.Type == "php" {
		m.setStatus(id, "stopped", 0)
		return Result{Success: true, Message: "Local site stopped"}
	}
	m.mu.Lock()
	r, running := m.running[id]
	m.mu.Unlock()
	if !running {
		return Result{Success: false, Message: "Project is not running"}
	}
	if r.cmd.Process != nil {
		if err := killTree(r.cmd.Process.Pid); err != nil {
			_ = r.cmd.Process.Kill()
		}
	}
	m.mu.Lock()
	delete(m.running, id)
	m.mu.Unlock()
	m.setStatus(id, "stopped", 0)
	return Result{Success: true, Message: "Project stopped"}
}

func (m *Manager) Restart(id int) Result {
	p, ok := m.store.GetProject(id)
	if !ok {
		return Result{Success: false, Message: "Site not found"}
	}
	if p.HostID != 0 && p.Type == "node" && p.StartCommand != "" {
		unit := fmt.Sprintf("nestcore-site-%d.service", p.ID)
		if _, err := m.runRemote(context.Background(), p, "systemctl restart "+shellQuote(unit)); err != nil {
			return Result{Success: false, Message: err.Error()}
		}
		return m.Configure(context.Background(), id)
	}
	m.Stop(id)
	return m.Start(id)
}

func (m *Manager) Health(ctx context.Context, id int) HealthResult {
	p, ok := m.store.GetProject(id)
	if !ok {
		return HealthResult{Message: "Site not found"}
	}
	if p.HostID == 0 {
		if p.Port == 0 {
			return HealthResult{Message: "No health endpoint configured"}
		}
		url := "http://127.0.0.1:" + strconv.Itoa(p.Port) + "/"
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return HealthResult{Message: err.Error()}
		}
		defer resp.Body.Close()
		return HealthResult{Healthy: resp.StatusCode < 500, StatusCode: resp.StatusCode, Message: resp.Status}
	}
	hostHeader := "localhost"
	if len(p.Domains) > 0 {
		hostHeader = p.Domains[0]
	}
	command := "curl -sS -o /dev/null -w '%{http_code}' --max-time 8 -H " + shellQuote("Host: "+hostHeader) + " http://127.0.0.1/"
	out, err := m.runRemote(ctx, p, command)
	if err != nil {
		return HealthResult{Message: err.Error()}
	}
	code, _ := strconv.Atoi(strings.TrimSpace(out))
	return HealthResult{Healthy: code >= 200 && code < 500, StatusCode: code, Message: "HTTP " + strconv.Itoa(code)}
}

func (m *Manager) Logs(id int) []LogLine {
	m.mu.Lock()
	local := append([]LogLine(nil), m.logs[id]...)
	r := m.running[id]
	m.mu.Unlock()
	if r != nil {
		local = append(local, r.snapshot()...)
	}
	p, ok := m.store.GetProject(id)
	if ok && p.HostID != 0 && p.Type == "node" && p.StartCommand != "" {
		unit := fmt.Sprintf("nestcore-site-%d.service", p.ID)
		if out, err := m.runRemote(context.Background(), p, "journalctl -u "+shellQuote(unit)+" -n 100 --no-pager -o cat"); err == nil && strings.TrimSpace(out) != "" {
			local = append(local, LogLine{Type: "runtime", Data: strings.TrimSpace(out), Time: time.Now().Format(time.RFC3339)})
		}
	}
	return local
}

func (m *Manager) StopAll() {
	m.mu.Lock()
	ids := make([]int, 0, len(m.running))
	for id := range m.running {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		m.Stop(id)
	}
}

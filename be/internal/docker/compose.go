package docker

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type StackStatus string

const (
	StackRunning StackStatus = "running"
	StackStopped StackStatus = "stopped"
	StackPartial StackStatus = "partial"
)

type ComposeStack struct {
	Name           string      `json:"name"`
	Status         StackStatus `json:"status"`
	Services       []string    `json:"services"`
	Content        string      `json:"content"`
	Path           string      `json:"path"`
	UpdatedAt      string      `json:"updatedAt"`
	ContainerCount int         `json:"containerCount"`
}

type AppTemplate struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Category    string   `json:"category"`
	Description string   `json:"description"`
	Icon        string   `json:"icon"`
	DefaultPort int      `json:"defaultPort"`
	Tags        []string `json:"tags"`
	ComposeYAML string   `json:"composeYaml"`
}

var APP_TEMPLATES = []AppTemplate{
	{
		ID:          "adguard-home",
		Name:        "AdGuard Home",
		Category:    "Network & DNS",
		Description: "Network-wide ad and tracker blocking DNS server with web dashboard.",
		Icon:        "adguard",
		DefaultPort: 3000,
		Tags:        []string{"dns", "adblock", "security", "privacy"},
		ComposeYAML: `services:
  adguardhome:
    image: adguard/adguardhome:latest
    container_name: adguardhome
    restart: unless-stopped
    ports:
      - "53:53/tcp"
      - "53:53/udp"
      - "3000:3000/tcp"
      - "80:80/tcp"
    volumes:
      - ./work:/opt/adguardhome/work
      - ./conf:/opt/adguardhome/conf
`,
	},
	{
		ID:          "portainer",
		Name:        "Portainer CE",
		Category:    "Management",
		Description: "Powerful web-based container management UI for Docker environments.",
		Icon:        "portainer",
		DefaultPort: 9000,
		Tags:        []string{"docker", "ui", "management"},
		ComposeYAML: `services:
  portainer:
    image: portainer/portainer-ce:latest
    container_name: portainer
    restart: always
    ports:
      - "9000:9000"
      - "9443:9443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/data
`,
	},
	{
		ID:          "jellyfin",
		Name:        "Jellyfin",
		Category:    "Media",
		Description: "The Free Software Media System for streaming movies, shows, and music.",
		Icon:        "jellyfin",
		DefaultPort: 8096,
		Tags:        []string{"media", "streaming", "movies", "video"},
		ComposeYAML: `services:
  jellyfin:
    image: jellyfin/jellyfin:latest
    container_name: jellyfin
    restart: unless-stopped
    ports:
      - "8096:8096"
    volumes:
      - ./config:/config
      - ./cache:/cache
      - /media:/media
`,
	},
	{
		ID:          "nginx-proxy-manager",
		Name:        "Nginx Proxy Manager",
		Category:    "Networking",
		Description: "Expose your homelab services easily with automated Let's Encrypt SSL.",
		Icon:        "nginx",
		DefaultPort: 81,
		Tags:        []string{"proxy", "ssl", "nginx", "dns"},
		ComposeYAML: `services:
  app:
    image: jc21/nginx-proxy-manager:latest
    container_name: nginx-proxy-manager
    restart: unless-stopped
    ports:
      - "80:80"
      - "81:81"
      - "443:443"
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
`,
	},
	{
		ID:          "uptime-kuma",
		Name:        "Uptime Kuma",
		Category:    "Monitoring",
		Description: "Self-hosted monitoring tool with status pages and alert channels.",
		Icon:        "uptime-kuma",
		DefaultPort: 3001,
		Tags:        []string{"monitoring", "uptime", "status", "alerts"},
		ComposeYAML: `services:
  uptime-kuma:
    image: louislam/uptime-kuma:latest
    container_name: uptime-kuma
    restart: always
    ports:
      - "3001:3001"
    volumes:
      - ./data:/app/data
`,
	},
	{
		ID:          "vaultwarden",
		Name:        "Vaultwarden",
		Category:    "Security",
		Description: "Lightweight self-hosted password manager compatible with Bitwarden clients.",
		Icon:        "vaultwarden",
		DefaultPort: 8088,
		Tags:        []string{"passwords", "security", "vault", "sync"},
		ComposeYAML: `services:
  vaultwarden:
    image: vaultwarden/server:latest
    container_name: vaultwarden
    restart: always
    environment:
      - WEBSOCKET_ENABLED=true
    ports:
      - "8088:80"
    volumes:
      - ./data:/data
`,
	},
	{
		ID:          "qbittorrent",
		Name:        "qBittorrent WebUI",
		Category:    "Downloads",
		Description: "Feature-rich BitTorrent client with Web GUI for automated downloading.",
		Icon:        "qbittorrent",
		DefaultPort: 8080,
		Tags:        []string{"torrents", "downloads", "media"},
		ComposeYAML: `services:
  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    container_name: qbittorrent
    restart: unless-stopped
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Asia/Jakarta
      - WEBUI_PORT=8080
    ports:
      - "8080:8080"
      - "6881:6881"
      - "6881:6881/udp"
    volumes:
      - ./config:/config
      - ./downloads:/downloads
`,
	},
	{
		ID:          "home-assistant",
		Name:        "Home Assistant Core",
		Category:    "Smart Home",
		Description: "Open source home automation that puts local control and privacy first.",
		Icon:        "home-assistant",
		DefaultPort: 8123,
		Tags:        []string{"iot", "smarthome", "automation"},
		ComposeYAML: `services:
  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    container_name: homeassistant
    restart: unless-stopped
    privileged: true
    network_mode: host
    volumes:
      - ./config:/config
      - /etc/localtime:/etc/localtime:ro
`,
	},
}

func (s *Service) StacksDir(root string) string {
	return filepath.Join(root, "data", "compose")
}

func (s *Service) ListTemplates() []AppTemplate {
	return APP_TEMPLATES
}

func (s *Service) ListStacks(ctx context.Context, root string) ([]ComposeStack, error) {
	dir := s.StacksDir(root)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	containers, _ := s.List(ctx, true)
	containerMap := make(map[string]Container)
	for _, c := range containers {
		containerMap[c.Name] = c
	}

	stacks := make([]ComposeStack, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		stackName := e.Name()
		composeFile := filepath.Join(dir, stackName, "docker-compose.yml")
		if _, err := os.Stat(composeFile); os.IsNotExist(err) {
			composeFile = filepath.Join(dir, stackName, "compose.yml")
			if _, err := os.Stat(composeFile); os.IsNotExist(err) {
				continue
			}
		}

		content, err := os.ReadFile(composeFile)
		if err != nil {
			continue
		}

		fi, _ := os.Stat(composeFile)
		updatedAt := time.Now().Format(time.RFC3339)
		if fi != nil {
			updatedAt = fi.ModTime().UTC().Format(time.RFC3339)
		}

		services := parseServicesFromYAML(string(content))
		runningCount := 0
		for _, svc := range services {
			if c, ok := containerMap[svc]; ok && c.State == "running" {
				runningCount++
			} else if c, ok := containerMap[stackName+"_"+svc+"_1"]; ok && c.State == "running" {
				runningCount++
			} else if c, ok := containerMap[stackName+"-"+svc+"-1"]; ok && c.State == "running" {
				runningCount++
			}
		}

		status := StackStopped
		if len(services) > 0 && runningCount == len(services) {
			status = StackRunning
		} else if runningCount > 0 {
			status = StackPartial
		}

		stacks = append(stacks, ComposeStack{
			Name:           stackName,
			Status:         status,
			Services:       services,
			Content:        string(content),
			Path:           composeFile,
			UpdatedAt:      updatedAt,
			ContainerCount: len(services),
		})
	}

	return stacks, nil
}

func (s *Service) GetStack(root, name string) (ComposeStack, error) {
	dir := filepath.Join(s.StacksDir(root), name)
	composeFile := filepath.Join(dir, "docker-compose.yml")
	if _, err := os.Stat(composeFile); os.IsNotExist(err) {
		composeFile = filepath.Join(dir, "compose.yml")
		if _, err := os.Stat(composeFile); os.IsNotExist(err) {
			return ComposeStack{}, fmt.Errorf("stack %q not found", name)
		}
	}

	content, err := os.ReadFile(composeFile)
	if err != nil {
		return ComposeStack{}, err
	}

	fi, _ := os.Stat(composeFile)
	updatedAt := time.Now().Format(time.RFC3339)
	if fi != nil {
		updatedAt = fi.ModTime().UTC().Format(time.RFC3339)
	}

	services := parseServicesFromYAML(string(content))
	return ComposeStack{
		Name:           name,
		Status:         StackStopped,
		Services:       services,
		Content:        string(content),
		Path:           composeFile,
		UpdatedAt:      updatedAt,
		ContainerCount: len(services),
	}, nil
}

func (s *Service) SaveStack(root, name, content string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("stack name is required")
	}
	dir := filepath.Join(s.StacksDir(root), name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	composeFile := filepath.Join(dir, "docker-compose.yml")
	return os.WriteFile(composeFile, []byte(content), 0o644)
}

func (s *Service) UpStack(ctx context.Context, root, name string) (string, error) {
	dir := filepath.Join(s.StacksDir(root), name)
	composeFile := filepath.Join(dir, "docker-compose.yml")
	if _, err := os.Stat(composeFile); os.IsNotExist(err) {
		composeFile = filepath.Join(dir, "compose.yml")
	}
	return run(ctx, "docker", "compose", "-f", composeFile, "up", "-d")
}

func (s *Service) DownStack(ctx context.Context, root, name string) (string, error) {
	dir := filepath.Join(s.StacksDir(root), name)
	composeFile := filepath.Join(dir, "docker-compose.yml")
	if _, err := os.Stat(composeFile); os.IsNotExist(err) {
		composeFile = filepath.Join(dir, "compose.yml")
	}
	return run(ctx, "docker", "compose", "-f", composeFile, "down")
}

func (s *Service) RestartStack(ctx context.Context, root, name string) (string, error) {
	dir := filepath.Join(s.StacksDir(root), name)
	composeFile := filepath.Join(dir, "docker-compose.yml")
	if _, err := os.Stat(composeFile); os.IsNotExist(err) {
		composeFile = filepath.Join(dir, "compose.yml")
	}
	return run(ctx, "docker", "compose", "-f", composeFile, "restart")
}

func (s *Service) DeleteStack(ctx context.Context, root, name string) error {
	dir := filepath.Join(s.StacksDir(root), name)
	_, _ = s.DownStack(ctx, root, name)
	return os.RemoveAll(dir)
}

func parseServicesFromYAML(content string) []string {
	lines := strings.Split(content, "\n")
	inServices := false
	services := []string{}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") || trimmed == "" {
			continue
		}
		if strings.HasPrefix(line, "services:") {
			inServices = true
			continue
		}
		if inServices {
			if (strings.HasPrefix(line, "  ") && !strings.HasPrefix(line, "    ")) || (strings.HasPrefix(line, "\t") && !strings.HasPrefix(line, "\t\t")) {
				parts := strings.Split(trimmed, ":")
				if len(parts) >= 1 && len(parts[0]) > 0 {
					services = append(services, parts[0])
				}
			} else if !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") {
				inServices = false
			}
		}
	}
	return services
}

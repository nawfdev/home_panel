// Package config loads the shared config/config.json used by the legacy Node
// backend, so the Go rewrite stays drop-in compatible with existing deployments.
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Config mirrors config/config.json. Unknown future keys are ignored.
type Config struct {
	Server struct {
		Port int    `json:"port"`
		Host string `json:"host"`
	} `json:"server"`
	Session struct {
		Secret string `json:"secret"`
		MaxAge int64  `json:"maxAge"` // milliseconds (matches express-session)
	} `json:"session"`
	Cloudflare struct {
		TunnelName string `json:"tunnelName"`
		TunnelID   string `json:"tunnelId"`
		Domain     string `json:"domain"`
	} `json:"cloudflare"`
	DefaultAdmin struct {
		Username string `json:"username"`
		Password string `json:"password"`
	} `json:"defaultAdmin"`
	Telegram json.RawMessage `json:"telegram"`
	Alerts   json.RawMessage `json:"alerts"`
}

// Paths resolves the on-disk locations the server depends on, all relative to a
// single root so the binary can run from anywhere via HOMEPANEL_ROOT.
type Paths struct {
	Root       string
	ConfigFile string
	DataFile   string
	Frontend   string
}

// ResolvePaths returns the standard layout rooted at HOMEPANEL_ROOT (default ".").
func ResolvePaths() Paths {
	root := os.Getenv("HOMEPANEL_ROOT")
	if root == "" {
		root = "."
		if _, err := os.Stat(filepath.Join(root, "config", "config.json")); err != nil {
			if _, parentErr := os.Stat(filepath.Join("..", "config", "config.json")); parentErr == nil {
				root = ".."
			}
		}
	}
	abs, err := filepath.Abs(root)
	if err == nil {
		root = abs
	}
	return Paths{
		Root:       root,
		ConfigFile: filepath.Join(root, "config", "config.json"),
		DataFile:   filepath.Join(root, "data", "db.json"),
		Frontend:   filepath.Join(root, "frontend"),
	}
}

// Load reads and parses config.json.
func Load(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, err
	}
	if c.Server.Port == 0 {
		c.Server.Port = 9689
	}
	if c.Server.Host == "" {
		c.Server.Host = "0.0.0.0"
	}
	return &c, nil
}

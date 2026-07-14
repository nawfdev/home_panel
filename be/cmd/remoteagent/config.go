package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	Port  int    `json:"port"`
	Token string `json:"token"`
}

func configPath() string {
	exe, err := os.Executable()
	if err != nil {
		return "remoteagent.json"
	}
	return filepath.Join(filepath.Dir(exe), "remoteagent.json")
}

// loadOrCreateConfig reads remoteagent.json next to the binary, generating a
// fresh port+token on first run so there's nothing to configure by hand.
func loadOrCreateConfig() (Config, error) {
	path := configPath()
	if raw, err := os.ReadFile(path); err == nil {
		var cfg Config
		if json.Unmarshal(raw, &cfg) == nil && cfg.Port != 0 && cfg.Token != "" {
			return cfg, nil
		}
	}

	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		return Config{}, err
	}
	cfg := Config{Port: 8791, Token: hex.EncodeToString(tokenBytes)}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return Config{}, err
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

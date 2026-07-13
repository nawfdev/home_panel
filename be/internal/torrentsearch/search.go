// Package torrentsearch shells out to a small Node.js sidecar
// (be/scripts/torrent-search/search.js) that wraps the torrent-search-api
// npm package — there's no Go equivalent, and the package itself is
// Node-only. Same "invoke an optional external tool" shape already used for
// ffmpeg/ffprobe/aria2c elsewhere in this repo, just a script instead of a
// binary. One process per search, no daemon to manage.
package torrentsearch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/nawfdev/home-panel/internal/config"
)

type Service struct {
	scriptDir string
}

func New(paths config.Paths) *Service {
	return &Service{scriptDir: filepath.Join(paths.Root, "scripts", "torrent-search")}
}

// Available reports whether node is on PATH and the sidecar's dependency has
// been installed, with a message clear enough to act on directly.
func (s *Service) Available() error {
	if _, err := exec.LookPath("node"); err != nil {
		return errors.New("node isn't on PATH — install Node.js to enable torrent search")
	}
	if _, err := os.Stat(filepath.Join(s.scriptDir, "node_modules", "torrent-search-api")); err != nil {
		return fmt.Errorf("torrent search dependency not installed — run \"npm install\" in %s", s.scriptDir)
	}
	return nil
}

// Result is one torrent search hit, already carrying a resolved magnet link.
type Result struct {
	Title    string `json:"title"`
	Size     string `json:"size"`
	Seeds    int    `json:"seeds"`
	Peers    int    `json:"peers"`
	Provider string `json:"provider"`
	Magnet   string `json:"magnet"`
}

// Search runs the sidecar script. Scraping ~8-10 providers concurrently can
// be slow (or some may hang), so this is capped well above what a normal run
// takes but still bounded.
func (s *Service) Search(query string) ([]Result, error) {
	if err := s.Available(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "node", "search.js", query)
	cmd.Dir = s.scriptDir // so require() resolves this sidecar's own node_modules
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if len(msg) > 500 {
			msg = msg[len(msg)-500:]
		}
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("torrent search failed: %s", msg)
	}

	var results []Result
	if err := json.Unmarshal([]byte(stdout.String()), &results); err != nil {
		return nil, fmt.Errorf("torrent search returned unexpected output: %w", err)
	}
	return results, nil
}

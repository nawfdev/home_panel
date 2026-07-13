// Package torrentsearch shells out to a small Node.js sidecar
// (be/scripts/torrent-search/search.js) that queries torrent index JSON APIs
// (YTS, apibay) directly — there's no Go equivalent handy, and Node's
// built-in fetch makes this a dependency-free script. Same "invoke an
// optional external tool" shape already used for ffmpeg/ffprobe/aria2c
// elsewhere in this repo, just a script instead of a binary. One process per
// search, no daemon to manage.
package torrentsearch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/nawfdev/home-panel/internal/config"
)

type Service struct {
	scriptDir string
}

func New(paths config.Paths) *Service {
	return &Service{scriptDir: filepath.Join(paths.Root, "be", "scripts", "torrent-search")}
}

// minNodeMajor is the lowest Node.js major version with a stable built-in
// fetch, which search.js relies on instead of an npm HTTP client.
const minNodeMajor = 18

// Available reports whether node is on PATH and new enough for search.js's
// use of the built-in fetch, with a message clear enough to act on directly.
func (s *Service) Available() error {
	out, err := exec.Command("node", "--version").Output()
	if err != nil {
		return errors.New("node isn't on PATH — install Node.js to enable torrent search")
	}
	if major := parseNodeMajor(string(out)); major > 0 && major < minNodeMajor {
		return fmt.Errorf("node %s is too old for torrent search (needs >=%d) — upgrade Node.js", strings.TrimSpace(string(out)), minNodeMajor)
	}
	return nil
}

// parseNodeMajor extracts the major version from `node --version` output
// like "v18.19.1". Returns 0 when it can't be parsed.
func parseNodeMajor(v string) int {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(v, "v")
	dot := strings.IndexByte(v, '.')
	if dot > 0 {
		v = v[:dot]
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0
	}
	return n
}

// Result is one torrent search hit, already carrying a resolved magnet link.
type Result struct {
	Title    string `json:"title"`
	Size     string `json:"size"`
	Seeds    int    `json:"seeds"`
	Peers    int    `json:"peers"`
	Provider string `json:"provider"`
	Magnet   string `json:"magnet"`
	Poster   string `json:"poster,omitempty"`
}

// Search runs the sidecar script. Providers are queried concurrently but one
// may be slow or hang, so this is capped well above what a normal run takes
// but still bounded.
func (s *Service) Search(query string) ([]Result, error) {
	if err := s.Available(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "node", "search.js", query)
	cmd.Dir = s.scriptDir
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

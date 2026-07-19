// Package tv streams live TV channels from a public M3U/M3U8 playlist
// aggregator (github.com/dhasap/dhanytv) through the panel: it parses the
// playlists into channels — including any Referer/User-Agent header or
// ClearKey/Widevine DRM requirement — and proxies playback requests so
// channels that need those (both unsettable directly from browser JS) still
// play. See proxy.go for the playback proxy.
package tv

import (
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

// playlists are dhanytv's plain-text M3U sources: dhanytv.m3u is the main
// free-to-air Indonesian list, dhanytv-ott.m3u leans toward OTT channels
// that more often carry DRM.
var playlists = []struct {
	source string
	url    string
}{
	{"main", "https://raw.githubusercontent.com/dhasap/dhanytv/main/dhanytv.m3u"},
	{"ott", "https://raw.githubusercontent.com/dhasap/dhanytv/main/dhanytv-ott.m3u"},
}

const cacheTTL = 6 * time.Hour

// userAgent avoids the default Go client string, which some hosts block.
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/124.0 Safari/537.36"

// DRM is a normalized, Shaka-Player-ready DRM config for one channel.
type DRM struct {
	System    string            `json:"system"` // "clearkey" | "widevine" | "unknown"
	ClearKeys map[string]string `json:"clearKeys,omitempty"`
	ServerURL string            `json:"serverUrl,omitempty"`
}

// Channel is one playable entry parsed from a playlist.
type Channel struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	TvgID   string            `json:"tvgId"`
	Logo    string            `json:"logo"`
	Group   string            `json:"group"`
	Source  string            `json:"source"` // which playlist this came from: "main" | "ott"
	URL     string            `json:"url"`
	Type    string            `json:"type"` // "hls" | "dash" | "ts"
	Headers map[string]string `json:"headers,omitempty"`
	DRM     *DRM              `json:"drm,omitempty"`
}

// Service caches the merged, parsed channel list from all playlists and
// proxies playback requests (see proxy.go).
type Service struct {
	httpClient *http.Client

	mu       sync.RWMutex
	channels []Channel
	fetched  time.Time
}

func NewService() *Service {
	return &Service{httpClient: &http.Client{Timeout: 45 * time.Second}}
}

// Channels returns the cached channel list, refreshing synchronously if the
// cache is empty or older than cacheTTL.
func (s *Service) Channels() ([]Channel, error) {
	s.mu.RLock()
	fresh := len(s.channels) > 0 && time.Since(s.fetched) < cacheTTL
	channels := s.channels
	s.mu.RUnlock()
	if fresh {
		return channels, nil
	}
	return s.refresh()
}

func (s *Service) refresh() ([]Channel, error) {
	var all []Channel
	var lastErr error
	for _, p := range playlists {
		text, err := s.fetchText(p.url)
		if err != nil {
			lastErr = err
			continue
		}
		all = append(all, parseM3U(text, p.source)...)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if len(all) > 0 {
		s.channels = all
		s.fetched = time.Now()
		return all, nil
	}
	// A stale cache beats a hard failure — dhanytv is a third-party repo we
	// don't control the uptime of.
	if len(s.channels) > 0 {
		return s.channels, nil
	}
	return nil, fmt.Errorf("couldn't load TV playlists: %w", lastErr)
}

func (s *Service) fetchText(u string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("playlist fetch failed: HTTP %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20)) // 32MB cap
	if err != nil {
		return "", err
	}
	return string(b), nil
}

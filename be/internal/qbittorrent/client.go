// Package qbittorrent talks to a qBittorrent WebUI the user runs themselves
// (Settings > Web UI in the qBittorrent app), reusing its multi-plugin
// Search tab instead of the panel scraping any one torrent site itself, and
// its BitTorrent engine (DHT, resume, seeding) instead of aria2's weaker
// torrent support. Configuration is loaded from/saved to the JSON store, the
// same shape as internal/telegram.
package qbittorrent

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nawfdev/home-panel/internal/store"
)

type Service struct {
	mu       sync.RWMutex
	store    *store.Store
	baseURL  string
	username string
	password string
	http     *http.Client
}

func New(st *store.Store) *Service {
	jar, _ := cookiejar.New(nil)
	svc := &Service{store: st, http: &http.Client{Jar: jar, Timeout: 30 * time.Second}}
	svc.loadFromStore()
	return svc
}

func (s *Service) loadFromStore() {
	v, ok := s.store.GetSetting("qbittorrent")
	if !ok {
		return
	}
	m, ok := v.(map[string]interface{})
	if !ok {
		return
	}
	baseURL, _ := m["baseUrl"].(string)
	username, _ := m["username"].(string)
	password, _ := m["password"].(string)
	s.mu.Lock()
	s.baseURL, s.username, s.password = strings.TrimRight(baseURL, "/"), username, password
	s.mu.Unlock()
}

// Configured reports whether a base URL has been set at all — used to give a
// clear "not configured" error before attempting any request.
func (s *Service) Configured() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.baseURL != ""
}

// UpdateConfig verifies the new credentials with a login call before caching
// them, mirroring Cloudflare's "verify before save" behavior in
// handlers/settings.go — a typo'd password never silently becomes "current".
func (s *Service) UpdateConfig(baseURL, username, password string) error {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return errors.New("base URL is required")
	}
	jar, _ := cookiejar.New(nil)
	trial := &Service{baseURL: baseURL, username: username, password: password, http: &http.Client{Jar: jar, Timeout: 30 * time.Second}}
	if err := trial.login(); err != nil {
		return err
	}
	s.mu.Lock()
	s.baseURL, s.username, s.password, s.http = baseURL, username, password, trial.http
	s.mu.Unlock()
	return nil
}

func (s *Service) config() (baseURL, username, password string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.baseURL, s.username, s.password
}

func (s *Service) login() error {
	baseURL, username, password, httpClient := s.snapshotForRequest()
	form := url.Values{"username": {username}, "password": {password}}
	req, err := http.NewRequest(http.MethodPost, baseURL+"/api/v2/auth/login", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Referer", baseURL)
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("couldn't reach qBittorrent WebUI at %s: %w", baseURL, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK || strings.TrimSpace(string(body)) != "Ok." {
		return errors.New("qBittorrent login failed: check WebUI URL, username and password")
	}
	return nil
}

func (s *Service) snapshotForRequest() (baseURL, username, password string, httpClient *http.Client) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.baseURL, s.username, s.password, s.http
}

// do issues an authenticated request, retrying once after a fresh login if
// the session cookie turned out to be expired (qBittorrent returns 403).
func (s *Service) do(method, path string, body io.Reader, contentType string) (*http.Response, error) {
	if !s.Configured() {
		return nil, errors.New("qBittorrent isn't configured yet — set the WebUI URL in Settings")
	}
	var bodyBytes []byte
	if body != nil {
		var err error
		bodyBytes, err = io.ReadAll(body)
		if err != nil {
			return nil, err
		}
	}
	doOnce := func() (*http.Response, error) {
		baseURL, _, _, httpClient := s.snapshotForRequest()
		var reqBody io.Reader
		if bodyBytes != nil {
			reqBody = bytes.NewReader(bodyBytes)
		}
		req, err := http.NewRequest(method, baseURL+path, reqBody)
		if err != nil {
			return nil, err
		}
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		req.Header.Set("Referer", baseURL)
		return httpClient.Do(req)
	}

	resp, err := doOnce()
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusForbidden {
		resp.Body.Close()
		if err := s.login(); err != nil {
			return nil, err
		}
		resp, err = doOnce()
		if err != nil {
			return nil, err
		}
	}
	return resp, nil
}

// SearchResult is one hit from qBittorrent's Search tab (any installed
// plugin). URL is either a magnet link or a .torrent file link, depending on
// which plugin produced it.
type SearchResult struct {
	Name      string `json:"name"`
	SizeBytes int64  `json:"sizeBytes"`
	URL       string `json:"url"`
	Seeders   int    `json:"seeders"`
	Leechers  int    `json:"leechers"`
	Site      string `json:"site"`
}

// Search runs a query across every installed search plugin. Plugins are
// external processes that stream results in over a few seconds, so this
// polls status rather than getting one synchronous answer.
func (s *Service) Search(query string) ([]SearchResult, error) {
	startBody, _ := json.Marshal(map[string]string{"pattern": query, "plugins": "all", "category": "all"})
	resp, err := s.do(http.MethodPost, "/api/v2/search/start", bytes.NewReader(startBody), "application/json")
	if err != nil {
		return nil, err
	}
	var started struct {
		ID int `json:"id"`
	}
	err = json.NewDecoder(resp.Body).Decode(&started)
	resp.Body.Close()
	if err != nil {
		return nil, fmt.Errorf("search/start response: %w", err)
	}

	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		st, err := s.searchStatus(started.ID)
		if err != nil || st != "Running" {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	results, err := s.searchResults(started.ID)
	// Best-effort cleanup; a failure here shouldn't hide real results.
	delBody, _ := json.Marshal(map[string]int{"id": started.ID})
	if delResp, delErr := s.do(http.MethodPost, "/api/v2/search/delete", bytes.NewReader(delBody), "application/json"); delErr == nil {
		delResp.Body.Close()
	}
	return results, err
}

func (s *Service) searchStatus(id int) (string, error) {
	resp, err := s.do(http.MethodGet, fmt.Sprintf("/api/v2/search/status?id=%d", id), nil, "")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out []struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || len(out) == 0 {
		return "", fmt.Errorf("search/status response: %w", err)
	}
	return out[0].Status, nil
}

func (s *Service) searchResults(id int) ([]SearchResult, error) {
	resp, err := s.do(http.MethodGet, fmt.Sprintf("/api/v2/search/results?id=%d&limit=50", id), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out struct {
		Results []struct {
			FileName  string `json:"fileName"`
			FileSize  int64  `json:"fileSize"`
			FileURL   string `json:"fileUrl"`
			NbSeeders int    `json:"nbSeeders"`
			NbLeech   int    `json:"nbLeechers"`
			SiteURL   string `json:"siteUrl"`
		} `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("search/results response: %w", err)
	}
	results := make([]SearchResult, 0, len(out.Results))
	for _, r := range out.Results {
		results = append(results, SearchResult{
			Name: r.FileName, SizeBytes: r.FileSize, URL: r.FileURL,
			Seeders: r.NbSeeders, Leechers: r.NbLeech, Site: r.SiteURL,
		})
	}
	return results, nil
}

var reMagnetHash = regexp.MustCompile(`(?i)xt=urn:btih:([0-9a-f]{40}|[2-7a-z]{32})`)

// AddTorrent adds a magnet link or .torrent file URL to qBittorrent under
// savepath, returning its info hash for progress polling.
func (s *Service) AddTorrent(torrentURL, savepath string) (hash string, err error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	_ = w.WriteField("urls", torrentURL)
	_ = w.WriteField("savepath", savepath)
	_ = w.WriteField("category", "homepanel")
	if err := w.Close(); err != nil {
		return "", err
	}
	resp, err := s.do(http.MethodPost, "/api/v2/torrents/add", &buf, w.FormDataContentType())
	if err != nil {
		return "", err
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("qBittorrent rejected the torrent (HTTP %d)", resp.StatusCode)
	}

	if m := reMagnetHash.FindStringSubmatch(torrentURL); len(m) > 1 {
		return strings.ToLower(m[1]), nil
	}

	// .torrent file URL: qBittorrent doesn't return the hash from /add, so
	// resolve it by finding the newest torrent in our dedicated category.
	// Fine for a single-user panel with low add concurrency; a genuine race
	// (two torrents added in the same instant) would pick the wrong one.
	time.Sleep(500 * time.Millisecond)
	listResp, err := s.do(http.MethodGet, "/api/v2/torrents/info?category=homepanel&sort=added_on&reverse=true", nil, "")
	if err != nil {
		return "", err
	}
	defer listResp.Body.Close()
	var list []struct {
		Hash string `json:"hash"`
	}
	if err := json.NewDecoder(listResp.Body).Decode(&list); err != nil || len(list) == 0 {
		return "", fmt.Errorf("added the torrent but couldn't resolve its hash: %w", err)
	}
	return list[0].Hash, nil
}

// TorrentInfo is qBittorrent's progress snapshot for one torrent.
type TorrentInfo struct {
	State       string
	Progress    float64 // 0..1
	Size        int64
	Downloaded  int64
	DlSpeed     int64
	ContentPath string
	Name        string
}

func (s *Service) Info(hash string) (TorrentInfo, error) {
	resp, err := s.do(http.MethodGet, "/api/v2/torrents/info?hashes="+url.QueryEscape(hash), nil, "")
	if err != nil {
		return TorrentInfo{}, err
	}
	defer resp.Body.Close()
	var out []struct {
		State       string  `json:"state"`
		Progress    float64 `json:"progress"`
		Size        int64   `json:"size"`
		Downloaded  int64   `json:"downloaded"`
		DlSpeed     int64   `json:"dlspeed"`
		ContentPath string  `json:"content_path"`
		Name        string  `json:"name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return TorrentInfo{}, fmt.Errorf("torrents/info response: %w", err)
	}
	if len(out) == 0 {
		return TorrentInfo{}, errors.New("torrent not found in qBittorrent (may have been removed)")
	}
	t := out[0]
	return TorrentInfo{
		State: t.State, Progress: t.Progress, Size: t.Size, Downloaded: t.Downloaded,
		DlSpeed: t.DlSpeed, ContentPath: t.ContentPath, Name: t.Name,
	}, nil
}

func (s *Service) Delete(hash string, deleteFiles bool) error {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	_ = w.WriteField("hashes", hash)
	_ = w.WriteField("deleteFiles", strconv.FormatBool(deleteFiles))
	if err := w.Close(); err != nil {
		return err
	}
	resp, err := s.do(http.MethodPost, "/api/v2/torrents/delete", &buf, w.FormDataContentType())
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

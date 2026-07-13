// Package subtitles talks to the subsource.net REST API to search for and
// download subtitle files, so users don't have to hunt for .srt files by
// hand. Downloaded subtitles are saved as sidecar files next to a movie,
// which the existing internal/files DetectSubtitles/player pipeline already
// picks up with no further wiring.
package subtitles

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"
)

const baseURL = "https://api.subsource.net/api/v1"

// apiKey defaults to SUBSOURCE_API_KEY at process start, but can be
// overridden at runtime by SetAPIKey — the Settings page saves a key there
// so it doesn't have to live in the environment. main.go calls SetAPIKey
// once at boot with whatever was last saved, and the settings handler calls
// it again immediately after a save so the change takes effect without a
// restart.
var (
	apiKeyMu sync.RWMutex
	apiKey   = os.Getenv("SUBSOURCE_API_KEY")
)

// SetAPIKey overrides the API key used for every subsequent call.
func SetAPIKey(key string) {
	apiKeyMu.Lock()
	apiKey = key
	apiKeyMu.Unlock()
}

func currentAPIKey() string {
	apiKeyMu.RLock()
	defer apiKeyMu.RUnlock()
	return apiKey
}

// Available reports whether an API key is configured (env var or Settings).
func Available() bool { return currentAPIKey() != "" }

var httpClient = &http.Client{Timeout: 30 * time.Second}

var errNotConfigured = errors.New("subtitle search not configured: set the SUBSOURCE_API_KEY environment variable (get a free key from your subsource.net profile)")

func doGet(path string, query url.Values) ([]byte, http.Header, error) {
	if !Available() {
		return nil, nil, errNotConfigured
	}
	u := baseURL + path
	if query != nil {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("X-API-Key", currentAPIKey())
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024*1024))
	if err != nil {
		return nil, nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("subsource API returned HTTP %d for %s", resp.StatusCode, path)
	}
	return body, resp.Header, nil
}

type movieSearchResponse struct {
	Success bool `json:"success"`
	Data    []struct {
		MovieID     int    `json:"movieId"`
		Title       string `json:"title"`
		ReleaseYear int    `json:"releaseYear"`
	} `json:"data"`
}

// findMovieID resolves a free-text title to subsource's movieId by taking the
// first text-search match. Good enough for the common case (a specific movie
// title); there's no UI for disambiguating multiple matches in Fase 1.
func findMovieID(title string) (int, error) {
	body, _, err := doGet("/movies/search", url.Values{
		"searchType": {"text"},
		"q":          {title},
	})
	if err != nil {
		return 0, err
	}
	var res movieSearchResponse
	if err := json.Unmarshal(body, &res); err != nil {
		return 0, fmt.Errorf("movies/search response: %w", err)
	}
	if len(res.Data) == 0 {
		return 0, fmt.Errorf("no movie found on subsource for %q", title)
	}
	return res.Data[0].MovieID, nil
}

// Result is one subtitle search hit, shaped to match what the frontend
// modal renders.
type Result struct {
	SubtitleID  int      `json:"subtitleId"`
	Language    string   `json:"language"`
	ReleaseInfo []string `json:"releaseInfo"`
	Downloads   int      `json:"downloads"`
	Rating      struct {
		Good  int `json:"good"`
		Bad   int `json:"bad"`
		Total int `json:"total"`
	} `json:"rating"`
}

type subtitlesResponse struct {
	Success bool     `json:"success"`
	Data    []Result `json:"data"`
}

// Search resolves title to a subsource movie and returns its subtitles
// filtered by lang (a language name like "english", not an ISO code —
// matches how the subsource API expects it), sorted by popularity.
func Search(title, lang string) ([]Result, error) {
	movieID, err := findMovieID(title)
	if err != nil {
		return nil, err
	}
	q := url.Values{
		"movieId": {fmt.Sprint(movieID)},
		"sort":    {"popular"},
		"limit":   {"20"},
	}
	if lang != "" {
		q.Set("language", lang)
	}
	body, _, err := doGet("/subtitles", q)
	if err != nil {
		return nil, err
	}
	var res subtitlesResponse
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("subtitles response: %w", err)
	}
	return res.Data, nil
}

// Download fetches a subtitle's ZIP archive and extracts the first .srt
// entry from it. subsource always serves subtitles as a ZIP, even for a
// single file.
func Download(subtitleID int) ([]byte, error) {
	body, _, err := doGet(fmt.Sprintf("/subtitles/%d/download", subtitleID), nil)
	if err != nil {
		return nil, err
	}
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		return nil, fmt.Errorf("subtitle download wasn't a valid zip: %w", err)
	}
	for _, f := range zr.File {
		if len(f.Name) < 4 || f.Name[len(f.Name)-4:] != ".srt" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		defer rc.Close()
		return io.ReadAll(io.LimitReader(rc, 16*1024*1024))
	}
	return nil, errors.New("no .srt file found in subtitle archive")
}

package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	filesvc "github.com/nawfdev/home-panel/internal/files"
	"github.com/nawfdev/home-panel/internal/httpx"
	subtitlesvc "github.com/nawfdev/home-panel/internal/subtitles"
)

// Subtitles exposes the subsource.net subtitle search/download so users
// don't have to hunt for .srt files by hand. Saved subtitles land as
// sidecars next to the movie, which the existing files.DetectSubtitles/
// player pipeline already serves with no extra wiring.
type Subtitles struct{}

func (s *Subtitles) Search(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title string `json:"title"`
		Lang  string `json:"lang"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	results, err := subtitlesvc.Search(req.Title, req.Lang)
	if err != nil {
		httpx.JSON(w, http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()})
		return
	}
	if results == nil {
		results = []subtitlesvc.Result{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "results": results})
}

var reUnsafeLabel = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f.]`)

func (s *Subtitles) Download(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SubtitleID int    `json:"subtitleId"`
		VideoDest  string `json:"videoDest"`
		Lang       string `json:"lang"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	videoPath, err := filesvc.SafePath(req.VideoDest)
	if err != nil {
		httpx.JSON(w, http.StatusForbidden, map[string]any{"success": false, "error": err.Error()})
		return
	}
	if info, err := os.Stat(videoPath); err != nil || info.IsDir() || filesvc.MediaType(videoPath) != "video" {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "video not found"})
		return
	}

	data, err := subtitlesvc.Download(req.SubtitleID)
	if err != nil {
		httpx.JSON(w, http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()})
		return
	}

	label := strings.TrimSpace(reUnsafeLabel.ReplaceAllString(req.Lang, ""))
	if label == "" {
		label = "sub"
	}
	base := strings.TrimSuffix(filepath.Base(videoPath), filepath.Ext(videoPath))
	dest := filepath.Join(filepath.Dir(videoPath), base+"."+label+".srt")
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"success":  true,
		"subtitle": filesvc.Subtitle{Name: filepath.Base(dest), Label: label},
	})
}

package files

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// MediaInfo validates userPath and reports its media type and any sidecar
// subtitles (for the in-panel player). type is "" for non-media files.
func (s *Service) MediaInfo(userPath string) (string, []Subtitle, error) {
	full, err := SafePath(userPath)
	if err != nil {
		return "", nil, err
	}
	info, err := os.Stat(full)
	if os.IsNotExist(err) {
		return "", nil, errFileNotFound
	}
	if err != nil {
		return "", nil, err
	}
	if info.IsDir() {
		return "", nil, errReadDirectory
	}
	mt := MediaType(full)
	var subs []Subtitle
	if mt == "video" {
		// Best-effort: files that never went through the movies download
		// pipeline (uploads, pre-existing files) never had their embedded
		// subtitle tracks pulled into sidecars — do it lazily on first view.
		_ = ExtractEmbeddedSubtitles(full)
		subs = DetectSubtitles(full)
	}
	return mt, subs, nil
}

// SubtitleForPath validates userPath and returns the named sidecar subtitle as
// WebVTT (for the authenticated in-panel player).
func (s *Service) SubtitleForPath(userPath, subName string) (string, error) {
	full, err := SafePath(userPath)
	if err != nil {
		return "", err
	}
	return SubtitleVTT(full, subName)
}

// MediaType classifies a filename by extension for the share/player UI.
// Returns "video", "image", "audio", or "" (not a recognized media type).
func MediaType(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".mp4", ".webm", ".mkv", ".mov", ".m4v", ".avi", ".ogv":
		return "video"
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif":
		return "image"
	case ".mp3", ".m4a", ".wav", ".ogg", ".oga", ".flac", ".aac":
		return "audio"
	default:
		return ""
	}
}

// contentTypeByExt maps extensions to their MIME type, used instead of Go's
// OS-dependent mime.TypeByExtension (which has no built-in entries for video
// formats and, on Windows without the codec's registry entry, falls back to
// content sniffing that misses containers like QuickTime .mov). Without an
// explicit Content-Type, browsers refuse to decode the served video — the
// player shows a black frame with no error.
var contentTypeByExt = map[string]string{
	".mp4":  "video/mp4",
	".m4v":  "video/x-m4v",
	".webm": "video/webm",
	".mkv":  "video/x-matroska",
	".mov":  "video/quicktime",
	".avi":  "video/x-msvideo",
	".ogv":  "video/ogg",
	".mp3":  "audio/mpeg",
	".m4a":  "audio/mp4",
	".wav":  "audio/wav",
	".ogg":  "audio/ogg",
	".oga":  "audio/ogg",
	".flac": "audio/flac",
	".aac":  "audio/aac",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".gif":  "image/gif",
	".webp": "image/webp",
	".bmp":  "image/bmp",
	".svg":  "image/svg+xml",
	".avif": "image/avif",
}

// ContentTypeFor returns the MIME type to send for name, or "" if unknown
// (in which case the caller should let http.ServeFile/ServeContent detect it).
func ContentTypeFor(name string) string {
	return contentTypeByExt[strings.ToLower(filepath.Ext(name))]
}

// Subtitle is a detected sidecar subtitle file for a video.
type Subtitle struct {
	Name  string `json:"name"`  // file name (used as the ?sub= value)
	Label string `json:"label"` // human label, e.g. "en" or "Subtitles"
}

var subtitleExts = map[string]bool{".srt": true, ".vtt": true}

// DetectSubtitles finds subtitle files sitting next to videoPath whose name
// starts with the video's base name — e.g. for film.mp4: film.srt, film.en.srt,
// film.id.vtt. The middle segment (en/id/...) becomes the track label.
func DetectSubtitles(videoPath string) []Subtitle {
	dir := filepath.Dir(videoPath)
	base := strings.TrimSuffix(filepath.Base(videoPath), filepath.Ext(videoPath))
	baseLower := strings.ToLower(base)

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var subs []Subtitle
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if !subtitleExts[ext] {
			continue
		}
		nameNoExt := strings.TrimSuffix(e.Name(), filepath.Ext(e.Name()))
		if !strings.HasPrefix(strings.ToLower(nameNoExt), baseLower) {
			continue
		}
		label := strings.TrimPrefix(strings.ToLower(nameNoExt), baseLower)
		label = strings.Trim(label, ". _-")
		if label == "" {
			label = "Subtitles"
		}
		subs = append(subs, Subtitle{Name: e.Name(), Label: label})
	}
	return subs
}

// isDetectedSubtitle whitelists a requested subtitle name against what
// DetectSubtitles would return for videoPath, so a public/authenticated
// subtitle request can't be pointed at an arbitrary file.
func isDetectedSubtitle(videoPath, subName string) bool {
	if subName != filepath.Base(subName) {
		return false // no path separators allowed
	}
	for _, s := range DetectSubtitles(videoPath) {
		if s.Name == subName {
			return true
		}
	}
	return false
}

// SubtitleVTT reads a sidecar subtitle sitting next to videoPath (validated by
// isDetectedSubtitle) and returns it as WebVTT. .vtt is returned as-is; .srt is
// converted on the fly (browsers can't load .srt into <track> natively).
func SubtitleVTT(videoPath, subName string) (string, error) {
	if !isDetectedSubtitle(videoPath, subName) {
		return "", errRestricted
	}
	full := filepath.Join(filepath.Dir(videoPath), subName)
	raw, err := os.ReadFile(full)
	if err != nil {
		return "", err
	}
	text := strings.TrimPrefix(string(raw), "\uFEFF")
	if strings.EqualFold(filepath.Ext(subName), ".vtt") {
		return text, nil
	}
	return srtToVTT(text), nil
}

var srtTimestamp = regexp.MustCompile(`(\d{2}:\d{2}:\d{2}),(\d{3})`)

// srtToVTT converts SubRip (.srt) text to WebVTT: prepend the WEBVTT header and
// change the comma in cue timestamps (00:00:01,000) to a period (00:00:01.000).
func srtToVTT(srt string) string {
	srt = strings.ReplaceAll(srt, "\r\n", "\n")
	converted := srtTimestamp.ReplaceAllString(srt, "$1.$2")
	return "WEBVTT\n\n" + converted
}

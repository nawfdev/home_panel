package files

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const sharesSettingKey = "fileShares"

// ShareRecord is a public, unauthenticated link to a file or folder inside the
// allowed roots. ExpiresAt == 0 means it never expires (revoke to remove).
type ShareRecord struct {
	Token     string `json:"token"`
	Path      string `json:"path"` // absolute path, already validated by SafePath at creation
	Name      string `json:"name"`
	IsDir     bool   `json:"isDir"`
	CreatedAt int64  `json:"createdAt"` // unix ms
	ExpiresAt int64  `json:"expiresAt"` // unix ms, 0 = never
}

func (s *Service) loadShares() []ShareRecord {
	if s.store == nil {
		return nil
	}
	v, ok := s.store.GetSetting(sharesSettingKey)
	if !ok {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	var out []ShareRecord
	_ = json.Unmarshal(b, &out)
	return out
}

func (s *Service) saveShares(shares []ShareRecord) error {
	if s.store == nil {
		return errShareUnavailable
	}
	return s.store.SetSetting(sharesSettingKey, shares)
}

// CreateShare validates the path, generates a token, and persists a share.
// ttl is a duration in seconds; 0 means never expires.
func (s *Service) CreateShare(userPath string, ttlSeconds int64) (ShareRecord, error) {
	fullPath, err := SafePath(userPath)
	if err != nil {
		return ShareRecord{}, err
	}
	info, err := os.Stat(fullPath)
	if os.IsNotExist(err) {
		return ShareRecord{}, errPathNotFound
	}
	if err != nil {
		return ShareRecord{}, err
	}

	tokBytes := make([]byte, 16)
	if _, err := rand.Read(tokBytes); err != nil {
		return ShareRecord{}, err
	}
	now := time.Now()
	rec := ShareRecord{
		Token:     hex.EncodeToString(tokBytes),
		Path:      fullPath,
		Name:      filepath.Base(fullPath),
		IsDir:     info.IsDir(),
		CreatedAt: now.UnixMilli(),
	}
	if ttlSeconds > 0 {
		rec.ExpiresAt = now.Add(time.Duration(ttlSeconds) * time.Second).UnixMilli()
	}

	shares := append(s.loadShares(), rec)
	if err := s.saveShares(shares); err != nil {
		return ShareRecord{}, err
	}
	return rec, nil
}

// ListShares returns all non-expired shares, pruning expired ones as a
// side effect so the list stays tidy.
func (s *Service) ListShares() []ShareRecord {
	now := time.Now().UnixMilli()
	all := s.loadShares()
	live := make([]ShareRecord, 0, len(all))
	changed := false
	for _, r := range all {
		if r.ExpiresAt != 0 && r.ExpiresAt < now {
			changed = true
			continue
		}
		live = append(live, r)
	}
	if changed {
		_ = s.saveShares(live)
	}
	return live
}

func (s *Service) RevokeShare(token string) error {
	all := s.loadShares()
	out := make([]ShareRecord, 0, len(all))
	found := false
	for _, r := range all {
		if r.Token == token {
			found = true
			continue
		}
		out = append(out, r)
	}
	if !found {
		return errShareNotFound
	}
	return s.saveShares(out)
}

// ResolveShare looks up a live share by token and returns it. Expired or
// unknown tokens return an error. The caller then serves rec.Path (or a
// sub-path under it, via SharedSubPath).
func (s *Service) ResolveShare(token string) (ShareRecord, error) {
	if token == "" {
		return ShareRecord{}, errShareNotFound
	}
	now := time.Now().UnixMilli()
	for _, r := range s.loadShares() {
		if r.Token == token {
			if r.ExpiresAt != 0 && r.ExpiresAt < now {
				return ShareRecord{}, errShareExpired
			}
			return r, nil
		}
	}
	return ShareRecord{}, errShareNotFound
}

// SharedSubPath resolves relPath *within* a shared folder, refusing any path
// that escapes the shared root (path-traversal guard). Returns the absolute
// on-disk path and whether it's a directory.
func (s *Service) SharedSubPath(rec ShareRecord, relPath string) (string, os.FileInfo, error) {
	if !rec.IsDir {
		// a file share ignores any sub-path
		info, err := os.Stat(rec.Path)
		return rec.Path, info, err
	}
	clean := filepath.Clean("/" + strings.TrimPrefix(relPath, "/")) // force-absolute then treat as relative
	target := filepath.Join(rec.Path, clean)
	root := filepath.Clean(rec.Path)
	if target != root && !strings.HasPrefix(target, root+string(filepath.Separator)) {
		return "", nil, errRestricted
	}
	info, err := os.Stat(target)
	if err != nil {
		return "", nil, err
	}
	return target, info, nil
}

// PublicListingHTML renders a minimal, self-contained directory listing for a
// shared folder — no external assets (CSP-safe), links relative to the current
// share URL.
func PublicListingHTML(shareBaseURL, relPath, dirName string, entries []os.DirEntry) string {
	var b strings.Builder
	title := dirName
	if relPath != "" {
		title = dirName + "/" + strings.Trim(relPath, "/")
	}
	b.WriteString("<!doctype html><html><head><meta charset=\"utf-8\">")
	b.WriteString("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">")
	b.WriteString("<title>")
	b.WriteString(htmlEscape(title))
	b.WriteString("</title><style>")
	b.WriteString("body{font-family:system-ui,sans-serif;background:#0b1220;color:#e5e7eb;margin:0;padding:24px}")
	b.WriteString("h1{font-size:16px;color:#9ca3af;font-weight:600;word-break:break-all}")
	b.WriteString("a{color:#60a5fa;text-decoration:none}a:hover{text-decoration:underline}")
	b.WriteString("ul{list-style:none;padding:0;max-width:720px}")
	b.WriteString("li{padding:10px 12px;background:rgba(255,255,255,.04);border-radius:8px;margin-bottom:6px;display:flex;justify-content:space-between;gap:12px}")
	b.WriteString(".sz{color:#6b7280;font-size:12px;white-space:nowrap}")
	b.WriteString("</style></head><body>")
	b.WriteString("<h1>📁 ")
	b.WriteString(htmlEscape(title))
	b.WriteString("</h1><ul>")
	base := strings.TrimRight(shareBaseURL, "/")
	rel := strings.Trim(relPath, "/")
	if rel != "" {
		parent := rel[:strings.LastIndex("/"+rel, "/")]
		parentURL := base
		if strings.Trim(parent, "/") != "" {
			parentURL = base + "/" + strings.Trim(parent, "/")
		}
		b.WriteString("<li><a href=\"" + htmlEscape(parentURL) + "\">⬆ ..</a><span class=\"sz\"></span></li>")
	}
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		childRel := e.Name()
		if rel != "" {
			childRel = rel + "/" + e.Name()
		}
		href := base + "/" + childRel
		icon := "📄"
		size := formatSize(info.Size())
		if e.IsDir() {
			icon = "📁"
			size = ""
		}
		b.WriteString("<li><a href=\"")
		b.WriteString(htmlEscape(href))
		b.WriteString("\">")
		b.WriteString(icon + " " + htmlEscape(e.Name()))
		b.WriteString("</a><span class=\"sz\">")
		b.WriteString(size)
		b.WriteString("</span></li>")
	}
	b.WriteString("</ul></body></html>")
	return b.String()
}

func htmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&#39;")
	return r.Replace(s)
}

func formatSize(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for x := n / unit; x >= unit; x /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}

var (
	errShareUnavailable = errors.New("File sharing storage unavailable")
	errShareNotFound    = errors.New("Share not found")
	errShareExpired     = errors.New("This share link has expired")
)

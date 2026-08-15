package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/nawfdev/home-panel/internal/audit"
	filesvc "github.com/nawfdev/home-panel/internal/files"
	"github.com/nawfdev/home-panel/internal/httpx"
)

// Files ports backend/routes/files.js.
type Files struct {
	Svc   *filesvc.Service
	Audit *audit.Logger
}

func (f *Files) List(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
		Host int    `json:"host"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	var path string
	var items any
	var err error
	if req.Host != 0 {
		path, items, err = f.Svc.ListRemote(req.Host, req.Path)
	} else {
		path, items, err = f.Svc.List(req.Path)
	}
	if err != nil {
		fileError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "path": path, "items": items})
}

func (f *Files) Read(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
		Host int    `json:"host"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	var content string
	var err error
	if req.Host != 0 {
		content, err = f.Svc.ReadRemote(req.Host, req.Path)
	} else {
		content, err = f.Svc.Read(req.Path)
	}
	if err != nil {
		fileError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "content": content})
}

func (f *Files) Write(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
		Host    int    `json:"host"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	var err error
	if req.Host != 0 {
		err = f.Svc.WriteRemote(req.Host, req.Path, req.Content)
	} else {
		err = f.Svc.Write(req.Path, req.Content)
	}
	if err != nil {
		f.Audit.Record(r, "file.write", req.Path, req.Host, "failure", err.Error())
	} else {
		f.Audit.Record(r, "file.write", req.Path, req.Host, "success", "")
	}
	if err != nil {
		fileError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "File saved"})
}

func (f *Files) Delete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
		Host int    `json:"host"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	var err error
	if req.Host != 0 {
		err = f.Svc.DeleteRemote(req.Host, req.Path)
	} else {
		err = f.Svc.Delete(req.Path)
	}
	if err != nil {
		f.Audit.Record(r, "file.delete", req.Path, req.Host, "failure", err.Error())
	} else {
		f.Audit.Record(r, "file.delete", req.Path, req.Host, "success", "")
	}
	if err != nil {
		fileError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Deleted successfully"})
}

func (f *Files) Download(w http.ResponseWriter, r *http.Request) {
	hostID, _ := strconv.Atoi(r.URL.Query().Get("host"))
	path := r.URL.Query().Get("path")
	if hostID != 0 {
		rc, size, err := f.Svc.OpenRemote(hostID, path)
		if err != nil {
			fileError(w, err)
			return
		}
		defer rc.Close()
		if ct := filesvc.ContentTypeFor(path); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
		w.Header().Set("Content-Disposition", "attachment; filename=\""+filepath.Base(path)+"\"")
		_, _ = io.Copy(w, rc)
		return
	}
	fullPath, err := f.Svc.DownloadPath(path)
	if err != nil {
		fileError(w, err)
		return
	}
	// ?audio=<AudioTrack.Index> switches which embedded audio track plays —
	// only the in-panel player's <video> ever sends this; the Download
	// button's href never does, so downloads always get the original file.
	if audioParam := r.URL.Query().Get("audio"); audioParam != "" {
		if idx, perr := strconv.Atoi(audioParam); perr == nil {
			if variant, verr := f.Svc.MediaAudioVariant(path, idx); verr == nil {
				fullPath = variant
			}
		}
	}
	if ct := filesvc.ContentTypeFor(fullPath); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	http.ServeFile(w, r, fullPath)
}

func (f *Files) Upload(w http.ResponseWriter, r *http.Request) {
	maxBytes := f.Svc.MaxUploadBytes()
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes+1024*1024)
	// Keep only a small slice in memory; anything larger spills to temp files
	// on disk, so a multi-hundred-MB video upload doesn't buffer in RAM.
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "Upload failed or exceeds the size limit"})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "No file uploaded"})
		return
	}
	_ = file.Close()
	hostID, _ := strconv.Atoi(r.FormValue("host"))
	if hostID != 0 {
		err = f.Svc.UploadRemote(hostID, r.FormValue("path"), header)
	} else {
		err = f.Svc.Upload(r.FormValue("path"), header)
	}
	target := filepath.Join(r.FormValue("path"), header.Filename)
	if err != nil {
		f.Audit.Record(r, "file.upload", target, hostID, "failure", err.Error())
	} else {
		f.Audit.Record(r, "file.upload", target, hostID, "success", "")
	}
	if err != nil {
		fileError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "File uploaded"})
}

// ---- In-panel media player (authenticated) ----

func (f *Files) MediaInfo(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	mt, subs, audio, path, err := f.Svc.MediaInfo(req.Path)
	if err != nil {
		fileError(w, err)
		return
	}
	if subs == nil {
		subs = []filesvc.Subtitle{}
	}
	if audio == nil {
		audio = []filesvc.AudioTrack{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "type": mt, "subtitles": subs, "audioTracks": audio, "path": path})
}

func (f *Files) Subtitle(w http.ResponseWriter, r *http.Request) {
	vtt, err := f.Svc.SubtitleForPath(r.URL.Query().Get("path"), r.URL.Query().Get("name"))
	if err != nil {
		http.Error(w, "Subtitle not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/vtt; charset=utf-8")
	_, _ = w.Write([]byte(vtt))
}

// ---- Share management (authenticated) ----

func (f *Files) CreateShare(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path       string `json:"path"`
		TTLSeconds int64  `json:"ttlSeconds"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	rec, err := f.Svc.CreateShare(req.Path, req.TTLSeconds)
	if err != nil {
		fileError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "share": rec})
}

func (f *Files) ListShares(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "shares": f.Svc.ListShares()})
}

func (f *Files) RevokeShare(w http.ResponseWriter, r *http.Request) {
	if err := f.Svc.RevokeShare(chi.URLParam(r, "token")); err != nil {
		fileError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Share revoked"})
}

// ---- Public share serving (NO auth) ----

// ServePublicShare serves a shared file directly, or for a shared folder either
// a directory listing (HTML) or a file within it, guarding against path
// traversal outside the shared root.
func (f *Files) ServePublicShare(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	rec, err := f.Svc.ResolveShare(token)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	relPath := chi.URLParam(r, "*")

	target, info, err := f.Svc.SharedSubPath(rec, relPath)
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	if info.IsDir() {
		entries, err := os.ReadDir(target)
		if err != nil {
			http.Error(w, "Cannot read directory", http.StatusInternalServerError)
			return
		}
		shareBase := "/share/" + token
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(filesvc.PublicListingHTML(shareBase, relPath, rec.Name, entries)))
		return
	}

	q := r.URL.Query()
	// ?sub=<name> serves a detected sidecar subtitle as WebVTT.
	if sub := q.Get("sub"); sub != "" {
		vtt, err := filesvc.SubtitleVTT(target, sub)
		if err != nil {
			http.Error(w, "Subtitle not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/vtt; charset=utf-8")
		_, _ = w.Write([]byte(vtt))
		return
	}
	// ?raw=1 serves the raw bytes (range-enabled for video seeking); without it,
	// a media file gets the player page and any other file gets a themed
	// download landing page instead of an immediate download. ?raw=1&web=1
	// serves a web-compat sibling instead of target, and ?raw=1&audio=<N>
	// serves a sibling remuxed down to embedded audio track N — both only
	// ever requested by the player's own <video> src, never the Download
	// button/link, so downloads always get the original bytes.
	if q.Get("raw") != "1" {
		if mt := filesvc.MediaType(info.Name()); mt != "" {
			var subs []filesvc.Subtitle
			var audioTracks []filesvc.AudioTrack
			videoSrc := r.URL.Path + "?raw=1"
			if mt == "video" {
				_ = filesvc.ExtractEmbeddedSubtitles(target)
				subs = filesvc.DetectSubtitles(target)
				audioTracks = filesvc.DetectAudioTracks(target)
				if playable, werr := filesvc.EnsureWebPlayable(target); werr == nil && playable != target {
					videoSrc = r.URL.Path + "?raw=1&web=1"
				}
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(filesvc.PlayerHTML(mt, r.URL.Path, videoSrc, info.Name(), info.Size(), info.ModTime(), subs, audioTracks, httpx.CSPNonce(r))))
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(filesvc.DownloadPageHTML(r.URL.Path, info.Name(), info.Size(), info.ModTime(), httpx.CSPNonce(r))))
		return
	}
	if audioParam := q.Get("audio"); audioParam != "" {
		if idx, perr := strconv.Atoi(audioParam); perr == nil {
			if variant, verr := filesvc.EnsureWebPlayableAudio(target, idx); verr == nil {
				target = variant
			}
		}
	} else if q.Get("web") == "1" {
		if playable, werr := filesvc.EnsureWebPlayable(target); werr == nil {
			target = playable
		}
	}
	if ct := filesvc.ContentTypeFor(target); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	http.ServeFile(w, r, target)
}

func fileError(w http.ResponseWriter, err error) {
	msg := err.Error()
	status := http.StatusForbidden
	if strings.Contains(msg, "not found") || strings.Contains(msg, "File not found") {
		status = http.StatusNotFound
	} else if strings.Contains(msg, "Not a directory") || strings.Contains(msg, "Cannot read directory") || strings.Contains(msg, "too large") || strings.Contains(msg, "No file uploaded") {
		status = http.StatusBadRequest
	}
	httpx.JSON(w, status, map[string]any{"success": false, "error": msg})
}

package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	filesvc "github.com/kaysa/home-panel/internal/files"
	"github.com/kaysa/home-panel/internal/httpx"
)

// Files ports backend/routes/files.js.
type Files struct {
	Svc *filesvc.Service
}

func (f *Files) List(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	path, items, err := f.Svc.List(req.Path)
	if err != nil {
		fileError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "path": path, "items": items})
}

func (f *Files) Read(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	content, err := f.Svc.Read(req.Path)
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
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if err := f.Svc.Write(req.Path, req.Content); err != nil {
		fileError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "File saved"})
}

func (f *Files) Delete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if err := f.Svc.Delete(req.Path); err != nil {
		fileError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Deleted successfully"})
}

func (f *Files) Download(w http.ResponseWriter, r *http.Request) {
	fullPath, err := f.Svc.DownloadPath(r.URL.Query().Get("path"))
	if err != nil {
		fileError(w, err)
		return
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
	if err := f.Svc.Upload(r.FormValue("path"), header); err != nil {
		fileError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "File uploaded"})
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

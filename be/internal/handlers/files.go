package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

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
	r.Body = http.MaxBytesReader(w, r.Body, filesvc.MaxUploadSize+1024*1024)
	if err := r.ParseMultipartForm(filesvc.MaxUploadSize); err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "No file uploaded"})
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

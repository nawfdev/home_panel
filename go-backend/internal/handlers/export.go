package handlers

import (
	"archive/zip"
	"context"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kaysa/home-panel/internal/httpx"
)

// Export ports backend/routes/export.js: stream a project directory as a zip,
// excluding heavy/secret paths. Source path comes from PM2 cwd or a Docker bind mount.
type Export struct{}

// excludedDirs / excludedFiles mirror EXCLUDE_PATTERNS in export.js.
var excludedDirs = map[string]bool{
	"node_modules": true, ".git": true, "dist": true, "build": true,
	".next": true, "__pycache__": true, ".cache": true, "coverage": true,
	".nyc_output": true, "vendor": true, "venv": true, ".venv": true,
	".idea": true, ".vscode": true,
}

func isExcluded(rel string) bool {
	for _, seg := range strings.Split(filepath.ToSlash(rel), "/") {
		if excludedDirs[seg] {
			return true
		}
	}
	base := filepath.Base(rel)
	return base == ".env" || strings.HasSuffix(base, ".log")
}

func (Export) pm2Path(ctx context.Context, name string) string {
	out, err := exec.CommandContext(ctx, "pm2", "jlist").Output()
	if err != nil {
		return ""
	}
	var procs []struct {
		Name   string `json:"name"`
		PM2Env struct {
			PmCwd string `json:"pm_cwd"`
		} `json:"pm2_env"`
	}
	if json.Unmarshal(out, &procs) != nil {
		return ""
	}
	for _, p := range procs {
		if p.Name == name {
			return p.PM2Env.PmCwd
		}
	}
	return ""
}

func (Export) dockerMount(ctx context.Context, id string) string {
	out, err := exec.CommandContext(ctx, "docker", "inspect", id, "--format", "{{json .Mounts}}").Output()
	if err != nil {
		return ""
	}
	var mounts []struct {
		Type   string `json:"Type"`
		Source string `json:"Source"`
	}
	if json.Unmarshal(out, &mounts) != nil {
		return ""
	}
	for _, m := range mounts {
		if m.Type == "bind" {
			return m.Source
		}
	}
	return ""
}

func streamZip(w http.ResponseWriter, root, zipName string) {
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+zipName+`"`)
	zw := zip.NewWriter(w)
	defer zw.Close()

	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, rerr := filepath.Rel(root, path)
		if rerr != nil || rel == "." {
			return nil
		}
		if isExcluded(rel) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		f, oerr := os.Open(path)
		if oerr != nil {
			return nil
		}
		defer f.Close()
		hw, herr := zw.Create(filepath.ToSlash(rel))
		if herr != nil {
			return nil
		}
		_, _ = io.Copy(hw, f)
		return nil
	})
}

func (e Export) PM2(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	name := chi.URLParam(r, "name")
	path := e.pm2Path(ctx, name)
	if _, err := os.Stat(path); path == "" || err != nil {
		httpx.JSON(w, http.StatusNotFound, map[string]interface{}{
			"success": false, "error": "Project path not found. Make sure the PM2 process is running."})
		return
	}
	streamZip(w, path, name+"-"+timestamp()+".zip")
}

func (e Export) Docker(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	id := chi.URLParam(r, "id")
	path := e.dockerMount(ctx, id)
	if path == "" {
		httpx.JSON(w, http.StatusNotFound, map[string]interface{}{
			"success": false, "error": "No bind mount found or path doesn't exist. Container might be using volumes instead of bind mounts."})
		return
	}
	short := id
	if len(short) > 12 {
		short = short[:12]
	}
	streamZip(w, path, "docker-"+short+"-"+timestamp()+".zip")
}

func timestamp() string { return time.Now().Format("20060102150405") }

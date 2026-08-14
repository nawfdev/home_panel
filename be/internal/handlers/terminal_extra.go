package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/sshmgr"
	"github.com/nawfdev/home-panel/internal/store"
)

type TerminalExtra struct {
	Store *store.Store
	SSH   *sshmgr.Manager
}

type CustomSnippet struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Cmd         string `json:"cmd"`
	Category    string `json:"category,omitempty"`
	Description string `json:"description,omitempty"`
}

const snippetsSettingKey = "customSnippets"

func (h *TerminalExtra) Upload(w http.ResponseWriter, r *http.Request) {
	// 100 MB max upload for terminal files (scripts, configs, tar archives)
	if err := r.ParseMultipartForm(100 << 20); err != nil {
		httpx.Error(w, http.StatusBadRequest, "File too large (max 100MB)")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "File is required")
		return
	}
	defer file.Close()

	hostID := 0
	if rawHost := r.FormValue("hostId"); rawHost != "" {
		if parsed, err := strconv.Atoi(rawHost); err == nil {
			hostID = parsed
		}
	}

	destDir := strings.TrimSpace(r.FormValue("destDir"))
	if destDir == "" {
		if runtime.GOOS == "windows" && hostID == 0 {
			destDir = `C:\Users`
		} else {
			destDir = "/root"
		}
	}

	fileName := filepath.Base(header.Filename)
	destPath := filepath.Join(destDir, fileName)

	// Local host upload
	if hostID == 0 {
		if err := os.MkdirAll(destDir, 0o755); err != nil {
			// fallback to /tmp or current dir if /root is restricted
			destPath = filepath.Join("/tmp", fileName)
		}
		out, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
		if err != nil {
			// try /tmp fallback
			destPath = filepath.Join("/tmp", fileName)
			out, err = os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
			if err != nil {
				httpx.Error(w, http.StatusInternalServerError, "Failed to save file: "+err.Error())
				return
			}
		}
		defer out.Close()

		written, err := io.Copy(out, file)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "Write error: "+err.Error())
			return
		}

		httpx.JSON(w, http.StatusOK, map[string]any{
			"success":  true,
			"fileName": fileName,
			"path":     destPath,
			"size":     written,
			"hostId":   0,
		})
		return
	}

	// Remote SSH host SFTP upload
	host, ok := h.Store.GetHost(hostID)
	if !ok {
		httpx.Error(w, http.StatusNotFound, "Host not found")
		return
	}

	sftpClient, err := h.SSH.SFTPClient(host)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "SFTP connection failed: "+err.Error())
		return
	}
	defer sftpClient.Close()

	remoteDestPath := destDir + "/" + fileName
	remoteFile, err := sftpClient.Create(remoteDestPath)
	if err != nil {
		// Fallback to /tmp on remote host
		remoteDestPath = "/tmp/" + fileName
		remoteFile, err = sftpClient.Create(remoteDestPath)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "SFTP create file error: "+err.Error())
			return
		}
	}
	defer remoteFile.Close()

	written, err := io.Copy(remoteFile, file)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "SFTP write error: "+err.Error())
		return
	}

	_ = sftpClient.Chmod(remoteDestPath, 0o755)

	httpx.JSON(w, http.StatusOK, map[string]any{
		"success":  true,
		"fileName": fileName,
		"path":     remoteDestPath,
		"size":     written,
		"hostId":   hostID,
	})
}

// --- Custom Snippets Manager ---

func (h *TerminalExtra) ListSnippets(w http.ResponseWriter, r *http.Request) {
	v, ok := h.Store.GetSetting(snippetsSettingKey)
	if !ok || v == nil {
		httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "snippets": []CustomSnippet{}})
		return
	}
	data, _ := json.Marshal(v)
	var list []CustomSnippet
	_ = json.Unmarshal(data, &list)
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "snippets": list})
}

func (h *TerminalExtra) SaveSnippet(w http.ResponseWriter, r *http.Request) {
	var body CustomSnippet
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Error(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if strings.TrimSpace(body.Label) == "" || strings.TrimSpace(body.Cmd) == "" {
		httpx.Error(w, http.StatusBadRequest, "Label and command are required")
		return
	}

	v, _ := h.Store.GetSetting(snippetsSettingKey)
	var list []CustomSnippet
	if v != nil {
		data, _ := json.Marshal(v)
		_ = json.Unmarshal(data, &list)
	}

	if body.ID == "" {
		body.ID = fmt.Sprintf("snip-%d", os.Getpid()+len(list)+1)
		list = append(list, body)
	} else {
		found := false
		for i := range list {
			if list[i].ID == body.ID {
				list[i] = body
				found = true
				break
			}
		}
		if !found {
			list = append(list, body)
		}
	}

	if err := h.Store.SetSetting(snippetsSettingKey, list); err != nil {
		httpx.Error(w, http.StatusInternalServerError, err.Error())
		return
	}

	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "snippet": body})
}

func (h *TerminalExtra) DeleteSnippet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	v, _ := h.Store.GetSetting(snippetsSettingKey)
	var list []CustomSnippet
	if v != nil {
		data, _ := json.Marshal(v)
		_ = json.Unmarshal(data, &list)
	}

	filtered := make([]CustomSnippet, 0, len(list))
	for _, snip := range list {
		if snip.ID != id {
			filtered = append(filtered, snip)
		}
	}

	_ = h.Store.SetSetting(snippetsSettingKey, filtered)
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true})
}

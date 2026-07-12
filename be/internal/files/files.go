// Package files ports backend/routes/files.js with the same conservative path
// allowlist and response shapes.
package files

import (
	"errors"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/kaysa/home-panel/internal/store"
)

const (
	MaxReadSize = 1024 * 1024
	// defaultMaxUploadMb is the fallback upload cap when the operator hasn't
	// set one in Settings. Uploads used to be hard-capped at 10MB, which
	// rejected most videos/photos.
	defaultMaxUploadMb = 500
)

type Service struct {
	store *store.Store
}

func New(st *store.Store) *Service { return &Service{store: st} }

// MaxUploadBytes returns the configured upload cap in bytes (default 500MB).
func (s *Service) MaxUploadBytes() int64 {
	mb := int64(defaultMaxUploadMb)
	if s.store != nil {
		if v, ok := s.store.GetSetting("fileManager"); ok {
			if m, ok := v.(map[string]interface{}); ok {
				switch n := m["maxUploadMb"].(type) {
				case float64:
					if n > 0 {
						mb = int64(n)
					}
				case int:
					if n > 0 {
						mb = int64(n)
					}
				}
			}
		}
	}
	return mb * 1024 * 1024
}

type Item struct {
	Name        string    `json:"name"`
	Path        string    `json:"path"`
	IsDirectory bool      `json:"isDirectory"`
	Size        int64     `json:"size"`
	Modified    time.Time `json:"modified"`
}

func (s *Service) List(userPath string) (string, []Item, error) {
	fullPath, err := SafePath(userPath)
	if err != nil {
		return "", nil, err
	}
	info, err := os.Stat(fullPath)
	if os.IsNotExist(err) {
		return "", nil, errPathNotFound
	}
	if err != nil {
		return "", nil, err
	}
	if !info.IsDir() {
		return "", nil, errNotDirectory
	}
	entries, err := os.ReadDir(fullPath)
	if err != nil {
		return "", nil, err
	}
	items := make([]Item, 0, len(entries))
	for _, entry := range entries {
		itemPath := filepath.Join(fullPath, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}
		items = append(items, Item{Name: entry.Name(), Path: itemPath, IsDirectory: info.IsDir(), Size: info.Size(), Modified: info.ModTime()})
	}
	return fullPath, items, nil
}

func (s *Service) Read(userPath string) (string, error) {
	fullPath, err := SafePath(userPath)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(fullPath)
	if os.IsNotExist(err) {
		return "", errFileNotFound
	}
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", errReadDirectory
	}
	if info.Size() > MaxReadSize {
		return "", errFileTooLarge
	}
	b, err := os.ReadFile(fullPath)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (s *Service) Write(userPath, content string) error {
	fullPath, err := SafePath(userPath)
	if err != nil {
		return err
	}
	switch strings.ToLower(filepath.Ext(fullPath)) {
	case ".exe", ".dll", ".sys", ".bat", ".cmd", ".ps1":
		return errExecutableWrite
	}
	return os.WriteFile(fullPath, []byte(content), 0o644)
}

func (s *Service) Delete(userPath string) error {
	fullPath, err := SafePath(userPath)
	if err != nil {
		return err
	}
	info, err := os.Stat(fullPath)
	if os.IsNotExist(err) {
		return errPathNotFound
	}
	if err != nil {
		return err
	}
	if info.IsDir() {
		entries, err := os.ReadDir(fullPath)
		if err != nil {
			return err
		}
		if len(entries) > 100 {
			return errDirectoryTooLarge
		}
		return os.RemoveAll(fullPath)
	}
	return os.Remove(fullPath)
}

func (s *Service) DownloadPath(userPath string) (string, error) {
	fullPath, err := SafePath(userPath)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(fullPath)
	if os.IsNotExist(err) {
		return "", errFileNotFound
	}
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", errReadDirectory
	}
	return fullPath, nil
}

func (s *Service) Upload(dirPath string, header *multipart.FileHeader) error {
	fullPath, err := SafePath(dirPath)
	if err != nil {
		return err
	}
	info, err := os.Stat(fullPath)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errNotDirectory
	}
	if header == nil {
		return errNoUpload
	}
	maxBytes := s.MaxUploadBytes()
	if header.Size > maxBytes {
		return errUploadTooLarge
	}
	name := filepath.Base(header.Filename)
	if name == "." || name == string(filepath.Separator) || name == "" {
		return errNoUpload
	}
	src, err := header.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	dstPath := filepath.Join(fullPath, name)
	dst, err := os.OpenFile(dstPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer dst.Close()
	_, err = io.Copy(dst, io.LimitReader(src, maxBytes+1))
	return err
}

func SafePath(userPath string) (string, error) {
	if strings.TrimSpace(userPath) == "" || userPath == "/" {
		if runtime.GOOS == "windows" {
			return `C:\Users`, nil
		}
		return "/home", nil
	}
	fullPath := filepath.Clean(userPath)
	if !filepath.IsAbs(fullPath) {
		if runtime.GOOS == "windows" {
			fullPath = filepath.Join(`C:\`, fullPath)
		} else {
			fullPath = filepath.Join(`/`, fullPath)
		}
	}
	if !isPathSafe(fullPath) {
		return "", errRestricted
	}
	return fullPath, nil
}

func isPathSafe(fullPath string) bool {
	normalized := strings.ToLower(filepath.Clean(fullPath))
	// The panel commonly runs as root on Linux (it manages systemd/docker), in
	// which case /root is the admin's own home directory, not someone else's -
	// block it only when running unprivileged.
	runningAsRoot := runtime.GOOS != "windows" && os.Geteuid() == 0
	blocked := []string{"/etc/shadow", "/etc/passwd", `/sys`, `/proc`, `c:\windows\system32`, `c:\program files`}
	if !runningAsRoot {
		blocked = append(blocked, `/root`)
	}
	for _, p := range blocked {
		if strings.Contains(normalized, strings.ToLower(filepath.Clean(p))) {
			return false
		}
	}
	var safe []string
	if runtime.GOOS == "windows" {
		safe = []string{`C:\Users`, `C:\temp`, `C:\logs`}
	} else {
		safe = []string{"/home", "/tmp", "/var/log", "/opt"}
		if runningAsRoot {
			safe = append(safe, "/root")
		}
	}
	for _, base := range safe {
		baseClean := strings.ToLower(filepath.Clean(base))
		if normalized == baseClean || strings.HasPrefix(normalized, baseClean+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

var (
	errRestricted        = errors.New("Access to this path is restricted")
	errPathNotFound      = errors.New("Path not found")
	errFileNotFound      = errors.New("File not found")
	errNotDirectory      = errors.New("Not a directory")
	errReadDirectory     = errors.New("Cannot read directory")
	errFileTooLarge      = errors.New("File too large (max 1MB)")
	errExecutableWrite   = errors.New("Cannot write executable files")
	errDirectoryTooLarge = errors.New("Directory too large. Delete items individually.")
	errNoUpload          = errors.New("No file uploaded")
	errUploadTooLarge    = errors.New("File exceeds the upload size limit (adjust it in Settings)")
)

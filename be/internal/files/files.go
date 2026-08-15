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

	"github.com/pkg/sftp"

	"github.com/nawfdev/home-panel/internal/sshmgr"
	"github.com/nawfdev/home-panel/internal/store"
)

const (
	MaxReadSize = 1024 * 1024
	// defaultMaxUploadMb is the fallback upload cap when the operator hasn't
	// set one in Settings. Uploads used to be hard-capped at 10MB, which
	// rejected most videos/photos.
	defaultMaxUploadMb = 500
)

type Service struct {
	store  *store.Store
	sshMgr *sshmgr.Manager
}

func New(st *store.Store, sshMgr *sshmgr.Manager) *Service {
	return &Service{store: st, sshMgr: sshMgr}
}

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
	if err := os.Remove(fullPath); err != nil {
		return err
	}
	RemoveWebSiblings(fullPath)
	return nil
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
	if _, err = io.Copy(dst, io.LimitReader(src, maxBytes+1)); err != nil {
		return err
	}
	remuxFaststartAsync(dstPath)
	return nil
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
	errHostNotFound      = errors.New("Host not found")
)

// remoteSafePath validates userPath against the same allowlist SafePath uses,
// but always with POSIX semantics since every remote host managed here is
// Linux (matches STB/Ubuntu targets). It is pure string validation, so it is
// safe to run before any SFTP call without touching the local filesystem.
func remoteSafePath(userPath string) (string, error) {
	if strings.TrimSpace(userPath) == "" || userPath == "/" {
		return "/root", nil
	}
	fullPath := filepath.ToSlash(filepath.Clean(userPath))
	if !strings.HasPrefix(fullPath, "/") {
		fullPath = "/" + fullPath
	}
	normalized := strings.ToLower(fullPath)
	blocked := []string{"/etc/shadow", "/etc/passwd", "/sys", "/proc"}
	for _, p := range blocked {
		if strings.Contains(normalized, p) {
			return "", errRestricted
		}
	}
	safe := []string{"/home", "/tmp", "/var/log", "/opt", "/root"}
	for _, base := range safe {
		if normalized == base || strings.HasPrefix(normalized, base+"/") {
			return fullPath, nil
		}
	}
	return "", errRestricted
}

func (s *Service) sftpFor(hostID int) (*sftp.Client, error) {
	host, ok := s.store.GetHost(hostID)
	if !ok {
		return nil, errHostNotFound
	}
	return s.sshMgr.SFTPClient(host)
}

func (s *Service) ListRemote(hostID int, userPath string) (string, []Item, error) {
	fullPath, err := remoteSafePath(userPath)
	if err != nil {
		return "", nil, err
	}
	c, err := s.sftpFor(hostID)
	if err != nil {
		return "", nil, err
	}
	defer c.Close()
	info, err := c.Stat(fullPath)
	if os.IsNotExist(err) {
		return "", nil, errPathNotFound
	}
	if err != nil {
		return "", nil, err
	}
	if !info.IsDir() {
		return "", nil, errNotDirectory
	}
	entries, err := c.ReadDir(fullPath)
	if err != nil {
		return "", nil, err
	}
	items := make([]Item, 0, len(entries))
	for _, entry := range entries {
		items = append(items, Item{
			Name:        entry.Name(),
			Path:        filepath.ToSlash(filepath.Join(fullPath, entry.Name())),
			IsDirectory: entry.IsDir(),
			Size:        entry.Size(),
			Modified:    entry.ModTime(),
		})
	}
	return fullPath, items, nil
}

func (s *Service) ReadRemote(hostID int, userPath string) (string, error) {
	fullPath, err := remoteSafePath(userPath)
	if err != nil {
		return "", err
	}
	c, err := s.sftpFor(hostID)
	if err != nil {
		return "", err
	}
	defer c.Close()
	info, err := c.Stat(fullPath)
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
	f, err := c.Open(fullPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	b, err := io.ReadAll(f)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (s *Service) WriteRemote(hostID int, userPath, content string) error {
	fullPath, err := remoteSafePath(userPath)
	if err != nil {
		return err
	}
	switch strings.ToLower(filepath.Ext(fullPath)) {
	case ".exe", ".dll", ".sys", ".bat", ".cmd", ".ps1":
		return errExecutableWrite
	}
	c, err := s.sftpFor(hostID)
	if err != nil {
		return err
	}
	defer c.Close()
	f, err := c.Create(fullPath)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write([]byte(content))
	return err
}

func (s *Service) DeleteRemote(hostID int, userPath string) error {
	fullPath, err := remoteSafePath(userPath)
	if err != nil {
		return err
	}
	c, err := s.sftpFor(hostID)
	if err != nil {
		return err
	}
	defer c.Close()
	info, err := c.Stat(fullPath)
	if os.IsNotExist(err) {
		return errPathNotFound
	}
	if err != nil {
		return err
	}
	if info.IsDir() {
		entries, err := c.ReadDir(fullPath)
		if err != nil {
			return err
		}
		if len(entries) > 100 {
			return errDirectoryTooLarge
		}
		return c.RemoveAll(fullPath)
	}
	return c.Remove(fullPath)
}

// OpenRemote opens a remote file for streaming download. Callers must close
// both the returned ReadCloser and, via the second return value, the
// underlying SFTP client once done.
func (s *Service) OpenRemote(hostID int, userPath string) (io.ReadCloser, int64, error) {
	fullPath, err := remoteSafePath(userPath)
	if err != nil {
		return nil, 0, err
	}
	c, err := s.sftpFor(hostID)
	if err != nil {
		return nil, 0, err
	}
	info, err := c.Stat(fullPath)
	if os.IsNotExist(err) {
		c.Close()
		return nil, 0, errFileNotFound
	}
	if err != nil {
		c.Close()
		return nil, 0, err
	}
	if info.IsDir() {
		c.Close()
		return nil, 0, errReadDirectory
	}
	f, err := c.Open(fullPath)
	if err != nil {
		c.Close()
		return nil, 0, err
	}
	return &sftpFileCloser{File: f, client: c}, info.Size(), nil
}

type sftpFileCloser struct {
	*sftp.File
	client *sftp.Client
}

func (f *sftpFileCloser) Close() error {
	err := f.File.Close()
	f.client.Close()
	return err
}

func (s *Service) UploadRemote(hostID int, dirPath string, header *multipart.FileHeader) error {
	fullPath, err := remoteSafePath(dirPath)
	if err != nil {
		return err
	}
	if header == nil {
		return errNoUpload
	}
	maxBytes := s.MaxUploadBytes()
	if header.Size > maxBytes {
		return errUploadTooLarge
	}
	name := filepath.Base(header.Filename)
	if name == "." || name == "/" || name == "" {
		return errNoUpload
	}
	c, err := s.sftpFor(hostID)
	if err != nil {
		return err
	}
	defer c.Close()
	info, err := c.Stat(fullPath)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errNotDirectory
	}
	src, err := header.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := c.Create(filepath.ToSlash(filepath.Join(fullPath, name)))
	if err != nil {
		return err
	}
	defer dst.Close()
	_, err = io.Copy(dst, io.LimitReader(src, maxBytes+1))
	return err
}

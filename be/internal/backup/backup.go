// Package backup creates encrypted Nestcore configuration archives.
package backup

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"golang.org/x/crypto/pbkdf2"
)

var magic = []byte("NESTCORE-BACKUP-1\n")

type Service struct {
	root      string
	backupDir string
}

type Info struct {
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	CreatedAt string `json:"createdAt"`
}

func New(root string) *Service {
	return &Service{root: root, backupDir: filepath.Join(root, "data", "backups")}
}

func (s *Service) sourceFiles() []string {
	return []string{
		filepath.Join(s.root, "data", "db.json"),
		filepath.Join(s.root, "config", "config.json"),
		filepath.Join(s.root, "config", "settings.json"),
		filepath.Join(s.root, "data", "panel_id_ed25519"),
		filepath.Join(s.root, "data", "panel_id_ed25519.pub"),
	}
}

func archiveName() string { return "nestcore-" + time.Now().UTC().Format("20060102-150405") + ".ncb" }

func encrypt(plain []byte, password string) ([]byte, error) {
	if len(password) < 12 {
		return nil, errors.New("backup password must be at least 12 characters")
	}
	salt := make([]byte, 16)
	nonce := make([]byte, 12)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	key := pbkdf2.Key([]byte(password), salt, 210000, 32, sha256.New)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	ciphertext := gcm.Seal(nil, nonce, plain, magic)
	out := append([]byte(nil), magic...)
	out = append(out, salt...)
	out = append(out, nonce...)
	out = append(out, ciphertext...)
	return out, nil
}

func decrypt(payload []byte, password string) ([]byte, error) {
	minimum := len(magic) + 16 + 12
	if len(payload) < minimum || !bytes.Equal(payload[:len(magic)], magic) {
		return nil, errors.New("invalid Nestcore backup")
	}
	offset := len(magic)
	salt := payload[offset : offset+16]
	offset += 16
	nonce := payload[offset : offset+12]
	offset += 12
	key := pbkdf2.Key([]byte(password), salt, 210000, 32, sha256.New)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	plain, err := gcm.Open(nil, nonce, payload[offset:], magic)
	if err != nil {
		return nil, errors.New("incorrect password or corrupted backup")
	}
	return plain, nil
}

func (s *Service) Create(password string) (Info, error) {
	var raw bytes.Buffer
	zw := zip.NewWriter(&raw)
	for _, file := range s.sourceFiles() {
		content, err := os.ReadFile(file)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return Info{}, err
		}
		rel, err := filepath.Rel(s.root, file)
		if err != nil {
			return Info{}, err
		}
		header := &zip.FileHeader{Name: filepath.ToSlash(rel), Method: zip.Deflate}
		header.SetMode(0o600)
		entry, err := zw.CreateHeader(header)
		if err != nil {
			return Info{}, err
		}
		if _, err := entry.Write(content); err != nil {
			return Info{}, err
		}
	}
	if err := zw.Close(); err != nil {
		return Info{}, err
	}
	payload, err := encrypt(raw.Bytes(), password)
	if err != nil {
		return Info{}, err
	}
	if err := os.MkdirAll(s.backupDir, 0o700); err != nil {
		return Info{}, err
	}
	name := archiveName()
	path := filepath.Join(s.backupDir, name)
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		return Info{}, err
	}
	if err := s.applyRetention(); err != nil {
		return Info{}, err
	}
	return Info{Name: name, Size: int64(len(payload)), CreatedAt: time.Now().UTC().Format(time.RFC3339)}, nil
}

func (s *Service) List() ([]Info, error) {
	entries, err := os.ReadDir(s.backupDir)
	if os.IsNotExist(err) {
		return []Info{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []Info{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".ncb") {
			continue
		}
		info, err := entry.Info()
		if err == nil {
			out = append(out, Info{Name: entry.Name(), Size: info.Size(), CreatedAt: info.ModTime().UTC().Format(time.RFC3339)})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out, nil
}

func (s *Service) applyRetention() error {
	entries, err := s.List()
	if err != nil {
		return err
	}
	cutoff := time.Now().Add(-7 * 24 * time.Hour)
	for i, entry := range entries {
		created, _ := time.Parse(time.RFC3339, entry.CreatedAt)
		if i >= 7 || created.Before(cutoff) {
			if err := os.Remove(filepath.Join(s.backupDir, entry.Name)); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
	}
	return nil
}

func (s *Service) StartRetention(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = s.applyRetention()
			}
		}
	}()
}

func safeName(name string) bool {
	return filepath.Base(name) == name && strings.HasSuffix(name, ".ncb")
}

func (s *Service) Open(name string) (string, error) {
	if !safeName(name) {
		return "", errors.New("invalid backup name")
	}
	path := filepath.Join(s.backupDir, name)
	if _, err := os.Stat(path); err != nil {
		return "", err
	}
	return path, nil
}

func (s *Service) Restore(payload []byte, password string) error {
	plain, err := decrypt(payload, password)
	if err != nil {
		return err
	}
	reader, err := zip.NewReader(bytes.NewReader(plain), int64(len(plain)))
	if err != nil {
		return fmt.Errorf("read backup archive: %w", err)
	}
	allowed := map[string]bool{}
	for _, source := range s.sourceFiles() {
		rel, _ := filepath.Rel(s.root, source)
		allowed[filepath.ToSlash(rel)] = true
	}
	staged := map[string][]byte{}
	for _, entry := range reader.File {
		name := filepath.ToSlash(filepath.Clean(entry.Name))
		if !allowed[name] {
			return fmt.Errorf("backup contains unexpected path %q", name)
		}
		rc, err := entry.Open()
		if err != nil {
			return err
		}
		content, err := io.ReadAll(io.LimitReader(rc, 64<<20))
		_ = rc.Close()
		if err != nil {
			return err
		}
		staged[name] = content
	}
	if len(staged) == 0 {
		return errors.New("backup contains no restorable files")
	}
	for name, content := range staged {
		dest := filepath.Join(s.root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
			return err
		}
		tmp := dest + ".restore"
		if err := os.WriteFile(tmp, content, 0o600); err != nil {
			return err
		}
		if err := os.Rename(tmp, dest); err != nil {
			return err
		}
	}
	return nil
}

var _ = binary.BigEndian

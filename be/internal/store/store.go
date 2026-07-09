// Package store is a faithful port of the legacy backend/services/database.js.
// Despite the Node project depending on better-sqlite3, the real persistence is
// a single JSON file (data/db.json) with users, projects and settings. We keep
// the exact on-disk shape so existing data files remain compatible.
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

type Project struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Path      string `json:"path"`
	Port      int    `json:"port"`
	Domain    string `json:"domain"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
	Pid       int    `json:"pid,omitempty"`
}

type data struct {
	Users    []User                 `json:"users"`
	Projects []Project              `json:"projects"`
	Settings map[string]interface{} `json:"settings"`
}

// Store guards the in-memory data and syncs it to disk, exactly like the JS
// loadDb/saveDb pair but with a mutex for Go's concurrent request handling.
type Store struct {
	mu   sync.RWMutex
	file string
	d    data
}

// Open loads the JSON store from file (creating the parent dir if needed).
func Open(file string) (*Store, error) {
	s := &Store{
		file: file,
		d:    data{Settings: map[string]interface{}{}},
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return nil, err
	}
	if raw, err := os.ReadFile(file); err == nil {
		_ = json.Unmarshal(raw, &s.d)
		if s.d.Settings == nil {
			s.d.Settings = map[string]interface{}{}
		}
		_ = os.Chmod(file, 0o600) // tighten perms on files created before this was enforced
	}
	return s, nil
}

// save persists the current state. Caller must hold the write lock.
func (s *Store) save() error {
	raw, err := json.MarshalIndent(s.d, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.file, raw, 0o600)
}

// InitDefaultAdmin mirrors database.js initDefaultAdmin: seed admin only when no
// users exist, hashing the configured password unless it is already a bcrypt hash.
func (s *Store) InitDefaultAdmin(username, password string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.d.Users) > 0 {
		return nil
	}
	hashed := password
	if !strings.HasPrefix(password, "$2a$") && !strings.HasPrefix(password, "$2b$") {
		h, err := bcrypt.GenerateFromPassword([]byte(password), 10)
		if err != nil {
			return err
		}
		hashed = string(h)
	}
	if username == "" {
		username = "admin"
	}
	s.d.Users = []User{{ID: 1, Username: username, Password: hashed, Role: "admin"}}
	return s.save()
}

func (s *Store) GetUserByUsername(username string) (User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, u := range s.d.Users {
		if u.Username == username {
			return u, true
		}
	}
	return User{}, false
}

func (s *Store) GetUserByID(id int) (User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, u := range s.d.Users {
		if u.ID == id {
			return u, true
		}
	}
	return User{}, false
}

func (s *Store) UpdateUserPassword(id int, hashed string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Users {
		if s.d.Users[i].ID == id {
			s.d.Users[i].Password = hashed
			return s.save()
		}
	}
	return nil
}

func (s *Store) ListProjects() []Project {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Project, len(s.d.Projects))
	copy(out, s.d.Projects)
	return out
}

func (s *Store) GetProject(id int) (Project, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, p := range s.d.Projects {
		if p.ID == id {
			return p, true
		}
	}
	return Project{}, false
}

// InsertProject mirrors the JS id scheme (len+1) to keep behavior identical.
func (s *Store) InsertProject(p Project) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p.ID = len(s.d.Projects) + 1
	if p.Status == "" {
		p.Status = "stopped"
	}
	p.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	s.d.Projects = append(s.d.Projects, p)
	return p.ID, s.save()
}

func (s *Store) UpdateProject(id int, mutate func(*Project)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Projects {
		if s.d.Projects[i].ID == id {
			mutate(&s.d.Projects[i])
			return s.save()
		}
	}
	return nil
}

func (s *Store) DeleteProject(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Projects {
		if s.d.Projects[i].ID == id {
			s.d.Projects = append(s.d.Projects[:i], s.d.Projects[i+1:]...)
			return s.save()
		}
	}
	return nil
}

func (s *Store) GetSetting(key string) (interface{}, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.d.Settings[key]
	return v, ok
}

func (s *Store) SetSetting(key string, value interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.d.Settings[key] = value
	return s.save()
}

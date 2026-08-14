// Package store is a faithful port of the legacy backend/services/database.js.
// Despite the Node project depending on better-sqlite3, the real persistence is
// a single JSON file (data/db.json) with users, projects and settings. We keep
// the exact on-disk shape so existing data files remain compatible.
package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type Passkey struct {
	ID        string `json:"id"`
	Nickname  string `json:"nickname"`
	CredID    string `json:"cred_id"`
	PublicKey string `json:"public_key"`
	Counter   uint32 `json:"counter"`
	CreatedAt string `json:"created_at"`
	LastUsed  string `json:"last_used,omitempty"`
}

type User struct {
	ID            int       `json:"id"`
	Username      string    `json:"username"`
	Password      string    `json:"password"`
	Role          string    `json:"role"`
	TokenHash     string    `json:"token_hash,omitempty"`
	TOTPSecret    string    `json:"totp_secret,omitempty"`
	RecoveryCodes []string  `json:"recovery_codes,omitempty"`
	Passkeys      []Passkey `json:"passkeys,omitempty"`
	CreatedAt     string    `json:"created_at,omitempty"`
}

// Role is an admin-configurable preset of which feature keys its members may
// access. "admin" is seeded Locked and is also treated as a superuser
// independent of its Features list (see RequireFeature), so it stays fully
// capable even if its row is ever edited or deleted.
type Role struct {
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Features []string `json:"features"`
	Locked   bool     `json:"locked"`
}

// FeatureKeys are the panel modules a role can be granted. "dashboard" is
// intentionally absent — every authenticated user always sees it. Settings'
// advanced tabs and user/role management are hardcoded admin-only and never
// appear here, so they can never be handed out via a role checkbox.
var FeatureKeys = []string{
	"tunnel", "cloudflare", "network", "docker", "pm2", "services", "logs",
	"terminal", "remote-desktop", "files", "projects", "ai-gateway", "telegram", "movies", "tv",
}

// DefaultMemberFeatures is the conservative starting grant for the built-in
// "member" role; admins can widen or narrow it later from Settings.
var DefaultMemberFeatures = []string{"movies", "files", "network", "remote-desktop"}

// Project is the persisted hosting-site definition. Existing rows from the
// original local process manager remain valid: zero HostID means local and
// empty Type defaults to node at the service boundary.
type Project struct {
	ID              int       `json:"id"`
	Name            string    `json:"name"`
	HostID          int       `json:"host_id"`
	Type            string    `json:"type"`
	Path            string    `json:"path"`
	SourcePath      string    `json:"source_path,omitempty"`
	BuildCommand    string    `json:"build_command,omitempty"`
	StartCommand    string    `json:"start_command,omitempty"`
	PublishDir      string    `json:"publish_dir,omitempty"`
	Port            int       `json:"port,omitempty"`
	Domains         []string  `json:"domains"`
	AppliedDomains  []string  `json:"applied_domains,omitempty"`
	Domain          string    `json:"domain,omitempty"`
	TunnelID        string    `json:"tunnel_id,omitempty"`
	TunnelConfig    string    `json:"tunnel_config,omitempty"`
	TunnelService   string    `json:"tunnel_service,omitempty"`
	Status          string    `json:"status"`
	Health          string    `json:"health,omitempty"`
	CreatedAt       string    `json:"created_at"`
	LastDeployedAt  string    `json:"last_deployed_at,omitempty"`
	CurrentRelease  string    `json:"current_release,omitempty"`
	PreviousRelease string    `json:"previous_release,omitempty"`
	Releases        []Release `json:"releases,omitempty"`
	Pid             int       `json:"pid,omitempty"`
}

type Release struct {
	ID         string `json:"id"`
	Path       string `json:"path"`
	DeployedAt string `json:"deployed_at"`
}

// RemoteDevice is a saved peer (laptop/PC) running the remoteagent binary
// that the panel can hand off keyboard/mouse control of over the LAN. The
// token authenticates the browser's WebSocket connection directly to the
// agent — the panel backend never proxies the video/input stream.
type RemoteDevice struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Token     string `json:"token"`
	Notes     string `json:"notes,omitempty"`
	CreatedAt string `json:"created_at"`
}

// Host is a saved SSH target (e.g. a secondary STB/box) the panel can run
// terminal commands and browse files on, in addition to the machine it runs
// on itself (hostId 0 always means "local"). Authentication is key-only: the
// panel's own keypair (data/panel_id_ed25519) is installed into the target's
// authorized_keys once when the host is added, so no password or private key
// material for the remote box is ever persisted here.
type Host struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Address   string `json:"address"`
	Port      int    `json:"port"`
	User      string `json:"user"`
	CreatedAt string `json:"created_at"`
}

type data struct {
	Users         []User                 `json:"users"`
	Roles         []Role                 `json:"roles"`
	Projects      []Project              `json:"projects"`
	RemoteDevices []RemoteDevice         `json:"remote_devices"`
	Hosts         []Host                 `json:"hosts"`
	Settings      map[string]interface{} `json:"settings"`
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
		for i := range s.d.Projects {
			p := &s.d.Projects[i]
			if p.Type == "" {
				p.Type = "node"
			}
			if len(p.Domains) == 0 && p.Domain != "" {
				p.Domains = []string{p.Domain}
			}
		}
		_ = os.Chmod(file, 0o600) // tighten perms on files created before this was enforced
	}
	if len(s.d.Roles) == 0 {
		s.d.Roles = []Role{
			{ID: "admin", Label: "Admin", Features: append([]string{}, FeatureKeys...), Locked: true},
			{ID: "member", Label: "Member", Features: append([]string{}, DefaultMemberFeatures...), Locked: false},
		}
		if err := s.save(); err != nil {
			return nil, err
		}
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
	s.d.Users = []User{{ID: 1, Username: username, Password: hashed, Role: "admin", CreatedAt: time.Now().UTC().Format(time.RFC3339)}}
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

func (s *Store) ListRemoteDevices() []RemoteDevice {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]RemoteDevice, len(s.d.RemoteDevices))
	copy(out, s.d.RemoteDevices)
	return out
}

func (s *Store) GetRemoteDevice(id int) (RemoteDevice, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, d := range s.d.RemoteDevices {
		if d.ID == id {
			return d, true
		}
	}
	return RemoteDevice{}, false
}

// InsertRemoteDevice mirrors the InsertProject id scheme (len+1).
func (s *Store) InsertRemoteDevice(d RemoteDevice) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d.ID = len(s.d.RemoteDevices) + 1
	d.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	s.d.RemoteDevices = append(s.d.RemoteDevices, d)
	return d.ID, s.save()
}

func (s *Store) UpdateRemoteDevice(id int, mutate func(*RemoteDevice)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.RemoteDevices {
		if s.d.RemoteDevices[i].ID == id {
			mutate(&s.d.RemoteDevices[i])
			return s.save()
		}
	}
	return nil
}

func (s *Store) DeleteRemoteDevice(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.RemoteDevices {
		if s.d.RemoteDevices[i].ID == id {
			s.d.RemoteDevices = append(s.d.RemoteDevices[:i], s.d.RemoteDevices[i+1:]...)
			return s.save()
		}
	}
	return nil
}

func (s *Store) ListHosts() []Host {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Host, len(s.d.Hosts))
	copy(out, s.d.Hosts)
	return out
}

func (s *Store) GetHost(id int) (Host, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, h := range s.d.Hosts {
		if h.ID == id {
			return h, true
		}
	}
	return Host{}, false
}

// InsertHost mirrors the InsertRemoteDevice id scheme (len+1).
func (s *Store) InsertHost(h Host) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	h.ID = len(s.d.Hosts) + 1
	h.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	s.d.Hosts = append(s.d.Hosts, h)
	return h.ID, s.save()
}

func (s *Store) UpdateHost(h Host) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Hosts {
		if s.d.Hosts[i].ID == h.ID {
			s.d.Hosts[i] = h
			return s.save()
		}
	}
	return fmt.Errorf("host %d not found", h.ID)
}

func (s *Store) DeleteHost(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Hosts {
		if s.d.Hosts[i].ID == id {
			s.d.Hosts = append(s.d.Hosts[:i], s.d.Hosts[i+1:]...)
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

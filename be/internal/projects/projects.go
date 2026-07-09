// Package projects ports backend/services/projects.js: project CRUD backed by the
// JSON store plus lifecycle control of spawned `npm` dev processes.
package projects

import (
	"bufio"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"sync"
	"time"

	"github.com/kaysa/home-panel/internal/store"
)

// LogLine mirrors the {type, data, time} log objects from projects.js.
type LogLine struct {
	Type string `json:"type"`
	Data string `json:"data"`
	Time string `json:"time"`
}

type running struct {
	cmd  *exec.Cmd
	mu   sync.Mutex
	logs []LogLine
}

func (r *running) push(t, data string) {
	r.mu.Lock()
	r.logs = append(r.logs, LogLine{Type: t, Data: data, Time: time.Now().Format(time.RFC3339)})
	if len(r.logs) > 500 {
		r.logs = r.logs[len(r.logs)-500:]
	}
	r.mu.Unlock()
}

func (r *running) snapshot() []LogLine {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]LogLine, len(r.logs))
	copy(out, r.logs)
	return out
}

// Manager owns the running-process map and delegates persistence to the store.
type Manager struct {
	store   *store.Store
	mu      sync.Mutex
	running map[int]*running
}

func New(s *store.Store) *Manager {
	return &Manager{store: s, running: map[int]*running{}}
}

type Result struct {
	Success bool   `json:"success"`
	PID     int    `json:"pid,omitempty"`
	Message string `json:"message,omitempty"`
}

func (m *Manager) GetAll() []store.Project { return m.store.ListProjects() }

func (m *Manager) Get(id int) (store.Project, bool) { return m.store.GetProject(id) }

func (m *Manager) Add(name, path string, port int, domain string) (store.Project, error) {
	id, err := m.store.InsertProject(store.Project{Name: name, Path: path, Port: port, Domain: domain, Status: "stopped"})
	if err != nil {
		return store.Project{}, err
	}
	p, _ := m.store.GetProject(id)
	return p, nil
}

// Update applies a partial JSON body (name/path/port/domain/status) like the JS.
func (m *Manager) Update(id int, body map[string]interface{}) (store.Project, bool) {
	m.store.UpdateProject(id, func(p *store.Project) {
		if v, ok := body["name"].(string); ok {
			p.Name = v
		}
		if v, ok := body["path"].(string); ok {
			p.Path = v
		}
		if v, ok := body["port"].(float64); ok {
			p.Port = int(v)
		}
		if v, ok := body["domain"].(string); ok {
			p.Domain = v
		}
		if v, ok := body["status"].(string); ok {
			p.Status = v
		}
	})
	return m.store.GetProject(id)
}

func (m *Manager) Delete(id int) Result {
	if p, ok := m.store.GetProject(id); ok && p.Status == "running" {
		m.Stop(id)
	}
	m.store.DeleteProject(id)
	return Result{Success: true}
}

func (m *Manager) setStatus(id int, status string, pid int) {
	m.store.UpdateProject(id, func(p *store.Project) {
		p.Status = status
		p.Pid = pid
	})
}

// Start spawns the project's npm script with PORT set, capturing logs.
func (m *Manager) Start(id int) Result {
	p, ok := m.store.GetProject(id)
	if !ok {
		return Result{Success: false, Message: "Project not found"}
	}
	if _, err := os.Stat(p.Path); err != nil {
		return Result{Success: false, Message: "Project path does not exist"}
	}

	startCmd := "npm start"
	if pkgRaw, err := os.ReadFile(filepath.Join(p.Path, "package.json")); err == nil {
		var pkg struct {
			Scripts map[string]string `json:"scripts"`
		}
		if json.Unmarshal(pkgRaw, &pkg) == nil {
			if _, has := pkg.Scripts["start"]; has {
				startCmd = "npm start"
			} else if _, has := pkg.Scripts["dev"]; has {
				startCmd = "npm run dev"
			}
		}
	}

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd", "/c", startCmd)
	} else {
		cmd = exec.Command("sh", "-c", startCmd)
	}
	cmd.Dir = p.Path
	cmd.Env = append(os.Environ(), "PORT="+strconv.Itoa(p.Port))
	setDetached(cmd)

	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		return Result{Success: false, Message: err.Error()}
	}

	r := &running{cmd: cmd}
	go streamLogs(r, stdout, "stdout")
	go streamLogs(r, stderr, "stderr")

	m.mu.Lock()
	m.running[id] = r
	m.mu.Unlock()

	pid := cmd.Process.Pid
	m.setStatus(id, "running", pid)

	go func() {
		_ = cmd.Wait()
		m.mu.Lock()
		delete(m.running, id)
		m.mu.Unlock()
		m.setStatus(id, "stopped", 0)
	}()

	return Result{Success: true, PID: pid, Message: "Project " + p.Name + " started on port " + strconv.Itoa(p.Port)}
}

func streamLogs(r *running, rc interface{ Read([]byte) (int, error) }, kind string) {
	sc := bufio.NewScanner(rc)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		r.push(kind, sc.Text())
	}
}

func (m *Manager) Stop(id int) Result {
	m.mu.Lock()
	r, ok := m.running[id]
	m.mu.Unlock()
	if !ok {
		return Result{Success: false, Message: "Project is not running"}
	}
	if r.cmd.Process != nil {
		if err := killTree(r.cmd.Process.Pid); err != nil {
			_ = r.cmd.Process.Kill()
		}
	}
	m.mu.Lock()
	delete(m.running, id)
	m.mu.Unlock()
	m.setStatus(id, "stopped", 0)
	return Result{Success: true, Message: "Project stopped"}
}

func (m *Manager) Restart(id int) Result {
	m.Stop(id)
	return m.Start(id)
}

// StopAll terminates every project process spawned by this panel instance, so
// a panel restart doesn't orphan child npm/python/etc. processes still
// holding their ports.
func (m *Manager) StopAll() {
	m.mu.Lock()
	ids := make([]int, 0, len(m.running))
	for id := range m.running {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		m.Stop(id)
	}
}

func (m *Manager) Logs(id int) []LogLine {
	m.mu.Lock()
	r, ok := m.running[id]
	m.mu.Unlock()
	if !ok {
		return []LogLine{}
	}
	return r.snapshot()
}

// Package prober provides Uptime Kuma-style SLA monitoring, HTTP/TCP/Ping health checks,
// and Wake-on-LAN magic packet dispatching for homelab infrastructure.
package prober

import (
	"bufio"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type MonitorType string

const (
	TypeHTTP MonitorType = "http"
	TypeTCP  MonitorType = "tcp"
	TypePing MonitorType = "ping"
)

type Status string

const (
	StatusUp      Status = "up"
	StatusDown    Status = "down"
	StatusPending Status = "pending"
)

type Heartbeat struct {
	Timestamp int64   `json:"timestamp"` // epoch ms
	Status    Status  `json:"status"`
	LatencyMs float64 `json:"latencyMs"`
	Message   string  `json:"message,omitempty"`
}

type Monitor struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Type        MonitorType `json:"type"`
	Target      string      `json:"target"`
	IntervalSec int         `json:"intervalSec"`
	TimeoutSec  int         `json:"timeoutSec"`
	Status      Status      `json:"status"`
	LatencyMs   float64     `json:"latencyMs"`
	LastChecked string      `json:"lastChecked,omitempty"`
	CreatedAt   string      `json:"createdAt"`
	Uptime24h   float64     `json:"uptime24h"`
	Uptime30d   float64     `json:"uptime30d"`
	History     []Heartbeat `json:"history"`
	// Public controls whether this monitor appears on the unauthenticated
	// status page (/status). Off by default — an admin opts each one in.
	Public bool `json:"public"`
}

type Manager struct {
	mu          sync.RWMutex
	dataFile    string
	historyFile string
	monitors    map[string]*Monitor
	heartbeats  map[string][]Heartbeat
	httpClient  *http.Client
	ctx         context.Context
	cancel      context.CancelFunc
}

func New(dataDir string) (*Manager, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	m := &Manager{
		dataFile:    filepath.Join(dataDir, "monitors.json"),
		historyFile: filepath.Join(dataDir, "monitor-history.jsonl"),
		monitors:    make(map[string]*Monitor),
		heartbeats:  make(map[string][]Heartbeat),
		httpClient: &http.Client{
			Transport: &http.Transport{
				DisableKeepAlives: true,
				TLSClientConfig:   nil, // accepts system certs
			},
		},
		ctx:    ctx,
		cancel: cancel,
	}

	m.load()
	go m.startScheduler()

	return m, nil
}

func (m *Manager) Close() {
	m.cancel()
}

// HostSeed is the minimal shape SeedFromHosts and EnsureHostMonitor need from
// a store.Host, kept here instead of importing the store package to avoid a
// dependency cycle (store never needs to know about prober).
type HostSeed struct {
	ID      int
	Name    string
	Address string
	Port    int
}

func hostMonitorID(hostID int) string {
	return fmt.Sprintf("m-host-%d", hostID)
}

// SeedFromHosts ensures every saved SSH host and the local panel itself have
// a monitor, without clobbering probes an admin already customized. It also
// discards the old hardcoded generic-internet defaults (m-gateway/m-dns)
// from earlier versions in favor of monitoring the user's actual machines.
func (m *Manager) SeedFromHosts(hosts []HostSeed, localPort int) {
	m.mu.Lock()
	delete(m.monitors, "m-gateway")
	delete(m.monitors, "m-dns")
	delete(m.heartbeats, "m-gateway")
	delete(m.heartbeats, "m-dns")

	now := time.Now().UTC().Format(time.RFC3339)
	touched := make([]string, 0, len(hosts)+1)
	ensure := func(id, name string, mType MonitorType, target string) {
		touched = append(touched, id)
		if mon, exists := m.monitors[id]; exists {
			mon.Name = name
			mon.Target = target
			return
		}
		m.monitors[id] = &Monitor{
			ID: id, Name: name, Type: mType, Target: target,
			IntervalSec: 30, TimeoutSec: 5, Status: StatusPending,
			CreatedAt: now, Uptime24h: 100, Uptime30d: 100,
		}
	}

	ensure("m-localhost", "Nestcore Panel (localhost)", TypeTCP, net.JoinHostPort("127.0.0.1", strconv.Itoa(localPort)))
	for _, h := range hosts {
		port := h.Port
		if port <= 0 {
			port = 22
		}
		ensure(hostMonitorID(h.ID), h.Name, TypeTCP, net.JoinHostPort(h.Address, strconv.Itoa(port)))
	}
	_ = m.saveLocked()
	m.mu.Unlock()

	for _, id := range touched {
		go m.ExecuteCheck(id)
	}
}

// EnsureHostMonitor upserts the auto-managed monitor for a saved SSH host,
// called whenever a host is created or edited so the monitor's name/address
// never drifts from the host record.
func (m *Manager) EnsureHostMonitor(host HostSeed) {
	port := host.Port
	if port <= 0 {
		port = 22
	}
	id := hostMonitorID(host.ID)
	target := net.JoinHostPort(host.Address, strconv.Itoa(port))

	m.mu.Lock()
	if mon, exists := m.monitors[id]; exists {
		mon.Name = host.Name
		mon.Target = target
	} else {
		m.monitors[id] = &Monitor{
			ID: id, Name: host.Name, Type: TypeTCP, Target: target,
			IntervalSec: 30, TimeoutSec: 5, Status: StatusPending,
			CreatedAt: time.Now().UTC().Format(time.RFC3339), Uptime24h: 100, Uptime30d: 100,
		}
	}
	_ = m.saveLocked()
	m.mu.Unlock()

	go m.ExecuteCheck(id)
}

// RemoveHostMonitor deletes the auto-managed monitor for a host that was
// removed from the panel, so stale probes don't linger.
func (m *Manager) RemoveHostMonitor(hostID int) {
	id := hostMonitorID(hostID)
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.monitors, id)
	delete(m.heartbeats, id)
	_ = m.saveLocked()
}

func (m *Manager) load() {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Load monitors
	if data, err := os.ReadFile(m.dataFile); err == nil {
		var list []Monitor
		if json.Unmarshal(data, &list) == nil {
			for _, mon := range list {
				m.monitors[mon.ID] = &mon
			}
		}
	}

	// Load heartbeats (last 30 days)
	cutoff := time.Now().Add(-30 * 24 * time.Hour).UnixMilli()
	if f, err := os.Open(m.historyFile); err == nil {
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			var line struct {
				MonitorID string `json:"monitorId"`
				Heartbeat
			}
			if json.Unmarshal(scanner.Bytes(), &line) == nil && line.Timestamp >= cutoff {
				m.heartbeats[line.MonitorID] = append(m.heartbeats[line.MonitorID], line.Heartbeat)
			}
		}
		_ = f.Close()
	}
}

func (m *Manager) saveLocked() error {
	list := make([]Monitor, 0, len(m.monitors))
	for _, mon := range m.monitors {
		list = append(list, *mon)
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(m.dataFile, data, 0o600)
}

func (m *Manager) appendHeartbeat(monitorID string, hb Heartbeat) {
	line, err := json.Marshal(struct {
		MonitorID string `json:"monitorId"`
		Heartbeat
	}{
		MonitorID: monitorID,
		Heartbeat: hb,
	})
	if err != nil {
		return
	}

	f, err := os.OpenFile(m.historyFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err == nil {
		_, _ = f.Write(append(line, '\n'))
		_ = f.Close()
	}
}

func (m *Manager) checkMonitor(mon *Monitor) (Status, float64, string) {
	timeout := time.Duration(mon.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	start := time.Now()
	switch mon.Type {
	case TypeHTTP:
		ctx, cancel := context.WithTimeout(m.ctx, timeout)
		defer cancel()

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, mon.Target, nil)
		if err != nil {
			return StatusDown, 0, err.Error()
		}
		req.Header.Set("User-Agent", "Nestcore-Uptime-Prober/1.0")

		resp, err := m.httpClient.Do(req)
		latency := float64(time.Since(start).Microseconds()) / 1000.0
		if err != nil {
			return StatusDown, latency, err.Error()
		}
		_ = resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 400 {
			return StatusUp, latency, fmt.Sprintf("HTTP %d OK", resp.StatusCode)
		}
		return StatusDown, latency, fmt.Sprintf("HTTP status %d", resp.StatusCode)

	case TypeTCP:
		conn, err := net.DialTimeout("tcp", mon.Target, timeout)
		latency := float64(time.Since(start).Microseconds()) / 1000.0
		if err != nil {
			return StatusDown, latency, err.Error()
		}
		_ = conn.Close()
		return StatusUp, latency, "TCP connected"

	case TypePing:
		// Simple socket dial check on target host:80 or host:443
		host := mon.Target
		if !strings.Contains(host, ":") {
			host = net.JoinHostPort(host, "80")
		}
		conn, err := net.DialTimeout("tcp", host, timeout)
		latency := float64(time.Since(start).Microseconds()) / 1000.0
		if err != nil {
			return StatusDown, latency, err.Error()
		}
		_ = conn.Close()
		return StatusUp, latency, "Ping OK"

	default:
		return StatusDown, 0, "Unknown monitor type"
	}
}

func (m *Manager) startScheduler() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-m.ctx.Done():
			return
		case <-ticker.C:
			m.runScheduledChecks()
		}
	}
}

func (m *Manager) runScheduledChecks() {
	m.mu.RLock()
	monitorsToCheck := make([]Monitor, 0, len(m.monitors))
	now := time.Now()
	for _, mon := range m.monitors {
		interval := time.Duration(mon.IntervalSec) * time.Second
		if interval <= 0 {
			interval = 30 * time.Second
		}
		lastTime, _ := time.Parse(time.RFC3339, mon.LastChecked)
		if mon.LastChecked == "" || now.Sub(lastTime) >= interval {
			monitorsToCheck = append(monitorsToCheck, *mon)
		}
	}
	m.mu.RUnlock()

	for i := range monitorsToCheck {
		go func(mon Monitor) {
			m.ExecuteCheck(mon.ID)
		}(monitorsToCheck[i])
	}
}

func (m *Manager) ExecuteCheck(id string) (*Monitor, error) {
	m.mu.RLock()
	mon, exists := m.monitors[id]
	m.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("monitor not found")
	}

	status, latency, msg := m.checkMonitor(mon)
	now := time.Now().UTC()
	hb := Heartbeat{
		Timestamp: now.UnixMilli(),
		Status:    status,
		LatencyMs: latency,
		Message:   msg,
	}

	m.mu.Lock()
	mon.Status = status
	mon.LatencyMs = latency
	mon.LastChecked = now.Format(time.RFC3339)

	// Keep in-memory heartbeats (last 50 for quick display)
	history := append(m.heartbeats[id], hb)
	if len(history) > 60 {
		history = history[len(history)-60:]
	}
	m.heartbeats[id] = history

	// Calculate 24h & 30d SLA uptime
	mon.Uptime24h = calculateUptimeSLA(history, 24*time.Hour)
	mon.Uptime30d = calculateUptimeSLA(history, 30*24*time.Hour)
	mon.History = history

	_ = m.saveLocked()
	m.mu.Unlock()

	m.appendHeartbeat(id, hb)
	return mon, nil
}

func calculateUptimeSLA(history []Heartbeat, duration time.Duration) float64 {
	if len(history) == 0 {
		return 100.0
	}
	cutoff := time.Now().Add(-duration).UnixMilli()
	total := 0
	up := 0
	for _, hb := range history {
		if hb.Timestamp >= cutoff {
			total++
			if hb.Status == StatusUp {
				up++
			}
		}
	}
	if total == 0 {
		return 100.0
	}
	return float64(up) * 100.0 / float64(total)
}

func (m *Manager) List() []Monitor {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]Monitor, 0, len(m.monitors))
	for _, mon := range m.monitors {
		item := *mon
		item.History = m.heartbeats[mon.ID]
		out = append(out, item)
	}
	return out
}

func (m *Manager) Add(name string, mType MonitorType, target string, intervalSec, timeoutSec int) (Monitor, error) {
	if strings.TrimSpace(name) == "" || strings.TrimSpace(target) == "" {
		return Monitor{}, fmt.Errorf("name and target are required")
	}
	if intervalSec < 5 {
		intervalSec = 30
	}
	if timeoutSec < 1 {
		timeoutSec = 5
	}

	id := fmt.Sprintf("m-%d", time.Now().UnixNano())
	mon := Monitor{
		ID:          id,
		Name:        strings.TrimSpace(name),
		Type:        mType,
		Target:      strings.TrimSpace(target),
		IntervalSec: intervalSec,
		TimeoutSec:  timeoutSec,
		Status:      StatusPending,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
		Uptime24h:   100.0,
		Uptime30d:   100.0,
	}

	m.mu.Lock()
	m.monitors[id] = &mon
	_ = m.saveLocked()
	m.mu.Unlock()

	go m.ExecuteCheck(id)
	return mon, nil
}

func (m *Manager) Update(id string, name string, mType MonitorType, target string, intervalSec, timeoutSec int) (Monitor, error) {
	m.mu.Lock()
	mon, exists := m.monitors[id]
	if !exists {
		m.mu.Unlock()
		return Monitor{}, fmt.Errorf("monitor not found")
	}

	if strings.TrimSpace(name) != "" {
		mon.Name = strings.TrimSpace(name)
	}
	if strings.TrimSpace(target) != "" {
		mon.Target = strings.TrimSpace(target)
	}
	mon.Type = mType
	if intervalSec >= 5 {
		mon.IntervalSec = intervalSec
	}
	if timeoutSec >= 1 {
		mon.TimeoutSec = timeoutSec
	}

	_ = m.saveLocked()
	m.mu.Unlock()

	go m.ExecuteCheck(id)
	return *mon, nil
}

// SetPublic toggles whether a monitor is exposed on the unauthenticated
// status page.
func (m *Manager) SetPublic(id string, public bool) (Monitor, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	mon, exists := m.monitors[id]
	if !exists {
		return Monitor{}, fmt.Errorf("monitor not found")
	}
	mon.Public = public
	if err := m.saveLocked(); err != nil {
		return Monitor{}, err
	}
	return *mon, nil
}

func (m *Manager) Delete(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.monitors[id]; !exists {
		return fmt.Errorf("monitor not found")
	}
	delete(m.monitors, id)
	delete(m.heartbeats, id)
	return m.saveLocked()
}

// SendWakeOnLAN broadcasts a Wake-on-LAN magic packet (6x 0xFF + 16x MAC) via UDP.
func SendWakeOnLAN(macAddr, broadcastIP string) error {
	macAddr = strings.ReplaceAll(strings.ReplaceAll(macAddr, ":", ""), "-", "")
	if len(macAddr) != 12 {
		return fmt.Errorf("invalid MAC address: %s", macAddr)
	}

	macBytes, err := hex.DecodeString(macAddr)
	if err != nil {
		return fmt.Errorf("parse MAC address: %w", err)
	}

	// Build 102-byte Magic Packet
	packet := make([]byte, 102)
	for i := range 6 {
		packet[i] = 0xFF
	}
	for i := range 16 {
		copy(packet[6+i*6:], macBytes)
	}

	if broadcastIP == "" {
		broadcastIP = "255.255.255.255"
	}
	target := fmt.Sprintf("%s:9", broadcastIP)

	addr, err := net.ResolveUDPAddr("udp", target)
	if err != nil {
		return fmt.Errorf("resolve UDP address %s: %w", target, err)
	}

	conn, err := net.DialUDP("udp", nil, addr)
	if err != nil {
		return fmt.Errorf("dial UDP: %w", err)
	}
	defer conn.Close()

	_, err = conn.Write(packet)
	if err != nil {
		return fmt.Errorf("send magic packet: %w", err)
	}
	return nil
}

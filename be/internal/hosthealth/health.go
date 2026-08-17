// Package hosthealth collects local and SSH host health snapshots.
package hosthealth

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/nawfdev/home-panel/internal/sshmgr"
	"github.com/nawfdev/home-panel/internal/store"
	"github.com/nawfdev/home-panel/internal/sysstats"
)

type Snapshot struct {
	HostID          int      `json:"hostId"`
	Name            string   `json:"name"`
	Address         string   `json:"address"`
	Online          bool     `json:"online"`
	CPU             float64  `json:"cpu"`
	Memory          float64  `json:"memory"`
	Disk            float64  `json:"disk"`
	DownloadedBytes uint64   `json:"downloadedBytes"`
	UploadedBytes   uint64   `json:"uploadedBytes"`
	Temperature     *float64 `json:"temperature"`
	Uptime          uint64   `json:"uptime"`
	LatencyMs       int64    `json:"latencyMs"`
	LastSeen        string   `json:"lastSeen,omitempty"`
	Error           string   `json:"error,omitempty"`
}

type Service struct {
	store *store.Store
	ssh   *sshmgr.Manager
	mu    sync.RWMutex
	seen  map[int]time.Time
}

func New(st *store.Store, ssh *sshmgr.Manager) *Service {
	return &Service{store: st, ssh: ssh, seen: map[int]time.Time{}}
}

func (s *Service) markSeen(id int) string {
	now := time.Now().UTC()
	s.mu.Lock()
	s.seen[id] = now
	s.mu.Unlock()
	return now.Format(time.RFC3339)
}

func (s *Service) lastSeen(id int) string {
	s.mu.RLock()
	seen := s.seen[id]
	s.mu.RUnlock()
	if seen.IsZero() {
		return ""
	}
	return seen.Format(time.RFC3339)
}

func (s *Service) Local(ctx context.Context) Snapshot {
	start := time.Now()
	stats, err := sysstats.GetSystemStats(ctx)
	out := Snapshot{HostID: 0, Name: "Local panel", Address: "localhost", LatencyMs: time.Since(start).Milliseconds()}
	if err != nil {
		out.Error = err.Error()
		return out
	}
	out.Online = true
	out.CPU = stats.CPU.Usage
	out.Memory = stats.Memory.UsagePercent
	out.Uptime = stats.Uptime
	for _, disk := range stats.Disk {
		if disk.UsagePercent > out.Disk {
			out.Disk = disk.UsagePercent
		}
	}
	for _, network := range stats.Network {
		if network.Iface == "lo" || strings.HasPrefix(network.Iface, "Loopback") {
			continue
		}
		out.DownloadedBytes += network.RxBytes
		out.UploadedBytes += network.TxBytes
	}
	temp := sysstats.GetTemperature(ctx)
	out.Temperature = temp.Main
	out.LastSeen = s.markSeen(0)
	return out
}

const remoteCommand = `LC_ALL=C; cpu=$(top -bn1 2>/dev/null | awk '/^[ %]*[Cc][Pp][Uu]/{for(i=1;i<=NF;i++){if($i ~ /^idle/ || $i ~ /^id,?$/){v=$(i-1); gsub(/[% ,]/,"",v); print 100-v; exit} if($i ~ /^[0-9.]+%?id/){v=$i; gsub(/[%a-zA-Z,]/,"",v); print 100-v; exit}}}'); mem=$(awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{if(t>0) printf "%.2f",(t-a)*100/t}' /proc/meminfo); disk=$(df -P / 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5);print $5}'); up=$(cut -d. -f1 /proc/uptime); net=$(awk -F: 'NR>2 {iface=$1; gsub(/^[ \t]+|[ \t]+$/,"",iface); if(iface!="lo"){split($2,a," "); rx+=a[1]; tx+=a[9]}} END{printf "%.0f %.0f",rx,tx}' /proc/net/dev); set -- $net; temp=""; for f in /sys/class/thermal/thermal_zone*/temp /sys/class/hwmon/hwmon*/temp*_input; do if [ -r "$f" ]; then v=$(cat "$f"); [ "$v" -gt 0 ] 2>/dev/null && { if [ "$v" -gt 1000 ] 2>/dev/null; then temp=$(awk "BEGIN {printf \"%.1f\", $v / 1000}"); else temp="$v"; fi; break; }; fi; done; printf "cpu=%s\nmem=%s\ndisk=%s\nuptime=%s\ndownloaded=%s\nuploaded=%s\ntemp=%s\n" "$cpu" "$mem" "$disk" "$up" "${1:-0}" "${2:-0}" "$temp"`

func number(values map[string]string, name string) float64 {
	value, _ := strconv.ParseFloat(strings.TrimSpace(values[name]), 64)
	return value
}

func (s *Service) Remote(ctx context.Context, host store.Host) Snapshot {
	start := time.Now()
	stdout, stderr, exitCode, err := s.ssh.RunCommand(ctx, host, remoteCommand)
	out := Snapshot{HostID: host.ID, Name: host.Name, Address: host.Address, LatencyMs: time.Since(start).Milliseconds(), LastSeen: s.lastSeen(host.ID)}
	if err != nil {
		out.Error = err.Error()
		return out
	}
	if exitCode != 0 {
		out.Error = fmt.Sprintf("health command exited %d: %s", exitCode, strings.TrimSpace(stderr))
		return out
	}
	values := map[string]string{}
	for _, line := range strings.Split(stdout, "\n") {
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			values[parts[0]] = parts[1]
		}
	}
	out.Online = true
	out.CPU = number(values, "cpu")
	out.Memory = number(values, "mem")
	out.Disk = number(values, "disk")
	out.Uptime = uint64(number(values, "uptime"))
	out.DownloadedBytes = uint64(number(values, "downloaded"))
	out.UploadedBytes = uint64(number(values, "uploaded"))
	if value := number(values, "temp"); value > 0 {
		out.Temperature = &value
	}
	out.LastSeen = s.markSeen(host.ID)
	return out
}

func (s *Service) All(ctx context.Context) []Snapshot {
	hosts := s.store.ListHosts()
	out := make([]Snapshot, len(hosts)+1)
	var wg sync.WaitGroup
	wg.Add(len(out))
	go func() {
		defer wg.Done()
		out[0] = s.Local(ctx)
	}()
	for i, host := range hosts {
		go func(index int, target store.Host) {
			defer wg.Done()
			hostCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
			defer cancel()
			out[index+1] = s.Remote(hostCtx, target)
		}(i, host)
	}
	wg.Wait()
	return out
}

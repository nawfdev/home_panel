// Package sysstats ports backend/services/monitor.js using gopsutil instead of
// the Node `systeminformation` library. JSON field names match the Node output
// exactly so the existing frontend keeps working unchanged.
package sysstats

import (
	"context"
	"math"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"
	"github.com/shirou/gopsutil/v4/sensors"
)

// ---- response shapes (mirror monitor.js getSystemStats) ----

type CPUStats struct {
	Usage float64 `json:"usage"`
	Cores int     `json:"cores"`
}

type MemoryStats struct {
	Total        uint64  `json:"total"`
	Used         uint64  `json:"used"`
	Free         uint64  `json:"free"`
	UsagePercent float64 `json:"usagePercent"`
}

type DiskStats struct {
	FS           string  `json:"fs"`
	Type         string  `json:"type"`
	Size         uint64  `json:"size"`
	Used         uint64  `json:"used"`
	Available    uint64  `json:"available"`
	UsagePercent float64 `json:"usagePercent"`
	Mount        string  `json:"mount"`
}

type OSStats struct {
	Platform string `json:"platform"`
	Distro   string `json:"distro"`
	Release  string `json:"release"`
	Hostname string `json:"hostname"`
	Arch     string `json:"arch"`
}

type NetStats struct {
	Iface   string  `json:"iface"`
	RxBytes uint64  `json:"rx_bytes"`
	TxBytes uint64  `json:"tx_bytes"`
	RxSec   float64 `json:"rx_sec"`
	TxSec   float64 `json:"tx_sec"`
}

type ProcSummary struct {
	All      int `json:"all"`
	Running  int `json:"running"`
	Blocked  int `json:"blocked"`
	Sleeping int `json:"sleeping"`
}

type BatteryStats struct {
	HasBattery  bool    `json:"hasBattery"`
	Percent     float64 `json:"percent"`
	IsCharging  bool    `json:"isCharging"`
	ACConnected bool    `json:"acConnected"`
}

type SystemStats struct {
	CPU       CPUStats     `json:"cpu"`
	Memory    MemoryStats  `json:"memory"`
	Disk      []DiskStats  `json:"disk"`
	OS        OSStats      `json:"os"`
	Uptime    uint64       `json:"uptime"`
	Network   []NetStats   `json:"network"`
	Processes ProcSummary  `json:"processes"`
	Battery   BatteryStats `json:"battery"`
}

type ProcessInfo struct {
	PID   int32   `json:"pid"`
	Name  string  `json:"name"`
	CPU   float64 `json:"cpu"`
	Mem   float64 `json:"mem"`
	State string  `json:"state"`
}

type Temperature struct {
	Main      *float64  `json:"main"`
	Cores     []float64 `json:"cores"`
	Max       *float64  `json:"max"`
	Available bool      `json:"available"`
	Source    string    `json:"source,omitempty"`
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// netSample holds the previous network counters so rx_sec/tx_sec can be derived
// as a delta over wall-clock time (systeminformation tracks this internally).
var (
	netMu     sync.Mutex
	netPrev   map[string]net.IOCountersStat
	netPrevAt time.Time
)

// GetSystemStats is the Go port of monitor.js getSystemStats.
func GetSystemStats(ctx context.Context) (*SystemStats, error) {
	s := &SystemStats{}

	// CPU usage: a short sampling window gives a "current load" comparable to si.
	if pct, err := cpu.PercentWithContext(ctx, 150*time.Millisecond, false); err == nil && len(pct) > 0 {
		s.CPU.Usage = round2(pct[0])
	}
	if cores, err := cpu.CountsWithContext(ctx, true); err == nil {
		s.CPU.Cores = cores
	}

	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		s.Memory = MemoryStats{
			Total:        vm.Total,
			Used:         vm.Used,
			Free:         vm.Free,
			UsagePercent: round2(float64(vm.Used) / float64(vm.Total) * 100),
		}
	}

	s.Disk = collectDisks(ctx)

	if info, err := host.InfoWithContext(ctx); err == nil {
		s.OS = OSStats{
			Platform: info.OS,
			Distro:   info.Platform,
			Release:  info.PlatformVersion,
			Hostname: info.Hostname,
			Arch:     info.KernelArch,
		}
		s.Uptime = info.Uptime
	}
	if s.OS.Arch == "" {
		s.OS.Arch = runtime.GOARCH
	}

	s.Network = collectNetwork(ctx)
	s.Processes = collectProcSummary(ctx)
	s.Battery = collectBattery(ctx)

	return s, nil
}

func collectDisks(ctx context.Context) []DiskStats {
	out := []DiskStats{}
	parts, err := disk.PartitionsWithContext(ctx, false)
	if err != nil {
		return out
	}
	seen := map[string]bool{}
	for _, p := range parts {
		if seen[p.Mountpoint] {
			continue
		}
		seen[p.Mountpoint] = true
		u, err := disk.UsageWithContext(ctx, p.Mountpoint)
		if err != nil || u.Total == 0 {
			continue
		}
		out = append(out, DiskStats{
			FS:           p.Device,
			Type:         p.Fstype,
			Size:         u.Total,
			Used:         u.Used,
			Available:    u.Free,
			UsagePercent: round2(u.UsedPercent),
			Mount:        u.Path,
		})
	}
	return out
}

func collectNetwork(ctx context.Context) []NetStats {
	counters, err := net.IOCountersWithContext(ctx, true)
	if err != nil {
		return []NetStats{}
	}
	now := time.Now()

	netMu.Lock()
	prev := netPrev
	prevAt := netPrevAt
	cur := make(map[string]net.IOCountersStat, len(counters))
	for _, c := range counters {
		cur[c.Name] = c
	}
	netPrev = cur
	netPrevAt = now
	netMu.Unlock()

	elapsed := now.Sub(prevAt).Seconds()
	out := make([]NetStats, 0, len(counters))
	for _, c := range counters {
		ns := NetStats{Iface: c.Name, RxBytes: c.BytesRecv, TxBytes: c.BytesSent}
		if prev != nil && elapsed > 0 {
			if p, ok := prev[c.Name]; ok {
				ns.RxSec = round2(float64(c.BytesRecv-p.BytesRecv) / elapsed)
				ns.TxSec = round2(float64(c.BytesSent-p.BytesSent) / elapsed)
			}
		}
		out = append(out, ns)
	}
	return out
}

func collectProcSummary(ctx context.Context) ProcSummary {
	sum := ProcSummary{}
	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		return sum
	}
	sum.All = len(procs)
	for _, p := range procs {
		st, err := p.StatusWithContext(ctx)
		if err != nil || len(st) == 0 {
			continue
		}
		switch st[0] {
		case process.Running:
			sum.Running++
		case process.Sleep, process.Idle:
			sum.Sleeping++
		case process.Blocked, process.Wait:
			sum.Blocked++
		}
	}
	return sum
}

// collectBattery: gopsutil has no battery sensor, so we return the same default
// shape the Node code emitted on machines without a battery (servers).
func collectBattery(ctx context.Context) BatteryStats {
	return BatteryStats{HasBattery: false, Percent: 0, IsCharging: false, ACConnected: false}
}

// GetProcessList ports monitor.js getProcessList: top 20 processes by CPU.
func GetProcessList(ctx context.Context) ([]ProcessInfo, error) {
	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		return nil, err
	}
	list := make([]ProcessInfo, 0, len(procs))
	for _, p := range procs {
		name, _ := p.NameWithContext(ctx)
		cpuPct, _ := p.CPUPercentWithContext(ctx)
		memPct, _ := p.MemoryPercentWithContext(ctx)
		state := ""
		if st, err := p.StatusWithContext(ctx); err == nil && len(st) > 0 {
			state = st[0]
		}
		list = append(list, ProcessInfo{
			PID:   p.Pid,
			Name:  name,
			CPU:   round2(cpuPct),
			Mem:   round2(float64(memPct)),
			State: state,
		})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].CPU > list[j].CPU })
	if len(list) > 20 {
		list = list[:20]
	}
	return list, nil
}

// GetTemperature ports monitor.js getTemperature with the sysfs fallback chain.
func GetTemperature(ctx context.Context) Temperature {
	if temps, err := sensors.TemperaturesWithContext(ctx); err == nil {
		var main float64
		var cores []float64
		var maxV float64
		for _, t := range temps {
			if t.Temperature <= 0 {
				continue
			}
			key := strings.ToLower(t.SensorKey)
			if main == 0 && (strings.Contains(key, "package") || strings.Contains(key, "coretemp") || strings.Contains(key, "tctl") || strings.Contains(key, "cpu")) {
				main = t.Temperature
			}
			cores = append(cores, t.Temperature)
			if t.Temperature > maxV {
				maxV = t.Temperature
			}
		}
		if main == 0 && len(cores) > 0 {
			main = cores[0]
		}
		if main > 0 {
			m := main
			var mx *float64
			if maxV > 0 {
				mx = &maxV
			}
			return Temperature{Main: &m, Cores: cores, Max: mx, Available: true}
		}
	}

	// Linux sysfs fallback (matches the Node thermal_zone loop).
	if runtime.GOOS == "linux" {
		zones := []string{
			"/sys/class/thermal/thermal_zone0/temp",
			"/sys/class/thermal/thermal_zone1/temp",
			"/sys/class/hwmon/hwmon0/temp1_input",
			"/sys/class/hwmon/hwmon1/temp1_input",
		}
		for _, z := range zones {
			raw, err := os.ReadFile(z)
			if err != nil {
				continue
			}
			milli, err := strconv.Atoi(strings.TrimSpace(string(raw)))
			if err != nil {
				continue
			}
			v := float64(milli) / 1000
			if v > 0 && v < 150 {
				m := math.Round(v)
				return Temperature{Main: &m, Cores: []float64{}, Available: true, Source: "sysfs"}
			}
		}
	}

	return Temperature{Main: nil, Cores: []float64{}, Available: false}
}

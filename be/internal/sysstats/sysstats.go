// Package sysstats ports backend/services/monitor.js using gopsutil instead of
// the Node `systeminformation` library. JSON field names match the Node output
// exactly so the existing frontend keeps working unchanged.
package sysstats

import (
	"context"
	"math"
	"os"
	"path/filepath"
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
	Total         uint64  `json:"total"`
	Used          uint64  `json:"used"`
	Free          uint64  `json:"free"`
	UsagePercent  float64 `json:"usagePercent"`
	SwapTotal     uint64  `json:"swapTotal"`
	SwapUsed      uint64  `json:"swapUsed"`
	SwapPercent   float64 `json:"swapPercent"`
}

type DiskStats struct {
	FS           string  `json:"fs"`
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

type BatteryStats struct {
	HasBattery  bool    `json:"hasBattery"`
	Percent     float64 `json:"percent"`
	IsCharging  bool    `json:"isCharging"`
	AcConnected bool    `json:"acConnected"`
}

type NetworkStats struct {
	Iface   string  `json:"iface"`
	RxBytes uint64  `json:"rx_bytes"`
	TxBytes uint64  `json:"tx_bytes"`
	RxSec   float64 `json:"rx_sec"`
	TxSec   float64 `json:"tx_sec"`
}

type SystemStats struct {
	CPU      CPUStats       `json:"cpu"`
	Memory   MemoryStats    `json:"memory"`
	Disk     []DiskStats    `json:"disk"`
	OS       OSStats        `json:"os"`
	Uptime   uint64         `json:"uptime"`
	Battery  BatteryStats   `json:"battery"`
	Network  []NetworkStats `json:"network"`
	Platform string         `json:"platform"`
}

type ProcessInfo struct {
	PID       int32   `json:"pid"`
	Name      string  `json:"name"`
	CPU       float64 `json:"cpu"`
	Mem       float32 `json:"mem"`
	State     string  `json:"state"`
	Started   string  `json:"started"`
	User      string  `json:"user"`
	Command   string  `json:"command"`
	CPUTime   int64   `json:"cpuTime"`
	StartTime int64   `json:"startTime"`
}

type Temperature struct {
	Main      *float64  `json:"main"`
	Cores     []float64 `json:"cores"`
	Max       *float64  `json:"max"`
	Available bool      `json:"available"`
	Source    string    `json:"source,omitempty"`
}

// network rate tracker
var (
	netMu   sync.Mutex
	lastNet = map[string]netSample{}
)

type netSample struct {
	rx    uint64
	tx    uint64
	stamp time.Time
}

// GetSystemStats ports monitor.js getSystemStats.
func GetSystemStats(ctx context.Context) (SystemStats, error) {
	out := SystemStats{Platform: runtime.GOOS}

	// CPU
	cores, _ := cpu.CountsWithContext(ctx, true)
	if cores == 0 {
		cores = runtime.NumCPU()
	}
	usages, err := cpu.PercentWithContext(ctx, 200*time.Millisecond, false)
	usage := 0.0
	if err == nil && len(usages) > 0 {
		usage = math.Round(usages[0]*10) / 10
	}
	out.CPU = CPUStats{Usage: usage, Cores: cores}

	// Memory
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		out.Memory = MemoryStats{
			Total:        vm.Total,
			Used:         vm.Used,
			Free:         vm.Free,
			UsagePercent: math.Round(vm.UsedPercent*10) / 10,
		}
		if sw, err := mem.SwapMemoryWithContext(ctx); err == nil {
			out.Memory.SwapTotal = sw.Total
			out.Memory.SwapUsed = sw.Used
			out.Memory.SwapPercent = math.Round(sw.UsedPercent*10) / 10
		}
	}

	// Disks
	if parts, err := disk.PartitionsWithContext(ctx, false); err == nil {
		seen := map[string]bool{}
		for _, p := range parts {
			if seen[p.Mountpoint] {
				continue
			}
			if strings.HasPrefix(p.Mountpoint, "/snap") ||
				strings.HasPrefix(p.Mountpoint, "/boot") ||
				strings.HasPrefix(p.Mountpoint, "/var/lib/docker") ||
				strings.HasPrefix(p.Device, "/dev/loop") {
				continue
			}
			u, err := disk.UsageWithContext(ctx, p.Mountpoint)
			if err != nil || u.Total == 0 {
				continue
			}
			seen[p.Mountpoint] = true
			out.Disk = append(out.Disk, DiskStats{
				FS:           p.Fstype,
				Size:         u.Total,
				Used:         u.Used,
				Available:    u.Free,
				UsagePercent: math.Round(u.UsedPercent*10) / 10,
				Mount:        p.Mountpoint,
			})
		}
	}

	// OS + uptime
	if hi, err := host.InfoWithContext(ctx); err == nil {
		distro := hi.Platform
		if hi.PlatformFamily != "" && hi.PlatformFamily != hi.Platform {
			distro = hi.PlatformFamily + " " + hi.Platform
		}
		out.OS = OSStats{
			Platform: hi.OS,
			Distro:   distro,
			Release:  hi.PlatformVersion,
			Hostname: hi.Hostname,
			Arch:     hi.KernelArch,
		}
		out.Uptime = hi.Uptime
	}

	// Battery (stub - mirrors Node behavior when no battery is present)
	out.Battery = BatteryStats{HasBattery: false, Percent: 100, IsCharging: false, AcConnected: true}

	// Network
	if counters, err := net.IOCountersWithContext(ctx, true); err == nil {
		netMu.Lock()
		now := time.Now()
		for _, c := range counters {
			if c.Name == "lo" || strings.HasPrefix(c.Name, "Loopback") {
				continue
			}
			entry := NetworkStats{
				Iface:   c.Name,
				RxBytes: c.BytesRecv,
				TxBytes: c.BytesSent,
			}
			if prev, ok := lastNet[c.Name]; ok && now.After(prev.stamp) {
				dt := now.Sub(prev.stamp).Seconds()
				if dt > 0 && c.BytesRecv >= prev.rx && c.BytesSent >= prev.tx {
					entry.RxSec = float64(c.BytesRecv-prev.rx) / dt
					entry.TxSec = float64(c.BytesSent-prev.tx) / dt
				}
			}
			lastNet[c.Name] = netSample{rx: c.BytesRecv, tx: c.BytesSent, stamp: now}
			out.Network = append(out.Network, entry)
		}
		netMu.Unlock()
	}

	return out, nil
}

// GetProcessList ports monitor.js getProcesses.
func GetProcessList(ctx context.Context) ([]ProcessInfo, error) {
	pids, err := process.PidsWithContext(ctx)
	if err != nil {
		return nil, err
	}
	var list []ProcessInfo
	for _, pid := range pids {
		p, err := process.NewProcessWithContext(ctx, pid)
		if err != nil {
			continue
		}
		name, _ := p.NameWithContext(ctx)
		if name == "" {
			continue
		}
		cpuPct, _ := p.CPUPercentWithContext(ctx)
		memPct, _ := p.MemoryPercentWithContext(ctx)
		status, _ := p.StatusWithContext(ctx)
		state := "running"
		if len(status) > 0 {
			state = status[0]
		}
		user, _ := p.UsernameWithContext(ctx)
		cmd, _ := p.CmdlineWithContext(ctx)
		times, _ := p.TimesWithContext(ctx)
		createTime, _ := p.CreateTimeWithContext(ctx)

		cpuTime := int64(0)
		if times != nil {
			cpuTime = int64(times.User + times.System)
		}

		list = append(list, ProcessInfo{
			PID:       pid,
			Name:      name,
			CPU:       math.Round(cpuPct*10) / 10,
			Mem:       float32(math.Round(float64(memPct)*10) / 10),
			State:     state,
			Started:   time.UnixMilli(createTime).Format(time.RFC3339),
			User:      user,
			Command:   cmd,
			CPUTime:   cpuTime,
			StartTime: createTime,
		})
	}

	sort.Slice(list, func(i, j int) bool {
		if list[i].CPU != list[j].CPU {
			return list[i].CPU > list[j].CPU
		}
		return list[i].Mem > list[j].Mem
	})

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

	// Linux sysfs fallback: scan all thermal zones and hwmon sensors.
	if runtime.GOOS == "linux" {
		var zones []string
		if matches, _ := filepath.Glob("/sys/class/thermal/thermal_zone*/temp"); len(matches) > 0 {
			zones = append(zones, matches...)
		}
		if matches, _ := filepath.Glob("/sys/class/hwmon/hwmon*/temp*_input"); len(matches) > 0 {
			zones = append(zones, matches...)
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
			var v float64
			if milli > 1000 {
				v = float64(milli) / 1000
			} else {
				v = float64(milli)
			}
			if v > 0 && v < 150 {
				m := math.Round(v*10) / 10
				return Temperature{Main: &m, Cores: []float64{}, Available: true, Source: "sysfs"}
			}
		}
	}

	return Temperature{Main: nil, Cores: []float64{}, Available: false}
}

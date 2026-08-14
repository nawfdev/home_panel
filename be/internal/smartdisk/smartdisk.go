// Package smartdisk provides S.M.A.R.T. disk health analysis, temperature monitoring,
// wear-level endurance estimation, and storage metrics for NVMe, SATA SSD, HDD, and eMMC.
package smartdisk

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/nawfdev/home-panel/internal/sshmgr"
	"github.com/nawfdev/home-panel/internal/store"
)

type DriveType string

const (
	TypeNVMe  DriveType = "NVMe"
	TypeSATA  DriveType = "SATA SSD"
	TypeHDD   DriveType = "HDD"
	TypeEMMC  DriveType = "eMMC/SD"
	TypeOther DriveType = "Storage"
)

type SmartAttribute struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Value     int    `json:"value"`
	Worst     int    `json:"worst"`
	Threshold int    `json:"threshold"`
	RawValue  string `json:"rawValue"`
	Failed    bool   `json:"failed"`
}

type DiskInfo struct {
	Device           string           `json:"device"`
	Model            string           `json:"model"`
	Serial           string           `json:"serial"`
	Type             DriveType        `json:"type"`
	SizeBytes        uint64           `json:"sizeBytes"`
	Health           string           `json:"health"` // PASSED, WARNING, CRITICAL, UNKNOWN
	Temperature      int              `json:"temperature"`
	PowerOnHours     int              `json:"powerOnHours"`
	PowerCycles      int              `json:"powerCycles"`
	WearLevelPercent *int             `json:"wearLevelPercent,omitempty"`
	TotalWrittenTB   *float64         `json:"totalWrittenTB,omitempty"`
	BadSectors       int              `json:"badSectors"`
	RotationRate     int              `json:"rotationRate"`
	Attributes       []SmartAttribute `json:"attributes,omitempty"`
}

type StorageOverview struct {
	HostID        int        `json:"hostId"`
	HostName      string     `json:"hostName"`
	TotalDisks    int        `json:"totalDisks"`
	HealthyDisks  int        `json:"healthyDisks"`
	WarningDisks  int        `json:"warningDisks"`
	TotalCapacity uint64     `json:"totalCapacity"`
	AvgTemp       int        `json:"avgTemp"`
	Disks         []DiskInfo `json:"disks"`
}

type Service struct {
	store *store.Store
	ssh   *sshmgr.Manager
}

func New(st *store.Store, ssh *sshmgr.Manager) *Service {
	return &Service{store: st, ssh: ssh}
}

// GetOverview collects disk information and SMART metrics for local or remote host.
func (s *Service) GetOverview(ctx context.Context, hostID int) (StorageOverview, error) {
	if hostID == 0 {
		return s.localOverview(ctx)
	}
	return s.remoteOverview(ctx, hostID)
}

func (s *Service) localOverview(ctx context.Context) (StorageOverview, error) {
	devices := discoverLocalBlockDevices()
	disks := make([]DiskInfo, 0, len(devices))

	for _, dev := range devices {
		info, err := inspectDisk(ctx, dev)
		if err == nil {
			disks = append(disks, info)
		}
	}

	return compileOverview(0, "Local panel", disks), nil
}

func discoverLocalBlockDevices() []string {
	var devices []string
	matches, _ := filepath.Glob("/sys/block/sd*")
	for _, m := range matches {
		name := filepath.Base(m)
		devices = append(devices, "/dev/"+name)
	}
	nvmeMatches, _ := filepath.Glob("/sys/block/nvme*n*")
	for _, m := range nvmeMatches {
		name := filepath.Base(m)
		devices = append(devices, "/dev/"+name)
	}
	mmcMatches, _ := filepath.Glob("/sys/block/mmcblk*")
	for _, m := range mmcMatches {
		name := filepath.Base(m)
		if !strings.Contains(name, "p") && !strings.Contains(name, "boot") {
			devices = append(devices, "/dev/"+name)
		}
	}
	return devices
}

func inspectDisk(ctx context.Context, device string) (DiskInfo, error) {
	out, err := exec.CommandContext(ctx, "smartctl", "-j", "-a", device).Output()
	if err == nil || len(out) > 0 {
		if parsed, ok := parseSmartctlJSON(device, out); ok {
			return parsed, nil
		}
	}

	// Sysfs fallback
	return inspectDiskSysfs(device)
}

func parseSmartctlJSON(device string, raw []byte) (DiskInfo, bool) {
	var data struct {
		ModelName       string `json:"model_name"`
		ModelFamily     string `json:"model_family"`
		SerialNumber    string `json:"serial_number"`
		RotationRate    int    `json:"rotation_rate"`
		UserCapacity    struct {
			Bytes uint64 `json:"bytes"`
		} `json:"user_capacity"`
		SmartStatus struct {
			Passed bool `json:"passed"`
		} `json:"smart_status"`
		Temperature struct {
			Current int `json:"current"`
		} `json:"temperature"`
		PowerOnTime struct {
			Hours int `json:"hours"`
		} `json:"power_on_time"`
		PowerCycleCount int `json:"power_cycle_count"`
		NVMeSmartHealth struct {
			AvailableSparePercent int     `json:"available_spare"`
			PercentageUsed        int     `json:"percentage_used"`
			DataUnitsWritten      uint64  `json:"data_units_written"`
			Temperature           int     `json:"temperature"`
			PowerOnHours          uint64  `json:"power_on_hours"`
			PowerCycles           uint64  `json:"power_cycles"`
			CriticalWarning       int     `json:"critical_warning"`
		} `json:"nvme_smart_health_information_log"`
		ATASmartAttributes struct {
			Table []struct {
				ID         int    `json:"id"`
				Name       string `json:"name"`
				Value      int    `json:"value"`
				Worst      int    `json:"worst"`
				Threshold  int    `json:"thresh"`
				WhenFailed string `json:"when_failed"`
				Raw        struct {
					Value int64  `json:"value"`
					Str   string `json:"string"`
				} `json:"raw"`
			} `json:"table"`
		} `json:"ata_smart_attributes"`
	}

	if err := json.Unmarshal(raw, &data); err != nil {
		return DiskInfo{}, false
	}

	dType := TypeHDD
	if strings.Contains(device, "nvme") {
		dType = TypeNVMe
	} else if data.RotationRate == 0 {
		dType = TypeSATA
	}

	model := data.ModelName
	if model == "" {
		model = data.ModelFamily
	}
	if model == "" {
		model = filepath.Base(device)
	}

	health := "PASSED"
	if !data.SmartStatus.Passed {
		health = "CRITICAL"
	}

	temp := data.Temperature.Current
	powerHours := data.PowerOnTime.Hours
	powerCycles := data.PowerCycleCount
	badSectors := 0
	var wearLevel *int
	var totalTB *float64

	// NVMe-specific properties
	if dType == TypeNVMe && data.NVMeSmartHealth.Temperature > 0 {
		temp = data.NVMeSmartHealth.Temperature
		powerHours = int(data.NVMeSmartHealth.PowerOnHours)
		powerCycles = int(data.NVMeSmartHealth.PowerCycles)
		rem := 100 - data.NVMeSmartHealth.PercentageUsed
		if rem < 0 {
			rem = 0
		}
		wearLevel = &rem
		if data.NVMeSmartHealth.DataUnitsWritten > 0 {
			tb := float64(data.NVMeSmartHealth.DataUnitsWritten*512*1000) / 1000 / 1000 / 1000 / 1000
			totalTB = &tb
		}
		if data.NVMeSmartHealth.CriticalWarning > 0 {
			health = "WARNING"
		}
	}

	// ATA Attributes parsing
	var attrs []SmartAttribute
	for _, a := range data.ATASmartAttributes.Table {
		failed := a.WhenFailed != "" && a.WhenFailed != "-"
		if failed {
			health = "WARNING"
		}
		if a.ID == 5 || a.ID == 197 || a.ID == 198 {
			if a.Raw.Value > 0 {
				badSectors += int(a.Raw.Value)
				health = "WARNING"
			}
		}
		if a.ID == 177 || a.ID == 231 || a.ID == 233 { // SSD Wear indicator
			wl := a.Value
			wearLevel = &wl
		}
		if a.ID == 241 { // Total LBAs written
			tb := float64(a.Raw.Value*512) / 1000 / 1000 / 1000 / 1000
			totalTB = &tb
		}
		rawStr := a.Raw.Str
		if rawStr == "" {
			rawStr = strconv.FormatInt(a.Raw.Value, 10)
		}
		attrs = append(attrs, SmartAttribute{
			ID:        a.ID,
			Name:      a.Name,
			Value:     a.Value,
			Worst:     a.Worst,
			Threshold: a.Threshold,
			RawValue:  rawStr,
			Failed:    failed,
		})
	}

	return DiskInfo{
		Device:           device,
		Model:            model,
		Serial:           data.SerialNumber,
		Type:             dType,
		SizeBytes:        data.UserCapacity.Bytes,
		Health:           health,
		Temperature:      temp,
		PowerOnHours:     powerHours,
		PowerCycles:      powerCycles,
		WearLevelPercent: wearLevel,
		TotalWrittenTB:   totalTB,
		BadSectors:       badSectors,
		RotationRate:     data.RotationRate,
		Attributes:       attrs,
	}, true
}

func inspectDiskSysfs(device string) (DiskInfo, error) {
	name := filepath.Base(device)
	sysPath := "/sys/block/" + name

	var sizeBytes uint64
	if data, err := os.ReadFile(sysPath + "/size"); err == nil {
		sectors, _ := strconv.ParseUint(strings.TrimSpace(string(data)), 10, 64)
		sizeBytes = sectors * 512
	}

	model := name
	if data, err := os.ReadFile(sysPath + "/device/model"); err == nil {
		model = strings.TrimSpace(string(data))
	}

	rotational := true
	if data, err := os.ReadFile(sysPath + "/queue/rotational"); err == nil {
		rotational = strings.TrimSpace(string(data)) == "1"
	}

	dType := TypeHDD
	if strings.Contains(name, "nvme") {
		dType = TypeNVMe
	} else if strings.Contains(name, "mmc") {
		dType = TypeEMMC
	} else if !rotational {
		dType = TypeSATA
	}

	return DiskInfo{
		Device:       device,
		Model:        model,
		Type:         dType,
		SizeBytes:    sizeBytes,
		Health:       "PASSED",
		Temperature:  0,
		RotationRate: map[bool]int{true: 5400, false: 0}[rotational],
	}, nil
}

const remoteDiskScript = `
for d in /sys/block/sd* /sys/block/nvme*n* /sys/block/mmcblk*; do
  [ -d "$d" ] || continue
  b=$(basename "$d")
  case "$b" in *p*|*boot*) continue ;; esac
  size=$(cat "$d/size" 2>/dev/null || echo 0)
  model=$(cat "$d/device/model" 2>/dev/null || echo "$b")
  rota=$(cat "$d/queue/rotational" 2>/dev/null || echo 1)
  temp=0
  for tf in "/sys/block/$b/device/hwmon"*/temp*_input; do
    [ -r "$tf" ] && { temp=$(cat "$tf" 2>/dev/null); [ "$temp" -gt 1000 ] 2>/dev/null && temp=$((temp/1000)); break; };
  done
  printf 'DEV=%s SIZE=%s MODEL=%s ROTA=%s TEMP=%s\n' "$b" "$size" "$model" "$rota" "$temp"
done
`

func (s *Service) remoteOverview(ctx context.Context, hostID int) (StorageOverview, error) {
	host, ok := s.store.GetHost(hostID)
	if !ok {
		return StorageOverview{}, fmt.Errorf("host not found")
	}

	stdout, _, _, err := s.ssh.RunCommand(ctx, host, remoteDiskScript)
	if err != nil {
		return StorageOverview{}, err
	}

	var disks []DiskInfo
	for _, line := range strings.Split(strings.TrimSpace(stdout), "\n") {
		if !strings.HasPrefix(line, "DEV=") {
			continue
		}
		var devName, model string
		var sectors uint64
		var rota, temp int
		for _, part := range strings.Split(line, " ") {
			kv := strings.SplitN(part, "=", 2)
			if len(kv) != 2 {
				continue
			}
			switch kv[0] {
			case "DEV":
				devName = kv[1]
			case "SIZE":
				sectors, _ = strconv.ParseUint(kv[1], 10, 64)
			case "MODEL":
				model = kv[1]
			case "ROTA":
				rota, _ = strconv.Atoi(kv[1])
			case "TEMP":
				temp, _ = strconv.Atoi(kv[1])
			}
		}

		if devName == "" {
			continue
		}

		dType := TypeHDD
		if strings.Contains(devName, "nvme") {
			dType = TypeNVMe
		} else if strings.Contains(devName, "mmc") {
			dType = TypeEMMC
		} else if rota == 0 {
			dType = TypeSATA
		}

		disks = append(disks, DiskInfo{
			Device:       "/dev/" + devName,
			Model:        model,
			Type:         dType,
			SizeBytes:    sectors * 512,
			Health:       "PASSED",
			Temperature:  temp,
			RotationRate: map[bool]int{true: 5400, false: 0}[rota == 1],
		})
	}

	return compileOverview(host.ID, host.Name, disks), nil
}

func compileOverview(hostID int, hostName string, disks []DiskInfo) StorageOverview {
	var totalCap uint64
	healthy := 0
	warning := 0
	tempSum := 0
	tempCount := 0

	for _, d := range disks {
		totalCap += d.SizeBytes
		if d.Health == "PASSED" {
			healthy++
		} else {
			warning++
		}
		if d.Temperature > 0 {
			tempSum += d.Temperature
			tempCount++
		}
	}

	avgTemp := 0
	if tempCount > 0 {
		avgTemp = tempSum / tempCount
	}

	return StorageOverview{
		HostID:        hostID,
		HostName:      hostName,
		TotalDisks:    len(disks),
		HealthyDisks:  healthy,
		WarningDisks:  warning,
		TotalCapacity: totalCap,
		AvgTemp:       avgTemp,
		Disks:         disks,
	}
}

// Package netinfo provides cross-platform network introspection, porting
// backend/services/networkInfo.js.
package netinfo

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	gnet "github.com/shirou/gopsutil/v4/net"
)

type Interface struct {
	Name string  `json:"name"`
	IP4  *string `json:"ip4"`
	IP6  *string `json:"ip6"`
	MAC  *string `json:"mac"`
}

type NetStat struct {
	Interface string  `json:"interface"`
	RxBytes   uint64  `json:"rx_bytes"`
	TxBytes   uint64  `json:"tx_bytes"`
	RxSec     float64 `json:"rx_sec"`
	TxSec     float64 `json:"tx_sec"`
}

type Info struct {
	PublicIP    string      `json:"publicIp"`
	Interfaces  []Interface `json:"interfaces"`
	Connections int         `json:"connections"`
	Stats       []NetStat   `json:"stats"`
}

type Snapshot struct {
	Interfaces []Interface `json:"interfaces"`
	Stats      []NetStat   `json:"stats"`
	DNS        []string    `json:"dns"`
	Gateway    *string     `json:"gateway"`
}

var (
	statsMu     sync.Mutex
	statsPrev   = map[string]gnet.IOCountersStat{}
	statsPrevAt time.Time
)

// GetLocalInterfaces returns non-internal, up interfaces with their primary IPs and MAC.
func GetLocalInterfaces() []Interface {
	ifaces, err := net.Interfaces()
	if err != nil {
		return []Interface{}
	}
	out := make([]Interface, 0, len(ifaces))
	for _, iface := range ifaces {
		if iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		var ip4, ip6 *string
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok || ipNet.IP.IsLoopback() {
				continue
			}
			if v4 := ipNet.IP.To4(); v4 != nil {
				if ip4 == nil {
					s := v4.String()
					ip4 = &s
				}
			} else if v6 := ipNet.IP.To16(); v6 != nil {
				if ip6 == nil && !v6.IsLinkLocalUnicast() {
					s := v6.String()
					ip6 = &s
				}
			}
		}
		if ip4 == nil && ip6 == nil {
			continue
		}
		var mac *string
		if len(iface.HardwareAddr) > 0 {
			s := iface.HardwareAddr.String()
			mac = &s
		}
		out = append(out, Interface{
			Name: iface.Name,
			IP4:  ip4,
			IP6:  ip6,
			MAC:  mac,
		})
	}
	return out
}

// GetPublicIP tries several lookup endpoints with a short timeout.
func GetPublicIP(ctx context.Context) string {
	endpoints := []string{
		"https://api.ipify.org",
		"https://ifconfig.me/ip",
		"https://icanhazip.com",
	}
	for _, ep := range endpoints {
		ip := fetchIP(ctx, ep)
		if ip != "" {
			return ip
		}
	}
	return "Unavailable"
}

func fetchIP(ctx context.Context, ep string) string {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ep, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", "curl/7.88.1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	var buf [64]byte
	n, _ := resp.Body.Read(buf[:])
	ip := strings.TrimSpace(string(buf[:n]))
	if net.ParseIP(ip) != nil {
		return ip
	}
	return ""
}

// GetConnectionsCount counts active TCP connections in ESTABLISHED state.
func GetConnectionsCount(ctx context.Context) int {
	conns, err := gnet.ConnectionsWithContext(ctx, "tcp")
	if err != nil {
		return 0
	}
	n := 0
	for _, c := range conns {
		if c.Status == "ESTABLISHED" {
			n++
		}
	}
	return n
}

// GetNetworkStats returns cumulative counters and transfer rates derived from
// the previous sample. Counter resets produce a zero rate instead of wrapping.
func GetNetworkStats(ctx context.Context) []NetStat {
	counters, err := gnet.IOCountersWithContext(ctx, true)
	if err != nil {
		return []NetStat{}
	}
	now := time.Now()

	statsMu.Lock()
	defer statsMu.Unlock()
	elapsed := now.Sub(statsPrevAt).Seconds()
	current := make(map[string]gnet.IOCountersStat, len(counters))
	out := make([]NetStat, 0, len(counters))
	for _, c := range counters {
		current[c.Name] = c
		stat := NetStat{Interface: c.Name, RxBytes: c.BytesRecv, TxBytes: c.BytesSent}
		if previous, ok := statsPrev[c.Name]; ok && elapsed > 0 {
			if c.BytesRecv >= previous.BytesRecv {
				stat.RxSec = float64(c.BytesRecv-previous.BytesRecv) / elapsed
			}
			if c.BytesSent >= previous.BytesSent {
				stat.TxSec = float64(c.BytesSent-previous.BytesSent) / elapsed
			}
		}
		out = append(out, stat)
	}
	statsPrev = current
	statsPrevAt = now
	return out
}

// ParseLinuxSnapshot converts output collected from a remote Linux host into
// the same representation used for the panel's local network data.
func ParseLinuxSnapshot(addresses, routes, resolvConf, netDev string) (Snapshot, error) {
	interfaces, err := parseLinuxInterfaces(addresses)
	if err != nil {
		return Snapshot{}, err
	}
	return Snapshot{
		Interfaces: interfaces,
		Stats:      parseProcNetDev(netDev),
		DNS:        parseResolvConf(resolvConf),
		Gateway:    parseLinuxGateway(routes),
	}, nil
}

func parseLinuxInterfaces(raw string) ([]Interface, error) {
	trimmed := strings.TrimSpace(raw)
	if strings.HasPrefix(trimmed, "[") || strings.HasPrefix(trimmed, "{") {
		var values []struct {
			Name    string `json:"ifname"`
			Address string `json:"address"`
			Info    []struct {
				Family string `json:"family"`
				Local  string `json:"local"`
				Scope  string `json:"scope"`
			} `json:"addr_info"`
		}
		if err := json.Unmarshal([]byte(trimmed), &values); err == nil {
			out := make([]Interface, 0, len(values))
			for _, value := range values {
				var ip4, ip6 *string
				for _, address := range value.Info {
					if address.Scope == "host" || address.Local == "" {
						continue
					}
					switch address.Family {
					case "inet":
						if ip4 == nil {
							v := address.Local
							ip4 = &v
						}
					case "inet6":
						if ip6 == nil && !strings.HasPrefix(strings.ToLower(address.Local), "fe80:") {
							v := address.Local
							ip6 = &v
						}
					}
				}
				if ip4 == nil && ip6 == nil && value.Address == "" {
					continue
				}
				var mac *string
				if value.Address != "" && value.Address != "00:00:00:00:00:00" {
					v := value.Address
					mac = &v
				}
				out = append(out, Interface{Name: value.Name, IP4: ip4, IP6: ip6, MAC: mac})
			}
			if len(out) > 0 {
				return out, nil
			}
		}
	}

	// Fallback to robust plain text parser (BusyBox / OpenWrt / non-json ip tool)
	return parsePlainTextInterfaces(raw), nil
}

func parsePlainTextInterfaces(raw string) []Interface {
	out := []Interface{}
	var current *Interface

	for _, line := range strings.Split(raw, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		// Header line: e.g. "1: lo: <...>" or "3: wan: <...>" or "4: lan1@eth0: <...>"
		if len(line) > 0 && line[0] >= '0' && line[0] <= '9' {
			if current != nil {
				out = append(out, *current)
			}
			parts := strings.SplitN(trimmed, ":", 3)
			if len(parts) >= 2 {
				name := strings.TrimSpace(parts[1])
				if idx := strings.Index(name, "@"); idx != -1 {
					name = name[:idx]
				}
				current = &Interface{Name: name}
			}
			continue
		}

		if current == nil {
			continue
		}

		fields := strings.Fields(trimmed)
		if len(fields) < 2 {
			continue
		}

		switch fields[0] {
		case "link/ether", "link/loopback":
			if len(fields) >= 2 && fields[1] != "00:00:00:00:00:00" {
				mac := fields[1]
				current.MAC = &mac
			}
		case "inet":
			if len(fields) >= 2 {
				ip := strings.Split(fields[1], "/")[0]
				if !strings.HasPrefix(ip, "127.") {
					current.IP4 = &ip
				}
			}
		case "inet6":
			if len(fields) >= 2 {
				ip := strings.Split(fields[1], "/")[0]
				if ip != "::1" && !strings.HasPrefix(strings.ToLower(ip), "fe80:") {
					if current.IP6 == nil {
						current.IP6 = &ip
					}
				}
			}
		}
	}

	if current != nil {
		out = append(out, *current)
	}

	return out
}

func parseProcNetDev(raw string) []NetStat {
	out := []NetStat{}
	for _, line := range strings.Split(raw, "\n") {
		name, fields, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		values := strings.Fields(fields)
		if len(values) < 9 {
			continue
		}
		rx, rxErr := strconv.ParseUint(values[0], 10, 64)
		tx, txErr := strconv.ParseUint(values[8], 10, 64)
		if rxErr != nil || txErr != nil {
			continue
		}
		out = append(out, NetStat{Interface: strings.TrimSpace(name), RxBytes: rx, TxBytes: tx})
	}
	return out
}

func parseResolvConf(raw string) []string {
	servers := []string{}
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[0] == "nameserver" {
			servers = append(servers, fields[1])
		}
	}
	return servers
}

func parseLinuxGateway(raw string) *string {
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 3 && fields[0] == "default" {
			gateway := fields[2]
			return &gateway
		}
	}
	return nil
}

// GetInfo bundles the pieces like getNetworkInfo.
func GetInfo(ctx context.Context) Info {
	return Info{
		PublicIP:    GetPublicIP(ctx),
		Interfaces:  GetLocalInterfaces(),
		Connections: GetConnectionsCount(ctx),
		Stats:       GetNetworkStats(ctx),
	}
}

// TestConnectivity does a HEAD to a well-known host.
func TestConnectivity(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, "https://www.google.com", nil)
	if err != nil {
		return false
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 400
}

// GetDNSServers reads resolv.conf on Linux/macOS.
func GetDNSServers(ctx context.Context) []string {
	if runtime.GOOS == "windows" {
		return []string{"Configured via Windows network adapter"}
	}
	data, err := os.ReadFile("/etc/resolv.conf")
	if err != nil {
		return []string{}
	}
	return parseResolvConf(string(data))
}

// GetGateway returns the default gateway IP on Linux/macOS.
func GetGateway(ctx context.Context) string {
	if runtime.GOOS != "linux" {
		return "N/A"
	}
	data, err := os.ReadFile("/proc/net/route")
	if err != nil {
		return "N/A"
	}
	lines := strings.Split(string(data), "\n")
	for _, line := range lines[1:] {
		fields := strings.Fields(line)
		if len(fields) >= 3 && fields[1] == "00000000" {
			ipHex := fields[2]
			if len(ipHex) == 8 {
				b0, _ := strconv.ParseInt(ipHex[6:8], 16, 64)
				b1, _ := strconv.ParseInt(ipHex[4:6], 16, 64)
				b2, _ := strconv.ParseInt(ipHex[2:4], 16, 64)
				b3, _ := strconv.ParseInt(ipHex[0:2], 16, 64)
				return fmt.Sprintf("%d.%d.%d.%d", b0, b1, b2, b3)
			}
		}
	}
	return "N/A"
}

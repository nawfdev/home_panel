// Package netinfo ports backend/services/network.js: public IP, local interfaces,
// connectivity, DNS and gateway discovery. Cross-platform (Linux + Windows).
package netinfo

import (
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"time"

	gnet "github.com/shirou/gopsutil/v4/net"
)

type Interface struct {
	Name     string  `json:"name"`
	IP4      *string `json:"ip4"`
	IP6      *string `json:"ip6"`
	MAC      *string `json:"mac"`
	Internal bool    `json:"internal"`
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

var ipv4Re = regexp.MustCompile(`\d+\.\d+\.\d+\.\d+`)

// GetPublicIP tries multiple services, matching the JS fallback list.
func GetPublicIP(ctx context.Context) string {
	services := []string{"https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"}
	client := &http.Client{Timeout: 5 * time.Second}
	for _, svc := range services {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, svc, nil)
		if err != nil {
			continue
		}
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		resp.Body.Close()
		ip := strings.TrimSpace(string(body))
		if ip != "" {
			return ip
		}
	}
	return "Unable to detect"
}

// GetLocalInterfaces ports getLocalInterfaces using the Go stdlib.
func GetLocalInterfaces() []Interface {
	out := []Interface{}
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, ifc := range ifaces {
		addrs, err := ifc.Addrs()
		if err != nil {
			continue
		}
		var ip4, ip6 *string
		for _, a := range addrs {
			ipNet, ok := a.(*net.IPNet)
			if !ok || ipNet.IP.IsLoopback() {
				continue
			}
			s := ipNet.IP.String()
			if ipNet.IP.To4() != nil {
				if ip4 == nil {
					v := s
					ip4 = &v
				}
			} else if !ipNet.IP.IsLinkLocalUnicast() {
				if ip6 == nil {
					v := s
					ip6 = &v
				}
			}
		}
		if ip4 != nil || ip6 != nil {
			mac := ifc.HardwareAddr.String()
			var macPtr *string
			if mac != "" {
				macPtr = &mac
			}
			out = append(out, Interface{Name: ifc.Name, IP4: ip4, IP6: ip6, MAC: macPtr, Internal: false})
		}
	}
	return out
}

// GetConnectionsCount counts ESTABLISHED TCP connections (replaces netstat parsing).
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

// GetNetworkStats returns cumulative per-iface counters (rates need sampling and
// are surfaced live by the metrics collector; here they default to 0).
func GetNetworkStats(ctx context.Context) []NetStat {
	counters, err := gnet.IOCountersWithContext(ctx, true)
	if err != nil {
		return []NetStat{}
	}
	out := make([]NetStat, 0, len(counters))
	for _, c := range counters {
		out = append(out, NetStat{Interface: c.Name, RxBytes: c.BytesRecv, TxBytes: c.BytesSent})
	}
	return out
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

// GetDNSServers ports getDnsServers (resolv.conf on Linux, ipconfig on Windows).
func GetDNSServers(ctx context.Context) []string {
	if runtime.GOOS == "windows" {
		out, err := exec.CommandContext(ctx, "ipconfig", "/all").Output()
		if err != nil {
			return []string{}
		}
		servers := []string{}
		for _, line := range strings.Split(string(out), "\n") {
			if strings.Contains(line, "DNS Servers") {
				servers = append(servers, ipv4Re.FindAllString(line, -1)...)
			}
		}
		return servers
	}
	raw, err := os.ReadFile("/etc/resolv.conf")
	if err != nil {
		return []string{}
	}
	servers := []string{}
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[0] == "nameserver" {
			servers = append(servers, fields[1])
		}
	}
	return servers
}

// GetGateway ports getGateway (`ip route` on Linux, ipconfig on Windows).
func GetGateway(ctx context.Context) *string {
	if runtime.GOOS == "windows" {
		out, err := exec.CommandContext(ctx, "ipconfig").Output()
		if err != nil {
			return nil
		}
		for _, line := range strings.Split(string(out), "\n") {
			if strings.Contains(line, "Default Gateway") {
				if m := ipv4Re.FindString(line); m != "" {
					return &m
				}
			}
		}
		return nil
	}
	out, err := exec.CommandContext(ctx, "ip", "route").Output()
	if err != nil {
		return nil
	}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 3 && fields[0] == "default" {
			gw := fields[2]
			return &gw
		}
	}
	return nil
}

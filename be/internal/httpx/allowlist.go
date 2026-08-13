package httpx

import (
	"net"
	"net/http"
	"strings"
)

type IPAllowlist struct {
	ips  map[string]struct{}
	nets []*net.IPNet
}

func NewIPAllowlist(entries []string) *IPAllowlist {
	allowed := &IPAllowlist{ips: map[string]struct{}{}}
	for _, raw := range entries {
		entry := strings.TrimSpace(raw)
		if entry == "" {
			continue
		}
		if _, network, err := net.ParseCIDR(entry); err == nil {
			allowed.nets = append(allowed.nets, network)
			continue
		}
		if ip := net.ParseIP(entry); ip != nil {
			allowed.ips[ip.String()] = struct{}{}
		}
	}
	return allowed
}

func (a *IPAllowlist) Middleware(next http.Handler) http.Handler {
	if a == nil || len(a.ips) == 0 && len(a.nets) == 0 {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			host = r.RemoteAddr
		}
		ip := net.ParseIP(strings.Trim(host, "[]"))
		if ip != nil {
			if _, ok := a.ips[ip.String()]; ok {
				next.ServeHTTP(w, r)
				return
			}
			for _, network := range a.nets {
				if network.Contains(ip) {
					next.ServeHTTP(w, r)
					return
				}
			}
		}
		Error(w, http.StatusForbidden, "IP address is not allowed")
	})
}

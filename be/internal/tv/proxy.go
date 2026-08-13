package tv

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// hopHeaders are stripped when relaying the upstream response, the usual
// reverse-proxy hop-by-hop list (RFC 7230 §6.1) plus the ones that would
// otherwise leak upstream compression framing our client didn't ask for.
var hopHeaders = map[string]bool{
	"connection":          true,
	"keep-alive":          true,
	"proxy-authenticate":  true,
	"proxy-authorization": true,
	"te":                  true,
	"trailers":            true,
	"transfer-encoding":   true,
	"upgrade":             true,
}

var blockedNetworks = mustBlockedNetworks(
	"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
	"169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24",
	"192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
	"224.0.0.0/4", "240.0.0.0/4", "::/128", "::1/128", "fc00::/7",
	"fe80::/10", "ff00::/8", "2001:db8::/32",
)

func mustBlockedNetworks(cidrs ...string) []*net.IPNet {
	networks := make([]*net.IPNet, 0, len(cidrs))
	for _, cidr := range cidrs {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			panic(err)
		}
		networks = append(networks, network)
	}
	return networks
}

func blockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	for _, blocked := range blockedNetworks {
		if blocked.Contains(ip) {
			return true
		}
	}
	return false
}

func resolvePublicIPs(ctx context.Context, host string) error {
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return err
	}
	if len(ips) == 0 {
		return fmt.Errorf("upstream host has no addresses")
	}
	for _, ip := range ips {
		if blockedIP(ip) {
			return fmt.Errorf("private or reserved upstream address")
		}
	}
	return nil
}

func publicIPDialer(ctx context.Context, network, address string) (net.Conn, error) {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	if err := resolvePublicIPs(ctx, host); err != nil {
		return nil, err
	}
	dialer := net.Dialer{}
	return dialer.DialContext(ctx, network, address)
}

// Proxy relays a stream/license request to an upstream URL with headers the
// browser can't set itself (Referer/User-Agent are forbidden on XHR/fetch,
// and a Widevine license server is opaque to canonical CORS anyway). The
// target URL and a base64 JSON header blob travel as query params, mirroring
// dhanytv's own stream-proxy design.
func (s *Service) Proxy(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if target == "" {
		http.Error(w, "missing url", http.StatusBadRequest)
		return
	}
	parsed, err := url.Parse(target)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
		http.Error(w, "invalid url", http.StatusBadRequest)
		return
	}
	if err := resolvePublicIPs(r.Context(), parsed.Hostname()); err != nil {
		http.Error(w, "upstream address is not allowed", http.StatusForbidden)
		return
	}

	headers := map[string]string{}
	if h := r.URL.Query().Get("h"); h != "" {
		if raw, err := base64.StdEncoding.DecodeString(h); err == nil {
			_ = json.Unmarshal(raw, &headers)
		}
	}

	req, err := http.NewRequest(r.Method, target, r.Body)
	if err != nil {
		http.Error(w, "bad upstream request", http.StatusBadGateway)
		return
	}
	req.ContentLength = r.ContentLength
	req.Header.Set("User-Agent", userAgent)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if rng := r.Header.Get("Range"); rng != "" {
		req.Header.Set("Range", rng)
	}
	if ct := r.Header.Get("Content-Type"); ct != "" && r.Method != http.MethodGet {
		req.Header.Set("Content-Type", ct)
	}

	client := *s.httpClient
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = publicIPDialer
	client.Transport = transport
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return fmt.Errorf("stopped after 10 redirects")
		}
		if err := resolvePublicIPs(req.Context(), req.URL.Hostname()); err != nil {
			return err
		}
		return nil
	}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, "upstream fetch failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for k, vv := range resp.Header {
		if hopHeaders[strings.ToLower(k)] {
			continue
		}
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

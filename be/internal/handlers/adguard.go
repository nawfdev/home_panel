package handlers

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

// AdGuard reverse-proxies requests to a local AdGuard Home instance.
type AdGuard struct{}

// Proxy forwards incoming requests to AdGuard Home at localhost:8080,
// stripping the /api/adguard prefix.
func (a *AdGuard) Proxy(w http.ResponseWriter, r *http.Request) {
	target, _ := url.Parse("http://localhost:8080")

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.Host = target.Host

			// Strip /api/adguard prefix.
			req.URL.Path = strings.TrimPrefix(req.URL.Path, "/api/adguard")
			if req.URL.Path == "" {
				req.URL.Path = "/"
			}
			req.URL.RawPath = ""

			// Forward client identity.
			if clientIP := r.RemoteAddr; clientIP != "" {
				// RemoteAddr is "ip:port"; extract just the IP.
				if idx := strings.LastIndex(clientIP, ":"); idx != -1 {
					clientIP = clientIP[:idx]
				}
				req.Header.Set("X-Forwarded-For", clientIP)
				req.Header.Set("X-Real-IP", clientIP)
			}
		},
	}

	// httputil.ReverseProxy handles WebSocket upgrade transparently
	// via HTTP/1.1 connection hijacking.
	proxy.ServeHTTP(w, r)
}

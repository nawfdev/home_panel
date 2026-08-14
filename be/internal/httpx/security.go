package httpx

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"net"
	"net/http"
	"net/url"
	"strings"
)

type contextKey uint8

const cspNonceKey contextKey = iota

// TrustedProxy accepts forwarded transport metadata from a proxy running on loopback
// (such as cloudflared tunnel, Caddy, nginx, or local reverse proxy).
func TrustedProxy(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isLoopbackPeer(r.RemoteAddr) || r.Header.Get("CF-Ray") != "" {
			// Cloudflare Tunnel and reverse proxies
			proto := firstForwardedValue(r.Header.Get("X-Forwarded-Proto"))
			if strings.EqualFold(proto, "https") || strings.Contains(r.Header.Get("CF-Visitor"), "https") {
				r.URL.Scheme = "https"
			}
			if fHost := firstForwardedValue(r.Header.Get("X-Forwarded-Host")); fHost != "" {
				r.Host = fHost
			}
		} else {
			r.Header.Del("X-Forwarded-Proto")
			r.Header.Del("X-Forwarded-Host")
			r.Header.Del("X-Forwarded-For")
			r.Header.Del("X-Real-IP")
		}
		next.ServeHTTP(w, r)
	})
}

func isLoopbackPeer(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		host = address
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

func firstForwardedValue(value string) string {
	return strings.TrimSpace(strings.SplitN(value, ",", 2)[0])
}

func stripPort(hostport string) string {
	host, _, err := net.SplitHostPort(hostport)
	if err != nil {
		return hostport
	}
	return host
}

func sameHost(a, b string) bool {
	if strings.EqualFold(a, b) {
		return true
	}
	return strings.EqualFold(stripPort(a), stripPort(b))
}

// CSRFProtection rejects unsafe browser requests from untrusted foreign origins.
// Supports direct LAN IP, domain names, and cloudflared tunnels.
func CSRFProtection(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if safeMethod(r.Method) {
			next.ServeHTTP(w, r)
			return
		}
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin == "" {
			if ref := strings.TrimSpace(r.Header.Get("Referer")); ref != "" {
				if parsedRef, err := url.Parse(ref); err == nil && parsedRef.Scheme != "" && parsedRef.Host != "" {
					origin = parsedRef.Scheme + "://" + parsedRef.Host
				}
			}
		}
		if origin == "" {
			// Non-browser client (mobile app, curl, CLI)
			next.ServeHTTP(w, r)
			return
		}
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			Error(w, http.StatusForbidden, "Cross-origin request denied")
			return
		}

		// When request arrives via local reverse proxy or Cloudflare Tunnel, accept valid origins
		isLoopback := isLoopbackPeer(r.RemoteAddr)
		isCloudflare := r.Header.Get("CF-Ray") != "" || r.Header.Get("CF-Connecting-IP") != ""

		if isLoopback || isCloudflare {
			next.ServeHTTP(w, r)
			return
		}

		// Direct access (LAN IP): verify origin host matches request host
		if !sameHost(parsed.Host, r.Host) {
			Error(w, http.StatusForbidden, "Cross-origin request denied")
			return
		}

		next.ServeHTTP(w, r)
	})
}

func safeMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodTrace:
		return true
	default:
		return false
	}
}

func requestScheme(r *http.Request) string {
	if r.TLS != nil || r.URL.Scheme == "https" {
		return "https"
	}
	return "http"
}

// CSPNonce gives inline scripts in server-rendered public share pages a
// per-response nonce without weakening the React application policy.
func CSPNonce(r *http.Request) string {
	nonce, _ := r.Context().Value(cspNonceKey).(string)
	return nonce
}

// SecurityHeaders installs browser security headers and a nonce-based CSP.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nonceBytes := make([]byte, 18)
		if _, err := rand.Read(nonceBytes); err != nil {
			Error(w, http.StatusInternalServerError, "Unable to create security policy")
			return
		}
		nonce := base64.RawStdEncoding.EncodeToString(nonceBytes)
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "SAMEORIGIN")
		h.Set("X-DNS-Prefetch-Control", "off")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
		h.Set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'nonce-"+nonce+"'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' ws: wss: https:")
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), cspNonceKey, nonce)))
	})
}

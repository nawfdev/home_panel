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

// TrustedProxy accepts forwarded transport metadata only from a proxy running
// on the same host. Direct LAN clients cannot forge X-Forwarded-Proto.
func TrustedProxy(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isLoopbackPeer(r.RemoteAddr) {
			if strings.EqualFold(firstForwardedValue(r.Header.Get("X-Forwarded-Proto")), "https") {
				r.URL.Scheme = "https"
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

// CSRFProtection rejects unsafe browser requests from another origin. Native
// bearer clients generally omit Origin and remain supported.
func CSRFProtection(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if safeMethod(r.Method) {
			next.ServeHTTP(w, r)
			return
		}
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin == "" {
			next.ServeHTTP(w, r)
			return
		}
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Scheme == "" || !strings.EqualFold(parsed.Host, r.Host) || parsed.Scheme != requestScheme(r) {
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

// Package httpx holds shared HTTP helpers: JSON responses, security headers and
// the rate limiters that replace helmet + express-rate-limit.
package httpx

import (
	"encoding/json"
	"net"
	"net/http"
	"sync"
	"time"
)

// JSON writes v as a JSON response with the given status code.
func JSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// Error writes {"error": msg} with the given status, matching the Node shape.
func Error(w http.ResponseWriter, status int, msg string) {
	JSON(w, status, map[string]string{"error": msg})
}

// SecurityHeaders mirrors the subset of helmet used by the Node app (CSP was
// disabled there to allow inline scripts, so we do the same).
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "SAMEORIGIN")
		h.Set("X-DNS-Prefetch-Control", "off")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// RateLimiter is a fixed-window limiter keyed by client IP, matching the
// express-rate-limit windows used by the Node backend.
type RateLimiter struct {
	mu             sync.Mutex
	window         time.Duration
	max            int
	skipSuccessful bool
	message        string
	hits           map[string]*window
}

type window struct {
	count int
	reset time.Time
}

// NewRateLimiter builds a limiter. When skipSuccessful is true, requests that
// resolve to 2xx are not counted (matches authLimiter.skipSuccessfulRequests).
func NewRateLimiter(w time.Duration, max int, skipSuccessful bool, message string) *RateLimiter {
	return &RateLimiter{
		window:         w,
		max:            max,
		skipSuccessful: skipSuccessful,
		message:        message,
		hits:           map[string]*window{},
	}
}

func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		now := time.Now()

		rl.mu.Lock()
		win := rl.hits[ip]
		if win == nil || now.After(win.reset) {
			win = &window{count: 0, reset: now.Add(rl.window)}
			rl.hits[ip] = win
		}
		if win.count >= rl.max {
			rl.mu.Unlock()
			Error(w, http.StatusTooManyRequests, rl.message)
			return
		}
		rl.mu.Unlock()

		if rl.skipSuccessful {
			// Only count failures: capture status, increment after the handler.
			sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(sw, r)
			if sw.status < 200 || sw.status >= 300 {
				rl.mu.Lock()
				win.count++
				rl.mu.Unlock()
			}
			return
		}

		rl.mu.Lock()
		win.count++
		rl.mu.Unlock()
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (sw *statusWriter) WriteHeader(code int) {
	if !sw.wroteHeader {
		sw.status = code
		sw.wroteHeader = true
	}
	sw.ResponseWriter.WriteHeader(code)
}

func (sw *statusWriter) Write(b []byte) (int, error) {
	if !sw.wroteHeader {
		sw.wroteHeader = true
	}
	return sw.ResponseWriter.Write(b)
}

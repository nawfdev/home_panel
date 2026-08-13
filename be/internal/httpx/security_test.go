package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTrustedProxyMarksLoopbackHTTPS(t *testing.T) {
	var scheme string
	handler := TrustedProxy(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		scheme = r.URL.Scheme
	}))
	request := httptest.NewRequest(http.MethodGet, "http://panel.example/api/auth/me", nil)
	request.RemoteAddr = "127.0.0.1:41234"
	request.Header.Set("X-Forwarded-Proto", "https")
	handler.ServeHTTP(httptest.NewRecorder(), request)
	if scheme != "https" {
		t.Fatalf("scheme = %q, want https", scheme)
	}
}

func TestTrustedProxyRejectsDirectForwardedProto(t *testing.T) {
	var scheme, forwarded string
	handler := TrustedProxy(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		scheme = r.URL.Scheme
		forwarded = r.Header.Get("X-Forwarded-Proto")
	}))
	request := httptest.NewRequest(http.MethodGet, "http://panel.local/api/auth/me", nil)
	request.RemoteAddr = "192.168.11.20:41234"
	request.Header.Set("X-Forwarded-Proto", "https")
	handler.ServeHTTP(httptest.NewRecorder(), request)
	if scheme == "https" || forwarded != "" {
		t.Fatalf("direct request trusted forwarded metadata: scheme=%q header=%q", scheme, forwarded)
	}
}

func TestCSRFProtectionRejectsCrossOriginMutation(t *testing.T) {
	handler := CSRFProtection(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequest(http.MethodPost, "https://panel.example/api/system/reboot-host", nil)
	request.Header.Set("Origin", "https://attacker.example")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestCSRFProtectionAllowsSameOriginMutation(t *testing.T) {
	handler := CSRFProtection(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequest(http.MethodPost, "https://panel.example/api/settings/cloudflare", nil)
	request.Header.Set("Origin", "https://panel.example")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
	}
}

func TestSecurityHeadersIncludeCSP(t *testing.T) {
	handler := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://panel.local/", nil))
	if response.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("Content-Security-Policy header is missing")
	}
}

package session

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLoginIgnoresUntrustedForwardedProto(t *testing.T) {
	manager := New(strings.Repeat("s", 32), 60_000)
	request := httptest.NewRequest(http.MethodPost, "http://panel.local/api/auth/login", nil)
	request.Header.Set("X-Forwarded-Proto", "https")
	response := httptest.NewRecorder()

	if err := manager.Login(response, request, SessionUser{ID: 1, Username: "admin", Role: "admin"}); err != nil {
		t.Fatal(err)
	}

	cookie := response.Result().Cookies()[0]
	if cookie.Secure {
		t.Fatal("plain HTTP request produced a Secure cookie from spoofed X-Forwarded-Proto")
	}
}

func TestLoginTrustsSanitizedHTTPScheme(t *testing.T) {
	manager := New(strings.Repeat("s", 32), 60_000)
	request := httptest.NewRequest(http.MethodPost, "http://panel.local/api/auth/login", nil)
	request.URL.Scheme = "https"
	response := httptest.NewRecorder()

	if err := manager.Login(response, request, SessionUser{ID: 1, Username: "admin", Role: "admin"}); err != nil {
		t.Fatal(err)
	}

	cookie := response.Result().Cookies()[0]
	if !cookie.Secure {
		t.Fatal("trusted proxy HTTPS scheme produced a cookie without Secure")
	}
}

func TestLoginMarksTLSCookieSecure(t *testing.T) {
	manager := New(strings.Repeat("s", 32), 60_000)
	request := httptest.NewRequest(http.MethodPost, "https://panel.local/api/auth/login", nil)
	response := httptest.NewRecorder()

	if err := manager.Login(response, request, SessionUser{ID: 1, Username: "admin", Role: "admin"}); err != nil {
		t.Fatal(err)
	}

	cookie := response.Result().Cookies()[0]
	if !cookie.Secure {
		t.Fatal("TLS request produced a cookie without Secure")
	}
}

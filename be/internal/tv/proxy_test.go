package tv

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestProxyRejectsPrivateUpstream(t *testing.T) {
	service := NewService()
	request := httptest.NewRequest(http.MethodGet, "/tv-proxy?url="+url.QueryEscape("http://127.0.0.1:9689/api/system/stats"), nil)
	response := httptest.NewRecorder()

	service.Proxy(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
	if !strings.Contains(response.Body.String(), "upstream address is not allowed") {
		t.Fatalf("body = %q", response.Body.String())
	}
}

func TestBlockedIP(t *testing.T) {
	tests := []struct {
		address string
		blocked bool
	}{
		{"127.0.0.1", true},
		{"169.254.169.254", true},
		{"192.168.11.1", true},
		{"::1", true},
		{"fc00::1", true},
		{"1.1.1.1", false},
		{"2606:4700:4700::1111", false},
	}
	for _, test := range tests {
		t.Run(test.address, func(t *testing.T) {
			if got := blockedIP(net.ParseIP(test.address)); got != test.blocked {
				t.Fatalf("blockedIP(%q) = %v, want %v", test.address, got, test.blocked)
			}
		})
	}
}

func TestPublicIPDialerRejectsPrivateAddress(t *testing.T) {
	_, err := publicIPDialer(context.Background(), "tcp", "127.0.0.1:80")
	if err == nil || !strings.Contains(err.Error(), "private or reserved") {
		t.Fatalf("error = %v, want private-address rejection", err)
	}
}

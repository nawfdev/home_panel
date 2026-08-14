package session

import (
	"net/http/httptest"
	"testing"
)

func TestSessionAutoRestoreAfterRestart(t *testing.T) {
	mgr1 := New("a7f9d8e6c5b4a3210fedcba9876543210abcdef1234567890fedcba987654321", int64(86400000))

	// Login with mgr1
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/auth/login", nil)
	u := SessionUser{ID: 1, Username: "admin", Role: "admin"}

	if err := mgr1.Login(rec, req, u); err != nil {
		t.Fatalf("login failed: %v", err)
	}

	cookie := rec.Result().Cookies()[0]

	// Simulate server restart: new manager with empty memory
	mgr2 := New("a7f9d8e6c5b4a3210fedcba9876543210abcdef1234567890fedcba987654321", int64(86400000))

	req2 := httptest.NewRequest("GET", "/api/auth/sessions", nil)
	req2.AddCookie(cookie)

	user, ok := mgr2.Current(req2)
	if !ok {
		t.Fatalf("expected session to be valid after server restart, got false")
	}

	if user.Username != "admin" {
		t.Fatalf("expected admin user, got %s", user.Username)
	}

	// Verify that active session list has been restored in memory
	sessions := mgr2.List(req2, 1, true)
	if len(sessions) == 0 {
		t.Fatalf("expected at least 1 restored session, got 0")
	}

	if !sessions[0].Current {
		t.Fatalf("expected session to be marked current")
	}
}

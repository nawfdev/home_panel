package projects

import (
	"strings"
	"testing"
)

func TestNormalizeInputRejectsUnsafeHostingValues(t *testing.T) {
	tests := []struct {
		name string
		in   SiteInput
	}{
		{"relative deployment path", SiteInput{Name: "site", Type: "static", Path: "srv/site"}},
		{"invalid domain", SiteInput{Name: "site", Type: "static", Path: "/srv/site", Domains: []string{"bad host"}}},
		{"multiline build", SiteInput{Name: "site", Type: "static", Path: "/srv/site", BuildCommand: "npm ci\nrm -rf /"}},
		{"escaped publish dir", SiteInput{Name: "site", Type: "static", Path: "/srv/site", PublishDir: "../secret"}},
		{"missing proxy port", SiteInput{Name: "site", Type: "proxy", Path: "/srv/site"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := normalizeInput(test.in); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestNormalizeInputCanonicalizesDomainsAndDefaults(t *testing.T) {
	got, err := normalizeInput(SiteInput{
		Name: " portfolio ", Type: "STATIC", Path: "/srv/site/",
		Domains: []string{"WWW.Example.com", "www.example.com", "example.com"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "portfolio" || got.Type != "static" || got.Path != "/srv/site" {
		t.Fatalf("unexpected normalized site: %#v", got)
	}
	if strings.Join(got.Domains, ",") != "www.example.com,example.com" {
		t.Fatalf("unexpected domains: %#v", got.Domains)
	}
	if got.TunnelConfig != defaultTunnelConfig || got.TunnelService != defaultTunnelService {
		t.Fatalf("missing tunnel defaults: %#v", got)
	}
}

func TestNormalizeInputAcceptsLocalAbsolutePath(t *testing.T) {
	if _, err := normalizeInput(SiteInput{Name: "local", Type: "static", Path: `C:\apps\site`}); err != nil {
		t.Fatal(err)
	}
}

func TestReplaceManagedIngressIsIdempotentAndPreservesCatchAll(t *testing.T) {
	original := "tunnel: abc\ncredentials-file: /etc/cloudflared/abc.json\ningress:\n  - hostname: panel.example.com\n    service: http://127.0.0.1:9689\n  - service: http_status:404\n"
	first, err := replaceManagedIngress(original, []string{"a.example.com", "b.example.com"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := replaceManagedIngress(first, []string{"a.example.com", "b.example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("reconcile is not idempotent:\n%s\n---\n%s", first, second)
	}
	for _, required := range []string{
		"hostname: panel.example.com",
		"hostname: a.example.com",
		"hostname: b.example.com",
		"service: http_status:404",
	} {
		if !strings.Contains(first, required) {
			t.Fatalf("missing %q in config:\n%s", required, first)
		}
	}
	if strings.Index(first, "hostname: b.example.com") > strings.Index(first, "service: http_status:404") {
		t.Fatal("managed ingress was inserted after catch-all")
	}
}

func TestReplaceManagedIngressRequiresCatchAll(t *testing.T) {
	_, err := replaceManagedIngress("ingress:\n  - hostname: panel.example.com\n    service: http://127.0.0.1:9689\n", []string{"a.example.com"})
	if err == nil {
		t.Fatal("expected missing catch-all error")
	}
}

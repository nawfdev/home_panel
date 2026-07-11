package updater

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// TestRebuildFrontendRestoresOnFailure verifies a failing build leaves the
// previously-working dist in place (the bug that broke the live panel).
func TestRebuildFrontendRestoresOnFailure(t *testing.T) {
	root := t.TempDir()
	fe := filepath.Join(root, "fe")
	writeFile(t, filepath.Join(fe, "dist", "index.html"), "OLD_WORKING_BUILD")
	// build script that always fails
	writeFile(t, filepath.Join(fe, "package.json"), `{"name":"fe","scripts":{"build":"node -e \"process.exit(1)\""}}`)

	u := New(root)
	rebuilt, errMsg := u.rebuildFrontend(context.Background(), fe)
	if rebuilt {
		t.Fatalf("expected rebuilt=false on failing build")
	}
	if errMsg == "" {
		t.Fatalf("expected an error message on failing build")
	}
	// dist must still contain the old working build
	got, err := os.ReadFile(filepath.Join(fe, "dist", "index.html"))
	if err != nil {
		t.Fatalf("dist/index.html missing after failed build — panel would be broken: %v", err)
	}
	if string(got) != "OLD_WORKING_BUILD" {
		t.Fatalf("dist not restored, got %q", string(got))
	}
	// backup must be cleaned up
	if _, err := os.Stat(filepath.Join(fe, "dist.bak")); !os.IsNotExist(err) {
		t.Fatalf("dist.bak should have been removed after restore")
	}
}

// TestRebuildFrontendSuccessReplacesDist verifies a successful build replaces
// the old dist and leaves no backup behind.
func TestRebuildFrontendSuccessReplacesDist(t *testing.T) {
	root := t.TempDir()
	fe := filepath.Join(root, "fe")
	writeFile(t, filepath.Join(fe, "dist", "index.html"), "OLD_BUILD")
	// build script that writes a fresh dist/index.html
	writeFile(t, filepath.Join(fe, "package.json"),
		`{"name":"fe","scripts":{"build":"node -e \"require('fs').mkdirSync('dist',{recursive:true});require('fs').writeFileSync('dist/index.html','NEW_BUILD')\""}}`)

	u := New(root)
	rebuilt, errMsg := u.rebuildFrontend(context.Background(), fe)
	if !rebuilt || errMsg != "" {
		t.Fatalf("expected clean rebuild, got rebuilt=%v err=%q", rebuilt, errMsg)
	}
	got, _ := os.ReadFile(filepath.Join(fe, "dist", "index.html"))
	if string(got) != "NEW_BUILD" {
		t.Fatalf("expected NEW_BUILD, got %q", string(got))
	}
	if _, err := os.Stat(filepath.Join(fe, "dist.bak")); !os.IsNotExist(err) {
		t.Fatalf("dist.bak should not remain after a successful build")
	}
}

func TestParseNodeMajor(t *testing.T) {
	cases := map[string]int{"v18.19.1": 18, "v20.11.0": 20, "v22.9.0": 22, "garbage": 0, "": 0}
	for in, want := range cases {
		if got := parseNodeMajor(in); got != want {
			t.Errorf("parseNodeMajor(%q) = %d, want %d", in, got, want)
		}
	}
}

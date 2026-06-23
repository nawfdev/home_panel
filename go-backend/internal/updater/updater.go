// Package updater ports backend/services/updater.js: git-based self-update.
package updater

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Updater struct{ root string }

func New(root string) *Updater { return &Updater{root: root} }

func (u *Updater) git(ctx context.Context, timeout time.Duration, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = u.root
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}

// CheckForUpdates ports checkForUpdates.
func (u *Updater) CheckForUpdates(ctx context.Context) map[string]interface{} {
	if _, err := u.git(ctx, 5*time.Second, "--version"); err != nil {
		return map[string]interface{}{"error": "Git is not installed or not in PATH", "updateAvailable": false}
	}
	_, _ = u.git(ctx, 30*time.Second, "fetch", "origin") // best-effort

	localCommit, err := u.git(ctx, 10*time.Second, "rev-parse", "HEAD")
	if err != nil {
		return map[string]interface{}{"error": "Check failed: " + err.Error(), "updateAvailable": false}
	}
	remoteCommit := localCommit
	if rc, err := u.git(ctx, 10*time.Second, "rev-parse", "origin/main"); err == nil {
		remoteCommit = rc
	}
	behind := 0
	if bc, err := u.git(ctx, 10*time.Second, "rev-list", "HEAD..origin/main", "--count"); err == nil {
		behind, _ = strconv.Atoi(strings.TrimSpace(bc))
	}

	version := ""
	if pkgRaw, err := os.ReadFile(filepath.Join(u.root, "package.json")); err == nil {
		var pkg struct {
			Version string `json:"version"`
		}
		_ = json.Unmarshal(pkgRaw, &pkg)
		version = pkg.Version
	}

	pending := []string{}
	if behind > 0 {
		if logOut, err := u.git(ctx, 10*time.Second, "log", "HEAD..origin/main", "--oneline", "--format=%s"); err == nil {
			for _, l := range strings.Split(logOut, "\n") {
				if strings.TrimSpace(l) != "" {
					pending = append(pending, l)
				}
			}
		}
	}

	short := func(s string) string {
		if len(s) >= 7 {
			return s[:7]
		}
		return s
	}
	return map[string]interface{}{
		"currentVersion":  version,
		"localCommit":     short(localCommit),
		"remoteCommit":    short(remoteCommit),
		"updateAvailable": localCommit != remoteCommit,
		"behindBy":        behind,
		"pendingChanges":  pending,
	}
}

// ApplyUpdates ports applyUpdates.
func (u *Updater) ApplyUpdates(ctx context.Context) map[string]interface{} {
	_, _ = u.git(ctx, 15*time.Second, "stash")
	out, err := u.git(ctx, 60*time.Second, "pull", "origin", "main")
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}
	}
	npmOut := "npm install skipped (may need manual run)"
	{
		c, cancel := context.WithTimeout(ctx, 60*time.Second)
		defer cancel()
		cmd := exec.CommandContext(c, "npm", "install", "--omit=dev")
		cmd.Dir = u.root
		if o, err := cmd.Output(); err == nil {
			npmOut = strings.TrimSpace(string(o))
		}
	}
	return map[string]interface{}{
		"success":      true,
		"message":      "Update applied successfully. Please restart the server.",
		"output":       out,
		"npmOutput":    npmOut,
		"needsRestart": true,
	}
}

// GetGitInfo ports getGitInfo.
func (u *Updater) GetGitInfo(ctx context.Context) map[string]interface{} {
	branch, err := u.git(ctx, 5*time.Second, "branch", "--show-current")
	if err != nil {
		return map[string]interface{}{"error": err.Error()}
	}
	commit, _ := u.git(ctx, 5*time.Second, "rev-parse", "--short", "HEAD")
	remote, _ := u.git(ctx, 5*time.Second, "remote", "get-url", "origin")
	return map[string]interface{}{"branch": branch, "commit": commit, "remoteUrl": remote}
}

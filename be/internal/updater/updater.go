// Package updater ports backend/services/updater.js: git-based self-update.
package updater

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Updater struct{ root string }

func New(root string) *Updater { return &Updater{root: root} }

// runCommand runs name(args...) in dir and returns trimmed stdout. On
// failure, the error includes stderr so the real reason reaches the caller
// instead of a bare exit code.
func runCommand(ctx context.Context, dir string, timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			err = fmt.Errorf("%s", msg)
		}
	}
	return strings.TrimSpace(stdout.String()), err
}

// git runs a git command in the checkout root.
//
// -c safe.directory=<root> is passed on every call because home-panel is
// commonly run as root (needed for systemd/Docker management) while the
// checkout is owned by the deploying user; git's ownership check would
// otherwise refuse to touch the repo with a bare "exit status 128" and no
// other explanation. Scoping it as a per-invocation flag avoids mutating any
// user's global/system gitconfig as a side effect of running the panel.
func (u *Updater) git(ctx context.Context, timeout time.Duration, args ...string) (string, error) {
	fullArgs := append([]string{"-c", "safe.directory=" + u.root}, args...)
	return runCommand(ctx, u.root, timeout, "git", fullArgs...)
}

// currentBranch resolves the checked-out branch instead of assuming "main",
// so updates work on deployments tracking a different default branch.
func (u *Updater) currentBranch(ctx context.Context) (string, error) {
	branch, err := u.git(ctx, 5*time.Second, "branch", "--show-current")
	if err != nil {
		return "", err
	}
	if branch == "" {
		return "", fmt.Errorf("not on a branch (detached HEAD) or not a git checkout")
	}
	return branch, nil
}

// CheckForUpdates ports checkForUpdates.
func (u *Updater) CheckForUpdates(ctx context.Context) map[string]interface{} {
	if _, err := u.git(ctx, 5*time.Second, "--version"); err != nil {
		return map[string]interface{}{"error": "Git is not installed or not in PATH", "updateAvailable": false}
	}

	branch, err := u.currentBranch(ctx)
	if err != nil {
		return map[string]interface{}{"error": "Not a git checkout: " + err.Error(), "updateAvailable": false}
	}

	if _, err := u.git(ctx, 30*time.Second, "fetch", "origin", branch); err != nil {
		return map[string]interface{}{"error": "Failed to fetch from origin: " + err.Error(), "updateAvailable": false}
	}
	remoteRef := "origin/" + branch

	localCommit, err := u.git(ctx, 10*time.Second, "rev-parse", "HEAD")
	if err != nil {
		return map[string]interface{}{"error": "Check failed: " + err.Error(), "updateAvailable": false}
	}
	remoteCommit, err := u.git(ctx, 10*time.Second, "rev-parse", remoteRef)
	if err != nil {
		return map[string]interface{}{"error": fmt.Sprintf("Remote branch %s not found: %s", remoteRef, err.Error()), "updateAvailable": false}
	}
	behind := 0
	if bc, err := u.git(ctx, 10*time.Second, "rev-list", "HEAD.."+remoteRef, "--count"); err == nil {
		behind, _ = strconv.Atoi(strings.TrimSpace(bc))
	}

	pending := []string{}
	if behind > 0 {
		if logOut, err := u.git(ctx, 10*time.Second, "log", "HEAD.."+remoteRef, "--oneline", "--format=%s"); err == nil {
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
		"branch":          branch,
		"localCommit":     short(localCommit),
		"remoteCommit":    short(remoteCommit),
		"updateAvailable": localCommit != remoteCommit,
		"behindBy":        behind,
		"pendingChanges":  pending,
	}
}

// ApplyUpdates ports applyUpdates.
func (u *Updater) ApplyUpdates(ctx context.Context) map[string]interface{} {
	branch, err := u.currentBranch(ctx)
	if err != nil {
		return map[string]interface{}{"success": false, "error": "Not a git checkout: " + err.Error()}
	}

	stashOut, _ := u.git(ctx, 15*time.Second, "stash")
	stashed := !strings.Contains(stashOut, "No local changes to save")

	out, pullErr := u.git(ctx, 60*time.Second, "pull", "origin", branch)

	if stashed {
		if _, popErr := u.git(ctx, 15*time.Second, "stash", "pop"); popErr != nil {
			return map[string]interface{}{
				"success": false,
				"error":   "Update pulled but restoring local changes failed (stash left intact, run 'git stash pop' manually): " + popErr.Error(),
			}
		}
	}

	if pullErr != nil {
		return map[string]interface{}{"success": false, "error": pullErr.Error()}
	}

	result := map[string]interface{}{
		"success":      true,
		"message":      "Update applied successfully.",
		"output":       out,
		"needsRestart": true,
	}

	// Rebuild the frontend so the pulled changes are actually served, not
	// just sitting in the checkout. Skipped if there's no fe/ (e.g. a
	// backend-only deployment layout).
	frontendDir := filepath.Join(u.root, "fe")
	if _, err := os.Stat(filepath.Join(frontendDir, "package.json")); err == nil {
		// Remove any previous build output first: if an earlier build was
		// ever interrupted or failed partway through, a stale dist/ can
		// otherwise linger untouched and keep being served as "current".
		_ = os.RemoveAll(filepath.Join(frontendDir, "dist"))
		if _, err := runCommand(ctx, frontendDir, 180*time.Second, "npm", "install"); err != nil {
			result["frontendBuildError"] = "npm install failed: " + err.Error()
			return result
		}
		if _, err := runCommand(ctx, frontendDir, 120*time.Second, "npm", "run", "build"); err != nil {
			result["frontendBuildError"] = "npm run build failed: " + err.Error()
			return result
		}
		result["frontendRebuilt"] = true
	}

	return result
}

// BuildBackendBinary compiles the Go backend to outputPath. Deployments that
// run the panel via `go run` (the documented `npm start`) never need this —
// restarting the process alone re-runs the source fresh. It's only required
// when the operator instead supervises a precompiled binary at a fixed path
// (e.g. a systemd unit with ExecStart=/usr/local/bin/homepanel-go): merely
// restarting that unit just re-executes the same old binary, so the backend
// never picks up a git pull's changes without an explicit rebuild first.
// `go build -o` writes to a temp file and renames it into place, so this is
// safe to run while the old binary is still the one actively serving traffic.
func (u *Updater) BuildBackendBinary(ctx context.Context, outputPath string) (string, error) {
	beDir := filepath.Join(u.root, "be")
	return runCommand(ctx, beDir, 180*time.Second, "go", "build", "-o", outputPath, "./cmd/homepanel")
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

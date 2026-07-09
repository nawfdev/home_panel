//go:build linux

package projects

import (
	"os/exec"
	"syscall"
)

// setDetached puts the child in its own process group so we can signal the whole
// tree (matches the Node `detached: true` + process.kill(-pid) behavior).
func setDetached(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killTree kills the whole process group rooted at pid.
func killTree(pid int) error {
	return syscall.Kill(-pid, syscall.SIGTERM)
}

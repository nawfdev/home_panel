//go:build windows

package projects

import (
	"os/exec"
	"strconv"
	"syscall"
)

// setDetached creates a new process group so the child outlives request scope.
func setDetached(cmd *exec.Cmd) {
	const createNewProcessGroup = 0x00000200
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNewProcessGroup}
}

// killTree terminates the process tree with taskkill (matches the Node path).
func killTree(pid int) error {
	return exec.Command("taskkill", "/pid", strconv.Itoa(pid), "/T", "/F").Run()
}

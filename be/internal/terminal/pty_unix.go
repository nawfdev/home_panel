//go:build !windows

package terminal

import (
	"io"
	"os"
	"os/exec"

	"github.com/creack/pty"
)

type localTerminal struct {
	file *os.File
	cmd  *exec.Cmd
}

func startLocalTerminal(cols, rows uint16) (*localTerminal, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	cmd := exec.Command(shell)
	cmd.Dir, _ = os.Getwd()
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	file, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: rows, Cols: cols})
	if err != nil {
		return nil, err
	}
	return &localTerminal{file: file, cmd: cmd}, nil
}

func (t *localTerminal) Read(p []byte) (int, error)  { return t.file.Read(p) }
func (t *localTerminal) Write(p []byte) (int, error) { return t.file.Write(p) }
func (t *localTerminal) Resize(cols, rows uint16) error {
	return pty.Setsize(t.file, &pty.Winsize{Rows: rows, Cols: cols})
}
func (t *localTerminal) Wait() error { return t.cmd.Wait() }
func (t *localTerminal) Close() error {
	_ = t.file.Close()
	if t.cmd.Process != nil {
		_ = t.cmd.Process.Kill()
	}
	return nil
}

var _ io.ReadWriteCloser = (*localTerminal)(nil)

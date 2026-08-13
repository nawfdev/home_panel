//go:build windows

package terminal

import (
	"context"
	"io"
	"os"

	"github.com/UserExistsError/conpty"
)

type localTerminal struct {
	pty *conpty.ConPty
}

func startLocalTerminal(cols, rows uint16) (*localTerminal, error) {
	cwd, _ := os.Getwd()
	pty, err := conpty.Start(
		"cmd.exe",
		conpty.ConPtyDimensions(int(cols), int(rows)),
		conpty.ConPtyWorkDir(cwd),
		conpty.ConPtyEnv(os.Environ()),
	)
	if err != nil {
		return nil, err
	}
	return &localTerminal{pty: pty}, nil
}

func (t *localTerminal) Read(p []byte) (int, error)  { return t.pty.Read(p) }
func (t *localTerminal) Write(p []byte) (int, error) { return t.pty.Write(p) }
func (t *localTerminal) Resize(cols, rows uint16) error {
	return t.pty.Resize(int(cols), int(rows))
}
func (t *localTerminal) Wait() error {
	_, err := t.pty.Wait(context.Background())
	return err
}
func (t *localTerminal) Close() error { return t.pty.Close() }

var _ io.ReadWriteCloser = (*localTerminal)(nil)

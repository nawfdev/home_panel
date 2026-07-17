// Package terminal ports backend/services/terminal.js.
package terminal

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/nawfdev/home-panel/internal/session"
)

var blockedCommands = []string{
	"rm -rf /",
	"format",
	"del /f /s /q",
	"shutdown",
	"reboot",
	"mkfs",
	"dd if=",
	"> /dev/sda",
}

type Service struct {
	sessions *session.Manager
	upgrader websocket.Upgrader
}

func New(sessions *session.Manager) *Service {
	return &Service{
		sessions: sessions,
		upgrader: websocket.Upgrader{
			CheckOrigin: sameOrigin,
		},
	}
}

func (s *Service) Handler(w http.ResponseWriter, r *http.Request) {
	// RequireAuth (see server.go's route wiring) already resolved the caller
	// via cookie OR bearer token and stashed it on the request context —
	// checking the cookie again here would reject bearer-token clients
	// (Android) even though the middleware already authorized them.
	user, ok := session.FromContext(r.Context())
	if !ok {
		conn, err := s.upgrader.Upgrade(w, r, nil)
		if err == nil {
			_ = conn.WriteMessage(websocket.TextMessage, []byte("\x1b[31mError: Unauthorized via WebSocket. Please refresh.\x1b[0m"))
			_ = conn.WriteMessage(websocket.TextMessage, []byte("AUTH_FAILED"))
			_ = conn.CloseHandler()(4001, "Unauthorized")
			_ = conn.Close()
		}
		return
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	log.Printf("Terminal connected: %s", user.Username)
	isWindows := runtime.GOOS == "windows"
	write(conn, "\x1b[32m✓ Terminal connected\x1b[0m\r\n")
	write(conn, fmt.Sprintf("User: %s | Platform: %s | Shell: %s\r\n", user.Username, runtime.GOOS, shellName(isWindows)))
	write(conn, "Enter commands below:\r\n")
	write(conn, "\x1b[33m⚠️  Dangerous commands are blocked for safety\x1b[0m\r\n\r\n")

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Printf("Terminal disconnected: %s", user.Username)
			return
		}
		command := strings.TrimSpace(string(msg))
		if command == "" {
			continue
		}
		log.Printf("Terminal command [%s]: %s", user.Username, command)
		write(conn, "\x1b[36m$ "+command+"\x1b[0m\r\n")
		if command == "clear" {
			write(conn, "\x1b[2J\x1b[H")
			continue
		}
		if isDangerousCommand(command) {
			write(conn, "\x1b[31m✗ BLOCKED: This command is not allowed for security reasons\x1b[0m\r\n\r\n")
			log.Printf("Blocked dangerous terminal command [%s]: %s", user.Username, command)
			continue
		}
		runCommand(conn, command, isWindows)
	}
}

func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	return err == nil && u.Host == r.Host
}

func runCommand(conn *websocket.Conn, command string, isWindows bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	name := "bash"
	args := []string{"-c", command}
	if isWindows {
		name = "cmd"
		args = []string{"/c", command}
	}
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir, _ = os.Getwd()
	cmd.Env = os.Environ()
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if stdout.Len() > 0 {
		write(conn, stdout.String())
	}
	if stderr.Len() > 0 {
		write(conn, "\x1b[31m"+stderr.String()+"\x1b[0m")
	}
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			write(conn, fmt.Sprintf("\x1b[31m[Exit code: %d]\x1b[0m\r\n", exitErr.ExitCode()))
		} else {
			write(conn, "\x1b[31mError: "+err.Error()+"\x1b[0m\r\n")
		}
	}
	write(conn, "\r\n")
}

func write(conn *websocket.Conn, msg string) {
	_ = conn.WriteMessage(websocket.TextMessage, []byte(msg))
}

func shellName(isWindows bool) string {
	if isWindows {
		return "cmd"
	}
	return "bash"
}

func isDangerousCommand(command string) bool {
	lower := strings.ToLower(strings.TrimSpace(command))
	for _, blocked := range blockedCommands {
		if strings.Contains(lower, strings.ToLower(blocked)) {
			return true
		}
	}
	return false
}

// Package sshmgr manages SSH connections to secondary hosts (e.g. an STB)
// the panel can run commands on and browse files on, in addition to the
// machine the panel itself runs on. Authentication is key-only: the panel
// generates its own ed25519 keypair once and installs the public half into
// each target's ~/.ssh/authorized_keys during a one-time password-based
// bootstrap. No remote password or private key is ever persisted.
package sshmgr

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"

	"github.com/nawfdev/home-panel/internal/store"
)

// Manager owns the panel's SSH identity and a pool of live connections to
// configured hosts.
type Manager struct {
	store   *store.Store
	keyPath string

	mu     sync.Mutex
	signer ssh.Signer
	pool   map[int]*ssh.Client
}

// New creates a Manager. root is the panel's data directory root (the same
// root config.ResolvePaths uses); the keypair is stored as
// <root>/data/panel_id_ed25519(.pub).
func New(st *store.Store, root string) *Manager {
	return &Manager{
		store:   st,
		keyPath: filepath.Join(root, "data", "panel_id_ed25519"),
		pool:    make(map[int]*ssh.Client),
	}
}

// ensureKey lazily generates the panel's ed25519 keypair on first use and
// caches the signer in memory.
func (m *Manager) ensureKey() (ssh.Signer, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.signer != nil {
		return m.signer, nil
	}

	if b, err := os.ReadFile(m.keyPath); err == nil {
		signer, err := ssh.ParsePrivateKey(b)
		if err != nil {
			return nil, fmt.Errorf("parse existing panel ssh key: %w", err)
		}
		m.signer = signer
		return m.signer, nil
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("read panel ssh key: %w", err)
	}

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate panel ssh key: %w", err)
	}
	block, err := ssh.MarshalPrivateKey(priv, "homepanel")
	if err != nil {
		return nil, fmt.Errorf("marshal panel ssh key: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(m.keyPath), 0o700); err != nil {
		return nil, fmt.Errorf("create ssh key dir: %w", err)
	}
	if err := os.WriteFile(m.keyPath, pem.EncodeToMemory(block), 0o600); err != nil {
		return nil, fmt.Errorf("write panel ssh key: %w", err)
	}
	sshPub, err := ssh.NewPublicKey(pub)
	if err != nil {
		return nil, fmt.Errorf("derive panel ssh public key: %w", err)
	}
	if err := os.WriteFile(m.keyPath+".pub", ssh.MarshalAuthorizedKey(sshPub), 0o644); err != nil {
		return nil, fmt.Errorf("write panel ssh public key: %w", err)
	}

	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		return nil, fmt.Errorf("create panel ssh signer: %w", err)
	}
	m.signer = signer
	return m.signer, nil
}

// PublicKeyLine returns the panel's public key in authorized_keys format,
// generating the keypair first if needed.
func (m *Manager) PublicKeyLine() (string, error) {
	signer, err := m.ensureKey()
	if err != nil {
		return "", err
	}
	return string(bytes.TrimSpace(ssh.MarshalAuthorizedKey(signer.PublicKey()))), nil
}

func addr(h store.Host) string {
	port := h.Port
	if port == 0 {
		port = 22
	}
	return net.JoinHostPort(h.Address, strconv.Itoa(port))
}

// client returns a pooled, connected ssh.Client for host, dialing a fresh
// one if none is cached or the cached one is dead.
func (m *Manager) client(host store.Host) (*ssh.Client, error) {
	signer, err := m.ensureKey()
	if err != nil {
		return nil, err
	}

	m.mu.Lock()
	if c, ok := m.pool[host.ID]; ok {
		m.mu.Unlock()
		if _, _, err := c.SendRequest("keepalive@homepanel", true, nil); err == nil {
			return c, nil
		}
		m.mu.Lock()
		delete(m.pool, host.ID)
	}
	m.mu.Unlock()

	cfg := &ssh.ClientConfig{
		User:            host.User,
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // trusted LAN, matches this app's existing threat model
		Timeout:         10 * time.Second,
	}
	c, err := ssh.Dial("tcp", addr(host), cfg)
	if err != nil {
		return nil, fmt.Errorf("connect to %s: %w", host.Name, err)
	}

	m.mu.Lock()
	m.pool[host.ID] = c
	m.mu.Unlock()
	return c, nil
}

// Remove closes and evicts any pooled connection for hostID.
func (m *Manager) Remove(hostID int) {
	m.mu.Lock()
	c, ok := m.pool[hostID]
	delete(m.pool, hostID)
	m.mu.Unlock()
	if ok {
		_ = c.Close()
	}
}

// RunCommand runs command on host via a single SSH exec channel, returning
// captured stdout/stderr and the remote exit code, honoring ctx cancellation.
func (m *Manager) RunCommand(ctx context.Context, host store.Host, command string) (stdout, stderr string, exitCode int, err error) {
	c, err := m.client(host)
	if err != nil {
		return "", "", -1, err
	}
	sess, err := c.NewSession()
	if err != nil {
		return "", "", -1, fmt.Errorf("open ssh session: %w", err)
	}
	defer sess.Close()

	var outBuf, errBuf bytes.Buffer
	sess.Stdout = &outBuf
	sess.Stderr = &errBuf

	done := make(chan error, 1)
	go func() { done <- sess.Run(command) }()

	select {
	case <-ctx.Done():
		_ = sess.Close()
		return outBuf.String(), errBuf.String(), -1, ctx.Err()
	case runErr := <-done:
		if runErr == nil {
			return outBuf.String(), errBuf.String(), 0, nil
		}
		if exitErr, ok := runErr.(*ssh.ExitError); ok {
			return outBuf.String(), errBuf.String(), exitErr.ExitStatus(), nil
		}
		return outBuf.String(), errBuf.String(), -1, runErr
	}
}

// NetworkInfo returns a Linux host's network snapshot over the existing SSH
// connection. Each section is length-prefixed so command output cannot be
// confused with a delimiter appearing in interface, DNS, or route data.
func (m *Manager) NetworkInfo(ctx context.Context, host store.Host) (addresses, routes, resolvConf, netDev string, err error) {
	const command = `command -v ip >/dev/null 2>&1 && { ip -j address 2>/dev/null || ip address; } > /tmp/homepanel-net-addresses; command -v ip >/dev/null 2>&1 && ip route 2>/dev/null > /tmp/homepanel-net-routes; for f in /proc/net/dev /etc/resolv.conf /tmp/homepanel-net-addresses /tmp/homepanel-net-routes; do if [ -r "$f" ]; then wc -c < "$f"; cat "$f"; else printf '0\n'; fi; done`
	stdout, stderr, exitCode, err := m.RunCommand(ctx, host, command)
	if err != nil {
		return "", "", "", "", err
	}
	if exitCode != 0 {
		return "", "", "", "", fmt.Errorf("collect network info: exit code %d: %s", exitCode, strings.TrimSpace(stderr))
	}

	readSection := func(input string) (section, rest string, parseErr error) {
		lineEnd := strings.IndexByte(input, '\n')
		if lineEnd < 0 {
			return "", "", fmt.Errorf("missing section length")
		}
		length, parseErr := strconv.Atoi(strings.TrimSpace(input[:lineEnd]))
		if parseErr != nil || length < 0 {
			return "", "", fmt.Errorf("invalid section length %q", input[:lineEnd])
		}
		input = input[lineEnd+1:]
		if len(input) < length {
			return "", "", fmt.Errorf("short section: got %d bytes, want %d", len(input), length)
		}
		return input[:length], input[length:], nil
	}

	netDev, stdout, err = readSection(stdout)
	if err != nil {
		return "", "", "", "", fmt.Errorf("parse /proc/net/dev: %w", err)
	}
	resolvConf, stdout, err = readSection(stdout)
	if err != nil {
		return "", "", "", "", fmt.Errorf("parse /etc/resolv.conf: %w", err)
	}
	addresses, stdout, err = readSection(stdout)
	if err != nil {
		return "", "", "", "", fmt.Errorf("parse addresses: %w", err)
	}
	routes, _, err = readSection(stdout)
	if err != nil {
		return "", "", "", "", fmt.Errorf("parse routes: %w", err)
	}
	return strings.TrimSpace(addresses), strings.TrimSpace(routes), resolvConf, netDev, nil
}

// SFTPClient returns a new SFTP client bound to a pooled connection for host.
// Callers must Close() it when done.
func (m *Manager) SFTPClient(host store.Host) (*sftp.Client, error) {
	c, err := m.client(host)
	if err != nil {
		return nil, err
	}
	return sftp.NewClient(c)
}

// Bootstrap installs the panel's public key into the target's
// ~/.ssh/authorized_keys using the supplied one-time password, verifies
// key-based auth then works, and persists the host (without the password).
// The password never touches disk or the store.
func (m *Manager) Bootstrap(ctx context.Context, name, address string, port int, user, password string) (store.Host, error) {
	pubLine, err := m.PublicKeyLine()
	if err != nil {
		return store.Host{}, err
	}
	if port == 0 {
		port = 22
	}
	h := store.Host{Name: name, Address: address, Port: port, User: user}

	// Prefer the documented password bootstrap. If password auth is disabled
	// but this panel key was already installed manually, key auth is enough to
	// verify ownership and enroll the host without retaining any credential.
	var passwordErr error
	if password != "" {
		cfg := &ssh.ClientConfig{
			User:            user,
			Auth:            []ssh.AuthMethod{ssh.Password(password)},
			HostKeyCallback: ssh.InsecureIgnoreHostKey(),
			Timeout:         10 * time.Second,
		}
		dialCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		var d net.Dialer
		rawConn, dialErr := d.DialContext(dialCtx, "tcp", addr(h))
		if dialErr != nil {
			return store.Host{}, fmt.Errorf("could not reach %s: %w", addr(h), dialErr)
		}
		sshConn, chans, reqs, authErr := ssh.NewClientConn(rawConn, addr(h), cfg)
		if authErr == nil {
			pwClient := ssh.NewClient(sshConn, chans, reqs)
			sess, sessionErr := pwClient.NewSession()
			if sessionErr != nil {
				_ = pwClient.Close()
				return store.Host{}, fmt.Errorf("open ssh session: %w", sessionErr)
			}
			installCmd := fmt.Sprintf(
				`mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF %s ~/.ssh/authorized_keys || printf '%%s\n' %s >> ~/.ssh/authorized_keys`,
				shellQuote(pubLine), shellQuote(pubLine),
			)
			var errBuf bytes.Buffer
			sess.Stderr = &errBuf
			if runErr := sess.Run(installCmd); runErr != nil {
				_ = sess.Close()
				_ = pwClient.Close()
				return store.Host{}, fmt.Errorf("could not install panel key on target: %v (%s)", runErr, errBuf.String())
			}
			_ = sess.Close()
			_ = pwClient.Close()
		} else {
			_ = rawConn.Close()
			passwordErr = authErr
		}
	}

	if _, err := m.client(h); err != nil {
		if passwordErr != nil {
			return store.Host{}, fmt.Errorf("could not authenticate with the provided password and the panel key is not installed: %v", passwordErr)
		}
		return store.Host{}, fmt.Errorf("key-based login failed: %w", err)
	}

	id, err := m.store.InsertHost(h)
	if err != nil {
		return store.Host{}, err
	}
	h.ID = id
	return h, nil
}

// shellQuote wraps s in single quotes for safe inclusion in a POSIX shell
// command, escaping any embedded single quotes. pubLine is panel-generated
// (not user input) but this is applied defensively regardless.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

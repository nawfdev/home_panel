// Package music runs go-librespot (an open-source Spotify Connect client:
// https://github.com/devgianlu/go-librespot) as a supervised child process,
// so this server shows up as a "speaker" any Spotify app on the network can
// cast to — using the account's own Spotify Premium subscription, over
// Spotify's own Connect protocol. Nothing here downloads, caches, or scrapes
// music; go-librespot streams whatever the user picks from their own
// Spotify session, exactly as the official app would.
//
// go-librespot exposes a local REST+WebSocket API (status, transport
// controls, and a verbatim proxy to api.spotify.com for search/playlists
// using the session's own token) that Service.Handler reverse-proxies
// as-is. The one thing it does NOT expose over HTTP is decoded audio — for
// that, go-librespot writes raw PCM to a FIFO (the "pipe" backend), which a
// supervised ffmpeg process here transcodes to a live MP3 stream and fans
// out to every connected browser tab via broadcaster, so the panel's
// persistent mini-player can just point an <audio> element at it.
package music

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

// apiPort is fixed (not dynamically allocated like aria2's) because this is
// a long-lived singleton service, not spawned per-operation — a fixed,
// loopback-only port keeps the reverse-proxy wiring in Handler simple with
// no runtime port discovery needed.
const apiPort = 9691

// Service supervises one go-librespot process plus the ffmpeg relay that
// turns its raw audio pipe into a stream browsers can play. Safe for
// concurrent use; zero value is not usable, construct with New.
type Service struct {
	binPath   string
	configDir string
	pipePath  string
	proxy     http.Handler
	bc        *broadcaster

	mu      sync.Mutex
	started bool
	cancel  context.CancelFunc
}

// New builds a Service. dataDir is the panel's data directory (config and
// Spotify credentials are stored under dataDir/music); binPath is the path
// to the go-librespot binary. Start does nothing until called.
func New(dataDir, binPath string) *Service {
	target, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", apiPort))
	return &Service{
		binPath:   binPath,
		configDir: filepath.Join(dataDir, "music"),
		pipePath:  filepath.Join(dataDir, "music", "audio.pipe"),
		proxy:     httputil.NewSingleHostReverseProxy(target),
		bc:        newBroadcaster(),
	}
}

// Available reports whether the go-librespot binary is present, the same
// "optional dependency" pattern as aria2.Available/ffmpegAvailable — the
// music feature simply doesn't come up if it's missing, rather than the
// whole panel failing to start.
func (s *Service) Available() bool {
	if s.binPath == "" {
		return false
	}
	info, err := os.Stat(s.binPath)
	return err == nil && !info.IsDir()
}

// Handler reverse-proxies everything to go-librespot's local API —
// /status, /player/*, /token, /set_device_name, /web-api/* (itself proxied
// by go-librespot to api.spotify.com with the session's bearer token), and
// /events, whose WebSocket upgrade httputil.ReverseProxy forwards
// transparently (raw bidirectional copy) without any extra code here.
func (s *Service) Handler() http.Handler { return s.proxy }

// StreamAudio subscribes the request to the live audio broadcast and
// streams MP3 chunks until the client disconnects. Every connected browser
// tab hears whatever is currently playing — like an internet radio relay,
// not a per-listener session — since Spotify Connect only ever streams one
// decoded audio feed to this device at a time.
func (s *Service) StreamAudio(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	ch := s.bc.subscribe()
	defer s.bc.unsubscribe(ch)

	w.Header().Set("Content-Type", "audio/mpeg")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case chunk, ok := <-ch:
			if !ok {
				return
			}
			if _, err := w.Write(chunk); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// Start is idempotent: calling it again while already running is a no-op.
// It writes go-librespot's config, creates the audio FIFO, and launches two
// independent supervision loops (go-librespot itself, and the ffmpeg relay
// reading its pipe) that each restart their process on crash. Returns once
// setup succeeds; the processes come up in the background.
func (s *Service) Start(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started {
		return nil
	}
	if !s.Available() {
		return fmt.Errorf("music: go-librespot binary not found at %s", s.binPath)
	}
	if err := os.MkdirAll(s.configDir, 0o700); err != nil {
		return fmt.Errorf("music: couldn't create config dir: %w", err)
	}
	if err := os.WriteFile(filepath.Join(s.configDir, "config.yml"), []byte(s.configYAML()), 0o600); err != nil {
		return fmt.Errorf("music: couldn't write config: %w", err)
	}
	_ = os.Remove(s.pipePath) // stale FIFO from a previous run — mkfifo fails if it already exists
	if err := mkfifo(s.pipePath, 0o600); err != nil {
		return fmt.Errorf("music: couldn't create audio pipe: %w", err)
	}

	runCtx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	s.started = true
	go s.superviseLibrespot(runCtx)
	go s.superviseFFmpeg(runCtx)
	return nil
}

// Stop terminates both supervised processes and stops restarting them.
func (s *Service) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.started {
		return
	}
	s.cancel()
	s.started = false
}

func (s *Service) superviseLibrespot(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		cmd := exec.CommandContext(ctx, s.binPath, "--config_dir", s.configDir)
		cmd.Stdout = logPrefixWriter("go-librespot")
		cmd.Stderr = cmd.Stdout
		if err := cmd.Start(); err != nil {
			log.Printf("music: couldn't start go-librespot: %v", err)
		} else {
			_ = cmd.Wait()
			if ctx.Err() != nil {
				return
			}
			log.Println("music: go-librespot exited, restarting in 3s")
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(3 * time.Second):
		}
	}
}

// superviseFFmpeg keeps a transcoder attached to the audio FIFO, translating
// go-librespot's raw PCM (44.1kHz stereo signed 16-bit little-endian —
// Spotify's own source format, matching audio_output_pipe_format: s16le in
// configYAML) into a live MP3 stream fed to broadcaster.run. Opening the
// FIFO for reading blocks here until go-librespot (or the next restart of
// it) opens the other end for writing — normal named-pipe behavior, not a
// bug — so starting this loop before go-librespot is up is fine.
func (s *Service) superviseFFmpeg(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		cmd := exec.CommandContext(ctx, "ffmpeg",
			"-loglevel", "error",
			"-f", "s16le", "-ar", "44100", "-ac", "2", "-i", s.pipePath,
			"-f", "mp3", "-b:a", "192k", "-",
		)
		cmd.Stderr = logPrefixWriter("music-ffmpeg")
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			log.Printf("music: couldn't attach ffmpeg stdout: %v", err)
		} else if err := cmd.Start(); err != nil {
			log.Printf("music: couldn't start ffmpeg relay: %v", err)
		} else {
			s.bc.run(stdout)
			_ = cmd.Wait()
			if ctx.Err() != nil {
				return
			}
			log.Println("music: audio relay exited, restarting in 2s")
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

// mkfifo creates a named pipe. Wrapped so the syscall (POSIX-only) stays in
// one place; this package is Linux-server-only regardless (go-librespot's
// pipe backend and ffmpeg are both invoked as external processes).
func mkfifo(path string, mode uint32) error {
	return syscall.Mkfifo(path, mode)
}

// configYAML is go-librespot's config, hand-written (no dependency needed
// for a handful of flat keys — see config_schema.json in the go-librespot
// repo for the full schema). Zeroconf + persist_credentials means the only
// setup step is opening Spotify on any phone/desktop on the LAN, tapping
// the devices icon, and selecting this device once — no manual OAuth flow,
// no client ID/secret to register.
func (s *Service) configYAML() string {
	return `device_name: Nestcore
device_type: speaker
audio_backend: pipe
audio_output_pipe: ` + s.pipePath + `
audio_output_pipe_format: s16le
audio_output_pipe_wait_for_reader: true
bitrate: 320
zeroconf_enabled: true
credentials:
  type: zeroconf
  zeroconf:
    persist_credentials: true
server:
  enabled: true
  address: 127.0.0.1
  port: ` + fmt.Sprintf("%d", apiPort) + `
`
}

// logPrefixWriter tags every line from a supervised child process's
// stdout/stderr with a short prefix before forwarding it to the panel's own
// logger, so go-librespot/ffmpeg output is distinguishable in panel.log
// without needing its own log file.
func logPrefixWriter(prefix string) io.Writer {
	pr, pw := io.Pipe()
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := pr.Read(buf)
			if n > 0 {
				log.Printf("[%s] %s", prefix, buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()
	return pw
}

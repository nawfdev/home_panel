package movies

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/nawfdev/home-panel/internal/aria2"
	filesvc "github.com/nawfdev/home-panel/internal/files"
)

// Service owns the download queue. It has no store dependency: the save
// directory is derived from the OS (under the existing SafePath allowlist) so
// finished files immediately appear in the file manager, player and shares.
type Service struct {
	mu    sync.Mutex
	jobs  map[string]*Job
	seq   int
	aria2 *aria2.Manager
}

func New() *Service {
	return &Service{jobs: make(map[string]*Job), aria2: aria2.New()}
}

// Shutdown stops the aria2c child process (if one was ever spawned). Called
// from main.go's graceful shutdown sequence.
func (s *Service) Shutdown() {
	s.aria2.Shutdown()
}

// downloadClient fetches movie files. Unlike httpClient (used for scraping,
// 30s total timeout), files can take much longer than 30s to download, so
// there's no overall Timeout here — jobs are stopped via context cancel
// instead. DialContext resolves the host itself and refuses to connect to
// loopback/private/link-local addresses, so an authenticated user can't use
// the downloader as an SSRF pivot into the local network; this check re-runs
// on every redirect hop since each one dials again.
var downloadClient = &http.Client{
	Transport: &http.Transport{
		DialContext:           safeDialContext,
		ResponseHeaderTimeout: 30 * time.Second,
	},
}

func safeDialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	var ip net.IP
	for _, candidate := range ips {
		if isDisallowedIP(candidate) {
			continue
		}
		ip = candidate
		break
	}
	if ip == nil {
		return nil, fmt.Errorf("refusing to connect to %s: resolves only to disallowed addresses", host)
	}
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
}

func isDisallowedIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}

// checkHostAllowed is a fast pre-check so an obviously-local URL (e.g.
// http://127.0.0.1/x or http://localhost:8080) is rejected synchronously in
// Start() instead of only failing later inside the job goroutine. The
// authoritative check is still safeDialContext, which also covers redirects.
func checkHostAllowed(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	ips, err := net.LookupIP(u.Hostname())
	if err != nil {
		return nil // let the real request surface the DNS error
	}
	for _, ip := range ips {
		if !isDisallowedIP(ip) {
			return nil
		}
	}
	return fmt.Errorf("refusing to download from %s: resolves only to a local/private address", u.Hostname())
}

// Status is the lifecycle of a download job.
type Status string

const (
	StatusQueued      Status = "queued"
	StatusDownloading Status = "downloading"
	StatusRemuxing    Status = "remuxing"
	StatusDone        Status = "done"
	StatusError       Status = "error"
	StatusCanceled    Status = "canceled"
)

// Job is one download. Progress fields are read under the service lock via
// snapshot(); the downloader goroutine updates them the same way.
type Job struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	URL         string    `json:"url"`
	Dest        string    `json:"dest"`
	Status      Status    `json:"status"`
	Downloaded  int64     `json:"downloaded"`
	Total       int64     `json:"total"`
	SpeedBps    int64     `json:"speedBps"`
	Error       string    `json:"error,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	cancel      context.CancelFunc
	gid         string // aria2 job id; empty when using the fallback downloader
}

// MoviesDir returns the on-disk directory movies are saved to, creating it if
// needed. It sits under the SafePath allowlist (C:\Users\... on Windows,
// /home/... elsewhere) so the rest of the panel serves it for free.
func MoviesDir() (string, error) {
	var base string
	if runtime.GOOS == "windows" {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			base = `C:\Users`
		} else {
			base = home
		}
	} else {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			base = "/home"
		} else {
			base = home
		}
	}
	dir := filepath.Join(base, "Movies")
	// Validate against the same allowlist the player/share use.
	safe, err := filesvc.SafePath(dir)
	if err != nil {
		return "", fmt.Errorf("movies dir not in allowed path: %w", err)
	}
	if err := os.MkdirAll(safe, 0o755); err != nil {
		return "", err
	}
	return safe, nil
}

var reUnsafeName = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]`)

// safeFilename turns a title + URL into a safe .mp4 filename.
func safeFilename(title, rawURL string) string {
	name := strings.TrimSpace(title)
	if name == "" {
		// Fall back to the URL's last path segment.
		if i := strings.LastIndexByte(rawURL, '/'); i >= 0 {
			name = rawURL[i+1:]
		}
		if q := strings.IndexByte(name, '?'); q >= 0 {
			name = name[:q]
		}
	}
	if name == "" {
		name = "movie"
	}
	name = reUnsafeName.ReplaceAllString(name, "_")
	if len(name) > 150 {
		name = name[:150]
	}
	ext := strings.ToLower(filepath.Ext(name))
	if ext != ".mp4" && ext != ".mkv" && ext != ".webm" {
		name += ".mp4"
	}
	return name
}

// Start enqueues a download from a direct/simple link. Shortener links
// (oii.la/tpi.li) are rejected in Fase 1 with a clear message so the UI can
// tell the user to resolve them manually until Fase 2 lands.
func (s *Service) Start(title, rawURL string) (*Job, error) {
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		return nil, errors.New("download link must be an http(s) URL")
	}
	if isShortener(rawURL) {
		return nil, fmt.Errorf("this link goes through a shortener (%s) which needs manual resolving in Fase 1; open it in your browser, copy the direct file link, and paste that", shortenerHost(rawURL))
	}
	if err := checkHostAllowed(rawURL); err != nil {
		return nil, err
	}
	dir, err := MoviesDir()
	if err != nil {
		return nil, err
	}
	filename := safeFilename(title, rawURL)
	dest := filepath.Join(dir, filename)

	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.seq++
	job := &Job{
		ID:        fmt.Sprintf("dl-%d-%d", time.Now().Unix(), s.seq),
		Title:     title,
		URL:       rawURL,
		Dest:      dest,
		Status:    StatusQueued,
		CreatedAt: time.Now(),
		cancel:    cancel,
	}
	s.jobs[job.ID] = job
	s.mu.Unlock()

	// Prefer aria2 (resumable, multi-connection) when it's on PATH. If it's
	// missing, or fails to start/accept the job, fall back to the built-in
	// single-connection downloader so a broken aria2 install never breaks
	// downloads outright.
	if aria2.Available {
		if err := s.aria2.EnsureRunning(); err == nil {
			if gid, err := s.aria2.AddURI(rawURL, dir, filename); err == nil {
				job.gid = gid
				go s.pollAria2(ctx, job)
				return job.snapshot(), nil
			}
		}
	}

	go s.run(ctx, job)
	return job.snapshot(), nil
}

func (s *Service) run(ctx context.Context, job *Job) {
	s.set(job, func(j *Job) { j.Status = StatusDownloading })

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, job.URL, nil)
	if err != nil {
		s.fail(job, err)
		return
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := downloadClient.Do(req)
	if err != nil {
		s.fail(job, err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		s.fail(job, fmt.Errorf("host returned HTTP %d", resp.StatusCode))
		return
	}
	// If the host serves HTML (a captcha/landing page) instead of a file, bail
	// with a clear message rather than saving a garbage .mp4.
	ct := strings.ToLower(resp.Header.Get("Content-Type"))
	if strings.Contains(ct, "text/html") {
		s.fail(job, errors.New("link returned an HTML page, not a video file (likely a captcha/landing page); resolve it manually and paste the direct file link"))
		return
	}
	s.set(job, func(j *Job) { j.Total = resp.ContentLength })

	tmp := job.Dest + ".part"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		s.fail(job, err)
		return
	}

	err = s.copyWithProgress(ctx, job, out, resp.Body)
	closeErr := out.Close()
	if err != nil {
		os.Remove(tmp)
		if errors.Is(err, context.Canceled) {
			s.set(job, func(j *Job) { j.Status = StatusCanceled })
			return
		}
		s.fail(job, err)
		return
	}
	if closeErr != nil {
		os.Remove(tmp)
		s.fail(job, closeErr)
		return
	}
	if err := os.Rename(tmp, job.Dest); err != nil {
		s.fail(job, err)
		return
	}

	s.finish(job)
}

// finish runs the post-download pipeline shared by both download engines:
// faststart remux (streaming-friendly moov atom placement) and mkv-embedded
// subtitle extraction, both best-effort, then marks the job done.
func (s *Service) finish(job *Job) {
	s.set(job, func(j *Job) { j.Status = StatusRemuxing })
	if ext := strings.ToLower(filepath.Ext(job.Dest)); ext == ".mp4" || ext == ".mov" || ext == ".m4v" {
		if err := filesvc.RemuxFaststart(job.Dest); err != nil {
			log.Printf("movies: faststart remux skipped for %s: %v", job.Dest, err)
		}
	}
	// Best-effort: pull any subtitle tracks muxed inside the container (common
	// for .mkv) out into sidecar .srt files so the player's existing
	// DetectSubtitles picks them up with no further wiring.
	if err := filesvc.ExtractEmbeddedSubtitles(job.Dest); err != nil {
		log.Printf("movies: subtitle extract skipped for %s: %v", job.Dest, err)
	}
	s.set(job, func(j *Job) { j.Status = StatusDone })
}

// pollAria2 tracks a download handed off to aria2, translating its RPC
// status into the same Job fields copyWithProgress updates for the fallback
// downloader — DownloadsStream needs no changes to serve either engine.
func (s *Service) pollAria2(ctx context.Context, job *Job) {
	s.set(job, func(j *Job) { j.Status = StatusDownloading })
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			_ = os.Remove(job.Dest)
			s.set(job, func(j *Job) { j.Status = StatusCanceled })
			return
		case <-ticker.C:
		}

		st, err := s.aria2.Status(job.gid)
		if err != nil {
			s.fail(job, err)
			return
		}
		s.set(job, func(j *Job) {
			j.Downloaded = st.CompletedLength
			j.Total = st.TotalLength
			j.SpeedBps = st.DownloadSpeed
		})

		switch st.State {
		case "complete":
			// Unlike the fallback downloader (which checks Content-Type before
			// ever writing to disk), aria2 writes the full response body
			// itself, so the HTML/captcha guard has to run after the fact here.
			if err := sniffHTML(job.Dest); err != nil {
				os.Remove(job.Dest)
				s.fail(job, err)
				return
			}
			s.finish(job)
			return
		case "error":
			msg := st.ErrorMessage
			if msg == "" {
				msg = "aria2 download failed"
			}
			s.fail(job, errors.New(msg))
			return
		case "removed":
			s.set(job, func(j *Job) { j.Status = StatusCanceled })
			return
		}
	}
}

// sniffHTML reports an error if path's first bytes look like an HTML page
// rather than a video file — the same captcha/landing-page guard the
// fallback downloader applies to the live HTTP response, reapplied here
// after the fact since aria2 already wrote the full file to disk.
func sniffHTML(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	buf := make([]byte, 512)
	n, _ := f.Read(buf)
	if strings.Contains(http.DetectContentType(buf[:n]), "text/html") {
		return errors.New("link returned an HTML page, not a video file (likely a captcha/landing page); resolve it manually and paste the direct file link")
	}
	return nil
}

// copyWithProgress streams src->dst while updating job progress and honoring
// cancellation. Speed is a rolling per-second sample.
func (s *Service) copyWithProgress(ctx context.Context, job *Job, dst io.Writer, src io.Reader) error {
	buf := make([]byte, 256*1024)
	var lastTick = time.Now()
	var lastBytes int64
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		n, rerr := src.Read(buf)
		if n > 0 {
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return werr
			}
			now := time.Now()
			s.set(job, func(j *Job) {
				j.Downloaded += int64(n)
				if elapsed := now.Sub(lastTick).Seconds(); elapsed >= 1 {
					j.SpeedBps = int64(float64(j.Downloaded-lastBytes) / elapsed)
					lastTick = now
					lastBytes = j.Downloaded
				}
			})
		}
		if rerr == io.EOF {
			return nil
		}
		if rerr != nil {
			return rerr
		}
	}
}

// Cancel stops an in-flight job. Finished/errored jobs are a no-op.
func (s *Service) Cancel(id string) error {
	s.mu.Lock()
	job, ok := s.jobs[id]
	s.mu.Unlock()
	if !ok {
		return errors.New("download not found")
	}
	if job.gid != "" {
		_ = s.aria2.Remove(job.gid)
	}
	if job.cancel != nil {
		job.cancel()
	}
	return nil
}

// List returns a snapshot of all jobs, newest first.
func (s *Service) List() []*Job {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Job, 0, len(s.jobs))
	for _, j := range s.jobs {
		out = append(out, j.snapshot())
	}
	// newest first
	for i := 0; i < len(out); i++ {
		for k := i + 1; k < len(out); k++ {
			if out[k].CreatedAt.After(out[i].CreatedAt) {
				out[i], out[k] = out[k], out[i]
			}
		}
	}
	return out
}

func (s *Service) set(job *Job, fn func(*Job)) {
	s.mu.Lock()
	fn(job)
	s.mu.Unlock()
}

func (s *Service) fail(job *Job, err error) {
	s.set(job, func(j *Job) {
		j.Status = StatusError
		j.Error = err.Error()
	})
}

// snapshot copies the job under the assumption the caller holds the lock, or
// for a standalone read takes it. It returns a value safe to serialize.
func (j *Job) snapshot() *Job {
	cp := *j
	cp.cancel = nil
	return &cp
}

func isShortener(u string) bool {
	h := shortenerHost(u)
	return h != ""
}

// This list is inherently a step behind: pahe.ink's redirector domain has
// already changed at least once (oii.la/tpi.li -> teknoasian.com) since this
// was first written, and will likely rotate again. It's only a fast-path
// pre-check for a clearer error message; the real safety net is in run(),
// which refuses to save the file if the host responds with an HTML page
// instead of video bytes.
func shortenerHost(u string) string {
	for _, s := range []string{"oii.la", "tpi.li", "ouo.io", "safelinku", "linkvertise", "teknoasian.com"} {
		if strings.Contains(u, s) {
			return s
		}
	}
	return ""
}

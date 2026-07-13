package files

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ffprobeAvailable caches whether ffprobe is on PATH, same pattern as
// ffmpegAvailable in remux.go. ffprobe ships alongside ffmpeg in virtually
// every distribution, so this is gated on the same optional dependency.
var ffprobeAvailable = func() bool {
	_, err := exec.LookPath("ffprobe")
	return err == nil
}()

type probeStreams struct {
	Streams []struct {
		Index int `json:"index"`
		Tags  struct {
			Language string `json:"language"`
		} `json:"tags"`
	} `json:"streams"`
}

// ExtractEmbeddedSubtitles pulls subtitle tracks muxed inside a video
// container (e.g. .mkv) out into sidecar .srt files next to it, so the
// existing sidecar-based DetectSubtitles/player pipeline picks them up with
// no further wiring. Best-effort: any failure is logged and swallowed,
// mirroring how RemuxFaststart's caller treats remux failures.
func ExtractEmbeddedSubtitles(path string) error {
	if !ffprobeAvailable || MediaType(path) != "video" {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ffprobe",
		"-v", "quiet", "-print_format", "json", "-show_streams", "-select_streams", "s",
		path,
	).Output()
	if err != nil {
		return fmt.Errorf("ffprobe: %w", err)
	}

	var probe probeStreams
	if err := json.Unmarshal(out, &probe); err != nil {
		return fmt.Errorf("ffprobe output: %w", err)
	}
	if len(probe.Streams) == 0 {
		return nil
	}

	existing := map[string]bool{}
	for _, s := range DetectSubtitles(path) {
		nameNoExt := strings.TrimSuffix(s.Name, filepath.Ext(s.Name))
		existing[strings.ToLower(nameNoExt)] = true
	}

	dir := filepath.Dir(path)
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))

	seenLabels := map[string]int{}
	for _, stream := range probe.Streams {
		label := strings.TrimSpace(stream.Tags.Language)
		if label == "" {
			label = fmt.Sprintf("sub%d", stream.Index)
		}
		seenLabels[label]++
		if n := seenLabels[label]; n > 1 {
			label = fmt.Sprintf("%s%d", label, n)
		}
		if existing[strings.ToLower(base+"."+label)] {
			continue // a sidecar with this label already exists
		}

		dest := filepath.Join(dir, base+"."+label+".srt")
		extractCtx, extractCancel := context.WithTimeout(context.Background(), 5*time.Minute)
		cmd := exec.CommandContext(extractCtx, "ffmpeg",
			"-y", "-i", path,
			"-map", fmt.Sprintf("0:%d", stream.Index),
			"-c:s", "srt",
			dest,
		)
		runErr := cmd.Run()
		extractCancel()
		if runErr != nil {
			log.Printf("subtitle extract skipped for %s stream %d: %v", path, stream.Index, runErr)
		}
	}
	return nil
}

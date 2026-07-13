package files

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// browserSafeVideoCodecs / browserSafeAudioCodecs are codecs every mainstream
// browser (Chrome/Firefox/Safari/Edge) can decode natively in <video>,
// regardless of container. Anything outside these sets needs a real
// transcode, not just a container rewrap, to play in a browser at all.
var browserSafeVideoCodecs = map[string]bool{
	"h264": true, "hevc": true, "vp8": true, "vp9": true, "av1": true,
}
var browserSafeAudioCodecs = map[string]bool{
	"aac": true, "opus": true, "vorbis": true, "mp3": true,
}

// browserSafeContainers: even with safe codecs, some browsers' native
// demuxers for these containers are unreliable (e.g. Chromium's Matroska
// demuxer doesn't consistently pass through multichannel AAC) — so anything
// outside this set gets rewrapped into .mp4 regardless of its codecs.
var browserSafeContainers = map[string]bool{
	".mp4": true, ".m4v": true, ".webm": true, ".mov": true,
}

type probeCodecStream struct {
	CodecType string `json:"codec_type"`
	CodecName string `json:"codec_name"`
}
type probeCodecsOutput struct {
	Streams []probeCodecStream `json:"streams"`
}

// probeCodecs returns the first video and audio codec name ffprobe reports
// for path (e.g. "h264", "aac", "ac3"). Either can come back empty if the
// file has no such stream.
func probeCodecs(path string) (videoCodec, audioCodec string, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ffprobe",
		"-v", "quiet", "-print_format", "json", "-show_entries", "stream=codec_type,codec_name",
		path,
	).Output()
	if err != nil {
		return "", "", fmt.Errorf("ffprobe: %w", err)
	}
	var probe probeCodecsOutput
	if err := json.Unmarshal(out, &probe); err != nil {
		return "", "", fmt.Errorf("ffprobe output: %w", err)
	}
	for _, s := range probe.Streams {
		switch s.CodecType {
		case "video":
			if videoCodec == "" {
				videoCodec = s.CodecName
			}
		case "audio":
			if audioCodec == "" {
				audioCodec = s.CodecName
			}
		}
	}
	return videoCodec, audioCodec, nil
}

// EnsureWebPlayable checks whether path's container+codecs are safe to play
// directly in a browser and, if not, produces a ".web.mp4" sibling next to
// it (same basename) that is — without touching or replacing the original
// file, so downloads and the file listing are unaffected. The sibling is
// cached: if it already exists and is at least as new as the source, it's
// reused rather than regenerated.
//
// Video is always stream-copied (never re-encoded) when a sibling is built.
// Audio is stream-copied when its codec is already browser-safe, or
// transcoded to AAC when it isn't (e.g. AC3/DTS from a Blu-ray rip) — the
// only lossy step, and only the audio track.
func EnsureWebPlayable(path string) (string, error) {
	if !ffmpegAvailable || !ffprobeAvailable || MediaType(path) != "video" {
		return path, nil
	}

	sibling := path[:len(path)-len(filepath.Ext(path))] + ".web.mp4"
	if srcInfo, err := os.Stat(path); err == nil {
		if sibInfo, err := os.Stat(sibling); err == nil && !sibInfo.ModTime().Before(srcInfo.ModTime()) {
			return sibling, nil
		}
	}

	videoCodec, audioCodec, err := probeCodecs(path)
	if err != nil {
		return path, err
	}
	containerOK := browserSafeContainers[strings.ToLower(filepath.Ext(path))]
	videoOK := videoCodec == "" || browserSafeVideoCodecs[videoCodec]
	audioOK := audioCodec == "" || browserSafeAudioCodecs[audioCodec]
	if containerOK && videoOK && audioOK {
		return path, nil // already playable as-is
	}
	if !videoOK {
		// A real video re-encode is expensive and slow enough (minutes to
		// hours) that doing it synchronously on a page view isn't
		// reasonable — serve the original and let it fail in-browser rather
		// than block the request indefinitely.
		return path, fmt.Errorf("video codec %q isn't browser-safe and re-encoding video isn't supported", videoCodec)
	}

	audioArgs := []string{"-c:a", "copy"}
	if !audioOK {
		audioArgs = []string{"-c:a", "aac", "-b:a", "192k"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	args := append([]string{"-y", "-i", path, "-c:v", "copy"}, audioArgs...)
	args = append(args, "-sn", "-movflags", "+faststart", sibling)
	if err := exec.CommandContext(ctx, "ffmpeg", args...).Run(); err != nil {
		_ = os.Remove(sibling)
		return path, fmt.Errorf("ffmpeg: %w", err)
	}
	if info, err := os.Stat(sibling); err != nil || info.Size() == 0 {
		_ = os.Remove(sibling)
		return path, fmt.Errorf("ffmpeg produced an empty file")
	}
	return sibling, nil
}

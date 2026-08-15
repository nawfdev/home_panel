package files

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
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

// faststartCheckExts: containers whose "moov atom before mdat" placement
// (a.k.a. faststart) matters for progressive playback — MP4-family boxes
// only; webm/mkv use a different (EBML) structure with no such concept.
var faststartCheckExts = map[string]bool{".mp4": true, ".m4v": true, ".mov": true}

type probeCodecStream struct {
	CodecType string `json:"codec_type"`
	CodecName string `json:"codec_name"`
}
type probeCodecsOutput struct {
	Streams []probeCodecStream `json:"streams"`
}

// probeCodecs returns the first video codec ffprobe reports for path (e.g.
// "h264", "hevc"), plus every audio codec present — one entry per audio
// stream, so a dual-audio file (e.g. an Indonesian + English dub) reports
// two, possibly different, codecs. Either can come back empty/nil if the
// file has no such stream.
func probeCodecs(path string) (videoCodec string, audioCodecs []string, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ffprobe",
		"-v", "quiet", "-print_format", "json", "-show_entries", "stream=codec_type,codec_name",
		path,
	).Output()
	if err != nil {
		return "", nil, fmt.Errorf("ffprobe: %w", err)
	}
	var probe probeCodecsOutput
	if err := json.Unmarshal(out, &probe); err != nil {
		return "", nil, fmt.Errorf("ffprobe output: %w", err)
	}
	for _, s := range probe.Streams {
		switch s.CodecType {
		case "video":
			if videoCodec == "" {
				videoCodec = s.CodecName
			}
		case "audio":
			audioCodecs = append(audioCodecs, s.CodecName)
		}
	}
	return videoCodec, audioCodecs, nil
}

// isFaststartMP4 reports whether an MP4-family file's "moov" box (the index
// browsers need before they can start decoding) comes before its "mdat" box
// (the actual media bytes, often the bulk of the file). Sources that aren't
// faststart force a browser/player to buffer the whole file before playback
// can begin — the classic "downloaded video won't play until 100%" symptom.
// This only walks top-level box headers (8 bytes at a time, then seeks past
// each box's payload), so it's fast regardless of file size.
func isFaststartMP4(path string) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()

	var offset int64
	header := make([]byte, 8)
	for {
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			return false, err
		}
		if _, err := io.ReadFull(f, header); err != nil {
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				return false, nil // ran off the end without finding either box
			}
			return false, err
		}
		size := int64(binary.BigEndian.Uint32(header[0:4]))
		boxType := string(header[4:8])
		switch boxType {
		case "moov":
			return true, nil
		case "mdat":
			return false, nil
		}
		switch size {
		case 1: // 64-bit "largesize" follows immediately after the header
			var big [8]byte
			if _, err := io.ReadFull(f, big[:]); err != nil {
				return false, err
			}
			offset += 16 + int64(binary.BigEndian.Uint64(big[:]))
		case 0: // box extends to EOF — nothing meaningful left to scan
			return false, nil
		default:
			offset += size
		}
	}
}

// EnsureWebPlayable checks whether path's container+codecs are safe to play
// directly in a browser and, if not, produces a ".web.mp4" sibling next to
// it (same basename) that is — without touching or replacing the original
// file, so downloads and the file listing are unaffected. The sibling is
// cached: if it already exists and is at least as new as the source, it's
// reused rather than regenerated.
//
// Video is always stream-copied (never re-encoded) when a sibling is built.
// Every audio track is carried over (not just ffmpeg's default "best"
// pick — otherwise a dual-audio file, e.g. Indonesian + English, would
// silently lose its second language on remux); each is stream-copied when
// its codec is already browser-safe, or transcoded to AAC when any track
// isn't (e.g. AC3/DTS from a Blu-ray rip) — the only lossy step, and only
// the audio. A sibling is also built (video and audio both stream-copied,
// nothing re-encoded) when the container/codecs are already fine but the
// file isn't faststart — so streaming is smooth on first view without ever
// touching the original: the Download button/link always serves the exact
// bytes that were downloaded, never a remuxed copy.
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

	videoCodec, audioCodecs, err := probeCodecs(path)
	if err != nil {
		return path, err
	}
	ext := strings.ToLower(filepath.Ext(path))
	containerOK := browserSafeContainers[ext]
	videoOK := videoCodec == "" || browserSafeVideoCodecs[videoCodec]
	audioOK := allAudioCodecsSafe(audioCodecs)
	faststartOK := true
	if containerOK && videoOK && audioOK && faststartCheckExts[ext] {
		if ok, ferr := isFaststartMP4(path); ferr == nil {
			faststartOK = ok
		} // on a probe error, assume fine — never block playback over this check
	}
	if containerOK && videoOK && audioOK && faststartOK {
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
	args := []string{"-y", "-i", path, "-map", "0:v:0"}
	if len(audioCodecs) > 0 {
		args = append(args, "-map", "0:a")
	}
	args = append(args, "-c:v", "copy")
	args = append(args, audioArgs...)
	args = append(args, "-sn", "-movflags", "+faststart", sibling)
	result, err := runRemux(args, sibling)
	if err != nil {
		return path, err
	}
	return result, nil
}

// EnsureWebPlayableAudio produces (and caches) a "<base>.web.a<audioIndex>.mp4"
// sibling containing only the video stream plus the single chosen audio
// stream (audioIndex is 0-based among audio streams, matching AudioTrack.Index
// from DetectAudioTracks) — the only way to make a browser play a specific
// embedded audio track, since neither Chrome nor Firefox will switch tracks
// in an already-loaded multi-audio file via JS. audioIndex < 0 delegates to
// EnsureWebPlayable's existing single-request behavior (default track).
func EnsureWebPlayableAudio(path string, audioIndex int) (string, error) {
	if audioIndex < 0 {
		return EnsureWebPlayable(path)
	}
	if !ffmpegAvailable || !ffprobeAvailable || MediaType(path) != "video" {
		return path, nil
	}

	sibling := fmt.Sprintf("%s.web.a%d.mp4", path[:len(path)-len(filepath.Ext(path))], audioIndex)
	if srcInfo, err := os.Stat(path); err == nil {
		if sibInfo, err := os.Stat(sibling); err == nil && !sibInfo.ModTime().Before(srcInfo.ModTime()) {
			return sibling, nil
		}
	}

	videoCodec, audioCodecs, err := probeCodecs(path)
	if err != nil {
		return path, err
	}
	if audioIndex >= len(audioCodecs) {
		return path, fmt.Errorf("audio track %d not found (file has %d)", audioIndex, len(audioCodecs))
	}
	if videoCodec != "" && !browserSafeVideoCodecs[videoCodec] {
		return path, fmt.Errorf("video codec %q isn't browser-safe and re-encoding video isn't supported", videoCodec)
	}

	audioArgs := []string{"-c:a", "copy"}
	if !browserSafeAudioCodecs[audioCodecs[audioIndex]] {
		audioArgs = []string{"-c:a", "aac", "-b:a", "192k"}
	}
	args := []string{"-y", "-i", path, "-map", "0:v:0", "-map", fmt.Sprintf("0:a:%d", audioIndex), "-c:v", "copy"}
	args = append(args, audioArgs...)
	args = append(args, "-sn", "-movflags", "+faststart", sibling)
	result, err := runRemux(args, sibling)
	if err != nil {
		return path, err
	}
	return result, nil
}

func allAudioCodecsSafe(codecs []string) bool {
	for _, c := range codecs {
		if !browserSafeAudioCodecs[c] {
			return false
		}
	}
	return true
}

// runRemux shells out to ffmpeg with args (whose last element must be the
// output path) and validates the result, sharing the same "clean up on
// failure/empty output" handling used by both EnsureWebPlayable and
// EnsureWebPlayableAudio.
func runRemux(args []string, output string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	if err := exec.CommandContext(ctx, "ffmpeg", args...).Run(); err != nil {
		_ = os.Remove(output)
		return "", fmt.Errorf("ffmpeg: %w", err)
	}
	if info, err := os.Stat(output); err != nil || info.Size() == 0 {
		_ = os.Remove(output)
		return "", fmt.Errorf("ffmpeg produced an empty file")
	}
	return output, nil
}

// RemoveWebSiblings deletes the non-destructive streaming siblings
// EnsureWebPlayable/EnsureWebPlayableAudio may have built next to path
// ("<base>.web.mp4", "<base>.web.a0.mp4", "<base>.web.a1.mp4", ...) so
// they never outlive the file they were built from — callers must invoke
// this whenever path itself is deleted, since neither Delete path in this
// codebase removed them before, leaking a near-original-sized copy on disk
// per deleted video. Best-effort: missing siblings are not an error.
func RemoveWebSiblings(path string) {
	base := path[:len(path)-len(filepath.Ext(path))]
	_ = os.Remove(base + ".web.mp4")
	matches, _ := filepath.Glob(base + ".web.a*.mp4")
	for _, m := range matches {
		_ = os.Remove(m)
	}
}

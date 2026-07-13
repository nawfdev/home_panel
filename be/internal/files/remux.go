package files

import (
	"context"
	"log"
	"os"
	"os/exec"
	"time"
)

// ffmpegAvailable caches whether ffmpeg is on PATH so we don't call
// exec.LookPath for every upload.
var ffmpegAvailable = func() bool {
	_, err := exec.LookPath("ffmpeg")
	return err == nil
}()

// remuxFaststartAsync moves a video's moov atom (metadata index) to the
// front of the file in the background, without re-encoding. Phones commonly
// write the moov atom at the end of the file; browsers then can't read
// duration/track info until they've fetched the tail of a (often very
// large) file, which frequently shows as a black, stuck player. This is a
// pure container rewrite (-c copy), so it's fast and lossless.
func remuxFaststartAsync(path string) {
	if !ffmpegAvailable || MediaType(path) != "video" {
		return
	}
	go func() {
		if err := RemuxFaststart(path); err != nil {
			log.Printf("faststart remux skipped for %s: %v", path, err)
		}
	}()
}

// RemuxFaststart moves a video's moov atom to the front of the file, without
// re-encoding (-c copy). Exported so other packages that save video files
// outside the upload path (e.g. internal/movies) can reuse the same rewrite
// instead of shelling out to ffmpeg themselves.
func RemuxFaststart(path string) error {
	tmp := path + ".faststart.tmp"
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-y", "-i", path,
		"-c", "copy", "-movflags", "+faststart",
		tmp,
	)
	if err := cmd.Run(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if info, err := os.Stat(tmp); err != nil || info.Size() == 0 {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Remove(path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

// RemuxToMP4 rewraps a video into an MP4 container without re-encoding
// (-c copy), so e.g. iOS Safari — which won't play Matroska (.mkv) at all —
// can play it. Exported for internal/movies to rewrap finished torrent
// downloads.
func RemuxToMP4(src, dst string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-y", "-i", src,
		"-c", "copy", "-sn", "-movflags", "+faststart",
		dst,
	)
	if err := cmd.Run(); err != nil {
		_ = os.Remove(dst)
		return err
	}
	if info, err := os.Stat(dst); err != nil || info.Size() == 0 {
		_ = os.Remove(dst)
		return err
	}
	return os.Remove(src)
}

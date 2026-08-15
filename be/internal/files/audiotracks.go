package files

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"
)

// AudioTrack is one embedded audio stream in a video file (e.g. an
// Indonesian + English dub muxed into the same container). Index is the
// stream's position among audio streams only (0-based, matching ffmpeg's
// "-map 0:a:<Index>" selector), not its absolute container stream index.
type AudioTrack struct {
	Index int    `json:"index"`
	Label string `json:"label"`
}

type probeAudioStream struct {
	Tags struct {
		Language string `json:"language"`
		Title    string `json:"title"`
	} `json:"tags"`
}
type probeAudioOutput struct {
	Streams []probeAudioStream `json:"streams"`
}

// audioLangNames maps common ISO 639-1/639-2 codes to readable names, for
// containers that tag a track's language but not a human title — the usual
// case for movie rips with an alternate-language dub.
var audioLangNames = map[string]string{
	"ind": "Indonesian", "id": "Indonesian",
	"eng": "English", "en": "English",
	"jpn": "Japanese", "ja": "Japanese",
	"kor": "Korean", "ko": "Korean",
	"chi": "Chinese", "zho": "Chinese", "zh": "Chinese",
	"spa": "Spanish", "es": "Spanish",
	"fre": "French", "fra": "French", "fr": "French",
	"ger": "German", "deu": "German", "de": "German",
	"ita": "Italian", "it": "Italian",
	"por": "Portuguese", "pt": "Portuguese",
	"rus": "Russian", "ru": "Russian",
	"ara": "Arabic", "ar": "Arabic",
	"tha": "Thai", "th": "Thai",
	"vie": "Vietnamese", "vi": "Vietnamese",
	"may": "Malay", "msa": "Malay", "ms": "Malay",
	"hin": "Hindi", "hi": "Hindi",
	"tur": "Turkish", "tr": "Turkish",
	"dut": "Dutch", "nld": "Dutch", "nl": "Dutch",
}

// DetectAudioTracks lists path's embedded audio streams for a track-picker
// UI. It only returns a non-nil slice when there are 2 or more — a single
// track needs no picker, and Chrome (unlike Safari/Firefox) has never
// exposed a working HTMLMediaElement.audioTracks for regular <video>, so the
// player can't discover multiple tracks client-side; the list has to come
// from the server. Best-effort: any ffprobe failure returns nil, matching
// how ExtractEmbeddedSubtitles/probeCodecs treat probe errors.
func DetectAudioTracks(path string) []AudioTrack {
	if !ffprobeAvailable || MediaType(path) != "video" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ffprobe",
		"-v", "quiet", "-print_format", "json", "-show_entries", "stream_tags=language,title",
		"-select_streams", "a", path,
	).Output()
	if err != nil {
		return nil
	}
	var probe probeAudioOutput
	if err := json.Unmarshal(out, &probe); err != nil || len(probe.Streams) < 2 {
		return nil
	}
	tracks := make([]AudioTrack, 0, len(probe.Streams))
	seen := map[string]int{}
	for i, s := range probe.Streams {
		label := s.Tags.Title
		if label == "" {
			lang := s.Tags.Language
			if name, ok := audioLangNames[lang]; ok {
				label = name
			} else if lang != "" && lang != "und" {
				label = lang
			} else {
				label = fmt.Sprintf("Track %d", i+1)
			}
		}
		if n := seen[label]; n > 0 {
			label = fmt.Sprintf("%s (%d)", label, n+1)
		}
		seen[label]++
		tracks = append(tracks, AudioTrack{Index: i, Label: label})
	}
	return tracks
}

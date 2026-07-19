package tv

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

var attrRe = regexp.MustCompile(`([a-zA-Z0-9_-]+)="([^"]*)"`)
var spaceRe = regexp.MustCompile(`\s+`)

func parseAttrs(line string) map[string]string {
	attrs := map[string]string{}
	for _, m := range attrRe.FindAllStringSubmatch(line, -1) {
		attrs[m[1]] = m[2]
	}
	return attrs
}

// parseName mirrors the JS parser: the channel name is the text after the
// last comma on an #EXTINF line.
func parseName(line string) string {
	idx := strings.LastIndex(line, ",")
	if idx == -1 {
		return ""
	}
	return strings.TrimSpace(line[idx+1:])
}

func streamType(rawURL string) string {
	u := rawURL
	if i := strings.Index(u, "|"); i >= 0 {
		u = u[:i]
	}
	if i := strings.Index(u, "?"); i >= 0 {
		u = u[:i]
	}
	u = strings.ToLower(u)
	switch {
	case strings.HasSuffix(u, ".mpd"):
		return "dash"
	case strings.HasSuffix(u, ".m3u8"):
		return "hls"
	case strings.HasSuffix(u, ".ts"):
		return "ts"
	default:
		return "hls"
	}
}

// splitPipeHeaders splits a stream URL from its optional pipe-delimited
// header suffix: url|Referer=...&User-Agent=...
func splitPipeHeaders(raw string) (string, map[string]string) {
	parts := strings.SplitN(raw, "|", 2)
	headers := map[string]string{}
	if len(parts) > 1 {
		for _, kv := range strings.Split(parts[1], "&") {
			eq := strings.Index(kv, "=")
			if eq <= 0 {
				continue
			}
			k := strings.TrimSpace(kv[:eq])
			v, err := url.QueryUnescape(strings.TrimSpace(kv[eq+1:]))
			if err != nil {
				v = strings.TrimSpace(kv[eq+1:])
			}
			headers[k] = v
		}
	}
	return parts[0], headers
}

type pendingDRM struct {
	Type string
	Key  string
}

type pendingChannel struct {
	Name    string
	TvgID   string
	Logo    string
	Group   string
	Headers map[string]string
	drmRaw  *pendingDRM
}

func newPending() *pendingChannel {
	return &pendingChannel{Group: "Lainnya", Headers: map[string]string{}}
}

// parseM3U parses M3U/M3U8 text into channels, tagging each with source
// (which playlist it came from). Mirrors dhanytv's web/src/lib/m3u.js:
// supports #EXTINF (tvg-id/tvg-logo/group-title/name), #EXTVLCOPT
// (http-referrer/http-user-agent/http-origin) and #KODIPROP
// (inputstream.adaptive.license_type/license_key).
func parseM3U(text string, source string) []Channel {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	var channels []Channel
	pending := newPending()

	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}

		if strings.HasPrefix(line, "#EXTINF") {
			attrs := parseAttrs(line)
			pending.TvgID = attrs["tvg-id"]
			pending.Logo = attrs["tvg-logo"]
			if g := attrs["group-title"]; g != "" {
				pending.Group = g
			}
			name := parseName(line)
			if name == "" {
				name = attrs["tvg-name"]
			}
			if name == "" {
				name = pending.TvgID
			}
			if name == "" {
				name = "Tanpa Nama"
			}
			pending.Name = name
			continue
		}

		if strings.HasPrefix(line, "#EXTVLCOPT") {
			v := strings.TrimPrefix(line, "#EXTVLCOPT:")
			if eq := strings.Index(v, "="); eq > 0 {
				key := strings.ToLower(strings.TrimSpace(v[:eq]))
				val := strings.TrimSpace(v[eq+1:])
				switch key {
				case "http-referrer", "http-referer":
					pending.Headers["Referer"] = val
				case "http-user-agent":
					pending.Headers["User-Agent"] = val
				case "http-origin":
					pending.Headers["Origin"] = val
				}
			}
			continue
		}

		if strings.HasPrefix(line, "#KODIPROP") {
			v := strings.TrimPrefix(line, "#KODIPROP:")
			if eq := strings.Index(v, "="); eq > 0 {
				key := strings.TrimSpace(v[:eq])
				val := strings.TrimSpace(v[eq+1:])
				if key == "inputstream.adaptive.license_type" {
					if pending.drmRaw == nil {
						pending.drmRaw = &pendingDRM{}
					}
					// Some playlists cram everything onto one line:
					// license_type=clearkey&license_key=KID:KEY&User-Agent=referrer=...
					parts := strings.Split(val, "&")
					pending.drmRaw.Type = strings.TrimSpace(parts[0])
					for _, seg := range parts[1:] {
						se := strings.Index(seg, "=")
						if se < 0 {
							continue
						}
						k := strings.ToLower(strings.TrimSpace(seg[:se]))
						vv := strings.TrimSpace(seg[se+1:])
						switch {
						case k == "license_key":
							pending.drmRaw.Key = vv
						case k == "user-agent":
							if strings.HasPrefix(strings.ToLower(vv), "referrer=") {
								pending.Headers["Referer"] = vv[len("referrer="):]
							} else {
								pending.Headers["User-Agent"] = vv
							}
						}
					}
				}
				if key == "inputstream.adaptive.license_key" {
					if pending.drmRaw == nil {
						pending.drmRaw = &pendingDRM{}
					}
					if pending.drmRaw.Key == "" {
						// JSON {"kid":"key"}, "kid:key", or a license server URL.
						pending.drmRaw.Key = val
					}
				}
			}
			continue
		}

		if strings.HasPrefix(line, "#") {
			continue // other comments/directives: leave pending as-is
		}

		// A non-# line is the stream URL, closing this channel.
		streamURL, headers := splitPipeHeaders(line)
		for k, v := range headers {
			pending.Headers[k] = v
		}

		ch := Channel{
			Name:   pending.Name,
			TvgID:  pending.TvgID,
			Logo:   pending.Logo,
			Group:  pending.Group,
			Source: source,
			URL:    streamURL,
			Type:   streamType(streamURL),
		}
		if len(pending.Headers) > 0 {
			ch.Headers = pending.Headers
		}
		if pending.drmRaw != nil {
			ch.DRM = normalizeDRM(pending.drmRaw)
		}

		id := pending.TvgID
		if id == "" {
			id = slug(pending.Name)
		}
		if id == "" {
			id = fmt.Sprintf("ch-%d", len(channels))
		}
		ch.ID = source + "-" + id
		channels = append(channels, ch)

		pending = newPending()
	}

	return channels
}

// normalizeDRM turns the raw {type, key} pulled from #KODIPROP into a
// Shaka-ready DRM config.
func normalizeDRM(d *pendingDRM) *DRM {
	t := strings.ToLower(strings.TrimSpace(d.Type))
	key := strings.TrimSpace(d.Key)
	lowerKey := strings.ToLower(key)
	isURL := strings.HasPrefix(lowerKey, "http://") || strings.HasPrefix(lowerKey, "https://")

	if strings.Contains(t, "widevine") || isURL {
		if isURL {
			return &DRM{System: "widevine", ServerURL: key}
		}
		return &DRM{System: "widevine"} // needs a server URL we don't have
	}
	if strings.Contains(t, "clearkey") {
		if ck := parseClearKeys(key); ck != nil {
			return &DRM{System: "clearkey", ClearKeys: ck}
		}
	}
	system := t
	if system == "" {
		system = "unknown"
	}
	return &DRM{System: system}
}

// parseClearKeys accepts JSON {"kid":"key"} or "kid:key" (hex), returning a
// kid->key map with any "0x" prefixes stripped.
func parseClearKeys(raw string) map[string]string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil
	}
	if strings.HasPrefix(s, "{") {
		var obj map[string]string
		if err := json.Unmarshal([]byte(s), &obj); err != nil {
			return nil
		}
		out := map[string]string{}
		for k, v := range obj {
			out[stripHex(k)] = stripHex(v)
		}
		if len(out) == 0 {
			return nil
		}
		return out
	}
	if strings.Contains(s, ":") {
		parts := strings.SplitN(s, ":", 2)
		if parts[0] != "" && parts[1] != "" {
			return map[string]string{stripHex(parts[0]): stripHex(parts[1])}
		}
	}
	return nil
}

func stripHex(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 && (s[0:2] == "0x" || s[0:2] == "0X") {
		return s[2:]
	}
	return s
}

func slug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == ' ' || r == '-' {
			b.WriteRune(r)
		}
	}
	return spaceRe.ReplaceAllString(strings.TrimSpace(b.String()), "-")
}

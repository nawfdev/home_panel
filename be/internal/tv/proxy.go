package tv

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// hopHeaders are stripped when relaying the upstream response, the usual
// reverse-proxy hop-by-hop list (RFC 7230 §6.1) plus the ones that would
// otherwise leak upstream compression framing our client didn't ask for.
var hopHeaders = map[string]bool{
	"connection":          true,
	"keep-alive":          true,
	"proxy-authenticate":  true,
	"proxy-authorization": true,
	"te":                  true,
	"trailers":            true,
	"transfer-encoding":   true,
	"upgrade":             true,
}

// Proxy relays a stream/license request to an upstream URL with headers the
// browser can't set itself (Referer/User-Agent are forbidden on XHR/fetch,
// and a Widevine license server is opaque to canonical CORS anyway). The
// target URL and a base64 JSON header blob travel as query params, mirroring
// dhanytv's own stream-proxy design.
func (s *Service) Proxy(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if target == "" {
		http.Error(w, "missing url", http.StatusBadRequest)
		return
	}
	parsed, err := url.Parse(target)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		http.Error(w, "invalid url", http.StatusBadRequest)
		return
	}

	headers := map[string]string{}
	if h := r.URL.Query().Get("h"); h != "" {
		if raw, err := base64.StdEncoding.DecodeString(h); err == nil {
			_ = json.Unmarshal(raw, &headers)
		}
	}

	req, err := http.NewRequest(r.Method, target, r.Body)
	if err != nil {
		http.Error(w, "bad upstream request", http.StatusBadGateway)
		return
	}
	req.ContentLength = r.ContentLength
	req.Header.Set("User-Agent", userAgent)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if rng := r.Header.Get("Range"); rng != "" {
		req.Header.Set("Range", rng)
	}
	if ct := r.Header.Get("Content-Type"); ct != "" && r.Method != http.MethodGet {
		req.Header.Set("Content-Type", ct)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		http.Error(w, "upstream fetch failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for k, vv := range resp.Header {
		if hopHeaders[strings.ToLower(k)] {
			continue
		}
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

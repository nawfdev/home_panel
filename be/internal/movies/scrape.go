// Package movies adds a Movie section: scrape pahe.ink for browsable films and
// download them server-side into a directory the existing file player/share
// stack already serves. Only the scrape+download half is new here; streaming,
// the custom player and public shares are reused from package files.
package movies

import (
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// source is the site we scrape. pahe.ink is the live one (movieku just
// redirects to a rotating domain, so it's intentionally not used).
const source = "https://pahe.ink"

// userAgent avoids the default Go client string, which some hosts block.
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/124.0 Safari/537.36"

// Film is a search/browse result: enough to render a poster grid and open the
// detail page for its download options.
type Film struct {
	Title     string `json:"title"`
	Poster    string `json:"poster"`
	DetailURL string `json:"detailUrl"`
	Year      string `json:"year"`
}

// DownloadOption is one downloadable variant on a film's detail page. Link is
// the raw href (usually a shortener like oii.la/tpi.li); Fase 2 will best-effort
// resolve those, Fase 1 downloads direct/simple links as-is.
type DownloadOption struct {
	Quality string `json:"quality"` // e.g. "1080p x264"
	Size    string `json:"size"`    // e.g. "2 GB"
	Host    string `json:"host"`    // e.g. "GD", "SD", "MG"
	Link    string `json:"link"`    // raw href
}

// httpClient is shared; scraping is short-lived so a modest timeout is fine.
var httpClient = &http.Client{Timeout: 30 * time.Second}

func fetch(url string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Referer", source+"/")
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("source returned HTTP %d", resp.StatusCode)
	}
	// Cap the body so a hostile/huge page can't exhaust memory.
	b, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// Both pahe.ink's homepage widget (<article class="item-list">) and its
// ?s= search results (<li class="timeline-post">) render each entry's title
// the same way:
//   <h2 class="post-box-title"><a href="DETAIL_URL">TITLE</a></h2>
// with a poster <img src="POSTER"> following shortly after, inside a
// "post-thumbnail" wrapper. There's no title="" attribute on the anchor in
// either template (an earlier version of this scraper assumed one and so
// matched zero films everywhere). Anchoring on post-box-title instead of the
// surrounding <article>/<li> lets one parser cover both page types.
var (
	rePostTitle = regexp.MustCompile(`(?is)<h2\b[^>]*\bclass=["'][^"']*post-box-title[^"']*["'][^>]*>\s*<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>(.*?)</a>`)
	reTag       = regexp.MustCompile(`(?is)<[^>]+>`)
	reImg       = regexp.MustCompile(`(?is)<img\b[^>]*\bsrc=["']([^"']+)["']`)
	reImgData   = regexp.MustCompile(`(?is)<img\b[^>]*\bdata-src=["']([^"']+)["']`)
	reYear      = regexp.MustCompile(`\b((?:19|20)\d{2})\b`)
)

// Search returns films from pahe.ink. Empty query browses the homepage; a
// non-empty query hits the site's ?s= search. page is 1-based; page<=1 is
// the first page (no /page/N/ segment).
func Search(query string, page int) ([]Film, error) {
	path := "/"
	if page > 1 {
		path = fmt.Sprintf("/page/%d/", page)
	}
	target := source + path
	if q := strings.TrimSpace(query); q != "" {
		target += "?s=" + url.QueryEscape(q)
	}
	body, err := fetch(target)
	if err != nil {
		return nil, err
	}
	return parseFilms(body), nil
}

func parseFilms(body string) []Film {
	var films []Film
	seen := map[string]bool{}
	matches := rePostTitle.FindAllStringSubmatchIndex(body, -1)
	for i, m := range matches {
		href := body[m[2]:m[3]]
		if href == "" || seen[href] {
			continue
		}
		title := decode(reTag.ReplaceAllString(body[m[4]:m[5]], ""))
		if title == "" {
			continue
		}
		seen[href] = true

		// Poster lives just after the title, before the next entry's marker.
		end := len(body)
		if i+1 < len(matches) {
			end = matches[i+1][0]
		}
		segment := body[m[1]:end]
		poster := firstGroup(reImg, segment)
		if poster == "" {
			poster = firstGroup(reImgData, segment)
		}

		films = append(films, Film{
			Title:     title,
			Poster:    poster,
			DetailURL: href,
			Year:      firstGroup(reYear, title),
		})
	}
	return films
}

// Detail rows on pahe.ink look roughly like:
//   <strong>1080p x264 | 2 GB</strong> ... <a href="LINK">GD</a> <a ..>SD</a> ...
// We split the entry-content into quality lines and collect their host links.
var (
	reQualityLine = regexp.MustCompile(`(?is)(\d{3,4}p[^<|]*?)\s*\|\s*([\d.]+\s*[GM]B)`)
	reLinkAnchor  = regexp.MustCompile(`(?is)<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>\s*([^<]{1,12}?)\s*</a>`)
	reContent     = regexp.MustCompile(`(?is)<div[^>]*class=["'][^"']*entry-content[^"']*["'][^>]*>(.*?)</div>\s*(?:<footer|<div[^>]*class=["'][^"']*(?:share|tags|related))`)
)

// Detail parses a film page into its download options. It groups host anchors
// under the nearest preceding "quality | size" marker.
func Detail(detailURL string) ([]DownloadOption, error) {
	if !strings.HasPrefix(detailURL, source) {
		return nil, fmt.Errorf("detail URL must be on %s", source)
	}
	body, err := fetch(detailURL)
	if err != nil {
		return nil, err
	}
	content := body
	if m := reContent.FindStringSubmatch(body); len(m) > 1 {
		content = m[1]
	}

	var opts []DownloadOption
	// Walk quality markers in order; for each, scan the slice of HTML until the
	// next marker for host anchors.
	markers := reQualityLine.FindAllStringSubmatchIndex(content, -1)
	for i, m := range markers {
		quality := decode(strings.TrimSpace(content[m[2]:m[3]]))
		size := decode(strings.TrimSpace(content[m[4]:m[5]]))
		end := len(content)
		if i+1 < len(markers) {
			end = markers[i+1][0]
		}
		segment := content[m[1]:end]
		for _, a := range reLinkAnchor.FindAllStringSubmatch(segment, -1) {
			link := decode(a[1])
			hostLabel := strings.TrimSpace(decode(a[2]))
			if link == "" || !strings.HasPrefix(link, "http") {
				continue
			}
			opts = append(opts, DownloadOption{
				Quality: quality,
				Size:    size,
				Host:    hostLabel,
				Link:    link,
			})
		}
	}
	return opts, nil
}

func firstGroup(re *regexp.Regexp, s string) string {
	if m := re.FindStringSubmatch(s); len(m) > 1 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

func decode(s string) string { return html.UnescapeString(strings.TrimSpace(s)) }

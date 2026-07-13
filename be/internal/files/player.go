package files

import (
	"encoding/json"
	"net/url"
	"path/filepath"
	"strings"
	"time"
)

func fileTypeLabel(name string) string {
	ext := strings.TrimPrefix(filepath.Ext(name), ".")
	if ext == "" {
		return "File"
	}
	return strings.ToUpper(ext)
}

// metaChipsHTML renders the size · type · date chip row shown on share pages.
func metaChipsHTML(size int64, fileName string, modTime time.Time) string {
	return `<div class="chips">` +
		`<span class="chip">` + formatSize(size) + `</span>` +
		`<span class="chip">` + htmlEscape(fileTypeLabel(fileName)) + `</span>` +
		`<span class="chip">` + modTime.Format("Jan 2, 2006") + `</span>` +
		`</div>`
}

// copyShareHTML renders the Copy link + Share secondary buttons.
func copyShareHTML() string {
	return `<div class="actions">` +
		`<button class="actbtn" type="button" data-orig="` + htmlEscape(icoLink) + `Copy link" onclick="nsCopyLink(this)">` + icoLink + `Copy link</button>` +
		`<button class="actbtn" type="button" onclick="nsShare()">` + icoShare + `Share</button>` +
		`</div>`
}

const (
	icoLink  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15l6-6M10.5 6l1-1a4 4 0 0 1 6 6l-1 1M13.5 18l-1 1a4 4 0 0 1-6-6l1-1"/></svg>`
	icoShare = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6"/></svg>`
)

// sharedActionsCSS: chip row + Download/Copy/Share buttons, used by both the
// media player pages and the file download landing page.
const sharedActionsCSS = `
.chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:16px}
.chip{font-size:12px;color:#a1a1aa;background:#18181b;border:1px solid rgba(255,255,255,.07);padding:4px 11px;border-radius:999px}
.actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.mediadl{display:inline-flex;align-items:center;gap:8px;background:#fafafa;color:#0e0e10;font-weight:600;font-size:14px;padding:11px 24px;border-radius:10px;transition:background .15s,transform .1s;border:none;cursor:pointer;font-family:inherit}
.mediadl:hover{background:#fff;text-decoration:none;transform:translateY(-1px)}
.mediadl:active{transform:translateY(0)}
.mediadl svg{width:18px;height:18px}
.actbtn{display:inline-flex;align-items:center;gap:7px;background:#18181b;border:1px solid rgba(255,255,255,.08);color:#e4e4e7;font-size:13px;padding:11px 18px;border-radius:10px;cursor:pointer;font-family:inherit}
.actbtn:hover{background:#27272a}
.actbtn svg{width:16px;height:16px}
`

// shareActionsJS powers the Copy link / Share buttons on public share pages,
// with a clipboard fallback for non-secure (HTTP) contexts.
const shareActionsJS = `
function nsFlash(btn,msg){ if(!btn)return; var o=btn.getAttribute('data-orig')||btn.innerHTML; btn.textContent=msg; setTimeout(function(){ btn.innerHTML=o; },1500); }
function nsLegacyCopy(text){ try{ var ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.left='-9999px'; document.body.appendChild(ta); ta.select(); var ok=document.execCommand('copy'); document.body.removeChild(ta); return ok; }catch(e){ return false; } }
function nsCopyLink(btn){ var url=window.location.href;
  if(navigator.clipboard&&window.isSecureContext){ navigator.clipboard.writeText(url).then(function(){ nsFlash(btn,'Copied!'); },function(){ nsFlash(btn, nsLegacyCopy(url)?'Copied!':'Select & copy'); }); }
  else { nsFlash(btn, nsLegacyCopy(url)?'Copied!':'Select & copy'); } }
function nsShare(){ if(navigator.share){ navigator.share({url:window.location.href}).catch(function(){}); } else { nsCopyLink(); } }
`

// DownloadPageHTML renders a modern, panel-themed download landing page for a
// shared non-media file (documents, archives, ...): a centered card with a
// file icon, name, size, and a prominent Download button. The bytes come from
// basePath?raw=1.
func DownloadPageHTML(basePath, fileName string, size int64, modTime time.Time) string {
	rawURL := basePath + "?raw=1"
	ext := strings.ToUpper(strings.TrimPrefix(filepath.Ext(fileName), "."))
	if len(ext) > 5 {
		ext = ext[:5]
	}
	var b strings.Builder
	b.WriteString(`<!doctype html><html><head>`)
	b.WriteString(themeHead(fileName))
	b.WriteString(`<style>` + panelBaseCSS + downloadCSS + sharedActionsCSS + `</style></head><body>`)
	b.WriteString(`<div class="dlwrap"><div class="dlcard">`)
	b.WriteString(`<div class="dlicon">` + icoFile)
	if ext != "" {
		b.WriteString(`<span class="dlext">` + htmlEscape(ext) + `</span>`)
	}
	b.WriteString(`</div>`)
	b.WriteString(`<div class="dlname mono">` + htmlEscape(fileName) + `</div>`)
	b.WriteString(metaChipsHTML(size, fileName, modTime))
	b.WriteString(`<a class="dlbtn" href="` + htmlEscape(rawURL) + `" download>` + icoDownload + `Download</a>`)
	b.WriteString(copyShareHTML())
	b.WriteString(`</div><div class="dlfoot">Shared via Nestcore</div></div>`)
	b.WriteString(`<script>` + shareActionsJS + `</script>`)
	b.WriteString(`</body></html>`)
	return b.String()
}

const (
	icoFile     = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`
	icoDownload = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 11l4 4 4-4M5 21h14"/></svg>`
)

const downloadCSS = `
body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.dlwrap{width:100%;max-width:440px;text-align:center}
.dlcard{background:#131316;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:38px 30px;box-shadow:0 20px 60px rgba(0,0,0,.45)}
.dlicon{position:relative;width:88px;height:88px;margin:0 auto 22px;color:#a1a1aa}
.dlicon svg{width:88px;height:88px}
.dlext{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);font-size:11px;font-weight:700;letter-spacing:.04em;color:#0e0e10;background:#fafafa;padding:2px 7px;border-radius:5px}
.dlname{font-size:15px;color:#f4f4f5;word-break:break-all;margin-bottom:6px;line-height:1.4}
.dlsize{font-size:13px;color:#71717a;margin-bottom:26px}
.dlbtn{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;background:#fafafa;color:#0e0e10;font-weight:600;font-size:15px;padding:14px;border-radius:11px;transition:background .15s,transform .1s}
.dlbtn:hover{background:#fff;text-decoration:none;transform:translateY(-1px)}
.dlbtn:active{transform:translateY(0)}
.dlbtn svg{width:20px;height:20px}
.dlcard .actions{margin-top:12px}
.dlfoot{margin-top:18px;font-size:12px;color:#52525b}
`

// PlayerHTML renders a self-contained (CSP-safe, no external assets) media
// player page for a shared video/image/audio file, styled to match the panel.
// Video uses a fully custom control bar (not native controls). basePath is the
// request path of the shared file; media bytes come from basePath?raw=1 and
// sidecar subtitles from basePath?sub=<name>.
func PlayerHTML(mediaType, basePath, fileName string, size int64, modTime time.Time, subs []Subtitle) string {
	rawURL := basePath + "?raw=1"
	subsJSON, _ := json.Marshal(subtitleTracks(basePath, subs))

	var b strings.Builder
	b.WriteString(`<!doctype html><html><head>`)
	b.WriteString(themeHead(fileName))
	b.WriteString(`<style>`)
	b.WriteString(panelBaseCSS)
	b.WriteString(playerCSS)
	b.WriteString(sharedActionsCSS)
	b.WriteString(`</style></head><body>`)
	b.WriteString(`<div class="wrap">`)
	b.WriteString(`<div class="title mono">` + htmlEscape(fileName) + `</div>`)

	switch mediaType {
	case "image":
		b.WriteString(`<div class="stage"><img src="` + htmlEscape(rawURL) + `" alt="` + htmlEscape(fileName) + `" class="media-img"></div>`)
		b.WriteString(mediaActionsHTML(rawURL, fileName, size, modTime) + `</div>`)
		b.WriteString(`<script>` + shareActionsJS + `</script></body></html>`)
		return b.String()
	case "audio":
		b.WriteString(`<div class="stage audio"><audio controls src="` + htmlEscape(rawURL) + `" class="media-audio"></audio></div>`)
		b.WriteString(mediaActionsHTML(rawURL, fileName, size, modTime) + `</div>`)
		b.WriteString(`<script>` + shareActionsJS + `</script></body></html>`)
		return b.String()
	}

	// Custom video player.
	b.WriteString(videoPlayerHTML(rawURL))
	b.WriteString(mediaActionsHTML(rawURL, fileName, size, modTime) + `</div>`)
	b.WriteString(`<script>window.__SUBS__=` + string(subsJSON) + `;</script>`)
	b.WriteString(`<script>` + renderedPlayerJS() + `</script>`)
	b.WriteString(`<script>` + shareActionsJS + `</script>`)
	b.WriteString(`</body></html>`)
	return b.String()
}

// mediaActionsHTML is the info + actions block below the player/image: file
// meta chips and a row with a prominent Download button plus Copy link / Share.
func mediaActionsHTML(rawURL, fileName string, size int64, modTime time.Time) string {
	return `<div class="mediainfo">` +
		metaChipsHTML(size, fileName, modTime) +
		`<div class="actions">` +
		`<a class="mediadl" href="` + htmlEscape(rawURL) + `" download>` + icoDownload + `Download</a>` +
		`<button class="actbtn" type="button" data-orig="` + htmlEscape(icoLink) + `Copy link" onclick="nsCopyLink(this)">` + icoLink + `Copy link</button>` +
		`<button class="actbtn" type="button" onclick="nsShare()">` + icoShare + `Share</button>` +
		`</div></div>`
}

func videoPlayerHTML(rawURL string) string {
	return `<div class="np subbg-solid subsize-md subcolor-white subedge-none" id="np" tabindex="0">
<video class="np-video" id="npvideo" playsinline><source src="` + htmlEscape(rawURL) + `"></video>
<div class="np-center"><button class="np-bigplay" id="npbig" aria-label="Play">` + icoPlay + `</button></div>
<div class="np-scrim"></div>
<div class="np-controls" id="npctrls">
  <div class="np-seek" id="npseek"><div class="np-buffered" id="npbuf"></div><div class="np-played" id="npplayed"></div><div class="np-thumb" id="npthumb"></div></div>
  <div class="np-row">
    <button class="np-btn" id="npplay" aria-label="Play/Pause">` + icoPlay + `</button>
    <button class="np-btn" id="npmute" aria-label="Mute">` + icoVol + `</button>
    <input class="np-vol" id="npvol" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume">
    <span class="np-time mono" id="nptime">0:00 / 0:00</span>
    <div class="np-spacer"></div>
    <div class="np-pop">
      <button class="np-btn" id="npcc" aria-label="Subtitles">` + icoCC + `</button>
      <div class="np-menu" id="npccmenu"></div>
    </div>
    <div class="np-pop">
      <button class="np-btn" id="npsettings" aria-label="Subtitle settings">` + icoGear + `</button>
      <div class="np-menu np-menu-wide" id="npsettingsmenu"></div>
    </div>
    <div class="np-pop">
      <button class="np-btn np-speedbtn mono" id="npspeed" aria-label="Speed">1x</button>
      <div class="np-menu" id="npspeedmenu"></div>
    </div>
    <button class="np-btn" id="npfull" aria-label="Fullscreen">` + icoFull + `</button>
  </div>
</div>
<input type="file" id="npsubfile" accept=".srt,.vtt" hidden>
</div>`
}

type subtitleTrack struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

func subtitleTracks(basePath string, subs []Subtitle) []subtitleTrack {
	out := make([]subtitleTrack, 0, len(subs))
	for _, s := range subs {
		out = append(out, subtitleTrack{Label: s.Label, URL: basePath + "?sub=" + url.QueryEscape(s.Name)})
	}
	return out
}

// Minimal monochrome line/solid SVG icons (24x24, currentColor).
const (
	icoPlay  = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`
	icoPause = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`
	icoVol   = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16 8.5a4 4 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>`
	icoMute  = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M17 9l4 4m0-4l-4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`
	icoCC    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M9.5 10.5a2 2 0 1 0 0 3M15.5 10.5a2 2 0 1 0 0 3" stroke-linecap="round"/></svg>`
	icoFull  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/></svg>`
	icoGear  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`
)

// renderedPlayerJS injects the pause/volume/mute SVG icons (which the script
// swaps in at runtime) into the player script. Kept out of the const so the
// icon markup lives in one place.
func renderedPlayerJS() string {
	return strings.NewReplacer(
		"__ICON_PAUSE__", jsEscape(icoPause),
		"__ICON_VOL__", jsEscape(icoVol),
		"__ICON_MUTE__", jsEscape(icoMute),
	).Replace(playerJS)
}

// playerCSS: page layout + the custom video player component.
const playerCSS = `
body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.wrap{width:100%;max-width:1100px}
.title{font-size:13px;color:#71717a;margin-bottom:12px;word-break:break-all;text-align:center}
.stage{background:#000;border:1px solid rgba(255,255,255,0.07);border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center}
.stage.audio{padding:24px}
.media-img{max-width:100%;max-height:80vh;display:block}
.media-audio{width:100%}

.mediainfo{margin-top:20px;text-align:center}

/* Player frame stays landscape (16:9) regardless of the source video's
   aspect ratio; portrait/odd-ratio videos are letterboxed inside it. */
.np{position:relative;background:#000;border:1px solid rgba(255,255,255,0.07);border-radius:12px;overflow:hidden;outline:none;line-height:0;width:100%;aspect-ratio:16/9;max-height:80vh}
.np:fullscreen{aspect-ratio:auto;max-height:none;width:100%;height:100%;border:none;border-radius:0}
.np:-webkit-full-screen{aspect-ratio:auto;max-height:none;width:100%;height:100%;border:none;border-radius:0}
.np-video{width:100%;height:100%;object-fit:contain;display:block;background:#000}
.np-scrim{position:absolute;left:0;right:0;bottom:0;height:120px;background:linear-gradient(to top,rgba(0,0,0,.75),transparent);pointer-events:none;opacity:1;transition:opacity .2s}
.np.hidecursor{cursor:none}
.np.paused .np-scrim{opacity:1}
.np.hide .np-scrim,.np.hide .np-controls{opacity:0;pointer-events:none}
.np-controls{position:absolute;left:0;right:0;bottom:0;padding:8px 14px 12px;opacity:1;transition:opacity .2s;line-height:normal}

.np-center{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.np-bigplay{pointer-events:auto;width:72px;height:72px;border-radius:50%;border:none;background:rgba(20,20,22,.66);color:#fafafa;display:flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(4px);transition:transform .15s,background .15s;opacity:0}
.np-bigplay svg{width:34px;height:34px;margin-left:3px}
.np-bigplay:hover{background:rgba(40,40,44,.8);transform:scale(1.06)}
.np.paused .np-bigplay{opacity:1}

.np-seek{position:relative;height:5px;background:rgba(255,255,255,.22);border-radius:3px;cursor:pointer;margin-bottom:10px;transition:height .12s}
.np-seek:hover{height:8px}
.np-buffered{position:absolute;left:0;top:0;bottom:0;background:rgba(255,255,255,.28);border-radius:3px;width:0}
.np-played{position:absolute;left:0;top:0;bottom:0;background:#fafafa;border-radius:3px;width:0}
.np-thumb{position:absolute;top:50%;transform:translate(-50%,-50%);width:13px;height:13px;border-radius:50%;background:#fafafa;left:0;opacity:0;transition:opacity .12s;box-shadow:0 0 0 4px rgba(250,250,250,.15)}
.np-seek:hover .np-thumb{opacity:1}

.np-row{display:flex;align-items:center;gap:8px}
.np-btn{width:38px;height:38px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:#e4e4e7;cursor:pointer;border-radius:8px;padding:0}
.np-btn:hover{background:rgba(255,255,255,.1);color:#fafafa}
.np-btn svg{width:22px;height:22px}
.np-speedbtn{font-size:13px;font-weight:600;width:auto;padding:0 10px}
.np-time{font-size:12px;color:#d4d4d8;margin-left:2px;white-space:nowrap}
.np-spacer{flex:1}
.np-vol{width:0;opacity:0;transition:width .18s,opacity .18s;accent-color:#fafafa;cursor:pointer;height:4px}
.np-mutewrap:hover .np-vol,.np-vol:hover,.np-vol:focus{width:76px;opacity:1}
.np-row:hover .np-vol{width:76px;opacity:1}

.np-pop{position:relative}
.np-menu{position:absolute;bottom:46px;right:0;min-width:150px;background:#131316;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:6px;display:none;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.6)}
.np-menu.open{display:flex}
.np-item{text-align:left;background:transparent;border:none;color:#d4d4d8;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px;font-family:inherit;white-space:nowrap}
.np-item:hover{background:rgba(255,255,255,.08);color:#fafafa}
.np-item.active{color:#fafafa;background:rgba(255,255,255,.06)}
.np-item.active::after{content:"✓";float:right;margin-left:16px}

.np-menu-sep{border-top:1px solid rgba(255,255,255,.08);margin:4px 2px}
.np-menu-wide{min-width:230px}
.np-setrow{display:flex;flex-direction:column;gap:6px;padding:6px 8px}
.np-setrow+.np-setrow{border-top:1px solid rgba(255,255,255,.06)}
.np-setlabel{font-size:11px;color:#a1a1aa;text-transform:uppercase;letter-spacing:.04em}
.np-chips{display:flex;gap:6px;flex-wrap:wrap}
.np-chip{padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid transparent;color:#d4d4d8;font-size:12px;cursor:pointer;font-family:inherit}
.np-chip:hover{background:rgba(255,255,255,.12)}
.np-chip.active{background:#fafafa;color:#0e0e10}
.np-swatch{width:22px;height:22px;border-radius:50%;cursor:pointer;border:2px solid transparent;padding:0}
.np-swatch.active{border-color:#fafafa;box-shadow:0 0 0 2px rgba(0,0,0,.4)}

.np video::cue{font-family:"Plus Jakarta Sans",sans-serif}
.np.subbg-solid video::cue{background:rgba(0,0,0,.72)}
.np.subbg-semi video::cue{background:rgba(0,0,0,.35)}
.np.subbg-none video::cue{background:transparent}
.np.subsize-sm video::cue{font-size:.75em}
.np.subsize-md video::cue{font-size:1em}
.np.subsize-lg video::cue{font-size:1.3em}
.np.subsize-xl video::cue{font-size:1.6em}
.np.subcolor-white video::cue{color:#fff}
.np.subcolor-yellow video::cue{color:#ffeb3b}
.np.subcolor-cyan video::cue{color:#00e5ff}
.np.subcolor-green video::cue{color:#76ff03}
.np.subedge-none video::cue{text-shadow:none}
.np.subedge-drop video::cue{text-shadow:0 2px 3px rgba(0,0,0,.9)}
.np.subedge-outline video::cue{text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 0 4px rgba(0,0,0,.8)}
`

const playerJS = `
(function(){
  var np=document.getElementById('np'), v=document.getElementById('npvideo');
  var big=document.getElementById('npbig'), playBtn=document.getElementById('npplay');
  var muteBtn=document.getElementById('npmute'), vol=document.getElementById('npvol');
  var seek=document.getElementById('npseek'), played=document.getElementById('npplayed');
  var buf=document.getElementById('npbuf'), thumb=document.getElementById('npthumb');
  var timeEl=document.getElementById('nptime'), fullBtn=document.getElementById('npfull');
  var ccBtn=document.getElementById('npcc'), ccMenu=document.getElementById('npccmenu');
  var settingsBtn=document.getElementById('npsettings'), settingsMenu=document.getElementById('npsettingsmenu');
  var speedBtn=document.getElementById('npspeed'), speedMenu=document.getElementById('npspeedmenu');
  var subFile=document.getElementById('npsubfile');
  var ICON_PLAY=playBtn.innerHTML, ICON_PAUSE='__ICON_PAUSE__';
  var ICON_VOL='__ICON_VOL__', ICON_MUTE='__ICON_MUTE__';

  function fmt(t){ if(!isFinite(t))t=0; t=Math.floor(t); var m=Math.floor(t/60), s=t%60; var h=Math.floor(m/60); m=m%60;
    function p(n){return (n<10?'0':'')+n;} return h>0? h+':'+p(m)+':'+p(s) : m+':'+p(s); }
  function setPlayIcon(){ var i=v.paused?ICON_PLAY:ICON_PAUSE; playBtn.innerHTML=i; big.innerHTML=ICON_PLAY; np.classList.toggle('paused',v.paused); }
  function toggle(){ if(v.paused) v.play(); else v.pause(); }

  big.addEventListener('click',toggle);
  playBtn.addEventListener('click',toggle);
  v.addEventListener('click',toggle);
  v.addEventListener('play',setPlayIcon); v.addEventListener('pause',setPlayIcon);
  v.addEventListener('dblclick',function(){ toggleFull(); });

  v.addEventListener('timeupdate',function(){
    var p=v.duration? (v.currentTime/v.duration)*100:0;
    played.style.width=p+'%'; thumb.style.left=p+'%';
    timeEl.textContent=fmt(v.currentTime)+' / '+fmt(v.duration);
  });
  v.addEventListener('progress',function(){
    if(v.buffered.length&&v.duration){ buf.style.width=(v.buffered.end(v.buffered.length-1)/v.duration)*100+'%'; }
  });

  function seekTo(e){ var r=seek.getBoundingClientRect(); var x=(e.clientX-r.left)/r.width; x=Math.max(0,Math.min(1,x)); if(v.duration) v.currentTime=x*v.duration; }
  var dragging=false;
  seek.addEventListener('mousedown',function(e){ dragging=true; seekTo(e); });
  document.addEventListener('mousemove',function(e){ if(dragging) seekTo(e); });
  document.addEventListener('mouseup',function(){ dragging=false; });

  vol.addEventListener('input',function(){ v.volume=parseFloat(vol.value); v.muted=v.volume===0; updateVol(); });
  function updateVol(){ muteBtn.innerHTML=(v.muted||v.volume===0)?ICON_MUTE:ICON_VOL; }
  muteBtn.addEventListener('click',function(){ v.muted=!v.muted; vol.value=v.muted?0:(v.volume||1); updateVol(); });

  function toggleFull(){
    var fsEl=document.fullscreenElement||document.webkitFullscreenElement;
    if(fsEl){ (document.exitFullscreen||document.webkitExitFullscreen).call(document); return; }
    if(np.requestFullscreen){ np.requestFullscreen(); }
    else if(np.webkitRequestFullscreen){ np.webkitRequestFullscreen(); }
    else if(v.webkitEnterFullscreen){ v.webkitEnterFullscreen(); } /* iOS: only the video can go fullscreen */
  }
  fullBtn.addEventListener('click',toggleFull);

  // speed menu
  var speeds=[0.5,0.75,1,1.25,1.5,2];
  speeds.forEach(function(s){ var b=document.createElement('button'); b.className='np-item'+(s===1?' active':''); b.textContent=s+'x'; b.onclick=function(){ v.playbackRate=s; speedBtn.textContent=s+'x'; [].forEach.call(speedMenu.children,function(c){c.classList.remove('active');}); b.classList.add('active'); speedMenu.classList.remove('open'); }; speedMenu.appendChild(b); });
  speedBtn.addEventListener('click',function(e){ e.stopPropagation(); ccMenu.classList.remove('open'); settingsMenu.classList.remove('open'); speedMenu.classList.toggle('open'); });

  // subtitles
  var trackEls=[];
  function addTrack(label,src){ var t=document.createElement('track'); t.kind='subtitles'; t.label=label; t.src=src; v.appendChild(t); trackEls.push(t); return trackEls.length-1; }
  function showTrack(idx){ for(var i=0;i<v.textTracks.length;i++){ v.textTracks[i].mode=(i===idx)?'showing':'disabled'; }
    [].forEach.call(ccMenu.children,function(c){ c.classList.toggle('active', c.dataset.idx===String(idx)); }); }
  function rebuildCCMenu(){ ccMenu.innerHTML='';
    var off=document.createElement('button'); off.className='np-item active'; off.textContent='Off'; off.dataset.idx='-1'; off.onclick=function(){ showTrack(-1); ccMenu.classList.remove('open'); }; ccMenu.appendChild(off);
    trackEls.forEach(function(t,i){ var b=document.createElement('button'); b.className='np-item'; b.textContent=t.label; b.dataset.idx=String(i); b.onclick=function(){ showTrack(i); ccMenu.classList.remove('open'); }; ccMenu.appendChild(b); });
    var load=document.createElement('button'); load.className='np-item'; load.textContent='＋ Load subtitle…'; load.onclick=function(){ subFile.click(); ccMenu.classList.remove('open'); }; ccMenu.appendChild(load);
  }
  (window.__SUBS__||[]).forEach(function(s){ addTrack(s.label,s.url); });
  rebuildCCMenu();
  ccBtn.addEventListener('click',function(e){ e.stopPropagation(); speedMenu.classList.remove('open'); settingsMenu.classList.remove('open'); ccMenu.classList.toggle('open'); });

  // subtitle style settings (size / color / background / edge)
  var subDims=[
    {cls:'subsize',store:'np-subsize',def:'md',opts:[['sm','S'],['md','M'],['lg','L'],['xl','XL']],label:'Size',kind:'chip'},
    {cls:'subcolor',store:'np-subcolor',def:'white',opts:[['white','White','#fff'],['yellow','Yellow','#ffeb3b'],['cyan','Cyan','#00e5ff'],['green','Green','#76ff03']],label:'Color',kind:'swatch'},
    {cls:'subbg',store:'np-subbg',def:'solid',opts:[['solid','Solid'],['semi','Semi'],['none','None']],label:'Background',kind:'chip'},
    {cls:'subedge',store:'np-subedge',def:'none',opts:[['none','None'],['drop','Drop shadow'],['outline','Outline']],label:'Edge style',kind:'chip'}
  ];
  function loadDim(d){ var v; try{v=localStorage.getItem(d.store);}catch(e){} return d.opts.some(function(o){return o[0]===v;})?v:d.def; }
  function setDim(d,id){ d.opts.forEach(function(o){ np.classList.remove(d.cls+'-'+o[0]); }); np.classList.add(d.cls+'-'+id); try{localStorage.setItem(d.store,id);}catch(e){} }
  function rebuildSettingsMenu(){ settingsMenu.innerHTML='';
    subDims.forEach(function(d){
      var row=document.createElement('div'); row.className='np-setrow';
      var lbl=document.createElement('div'); lbl.className='np-setlabel'; lbl.textContent=d.label; row.appendChild(lbl);
      var chips=document.createElement('div'); chips.className='np-chips';
      var cur=loadDim(d);
      d.opts.forEach(function(o){
        var b=document.createElement('button');
        if(d.kind==='swatch'){ b.className='np-swatch'+(o[0]===cur?' active':''); b.style.background=o[2]; b.setAttribute('aria-label',o[1]); }
        else { b.className='np-chip'+(o[0]===cur?' active':''); b.textContent=o[1]; }
        b.onclick=function(){ setDim(d,o[0]); rebuildSettingsMenu(); };
        chips.appendChild(b);
      });
      row.appendChild(chips); settingsMenu.appendChild(row);
    });
  }
  subDims.forEach(function(d){ setDim(d,loadDim(d)); });
  rebuildSettingsMenu();
  settingsBtn.addEventListener('click',function(e){ e.stopPropagation(); ccMenu.classList.remove('open'); speedMenu.classList.remove('open'); settingsMenu.classList.toggle('open'); });

  function srtToVtt(t){ return 'WEBVTT\n\n'+t.replace(/\r\n/g,'\n').replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g,'$1.$2'); }
  subFile.addEventListener('change',function(){ var f=subFile.files&&subFile.files[0]; if(!f)return; var r=new FileReader();
    r.onload=function(){ var txt=String(r.result||''); if(/\.srt$/i.test(f.name)) txt=srtToVtt(txt); var url=URL.createObjectURL(new Blob([txt],{type:'text/vtt'}));
      var idx=addTrack(f.name+' (local)',url); rebuildCCMenu(); setTimeout(function(){ showTrack(idx); },80); }; r.readAsText(f); });

  document.addEventListener('click',function(){ ccMenu.classList.remove('open'); settingsMenu.classList.remove('open'); speedMenu.classList.remove('open'); });

  // auto-hide controls
  var hideT;
  function activity(){ np.classList.remove('hide','hidecursor'); clearTimeout(hideT); hideT=setTimeout(function(){ if(!v.paused){ np.classList.add('hide','hidecursor'); } },2500); }
  np.addEventListener('mousemove',activity); np.addEventListener('mouseleave',function(){ if(!v.paused) np.classList.add('hide'); });
  activity();

  // keyboard
  np.addEventListener('keydown',function(e){
    if(e.key===' '||e.key==='k'){ e.preventDefault(); toggle(); }
    else if(e.key==='ArrowRight'){ v.currentTime=Math.min(v.duration||0,v.currentTime+5); }
    else if(e.key==='ArrowLeft'){ v.currentTime=Math.max(0,v.currentTime-5); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); v.volume=Math.min(1,v.volume+0.1); vol.value=v.volume; updateVol(); }
    else if(e.key==='ArrowDown'){ e.preventDefault(); v.volume=Math.max(0,v.volume-0.1); vol.value=v.volume; updateVol(); }
    else if(e.key==='f'){ toggleFull(); }
    else if(e.key==='m'){ v.muted=!v.muted; vol.value=v.muted?0:(v.volume||1); updateVol(); }
    activity();
  });

  setPlayIcon(); updateVol();
})();
`

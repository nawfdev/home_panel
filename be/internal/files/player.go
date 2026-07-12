package files

import (
	"encoding/json"
	"net/url"
	"strings"
)

// PlayerHTML renders a self-contained (CSP-safe, no external assets) dark media
// player page for a shared video/image/audio file. basePath is the request path
// of the shared file (without query); the media bytes are fetched from
// basePath?raw=1 and sidecar subtitles from basePath?sub=<name>.
func PlayerHTML(mediaType, basePath, fileName string, subs []Subtitle) string {
	rawURL := basePath + "?raw=1"
	subsJSON, _ := json.Marshal(subtitleTracks(basePath, subs))

	var media string
	switch mediaType {
	case "image":
		media = `<img src="` + htmlEscape(rawURL) + `" alt="` + htmlEscape(fileName) + `" class="media-img">`
	case "audio":
		media = `<audio id="player" controls src="` + htmlEscape(rawURL) + `" class="media-audio"></audio>`
	default: // video
		media = `<video id="player" controls playsinline class="media-video"><source src="` + htmlEscape(rawURL) + `"></video>`
	}

	showSubtitleUI := mediaType == "video"

	var b strings.Builder
	b.WriteString(`<!doctype html><html><head><meta charset="utf-8">`)
	b.WriteString(`<meta name="viewport" content="width=device-width, initial-scale=1">`)
	b.WriteString(`<title>` + htmlEscape(fileName) + `</title><style>`)
	b.WriteString(playerCSS)
	b.WriteString(`</style></head><body>`)
	b.WriteString(`<div class="wrap"><div class="title">` + htmlEscape(fileName) + `</div>`)
	b.WriteString(`<div class="stage">` + media + `</div>`)
	if showSubtitleUI {
		b.WriteString(`<div class="bar">`)
		b.WriteString(`<label class="sublabel">Subtitle:</label>`)
		b.WriteString(`<select id="subsel"><option value="">Off</option></select>`)
		b.WriteString(`<label class="upload">Load .srt/.vtt<input type="file" id="subfile" accept=".srt,.vtt" hidden></label>`)
		b.WriteString(`</div>`)
	}
	b.WriteString(`<a class="dl" href="` + htmlEscape(rawURL) + `" download>Download</a>`)
	b.WriteString(`</div>`)
	if showSubtitleUI {
		b.WriteString(`<script>window.__SUBS__=` + string(subsJSON) + `;</script>`)
		b.WriteString(`<script>` + playerJS + `</script>`)
	}
	b.WriteString(`</body></html>`)
	return b.String()
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

const playerCSS = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0b1220;color:#e5e7eb;font-family:system-ui,-apple-system,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.wrap{width:100%;max-width:1100px}
.title{font-size:14px;color:#9ca3af;margin-bottom:12px;word-break:break-all;text-align:center}
.stage{background:#000;border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 40px rgba(0,0,0,.5)}
.media-video{width:100%;max-height:78vh;display:block;background:#000}
.media-img{max-width:100%;max-height:80vh;display:block}
.media-audio{width:100%;padding:24px}
.bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px;justify-content:center}
.sublabel{font-size:13px;color:#9ca3af}
select{background:#1f2937;color:#e5e7eb;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:7px 10px;font-size:13px}
.upload{background:#1f2937;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:7px 12px;font-size:13px;cursor:pointer;color:#e5e7eb}
.upload:hover{background:#374151}
.dl{display:inline-block;margin-top:16px;color:#60a5fa;text-decoration:none;font-size:13px}
.dl:hover{text-decoration:underline}
`

// playerJS wires the subtitle <select> and local-file loader. It converts an
// uploaded .srt to WebVTT in the browser (same rule as the server-side path)
// so viewers can supply their own subtitle file.
const playerJS = `
(function(){
  var video=document.getElementById('player');
  var sel=document.getElementById('subsel');
  var fileInput=document.getElementById('subfile');
  if(!video||!sel) return;
  var tracks=[];
  function clearTracks(){
    tracks.forEach(function(t){ if(t.el&&t.el.parentNode) t.el.parentNode.removeChild(t.el); if(t.url) URL.revokeObjectURL(t.url); });
    tracks=[];
  }
  function addTrack(label,src){
    var t=document.createElement('track');
    t.kind='subtitles'; t.label=label; t.src=src; t.default=false;
    video.appendChild(t);
    return t;
  }
  (window.__SUBS__||[]).forEach(function(s){
    var el=addTrack(s.label,s.url);
    tracks.push({el:el});
    var opt=document.createElement('option'); opt.value=String(tracks.length-1); opt.textContent=s.label; sel.appendChild(opt);
  });
  function showTrack(idx){
    for(var i=0;i<video.textTracks.length;i++){ video.textTracks[i].mode='disabled'; }
    if(idx>=0&&idx<video.textTracks.length){ video.textTracks[idx].mode='showing'; }
  }
  sel.addEventListener('change',function(){ showTrack(sel.value===''?-1:parseInt(sel.value,10)); });
  function srtToVtt(t){
    t=t.replace(/\r\n/g,'\n').replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g,'$1.$2');
    return 'WEBVTT\n\n'+t;
  }
  if(fileInput){
    fileInput.addEventListener('change',function(){
      var f=fileInput.files&&fileInput.files[0]; if(!f) return;
      var reader=new FileReader();
      reader.onload=function(){
        var text=String(reader.result||'');
        if(/\.srt$/i.test(f.name)) text=srtToVtt(text);
        var blob=new Blob([text],{type:'text/vtt'});
        var url=URL.createObjectURL(blob);
        var el=addTrack(f.name,url);
        tracks.push({el:el,url:url});
        var opt=document.createElement('option'); opt.value=String(tracks.length-1); opt.textContent=f.name+' (local)'; sel.appendChild(opt);
        sel.value=String(tracks.length-1);
        setTimeout(function(){ showTrack(tracks.length-1); },100);
      };
      reader.readAsText(f);
    });
  }
})();
`

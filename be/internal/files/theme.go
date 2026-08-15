package files

import "strings"

// Shared visual theme for the standalone (server-rendered) public pages —
// the share player and the folder listing. These pages live outside the React
// app, so they can't use its Tailwind classes; this mirrors the panel's real
// design tokens from fe/src/index.css so the pages match the panel exactly:
// near-black monochrome (not blue), zinc grays, white accents, Plus Jakarta
// Sans / JetBrains Mono.

// jsEscape escapes a string for embedding inside a single-quoted JS string
// literal (used to inline SVG icon markup into the player script).
func jsEscape(s string) string {
	r := strings.NewReplacer("\\", "\\\\", "'", "\\'", "\n", "\\n", "\r", "", "<", "\\x3c")
	return r.Replace(s)
}

// themeHead returns the <head> contents (meta, fonts, title) for a public page.
func themeHead(title string) string {
	return `<meta charset="utf-8">` +
		`<meta name="viewport" content="width=device-width, initial-scale=1">` +
		`<link rel="preconnect" href="https://fonts.googleapis.com">` +
		`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
		`<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">` +
		`<title>` + htmlEscape(title) + `</title>`
}

// topBarHTML renders the slim branding header shown atop every public
// (unauthenticated) page — a small Nestcore mark plus a link back to the
// panel. Without it, a shared link is just bare content on black with no
// page context; this one line of chrome fixes that without adding weight.
func topBarHTML() string {
	return `<div class="topbar">` +
		`<div class="topbar-brand"><span class="topbar-mark">` + icoServer + `</span>Nestcore</div>` +
		`<a class="topbar-link" href="/login">Open panel →</a>` +
		`</div>`
}

const icoServer = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="1.6"/><rect x="3" y="13" width="18" height="7" rx="1.6"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>`

// panelBaseCSS mirrors fe/src/index.css tokens: body #0a0a0b, panel #131316,
// hairline borders, zinc text, monochrome (white) accents — no blue.
const panelBaseCSS = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0a0a0b;color:#f4f4f5;font-family:"Plus Jakarta Sans",ui-sans-serif,system-ui,sans-serif;letter-spacing:-0.01em}
h1,h2,h3{letter-spacing:-0.02em}
a{color:#f4f4f5;text-decoration:none}
a:hover{color:#fafafa;text-decoration:underline}
.mono{font-family:"JetBrains Mono",ui-monospace,monospace}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-thumb{background:#27272a;border-radius:4px}
::-webkit-scrollbar-thumb:hover{background:#3f3f46}
/* secondary-button look, matching .btn-secondary in the panel */
.btn{display:inline-flex;align-items:center;gap:6px;background:#18181b;color:#f4f4f5;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer;font-family:inherit}
.btn:hover{background:#27272a;text-decoration:none}
select.btn{padding:8px 10px}
/* Slim header bar shown atop every public page — see topBarHTML. */
.topbar{display:flex;align-items:center;justify-content:space-between;max-width:1100px;margin:0 auto;padding:18px 16px 0}
.topbar-brand{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:700;color:#f4f4f5}
.topbar-mark{width:26px;height:26px;border-radius:7px;background:#18181b;border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;color:#a1a1aa;flex-shrink:0}
.topbar-mark svg{width:14px;height:14px}
.topbar-link{font-size:12px;color:#71717a;font-weight:500}
.topbar-link:hover{color:#e4e4e7;text-decoration:none}
`

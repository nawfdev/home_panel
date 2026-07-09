# Home Panel — Go Migration (big-bang rewrite, Linux + Windows)

Goal: replace the Node/Express backend (`backend/`) with a Go server, keeping the
**frontend** (`frontend/`), **config** (`config/config.json`), and **data store**
(`data/db.json`) byte-compatible.

Migration complete: the Node backend (`backend/`) and its dependencies have been
removed. The Go server at `be/` is the only backend, on both this repo and
the deployed VPS (`homepanel-go.service`).

## Key facts discovered
- The "database" is **not SQLite** despite `better-sqlite3` in package.json. It is a
  JSON file (`data/db.json`) with `users`, `projects`, `settings`. Ported as a JSON store.
- `cloudflared.js` hard-codes `systemctl`/`journalctl`/`sudo` — absent on Windows. All
  OS service control goes through `internal/platform` (`platform_linux.go` / `platform_windows.go`).
- The Node `/tunnel/logs?limit=` route had a **shell command-injection** via `limit`.
  The Go port passes `limit` as a bounded base-10 int arg (no shell). Do not regress this.

## Run
```
npm start
# or
cd be && go run ./cmd/homepanel
```

Defaults: config `<root>/config/config.json`, data `<root>/data/db.json`, static `<root>/frontend`.
When run from `be/`, path resolution automatically uses the parent repo root.

## Route groups
- [x] `auth`        — `/api/auth/*`, signed cookie sessions
- [x] `system`      — gopsutil stats + process list
- [x] `metrics`     — 24h ring collector (60s), cpu/memory/network/temperature
- [x] `services`    — systemd/Windows list + start/stop via `internal/platform`
- [x] `logs`        — panel/docker/pm2 sources + targets + log search
- [x] `update`      — git check/info/apply (`internal/updater`)
- [x] `network`     — public IP, interfaces, DNS, gateway, connectivity
- [x] `dashboard`   — system+tunnel+projects+temperature + Cloudflare API enrichment
- [x] `projects`    — CRUD + npm spawn/kill (cross-OS process group / taskkill)
- [x] `telegram`    — Telegram send/test/status via HTTP Bot API
- [x] `settings`    — Cloudflare verify + Telegram masked config + service path detect
- [x] `cloudflare`  — tunnels, zones, config get/update/delete via Cloudflare API
- [x] `export`      — pm2/docker source → streamed zip with excludes
- [x] `pm2`         — wraps `pm2 jlist` CLI and lifecycle/log routes
- [x] `docker`      — Docker CLI lifecycle/list/logs/stats/run/status routes
- [x] `alerts`      — background threshold + tunnel health monitor, Telegram notifications
- [x] `tunnel`      — status/list/create/configure/route/start/stop/systemd/metrics/autorestart/logs
- [x] `files`       — list/read/write/delete/download/upload with safe path allowlist
- [x] `web terminal` — `/terminal` WebSocket, session-authenticated command runner

## Verification
- [x] `go build ./...` passes on Windows.
- [x] `go vet ./...` passes.
- [x] `go test ./...` passes.
- [x] `GOOS=linux GOARCH=amd64 go build ./...` passes.
- [x] WebSocket auth reuses the same signed session manager as HTTP auth.

## Known behavior differences from Node
- Terminal is command-runner parity with the existing Node implementation, not a full PTY.
- Docker is CLI-based instead of the earlier plan to use the official SDK; this preserves current deployment assumptions and avoids daemon socket API differences.
- Running from `be/` now auto-detects the parent repo root, so `HOMEPANEL_ROOT` is optional.

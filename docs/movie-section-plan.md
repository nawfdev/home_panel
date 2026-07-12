# Movie Section — Blueprint

Status: **DRAFT / review gate** (belum ada kode implementasi). Arah disepakati:
bertahap — browse dulu + downloader nyata, auto-resolve shortener menyusul.

## Ide (dari user)
Section "Movie" baru. Sumber: pahe.ink (movieku sudah mati/redirect terus).
Dari panel: cari film → download langsung ke server → file ke-save → bisa
di-stream & di-share, pakai player yang sama seperti sekarang.

## Realita hasil verifikasi (bukan asumsi)
- **movieku.blog** = halaman redirect ("klik link di bawah → movieku.rest"),
  domain gonta-ganti. Tidak dipakai sebagai sumber.
- **pahe.ink** = hidup. Homepage & halaman detail bisa di-parse.
- Link download di pahe.ink **bukan direct file**. Semua lewat shortener
  anti-bot (`oii.la`, `tpi.li`) lalu ke host (Google Drive / "SD" / "MG").
  → Bagian resolve+download inilah yang paling rapuh.

## Prinsip desain
1. **Player / stream / share = REUSE, nol kode baru.** Begitu file `.mp4` ada
   di bawah allowed root, `PlayerHTML` + `shares.go` + range streaming otomatis
   jalan. (Dikonfirmasi dari `be/internal/files/player.go`, `shares.go`,
   `handlers/files.go`.)
2. **Storage:** film disimpan di bawah `SafePath` allowlist. Di Windows itu
   `C:\Users\...`. Default folder: `C:\Users\<user>\Movies` (atau setting).
   → downloaded movie = file biasa di allowed path = langsung dapat player+share.
3. **Ikuti pola existing persis:** routes di `server.go` (`api.Route("/movies")`
   di bawah `auth.RequireAuth`), handler thin di `handlers/movies.go`, domain
   logic di `internal/movies/`.

## Fase
### Fase 1 — Browse + Downloader nyata (fokus sekarang)
- `internal/movies/scrape.go`
  - `Search(query)` → parse homepage/hasil search pahe.ink → `[]Film{Title,
    Poster, DetailURL, Year, Quality[]}`.
  - `Detail(url)` → parse halaman film → daftar `[]DownloadOption{Quality, Size,
    Host, Link}` (link mentah, termasuk shortener).
- `internal/movies/download.go`
  - Job queue in-memory + progress (bytes, total, speed, ETA, status).
  - Download dari **direct URL / host mudah** dulu (streaming ke disk, resume
    kalau bisa), save ke folder Movies, lalu `remuxFaststartAsync` (sudah ada).
  - Progress via SSE endpoint (`GET /api/movies/downloads/stream`).
- `handlers/movies.go`: Search, Detail, StartDownload, ListDownloads,
  CancelDownload, DownloadsStream.
- `server.go`: daftar route `/api/movies` (auth).
- Frontend: grid poster + search box; panel "Downloads" progress realtime;
  film selesai → tombol Play (player existing) + Share (share existing).

### Fase 2 — Best-effort auto-resolve shortener (menyusul)
- Coba resolve `oii.la` / `tpi.li` → host asli → direct file.
- Kalau gagal: fallback tombol "Buka link manual" (user selesaikan di browser,
  lalu paste direct link ke downloader Fase 1). Tidak menggantung seluruh fitur.

## Risiko yang diterima
- Scraper rapuh terhadap perubahan layout pahe.ink → perlu maintenance.
- Sebagian host (GDrive quota/captcha) mungkin tetap gagal di Fase 2.
- Asumsi: panel pribadi, bukan layanan publik/komersil.

## Definition of done (Fase 1)
- Backend build hijau, route `/api/movies` jalan di bawah auth.
- Dari UI: search pahe.ink → muncul daftar film + poster.
- Start download 1 direct link → progress bar jalan → file ke-save di Movies.
- File itu bisa di-Play (player existing) DAN di-Share (share existing),
  diverifikasi manual end-to-end.

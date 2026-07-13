import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import { MediaPlayer } from "./MediaPlayer";
import { formatBytes } from "../lib/format";
import { copyText } from "../lib/clipboard";
import {
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
  PlayIcon,
  ShareIcon,
  ClipboardIcon,
  XMarkIcon,
  FilmIcon,
  LanguageIcon,
} from "@heroicons/react/24/outline";

interface Film {
  title: string;
  poster: string;
  detailUrl: string;
  year: string;
}

interface DownloadOption {
  quality: string;
  size: string;
  host: string;
  link: string;
}

interface Job {
  id: string;
  title: string;
  url: string;
  dest: string;
  status: "queued" | "downloading" | "remuxing" | "done" | "error" | "canceled";
  downloaded: number;
  total: number;
  speedBps: number;
  error?: string;
  createdAt: string;
}

interface SubtitleResult {
  subtitleId: number;
  language: string;
  releaseInfo: string[];
  downloads: number;
  rating: { good: number; bad: number; total: number };
}

interface TorrentResult {
  title: string;
  size: string;
  seeds: number;
  peers: number;
  provider: string;
  magnet: string;
}

// Seeds are the clearest at-a-glance signal a layperson has for "will this
// actually download at a decent speed" — few/no seeds means a stalled or dead
// torrent no matter how good the title match looks.
function torrentQuality(seeds: number): { label: string; className: string } {
  if (seeds >= 20) return { label: "Good", className: "bg-green-500/15 text-green-400" };
  if (seeds >= 5) return { label: "OK", className: "bg-yellow-500/15 text-yellow-400" };
  return { label: "Risky", className: "bg-red-500/15 text-red-400" };
}

const TTL_OPTIONS: { label: string; seconds: number }[] = [
  { label: "Never expires", seconds: 0 },
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "7 days", seconds: 604800 },
];

// The downloader saves under C:\Users\<user>\Movies. The panel serves that path
// through /files, so a finished job's dest is a valid path for the player and
// share endpoints — same stack the Files page uses.
export function Movies() {
  const { show } = useToast();
  const [mode, setMode] = useState<"pahe" | "torrent">("pahe");
  const [query, setQuery] = useState("");
  const [films, setFilms] = useState<Film[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [torrents, setTorrents] = useState<TorrentResult[] | null>(null);
  const [searchingTorrents, setSearchingTorrents] = useState(false);
  const [startingTorrent, setStartingTorrent] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [brokenPosters, setBrokenPosters] = useState<Set<string>>(new Set());

  const [detail, setDetail] = useState<{ film: Film; options: DownloadOption[] | null } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState("");

  const [jobs, setJobs] = useState<Job[]>([]);
  const [downloadsOpen, setDownloadsOpen] = useState(false);

  const [player, setPlayer] = useState<{
    path: string;
    name: string;
    type: "video" | "image" | "audio";
    subtitles: { name: string; label: string }[];
  } | null>(null);
  const [shareTarget, setShareTarget] = useState<Job | null>(null);
  const [shareTtl, setShareTtl] = useState(0);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [creatingShare, setCreatingShare] = useState(false);

  const [subtitleTarget, setSubtitleTarget] = useState<Job | null>(null);
  const [subtitleLang, setSubtitleLang] = useState("english");
  const [subtitleResults, setSubtitleResults] = useState<SubtitleResult[] | null>(null);
  const [searchingSubs, setSearchingSubs] = useState(false);
  const [downloadingSubId, setDownloadingSubId] = useState<number | null>(null);

  const esRef = useRef<EventSource | null>(null);

  // Live download progress over SSE. Falls back silently if the stream drops;
  // the initial list load still populates the panel.
  useEffect(() => {
    loadJobs();
    const es = new EventSource("/api/movies/downloads/stream", { withCredentials: true });
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { jobs: Job[] };
        setJobs(data.jobs ?? []);
      } catch {
        /* ignore malformed frame */
      }
    };
    es.onerror = () => {
      /* keep last known state; browser auto-reconnects */
    };
    esRef.current = es;
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadJobs() {
    try {
      const data = await api<{ success: boolean; jobs: Job[] }>("/movies/downloads");
      setJobs(data.jobs ?? []);
    } catch {
      /* non-fatal */
    }
  }

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (searching) return;
    setSearching(true);
    try {
      const data = await api<{ success: boolean; films: Film[]; error?: string }>("/movies/search", {
        method: "POST",
        body: JSON.stringify({ query, page: 1 }),
      });
      if (data.success) {
        const results = data.films ?? [];
        setFilms(results);
        setPage(1);
        setHasMore(results.length > 0);
        setBrokenPosters(new Set());
      } else {
        show(data.error ?? "Search failed", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Search failed", "error");
    } finally {
      setSearching(false);
    }
  }

  async function searchTorrents(e?: React.FormEvent) {
    e?.preventDefault();
    if (searchingTorrents) return;
    setSearchingTorrents(true);
    try {
      const data = await api<{ success: boolean; results?: TorrentResult[]; error?: string }>("/movies/torrents/search", {
        method: "POST",
        body: JSON.stringify({ query }),
      });
      if (data.success) {
        setTorrents([...(data.results ?? [])].sort((a, b) => b.seeds - a.seeds));
      } else {
        show(data.error ?? "Torrent search failed", "error");
        setTorrents([]);
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Torrent search failed", "error");
      setTorrents([]);
    } finally {
      setSearchingTorrents(false);
    }
  }

  async function startTorrentDownload(t: TorrentResult) {
    if (startingTorrent) return;
    setStartingTorrent(t.magnet);
    try {
      const data = await api<{ success: boolean; job?: Job; error?: string }>("/movies/torrents/download", {
        method: "POST",
        body: JSON.stringify({ title: t.title, url: t.magnet }),
      });
      if (data.success) {
        show("Download started", "success");
        loadJobs();
      } else {
        show(data.error ?? "Couldn't start download", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't start download", "error");
    } finally {
      setStartingTorrent(null);
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const data = await api<{ success: boolean; films: Film[]; error?: string }>("/movies/search", {
        method: "POST",
        body: JSON.stringify({ query, page: nextPage }),
      });
      if (data.success) {
        const results = data.films ?? [];
        setFilms((prev) => {
          const seen = new Set((prev ?? []).map((f) => f.detailUrl));
          return [...(prev ?? []), ...results.filter((f) => !seen.has(f.detailUrl))];
        });
        setPage(nextPage);
        setHasMore(results.length > 0);
      } else {
        show(data.error ?? "Couldn't load more", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't load more", "error");
    } finally {
      setLoadingMore(false);
    }
  }

  async function openDetail(film: Film) {
    setManualUrl("");
    setDetail({ film, options: null });
    setLoadingDetail(true);
    try {
      const data = await api<{ success: boolean; options: DownloadOption[]; error?: string }>("/movies/detail", {
        method: "POST",
        body: JSON.stringify({ url: film.detailUrl }),
      });
      if (data.success) {
        setDetail({ film, options: data.options ?? [] });
      } else {
        show(data.error ?? "Couldn't load download options", "error");
        setDetail({ film, options: [] });
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't load download options", "error");
      setDetail({ film, options: [] });
    } finally {
      setLoadingDetail(false);
    }
  }

  async function startDownloadRequest(key: string, title: string, url: string) {
    if (startingKey) return;
    setStartingKey(key);
    try {
      const data = await api<{ success: boolean; job?: Job; error?: string }>("/movies/download", {
        method: "POST",
        body: JSON.stringify({ title, url }),
      });
      if (data.success) {
        show("Download started", "success");
        setDetail(null);
        loadJobs();
      } else {
        show(data.error ?? "Couldn't start download", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't start download", "error");
    } finally {
      setStartingKey(null);
    }
  }

  function startDownload(film: Film, opt: DownloadOption) {
    const title = `${film.title}${opt.quality ? " " + opt.quality : ""}`;
    startDownloadRequest(opt.link, title, opt.link);
  }

  function startManualDownload(film: Film) {
    const url = manualUrl.trim();
    if (!url) return;
    startDownloadRequest("manual", film.title, url);
    setManualUrl("");
  }

  async function cancelJob(id: string) {
    try {
      await api(`/movies/downloads/${id}`, { method: "DELETE" });
      loadJobs();
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't cancel", "error");
    }
  }

  // Convert an absolute dest path to the /files-relative path the player and
  // share endpoints expect (they resolve against the same SafePath allowlist).
  function playerPath(dest: string): string {
    return dest;
  }

  // Detects sidecar subtitles (including ones the subtitle search saved, or
  // extracted from an mkv's embedded tracks) the same way Files.tsx does.
  async function playJob(job: Job) {
    const name = job.dest.split(/[\\/]/).pop() ?? job.title;
    const path = playerPath(job.dest);
    try {
      const info = await api<{ success: boolean; type: string; subtitles: { name: string; label: string }[] }>(
        "/files/media-info",
        { method: "POST", body: JSON.stringify({ path }) }
      );
      const type = info.type === "image" || info.type === "audio" ? info.type : "video";
      setPlayer({ path, name, type, subtitles: info.subtitles ?? [] });
    } catch {
      setPlayer({ path, name, type: "video", subtitles: [] });
    }
  }

  function openSubtitleSearch(job: Job) {
    setSubtitleTarget(job);
    setSubtitleResults(null);
    searchSubtitles(job, subtitleLang);
  }

  async function searchSubtitles(job: Job, lang: string) {
    setSearchingSubs(true);
    try {
      const data = await api<{ success: boolean; results?: SubtitleResult[]; error?: string }>(
        "/movies/subtitles/search",
        { method: "POST", body: JSON.stringify({ title: job.title, lang }) }
      );
      if (data.success) {
        setSubtitleResults(data.results ?? []);
      } else {
        show(data.error ?? "Subtitle search failed", "error");
        setSubtitleResults([]);
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Subtitle search failed", "error");
      setSubtitleResults([]);
    } finally {
      setSearchingSubs(false);
    }
  }

  async function downloadSubtitle(result: SubtitleResult) {
    if (!subtitleTarget || downloadingSubId) return;
    setDownloadingSubId(result.subtitleId);
    try {
      const data = await api<{ success: boolean; error?: string }>("/movies/subtitles/download", {
        method: "POST",
        body: JSON.stringify({ subtitleId: result.subtitleId, videoDest: subtitleTarget.dest, lang: result.language }),
      });
      if (data.success) {
        show("Subtitle saved", "success");
      } else {
        show(data.error ?? "Couldn't download subtitle", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't download subtitle", "error");
    } finally {
      setDownloadingSubId(null);
    }
  }

  function openShare(job: Job) {
    setShareTarget(job);
    setShareTtl(0);
    setShareUrl(null);
  }

  async function createShare() {
    if (!shareTarget) return;
    setCreatingShare(true);
    try {
      const data = await api<{ success: boolean; share?: { token: string }; error?: string }>("/files/share", {
        method: "POST",
        body: JSON.stringify({ path: playerPath(shareTarget.dest), ttlSeconds: shareTtl }),
      });
      if (data.success && data.share) {
        setShareUrl(`${window.location.origin}/share/${data.share.token}`);
        show("Share link created", "success");
      } else {
        show(data.error ?? "Failed to create share", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to create share", "error");
    } finally {
      setCreatingShare(false);
    }
  }

  const activeJobCount = jobs.filter((j) => j.status === "queued" || j.status === "downloading" || j.status === "remuxing").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Movies</h2>
          <p className="text-gray-500 text-sm mt-1">Browse pahe.ink, download to the server, then stream & share.</p>
        </div>
        <button className="btn-secondary" onClick={loadJobs}>
          <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
        </button>
      </div>

      <div className="tab-bar mb-4">
        <button className={`tab-btn ${mode === "pahe" ? "active" : ""}`} onClick={() => setMode("pahe")}>
          Pahe.ink
        </button>
        <button className={`tab-btn ${mode === "torrent" ? "active" : ""}`} onClick={() => setMode("torrent")}>
          Torrent
        </button>
      </div>

      <form onSubmit={mode === "pahe" ? search : searchTorrents} className="flex gap-2 mb-6">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={mode === "pahe" ? "Search a movie title, or leave empty to browse latest…" : "Search a movie/show title…"}
          className="input-field flex-1 text-sm"
        />
        <button type="submit" className="btn-primary disabled:opacity-60" disabled={mode === "pahe" ? searching : searchingTorrents}>
          <MagnifyingGlassIcon className="w-4 h-4 inline mr-1.5" />
          {mode === "pahe" ? (searching ? "Searching…" : "Search") : searchingTorrents ? "Searching…" : "Search"}
        </button>
      </form>

      {/* Downloads dropdown — collapsed by default; badge shows active jobs. */}
      {jobs.length > 0 && (
        <Panel className="mb-6">
          <button
            className="flex items-center justify-between w-full text-left"
            onClick={() => setDownloadsOpen((o) => !o)}
          >
            <span className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              Downloads
              {activeJobCount > 0 && (
                <span className="bg-blue-500/20 text-blue-300 text-xs rounded-full px-2 py-0.5">
                  {activeJobCount}
                </span>
              )}
            </span>
            <ChevronDownIcon className={`w-4 h-4 text-gray-400 transition-transform ${downloadsOpen ? "rotate-180" : ""}`} />
          </button>
          {downloadsOpen && (
          <div className="space-y-2 mt-3">
            {jobs.map((job) => {
              const pct = job.total > 0 ? Math.round((job.downloaded / job.total) * 100) : 0;
              return (
                <div key={job.id} className="bg-white/5 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-100 truncate">{job.title}</p>
                      <p className="text-xs text-gray-500">
                        {job.status === "downloading" &&
                          `${formatBytes(job.downloaded)}${job.total > 0 ? " / " + formatBytes(job.total) : ""}` +
                            (job.speedBps > 0 ? ` · ${formatBytes(job.speedBps)}/s` : "")}
                        {job.status === "queued" && "Queued…"}
                        {job.status === "remuxing" && "Optimizing for streaming…"}
                        {job.status === "done" && `Saved · ${formatBytes(job.downloaded)}`}
                        {job.status === "canceled" && "Canceled"}
                        {job.status === "error" && <span className="text-red-400">{job.error}</span>}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {job.status === "done" && (
                        <>
                          <button className="btn-secondary" title="Play" onClick={() => playJob(job)}>
                            <PlayIcon className="w-4 h-4" />
                          </button>
                          <button className="btn-secondary" title="Share" onClick={() => openShare(job)}>
                            <ShareIcon className="w-4 h-4" />
                          </button>
                          <button className="btn-secondary" title="Find subtitles" onClick={() => openSubtitleSearch(job)}>
                            <LanguageIcon className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {(job.status === "downloading" || job.status === "queued") && (
                        <button className="btn-danger" title="Cancel" onClick={() => cancelJob(job.id)}>
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  {(job.status === "downloading" || job.status === "remuxing") && (
                    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden mt-2">
                      <div
                        className={`h-full transition-all duration-300 ${job.status === "remuxing" ? "bg-purple-500 animate-pulse w-full" : "bg-blue-500"}`}
                        style={job.status === "downloading" ? { width: `${pct}%` } : undefined}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          )}
        </Panel>
      )}

      {mode === "torrent" && (
        <Panel>
          {torrents === null ? (
            <p className="text-sm text-gray-500">Search to see torrent results.</p>
          ) : torrents.length === 0 ? (
            <p className="text-sm text-gray-500">No results.</p>
          ) : (
            <div className="space-y-2">
              {torrents.map((t) => {
                const quality = torrentQuality(t.seeds);
                return (
                <div key={t.magnet} className="bg-white/5 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-gray-100 truncate">{t.title}</p>
                      <span className={`status-badge shrink-0 ${quality.className}`}>{quality.label}</span>
                      {t.provider && (
                        <span className="shrink-0 px-2 py-0.5 rounded-md text-[11px] font-medium bg-white/10 text-gray-300">
                          {t.provider}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {t.size} · {t.seeds} seeds / {t.peers} peers
                    </p>
                  </div>
                  <button
                    className="btn-primary shrink-0 disabled:opacity-60"
                    onClick={() => startTorrentDownload(t)}
                    disabled={startingTorrent !== null}
                  >
                    <ArrowDownTrayIcon className="w-4 h-4 inline mr-1.5" />
                    {startingTorrent === t.magnet ? "Starting…" : "Download"}
                  </button>
                </div>
                );
              })}
            </div>
          )}
        </Panel>
      )}

      {mode === "pahe" && (
      <Panel>
        {films === null ? (
          <p className="text-sm text-gray-500">Search or browse to see movies.</p>
        ) : films.length === 0 ? (
          <p className="text-sm text-gray-500">No results.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {films.map((film) => (
                <button
                  key={film.detailUrl}
                  onClick={() => openDetail(film)}
                  className="group text-left bg-white/5 rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500/60 transition"
                >
                  <div className="aspect-[2/3] bg-white/5 flex items-center justify-center overflow-hidden">
                    {film.poster && !brokenPosters.has(film.detailUrl) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={film.poster}
                        alt={film.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        onError={() =>
                          setBrokenPosters((prev) => new Set(prev).add(film.detailUrl))
                        }
                      />
                    ) : (
                      <FilmIcon className="w-10 h-10 text-gray-600" />
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs text-gray-200 line-clamp-2">{film.title}</p>
                    {film.year && <p className="text-[10px] text-gray-500 mt-0.5">{film.year}</p>}
                  </div>
                </button>
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center mt-4">
                <button className="btn-secondary disabled:opacity-60" onClick={loadMore} disabled={loadingMore}>
                  <ChevronDownIcon className="w-4 h-4 inline mr-1.5" />
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </Panel>
      )}

      {detail && (
        <Modal title={detail.film.title} onClose={() => setDetail(null)} wide>
          {loadingDetail || detail.options === null ? (
            <p className="text-sm text-gray-500">Loading download options…</p>
          ) : (
            <div className="space-y-2">
              {detail.options.length === 0 && (
                <p className="text-sm text-gray-500">No download links found on this page.</p>
              )}
              {detail.options.map((opt, i) => (
                <div key={i} className="bg-white/5 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-100">{opt.quality || "Unknown quality"}</p>
                    <p className="text-xs text-gray-500">
                      {opt.size}
                      {opt.host && ` · ${opt.host}`}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <a
                      href={opt.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary"
                      title="Open in browser"
                    >
                      <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                    </a>
                    <button
                      className="btn-primary disabled:opacity-60"
                      onClick={() => startDownload(detail.film, opt)}
                      disabled={startingKey !== null}
                    >
                      <ArrowDownTrayIcon className="w-4 h-4 inline mr-1.5" />
                      {startingKey === opt.link ? "Starting…" : "Download"}
                    </button>
                  </div>
                </div>
              ))}
              <p className="text-xs text-gray-500 mt-3">
                Most links go through an anti-bot redirect and can't auto-download. Open one in your browser, wait for
                the real host page, then paste the direct file link below.
              </p>
              <div className="flex gap-2 pt-2">
                <input
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  placeholder="Paste direct file link…"
                  className="input-field flex-1 text-sm"
                />
                <button
                  className="btn-secondary shrink-0 disabled:opacity-60"
                  onClick={() => startManualDownload(detail.film)}
                  disabled={startingKey !== null || !manualUrl.trim()}
                >
                  {startingKey === "manual" ? "Starting…" : "Download"}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {player && (
        <MediaPlayer
          path={player.path}
          name={player.name}
          type={player.type}
          subtitles={player.subtitles}
          onClose={() => setPlayer(null)}
        />
      )}

      {shareTarget && (
        <Modal title={`Share "${shareTarget.title}"`} onClose={() => setShareTarget(null)} wide>
          <p className="text-xs text-gray-500 mb-3">
            Anyone with the link can stream this movie —<span className="text-yellow-400"> no panel login required.</span>
          </p>
          <div className="flex flex-col sm:flex-row gap-2 mb-2">
            <select
              value={shareTtl}
              onChange={(e) => setShareTtl(Number(e.target.value))}
              className="input-field flex-1 text-sm"
            >
              {TTL_OPTIONS.map((o) => (
                <option key={o.seconds} value={o.seconds}>
                  {o.label}
                </option>
              ))}
            </select>
            <button className="btn-primary disabled:opacity-60" onClick={createShare} disabled={creatingShare}>
              {creatingShare ? "Creating…" : "Create link"}
            </button>
          </div>
          {shareUrl && (
            <div className="bg-white/5 rounded-lg p-3 mt-3 flex items-center gap-2">
              <input readOnly value={shareUrl} className="input-field flex-1 font-mono text-xs" />
              <button
                className="btn-secondary shrink-0"
                title="Copy"
                onClick={async () => {
                  const ok = await copyText(shareUrl);
                  show(ok ? "Link copied" : "Couldn't copy — select and copy manually", ok ? "success" : "warning");
                }}
              >
                <ClipboardIcon className="w-4 h-4" />
              </button>
            </div>
          )}
        </Modal>
      )}

      {subtitleTarget && (
        <Modal title={`Subtitles for "${subtitleTarget.title}"`} onClose={() => setSubtitleTarget(null)} wide>
          <div className="flex gap-2 mb-3">
            <input
              value={subtitleLang}
              onChange={(e) => setSubtitleLang(e.target.value)}
              placeholder="Language (e.g. english, indonesian)"
              className="input-field flex-1 text-sm"
            />
            <button
              className="btn-primary disabled:opacity-60"
              onClick={() => searchSubtitles(subtitleTarget, subtitleLang)}
              disabled={searchingSubs}
            >
              <MagnifyingGlassIcon className="w-4 h-4 inline mr-1.5" />
              {searchingSubs ? "Searching…" : "Search"}
            </button>
          </div>
          {subtitleResults === null ? (
            <p className="text-sm text-gray-500">Searching…</p>
          ) : subtitleResults.length === 0 ? (
            <p className="text-sm text-gray-500">No subtitles found.</p>
          ) : (
            <div className="space-y-2">
              {subtitleResults.map((r) => (
                <div key={r.subtitleId} className="bg-white/5 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-100 truncate">{r.releaseInfo.join(" ") || r.language}</p>
                    <p className="text-xs text-gray-500">
                      {r.language} · {r.downloads} downloads
                      {r.rating.total > 0 && ` · ${r.rating.good}/${r.rating.total} rated good`}
                    </p>
                  </div>
                  <button
                    className="btn-primary shrink-0 disabled:opacity-60"
                    onClick={() => downloadSubtitle(r)}
                    disabled={downloadingSubId !== null}
                  >
                    <ArrowDownTrayIcon className="w-4 h-4 inline mr-1.5" />
                    {downloadingSubId === r.subtitleId ? "Saving…" : "Download"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

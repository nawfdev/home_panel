import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import {
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  ChevronDownIcon,
  FilmIcon,
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

interface TorrentResult {
  title: string;
  size: string;
  seeds: number;
  peers: number;
  provider: string;
  magnet: string;
  poster?: string;
}

// Seeds are the clearest at-a-glance signal a layperson has for "will this
// actually download at a decent speed" — few/no seeds means a stalled or dead
// torrent no matter how good the title match looks.
function torrentQuality(seeds: number): { label: string; className: string } {
  if (seeds >= 20) return { label: "Good", className: "bg-green-500/15 text-green-400" };
  if (seeds >= 5) return { label: "OK", className: "bg-yellow-500/15 text-yellow-400" };
  return { label: "Risky", className: "bg-red-500/15 text-red-400" };
}

// Search & browse only — active downloads and the finished-movie library now
// live on their own page (Downloads.tsx) reached via the nav, so starting a
// download here just hands off there instead of tracking job state locally.
export function Movies() {
  const { show } = useToast();
  const navigate = useNavigate();
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
      const data = await api<{ success: boolean; error?: string }>("/movies/torrents/download", {
        method: "POST",
        body: JSON.stringify({ title: t.title, url: t.magnet, poster: t.poster ?? "" }),
      });
      if (data.success) {
        show("Download started — see it on the Downloads page", "success");
        navigate("/downloads");
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

  async function startDownloadRequest(key: string, title: string, url: string, poster: string) {
    if (startingKey) return;
    setStartingKey(key);
    try {
      const data = await api<{ success: boolean; error?: string }>("/movies/download", {
        method: "POST",
        body: JSON.stringify({ title, url, poster }),
      });
      if (data.success) {
        show("Download started — see it on the Downloads page", "success");
        setDetail(null);
        navigate("/downloads");
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
    startDownloadRequest(opt.link, title, opt.link, film.poster);
  }

  function startManualDownload(film: Film) {
    const url = manualUrl.trim();
    if (!url) return;
    startDownloadRequest("manual", film.title, url, film.poster);
    setManualUrl("");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Movies</h2>
          <p className="text-gray-500 text-sm mt-1">Browse pahe.ink or search torrents, then download to the server.</p>
        </div>
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
    </div>
  );
}

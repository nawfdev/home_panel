import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { ShareQr } from "../components/ui/ShareQr";
import { NestVideo } from "./NestVideo";
import { copyText } from "../lib/clipboard";
import {
  ArrowLeftIcon,
  ArrowDownTrayIcon,
  ShareIcon,
  ClipboardIcon,
  LanguageIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";

interface Job {
  id: string;
  title: string;
  dest: string;
  poster?: string;
  status: string;
}

interface SubtitleResult {
  subtitleId: number;
  language: string;
  releaseInfo: string[];
  downloads: number;
  rating: { good: number; bad: number; total: number };
}

const TTL_OPTIONS: { label: string; seconds: number }[] = [
  { label: "Never expires", seconds: 0 },
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "7 days", seconds: 604800 },
];

// Full-page watch view (not a modal) so playing, downloading, and sharing a
// finished download is a real navigable page — link to it, bookmark it,
// come back to it, instead of losing state the moment a modal closes.
export function Watch() {
  const { id } = useParams<{ id: string }>();
  const { show } = useToast();
  const [job, setJob] = useState<Job | null | undefined>(undefined); // undefined = loading, null = not found
  const [subtitles, setSubtitles] = useState<{ name: string; label: string }[]>([]);

  const [shareOpen, setShareOpen] = useState(false);
  const [shareTtl, setShareTtl] = useState(0);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [creatingShare, setCreatingShare] = useState(false);

  const [subtitleOpen, setSubtitleOpen] = useState(false);
  const [subtitleLang, setSubtitleLang] = useState("english");
  const [subtitleResults, setSubtitleResults] = useState<SubtitleResult[] | null>(null);
  const [searchingSubs, setSearchingSubs] = useState(false);
  const [downloadingSubId, setDownloadingSubId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api<{ success: boolean; jobs: Job[] }>("/movies/downloads");
        const found = (data.jobs ?? []).find((j) => j.id === id && j.status === "done");
        setJob(found ?? null);
        if (found) {
          const info = await api<{ success: boolean; type: string; subtitles: { name: string; label: string }[] }>(
            "/files/media-info",
            { method: "POST", body: JSON.stringify({ path: found.dest }) }
          );
          setSubtitles(info.subtitles ?? []);
        }
      } catch {
        setJob(null);
      }
    })();
  }, [id]);

  async function createShare() {
    if (!job) return;
    setCreatingShare(true);
    try {
      const data = await api<{ success: boolean; share?: { token: string }; error?: string }>("/files/share", {
        method: "POST",
        body: JSON.stringify({ path: job.dest, ttlSeconds: shareTtl }),
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

  async function searchSubtitles() {
    if (!job) return;
    setSearchingSubs(true);
    try {
      const data = await api<{ success: boolean; results?: SubtitleResult[]; error?: string }>(
        "/movies/subtitles/search",
        { method: "POST", body: JSON.stringify({ title: job.title, lang: subtitleLang }) }
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
    if (!job || downloadingSubId) return;
    setDownloadingSubId(result.subtitleId);
    try {
      const data = await api<{ success: boolean; error?: string }>("/movies/subtitles/download", {
        method: "POST",
        body: JSON.stringify({ subtitleId: result.subtitleId, videoDest: job.dest, lang: result.language }),
      });
      show(data.success ? "Subtitle saved — reload the page to use it" : data.error ?? "Couldn't download subtitle", data.success ? "success" : "error");
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't download subtitle", "error");
    } finally {
      setDownloadingSubId(null);
    }
  }

  if (job === undefined) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }
  if (job === null) {
    return (
      <div>
        <Link to="/downloads" className="btn-secondary inline-flex items-center gap-1.5 mb-4">
          <ArrowLeftIcon className="w-4 h-4" /> Back to Downloads
        </Link>
        <p className="text-sm text-gray-500">This download isn't available (still in progress, or was removed).</p>
      </div>
    );
  }

  const rawUrl = `/api/files/download?path=${encodeURIComponent(job.dest)}`;
  const tracks = subtitles.map((s) => ({
    label: s.label,
    url: `/api/files/subtitle?path=${encodeURIComponent(job.dest)}&name=${encodeURIComponent(s.name)}`,
  }));

  return (
    <div className="max-w-4xl mx-auto">
      <Link to="/downloads" className="btn-secondary inline-flex items-center gap-1.5 mb-4">
        <ArrowLeftIcon className="w-4 h-4" /> Back to Downloads
      </Link>

      <h2 className="text-xl font-bold text-gray-100 mb-4">{job.title}</h2>

      <div className="bg-black rounded-lg overflow-hidden mb-4">
        <NestVideo src={rawUrl} tracks={tracks} />
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <a href={rawUrl} download className="btn-primary inline-flex items-center gap-1.5">
          <ArrowDownTrayIcon className="w-4 h-4" /> Download
        </a>
        <button className="btn-secondary inline-flex items-center gap-1.5" onClick={() => setShareOpen((o) => !o)}>
          <ShareIcon className="w-4 h-4" /> Share publicly
        </button>
        <button
          className="btn-secondary inline-flex items-center gap-1.5"
          onClick={() => {
            setSubtitleOpen((o) => !o);
            if (!subtitleResults) searchSubtitles();
          }}
        >
          <LanguageIcon className="w-4 h-4" /> Subtitles
        </button>
      </div>

      {shareOpen && (
        <Panel className="mb-4">
          <p className="text-xs text-gray-500 mb-3">
            Anyone with the link can stream this movie —<span className="text-yellow-400"> no panel login required.</span>
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
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
              <ShareQr url={shareUrl} />
            </div>
          )}
        </Panel>
      )}

      {subtitleOpen && (
        <Panel>
          <div className="flex gap-2 mb-3">
            <input
              value={subtitleLang}
              onChange={(e) => setSubtitleLang(e.target.value)}
              placeholder="Language (e.g. english, indonesian)"
              className="input-field flex-1 text-sm"
            />
            <button className="btn-primary disabled:opacity-60" onClick={searchSubtitles} disabled={searchingSubs}>
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
        </Panel>
      )}
    </div>
  );
}

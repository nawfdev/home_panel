import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { formatBytes, formatDuration } from "../lib/format";
import { ArrowPathIcon, XMarkIcon, PauseIcon, PlayIcon } from "@heroicons/react/24/outline";

interface Job {
  id: string;
  title: string;
  url: string;
  dest: string;
  poster?: string;
  status: "queued" | "downloading" | "paused" | "remuxing" | "done" | "error" | "canceled";
  downloaded: number;
  total: number;
  speedBps: number;
  error?: string;
  createdAt: string;
}

function eta(job: Job): string | null {
  if (job.status !== "downloading" || job.speedBps <= 0 || job.total <= job.downloaded) return null;
  return formatDuration((job.total - job.downloaded) / job.speedBps);
}

// The download manager: what's queued/in-flight right now. Finished
// downloads move over to the Stream page's library instead of piling up
// here, so this stays a clean, proper "downloads panel" — not a growing
// list mixed with a media library.
export function Downloads() {
  const { show } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const esRef = useRef<EventSource | null>(null);

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
  }, []);

  async function loadJobs() {
    try {
      const data = await api<{ success: boolean; jobs: Job[] }>("/movies/downloads");
      setJobs(data.jobs ?? []);
    } catch {
      /* non-fatal */
    }
  }

  async function cancelJob(id: string) {
    try {
      await api(`/movies/downloads/${id}`, { method: "DELETE" });
      loadJobs();
    } catch {
      /* non-fatal */
    }
  }

  async function pauseJob(id: string) {
    try {
      await api(`/movies/downloads/${id}/pause`, { method: "POST" });
      loadJobs();
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't pause", "error");
    }
  }

  async function resumeJob(id: string) {
    try {
      await api(`/movies/downloads/${id}/resume`, { method: "POST" });
      loadJobs();
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't resume", "error");
    }
  }

  // "done" jobs live in the Stream library, not here — this list is purely
  // the active queue plus recent failures/cancellations worth seeing once.
  const activeJobs = jobs.filter((j) => j.status !== "done");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Downloads</h2>
          <p className="text-gray-500 text-sm mt-1">Queued and in-progress downloads.</p>
        </div>
        <button className="btn-secondary" onClick={loadJobs}>
          <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
        </button>
      </div>

      <Panel>
        {activeJobs.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing downloading right now.</p>
        ) : (
          <div className="space-y-2">
            {activeJobs.map((job) => {
              const pct = job.total > 0 ? Math.round((job.downloaded / job.total) * 100) : 0;
              const remaining = eta(job);
              return (
                <div key={job.id} className="bg-white/5 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-100 truncate">{job.title}</p>
                      <p className="text-xs text-gray-500">
                        {job.status === "downloading" &&
                          `${formatBytes(job.downloaded)}${job.total > 0 ? " / " + formatBytes(job.total) : ""}` +
                            (job.speedBps > 0 ? ` · ${formatBytes(job.speedBps)}/s` : "") +
                            (remaining ? ` · ETA ${remaining}` : "") +
                            (job.total > 0 ? ` · ${pct}%` : "")}
                        {job.status === "queued" && "Queued…"}
                        {job.status === "paused" &&
                          `Paused · ${formatBytes(job.downloaded)}${job.total > 0 ? " / " + formatBytes(job.total) : ""}`}
                        {job.status === "remuxing" && "Optimizing for streaming…"}
                        {job.status === "canceled" && "Canceled"}
                        {job.status === "error" && <span className="text-red-400">{job.error}</span>}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {job.status === "downloading" && (
                        <button className="btn-secondary" title="Pause" onClick={() => pauseJob(job.id)}>
                          <PauseIcon className="w-4 h-4" />
                        </button>
                      )}
                      {job.status === "paused" && (
                        <button className="btn-secondary" title="Resume" onClick={() => resumeJob(job.id)}>
                          <PlayIcon className="w-4 h-4" />
                        </button>
                      )}
                      {(job.status === "downloading" || job.status === "queued" || job.status === "paused") && (
                        <button className="btn-danger" title="Cancel" onClick={() => cancelJob(job.id)}>
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  {(job.status === "downloading" || job.status === "remuxing" || job.status === "paused") && (
                    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden mt-2">
                      <div
                        className={`h-full transition-all duration-300 ${
                          job.status === "remuxing" ? "bg-purple-500 animate-pulse w-full" : job.status === "paused" ? "bg-gray-500" : "bg-blue-500"
                        }`}
                        style={job.status !== "remuxing" ? { width: `${pct}%` } : undefined}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

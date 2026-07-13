import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Panel } from "../components/ui/Panel";
import { formatBytes, formatDuration } from "../lib/format";
import { ArrowPathIcon, XMarkIcon } from "@heroicons/react/24/outline";

interface Job {
  id: string;
  title: string;
  url: string;
  dest: string;
  poster?: string;
  status: "queued" | "downloading" | "remuxing" | "done" | "error" | "canceled";
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
                        {job.status === "remuxing" && "Optimizing for streaming…"}
                        {job.status === "canceled" && "Canceled"}
                        {job.status === "error" && <span className="text-red-400">{job.error}</span>}
                      </p>
                    </div>
                    {(job.status === "downloading" || job.status === "queued") && (
                      <button className="btn-danger shrink-0" title="Cancel" onClick={() => cancelJob(job.id)}>
                        <XMarkIcon className="w-4 h-4" />
                      </button>
                    )}
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
    </div>
  );
}

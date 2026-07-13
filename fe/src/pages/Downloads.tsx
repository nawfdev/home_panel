import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Panel } from "../components/ui/Panel";
import { formatBytes, formatDuration } from "../lib/format";
import { ArrowPathIcon, XMarkIcon, FilmIcon, PlayIcon } from "@heroicons/react/24/outline";

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

  const activeJobs = jobs.filter((j) => j.status !== "done");
  const doneJobs = jobs.filter((j) => j.status === "done");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Downloads</h2>
          <p className="text-gray-500 text-sm mt-1">In-progress downloads, then your finished library below.</p>
        </div>
        <button className="btn-secondary" onClick={loadJobs}>
          <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
        </button>
      </div>

      <Panel title="Active" className="mb-6">
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

      <Panel title="Library">
        {doneJobs.length === 0 ? (
          <p className="text-sm text-gray-500">Finished downloads show up here, ready to stream.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {doneJobs.map((job) => (
              <Link
                key={job.id}
                to={`/movies/watch/${job.id}`}
                className="group text-left bg-white/5 rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500/60 transition"
              >
                <div className="aspect-[2/3] bg-white/5 flex items-center justify-center overflow-hidden relative">
                  {job.poster ? (
                    <img
                      src={job.poster}
                      alt={job.title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <FilmIcon className="w-10 h-10 text-gray-600" />
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
                    <PlayIcon className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition" />
                  </div>
                </div>
                <div className="p-2">
                  <p className="text-xs text-gray-200 line-clamp-2">{job.title}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{formatBytes(job.downloaded)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

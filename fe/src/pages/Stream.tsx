import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Panel } from "../components/ui/Panel";
import { formatBytes } from "../lib/format";
import { ArrowPathIcon, FilmIcon, PlayIcon } from "@heroicons/react/24/outline";

interface Job {
  id: string;
  title: string;
  dest: string;
  poster?: string;
  status: string;
  downloaded: number;
}

// The media library: every finished download, shown as a poster grid.
// Clicking one opens its own full Watch page (player + download + public
// share), not a modal — a proper "media library" page, separate from the
// Downloads queue.
export function Stream() {
  const [jobs, setJobs] = useState<Job[] | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const data = await api<{ success: boolean; jobs: Job[] }>("/movies/downloads");
      setJobs((data.jobs ?? []).filter((j) => j.status === "done"));
    } catch {
      setJobs([]);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Stream</h2>
          <p className="text-gray-500 text-sm mt-1">Your downloaded movies, ready to watch or share.</p>
        </div>
        <button className="btn-secondary" onClick={load}>
          <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
        </button>
      </div>

      <Panel>
        {jobs === null ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-gray-500">No finished downloads yet — start one from Movies.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {jobs.map((job) => (
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

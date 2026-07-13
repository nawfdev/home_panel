import { useEffect, useRef } from "react";
import { useToast } from "../../context/ToastContext";

interface Job {
  id: string;
  title: string;
  status: string;
}

// Mounted once at the app-shell level (not the Downloads page) so a "finished
// downloading" toast fires no matter which page the user is currently on —
// they shouldn't have to be sitting on /downloads to find out a job wrapped
// up. Purely a side effect; renders nothing.
export function DownloadNotifier() {
  const { show } = useToast();
  const prevStatus = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const es = new EventSource("/api/movies/downloads/stream", { withCredentials: true });
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { jobs: Job[] };
        for (const job of data.jobs ?? []) {
          const prev = prevStatus.current.get(job.id);
          if (prev && prev !== "done" && job.status === "done") {
            show(`"${job.title}" finished downloading`, "success", 8000);
          }
          if (prev && prev !== "error" && job.status === "error") {
            show(`"${job.title}" failed to download`, "error", 8000);
          }
          prevStatus.current.set(job.id, job.status);
        }
      } catch {
        /* ignore malformed frame */
      }
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

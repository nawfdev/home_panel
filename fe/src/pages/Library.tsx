import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import { formatBytes, formatDuration } from "../lib/format";
import {
  ArrowPathIcon,
  ArrowUpTrayIcon,
  XMarkIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  FilmIcon,
  PencilIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

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
  remuxPct?: number;
  error?: string;
  createdAt: string;
}

function eta(job: Job): string | null {
  if (job.status !== "downloading" || job.speedBps <= 0 || job.total <= job.downloaded) return null;
  return formatDuration((job.total - job.downloaded) / job.speedBps);
}

// The movie library: a Downloads tab (progress, pause/resume, dismiss
// failures) and a Movies tab (finished poster grid) — one page instead of
// three (the old Movies/Downloads/Stream split), organized as tabs instead
// of always-stacked sections so each is a focused view rather than a long
// scroll.
export function Library() {
  const { show } = useToast();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [tab, setTab] = useState<"downloads" | "movies">("movies");
  const esRef = useRef<EventSource | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addFile, setAddFile] = useState<File | null>(null);
  const [addPoster, setAddPoster] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);
  const [addPct, setAddPct] = useState(0);

  const [editTarget, setEditTarget] = useState<Job | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPoster, setEditPoster] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Job | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    load();
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

  async function load() {
    try {
      const data = await api<{ success: boolean; jobs: Job[] }>("/movies/downloads");
      setJobs(data.jobs ?? []);
    } catch {
      setJobs([]);
    }
  }

  // Stops an in-flight job (if any) and permanently removes it from the
  // list — the same "/movies/library/:id" delete the finished-grid trash
  // button uses. Deliberately NOT "/movies/downloads/:id" (Cancel): Cancel
  // only stops a job, it's a documented no-op once a job has already
  // finished/errored/been canceled, so a failed download could never
  // actually be dismissed from this list — it just sat here forever.
  async function removeJob(id: string) {
    try {
      await api(`/movies/library/${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't remove", "error");
    }
  }

  async function pauseJob(id: string) {
    try {
      await api(`/movies/downloads/${id}/pause`, { method: "POST" });
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't pause", "error");
    }
  }

  async function resumeJob(id: string) {
    try {
      await api(`/movies/downloads/${id}/resume`, { method: "POST" });
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't resume", "error");
    }
  }
  async function retryJob(id: string) {
    try {
      await api(`/movies/downloads/${id}/retry`, { method: "POST" });
      show("Retrying download…", "success", 1500);
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't retry download", "error");
    }
  }

  function resetAdd() {
    setAddOpen(false);
    setAddTitle("");
    setAddFile(null);
    setAddPoster(null);
    setAddPct(0);
  }

  function submitAdd() {
    if (!addTitle.trim()) {
      show("Please enter a title", "warning");
      return;
    }
    if (!addFile) {
      show("Please select a video file", "warning");
      return;
    }
    setAdding(true);
    setAddPct(0);

    const formData = new FormData();
    formData.append("title", addTitle.trim());
    formData.append("file", addFile);
    if (addPoster) formData.append("poster", addPoster);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/movies/manual");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setAddPct(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setAdding(false);
      let data: { success?: boolean; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.success) {
        show("Movie added", "success");
        resetAdd();
        load();
      } else {
        show(data.error ?? `Upload failed (HTTP ${xhr.status})`, "error");
      }
    };
    xhr.onerror = () => {
      setAdding(false);
      show("Upload error — connection lost", "error");
    };
    xhr.send(formData);
  }

  function openEdit(job: Job, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setEditTarget(job);
    setEditTitle(job.title);
    setEditPoster(null);
  }

  async function submitEdit() {
    if (!editTarget) return;
    if (!editTitle.trim()) {
      show("Please enter a title", "warning");
      return;
    }
    setSaving(true);
    try {
      if (editTitle.trim() !== editTarget.title) {
        await api(`/movies/library/${editTarget.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: editTitle.trim() }),
        });
      }
      if (editPoster) {
        const formData = new FormData();
        formData.append("file", editPoster);
        const res = await fetch(`/api/movies/library/${editTarget.id}/thumbnail`, {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.error ?? "Couldn't update thumbnail");
        }
      }
      show("Saved", "success");
      setEditTarget(null);
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't save changes", "error");
    } finally {
      setSaving(false);
    }
  }

  function openDelete(job: Job, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDeleteTarget(job);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/movies/library/${deleteTarget.id}`, { method: "DELETE" });
      show("Deleted", "success");
      setDeleteTarget(null);
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't delete", "error");
    } finally {
      setDeleting(false);
    }
  }

  const activeJobs = (jobs ?? []).filter((j) => j.status !== "done");
  const finishedJobs = (jobs ?? []).filter((j) => j.status === "done");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Library</h2>
          <p className="text-gray-500 text-sm mt-1">Movies downloading now, and everything ready to watch.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/movies/add" className="btn-primary inline-flex items-center gap-1.5">
            <PlusIcon className="w-4 h-4" />Add movie
          </Link>
          <button className="btn-secondary" onClick={() => setAddOpen(true)}>
            <ArrowUpTrayIcon className="w-4 h-4 inline mr-1.5" />Upload file
          </button>
          <button className="btn-secondary" onClick={load}>
            <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
          </button>
        </div>
      </div>

      <div className="tab-bar mb-4">
        <button className={`tab-btn ${tab === "movies" ? "active" : ""}`} onClick={() => setTab("movies")}>
          Movies
          {finishedJobs.length > 0 && <span className="tab-count">{finishedJobs.length}</span>}
        </button>
        <button className={`tab-btn ${tab === "downloads" ? "active" : ""}`} onClick={() => setTab("downloads")}>
          Downloads
          {activeJobs.length > 0 && <span className="tab-count tab-count-attention">{activeJobs.length}</span>}
        </button>
      </div>

      {tab === "downloads" && (
        <Panel>
          {jobs === null ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : activeJobs.length === 0 ? (
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
                          {job.status === "remuxing" && (
                            <span className="text-purple-300 font-medium">
                              Preparing for streaming… {job.remuxPct ? `${job.remuxPct}%` : ""}
                            </span>
                          )}
                          {job.status === "error" && <span className="text-red-400">{job.error || "Failed"}</span>}
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
                        {(job.status === "error" || job.status === "canceled") && (
                          <button
                            className="btn-secondary text-amber-400 hover:text-amber-300"
                            title="Retry download"
                            onClick={() => retryJob(job.id)}
                          >
                            <ArrowPathIcon className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          className="btn-danger"
                          title={job.status === "error" || job.status === "canceled" ? "Remove from history" : "Cancel"}
                          onClick={() => removeJob(job.id)}
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {(job.status === "downloading" || job.status === "remuxing" || job.status === "paused") && (
                        <div
                          className={`h-full transition-all duration-300 ${
                            job.status === "remuxing" ? "bg-purple-500" : job.status === "paused" ? "bg-gray-500" : "bg-blue-500"
                          }`}
                          style={{
                            width: `${job.status === "remuxing" ? (job.remuxPct || 10) : pct}%`,
                          }}
                        />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      )}

      {tab === "movies" && (
        <Panel>
          {jobs === null ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : finishedJobs.length === 0 ? (
            <p className="text-sm text-gray-500">
              No movies yet — <Link to="/movies/add" className="text-gray-300 underline">add one</Link> or upload a file to get started.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {finishedJobs.map((job) => (
                <Link
                  key={job.id}
                  to={`/movies/watch/${job.id}`}
                  className="group relative text-left bg-white/5 rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500/60 transition"
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
                    <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button
                        title="Edit"
                        onClick={(e) => openEdit(job, e)}
                        className="w-7 h-7 flex items-center justify-center bg-black/70 hover:bg-black/90 rounded-md text-gray-200"
                      >
                        <PencilIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        title="Delete"
                        onClick={(e) => openDelete(job, e)}
                        className="w-7 h-7 flex items-center justify-center bg-black/70 hover:bg-red-600 rounded-md text-gray-200"
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
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
      )}

      {addOpen && (
        <Modal title="Upload a movie file" onClose={() => (adding ? null : resetAdd())}>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Title</label>
              <input
                value={addTitle}
                onChange={(e) => setAddTitle(e.target.value)}
                placeholder="Movie title"
                disabled={adding}
                className="input-field w-full text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Video file</label>
              <input
                type="file"
                accept="video/*,.mp4,.mkv,.webm,.mov,.avi"
                onChange={(e) => setAddFile(e.target.files?.[0] ?? null)}
                disabled={adding}
                className="input-field w-full text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Thumbnail (optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setAddPoster(e.target.files?.[0] ?? null)}
                disabled={adding}
                className="input-field w-full text-sm"
              />
            </div>
          </div>
          {adding && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Uploading…</span>
                <span>{addPct}%</span>
              </div>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all duration-150" style={{ width: `${addPct}%` }} />
              </div>
            </div>
          )}
          <div className="flex gap-2 mt-5">
            <button className="btn-primary flex-1 disabled:opacity-60" onClick={submitAdd} disabled={adding}>
              {adding ? `Uploading ${addPct}%` : "Add"}
            </button>
            <button className="btn-secondary flex-1 disabled:opacity-60" disabled={adding} onClick={resetAdd}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {editTarget && (
        <Modal title="Edit movie" onClose={() => (saving ? null : setEditTarget(null))}>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Title</label>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                disabled={saving}
                className="input-field w-full text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Replace thumbnail (optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setEditPoster(e.target.files?.[0] ?? null)}
                disabled={saving}
                className="input-field w-full text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button className="btn-primary flex-1 disabled:opacity-60" onClick={submitEdit} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn-secondary flex-1 disabled:opacity-60" disabled={saving} onClick={() => setEditTarget(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Delete movie" onClose={() => (deleting ? null : setDeleteTarget(null))}>
          <p className="text-sm text-gray-300">
            Delete <span className="text-gray-100">{deleteTarget.title}</span>? This removes the file from disk and can't be undone.
          </p>
          <div className="flex gap-2 mt-5">
            <button className="btn-danger flex-1 disabled:opacity-60" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button className="btn-secondary flex-1 disabled:opacity-60" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

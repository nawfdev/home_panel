import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import { formatBytes } from "../lib/format";
import { ArrowPathIcon, FilmIcon, PlayIcon, PlusIcon, PencilIcon, TrashIcon } from "@heroicons/react/24/outline";

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
// Downloads queue. Admins can also add a file manually (outside the download
// queue) and rename/re-thumbnail/delete any entry from here.
export function Stream() {
  const { show } = useToast();
  const [jobs, setJobs] = useState<Job[] | null>(null);

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
  }, []);

  async function load() {
    try {
      const data = await api<{ success: boolean; jobs: Job[] }>("/movies/downloads");
      setJobs((data.jobs ?? []).filter((j) => j.status === "done"));
    } catch {
      setJobs([]);
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Stream</h2>
          <p className="text-gray-500 text-sm mt-1">Your downloaded movies, ready to watch or share.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setAddOpen(true)}>
            <PlusIcon className="w-4 h-4 inline mr-1.5" />Add movie
          </button>
          <button className="btn-secondary" onClick={load}>
            <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
          </button>
        </div>
      </div>

      <Panel>
        {jobs === null ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-gray-500">No finished downloads yet — start one from Movies, or add a file manually.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {jobs.map((job) => (
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

      {addOpen && (
        <Modal title="Add movie manually" onClose={() => (adding ? null : resetAdd())}>
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

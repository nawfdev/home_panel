import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import { MediaPlayer } from "./MediaPlayer";
import { formatBytes } from "../lib/format";
import { copyText } from "../lib/clipboard";
import {
  ArrowPathIcon,
  ArrowUpIcon,
  ArrowUpTrayIcon,
  FolderIcon,
  DocumentIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  ShareIcon,
  ClipboardIcon,
} from "@heroicons/react/24/outline";

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

interface ShareRecord {
  token: string;
  path: string;
  name: string;
  isDir: boolean;
  createdAt: number;
  expiresAt: number;
}

const TTL_OPTIONS: { label: string; seconds: number }[] = [
  { label: "Never expires", seconds: 0 },
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "7 days", seconds: 604800 },
];

export function Files() {
  const { show } = useToast();
  const [path, setPath] = useState("/");
  const [items, setItems] = useState<FileItem[] | null>(null);
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [maxUploadMb, setMaxUploadMb] = useState(500);

  const [shareTarget, setShareTarget] = useState<FileItem | null>(null);
  const [shareTtl, setShareTtl] = useState(0);
  const [creatingShare, setCreatingShare] = useState(false);
  const [shares, setShares] = useState<ShareRecord[]>([]);

  const [player, setPlayer] = useState<{
    path: string;
    name: string;
    type: "video" | "image" | "audio";
    subtitles: { name: string; label: string }[];
  } | null>(null);

  async function loadDirectory(p: string) {
    try {
      const data = await api<{ success: boolean; path: string; items: FileItem[] }>("/files/list", {
        method: "POST",
        body: JSON.stringify({ path: p }),
      });
      setPath(data.path || "/");
      setItems(data.items ?? []);
    } catch (err) {
      show(err instanceof Error ? err.message : "Error loading directory", "error");
    }
  }

  useEffect(() => {
    loadDirectory("/");
    api<{ success: boolean; maxUploadMb?: number }>("/settings/file-manager")
      .then((res) => {
        if (res.success && res.maxUploadMb) setMaxUploadMb(res.maxUploadMb);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadShares() {
    try {
      const data = await api<{ success: boolean; shares: ShareRecord[] }>("/files/shares");
      setShares(data.shares ?? []);
    } catch {
      /* non-fatal */
    }
  }

  // Refetch the limit each time the modal opens so a change made in Settings
  // is reflected without a full page reload.
  async function openUploadModal() {
    try {
      const res = await api<{ success: boolean; maxUploadMb?: number }>("/settings/file-manager");
      if (res.success && res.maxUploadMb) setMaxUploadMb(res.maxUploadMb);
    } catch {
      /* keep the last known limit */
    }
    setUploadOpen(true);
  }

  async function handleClick(item: FileItem) {
    if (item.isDirectory) {
      loadDirectory(item.path);
      return;
    }
    // Media files open in the player; everything else in the text viewer.
    try {
      const info = await api<{ success: boolean; type: string; subtitles: { name: string; label: string }[]; path?: string }>(
        "/files/media-info",
        { method: "POST", body: JSON.stringify({ path: item.path }) }
      );
      if (info.type === "video" || info.type === "image" || info.type === "audio") {
        // path may differ from item.path: a .mkv gets rewrapped to .mp4 (for
        // iOS Safari, which can't play Matroska) the first time it's opened.
        setPlayer({ path: info.path ?? item.path, name: item.name, type: info.type, subtitles: info.subtitles ?? [] });
        if (info.path && info.path !== item.path) loadDirectory(path);
        return;
      }
    } catch {
      /* fall through to text view */
    }
    viewFile(item.path);
  }

  async function viewFile(p: string) {
    try {
      const data = await api<{ success: boolean; content: string }>("/files/read", {
        method: "POST",
        body: JSON.stringify({ path: p }),
      });
      setEditing({ path: p, content: data.content });
    } catch (err) {
      show(err instanceof Error ? err.message : "Error opening file", "error");
    }
  }

  async function saveFile() {
    if (!editing) return;
    setSaving(true);
    try {
      await api("/files/write", {
        method: "POST",
        body: JSON.stringify({ path: editing.path, content: editing.content }),
      });
      show("File saved", "success");
      setEditing(null);
      loadDirectory(path);
    } catch (err) {
      show(err instanceof Error ? err.message : "Error saving file", "error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem() {
    if (!deleteTarget) return;
    try {
      await api("/files/delete", { method: "POST", body: JSON.stringify({ path: deleteTarget }) });
      loadDirectory(path);
    } catch (err) {
      show(err instanceof Error ? err.message : "Error deleting", "error");
    } finally {
      setDeleteTarget(null);
    }
  }

  function downloadFile(p: string) {
    window.location.href = `/api/files/download?path=${encodeURIComponent(p)}`;
  }

  function goUp() {
    const parts = path.split("/").filter(Boolean);
    parts.pop();
    loadDirectory("/" + parts.join("/"));
  }

  function handleUpload() {
    if (!uploadFile) {
      show("Please select a file", "warning");
      return;
    }
    if (uploadFile.size > maxUploadMb * 1024 * 1024) {
      show(`File is larger than the ${maxUploadMb} MB limit (change it in Settings)`, "error");
      return;
    }
    setUploading(true);
    setUploadPct(0);

    // fetch() can't report upload progress, so use XHR for the progress bar.
    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("path", path);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files/upload");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setUploading(false);
      let data: { success?: boolean; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.success) {
        show("File uploaded", "success");
        setUploadOpen(false);
        setUploadFile(null);
        setUploadPct(0);
        loadDirectory(path);
      } else {
        show(data.error ?? `Upload failed (HTTP ${xhr.status})`, "error");
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      show("Upload error — connection lost", "error");
    };
    xhr.send(formData);
  }

  async function createShare() {
    if (!shareTarget) return;
    setCreatingShare(true);
    try {
      const data = await api<{ success: boolean; share?: ShareRecord; error?: string }>("/files/share", {
        method: "POST",
        body: JSON.stringify({ path: shareTarget.path, ttlSeconds: shareTtl }),
      });
      if (data.success && data.share) {
        show("Share link created", "success");
        loadShares();
      } else {
        show(data.error ?? "Failed to create share", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to create share", "error");
    } finally {
      setCreatingShare(false);
    }
  }

  async function revokeShare(token: string) {
    try {
      await api(`/files/shares/${token}`, { method: "DELETE" });
      loadShares();
      show("Share revoked", "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to revoke", "error");
    }
  }

  function shareUrl(token: string) {
    return `${window.location.origin}/share/${token}`;
  }

  function openShare(item: FileItem) {
    setShareTarget(item);
    setShareTtl(0);
    loadShares();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Files</h2>
          <p className="text-gray-500 text-sm mt-1 font-mono truncate">{path}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={goUp}>
            <ArrowUpIcon className="w-4 h-4 inline mr-1.5" />Up
          </button>
          <button className="btn-secondary" onClick={openUploadModal}>
            <ArrowUpTrayIcon className="w-4 h-4 inline mr-1.5" />Upload
          </button>
          <button className="btn-secondary" onClick={() => loadDirectory(path)}>
            <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
          </button>
        </div>
      </div>

      <Panel>
        {items === null ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-500">Empty directory</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.path} className="bg-white/5 rounded-lg p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer" onClick={() => handleClick(item)}>
                  {item.isDirectory ? (
                    <FolderIcon className="w-5 h-5 text-yellow-500 shrink-0" />
                  ) : (
                    <DocumentIcon className="w-5 h-5 text-gray-500 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-gray-100 truncate">{item.name}</p>
                    {!item.isDirectory && <p className="text-xs text-gray-500">{formatBytes(item.size)}</p>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button className="btn-secondary" title="Share" onClick={() => openShare(item)}>
                    <ShareIcon className="w-4 h-4" />
                  </button>
                  {!item.isDirectory && (
                    <button className="btn-secondary" title="Download" onClick={() => downloadFile(item.path)}>
                      <ArrowDownTrayIcon className="w-4 h-4" />
                    </button>
                  )}
                  <button className="btn-danger" title="Delete" onClick={() => setDeleteTarget(item.path)}>
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {editing && (
        <Modal title={editing.path} onClose={() => setEditing(null)} wide>
          <textarea
            value={editing.content}
            onChange={(e) => setEditing({ ...editing, content: e.target.value })}
            className="input-field w-full h-96 font-mono text-xs resize-none"
          />
          <div className="flex gap-2 mt-4">
            <button className="btn-primary flex-1 disabled:opacity-60" onClick={saveFile} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button className="btn-secondary flex-1" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Delete" onClose={() => setDeleteTarget(null)}>
          <p className="text-sm text-gray-300">
            Delete <span className="font-mono text-gray-100">{deleteTarget}</span>?
          </p>
          <div className="flex gap-2 mt-5">
            <button className="btn-danger flex-1" onClick={deleteItem}>
              Delete
            </button>
            <button className="btn-secondary flex-1" onClick={() => setDeleteTarget(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {uploadOpen && (
        <Modal
          title="Upload file"
          onClose={() => {
            setUploadOpen(false);
            setUploadFile(null);
          }}
        >
          <p className="text-xs text-gray-500 mb-3">
            Uploading to <span className="font-mono text-gray-300">{path}</span> · max {maxUploadMb} MB
          </p>
          <input
            type="file"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            disabled={uploading}
            className="input-field w-full text-sm"
          />
          {uploading && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Uploading…</span>
                <span>{uploadPct}%</span>
              </div>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all duration-150" style={{ width: `${uploadPct}%` }} />
              </div>
            </div>
          )}
          <div className="flex gap-2 mt-5">
            <button className="btn-primary flex-1 disabled:opacity-60" onClick={handleUpload} disabled={uploading}>
              {uploading ? `Uploading ${uploadPct}%` : "Upload"}
            </button>
            <button
              className="btn-secondary flex-1 disabled:opacity-60"
              disabled={uploading}
              onClick={() => {
                setUploadOpen(false);
                setUploadFile(null);
              }}
            >
              Cancel
            </button>
          </div>
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
        <Modal
          title={`Share "${shareTarget.name}"`}
          onClose={() => setShareTarget(null)}
          wide
        >
          <p className="text-xs text-gray-500 mb-3">
            Anyone with the link can access this {shareTarget.isDirectory ? "folder and its contents" : "file"} —
            <span className="text-yellow-400"> no panel login required.</span>
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

          {(() => {
            const active = shares.filter((s) => s.path === shareTarget.path);
            if (active.length === 0) {
              return <p className="text-xs text-gray-500 mt-3">No active links for this item yet.</p>;
            }
            return (
              <div className="space-y-2 mt-4">
                {active.map((s) => (
                  <div key={s.token} className="bg-white/5 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <input readOnly value={shareUrl(s.token)} className="input-field flex-1 font-mono text-xs" />
                      <button
                        className="btn-secondary shrink-0"
                        title="Copy"
                        onClick={async () => {
                          const ok = await copyText(shareUrl(s.token));
                          show(ok ? "Link copied" : "Couldn't copy — select the link and copy manually", ok ? "success" : "warning");
                        }}
                      >
                        <ClipboardIcon className="w-4 h-4" />
                      </button>
                      <button className="btn-danger shrink-0" title="Revoke" onClick={() => revokeShare(s.token)}>
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {s.expiresAt === 0
                        ? "Never expires"
                        : `Expires ${new Date(s.expiresAt).toLocaleString()}`}
                    </p>
                  </div>
                ))}
              </div>
            );
          })()}
        </Modal>
      )}
    </div>
  );
}

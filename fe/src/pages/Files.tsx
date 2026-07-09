import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import { formatBytes } from "../lib/format";
import {
  ArrowPathIcon,
  ArrowUpIcon,
  ArrowUpTrayIcon,
  FolderIcon,
  DocumentIcon,
  ArrowDownTrayIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleClick(item: FileItem) {
    if (item.isDirectory) {
      loadDirectory(item.path);
    } else {
      viewFile(item.path);
    }
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

  async function handleUpload() {
    if (!uploadFile) {
      show("Please select a file", "warning");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("path", path);
      const res = await fetch("/api/files/upload", { method: "POST", body: formData, credentials: "include" });
      const data = await res.json();
      if (data.success) {
        show("File uploaded", "success");
        setUploadOpen(false);
        setUploadFile(null);
        loadDirectory(path);
      } else {
        show(data.error ?? "Upload failed", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Upload error", "error");
    } finally {
      setUploading(false);
    }
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
          <button className="btn-secondary" onClick={() => setUploadOpen(true)}>
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
                  {!item.isDirectory && (
                    <button className="btn-secondary" onClick={() => downloadFile(item.path)}>
                      <ArrowDownTrayIcon className="w-4 h-4" />
                    </button>
                  )}
                  <button className="btn-danger" onClick={() => setDeleteTarget(item.path)}>
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
            Uploading to <span className="font-mono text-gray-300">{path}</span>
          </p>
          <input
            type="file"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            className="input-field w-full text-sm"
          />
          <div className="flex gap-2 mt-5">
            <button className="btn-primary flex-1 disabled:opacity-60" onClick={handleUpload} disabled={uploading}>
              {uploading ? "Uploading..." : "Upload"}
            </button>
            <button
              className="btn-secondary flex-1"
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
    </div>
  );
}

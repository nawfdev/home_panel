import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import { ArrowPathIcon, PlayIcon, StopIcon, TrashIcon, PlusIcon } from "@heroicons/react/24/outline";

interface Project {
  id: number;
  name: string;
  path: string;
  port: number;
  domain: string;
  status: string;
}

interface ActionResult {
  success?: boolean;
  message?: string;
}

export function Projects() {
  const { show } = useToast();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [port, setPort] = useState("");
  const [domain, setDomain] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const data = await api<Project[]>("/projects");
      setProjects(data);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load projects", "error");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function action(id: number, act: "start" | "stop" | "restart") {
    try {
      const data = await api<ActionResult>(`/projects/${id}/${act}`, { method: "POST" });
      show(data.message ?? "Done", data.success === false ? "error" : "success");
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : `Failed to ${act} project`, "error");
    }
  }

  async function deleteProject() {
    if (!deleteTarget) return;
    try {
      await api(`/projects/${deleteTarget.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to delete project", "error");
    } finally {
      setDeleteTarget(null);
    }
  }

  async function createProject() {
    if (!name || !path || !port) {
      show("Name, path, and port are required", "warning");
      return;
    }
    setCreating(true);
    try {
      await api("/projects", {
        method: "POST",
        body: JSON.stringify({ name, path, port: parseInt(port, 10), domain: domain || null }),
      });
      setAddOpen(false);
      setName("");
      setPath("");
      setPort("");
      setDomain("");
      show("Project created", "success");
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to create project", "error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Projects</h2>
          <p className="text-gray-500 text-sm mt-1">Node/script projects managed on this host</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={load}>
            <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
          </button>
          <button className="btn-primary" onClick={() => setAddOpen(true)}>
            <PlusIcon className="w-4 h-4 inline mr-1.5" />Add project
          </button>
        </div>
      </div>

      <Panel title={`Projects${projects ? ` (${projects.length})` : ""}`}>
        {projects === null ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-gray-500">No projects yet. Click Add project to create one.</p>
        ) : (
          <div className="space-y-3">
            {projects.map((p) => {
              const isRunning = p.status === "running";
              return (
                <div key={p.id} className="bg-white/5 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2 gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-gray-100 truncate">{p.name}</p>
                      <p className="text-xs text-gray-500 truncate">{p.path}</p>
                    </div>
                    <span
                      className={`status-badge shrink-0 ${isRunning ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}
                    >
                      {p.status}
                    </span>
                  </div>
                  <div className="flex gap-3 text-xs text-gray-500 mb-3">
                    <span>Port: {p.port}</span>
                    {p.domain && <span className="font-mono">{p.domain}</span>}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {isRunning ? (
                      <>
                        <button className="btn-danger" onClick={() => action(p.id, "stop")}>
                          <StopIcon className="w-4 h-4 inline mr-1.5" />Stop
                        </button>
                        <button className="btn-secondary" onClick={() => action(p.id, "restart")}>
                          <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Restart
                        </button>
                      </>
                    ) : (
                      <button className="btn-secondary" onClick={() => action(p.id, "start")}>
                        <PlayIcon className="w-4 h-4 inline mr-1.5" />Start
                      </button>
                    )}
                    <button className="btn-danger" onClick={() => setDeleteTarget(p)}>
                      <TrashIcon className="w-4 h-4 inline mr-1.5" />Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {addOpen && (
        <Modal title="Add project" onClose={() => setAddOpen(false)}>
          <div className="space-y-3">
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="input-field w-full" placeholder="my-app" />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Path</label>
              <input value={path} onChange={(e) => setPath(e.target.value)} className="input-field w-full" placeholder="/home/user/apps/my-app" />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="input-field w-full"
                placeholder="3000"
              />
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Domain (optional)</label>
              <input value={domain} onChange={(e) => setDomain(e.target.value)} className="input-field w-full" placeholder="app.example.com" />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button className="btn-primary flex-1 disabled:opacity-60" onClick={createProject} disabled={creating}>
              {creating ? "Creating..." : "Create"}
            </button>
            <button className="btn-secondary flex-1" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Delete project" onClose={() => setDeleteTarget(null)}>
          <p className="text-sm text-gray-300">
            Delete project <span className="font-semibold text-gray-100">{deleteTarget.name}</span>?
          </p>
          <div className="flex gap-2 mt-5">
            <button className="btn-danger flex-1" onClick={deleteProject}>
              Delete
            </button>
            <button className="btn-secondary flex-1" onClick={() => setDeleteTarget(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

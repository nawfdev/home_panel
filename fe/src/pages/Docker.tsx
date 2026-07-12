import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { copyText } from "../lib/clipboard";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import {
  ArrowPathIcon,
  PlayIcon,
  StopIcon,
  DocumentTextIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  ClipboardIcon,
} from "@heroicons/react/24/outline";

interface Install {
  command: string;
  note?: string;
}

interface DockerStatus {
  available: boolean;
  version?: string;
  reason?: string;
  install?: Install;
}

interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  uptime: string;
  ports: string;
}

export function Docker() {
  const { show } = useToast();
  const [status, setStatus] = useState<DockerStatus | null>(null);
  const [containers, setContainers] = useState<Container[] | null>(null);
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [ports, setPorts] = useState("");
  const [running, setRunning] = useState(false);
  const [logsFor, setLogsFor] = useState<{ id: string; name: string } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);

  async function load() {
    try {
      const statusData = await api<DockerStatus>("/docker/status");
      setStatus(statusData);
      if (!statusData.available) {
        setContainers([]);
        return;
      }
      const data = await api<{ success: boolean; containers: Container[] }>("/docker/containers");
      setContainers(data.containers ?? []);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load Docker", "error");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function action(id: string, act: "start" | "stop" | "restart") {
    try {
      const data = await api<{ success: boolean; error?: string }>(`/docker/containers/${id}/${act}`, {
        method: "POST",
      });
      if (data.success) {
        load();
      } else {
        show(data.error ?? `Failed to ${act} container`, "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : `Failed to ${act} container`, "error");
    }
  }

  async function removeContainer() {
    if (!removeTarget) return;
    try {
      const data = await api<{ success: boolean; error?: string }>(`/docker/containers/${removeTarget.id}`, {
        method: "DELETE",
      });
      if (data.success) {
        show("Container removed", "success");
        load();
      } else {
        show(data.error ?? "Failed to remove container", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to remove container", "error");
    } finally {
      setRemoveTarget(null);
    }
  }

  function exportContainer(id: string, containerName: string) {
    const a = document.createElement("a");
    a.href = `/api/export/docker/${encodeURIComponent(id)}`;
    a.download = `docker-${containerName || id.substring(0, 12)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function runContainer() {
    if (!image.trim()) {
      show("Please enter an image name (e.g., nginx:latest)", "warning");
      return;
    }
    setRunning(true);
    try {
      const data = await api<{ success: boolean; error?: string }>("/docker/run", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), image: image.trim(), ports: ports.trim() }),
      });
      if (data.success) {
        setName("");
        setImage("");
        setPorts("");
        show("Container started", "success");
        load();
      } else {
        show(data.error ?? "Failed to run container", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to run container", "error");
    } finally {
      setRunning(false);
    }
  }

  async function copyInstallCommand(command: string) {
    const ok = await copyText(command);
    show(ok ? "Copied to clipboard" : "Couldn't copy — select the text and copy manually", ok ? "success" : "warning");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Docker</h2>
          <p className="text-gray-500 text-sm mt-1">Manage containers running on this host</p>
        </div>
        <button className="btn-secondary" onClick={load}>
          <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
        </button>
      </div>

      <div className="space-y-4">
        <Panel title="Status">
          {status === null ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : status.available ? (
            <div className="info-row">
              <span className="info-row-label">Docker</span>
              <span className="info-row-value text-green-400">
                Running{status.version ? ` · ${status.version}` : ""}
              </span>
            </div>
          ) : (
            <div>
              <p className="text-sm text-yellow-400 mb-3">
                {status.reason ?? "Docker is not installed or not running on this system."}
              </p>
              {status.install && (
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">Install command</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-sm text-gray-200 font-mono truncate">{status.install.command}</code>
                    <button
                      className="btn-secondary shrink-0"
                      onClick={() => copyInstallCommand(status.install!.command)}
                    >
                      <ClipboardIcon className="w-4 h-4" />
                    </button>
                  </div>
                  {status.install.note && <p className="text-xs text-gray-500 mt-2">{status.install.note}</p>}
                </div>
              )}
            </div>
          )}
        </Panel>

        {status?.available && (
          <>
            <Panel title={`Containers${containers ? ` (${containers.length})` : ""}`}>
              {containers === null ? (
                <p className="text-sm text-gray-500">Loading...</p>
              ) : containers.length === 0 ? (
                <p className="text-sm text-gray-500">No containers found</p>
              ) : (
                <div className="space-y-3">
                  {containers.map((c) => {
                    const isRunning = c.state === "running";
                    return (
                      <div key={c.id} className="bg-white/5 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3 gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="metric-dot" style={{ color: isRunning ? "#4ade80" : "#f87171" }} />
                              <span className="font-semibold text-sm text-gray-100 truncate">{c.name}</span>
                            </div>
                            <p className="text-xs text-gray-500 truncate mt-0.5">{c.image}</p>
                          </div>
                          <span
                            className={`status-badge shrink-0 ${isRunning ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}
                          >
                            {c.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-xs">
                          <div>
                            <p className="text-gray-500">ID</p>
                            <p className="font-mono text-gray-300">{c.id.substring(0, 12)}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Ports</p>
                            <p className="text-gray-300">{c.ports || "N/A"}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Uptime</p>
                            <p className="text-gray-300">{c.uptime || "N/A"}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">State</p>
                            <p className="text-gray-300 capitalize">{c.state}</p>
                          </div>
                        </div>

                        <div className="flex gap-2 flex-wrap">
                          {isRunning ? (
                            <>
                              <button className="btn-danger" onClick={() => action(c.id, "stop")}>
                                <StopIcon className="w-4 h-4 inline mr-1.5" />Stop
                              </button>
                              <button className="btn-secondary" onClick={() => action(c.id, "restart")}>
                                <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Restart
                              </button>
                            </>
                          ) : (
                            <button className="btn-secondary" onClick={() => action(c.id, "start")}>
                              <PlayIcon className="w-4 h-4 inline mr-1.5" />Start
                            </button>
                          )}
                          <button className="btn-secondary" onClick={() => setLogsFor({ id: c.id, name: c.name })}>
                            <DocumentTextIcon className="w-4 h-4 inline mr-1.5" />Logs
                          </button>
                          <button className="btn-danger" onClick={() => setRemoveTarget({ id: c.id, name: c.name })}>
                            <TrashIcon className="w-4 h-4 inline mr-1.5" />Remove
                          </button>
                          <button className="btn-secondary" onClick={() => exportContainer(c.id, c.name)}>
                            <ArrowDownTrayIcon className="w-4 h-4 inline mr-1.5" />Export
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            <Panel title="Run new container">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-gray-500 text-xs mb-1.5">Name (optional)</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} className="input-field w-full" placeholder="my-container" />
                </div>
                <div>
                  <label className="block text-gray-500 text-xs mb-1.5">Image</label>
                  <input
                    value={image}
                    onChange={(e) => setImage(e.target.value)}
                    className="input-field w-full"
                    placeholder="nginx:latest"
                  />
                </div>
                <div>
                  <label className="block text-gray-500 text-xs mb-1.5">Ports (optional)</label>
                  <input
                    value={ports}
                    onChange={(e) => setPorts(e.target.value)}
                    className="input-field w-full"
                    placeholder="8080:80"
                  />
                </div>
              </div>
              <button className="btn-primary disabled:opacity-60" onClick={runContainer} disabled={running}>
                {running ? "Starting..." : "Run container"}
              </button>
            </Panel>
          </>
        )}
      </div>

      {logsFor && <LogsModal containerId={logsFor.id} containerName={logsFor.name} onClose={() => setLogsFor(null)} />}

      {removeTarget && (
        <Modal title="Remove container" onClose={() => setRemoveTarget(null)}>
          <p className="text-sm text-gray-300">
            Remove container <span className="font-semibold text-gray-100">{removeTarget.name}</span>?
          </p>
          <div className="flex gap-2 mt-5">
            <button className="btn-danger flex-1" onClick={removeContainer}>
              Remove
            </button>
            <button className="btn-secondary flex-1" onClick={() => setRemoveTarget(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function LogsModal({
  containerId,
  containerName,
  onClose,
}: {
  containerId: string;
  containerName: string;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<string | null>(null);

  useEffect(() => {
    api<{ success: boolean; logs?: string; error?: string }>(`/docker/containers/${containerId}/logs?lines=100`)
      .then((data) => setLogs(data.success ? data.logs || "No logs available" : `Error: ${data.error}`))
      .catch((err) => setLogs(`Error loading logs: ${err instanceof Error ? err.message : "Unknown error"}`));
  }, [containerId]);

  return (
    <Modal title={`${containerName} - Logs`} onClose={onClose} wide>
      <pre className="bg-black/30 rounded-lg p-4 max-h-[500px] overflow-y-auto font-mono text-xs whitespace-pre-wrap text-gray-300">
        {logs ?? "Loading logs..."}
      </pre>
    </Modal>
  );
}

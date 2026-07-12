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

interface Pm2Status {
  available: boolean;
  version?: string;
  install?: Install;
}

interface Pm2Process {
  name: string;
  pid: number;
  status: string;
  cpu: string | number;
  memory: number;
  uptime: string;
  restarts: number;
  mode: string;
  port?: string | number | null;
}

export function PM2() {
  const { show } = useToast();
  const [status, setStatus] = useState<Pm2Status | null>(null);
  const [processes, setProcesses] = useState<Pm2Process[] | null>(null);
  const [name, setName] = useState("");
  const [script, setScript] = useState("");
  const [starting, setStarting] = useState(false);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  async function load() {
    try {
      const statusData = await api<Pm2Status>("/pm2/status");
      setStatus(statusData);
      if (!statusData.available) {
        setProcesses([]);
        return;
      }
      const data = await api<{ success: boolean; processes: Pm2Process[] }>("/pm2/processes");
      setProcesses(data.processes ?? []);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load PM2", "error");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function action(processName: string, act: "start" | "stop" | "restart") {
    try {
      const data = await api<{ success: boolean; error?: string }>(`/pm2/processes/${processName}/${act}`, {
        method: "POST",
      });
      if (data.success) {
        load();
      } else {
        show(data.error ?? `Failed to ${act} process`, "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : `Failed to ${act} process`, "error");
    }
  }

  async function deleteProcess() {
    if (!deleteTarget) return;
    try {
      const data = await api<{ success: boolean; error?: string }>(`/pm2/processes/${deleteTarget}`, {
        method: "DELETE",
      });
      if (data.success) {
        show("Process deleted", "success");
        load();
      } else {
        show(data.error ?? "Failed to delete process", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to delete process", "error");
    } finally {
      setDeleteTarget(null);
    }
  }

  function exportProcess(processName: string) {
    const a = document.createElement("a");
    a.href = `/api/export/pm2/${encodeURIComponent(processName)}`;
    a.download = `${processName}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function startNew() {
    if (!script.trim()) {
      show("Please enter a script path or command", "warning");
      return;
    }
    setStarting(true);
    try {
      const data = await api<{ success: boolean; error?: string }>("/pm2/start", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), script: script.trim() }),
      });
      if (data.success) {
        setName("");
        setScript("");
        show("App started", "success");
        load();
      } else {
        show(data.error ?? "Failed to start app", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to start app", "error");
    } finally {
      setStarting(false);
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
          <h2 className="text-2xl font-bold text-gray-100">PM2</h2>
          <p className="text-gray-500 text-sm mt-1">Node process manager running on this host</p>
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
              <span className="info-row-label">PM2</span>
              <span className="info-row-value text-green-400">
                Running{status.version ? ` · ${status.version}` : ""}
              </span>
            </div>
          ) : (
            <div>
              <p className="text-sm text-yellow-400 mb-3">PM2 is not installed on this system.</p>
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
            <Panel title={`Processes${processes ? ` (${processes.length})` : ""}`}>
              {processes === null ? (
                <p className="text-sm text-gray-500">Loading...</p>
              ) : processes.length === 0 ? (
                <p className="text-sm text-gray-500">No processes found</p>
              ) : (
                <div className="space-y-3">
                  {processes.map((proc) => {
                    const isOnline = proc.status === "online";
                    return (
                      <div key={proc.name} className="bg-white/5 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3 gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="metric-dot" style={{ color: isOnline ? "#4ade80" : "#f87171" }} />
                              <span className="font-semibold text-sm text-gray-100 truncate">{proc.name}</span>
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              PID: {proc.pid || "N/A"} · Mode: {proc.mode || "fork"}
                              {proc.port ? <span className="text-cyan-400"> · Port: {proc.port}</span> : null}
                            </p>
                          </div>
                          <span
                            className={`status-badge shrink-0 ${isOnline ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}
                          >
                            {proc.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-xs">
                          <div>
                            <p className="text-gray-500">CPU</p>
                            <p className="font-semibold text-gray-200">{proc.cpu}%</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Memory</p>
                            <p className="font-semibold text-gray-200">{proc.memory} MB</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Uptime</p>
                            <p className="text-gray-300">{proc.uptime || "N/A"}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Restarts</p>
                            <p className="font-semibold text-yellow-400">{proc.restarts || 0}</p>
                          </div>
                        </div>

                        <div className="flex gap-2 flex-wrap">
                          {isOnline ? (
                            <>
                              <button className="btn-danger" onClick={() => action(proc.name, "stop")}>
                                <StopIcon className="w-4 h-4 inline mr-1.5" />Stop
                              </button>
                              <button className="btn-secondary" onClick={() => action(proc.name, "restart")}>
                                <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Restart
                              </button>
                            </>
                          ) : (
                            <button className="btn-secondary" onClick={() => action(proc.name, "start")}>
                              <PlayIcon className="w-4 h-4 inline mr-1.5" />Start
                            </button>
                          )}
                          <button className="btn-secondary" onClick={() => setLogsFor(proc.name)}>
                            <DocumentTextIcon className="w-4 h-4 inline mr-1.5" />Logs
                          </button>
                          <button className="btn-danger" onClick={() => setDeleteTarget(proc.name)}>
                            <TrashIcon className="w-4 h-4 inline mr-1.5" />Delete
                          </button>
                          <button className="btn-secondary" onClick={() => exportProcess(proc.name)}>
                            <ArrowDownTrayIcon className="w-4 h-4 inline mr-1.5" />Export
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            <Panel title="Start new app">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-gray-500 text-xs mb-1.5">Name (optional)</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} className="input-field w-full" placeholder="my-app" />
                </div>
                <div>
                  <label className="block text-gray-500 text-xs mb-1.5">Script path or command</label>
                  <input
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    className="input-field w-full"
                    placeholder="index.js"
                  />
                </div>
              </div>
              <button className="btn-primary disabled:opacity-60" onClick={startNew} disabled={starting}>
                {starting ? "Starting..." : "Start app"}
              </button>
            </Panel>
          </>
        )}
      </div>

      {logsFor && <LogsModal processName={logsFor} onClose={() => setLogsFor(null)} />}

      {deleteTarget && (
        <Modal title="Delete process" onClose={() => setDeleteTarget(null)}>
          <p className="text-sm text-gray-300">
            Delete process <span className="font-semibold text-gray-100">{deleteTarget}</span>?
          </p>
          <div className="flex gap-2 mt-5">
            <button className="btn-danger flex-1" onClick={deleteProcess}>
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

function LogsModal({ processName, onClose }: { processName: string; onClose: () => void }) {
  const [logs, setLogs] = useState<string | null>(null);

  useEffect(() => {
    api<{ success: boolean; logs?: string; error?: string }>(`/pm2/processes/${processName}/logs?lines=100`)
      .then((data) => setLogs(data.success ? data.logs || "No logs available" : `Error: ${data.error}`))
      .catch((err) => setLogs(`Error loading logs: ${err instanceof Error ? err.message : "Unknown error"}`));
  }, [processName]);

  return (
    <Modal title={`${processName} - Logs`} onClose={onClose} wide>
      <pre className="bg-black/30 rounded-lg p-4 max-h-[500px] overflow-y-auto font-mono text-xs whitespace-pre-wrap text-gray-300">
        {logs ?? "Loading logs..."}
      </pre>
    </Modal>
  );
}

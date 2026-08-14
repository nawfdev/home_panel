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
  CubeIcon,
  RectangleStackIcon,
  SparklesIcon,
  PlusIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  RocketLaunchIcon,
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

interface ComposeStack {
  name: string;
  status: "running" | "stopped" | "partial";
  services: string[];
  content: string;
  path: string;
  updatedAt: string;
  containerCount: number;
}

interface AppTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  defaultPort: number;
  tags: string[];
  composeYaml: string;
}

export function Docker() {
  const { show } = useToast();
  const [activeTab, setActiveTab] = useState<"containers" | "compose" | "templates">("containers");

  const [status, setStatus] = useState<DockerStatus | null>(null);
  const [containers, setContainers] = useState<Container[] | null>(null);
  const [stacks, setStacks] = useState<ComposeStack[]>([]);
  const [templates, setTemplates] = useState<AppTemplate[]>([]);

  // Simple Container Run State
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [ports, setPorts] = useState("");
  const [running, setRunning] = useState(false);

  // Modals
  const [logsFor, setLogsFor] = useState<{ id: string; name: string } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);

  // Compose Editor State
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorName, setEditorName] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [savingStack, setSavingStack] = useState(false);
  const [deployingStack, setDeployingStack] = useState(false);
  const [stackActionName, setStackActionName] = useState<string | null>(null);

  async function loadDocker() {
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

  async function loadStacks() {
    try {
      const data = await api<{ success: boolean; stacks: ComposeStack[] }>("/docker/compose/stacks");
      setStacks(data.stacks || []);
    } catch {
      /* ignore */
    }
  }

  async function loadTemplates() {
    try {
      const data = await api<{ success: boolean; templates: AppTemplate[] }>("/docker/compose/templates");
      setTemplates(data.templates || []);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    loadDocker();
    loadStacks();
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function action(id: string, act: "start" | "stop" | "restart") {
    try {
      const data = await api<{ success: boolean; error?: string }>(`/docker/containers/${id}/${act}`, {
        method: "POST",
      });
      if (data.success) {
        loadDocker();
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
        loadDocker();
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
        loadDocker();
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
    show(ok ? "Copied to clipboard" : "Couldn't copy — select text manually", ok ? "success" : "warning");
  }

  // --- Compose Actions ---

  function openNewCompose() {
    setEditorName("");
    setEditorContent(`services:\n  app:\n    image: nginx:alpine\n    ports:\n      - "8080:80"\n    restart: unless-stopped\n`);
    setEditorOpen(true);
  }

  function openEditCompose(st: ComposeStack) {
    setEditorName(st.name);
    setEditorContent(st.content);
    setEditorOpen(true);
  }

  function applyTemplate(tpl: AppTemplate) {
    setEditorName(tpl.id);
    setEditorContent(tpl.composeYaml);
    setEditorOpen(true);
    setActiveTab("compose");
    show(`Loaded template: ${tpl.name}. Click Deploy to launch.`, "success", 3000);
  }

  async function saveAndDeployStack() {
    if (!editorName.trim() || !editorContent.trim()) {
      show("Stack name and Compose YAML required", "warning");
      return;
    }
    setSavingStack(true);
    try {
      await api("/docker/compose/stacks", {
        method: "POST",
        body: JSON.stringify({ name: editorName.trim(), content: editorContent }),
      });

      setDeployingStack(true);
      const res = await api<{ success: boolean; message: string; output?: string }>(
        `/docker/compose/stacks/${encodeURIComponent(editorName.trim())}/up`,
        { method: "POST" }
      );
      show(res.message || "Compose stack deployed successfully!", "success", 4000);
      setEditorOpen(false);
      loadStacks();
      loadDocker();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to deploy stack", "error");
    } finally {
      setSavingStack(false);
      setDeployingStack(false);
    }
  }

  async function stackAction(stackName: string, act: "up" | "down" | "restart") {
    setStackActionName(stackName);
    try {
      const res = await api<{ success: boolean; message: string }>(
        `/docker/compose/stacks/${encodeURIComponent(stackName)}/${act}`,
        { method: "POST" }
      );
      show(res.message || `Stack ${act} completed`, "success", 3000);
      loadStacks();
      loadDocker();
    } catch (err) {
      show(err instanceof Error ? err.message : `Failed to ${act} stack`, "error");
    } finally {
      setStackActionName(null);
    }
  }

  async function deleteStack(stackName: string) {
    try {
      await api(`/docker/compose/stacks/${encodeURIComponent(stackName)}`, { method: "DELETE" });
      show(`Stack ${stackName} deleted`, "success");
      loadStacks();
      loadDocker();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to delete stack", "error");
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
            <CubeIcon className="w-7 h-7 text-blue-400" />
            Docker & Compose
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Manage live containers, multi-service Compose stacks, and 1-click app catalog
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === "compose" && (
            <button className="btn-primary text-xs flex items-center gap-1" onClick={openNewCompose}>
              <PlusIcon className="w-4 h-4" />
              New stack
            </button>
          )}
          <button
            className="btn-secondary text-xs"
            onClick={() => {
              loadDocker();
              loadStacks();
            }}
          >
            <ArrowPathIcon className="w-4 h-4 inline mr-1" />
            Refresh
          </button>
        </div>
      </div>

      {/* Segmented Tab Navigation */}
      <div className="flex items-center gap-1.5 p-1 bg-white/5 border border-white/10 rounded-xl overflow-x-auto">
        <button
          onClick={() => setActiveTab("containers")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
            activeTab === "containers"
              ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 shadow-sm"
              : "text-gray-400 hover:text-gray-200 hover:bg-white/5 border border-transparent"
          }`}
        >
          <CubeIcon className="w-4 h-4" />
          <span>Containers ({containers ? containers.length : 0})</span>
        </button>

        <button
          onClick={() => setActiveTab("compose")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
            activeTab === "compose"
              ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 shadow-sm"
              : "text-gray-400 hover:text-gray-200 hover:bg-white/5 border border-transparent"
          }`}
        >
          <RectangleStackIcon className="w-4 h-4" />
          <span>Compose Stacks ({stacks.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("templates")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
            activeTab === "templates"
              ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 shadow-sm"
              : "text-gray-400 hover:text-gray-200 hover:bg-white/5 border border-transparent"
          }`}
        >
          <SparklesIcon className="w-4 h-4 text-amber-400" />
          <span>App Catalog (1-Click)</span>
        </button>
      </div>

      {/* TAB 1: CONTAINERS */}
      {activeTab === "containers" && (
        <div className="space-y-4">
          <Panel title="Docker daemon status">
            {status === null ? (
              <p className="text-sm text-gray-500">Loading Docker status...</p>
            ) : status.available ? (
              <div className="info-row">
                <span className="info-row-label">Docker Daemon</span>
                <span className="info-row-value text-emerald-400 font-semibold flex items-center gap-1.5">
                  <CheckCircleIcon className="w-4 h-4" />
                  Running {status.version ? `(v${status.version})` : ""}
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
              <Panel title={`Active containers (${containers ? containers.length : 0})`}>
                {containers === null ? (
                  <p className="text-sm text-gray-500 py-4">Loading containers...</p>
                ) : containers.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4 text-center">No containers found running</p>
                ) : (
                  <div className="space-y-3">
                    {containers.map((c) => {
                      const isRunning = c.state === "running";
                      return (
                        <div key={c.id} className="bg-white/5 border border-white/5 rounded-xl p-4 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                    isRunning ? "bg-emerald-400 animate-pulse" : "bg-rose-400"
                                  }`}
                                />
                                <span className="font-bold text-sm text-gray-100 truncate">{c.name}</span>
                              </div>
                              <p className="text-xs text-gray-400 font-mono truncate mt-0.5">{c.image}</p>
                            </div>
                            <span
                              className={`text-[10px] font-mono px-2 py-0.5 rounded-full uppercase font-bold shrink-0 ${
                                isRunning
                                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                  : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                              }`}
                            >
                              {c.status}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-black/20 p-2.5 rounded-lg font-mono">
                            <div>
                              <p className="text-gray-500 text-[10px]">ID</p>
                              <p className="text-gray-300">{c.id.substring(0, 12)}</p>
                            </div>
                            <div>
                              <p className="text-gray-500 text-[10px]">PORTS</p>
                              <p className="text-gray-300 truncate">{c.ports || "—"}</p>
                            </div>
                            <div>
                              <p className="text-gray-500 text-[10px]">STATE</p>
                              <p className="text-gray-300 capitalize">{c.state}</p>
                            </div>
                            <div>
                              <p className="text-gray-500 text-[10px]">UPTIME</p>
                              <p className="text-gray-300 truncate">{c.uptime || "—"}</p>
                            </div>
                          </div>

                          <div className="flex gap-2 flex-wrap pt-1">
                            {isRunning ? (
                              <>
                                <button className="btn-danger text-xs !py-1.5 !px-3" onClick={() => action(c.id, "stop")}>
                                  <StopIcon className="w-3.5 h-3.5 inline mr-1" />
                                  Stop
                                </button>
                                <button className="btn-secondary text-xs !py-1.5 !px-3" onClick={() => action(c.id, "restart")}>
                                  <ArrowPathIcon className="w-3.5 h-3.5 inline mr-1" />
                                  Restart
                                </button>
                              </>
                            ) : (
                              <button className="btn-secondary text-xs !py-1.5 !px-3" onClick={() => action(c.id, "start")}>
                                <PlayIcon className="w-3.5 h-3.5 inline mr-1" />
                                Start
                              </button>
                            )}
                            <button
                              className="btn-secondary text-xs !py-1.5 !px-3"
                              onClick={() => setLogsFor({ id: c.id, name: c.name })}
                            >
                              <DocumentTextIcon className="w-3.5 h-3.5 inline mr-1" />
                              Logs
                            </button>
                            <button
                              className="btn-danger text-xs !py-1.5 !px-3"
                              onClick={() => setRemoveTarget({ id: c.id, name: c.name })}
                            >
                              <TrashIcon className="w-3.5 h-3.5 inline mr-1" />
                              Remove
                            </button>
                            <button
                              className="btn-secondary text-xs !py-1.5 !px-3"
                              onClick={() => exportContainer(c.id, c.name)}
                            >
                              <ArrowDownTrayIcon className="w-3.5 h-3.5 inline mr-1" />
                              Export
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>

              <Panel title="Run simple standalone container">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-gray-500 text-xs mb-1">Container name (optional)</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="input-field w-full text-xs font-mono"
                      placeholder="e.g. web-app"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-500 text-xs mb-1">Docker image</label>
                    <input
                      value={image}
                      onChange={(e) => setImage(e.target.value)}
                      className="input-field w-full text-xs font-mono"
                      placeholder="e.g. nginx:alpine, redis:latest"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-500 text-xs mb-1">Port mappings (host:container)</label>
                    <input
                      value={ports}
                      onChange={(e) => setPorts(e.target.value)}
                      className="input-field w-full text-xs font-mono"
                      placeholder="e.g. 8080:80, 6379:6379"
                    />
                  </div>
                </div>
                <button
                  className="btn-primary text-xs disabled:opacity-60"
                  onClick={runContainer}
                  disabled={running}
                >
                  {running ? "Pulling & launching..." : "Run container"}
                </button>
              </Panel>
            </>
          )}
        </div>
      )}

      {/* TAB 2: COMPOSE STACKS */}
      {activeTab === "compose" && (
        <div className="space-y-4">
          <Panel title={`Docker Compose Stacks (${stacks.length})`}>
            <p className="text-xs text-gray-500 mb-4">
              Multi-container services managed declaratively with <code className="text-blue-300">docker-compose.yml</code>.
            </p>

            {stacks.length === 0 ? (
              <div className="text-center py-10 text-gray-500 space-y-3">
                <RectangleStackIcon className="w-10 h-10 mx-auto text-gray-600" />
                <p className="text-sm">No compose stacks deployed yet.</p>
                <div className="flex justify-center gap-2">
                  <button className="btn-primary text-xs" onClick={openNewCompose}>
                    <PlusIcon className="w-4 h-4 inline mr-1" />
                    Create stack
                  </button>
                  <button className="btn-secondary text-xs" onClick={() => setActiveTab("templates")}>
                    <SparklesIcon className="w-4 h-4 inline mr-1 text-amber-400" />
                    Browse app catalog
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3.5">
                {stacks.map((st) => {
                  const isBusy = stackActionName === st.name;
                  const isRunning = st.status === "running";
                  return (
                    <div
                      key={st.name}
                      className="bg-white/5 border border-white/5 rounded-xl p-4 space-y-3 hover:bg-white/7 transition"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2.5">
                            <span
                              className={`w-3 h-3 rounded-full shrink-0 ${
                                isRunning
                                  ? "bg-emerald-400 shadow-emerald-500/50"
                                  : st.status === "partial"
                                  ? "bg-amber-400"
                                  : "bg-gray-500"
                              }`}
                            />
                            <h3 className="font-bold text-sm text-gray-100 font-mono truncate">{st.name}</h3>
                            <span
                              className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full font-bold ${
                                isRunning
                                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                  : st.status === "partial"
                                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                                  : "bg-gray-500/15 text-gray-400 border border-gray-500/30"
                              }`}
                            >
                              {st.status}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1 font-mono truncate">
                            Services: {st.services.join(", ") || "none"} &middot; Updated: {new Date(st.updatedAt).toLocaleString()}
                          </p>
                        </div>

                        {/* Stack Actions */}
                        <div className="flex items-center gap-2 flex-wrap shrink-0">
                          {isRunning ? (
                            <>
                              <button
                                className="btn-danger text-xs !py-1.5 !px-3 disabled:opacity-60"
                                onClick={() => stackAction(st.name, "down")}
                                disabled={isBusy}
                              >
                                <StopIcon className="w-3.5 h-3.5 inline mr-1" />
                                Stop
                              </button>
                              <button
                                className="btn-secondary text-xs !py-1.5 !px-3 disabled:opacity-60"
                                onClick={() => stackAction(st.name, "restart")}
                                disabled={isBusy}
                              >
                                <ArrowPathIcon className={`w-3.5 h-3.5 inline mr-1 ${isBusy ? "animate-spin" : ""}`} />
                                Restart
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn-primary text-xs !py-1.5 !px-3 disabled:opacity-60"
                              onClick={() => stackAction(st.name, "up")}
                              disabled={isBusy}
                            >
                              <PlayIcon className="w-3.5 h-3.5 inline mr-1" />
                              Start / Up
                            </button>
                          )}

                          <button className="btn-secondary text-xs !py-1.5 !px-3" onClick={() => openEditCompose(st)}>
                            <PencilSquareIcon className="w-3.5 h-3.5 inline mr-1" />
                            Edit YAML
                          </button>

                          <button className="btn-danger text-xs !py-1.5 !px-2.5" onClick={() => deleteStack(st.name)}>
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* TAB 3: APP CATALOG (1-CLICK TEMPLATES) */}
      {activeTab === "templates" && (
        <div className="space-y-4">
          <Panel title="Homelab App Catalog (1-Click Deploy)">
            <p className="text-xs text-gray-500 mb-6">
              Curated pre-configured Docker Compose templates. Click <strong>Deploy</strong> to customize and launch instantly.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="bg-white/5 hover:bg-white/8 border border-white/10 rounded-xl p-4.5 flex flex-col justify-between space-y-4 transition group"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20">
                        {tpl.category}
                      </span>
                      {tpl.defaultPort > 0 && (
                        <span className="text-[11px] font-mono text-gray-500">Port: :{tpl.defaultPort}</span>
                      )}
                    </div>

                    <h3 className="text-base font-bold text-gray-100 group-hover:text-blue-300 transition">
                      {tpl.name}
                    </h3>
                    <p className="text-xs text-gray-400 line-clamp-3 leading-relaxed">{tpl.description}</p>
                  </div>

                  <div className="space-y-3 pt-2 border-t border-white/5">
                    <div className="flex flex-wrap gap-1">
                      {tpl.tags.map((t) => (
                        <span key={t} className="text-[10px] text-gray-500 bg-black/30 px-1.5 py-0.5 rounded">
                          #{t}
                        </span>
                      ))}
                    </div>

                    <button
                      className="btn-primary w-full text-xs flex items-center justify-center gap-1.5"
                      onClick={() => applyTemplate(tpl)}
                    >
                      <RocketLaunchIcon className="w-4 h-4" />
                      Deploy {tpl.name}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {/* Compose Stack Editor Modal */}
      {editorOpen && (
        <Modal
          title={editorName ? `Docker Compose Stack: ${editorName}` : "Create new Compose stack"}
          onClose={() => !savingStack && !deployingStack && setEditorOpen(false)}
          wide
        >
          <div className="space-y-4">
            <div>
              <label className="block text-gray-400 text-xs font-semibold mb-1">Stack name</label>
              <input
                value={editorName}
                onChange={(e) => setEditorName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                placeholder="e.g. adguard-home, media-stack"
                className="input-field w-full text-xs font-mono"
                disabled={savingStack || deployingStack}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-gray-400 text-xs font-semibold">
                  docker-compose.yml configuration
                </label>
                <span className="text-[11px] text-gray-500 font-mono">YAML 3.8+ format</span>
              </div>
              <textarea
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                rows={16}
                className="input-field w-full text-xs font-mono leading-relaxed bg-[#0b0e17] text-blue-200 resize-y p-3 border border-white/10"
                placeholder="services: ..."
                spellCheck={false}
                disabled={savingStack || deployingStack}
              />
            </div>
          </div>

          <div className="flex gap-2 mt-6">
            <button
              className="btn-primary flex-1 text-xs disabled:opacity-60 flex items-center justify-center gap-1.5"
              onClick={saveAndDeployStack}
              disabled={savingStack || deployingStack || !editorName.trim() || !editorContent.trim()}
            >
              <RocketLaunchIcon className="w-4 h-4" />
              {deployingStack ? "Pulling & starting containers..." : "Deploy stack (Up -d)"}
            </button>
            <button
              className="btn-secondary flex-1 text-xs"
              onClick={() => setEditorOpen(false)}
              disabled={savingStack || deployingStack}
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* Logs Modal */}
      {logsFor && <LogsModal containerId={logsFor.id} containerName={logsFor.name} onClose={() => setLogsFor(null)} />}

      {/* Remove Container Modal */}
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
    <Modal title={`${containerName} - Container logs`} onClose={onClose} wide>
      <pre className="bg-black/40 border border-white/10 rounded-xl p-4 max-h-[500px] overflow-y-auto font-mono text-xs whitespace-pre-wrap text-gray-300">
        {logs ?? "Loading logs..."}
      </pre>
    </Modal>
  );
}

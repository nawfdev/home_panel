import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import {
  ArrowPathIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";

interface UpdateCheck {
  error?: string;
  updateAvailable?: boolean;
  behindBy?: number;
  localCommit?: string;
  remoteCommit?: string;
  pendingChanges?: string[];
  branch?: string;
}

export function Updates() {
  const { show } = useToast();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";

  // --- Updates state ---
  const [updateResult, setUpdateResult] = useState<UpdateCheck | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [updateStep, setUpdateStep] = useState(0);

  // --- Process Manager state ---
  const [panelManager, setPanelManager] = useState<"" | "systemd" | "pm2">("");
  const [panelServiceName, setPanelServiceName] = useState("");
  const [panelBinaryPath, setPanelBinaryPath] = useState("");
  const [savingPanelService, setSavingPanelService] = useState(false);
  const [restartingPanel, setRestartingPanel] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  // --- Paths state ---
  const [pathPm2, setPathPm2] = useState("");
  const [pathDocker, setPathDocker] = useState("");
  const [pathCloudflared, setPathCloudflared] = useState("");
  const [detecting, setDetecting] = useState<string | null>(null);
  const [savingPaths, setSavingPaths] = useState(false);

  // --- File Manager state ---
  const [maxUploadMb, setMaxUploadMb] = useState(500);
  const [savingUpload, setSavingUpload] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    api<{ success: boolean; manager?: string; name?: string; binaryPath?: string }>("/settings/panel-service")
      .then((res) => {
        if (res.success) {
          setPanelManager((res.manager as "" | "systemd" | "pm2") || "");
          setPanelServiceName(res.name || "");
          setPanelBinaryPath(res.binaryPath || "");
        }
      })
      .catch(() => {});

    api<{ pm2?: string; docker?: string; cloudflared?: string }>("/settings/paths")
      .then((res) => {
        setPathPm2(res.pm2 || "");
        setPathDocker(res.docker || "");
        setPathCloudflared(res.cloudflared || "");
      })
      .catch(() => {});

    api<{ success: boolean; maxUploadMb?: number }>("/settings/file-manager")
      .then((res) => {
        if (res.success && res.maxUploadMb) setMaxUploadMb(res.maxUploadMb);
      })
      .catch(() => {});
  }, [isAdmin]);

  async function checkForUpdates() {
    setCheckingUpdate(true);
    setUpdateResult(null);
    try {
      const data = await api<UpdateCheck>("/update/check");
      setUpdateResult(data);
    } catch (err) {
      setUpdateResult({ error: err instanceof Error ? err.message : "Update check failed" });
    } finally {
      setCheckingUpdate(false);
    }
  }

  const UPDATE_STEPS = ["Pulling latest changes...", "Rebuilding binary...", "Restarting panel..."];

  async function applyUpdate() {
    setApplyingUpdate(true);
    setUpdateStep(0);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/update/apply", {
        method: "POST",
      });
      if (data.success) {
        show(data.message ?? "Update applied successfully!", "success", 10000);
        setUpdateResult(null);
      } else {
        show(data.error ?? "Failed to apply update", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Update failed", "error");
    } finally {
      setApplyingUpdate(false);
    }
  }

  async function savePanelService() {
    setSavingPanelService(true);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/settings/panel-service", {
        method: "POST",
        body: JSON.stringify({ manager: panelManager, name: panelServiceName, binaryPath: panelBinaryPath }),
      });
      if (data.success) {
        show(data.message ?? "Process supervision settings saved", "success");
      } else {
        show(data.error ?? "Failed to save", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSavingPanelService(false);
    }
  }

  async function restartPanel() {
    setConfirmRestart(false);
    setRestartingPanel(true);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/system/restart-panel", {
        method: "POST",
      });
      if (data.success) {
        show(data.message ?? "Restarting panel service...", "success", 8000);
      } else {
        show(data.error ?? "Failed to restart panel", "error");
        setRestartingPanel(false);
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to restart panel", "error");
      setRestartingPanel(false);
    }
  }

  async function detectPath(service: string) {
    setDetecting(service);
    try {
      const data = await api<{ success: boolean; path?: string; message?: string }>(
        `/settings/paths/detect/${service}`
      );
      if (data.success && data.path) {
        if (service === "pm2") setPathPm2(data.path);
        else if (service === "docker") setPathDocker(data.path);
        else if (service === "cloudflared") setPathCloudflared(data.path);
        show(`Detected: ${data.path}`, "success");
      } else {
        show(data.message ?? `Could not detect ${service}`, "warning");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : `Detection failed`, "error");
    } finally {
      setDetecting(null);
    }
  }

  async function savePaths() {
    setSavingPaths(true);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/settings/paths", {
        method: "POST",
        body: JSON.stringify({ pm2: pathPm2, docker: pathDocker, cloudflared: pathCloudflared }),
      });
      if (data.success) {
        show(data.message ?? "Service paths saved", "success");
      } else {
        show(data.error ?? "Failed to save paths", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save paths", "error");
    } finally {
      setSavingPaths(false);
    }
  }

  async function saveFileManager() {
    setSavingUpload(true);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/settings/file-manager", {
        method: "POST",
        body: JSON.stringify({ maxUploadMb }),
      });
      if (data.success) {
        show(data.message ?? "Upload limits saved", "success");
      } else {
        show(data.error ?? "Failed to save settings", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save settings", "error");
    } finally {
      setSavingUpload(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
          <ArrowPathIcon className="w-7 h-7 text-blue-400" />
          System & Updates
        </h2>
        <p className="text-gray-500 text-sm mt-0.5">
          Panel version management, background process supervision, and service binary paths
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System Updates Panel */}
        <Panel title="System update status">
          <p className="text-xs text-gray-500 mb-3">Compare local deployment against remote git repository.</p>
          <button
            className="btn-secondary text-xs w-full mb-4 disabled:opacity-60 flex items-center justify-center gap-1.5"
            onClick={checkForUpdates}
            disabled={checkingUpdate}
          >
            <MagnifyingGlassIcon className="w-4 h-4" />
            {checkingUpdate ? "Checking remote repository..." : "Check for updates"}
          </button>

          {updateResult?.error && (
            <p className="text-xs text-red-400 p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl">
              Error: {updateResult.error}
            </p>
          )}

          {updateResult && !updateResult.error && updateResult.updateAvailable && (
            <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl space-y-2.5">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>New panel update is available</span>
              </div>
              <p className="text-xs text-gray-300">
                {updateResult.behindBy} commit(s) behind &middot;{" "}
                <span className="font-mono text-gray-400">{updateResult.localCommit}</span> &rarr;{" "}
                <span className="font-mono text-emerald-400 font-bold">{updateResult.remoteCommit}</span>
              </p>
              {updateResult.pendingChanges && (
                <ul className="text-[11px] text-gray-400 space-y-1 pt-2 border-t border-white/10">
                  {updateResult.pendingChanges.slice(0, 5).map((c) => (
                    <li key={c} className="truncate">&bull; {c}</li>
                  ))}
                </ul>
              )}
              <button
                className="btn-primary w-full text-xs mt-3 disabled:opacity-60"
                onClick={applyUpdate}
                disabled={applyingUpdate}
              >
                {applyingUpdate ? "Applying update..." : "Update now"}
              </button>
              {applyingUpdate && (
                <div className="mt-2 text-center">
                  <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden mb-1">
                    <div className="h-full bg-blue-500 animate-pulse w-full" />
                  </div>
                  <p className="text-[10px] text-gray-400">{UPDATE_STEPS[updateStep]}</p>
                </div>
              )}
            </div>
          )}

          {updateResult && !updateResult.error && !updateResult.updateAvailable && (
            <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 flex items-center gap-2.5">
              <ShieldCheckIcon className="w-5 h-5 shrink-0" />
              <div>
                <div className="font-bold">Panel is up to date</div>
                <div className="text-[11px] text-gray-400 font-mono mt-0.5">
                  commit {updateResult.localCommit} ({updateResult.branch})
                </div>
              </div>
            </div>
          )}
        </Panel>

        {/* Process Supervision Panel */}
        <Panel title="Process manager supervision">
          <p className="text-xs text-gray-500 mb-3">
            Allows the panel to restart itself cleanly after updates without requiring manual SSH commands.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-gray-400 text-xs font-semibold mb-1">Process manager</label>
              <select
                value={panelManager}
                onChange={(e) => setPanelManager(e.target.value as "" | "systemd" | "pm2")}
                className="input-field w-full text-xs"
              >
                <option value="">Not configured</option>
                <option value="systemd">systemd (recommended on Linux)</option>
                <option value="pm2">PM2 process manager</option>
              </select>
            </div>
            <div>
              <label className="block text-gray-400 text-xs font-semibold mb-1">
                {panelManager === "pm2" ? "PM2 process name" : "systemd unit name"}
              </label>
              <input
                value={panelServiceName}
                onChange={(e) => setPanelServiceName(e.target.value)}
                placeholder={panelManager === "pm2" ? "homepanel" : "homepanel-go"}
                className="input-field w-full text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-xs font-semibold mb-1">Compiled binary path</label>
              <input
                value={panelBinaryPath}
                onChange={(e) => setPanelBinaryPath(e.target.value)}
                placeholder="/usr/local/bin/homepanel-go"
                className="input-field w-full text-xs font-mono"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button
              className="btn-secondary flex-1 text-xs disabled:opacity-60"
              onClick={savePanelService}
              disabled={savingPanelService}
            >
              {savingPanelService ? "Saving..." : "Save config"}
            </button>
            <button
              className="btn-danger flex-1 text-xs disabled:opacity-60 flex items-center justify-center gap-1"
              onClick={() => setConfirmRestart(true)}
              disabled={restartingPanel || !panelManager || !panelServiceName}
            >
              <ArrowPathIcon className="w-3.5 h-3.5" />
              {restartingPanel ? "Restarting..." : "Restart panel"}
            </button>
          </div>
        </Panel>

        {/* CLI Service Paths */}
        <Panel title="CLI executable paths">
          <p className="text-xs text-gray-500 mb-4">
            Override binary paths or click auto-detect to find executables automatically in system PATH.
          </p>
          <div className="space-y-3.5">
            {(
              [
                { key: "pm2", label: "PM2", value: pathPm2, set: setPathPm2, placeholder: "/usr/local/bin/pm2" },
                { key: "docker", label: "Docker", value: pathDocker, set: setPathDocker, placeholder: "/usr/bin/docker" },
                { key: "cloudflared", label: "Cloudflared", value: pathCloudflared, set: setPathCloudflared, placeholder: "/usr/bin/cloudflared" },
              ] as const
            ).map((svc) => (
              <div key={svc.key}>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-gray-400 text-xs font-semibold">{svc.label}</label>
                  <button
                    className="btn-secondary !py-0.5 !px-2 text-[11px] disabled:opacity-60 flex items-center gap-1"
                    onClick={() => detectPath(svc.key)}
                    disabled={detecting === svc.key}
                  >
                    <MagnifyingGlassIcon className="w-3 h-3" />
                    {detecting === svc.key ? "Scanning..." : "Auto-detect"}
                  </button>
                </div>
                <input
                  value={svc.value}
                  onChange={(e) => svc.set(e.target.value)}
                  placeholder={svc.placeholder}
                  className="input-field w-full text-xs font-mono"
                />
              </div>
            ))}
          </div>
          <button
            className="btn-primary w-full mt-5 text-xs disabled:opacity-60"
            onClick={savePaths}
            disabled={savingPaths}
          >
            {savingPaths ? "Saving..." : "Save service paths"}
          </button>
        </Panel>

        {/* Storage & Upload Limits */}
        <Panel title="File storage & upload limits">
          <p className="text-xs text-gray-500 mb-4">Maximum single file upload size supported by the Files manager.</p>
          <div className="space-y-3">
            <div>
              <label className="block text-gray-400 text-xs font-semibold mb-1">Max upload limit (MB)</label>
              <input
                type="number"
                min={1}
                value={maxUploadMb}
                onChange={(e) => setMaxUploadMb(parseInt(e.target.value) || 0)}
                className="input-field w-full text-sm font-mono"
              />
            </div>
            <p className="text-[11px] text-gray-500">
              Cloudflare Tunnel free plan caps a single HTTP body at ~100 MB. Larger files are recommended over LAN.
            </p>
          </div>
          <button
            className="btn-primary w-full mt-5 text-xs disabled:opacity-60"
            onClick={saveFileManager}
            disabled={savingUpload}
          >
            {savingUpload ? "Saving..." : "Save upload limits"}
          </button>
        </Panel>
      </div>

      {confirmRestart && (
        <Modal title="Restart panel" onClose={() => setConfirmRestart(false)}>
          <p className="text-sm text-gray-300">
            Restart the panel process via <span className="font-semibold text-gray-100">{panelManager}</span> (
            <span className="font-mono">{panelServiceName}</span>)? You will be disconnected briefly.
          </p>
          <div className="flex gap-2 mt-5">
            <button className="btn-danger flex-1 text-xs" onClick={restartPanel}>
              Restart now
            </button>
            <button className="btn-secondary flex-1 text-xs" onClick={() => setConfirmRestart(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

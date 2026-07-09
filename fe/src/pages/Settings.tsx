import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import {
  MagnifyingGlassIcon,
  LockClosedIcon,
  PuzzlePieceIcon,
  FolderIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";

type Tab = "account" | "integrations" | "paths" | "updates";

const TABS: { id: Tab; label: string; icon: typeof LockClosedIcon }[] = [
  { id: "account", label: "Account", icon: LockClosedIcon },
  { id: "integrations", label: "Integrations", icon: PuzzlePieceIcon },
  { id: "paths", label: "Service paths", icon: FolderIcon },
  { id: "updates", label: "Updates", icon: ArrowPathIcon },
];

interface UpdateCheck {
  error?: string;
  updateAvailable?: boolean;
  behindBy?: number;
  localCommit?: string;
  remoteCommit?: string;
  pendingChanges?: string[];
  currentVersion?: string;
}

export function Settings() {
  const { show } = useToast();
  const [tab, setTab] = useState<Tab>("account");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const [cfTokenPlaceholder, setCfTokenPlaceholder] = useState("Global API Key or Token");
  const [cfApiToken, setCfApiToken] = useState("");
  const [cfAccountId, setCfAccountId] = useState("");
  const [savingCf, setSavingCf] = useState(false);

  const [tgTokenPlaceholder, setTgTokenPlaceholder] = useState("123456789:ABCdef...");
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [tgEnabled, setTgEnabled] = useState(false);
  const [savingTg, setSavingTg] = useState(false);

  const [pathPm2, setPathPm2] = useState("");
  const [pathDocker, setPathDocker] = useState("");
  const [pathCloudflared, setPathCloudflared] = useState("");
  const [savingPaths, setSavingPaths] = useState(false);
  const [detecting, setDetecting] = useState<string | null>(null);

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheck | null>(null);

  useEffect(() => {
    api<{ success: boolean; hasToken?: boolean; accountId?: string }>("/settings/cloudflare")
      .then((res) => {
        if (res.success && res.hasToken) {
          setCfTokenPlaceholder("•••••••••••••••• (Token Saved)");
          if (res.accountId) setCfAccountId(res.accountId);
        }
      })
      .catch(() => {});
    api<{ success: boolean; botToken?: string; chatId?: string; enableNotifications?: boolean }>("/settings/telegram")
      .then((res) => {
        if (res.success) {
          if (res.botToken) setTgTokenPlaceholder("•••••••• (Saved)");
          if (res.chatId) setTgChatId(res.chatId);
          setTgEnabled(!!res.enableNotifications);
        }
      })
      .catch(() => {});
    api<{ success: boolean; paths?: { pm2?: string; docker?: string; cloudflared?: string } }>("/settings/paths")
      .then((res) => {
        if (res.success && res.paths) {
          setPathPm2(res.paths.pm2 ?? "");
          setPathDocker(res.paths.docker ?? "");
          setPathCloudflared(res.paths.cloudflared ?? "");
        }
      })
      .catch(() => {});
  }, []);

  async function changePassword() {
    if (!currentPassword || !newPassword) {
      show("Current and new password required", "warning");
      return;
    }
    setChangingPassword(true);
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      show("Password changed successfully", "success");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to change password", "error");
    } finally {
      setChangingPassword(false);
    }
  }

  async function saveCloudflare() {
    setSavingCf(true);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/settings/cloudflare", {
        method: "POST",
        body: JSON.stringify({ apiToken: cfApiToken, accountId: cfAccountId }),
      });
      if (data.success) {
        show(data.message ?? "Saved", "success");
        setCfApiToken("");
        setCfTokenPlaceholder("•••••••••••••••• (Token Saved)");
      } else {
        show(data.error ?? "Failed to save", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Connection error", "error");
    } finally {
      setSavingCf(false);
    }
  }

  async function saveTelegram() {
    setSavingTg(true);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/settings/telegram", {
        method: "POST",
        body: JSON.stringify({ botToken: tgBotToken, chatId: tgChatId, enableNotifications: tgEnabled }),
      });
      if (data.success) {
        show(data.message ?? "Saved", "success");
        if (tgBotToken) {
          setTgBotToken("");
          setTgTokenPlaceholder("•••••••• (Saved)");
        }
      } else {
        show(data.error ?? "Failed to save", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSavingTg(false);
    }
  }

  async function savePaths() {
    setSavingPaths(true);
    try {
      const data = await api<{ message?: string }>("/settings/paths", {
        method: "POST",
        body: JSON.stringify({ pm2: pathPm2, docker: pathDocker, cloudflared: pathCloudflared }),
      });
      show(data.message ?? "Paths saved", "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save paths", "error");
    } finally {
      setSavingPaths(false);
    }
  }

  async function detectPath(service: "pm2" | "docker" | "cloudflared") {
    setDetecting(service);
    try {
      const data = await api<{ success: boolean; path?: string }>(`/settings/paths/detect/${service}`);
      if (data.success && data.path) {
        if (service === "pm2") setPathPm2(data.path);
        if (service === "docker") setPathDocker(data.path);
        if (service === "cloudflared") setPathCloudflared(data.path);
        show(`Detected: ${data.path}`, "success");
      } else {
        show(`${service} not found - install or set path manually`, "warning");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Detection failed", "error");
    } finally {
      setDetecting(null);
    }
  }

  async function checkForUpdates() {
    setCheckingUpdate(true);
    setUpdateResult(null);
    try {
      const data = await api<UpdateCheck>("/update/check");
      setUpdateResult(data);
    } catch (err) {
      setUpdateResult({ error: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function applyUpdate() {
    setApplyingUpdate(true);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/update/apply", {
        method: "POST",
      });
      if (data.success) {
        show(`${data.message ?? "Update applied"} — restart the server to apply changes.`, "success", 8000);
      } else {
        show(data.error ?? "Update failed", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Update failed", "error");
    } finally {
      setApplyingUpdate(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-100">Settings</h2>
        <p className="text-gray-500 text-sm mt-1">Panel updates, credentials, and integrations</p>
      </div>

      <div className="tab-bar">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} className={`tab-btn ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              <Icon /> {t.label}
            </button>
          );
        })}
      </div>

      <div className="max-w-2xl">
        {tab === "account" && (
          <Panel title="Change password">
            <div className="space-y-3">
              <div>
                <label className="block text-gray-500 text-xs mb-1.5">Current password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="block text-gray-500 text-xs mb-1.5">New password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input-field w-full"
                />
              </div>
            </div>
            <button className="btn-primary w-full mt-4 disabled:opacity-60" onClick={changePassword} disabled={changingPassword}>
              {changingPassword ? "Changing..." : "Change password"}
            </button>
          </Panel>
        )}

        {tab === "integrations" && (
          <div className="space-y-4">
            <Panel title="Cloudflare integration">
              <p className="text-xs text-gray-500 mb-3">Connect the Cloudflare API to manage tunnels and DNS directly.</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-gray-500 text-xs mb-1.5">API token</label>
                  <input
                    type="password"
                    value={cfApiToken}
                    onChange={(e) => setCfApiToken(e.target.value)}
                    placeholder={cfTokenPlaceholder}
                    className="input-field w-full"
                  />
                </div>
                <div>
                  <label className="block text-gray-500 text-xs mb-1.5">Account ID (optional)</label>
                  <input
                    value={cfAccountId}
                    onChange={(e) => setCfAccountId(e.target.value)}
                    placeholder="From the Cloudflare dashboard URL"
                    className="input-field w-full"
                  />
                </div>
              </div>
              <button className="btn-primary w-full mt-4 disabled:opacity-60" onClick={saveCloudflare} disabled={savingCf}>
                {savingCf ? "Verifying..." : "Save & verify connection"}
              </button>
            </Panel>

            <Panel title="Telegram notifications">
              <p className="text-xs text-gray-500 mb-3">Receive alerts for high CPU, tunnel down, and more.</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-gray-500 text-xs mb-1.5">Bot token</label>
                  <input
                    type="password"
                    value={tgBotToken}
                    onChange={(e) => setTgBotToken(e.target.value)}
                    placeholder={tgTokenPlaceholder}
                    className="input-field w-full"
                  />
                </div>
                <div>
                  <label className="block text-gray-500 text-xs mb-1.5">Chat ID</label>
                  <input value={tgChatId} onChange={(e) => setTgChatId(e.target.value)} className="input-field w-full" />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={tgEnabled} onChange={(e) => setTgEnabled(e.target.checked)} />
                  Enable notifications
                </label>
              </div>
              <button className="btn-primary w-full mt-4 disabled:opacity-60" onClick={saveTelegram} disabled={savingTg}>
                {savingTg ? "Testing..." : "Save & test"}
              </button>
            </Panel>
          </div>
        )}

        {tab === "paths" && (
          <Panel title="Service paths">
            <p className="text-xs text-gray-500 mb-4">
              Override the executable path for each service, or leave blank to auto-detect.
            </p>
            <div className="space-y-4">
              {(
                [
                  { key: "pm2", label: "PM2", value: pathPm2, set: setPathPm2, placeholder: "/usr/local/bin/pm2 or auto" },
                  { key: "docker", label: "Docker", value: pathDocker, set: setPathDocker, placeholder: "/usr/bin/docker or auto" },
                  {
                    key: "cloudflared",
                    label: "Cloudflared",
                    value: pathCloudflared,
                    set: setPathCloudflared,
                    placeholder: "/usr/local/bin/cloudflared or auto",
                  },
                ] as const
              ).map((svc) => (
                <div key={svc.key}>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-gray-500 text-xs">{svc.label}</label>
                    <button
                      className="btn-secondary !py-1 !px-2 text-xs disabled:opacity-60"
                      onClick={() => detectPath(svc.key)}
                      disabled={detecting === svc.key}
                    >
                      <MagnifyingGlassIcon className="w-3.5 h-3.5 inline mr-1" />
                      {detecting === svc.key ? "Detecting..." : "Auto-detect"}
                    </button>
                  </div>
                  <input
                    value={svc.value}
                    onChange={(e) => svc.set(e.target.value)}
                    placeholder={svc.placeholder}
                    className="input-field w-full text-sm"
                  />
                </div>
              ))}
            </div>
            <button className="btn-primary w-full mt-4 disabled:opacity-60" onClick={savePaths} disabled={savingPaths}>
              {savingPaths ? "Saving..." : "Save service paths"}
            </button>
          </Panel>
        )}

        {tab === "updates" && (
          <Panel title="System update">
            <div className="flex justify-between items-center mb-3">
              <p className="text-xs text-gray-500">Check the git remote for a newer panel version</p>
              <button className="btn-secondary disabled:opacity-60" onClick={checkForUpdates} disabled={checkingUpdate}>
                <MagnifyingGlassIcon className="w-4 h-4 inline mr-1.5" />
                {checkingUpdate ? "Checking..." : "Check for updates"}
              </button>
            </div>
            {updateResult?.error && <p className="text-sm text-red-400">Error: {updateResult.error}</p>}
            {updateResult && !updateResult.error && updateResult.updateAvailable && (
              <div>
                <p className="text-sm text-green-400 font-medium mb-1">Update available</p>
                <p className="text-xs text-gray-400 mb-2">
                  {updateResult.behindBy} commit(s) behind · {updateResult.localCommit} &rarr; {updateResult.remoteCommit}
                </p>
                {updateResult.pendingChanges && updateResult.pendingChanges.length > 0 && (
                  <ul className="text-xs text-gray-400 mb-3 space-y-0.5">
                    {updateResult.pendingChanges.slice(0, 5).map((c) => (
                      <li key={c}>&middot; {c}</li>
                    ))}
                  </ul>
                )}
                <button className="btn-primary disabled:opacity-60" onClick={applyUpdate} disabled={applyingUpdate}>
                  {applyingUpdate ? "Applying..." : "Update now"}
                </button>
              </div>
            )}
            {updateResult && !updateResult.error && !updateResult.updateAvailable && (
              <p className="text-sm text-green-400">Up to date · {updateResult.currentVersion}</p>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

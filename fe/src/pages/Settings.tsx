import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import {
  MagnifyingGlassIcon,
  LockClosedIcon,
  PuzzlePieceIcon,
  FolderIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ShieldCheckIcon,
  KeyIcon,
  ComputerDesktopIcon,
} from "@heroicons/react/24/outline";

interface SessionDTO {
  id: string;
  username: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastSeen: string;
  current: boolean;
}

type Tab = "account" | "integrations" | "paths" | "updates";

const TABS: { id: Tab; label: string; icon: typeof LockClosedIcon; description: string; adminOnly?: boolean }[] = [
  { id: "account", label: "Account & Security", icon: LockClosedIcon, description: "Change password, 2FA, and active sessions" },
  { id: "integrations", label: "Integrations", icon: PuzzlePieceIcon, description: "Cloudflare, Telegram, and Subsource API", adminOnly: true },
  { id: "paths", label: "Service Paths", icon: FolderIcon, description: "CLI executable paths and upload storage limits", adminOnly: true },
  { id: "updates", label: "Updates & System", icon: ArrowPathIcon, description: "Panel version, remote updates, and process restart", adminOnly: true },
];

interface UpdateCheck {
  error?: string;
  updateAvailable?: boolean;
  behindBy?: number;
  localCommit?: string;
  remoteCommit?: string;
  pendingChanges?: string[];
  branch?: string;
}

export function Settings() {
  const { show } = useToast();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";
  const [tab, setTab] = useState<Tab>("account");

  // --- Account tab state ---
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSecret, setTotpSecret] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [sessions, setSessions] = useState<SessionDTO[]>([]);

  useEffect(() => {
    if (tab !== "account") return;
    api<{ enabled: boolean }>("/auth/totp")
      .then((res) => setTotpEnabled(res.enabled))
      .catch(() => {});
    api<{ sessions: SessionDTO[] }>("/auth/sessions")
      .then((res) => setSessions(res.sessions || []))
      .catch(() => {});
  }, [tab]);

  async function changePassword() {
    if (!currentPassword || !newPassword) {
      show("Both current and new password are required", "warning");
      return;
    }
    setChangingPassword(true);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (data.success) {
        show(data.message ?? "Password updated successfully", "success");
        setCurrentPassword("");
        setNewPassword("");
      } else {
        show(data.error ?? "Failed to change password", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to change password", "error");
    } finally {
      setChangingPassword(false);
    }
  }

  async function setupTotp() {
    try {
      const data = await api<{ secret: string; uri: string }>("/auth/totp/setup", { method: "POST" });
      setTotpSecret(data.secret);
      setTotpUri(data.uri);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to start 2FA setup", "error");
    }
  }

  async function enableTotp() {
    if (!totpCode.trim()) return;
    try {
      const data = await api<{ recoveryCodes: string[] }>("/auth/totp/enable", {
        method: "POST",
        body: JSON.stringify({ code: totpCode.trim() }),
      });
      setTotpEnabled(true);
      setTotpSecret("");
      setTotpCode("");
      setRecoveryCodes(data.recoveryCodes || []);
      show("Two-factor authentication enabled", "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to verify 2FA code", "error");
    }
  }

  async function disableTotp() {
    if (!disablePassword) {
      show("Password required to disable 2FA", "warning");
      return;
    }
    try {
      await api("/auth/totp/disable", {
        method: "POST",
        body: JSON.stringify({ password: disablePassword }),
      });
      setTotpEnabled(false);
      setDisablePassword("");
      setRecoveryCodes([]);
      show("Two-factor authentication disabled", "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to disable 2FA", "error");
    }
  }

  async function revokeSession(id: string) {
    try {
      await api(`/auth/sessions/${id}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((item) => item.id !== id));
      show("Session revoked", "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to revoke session", "error");
    }
  }

  // --- Integrations tab state ---
  const [cfApiToken, setCfApiToken] = useState("");
  const [cfAccountId, setCfAccountId] = useState("");
  const [cfTokenPlaceholder, setCfTokenPlaceholder] = useState("Paste token here");
  const [savingCf, setSavingCf] = useState(false);

  const [tgBotToken, setTgBotToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgTokenPlaceholder, setTgTokenPlaceholder] = useState("123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11");
  const [savingTg, setSavingTg] = useState(false);

  const [subsourceKey, setSubsourceKey] = useState("");
  const [subsourceKeyPlaceholder, setSubsourceKeyPlaceholder] = useState("Paste your subsource.net API key");
  const [savingSubsource, setSavingSubsource] = useState(false);

  useEffect(() => {
    if (!isAdmin || tab !== "integrations") return;
    api<{ hasToken: boolean; accountId?: string }>("/settings/cloudflare")
      .then((res) => {
        if (res.hasToken) setCfTokenPlaceholder("••••••••  (configured)");
        if (res.accountId) setCfAccountId(res.accountId);
      })
      .catch(() => {});
    api<{ botTokenConfigured: boolean; chatId: string; enableNotifications: boolean }>("/settings/telegram")
      .then((res) => {
        if (res.botTokenConfigured) setTgTokenPlaceholder("••••••••  (configured)");
        setTgChatId(res.chatId || "");
        setTgEnabled(res.enableNotifications);
      })
      .catch(() => {});
    api<{ configured: boolean }>("/settings/subsource")
      .then((res) => {
        if (res.configured) setSubsourceKeyPlaceholder("••••••••  (configured)");
      })
      .catch(() => {});
  }, [isAdmin, tab]);

  async function saveCloudflare() {
    setSavingCf(true);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/settings/cloudflare", {
        method: "POST",
        body: JSON.stringify({ apiToken: cfApiToken, accountId: cfAccountId }),
      });
      if (data.success) {
        show(data.message ?? "Cloudflare integration verified", "success");
        setCfTokenPlaceholder("••••••••  (configured)");
        setCfApiToken("");
      } else {
        show(data.error ?? "Failed to verify Cloudflare token", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save Cloudflare settings", "error");
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
        show(data.message ?? "Telegram settings saved and tested", "success");
        setTgTokenPlaceholder("••••••••  (configured)");
        setTgBotToken("");
      } else {
        show(data.error ?? "Failed to save Telegram settings", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save Telegram settings", "error");
    } finally {
      setSavingTg(false);
    }
  }

  async function saveSubsource() {
    setSavingSubsource(true);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/settings/subsource", {
        method: "POST",
        body: JSON.stringify({ apiKey: subsourceKey }),
      });
      if (data.success) {
        show(data.message ?? "Subsource API key saved", "success");
        setSubsourceKeyPlaceholder("••••••••  (configured)");
        setSubsourceKey("");
      } else {
        show(data.error ?? "Failed to save API key", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save API key", "error");
    } finally {
      setSavingSubsource(false);
    }
  }

  // --- Paths tab state ---
  const [pathPm2, setPathPm2] = useState("");
  const [pathDocker, setPathDocker] = useState("");
  const [pathCloudflared, setPathCloudflared] = useState("");
  const [detecting, setDetecting] = useState<string | null>(null);
  const [savingPaths, setSavingPaths] = useState(false);
  const [maxUploadMb, setMaxUploadMb] = useState(500);
  const [savingUpload, setSavingUpload] = useState(false);

  useEffect(() => {
    if (!isAdmin || tab !== "paths") return;
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
  }, [isAdmin, tab]);

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
        show(data.message ?? "Paths saved", "success");
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
        show(data.message ?? "File manager settings saved", "success");
      } else {
        show(data.error ?? "Failed to save settings", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save settings", "error");
    } finally {
      setSavingUpload(false);
    }
  }

  // --- Updates tab state ---
  const [updateResult, setUpdateResult] = useState<UpdateCheck | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [updateStep, setUpdateStep] = useState(0);

  const [panelManager, setPanelManager] = useState<"" | "systemd" | "pm2">("");
  const [panelServiceName, setPanelServiceName] = useState("");
  const [panelBinaryPath, setPanelBinaryPath] = useState("");
  const [savingPanelService, setSavingPanelService] = useState(false);
  const [restartingPanel, setRestartingPanel] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  useEffect(() => {
    if (!isAdmin || tab !== "updates") return;
    api<{ success: boolean; manager?: string; name?: string; binaryPath?: string }>("/settings/panel-service")
      .then((res) => {
        if (res.success) {
          setPanelManager((res.manager as "" | "systemd" | "pm2") || "");
          setPanelServiceName(res.name || "");
          setPanelBinaryPath(res.binaryPath || "");
        }
      })
      .catch(() => {});
  }, [isAdmin, tab]);

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
        show(data.message ?? "Saved", "success");
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
        show(data.message ?? "Restarting panel...", "success", 8000);
      } else {
        show(data.error ?? "Failed to restart panel", "error");
        setRestartingPanel(false);
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to restart panel", "error");
      setRestartingPanel(false);
    }
  }

  const activeTabMeta = TABS.find((t) => t.id === tab) || TABS[0];
  const availableTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
            Settings
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">{activeTabMeta.description}</p>
        </div>

        {/* Mobile Dropdown Category Selector */}
        <div className="sm:hidden">
          <div className="relative">
            <select
              value={tab}
              onChange={(e) => setTab(e.target.value as Tab)}
              className="input-field w-full text-sm font-medium pr-10 appearance-none bg-[#161a29]"
            >
              {availableTabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <ChevronDownIcon className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Desktop Segmented Tab Bar */}
      <div className="hidden sm:flex items-center gap-1.5 p-1 bg-white/5 border border-white/10 rounded-xl overflow-x-auto">
        {availableTabs.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                isActive
                  ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 shadow-sm"
                  : "text-gray-400 hover:text-gray-200 hover:bg-white/5 border border-transparent"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content Container */}
      <div className="max-w-4xl space-y-6">
        {/* TAB: ACCOUNT & SECURITY */}
        {tab === "account" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Panel title="Change password">
              <p className="text-xs text-gray-500 mb-3">Update your login password for this panel.</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-gray-500 text-xs mb-1">Current password</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="input-field w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-gray-500 text-xs mb-1">New password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="input-field w-full text-sm"
                  />
                </div>
              </div>
              <button
                className="btn-primary w-full mt-4 disabled:opacity-60"
                onClick={changePassword}
                disabled={changingPassword}
              >
                {changingPassword ? "Changing..." : "Update password"}
              </button>
            </Panel>

            <Panel title="Two-factor authentication (TOTP)">
              <p className="text-xs text-gray-500 mb-3">Add an extra layer of security with an authenticator app.</p>
              {totpEnabled ? (
                <div className="space-y-3">
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center gap-2 text-emerald-400 text-xs">
                    <ShieldCheckIcon className="w-5 h-5 shrink-0" />
                    <span>Two-factor authentication is active on your account.</span>
                  </div>
                  <input
                    type="password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    placeholder="Password to disable 2FA"
                    className="input-field w-full text-sm"
                  />
                  <button className="btn-danger w-full text-xs" onClick={disableTotp}>
                    Disable 2FA
                  </button>
                </div>
              ) : totpSecret ? (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400">Scan QR or enter secret into Google Authenticator / Aegis:</p>
                  <code className="block bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono break-all text-blue-300">
                    {totpSecret}
                  </code>
                  <a
                    className="text-xs text-blue-400 hover:underline block truncate"
                    href={totpUri}
                  >
                    Open Authenticator Link
                  </a>
                  <input
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="6-digit code from app"
                    className="input-field w-full font-mono text-sm"
                  />
                  <button className="btn-primary w-full text-xs" onClick={enableTotp}>
                    Verify and enable
                  </button>
                </div>
              ) : (
                <button className="btn-primary w-full text-xs" onClick={setupTotp}>
                  <KeyIcon className="w-4 h-4 inline mr-1.5" />
                  Set up authenticator
                </button>
              )}
              {recoveryCodes.length > 0 && (
                <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <p className="text-xs text-amber-400 font-semibold mb-1">Save these recovery codes now:</p>
                  <pre className="bg-black/40 rounded p-2 text-xs font-mono text-gray-300">{recoveryCodes.join("\n")}</pre>
                </div>
              )}
            </Panel>

            <div className="md:col-span-2">
              <Panel title="Active browser sessions">
                <p className="text-xs text-gray-500 mb-3">All devices and browsers currently logged into this panel.</p>
                <div className="space-y-2">
                  {sessions.map((item) => (
                    <div key={item.id} className="bg-white/5 rounded-lg p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <ComputerDesktopIcon className="w-4 h-4 text-gray-400 shrink-0" />
                          <p className="text-sm font-semibold text-gray-200">{item.ip}</p>
                          {item.current && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              Current session
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 truncate mt-0.5">{item.userAgent || "Unknown browser"}</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">Last active: {new Date(item.lastSeen).toLocaleString()}</p>
                      </div>
                      {!item.current && (
                        <button className="btn-secondary text-xs !py-1 !px-2.5 shrink-0" onClick={() => revokeSession(item.id)}>
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </div>
        )}

        {/* TAB: INTEGRATIONS */}
        {tab === "integrations" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Panel title="Cloudflare API integration">
              <p className="text-xs text-gray-500 mb-3">Manage Cloudflare Tunnels, DNS routes, and domains.</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-gray-500 text-xs mb-1">API Token</label>
                  <input
                    type="password"
                    value={cfApiToken}
                    onChange={(e) => setCfApiToken(e.target.value)}
                    placeholder={cfTokenPlaceholder}
                    className="input-field w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-gray-500 text-xs mb-1">Account ID (optional)</label>
                  <input
                    value={cfAccountId}
                    onChange={(e) => setCfAccountId(e.target.value)}
                    placeholder="From Cloudflare dashboard URL"
                    className="input-field w-full text-sm"
                  />
                </div>
              </div>
              <button
                className="btn-primary w-full mt-4 text-xs disabled:opacity-60"
                onClick={saveCloudflare}
                disabled={savingCf}
              >
                {savingCf ? "Verifying..." : "Save & verify token"}
              </button>
            </Panel>

            <Panel title="Telegram bot alerts">
              <p className="text-xs text-gray-500 mb-3">Send instant alerts for high load, tunnel downtime, and reboot.</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-gray-500 text-xs mb-1">Bot Token</label>
                  <input
                    type="password"
                    value={tgBotToken}
                    onChange={(e) => setTgBotToken(e.target.value)}
                    placeholder={tgTokenPlaceholder}
                    className="input-field w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-gray-500 text-xs mb-1">Chat ID</label>
                  <input
                    value={tgChatId}
                    onChange={(e) => setTgChatId(e.target.value)}
                    placeholder="e.g. 123456789"
                    className="input-field w-full text-sm"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-300 pt-1">
                  <input
                    type="checkbox"
                    checked={tgEnabled}
                    onChange={(e) => setTgEnabled(e.target.checked)}
                    className="accent-blue-500 rounded"
                  />
                  Enable Telegram notifications
                </label>
              </div>
              <button
                className="btn-primary w-full mt-4 text-xs disabled:opacity-60"
                onClick={saveTelegram}
                disabled={savingTg}
              >
                {savingTg ? "Testing..." : "Save & send test message"}
              </button>
            </Panel>

            <div className="md:col-span-2">
              <Panel title="Subtitle search (subsource.net)">
                <p className="text-xs text-gray-500 mb-3">
                  Powers the one-click subtitle search on the Stream and Movie player pages.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="password"
                    value={subsourceKey}
                    onChange={(e) => setSubsourceKey(e.target.value)}
                    placeholder={subsourceKeyPlaceholder}
                    className="input-field flex-1 text-sm"
                  />
                  <button
                    className="btn-primary text-xs disabled:opacity-60 shrink-0"
                    onClick={saveSubsource}
                    disabled={savingSubsource}
                  >
                    {savingSubsource ? "Saving..." : "Save API key"}
                  </button>
                </div>
              </Panel>
            </div>
          </div>
        )}

        {/* TAB: SERVICE PATHS & STORAGE */}
        {tab === "paths" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Panel title="CLI executable paths">
              <p className="text-xs text-gray-500 mb-4">
                Override system binaries or click Auto-detect to resolve them automatically.
              </p>
              <div className="space-y-4">
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
                        className="btn-secondary !py-0.5 !px-2 text-[11px] disabled:opacity-60"
                        onClick={() => detectPath(svc.key)}
                        disabled={detecting === svc.key}
                      >
                        <MagnifyingGlassIcon className="w-3 h-3 inline mr-1" />
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

            <Panel title="File storage & upload limits">
              <p className="text-xs text-gray-500 mb-3">Configure maximum single file upload size for the Files manager.</p>
              <div>
                <label className="block text-gray-400 text-xs font-semibold mb-1">Max upload size (MB)</label>
                <input
                  type="number"
                  min={1}
                  value={maxUploadMb}
                  onChange={(e) => setMaxUploadMb(parseInt(e.target.value) || 0)}
                  className="input-field w-full text-sm font-mono"
                />
                <p className="text-[11px] text-gray-500 mt-2">
                  Cloudflare Tunnel free plan enforces ~100 MB max per request. Larger uploads work best over direct LAN.
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
        )}

        {/* TAB: UPDATES & SYSTEM */}
        {tab === "updates" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Panel title="Panel update status">
              <p className="text-xs text-gray-500 mb-3">Check remote git repository for newer commits.</p>
              <button
                className="btn-secondary text-xs w-full mb-4 disabled:opacity-60"
                onClick={checkForUpdates}
                disabled={checkingUpdate}
              >
                <MagnifyingGlassIcon className="w-4 h-4 inline mr-1.5" />
                {checkingUpdate ? "Checking remote..." : "Check for updates"}
              </button>

              {updateResult?.error && <p className="text-xs text-red-400 p-3 bg-red-500/10 rounded-lg">Error: {updateResult.error}</p>}
              {updateResult && !updateResult.error && updateResult.updateAvailable && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg space-y-2">
                  <p className="text-xs text-emerald-400 font-bold">New version available!</p>
                  <p className="text-xs text-gray-300">
                    {updateResult.behindBy} commit(s) behind · <span className="font-mono">{updateResult.localCommit}</span> &rarr;{" "}
                    <span className="font-mono text-emerald-400">{updateResult.remoteCommit}</span>
                  </p>
                  {updateResult.pendingChanges && (
                    <ul className="text-[11px] text-gray-400 space-y-0.5 pt-1 border-t border-white/10">
                      {updateResult.pendingChanges.slice(0, 4).map((c) => (
                        <li key={c} className="truncate">&bull; {c}</li>
                      ))}
                    </ul>
                  )}
                  <button
                    className="btn-primary w-full text-xs mt-2 disabled:opacity-60"
                    onClick={applyUpdate}
                    disabled={applyingUpdate}
                  >
                    {applyingUpdate ? "Applying..." : "Update now"}
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
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400 flex items-center gap-2">
                  <ShieldCheckIcon className="w-5 h-5 shrink-0" />
                  <div>
                    <div className="font-semibold">Panel is up to date</div>
                    <div className="text-[10px] text-gray-400 font-mono">commit {updateResult.localCommit} ({updateResult.branch})</div>
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="Process manager supervision">
              <p className="text-xs text-gray-500 mb-3">
                Configure supervision so the panel can restart itself cleanly upon updates.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-gray-500 text-xs mb-1">Process Manager</label>
                  <select
                    value={panelManager}
                    onChange={(e) => setPanelManager(e.target.value as "" | "systemd" | "pm2")}
                    className="input-field w-full text-xs"
                  >
                    <option value="">Not configured</option>
                    <option value="systemd">systemd</option>
                    <option value="pm2">PM2</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-500 text-xs mb-1">
                    {panelManager === "pm2" ? "PM2 Process Name" : "systemd Unit Name"}
                  </label>
                  <input
                    value={panelServiceName}
                    onChange={(e) => setPanelServiceName(e.target.value)}
                    placeholder={panelManager === "pm2" ? "homepanel" : "homepanel-go"}
                    className="input-field w-full text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-gray-500 text-xs mb-1">Compiled Binary Path</label>
                  <input
                    value={panelBinaryPath}
                    onChange={(e) => setPanelBinaryPath(e.target.value)}
                    placeholder="/usr/local/bin/homepanel-go"
                    className="input-field w-full text-xs font-mono"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  className="btn-secondary flex-1 text-xs disabled:opacity-60"
                  onClick={savePanelService}
                  disabled={savingPanelService}
                >
                  {savingPanelService ? "Saving..." : "Save config"}
                </button>
                <button
                  className="btn-danger flex-1 text-xs disabled:opacity-60"
                  onClick={() => setConfirmRestart(true)}
                  disabled={restartingPanel || !panelManager || !panelServiceName}
                >
                  <ArrowPathIcon className="w-3.5 h-3.5 inline mr-1" />
                  {restartingPanel ? "Restarting..." : "Restart panel"}
                </button>
              </div>
            </Panel>
          </div>
        )}
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

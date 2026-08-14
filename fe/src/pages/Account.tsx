import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import {
  LockClosedIcon,
  ShieldCheckIcon,
  KeyIcon,
  ComputerDesktopIcon,
  UserCircleIcon,
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

export function Account() {
  const { show } = useToast();

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
  const [loadingSessions, setLoadingSessions] = useState(false);

  function loadSessions() {
    setLoadingSessions(true);
    api<{ sessions: SessionDTO[] }>("/auth/sessions")
      .then((res) => setSessions(res.sessions || []))
      .catch(() => {})
      .finally(() => setLoadingSessions(false));
  }

  useEffect(() => {
    api<{ enabled: boolean }>("/auth/totp")
      .then((res) => setTotpEnabled(res.enabled))
      .catch(() => {});
    loadSessions();
  }, []);

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
      show("Session revoked successfully", "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to revoke session", "error");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
          <UserCircleIcon className="w-7 h-7 text-blue-400" />
          Account & Security
        </h2>
        <p className="text-gray-500 text-sm mt-0.5">
          Manage your login credentials, two-factor authentication (2FA), and active browser sessions
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Password Panel */}
        <Panel title="Change login password">
          <p className="text-xs text-gray-500 mb-4">
            Update the password you use to sign in to this management panel.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-gray-400 text-xs font-semibold mb-1">Current password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="input-field w-full text-sm"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-xs font-semibold mb-1">New password</label>
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
            className="btn-primary w-full mt-4 text-xs disabled:opacity-60 flex items-center justify-center gap-1.5"
            onClick={changePassword}
            disabled={changingPassword}
          >
            <LockClosedIcon className="w-4 h-4" />
            {changingPassword ? "Updating..." : "Update password"}
          </button>
        </Panel>

        {/* Two-Factor Authentication */}
        <Panel title="Two-factor authentication (TOTP)">
          <p className="text-xs text-gray-500 mb-4">
            Require a 6-digit TOTP verification code from Google Authenticator, Aegis, or Bitwarden when signing in.
          </p>
          {totpEnabled ? (
            <div className="space-y-3">
              <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2.5 text-emerald-400 text-xs">
                <ShieldCheckIcon className="w-5 h-5 shrink-0" />
                <span className="font-semibold">2FA is currently active on your account.</span>
              </div>
              <div>
                <label className="block text-gray-400 text-xs font-semibold mb-1">Password to confirm disable</label>
                <input
                  type="password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  placeholder="Enter your account password"
                  className="input-field w-full text-sm"
                />
              </div>
              <button className="btn-danger w-full text-xs" onClick={disableTotp}>
                Disable 2FA protection
              </button>
            </div>
          ) : totpSecret ? (
            <div className="space-y-3">
              <p className="text-xs text-gray-300">Scan QR or enter secret into your authenticator app:</p>
              <code className="block bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono break-all text-blue-300">
                {totpSecret}
              </code>
              <a
                className="text-xs text-blue-400 hover:underline block truncate font-mono"
                href={totpUri}
              >
                Open in Authenticator App &rarr;
              </a>
              <div>
                <label className="block text-gray-400 text-xs font-semibold mb-1">Verification code</label>
                <input
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="6-digit code (e.g. 123456)"
                  className="input-field w-full font-mono text-sm"
                />
              </div>
              <button className="btn-primary w-full text-xs" onClick={enableTotp}>
                Verify code & enable 2FA
              </button>
            </div>
          ) : (
            <button className="btn-primary w-full text-xs flex items-center justify-center gap-1.5" onClick={setupTotp}>
              <KeyIcon className="w-4 h-4" />
              Set up authenticator (2FA)
            </button>
          )}

          {recoveryCodes.length > 0 && (
            <div className="mt-4 p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl">
              <p className="text-xs text-amber-400 font-semibold mb-1">Save these recovery codes now:</p>
              <pre className="bg-black/40 rounded p-2 text-xs font-mono text-gray-300">{recoveryCodes.join("\n")}</pre>
            </div>
          )}
        </Panel>

        {/* Active Browser Sessions */}
        <div className="md:col-span-2">
          <Panel title={`Active browser sessions (${sessions.length})`}>
            <p className="text-xs text-gray-500 mb-4">
              All browser sessions currently signed into your account. You can revoke any unrecognized device.
            </p>
            {loadingSessions ? (
              <p className="text-xs text-gray-500 py-3">Loading sessions...</p>
            ) : (
              <div className="space-y-2">
                {sessions.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white/5 hover:bg-white/7 rounded-xl p-3.5 flex items-center justify-between gap-3 border border-white/5 transition"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <ComputerDesktopIcon className="w-4 h-4 text-gray-400 shrink-0" />
                        <p className="text-sm font-semibold text-gray-200">{item.ip}</p>
                        {item.current && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono">
                            Current session
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate mt-0.5">{item.userAgent || "Unknown browser"}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        Logged in: {new Date(item.createdAt).toLocaleString()} &middot; Last active: {new Date(item.lastSeen).toLocaleString()}
                      </p>
                    </div>
                    {!item.current && (
                      <button
                        className="btn-secondary text-xs !py-1.5 !px-3 shrink-0"
                        onClick={() => revokeSession(item.id)}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

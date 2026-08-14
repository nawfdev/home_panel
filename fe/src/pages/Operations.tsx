import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { Panel } from "../components/ui/Panel";
import { formatBytes } from "../lib/format";
import {
  CircleStackIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";

interface BackupDTO {
  name: string;
  size: number;
  createdAt: string;
}

interface AuditDTO {
  id: number;
  timestamp: string;
  username?: string;
  ip: string;
  action: string;
  target?: string;
  hostId: number;
  result: string;
}

export function Operations() {
  const { show } = useToast();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";

  const [backups, setBackups] = useState<BackupDTO[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditDTO[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const [backupPassword, setBackupPassword] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [operationsBusy, setOperationsBusy] = useState(false);

  const [auditFilter, setAuditFilter] = useState("");

  function loadBackups() {
    setLoadingBackups(true);
    api<{ backups: BackupDTO[] }>("/backups")
      .then((res: { backups: BackupDTO[] }) => setBackups(res.backups || []))
      .catch((err: unknown) => show(err instanceof Error ? err.message : "Failed to load backups", "error"))
      .finally(() => setLoadingBackups(false));
  }

  function loadAudit() {
    setLoadingAudit(true);
    api<{ events: AuditDTO[] }>("/audit?limit=50")
      .then((res: { events: AuditDTO[] }) => setAuditEvents(res.events || []))
      .catch((err: unknown) => show(err instanceof Error ? err.message : "Failed to load audit events", "error"))
      .finally(() => setLoadingAudit(false));
  }

  useEffect(() => {
    if (!isAdmin) return;
    loadBackups();
    loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function createBackup() {
    if (backupPassword.length < 12) {
      show("Backup password must be at least 12 characters", "warning");
      return;
    }
    setOperationsBusy(true);
    try {
      const data = await api<{ backup: BackupDTO }>("/backups", {
        method: "POST",
        body: JSON.stringify({ password: backupPassword }),
      });
      setBackups((prev) => [data.backup, ...prev]);
      setBackupPassword("");
      show("Encrypted backup created successfully", "success");
      loadAudit();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to create backup", "error");
    } finally {
      setOperationsBusy(false);
    }
  }

  async function restoreBackup() {
    if (!restoreFile || backupPassword.length < 12) {
      show("Choose a backup file and enter password (min 12 chars)", "warning");
      return;
    }
    setOperationsBusy(true);
    const fd = new FormData();
    fd.append("file", restoreFile);
    fd.append("password", backupPassword);
    try {
      const res = await fetch("/api/backups/restore", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Restore failed");
      show(data.message || "Backup restored. Restart panel to apply.", "success", 10000);
      setRestoreFile(null);
      setBackupPassword("");
      loadAudit();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to restore backup", "error");
    } finally {
      setOperationsBusy(false);
    }
  }

  const filteredAudit = auditEvents.filter((item) => {
    if (!auditFilter.trim()) return true;
    const q = auditFilter.toLowerCase();
    return (
      (item.username && item.username.toLowerCase().includes(q)) ||
      item.action.toLowerCase().includes(q) ||
      (item.target && item.target.toLowerCase().includes(q)) ||
      item.ip.toLowerCase().includes(q) ||
      item.result.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
            <CircleStackIcon className="w-7 h-7 text-blue-400" />
            Backups & Audit
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Encrypted disaster recovery backups and real-time security audit trails
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Create Backup Card */}
        <Panel title="Create encrypted backup">
          <p className="text-xs text-gray-500 mb-4">
            Exports database, settings, projects, and SSH identity encrypted with AES-256-GCM.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-gray-400 text-xs font-semibold mb-1">Encryption password</label>
              <input
                type="password"
                value={backupPassword}
                onChange={(e) => setBackupPassword(e.target.value)}
                placeholder="Password (minimum 12 characters)"
                className="input-field w-full text-sm"
              />
            </div>
            <button
              className="btn-primary w-full text-xs disabled:opacity-60 flex items-center justify-center gap-1.5"
              disabled={operationsBusy || backupPassword.length < 12}
              onClick={createBackup}
            >
              <LockClosedIcon className="w-4 h-4" />
              {operationsBusy ? "Encrypting..." : "Create & save backup"}
            </button>
          </div>
        </Panel>

        {/* Restore Backup Card */}
        <Panel title="Restore from backup file">
          <p className="text-xs text-gray-500 mb-4">
            Upload an existing <code className="text-blue-300">.hpbak</code> archive to restore all system configuration.
          </p>
          <div className="space-y-3">
            <label className="border-2 border-dashed border-white/10 hover:border-blue-500/40 rounded-xl p-3 flex flex-col items-center justify-center cursor-pointer transition text-center bg-white/5">
              <ArrowUpTrayIcon className="w-6 h-6 text-gray-400 mb-1" />
              <span className="text-xs text-gray-300 font-medium truncate max-w-full">
                {restoreFile ? restoreFile.name : "Click to select .hpbak file"}
              </span>
              <input
                type="file"
                className="hidden"
                accept=".hpbak,.tar,.gz,.json"
                onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <button
              className="btn-danger w-full text-xs disabled:opacity-60 flex items-center justify-center gap-1.5"
              disabled={operationsBusy || !restoreFile || backupPassword.length < 12}
              onClick={restoreBackup}
            >
              <ArrowUpTrayIcon className="w-4 h-4" />
              {operationsBusy ? "Restoring..." : "Decrypt & restore backup"}
            </button>
          </div>
        </Panel>
      </div>

      {/* Available Backups List */}
      <Panel title={`Saved backup files (${backups.length})`}>
        <p className="text-xs text-gray-500 mb-3">All available backup archives stored on this server.</p>
        {loadingBackups ? (
          <p className="text-xs text-gray-500 py-3">Loading backup archives...</p>
        ) : (
          <div className="space-y-2">
            {backups.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between gap-3 bg-white/5 hover:bg-white/7 rounded-xl p-3.5 border border-white/5 transition"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <CircleStackIcon className="w-4 h-4 text-blue-400 shrink-0" />
                    <p className="text-xs font-mono font-semibold text-gray-200 truncate">{item.name}</p>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {formatBytes(item.size)} &middot; Created {new Date(item.createdAt).toLocaleString()}
                  </p>
                </div>
                <a
                  className="btn-secondary text-xs !py-1.5 !px-3 shrink-0 flex items-center gap-1"
                  href={`/api/backups/download?name=${encodeURIComponent(item.name)}`}
                  title="Download archive to local storage"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">Download</span>
                </a>
              </div>
            ))}
            {backups.length === 0 && (
              <p className="text-xs text-gray-500 text-center py-4 italic">No backups found. Create one above.</p>
            )}
          </div>
        )}
      </Panel>

      {/* Security Audit Log Table */}
      <Panel title="Security audit log">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <p className="text-xs text-gray-500">Chronological ledger of security and configuration changes.</p>
          <div className="relative w-full sm:w-64">
            <input
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value)}
              placeholder="Search action, actor, IP..."
              className="input-field w-full text-xs pl-8"
            />
            <MagnifyingGlassIcon className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          </div>
        </div>

        {loadingAudit ? (
          <p className="text-xs text-gray-500 py-4">Loading audit entries...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-white/10">
                  <th className="pb-2.5 font-semibold">Timestamp</th>
                  <th className="pb-2.5 font-semibold">Actor / IP</th>
                  <th className="pb-2.5 font-semibold">Action</th>
                  <th className="pb-2.5 font-semibold">Target / Details</th>
                  <th className="pb-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAudit.map((item) => (
                  <tr key={item.id} className="border-t border-white/5 hover:bg-white/5 transition">
                    <td className="py-2.5 pr-3 whitespace-nowrap text-gray-400 flex items-center gap-1.5">
                      <ClockIcon className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                      <span>{new Date(item.timestamp).toLocaleString()}</span>
                    </td>
                    <td className="py-2.5 pr-3 font-medium text-gray-200">
                      {item.username ? (
                        <span>{item.username}</span>
                      ) : (
                        <span className="font-mono text-gray-400">{item.ip}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-blue-400 font-medium">{item.action}</td>
                    <td className="py-2.5 pr-3 max-w-56 truncate text-gray-300" title={item.target}>
                      {item.target || "—"}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider ${
                          item.result === "success"
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                            : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                        }`}
                      >
                        {item.result}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredAudit.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-gray-500 italic">
                      No audit events matching criteria
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

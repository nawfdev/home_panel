import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useInterval } from "../hooks/useInterval";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import { formatBytes } from "../lib/format";
import { ArrowPathIcon, PowerIcon } from "@heroicons/react/24/outline";

interface SystemStats {
  cpu: { usage: number; cores: number };
  memory: { total: number; used: number; usagePercent: number };
  disk: { fs: string; used: number; size: number; usagePercent: number; mount: string }[];
  os: { platform: string; distro: string; hostname: string; arch: string };
  uptime: number;
  network: { iface: string; rx_bytes: number; tx_bytes: number }[];
}

interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
  state: string;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function System() {
  const { show } = useToast();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[] | null>(null);

  const [rebootModalOpen, setRebootModalOpen] = useState(false);
  const [rebootAck, setRebootAck] = useState(false);
  const [rebooting, setRebooting] = useState(false);

  async function load() {
    try {
      const [statsData, procData] = await Promise.all([
        api<SystemStats>("/system/stats"),
        api<ProcessInfo[]>("/system/processes"),
      ]);
      setStats(statsData);
      setProcesses(procData);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load system stats", "error");
    }
  }

  useInterval(load, 5000);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function closeRebootModal() {
    setRebootModalOpen(false);
    setRebootAck(false);
  }

  async function rebootHost() {
    setRebooting(true);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/system/reboot-host", {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      closeRebootModal();
      if (data.success) {
        show(data.message ?? "Rebooting host...", "success", 10000);
      } else {
        show(data.error ?? "Failed to reboot host", "error");
        setRebooting(false);
      }
      // On success the host is about to go down — leave the button disabled
      // rather than resetting state, there's nothing left to poll for.
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to reboot host", "error");
      setRebooting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">System</h2>
          <p className="text-gray-500 text-sm mt-1">
            {stats ? `${stats.os.hostname} · ${stats.os.distro || stats.os.platform}` : "Host overview"}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={load}>
            <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
          </button>
          <button className="btn-danger" onClick={() => setRebootModalOpen(true)} disabled={rebooting}>
            <PowerIcon className="w-4 h-4 inline mr-1.5" />
            {rebooting ? "Rebooting..." : "Reboot host"}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="metric-strip">
          <div className="metric-item">
            <p className="metric-label">CPU</p>
            <p className="metric-value">{stats ? `${stats.cpu.usage.toFixed(1)}%` : "—"}</p>
            <p className="metric-sub">{stats ? `${stats.cpu.cores} cores` : ""}</p>
          </div>
          <div className="metric-item">
            <p className="metric-label">Memory</p>
            <p className="metric-value">{stats ? `${stats.memory.usagePercent.toFixed(1)}%` : "—"}</p>
            <p className="metric-sub">
              {stats ? `${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}` : ""}
            </p>
          </div>
          <div className="metric-item">
            <p className="metric-label">Uptime</p>
            <p className="metric-value">{stats ? formatUptime(stats.uptime) : "—"}</p>
          </div>
          <div className="metric-item">
            <p className="metric-label">Architecture</p>
            <p className="metric-value">{stats?.os.arch ?? "—"}</p>
          </div>
        </div>

        <Panel title="Disks">
          {!stats ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : stats.disk.length === 0 ? (
            <p className="text-sm text-gray-500">No disks reported</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {stats.disk.map((d) => (
                <div key={d.mount} className="bg-white/5 rounded-lg p-3">
                  <p className="font-semibold text-sm text-gray-100">{d.mount}</p>
                  <p className="text-xs text-gray-500 mb-2">{d.fs}</p>
                  <p className="text-xs text-gray-400">
                    {formatBytes(d.used)} / {formatBytes(d.size)} ({d.usagePercent.toFixed(1)}%)
                  </p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Network stats">
          {!stats ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : stats.network.length === 0 ? (
            <p className="text-sm text-gray-500">No interfaces found</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {stats.network.map((n) => (
                <div key={n.iface} className="bg-white/5 rounded-lg p-3">
                  <p className="font-semibold text-sm text-gray-100 mb-2">{n.iface}</p>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">RX</span>
                    <span className="font-mono text-gray-300">{formatBytes(n.rx_bytes)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">TX</span>
                    <span className="font-mono text-gray-300">{formatBytes(n.tx_bytes)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Top processes">
          {processes === null ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-white/7">
                    <th className="text-left py-2 font-medium">PID</th>
                    <th className="text-left py-2 font-medium">Name</th>
                    <th className="text-left py-2 font-medium">CPU %</th>
                    <th className="text-left py-2 font-medium">MEM %</th>
                    <th className="text-left py-2 font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {processes.map((p) => (
                    <tr key={p.pid} className="border-b border-white/5 text-gray-300">
                      <td className="py-2 font-mono text-xs">{p.pid}</td>
                      <td className="py-2">{p.name}</td>
                      <td className="py-2 font-mono">{p.cpu.toFixed(1)}</td>
                      <td className="py-2 font-mono">{p.mem.toFixed(1)}</td>
                      <td className="py-2 text-xs capitalize">{p.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {rebootModalOpen && (
        <Modal title="Reboot host" onClose={closeRebootModal}>
          <p className="text-sm text-gray-300">
            This reboots the entire machine{stats?.os.hostname ? ` (${stats.os.hostname})` : ""} — Docker, PM2,
            tunnels, and this panel itself will all go down until it finishes booting back up.
          </p>
          <label className="flex items-start gap-2 text-sm text-gray-300 mt-4">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={rebootAck}
              onChange={(e) => setRebootAck(e.target.checked)}
            />
            I understand this will reboot the whole machine, not just the panel.
          </label>
          <div className="flex gap-2 mt-5">
            <button className="btn-danger flex-1 disabled:opacity-60" onClick={rebootHost} disabled={!rebootAck || rebooting}>
              {rebooting ? "Rebooting..." : "Reboot now"}
            </button>
            <button className="btn-secondary flex-1" onClick={closeRebootModal}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

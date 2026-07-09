import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useInterval } from "../hooks/useInterval";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { formatBytes } from "../lib/format";
import { ArrowPathIcon } from "@heroicons/react/24/outline";

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">System</h2>
          <p className="text-gray-500 text-sm mt-1">
            {stats ? `${stats.os.hostname} · ${stats.os.distro || stats.os.platform}` : "Host overview"}
          </p>
        </div>
        <button className="btn-secondary" onClick={load}>
          <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
        </button>
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
    </div>
  );
}

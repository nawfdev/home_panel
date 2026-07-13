import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { useInterval } from "../hooks/useInterval";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import { PerformanceChart } from "../components/dashboard/PerformanceChart";
import { formatBytes, formatUptime, formatDuration } from "../lib/format";
import { ChartBarIcon, ServerIcon, CircleStackIcon, SignalIcon, PowerIcon } from "@heroicons/react/24/outline";

interface SystemStats {
  cpu: { usage: number; cores: number };
  memory: { total: number; used: number; free: number; usagePercent: number };
  disk: { fs: string; size: number; used: number; available: number; usagePercent: number; mount: string }[];
  os: { platform: string; distro: string; release: string; hostname: string; arch: string };
  uptime: number;
  battery: { hasBattery: boolean; percent: number; isCharging: boolean; acConnected: boolean };
  network: { iface: string; rx_bytes: number; tx_bytes: number }[];
}

interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
  state: string;
}

interface DashboardData {
  system: SystemStats;
  tunnel: {
    configured: boolean;
    processRunning: boolean;
    isReady: boolean;
    autoRestart?: boolean;
    downtime?: { isDown: boolean; currentDowntimeSec: number };
    apiConnected?: boolean;
    healthyCount?: number;
    totalCount?: number;
  };
  temperature: { available: boolean; main: number | null };
  projects: { total: number; running: number };
}

interface MetricPoint {
  timestamp: string;
  value: number;
}

function tunnelDisplay(tunnel: DashboardData["tunnel"]) {
  if (tunnel.apiConnected && tunnel.totalCount !== undefined) {
    const healthy = tunnel.healthyCount ?? 0;
    const total = tunnel.totalCount;
    return {
      text: `${healthy}/${total} healthy`,
      dot: healthy > 0 ? "text-green-400" : "text-red-400",
      detail: healthy > 0 ? "All tunnels healthy" : "Tunnels need attention",
    };
  }
  if (tunnel.downtime?.isDown) {
    return { text: "Offline", dot: "text-red-400", detail: `Down ${formatDuration(tunnel.downtime.currentDowntimeSec)}` };
  }
  if (tunnel.processRunning && tunnel.isReady) {
    return { text: "Online", dot: "text-green-400", detail: "Tunnel is online" };
  }
  if (tunnel.processRunning) {
    return { text: "Starting", dot: "text-yellow-400", detail: "Tunnel is starting" };
  }
  return { text: "Offline", dot: "text-red-400", detail: "Tunnel not running" };
}

function tempDot(temp: number) {
  if (temp < 50) return { dot: "text-green-400", label: "Normal" };
  if (temp < 70) return { dot: "text-yellow-400", label: "Warm" };
  if (temp < 85) return { dot: "text-orange-400", label: "Hot" };
  return { dot: "text-red-400", label: "Critical" };
}

function InfoRow({ label, value, dot }: { label: string; value: ReactNode; dot?: string }) {
  return (
    <div className="info-row">
      <span className="info-row-label">
        {dot && <span className={`metric-dot ${dot}`} />}
        {label}
      </span>
      <span className="info-row-value">{value}</span>
    </div>
  );
}

export function Dashboard() {
  const { show } = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [cpuHistory, setCpuHistory] = useState<MetricPoint[]>([]);
  const [memHistory, setMemHistory] = useState<MetricPoint[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[] | null>(null);

  const [rebootModalOpen, setRebootModalOpen] = useState(false);
  const [rebootAck, setRebootAck] = useState(false);
  const [rebooting, setRebooting] = useState(false);

  async function loadDashboard() {
    try {
      const d = await api<DashboardData>("/dashboard");
      setData(d);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Dashboard error:", err);
    }
  }

  async function loadProcesses() {
    try {
      setProcesses(await api<ProcessInfo[]>("/system/processes"));
    } catch (err) {
      console.error("Processes error:", err);
    }
  }

  async function loadGraphs() {
    try {
      const [cpu, mem] = await Promise.all([
        api<{ data: MetricPoint[] }>("/metrics/cpu"),
        api<{ data: MetricPoint[] }>("/metrics/memory"),
      ]);
      setCpuHistory(cpu.data);
      setMemHistory(mem.data);
    } catch (err) {
      console.error("Graphs error:", err);
    }
  }

  function closeRebootModal() {
    setRebootModalOpen(false);
    setRebootAck(false);
  }

  async function rebootHost() {
    setRebooting(true);
    try {
      const res = await api<{ success: boolean; message?: string; error?: string }>("/system/reboot-host", {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      closeRebootModal();
      if (res.success) {
        show(res.message ?? "Rebooting host...", "success", 10000);
      } else {
        show(res.error ?? "Failed to reboot host", "error");
        setRebooting(false);
      }
      // On success the host is about to go down — leave the button disabled
      // rather than resetting state, there's nothing left to poll for.
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to reboot host", "error");
      setRebooting(false);
    }
  }

  useInterval(loadDashboard, 10000);
  useInterval(loadProcesses, 5000);
  useInterval(loadGraphs, 60000);
  useEffect(() => {
    loadDashboard();
    loadProcesses();
    loadGraphs();
  }, []);

  const tunnel = data ? tunnelDisplay(data.tunnel) : null;
  const temp = data?.temperature?.available && data.temperature.main != null ? tempDot(data.temperature.main) : null;

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Dashboard</h2>
          <p className="text-gray-500 text-sm mt-1">Live overview of this host's health and services</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <div className="hidden sm:flex items-center gap-2 text-xs text-gray-500">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
              </span>
              Updated {lastUpdated.toLocaleTimeString()}
            </div>
          )}
          <button className="btn-danger" onClick={() => setRebootModalOpen(true)} disabled={rebooting}>
            <PowerIcon className="w-4 h-4 inline mr-1.5" />
            {rebooting ? "Rebooting..." : "Reboot host"}
          </button>
        </div>
      </div>

      <div className="metric-strip mb-6">
        <div className="metric-item">
          <p className="metric-label">CPU Usage</p>
          <p className="metric-value">{data?.system.cpu.usage ?? 0}%</p>
          <div className="mt-2.5 bg-white/5 rounded-full h-1">
            <div className="bg-blue-400 h-1 rounded-full transition-all" style={{ width: `${data?.system.cpu.usage ?? 0}%` }} />
          </div>
        </div>
        <div className="metric-item">
          <p className="metric-label">Memory Usage</p>
          <p className="metric-value">{data?.system.memory.usagePercent ?? 0}%</p>
          <div className="mt-2.5 bg-white/5 rounded-full h-1">
            <div className="bg-green-400 h-1 rounded-full transition-all" style={{ width: `${data?.system.memory.usagePercent ?? 0}%` }} />
          </div>
        </div>
        <div className="metric-item">
          <p className="metric-label">
            <span className={`metric-dot ${tunnel?.dot ?? "text-gray-600"}`} />
            Tunnel
          </p>
          <p className="metric-value text-[1.4rem]">{tunnel?.text ?? "Offline"}</p>
          <p className="metric-sub">{tunnel?.detail ?? "Click to view details"}</p>
        </div>
        <div className="metric-item">
          <p className="metric-label">System Uptime</p>
          <p className="metric-value">{data ? formatUptime(data.system.uptime) : "—"}</p>
          <p className="metric-sub">Since boot</p>
        </div>
      </div>

      <div className="mb-6">
        <h3 className="section-heading"><ChartBarIcon />Performance trends (24h)</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PerformanceChart title="CPU Usage" data={cpuHistory} color="#60a5fa" />
          <PerformanceChart title="Memory Usage" data={memHistory} color="#4ade80" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="System" icon={ServerIcon}>
          {data ? (
            <div>
              <InfoRow label="Operating system" value={`${data.system.os.distro} ${data.system.os.release}`} />
              <InfoRow label="Hostname" value={data.system.os.hostname} />
              <InfoRow label="Architecture" value={`${data.system.os.platform} / ${data.system.os.arch}`} />
              <InfoRow label="CPU cores" value={data.system.cpu.cores} />
              <InfoRow
                label="Projects running"
                value={<>{data.projects.running}<span className="text-gray-600">/</span>{data.projects.total}</>}
              />
              <InfoRow
                label="CPU temperature"
                dot={temp?.dot}
                value={data.temperature.available && data.temperature.main != null ? `${Math.round(data.temperature.main)}°C · ${temp?.label}` : "N/A"}
              />
              <InfoRow
                label="Power"
                value={
                  data.system.battery.hasBattery
                    ? `${data.system.battery.percent}% · ${data.system.battery.isCharging ? "Charging" : "On battery"}`
                    : "AC · Desktop mode"
                }
              />
            </div>
          ) : (
            <p className="text-sm text-gray-500">Loading...</p>
          )}
        </Panel>
        <Panel title="Disk Usage" icon={CircleStackIcon}>
          {data ? (
            <div className="space-y-3">
              {data.system.disk.map((d) => {
                const pct = Math.round(d.usagePercent || 0);
                const mountDisplay = d.mount.length > 15 ? `...${d.mount.slice(-12)}` : d.mount;
                return (
                  <div key={d.mount} className="mb-3">
                    <div className="flex flex-col sm:flex-row sm:justify-between text-sm mb-1 gap-1">
                      <span className="text-gray-300 truncate" title={d.mount}>{mountDisplay}</span>
                      <span className="text-gray-500 text-xs sm:text-sm font-mono">{formatBytes(d.used)} / {formatBytes(d.size)} ({pct}%)</span>
                    </div>
                    <div className="bg-white/5 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${pct > 90 ? "bg-red-400" : pct > 70 ? "bg-yellow-400" : "bg-orange-400"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Loading...</p>
          )}
        </Panel>
        <Panel title="Network stats" icon={SignalIcon}>
          {data ? (
            data.system.network.length === 0 ? (
              <p className="text-sm text-gray-500">No interfaces found</p>
            ) : (
              <div className="space-y-3">
                {data.system.network.map((n) => (
                  <div key={n.iface} className="flex items-center justify-between text-sm">
                    <span className="text-gray-300">{n.iface}</span>
                    <span className="text-gray-500 text-xs font-mono">
                      RX {formatBytes(n.rx_bytes)} · TX {formatBytes(n.tx_bytes)}
                    </span>
                  </div>
                ))}
              </div>
            )
          ) : (
            <p className="text-sm text-gray-500">Loading...</p>
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
                  {processes.slice(0, 10).map((p) => (
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
            This reboots the entire machine{data?.system.os.hostname ? ` (${data.system.os.hostname})` : ""} — Docker,
            PM2, tunnels, and this panel itself will all go down until it finishes booting back up.
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

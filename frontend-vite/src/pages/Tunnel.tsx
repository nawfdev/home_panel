import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useInterval } from "../hooks/useInterval";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { formatBytes, formatDuration } from "../lib/format";
import {
  SignalIcon,
  ChartBarIcon,
  CommandLineIcon,
  Cog6ToothIcon,
  ArrowPathIcon,
  PlayIcon,
  StopIcon,
} from "@heroicons/react/24/outline";

type Tab = "status" | "metrics" | "logs" | "settings";

interface DowntimeHistory {
  start: string;
  durationSec: number;
}

interface Downtime {
  isDown: boolean;
  currentDowntimeSec: number;
  totalDowntimeSec?: number;
  history?: DowntimeHistory[];
}

interface SystemdStatus {
  available: boolean;
  active?: boolean;
  state?: string;
  subState?: string;
  pid?: number;
  protocol?: string;
  startTime?: string;
  downtime?: Downtime;
}

interface LocalTunnelStatus {
  configured: boolean;
  cloudflared: { installed: boolean; version?: string };
  tunnel: { name?: string; tunnel_id?: string; domain?: string; local_port?: number } | null;
  processRunning: boolean;
  isReady: boolean;
  autoRestart: boolean;
  nextRetryIn: number;
  restartCount: number;
  downtime?: Downtime;
}

interface Metrics {
  activeConnections: number;
  requests: number;
  errors: number;
  connections: number;
  bytesIn: number;
  bytesOut: number;
  uptime: number;
  connectionsPerRegion: Record<string, number>;
}

interface LogEntry {
  priority?: string;
  timestamp: string;
  message?: string;
  MESSAGE?: string;
}

const TABS: { id: Tab; label: string; icon: typeof SignalIcon }[] = [
  { id: "status", label: "Status", icon: SignalIcon },
  { id: "metrics", label: "Metrics", icon: ChartBarIcon },
  { id: "logs", label: "Logs", icon: CommandLineIcon },
  { id: "settings", label: "Settings", icon: Cog6ToothIcon },
];

export function Tunnel() {
  const { show } = useToast();
  const [tab, setTab] = useState<Tab>("status");

  const [systemd, setSystemd] = useState<SystemdStatus | null>(null);
  const [local, setLocal] = useState<LocalTunnelStatus | null>(null);
  const historyRef = useRef<string[]>([]);

  async function loadStatus() {
    const systemdStatus = await api<SystemdStatus>("/tunnel/systemd/status").catch(
      () => ({ available: false }) as SystemdStatus
    );
    if (systemdStatus.available) {
      const key = `${systemdStatus.active}`;
      historyRef.current.push(key);
      if (historyRef.current.length > 3) historyRef.current.shift();
      const isStable = historyRef.current.length === 3 && historyRef.current.every((s) => s === key);
      if (historyRef.current.length < 3 || isStable) {
        setSystemd(systemdStatus);
        setLocal(null);
      }
      return;
    }
    try {
      const data = await api<LocalTunnelStatus>("/tunnel/status");
      setSystemd(null);
      setLocal(data);
    } catch (err) {
      console.error("Tunnel status error:", err);
    }
  }

  useInterval(loadStatus, 2000);
  useEffect(() => {
    loadStatus();
  }, []);

  async function runAction(fn: () => Promise<{ success?: boolean; message?: string; error?: string }>) {
    try {
      const result = await fn();
      show(result.message ?? (result.success !== false ? "Done" : result.error ?? "Failed"), result.success === false ? "error" : "success");
      loadStatus();
    } catch (err) {
      show(err instanceof Error ? err.message : "Action failed", "error");
    }
  }

  const isConfigured = systemd ? true : (local?.configured ?? true);
  const isActive = systemd ? !!systemd.active : !!(local?.processRunning && local?.isReady);
  const isStarting = !systemd && !!local?.processRunning && !local?.isReady;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Cloudflare Tunnel</h2>
          <p className="text-gray-500 text-sm mt-1">Manage the tunnel exposing this host to the internet</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {!isConfigured ? (
            <>
              <span className="metric-dot text-gray-500" />
              <span className="text-gray-500">Not configured</span>
            </>
          ) : (
            <>
              <span className={`metric-dot ${isActive ? "text-green-400" : isStarting ? "text-yellow-400" : "text-red-400"}`} />
              <span className="text-gray-300">{isActive ? "Online" : isStarting ? "Starting" : "Offline"}</span>
            </>
          )}
        </div>
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

      {tab === "status" && (
        <StatusTab
          systemd={systemd}
          local={local}
          onAction={runAction}
          onGoToSettings={() => setTab("settings")}
        />
      )}
      {tab === "metrics" && <MetricsTab />}
      {tab === "logs" && <LogsTab />}
      {tab === "settings" && <SettingsTab onAction={runAction} />}
    </div>
  );
}

function StatusTab({
  systemd,
  local,
  onAction,
  onGoToSettings,
}: {
  systemd: SystemdStatus | null;
  local: LocalTunnelStatus | null;
  onAction: (fn: () => Promise<{ success?: boolean; message?: string; error?: string }>) => void;
  onGoToSettings: () => void;
}) {
  if (local && !local.configured) {
    return (
      <Panel>
        <p className="text-sm font-medium text-gray-200">No tunnel configured on this host</p>
        <p className="text-xs text-gray-500 mt-1.5">
          {local.cloudflared.installed
            ? "cloudflared is installed but no tunnel has been created yet."
            : "cloudflared is not installed on this host, and no tunnel has been created yet."}
        </p>
        <button className="btn-secondary mt-4" onClick={onGoToSettings}>
          Go to Settings to create one
        </button>
      </Panel>
    );
  }

  if (systemd) {
    return (
      <div className="space-y-4">
        <Panel>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Systemd service</p>
              <p className="text-sm text-gray-300 mt-1">{systemd.state} ({systemd.subState}) · PID {systemd.pid ?? "N/A"}</p>
            </div>
            <span className={`status-badge ${systemd.active ? "status-online" : "status-offline"}`}>
              {systemd.active ? "Running" : "Stopped"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {systemd.active ? (
              <>
                <button className="btn-secondary" onClick={() => onAction(() => api("/tunnel/systemd/restart", { method: "POST" }))}>
                  <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Restart
                </button>
                <button className="btn-danger" onClick={() => onAction(() => api("/tunnel/systemd/stop", { method: "POST" }))}>
                  <StopIcon className="w-4 h-4 inline mr-1.5" />Stop
                </button>
              </>
            ) : (
              <button className="btn-secondary" onClick={() => onAction(() => api("/tunnel/systemd/start", { method: "POST" }))}>
                <PlayIcon className="w-4 h-4 inline mr-1.5" />Start
              </button>
            )}
          </div>
        </Panel>

        <Panel title="Protocol">
          <p className="text-xs text-gray-500 mb-3">HTTP/2 is recommended if QUIC is blocked by your ISP. Changing restarts the tunnel.</p>
          <div className="flex gap-2">
            {(["http2", "quic", "auto"] as const).map((p) => (
              <button
                key={p}
                onClick={() => onAction(() => api("/tunnel/systemd/protocol", { method: "POST", body: JSON.stringify({ protocol: p }) }))}
                className={systemd.protocol === p ? "btn-secondary !bg-white/15" : "btn-secondary"}
              >
                {p === "http2" ? "HTTP/2" : p === "quic" ? "QUIC" : "Auto"}
              </button>
            ))}
          </div>
        </Panel>

        {systemd.downtime && <DowntimePanel downtime={systemd.downtime} isActive={!!systemd.active} />}
      </div>
    );
  }

  if (local) {
    return (
      <div className="space-y-4">
        <Panel>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Cloudflared</p>
              <p className="text-sm text-gray-300 mt-1">
                {local.cloudflared.installed ? `Installed · ${local.cloudflared.version}` : "Not installed"}
              </p>
            </div>
            <span className={`status-badge ${local.isReady ? "status-online" : local.processRunning ? "bg-yellow-500/15 text-yellow-400" : "status-offline"}`}>
              {local.isReady ? "Connected" : local.processRunning ? "Starting" : local.autoRestart && local.nextRetryIn > 0 ? `Retrying in ${local.nextRetryIn}s` : "Stopped"}
            </span>
          </div>
          {local.tunnel && (
            <div className="text-sm space-y-1 mb-4">
              {local.tunnel.name && <p><span className="text-gray-500">Name:</span> {local.tunnel.name}</p>}
              {local.tunnel.domain && <p><span className="text-gray-500">Domain:</span> <code className="text-xs bg-white/5 px-1.5 py-0.5 rounded">{local.tunnel.domain}</code></p>}
              {local.tunnel.local_port && <p><span className="text-gray-500">Local port:</span> {local.tunnel.local_port}</p>}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => onAction(() => api("/tunnel/start", { method: "POST" }))}>
              <PlayIcon className="w-4 h-4 inline mr-1.5" />Start
            </button>
            <button className="btn-danger" onClick={() => onAction(() => api("/tunnel/stop", { method: "POST" }))}>
              <StopIcon className="w-4 h-4 inline mr-1.5" />Stop
            </button>
          </div>
          {local.restartCount > 0 && <p className="text-xs text-gray-500 mt-3">Restart attempts this session: {local.restartCount}</p>}
        </Panel>

        {local.downtime && <DowntimePanel downtime={local.downtime} isActive={local.isReady && local.processRunning} />}
      </div>
    );
  }

  return <p className="text-sm text-gray-500">Loading tunnel status...</p>;
}

function DowntimePanel({ downtime, isActive }: { downtime: Downtime; isActive: boolean }) {
  const statusLabel = downtime.isDown ? "Down" : isActive ? "Online" : "Not running";
  const statusColor = downtime.isDown ? "text-red-400" : isActive ? "text-green-400" : "text-gray-500";
  return (
    <Panel title="Downtime">
      <div className="grid grid-cols-2 gap-4 text-sm mb-3">
        <div>
          <p className="text-gray-500 text-xs">Current status</p>
          <p className={`${statusColor} font-semibold`}>{statusLabel}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs">Current downtime</p>
          <p className="font-mono">{downtime.isDown ? formatDuration(downtime.currentDowntimeSec) : "None"}</p>
        </div>
        {downtime.totalDowntimeSec !== undefined && (
          <div>
            <p className="text-gray-500 text-xs">Total (session)</p>
            <p className="font-mono text-yellow-400">{formatDuration(downtime.totalDowntimeSec)}</p>
          </div>
        )}
      </div>
      {downtime.history && downtime.history.length > 0 && (
        <div className="border-t border-white/7 pt-3 space-y-2 max-h-48 overflow-y-auto">
          {downtime.history.slice(-10).reverse().map((h, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-gray-500">{new Date(h.start).toLocaleString()}</span>
              <span className="text-red-400 font-mono">{formatDuration(h.durationSec)}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function MetricsTab() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>("Never");

  async function load() {
    try {
      const data = await api<{ success: boolean; metrics: Metrics }>("/tunnel/metrics");
      if (data.success && data.metrics) {
        setMetrics(data.metrics);
        setLastUpdate(new Date().toLocaleTimeString());
      }
    } catch (err) {
      console.error("Metrics error:", err);
    }
  }

  useInterval(load, 5000);
  useEffect(() => {
    load();
  }, []);

  const errorRate = metrics && metrics.requests > 0 ? ((metrics.errors / metrics.requests) * 100).toFixed(2) : "0";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel title="Ingress (incoming)">
          <p className="text-2xl font-bold font-mono text-green-400">{formatBytes(metrics?.bytesIn ?? 0)}</p>
          <p className="text-xs text-gray-500 mt-1">Data received from clients</p>
        </Panel>
        <Panel title="Egress (outgoing)">
          <p className="text-2xl font-bold font-mono text-blue-400">{formatBytes(metrics?.bytesOut ?? 0)}</p>
          <p className="text-xs text-gray-500 mt-1">Data sent to clients</p>
        </Panel>
      </div>

      <Panel title="Tunnel health">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: "Total connections", value: metrics?.connections ?? 0 },
            { label: "Total requests", value: metrics?.requests ?? 0 },
            { label: "Total errors", value: metrics?.errors ?? 0, danger: true },
            { label: "Error rate", value: `${errorRate}%` },
            { label: "Uptime", value: formatDuration(metrics?.uptime ?? 0) },
            { label: "Updated", value: lastUpdate },
          ].map((item) => (
            <div key={item.label} className="bg-white/5 rounded-lg p-3">
              <p className="text-gray-500 text-xs">{item.label}</p>
              <p className={`text-lg font-bold font-mono ${item.danger ? "text-red-400" : ""}`}>{item.value}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Connections by region">
        {metrics && Object.keys(metrics.connectionsPerRegion ?? {}).length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(metrics.connectionsPerRegion).map(([region, count]) => (
              <div key={region} className="bg-white/5 rounded-lg p-3">
                <p className="font-semibold text-sm">{region}</p>
                <p className="text-lg text-green-400 font-mono">{count}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No active connections yet</p>
        )}
      </Panel>
    </div>
  );
}

function LogsTab() {
  const [limit, setLimit] = useState(50);
  const [logs, setLogs] = useState<LogEntry[] | null>(null);

  async function load() {
    try {
      const data = await api<{ success: boolean; logs: LogEntry[] }>(`/tunnel/logs?limit=${limit}`);
      setLogs(data.success ? data.logs : []);
    } catch (err) {
      console.error("Logs error:", err);
      setLogs([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  function priorityColor(p?: string) {
    if (p === "3" || p === "err") return "text-red-400";
    if (p === "4" || p === "warning") return "text-yellow-400";
    if (p === "6" || p === "info") return "text-blue-400";
    return "text-gray-400";
  }

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex justify-between items-center mb-4">
          <h4 className="font-semibold text-sm text-gray-300">Recent logs</h4>
          <div className="flex gap-2">
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="input-field text-sm py-1.5"
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>Last {n}</option>
              ))}
            </select>
            <button className="btn-secondary" onClick={load}>
              <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
            </button>
          </div>
        </div>
        <div className="bg-black/30 rounded-lg p-4 max-h-[500px] overflow-y-auto font-mono text-xs">
          {logs === null ? (
            <p className="text-gray-500">Loading logs...</p>
          ) : logs.length === 0 ? (
            <p className="text-gray-500">No logs available</p>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={`${priorityColor(log.priority)} mb-1`}>
                <span className="text-gray-600">[{new Date(log.timestamp).toLocaleTimeString()}]</span> {log.message ?? log.MESSAGE ?? ""}
              </div>
            ))
          )}
        </div>
      </Panel>
      <Panel title="Log legend">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-gray-400">
          <div><span className="text-blue-400">●</span> Info</div>
          <div><span className="text-yellow-400">●</span> Warning</div>
          <div><span className="text-red-400">●</span> Error</div>
          <div><span className="text-gray-500">●</span> Debug</div>
        </div>
      </Panel>
    </div>
  );
}

function SettingsTab({ onAction }: { onAction: (fn: () => Promise<{ success?: boolean; message?: string; error?: string }>) => void }) {
  const { show } = useToast();
  const [autoRestart, setAutoRestart] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [port, setPort] = useState("3000");
  const [creating, setCreating] = useState(false);

  async function loadAutoRestart() {
    try {
      const data = await api<{ autoRestart?: boolean }>("/tunnel/status");
      setAutoRestart(data.autoRestart !== false);
    } catch {
      setAutoRestart(null);
    }
  }

  useEffect(() => {
    loadAutoRestart();
  }, []);

  function toggleAutoRestart() {
    const next = !(autoRestart ?? true);
    onAction(() => api("/tunnel/set-autorestart", { method: "POST", body: JSON.stringify({ enabled: next }) }));
    setTimeout(loadAutoRestart, 300);
  }

  async function createTunnel() {
    if (!name || !domain || !port) {
      show("Please fill all fields", "warning");
      return;
    }
    setCreating(true);
    try {
      const created = await api<{ tunnelId: string }>("/tunnel/create", { method: "POST", body: JSON.stringify({ name }) });
      await api("/tunnel/configure", {
        method: "POST",
        body: JSON.stringify({ tunnelId: created.tunnelId, domain, localPort: parseInt(port, 10) }),
      });
      await api("/tunnel/route", { method: "POST", body: JSON.stringify({ tunnelId: created.tunnelId, domain }) });
      show("Tunnel created and configured successfully", "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to create tunnel", "error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="Auto-restart">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Enable auto-restart</p>
            <p className="text-xs text-gray-500 mt-0.5">Automatically restart the tunnel if it crashes</p>
          </div>
          <button
            onClick={toggleAutoRestart}
            className={autoRestart ? "btn-secondary !bg-green-500/15 !text-green-400" : "btn-secondary !bg-red-500/15 !text-red-400"}
          >
            {autoRestart === null ? "Loading..." : autoRestart ? "Enabled" : "Disabled"}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-3">Backoff schedule when restarting: 5s, 10s, 30s, 60s, 5m</p>
      </Panel>

      <Panel title="Create / configure tunnel">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-gray-500 text-xs mb-1.5">Tunnel name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-field w-full" placeholder="my-tunnel" />
          </div>
          <div>
            <label className="block text-gray-500 text-xs mb-1.5">Domain</label>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} className="input-field w-full" placeholder="panel.example.com" />
          </div>
          <div>
            <label className="block text-gray-500 text-xs mb-1.5">Local port</label>
            <input type="number" value={port} onChange={(e) => setPort(e.target.value)} className="input-field w-full" />
          </div>
        </div>
        <button onClick={createTunnel} disabled={creating} className="btn-primary disabled:opacity-60">
          {creating ? "Creating..." : "Create tunnel"}
        </button>
      </Panel>
    </div>
  );
}

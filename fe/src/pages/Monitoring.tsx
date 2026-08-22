import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useInterval } from "../hooks/useInterval";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import {
  SignalIcon,
  PlusIcon,
  ArrowPathIcon,
  TrashIcon,
  PencilSquareIcon,
  BoltIcon,
  CheckCircleIcon,
  XCircleIcon,
  GlobeAltIcon,
  ArrowTopRightOnSquareIcon,
  EyeIcon,
  EyeSlashIcon,
} from "@heroicons/react/24/outline";
import type { Host } from "../lib/hosts";

type MonitorType = "http" | "tcp" | "ping";
type MonitorStatus = "up" | "down" | "pending";

interface Heartbeat {
  timestamp: number;
  status: MonitorStatus;
  latencyMs: number;
  message?: string;
}

interface Monitor {
  id: string;
  name: string;
  type: MonitorType;
  target: string;
  intervalSec: number;
  timeoutSec: number;
  status: MonitorStatus;
  latencyMs: number;
  lastChecked?: string;
  createdAt: string;
  uptime24h: number;
  uptime30d: number;
  history: Heartbeat[];
  public: boolean;
}

interface MonitorsResponse {
  success: boolean;
  monitors: Monitor[];
  upCount: number;
  downCount: number;
  total: number;
}

const emptyForm = {
  name: "",
  type: "http" as MonitorType,
  target: "",
  intervalSec: "30",
  timeoutSec: "5",
};

function HeartbeatBar({ history }: { history: Heartbeat[] }) {
  const [activeHb, setActiveHb] = useState<Heartbeat | null>(null);

  const lastHb = history && history.length > 0 ? history[history.length - 1] : null;
  const current = activeHb || lastHb;

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1.5 min-h-[22px]">
        <div className="flex items-center gap-2">
          {activeHb ? (
            <span className="flex items-center gap-1.5 bg-white/10 px-2 py-0.5 rounded-md text-gray-200 font-mono text-[10px] shadow-sm">
              <span className={`w-1.5 h-1.5 rounded-full ${activeHb.status === "up" ? "bg-emerald-400 animate-pulse" : "bg-rose-500"}`} />
              <span className="font-semibold">{activeHb.status.toUpperCase()}</span>
              <span className="text-gray-500">·</span>
              <span className="text-gray-300">{new Date(activeHb.timestamp).toLocaleString()}</span>
              {activeHb.latencyMs > 0 && (
                <>
                  <span className="text-gray-500">·</span>
                  <span className="text-blue-300">{activeHb.latencyMs.toFixed(1)}ms</span>
                </>
              )}
            </span>
          ) : (
            <span className="text-gray-500 text-[10px] uppercase font-semibold tracking-wider">30-Day Heartbeats</span>
          )}
        </div>
        <span className="text-[10px] text-gray-500 font-mono">
          {current ? `Checked ${new Date(current.timestamp).toLocaleTimeString()}` : "No history yet"}
        </span>
      </div>

      <div
        className="flex items-center gap-1 h-7 bg-black/40 rounded-lg p-1 border border-white/5 overflow-hidden"
        onMouseLeave={() => setActiveHb(null)}
      >
        {Array.from({ length: 30 }).map((_, i) => {
          const historyIdx = (history?.length || 0) - 30 + i;
          const hb = historyIdx >= 0 && history ? history[historyIdx] : null;
          const isSelected = activeHb === hb;
          return (
            <div
              key={i}
              onClick={() => hb && setActiveHb(hb)}
              onMouseEnter={() => hb && setActiveHb(hb)}
              className={`flex-1 h-full rounded-sm transition-all cursor-pointer ${
                !hb
                  ? "bg-white/5 cursor-default"
                  : hb.status === "up"
                  ? isSelected
                    ? "bg-emerald-300 ring-2 ring-emerald-400 scale-y-110"
                    : "bg-emerald-500/80 hover:bg-emerald-300 hover:scale-y-110"
                  : isSelected
                  ? "bg-rose-400 ring-2 ring-rose-500 scale-y-110"
                  : "bg-rose-500 hover:bg-rose-400 hover:scale-y-110"
              }`}
              title={
                hb
                  ? `${new Date(hb.timestamp).toLocaleString()} — ${hb.status.toUpperCase()} (${hb.latencyMs.toFixed(1)} ms)${hb.message ? " · " + hb.message : ""}`
                  : "Pending probe"
              }
            />
          );
        })}
      </div>
    </div>
  );
}

export function Monitoring() {
  const { show } = useToast();
  const [data, setData] = useState<MonitorsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [hosts, setHosts] = useState<Host[]>([]);

  // Add / Edit Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // WoL State
  const [wolMac, setWolMac] = useState("");
  const [wolBroadcast, setWolBroadcast] = useState("255.255.255.255");
  const [waking, setWaking] = useState(false);

  async function loadData() {
    try {
      const res = await api<MonitorsResponse>("/monitors");
      setData(res);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load monitors", "error");
    }
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([loadData(), api<Host[]>("/hosts").then(setHosts).catch(() => {})]).finally(() =>
      setLoading(false)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInterval(loadData, 10000);

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEdit(mon: Monitor) {
    setEditingId(mon.id);
    setForm({
      name: mon.name,
      type: mon.type,
      target: mon.target,
      intervalSec: String(mon.intervalSec),
      timeoutSec: String(mon.timeoutSec),
    });
    setModalOpen(true);
  }

  async function saveMonitor() {
    if (!form.name.trim() || !form.target.trim()) {
      show("Name and target are required", "warning");
      return;
    }
    const intervalSec = Number(form.intervalSec) || 30;
    const timeoutSec = Number(form.timeoutSec) || 5;

    setSaving(true);
    try {
      if (editingId) {
        await api(`/monitors/${editingId}`, {
          method: "PUT",
          body: JSON.stringify({
            name: form.name.trim(),
            type: form.type,
            target: form.target.trim(),
            intervalSec,
            timeoutSec,
          }),
        });
        show("Monitor updated successfully", "success");
      } else {
        await api("/monitors", {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            type: form.type,
            target: form.target.trim(),
            intervalSec,
            timeoutSec,
          }),
        });
        show("Monitor created successfully", "success");
      }
      setModalOpen(false);
      loadData();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save monitor", "error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteMonitor(id: string) {
    try {
      await api(`/monitors/${id}`, { method: "DELETE" });
      show("Monitor deleted", "success");
      loadData();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to delete monitor", "error");
    }
  }

  async function triggerCheck(id: string) {
    setCheckingId(id);
    try {
      await api(`/monitors/${id}/check`, { method: "POST" });
      show("Probe check completed", "success", 1500);
      loadData();
    } catch (err) {
      show(err instanceof Error ? err.message : "Probe check failed", "error");
    } finally {
      setCheckingId(null);
    }
  }

  async function togglePublic(mon: Monitor) {
    setTogglingId(mon.id);
    try {
      await api(`/monitors/${mon.id}/public`, {
        method: "PATCH",
        body: JSON.stringify({ public: !mon.public }),
      });
      show(mon.public ? `${mon.name} removed from public status page` : `${mon.name} is now on the public status page`, "success", 2000);
      loadData();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to update visibility", "error");
    } finally {
      setTogglingId(null);
    }
  }

  async function sendWoL(mac: string, broadcast = wolBroadcast) {
    if (!mac.trim()) {
      show("Valid MAC address required", "warning");
      return;
    }
    setWaking(true);
    try {
      const res = await api<{ success: boolean; message: string }>("/wol/wake", {
        method: "POST",
        body: JSON.stringify({ mac: mac.trim(), broadcast }),
      });
      show(res.message || "Wake-on-LAN magic packet sent", "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to send Wake-on-LAN packet", "error");
    } finally {
      setWaking(false);
    }
  }

  const monitors = data?.monitors || [];
  const publicCount = monitors.filter((m) => m.public).length;
  const avgUptime =
    monitors.length > 0
      ? monitors.reduce((acc, m) => acc + m.uptime24h, 0) / monitors.length
      : 100.0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
            <SignalIcon className="w-7 h-7 text-blue-400" />
            Health & Uptime SLA
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Real-time endpoint prober, historical 30-day uptime bars, and Wake-on-LAN
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href="/status"
            target="_blank"
            rel="noreferrer"
            className="btn-secondary flex items-center gap-1.5"
            title={publicCount === 0 ? "No monitors are public yet — toggle the eye icon below" : "Open the public status page"}
          >
            <ArrowTopRightOnSquareIcon className="w-4 h-4" />
            Public status page{publicCount > 0 ? ` (${publicCount})` : ""}
          </a>
          <button className="btn-primary flex items-center gap-1.5" onClick={openAdd}>
            <PlusIcon className="w-4 h-4" />
            Add monitor
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Overall SLA (24h)</p>
          <div className="flex items-baseline gap-2 mt-1.5">
            <span className="text-2xl font-extrabold text-emerald-400 font-mono">
              {avgUptime.toFixed(2)}%
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Average availability across all services</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Operational</p>
          <div className="flex items-center gap-2 mt-1.5">
            <CheckCircleIcon className="w-6 h-6 text-emerald-400" />
            <span className="text-2xl font-extrabold text-gray-100 font-mono">{data?.upCount ?? 0}</span>
            <span className="text-xs text-gray-500">/ {data?.total ?? 0} services</span>
          </div>
          <p className="text-[11px] text-emerald-400/80 mt-1">Passing health probes</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Down / Degraded</p>
          <div className="flex items-center gap-2 mt-1.5">
            <XCircleIcon className={`w-6 h-6 ${(data?.downCount ?? 0) > 0 ? "text-rose-400" : "text-gray-500"}`} />
            <span className={`text-2xl font-extrabold font-mono ${(data?.downCount ?? 0) > 0 ? "text-rose-400" : "text-gray-100"}`}>
              {data?.downCount ?? 0}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Requiring administrator attention</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Monitored Endpoints</p>
          <div className="flex items-center gap-2 mt-1.5">
            <GlobeAltIcon className="w-6 h-6 text-blue-400" />
            <span className="text-2xl font-extrabold text-gray-100 font-mono">{data?.total ?? 0}</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">HTTP, TCP, and ICMP Probers</p>
        </div>
      </div>

      {/* Monitors List (Uptime Kuma Style Cards) */}
      <Panel title={`Monitored services (${monitors.length})`}>
        {loading && monitors.length === 0 ? (
          <p className="text-xs text-gray-500 py-6 text-center">Loading monitor probes...</p>
        ) : monitors.length === 0 ? (
          <div className="text-center py-8 text-gray-500 space-y-2">
            <p className="text-sm">No service monitors configured yet.</p>
            <button className="btn-secondary text-xs" onClick={openAdd}>
              <PlusIcon className="w-4 h-4 inline mr-1" />
              Add your first monitor
            </button>
          </div>
        ) : (
          <div className="space-y-3.5">
            {monitors.map((m) => {
              const isUp = m.status === "up";
              const isPending = m.status === "pending";
              return (
                <div
                  key={m.id}
                  className="bg-white/5 hover:bg-white/7 border border-white/5 rounded-xl p-4 transition duration-150 space-y-3"
                >
                  {/* Top Bar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-3 h-3 rounded-full shrink-0 shadow-sm ${
                          isUp ? "bg-emerald-400 shadow-emerald-500/50" : isPending ? "bg-amber-400" : "bg-rose-500 shadow-rose-500/50 animate-pulse"
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-sm text-gray-100 truncate">{m.name}</p>
                          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30">
                            {m.type}
                          </span>
                          {m.public && (
                            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              Public
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 font-mono truncate">{m.target}</p>
                      </div>
                    </div>

                    {/* Stats & Actions */}
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right hidden sm:block">
                        <p className="text-xs font-mono font-bold text-gray-200">
                          {m.latencyMs > 0 ? `${m.latencyMs.toFixed(1)} ms` : "—"}
                        </p>
                        <p className="text-[10px] text-gray-500">Every {m.intervalSec}s</p>
                      </div>

                      <div className="text-right">
                        <span className="text-xs font-mono font-bold text-emerald-400">
                          {m.uptime24h.toFixed(1)}%
                        </span>
                        <p className="text-[10px] text-gray-500">24h SLA</p>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          className={`btn-secondary !p-1.5 ${m.public ? "text-emerald-400 hover:text-emerald-300" : "text-gray-400 hover:text-white"}`}
                          onClick={() => togglePublic(m)}
                          disabled={togglingId === m.id}
                          title={m.public ? "Showing on public status page — click to hide" : "Hidden from public status page — click to show"}
                        >
                          {m.public ? <EyeIcon className="w-3.5 h-3.5" /> : <EyeSlashIcon className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          className="btn-secondary !p-1.5 text-gray-400 hover:text-white"
                          onClick={() => triggerCheck(m.id)}
                          disabled={checkingId === m.id}
                          title="Run probe check now"
                        >
                          <ArrowPathIcon className={`w-3.5 h-3.5 ${checkingId === m.id ? "animate-spin" : ""}`} />
                        </button>
                        <button
                          className="btn-secondary !p-1.5 text-gray-400 hover:text-white"
                          onClick={() => openEdit(m)}
                          title="Edit monitor"
                        >
                          <PencilSquareIcon className="w-3.5 h-3.5" />
                        </button>
                        <button
                          className="btn-danger !p-1.5 text-gray-400 hover:text-red-400"
                          onClick={() => deleteMonitor(m.id)}
                          title="Delete monitor"
                        >
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Heartbeat Status Bar (Uptime Kuma Style Interactive Pills) */}
                  <HeartbeatBar history={m.history || []} />
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Wake-on-LAN (WoL) Panel */}
      <Panel title="Wake-on-LAN (Magic Packet Transmitter)">
        <p className="text-xs text-gray-500 mb-4">
          Send a UDP magic packet to power on sleeping PCs, laptops, or workstations on your local area network.
        </p>

        {/* Quick Wake Saved Hosts */}
        {hosts.length > 0 && (
          <div className="mb-5 pb-5 border-b border-white/10">
            <p className="text-xs font-semibold text-gray-300 mb-2.5">Quick wake saved remote hosts:</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {hosts.map((h) => (
                <button
                  key={h.id}
                  onClick={() => sendWoL("", h.address)}
                  disabled={waking}
                  className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-3 text-left transition flex items-center justify-between group disabled:opacity-60"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-200 truncate">{h.name}</p>
                    <p className="text-[10px] text-gray-500 font-mono truncate">{h.address}</p>
                  </div>
                  <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 group-hover:bg-blue-500/20 transition shrink-0">
                    <BoltIcon className="w-4 h-4" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom MAC Wake Form */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-gray-400 text-xs font-semibold mb-1">Target MAC Address</label>
            <input
              value={wolMac}
              onChange={(e) => setWolMac(e.target.value)}
              placeholder="AA:BB:CC:DD:EE:FF"
              className="input-field w-full font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-gray-400 text-xs font-semibold mb-1">Broadcast IP / Subnet</label>
            <input
              value={wolBroadcast}
              onChange={(e) => setWolBroadcast(e.target.value)}
              placeholder="255.255.255.255"
              className="input-field w-full font-mono text-xs"
            />
          </div>
          <div className="flex items-end">
            <button
              className="btn-primary w-full text-xs !py-2.5 disabled:opacity-60 flex items-center justify-center gap-1.5"
              onClick={() => sendWoL(wolMac)}
              disabled={waking || !wolMac.trim()}
            >
              <BoltIcon className="w-4 h-4" />
              {waking ? "Broadcasting..." : "Send Magic Packet"}
            </button>
          </div>
        </div>
      </Panel>

      {/* Add / Edit Monitor Modal */}
      {modalOpen && (
        <Modal
          title={editingId ? "Edit service monitor" : "Add new service monitor"}
          onClose={() => !saving && setModalOpen(false)}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-gray-400 text-xs font-semibold mb-1">Service name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. AdGuard Home, Pi-hole, Home Assistant"
                className="input-field w-full text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-400 text-xs font-semibold mb-1">Probe type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as MonitorType }))}
                  className="input-field w-full text-xs"
                >
                  <option value="http">HTTP / HTTPS</option>
                  <option value="tcp">TCP Port</option>
                  <option value="ping">Ping / Socket</option>
                </select>
              </div>

              <div>
                <label className="block text-gray-400 text-xs font-semibold mb-1">Check interval</label>
                <select
                  value={form.intervalSec}
                  onChange={(e) => setForm((f) => ({ ...f, intervalSec: e.target.value }))}
                  className="input-field w-full text-xs font-mono"
                >
                  <option value="10">Every 10 seconds</option>
                  <option value="30">Every 30 seconds</option>
                  <option value="60">Every 1 minute</option>
                  <option value="300">Every 5 minutes</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-gray-400 text-xs font-semibold mb-1">
                Target endpoint {form.type === "http" ? "(URL)" : "(host:port)"}
              </label>
              <input
                value={form.target}
                onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
                placeholder={
                  form.type === "http" ? "http://192.168.1.1:8080" : "192.168.1.50:53"
                }
                className="input-field w-full text-xs font-mono"
              />
            </div>
          </div>

          <div className="flex gap-2 mt-6">
            <button
              className="btn-primary flex-1 text-xs disabled:opacity-60"
              onClick={saveMonitor}
              disabled={saving}
            >
              {saving ? "Saving..." : editingId ? "Update monitor" : "Create monitor"}
            </button>
            <button
              className="btn-secondary flex-1 text-xs"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

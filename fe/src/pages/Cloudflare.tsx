import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import {
  CloudIcon,
  GlobeAltIcon,
  ArrowPathIcon,
  EyeIcon,
  TrashIcon,
  PlusIcon,
  PencilIcon,
} from "@heroicons/react/24/outline";

interface CfStatus {
  configured: boolean;
  connected: boolean;
  error?: string;
  accountId?: string;
}

interface CfTunnel {
  id: string;
  name: string;
  status: string;
  created_at: string;
  conns_active: number;
}

interface CfZone {
  id: string;
  name: string;
  status: string;
}

interface CfConnection {
  id: string;
  colo_name?: string;
  client_id?: string;
  opened_at: string;
  is_pending_reconnect?: boolean;
}

interface CfTunnelDetail {
  id: string;
  name: string;
  status: string;
  connections: CfConnection[] | null;
  remote_config: boolean;
}

interface IngressRoute {
  hostname?: string;
  service: string;
  path?: string;
}

interface TunnelConfig {
  ingress: IngressRoute[];
}

function statusBadgeClass(status: string) {
  if (status === "healthy") return "bg-green-500/15 text-green-400";
  if (status === "degraded") return "bg-yellow-500/15 text-yellow-400";
  return "bg-red-500/15 text-red-400";
}

export function Cloudflare() {
  const { show } = useToast();
  const [status, setStatus] = useState<CfStatus | null>(null);
  const [tunnels, setTunnels] = useState<CfTunnel[] | null>(null);
  const [tunnelsError, setTunnelsError] = useState<string | null>(null);
  const [zones, setZones] = useState<CfZone[] | null>(null);
  const [zonesError, setZonesError] = useState<string | null>(null);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  async function loadStatus() {
    try {
      const data = await api<CfStatus>("/cloudflare/status");
      setStatus(data);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load status", "error");
    }
  }

  async function loadTunnels() {
    try {
      const data = await api<{ success: boolean; tunnels: CfTunnel[]; error?: string }>("/cloudflare/tunnels");
      if (!data.success) {
        setTunnelsError(data.error ?? "Could not load tunnels");
        setTunnels([]);
        return;
      }
      setTunnelsError(null);
      setTunnels(data.tunnels ?? []);
    } catch (err) {
      setTunnelsError(err instanceof Error ? err.message : "Could not load tunnels");
      setTunnels([]);
    }
  }

  async function loadZones() {
    try {
      const data = await api<{ success: boolean; zones: CfZone[]; error?: string }>("/cloudflare/zones");
      if (!data.success) {
        setZonesError(data.error ?? "Could not load zones");
        setZones([]);
        return;
      }
      setZonesError(null);
      setZones(data.zones ?? []);
    } catch (err) {
      setZonesError(err instanceof Error ? err.message : "Could not load zones");
      setZones([]);
    }
  }

  function loadAll() {
    loadStatus();
    loadTunnels();
    loadZones();
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deleteTunnel() {
    if (!deleteTarget) return;
    try {
      const data = await api<{ success: boolean; error?: string }>(`/cloudflare/tunnels/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (data.success) {
        show("Tunnel deleted", "success");
        loadTunnels();
      } else {
        show(data.error ?? "Failed to delete tunnel", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to delete tunnel", "error");
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Cloudflare</h2>
          <p className="text-gray-500 text-sm mt-1">Tunnels and zones managed via the Cloudflare API</p>
        </div>
        <button className="btn-secondary" onClick={loadAll}>
          <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
        </button>
      </div>

      <div className="space-y-4">
        <Panel title="API connection" icon={CloudIcon}>
          {status === null ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : !status.configured ? (
            <p className="text-sm text-gray-500">
              Not configured. Add your Cloudflare API Token in Settings to enable this page.
            </p>
          ) : status.connected ? (
            <div className="info-row">
              <span className="info-row-label">Status</span>
              <span className="info-row-value text-green-400">Connected</span>
            </div>
          ) : (
            <div className="info-row">
              <span className="info-row-label">Status</span>
              <span className="info-row-value text-red-400">
                Disconnected{status.error ? ` — ${status.error}` : " — token invalid or revoked"}
              </span>
            </div>
          )}
          {status?.configured && (
            <div className="info-row">
              <span className="info-row-label">Account ID</span>
              <span className="info-row-value font-mono">{status.accountId || "Auto-detect"}</span>
            </div>
          )}
        </Panel>

        <Panel title={`Tunnels${tunnels ? ` (${tunnels.length})` : ""}`}>
          {tunnels === null ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : tunnelsError ? (
            <p className="text-sm text-yellow-400">{tunnelsError}</p>
          ) : tunnels.length === 0 ? (
            <p className="text-sm text-gray-500">No tunnels found</p>
          ) : (
            <div className="space-y-2">
              {tunnels.map((t) => (
                <div key={t.id} className="bg-white/5 rounded-lg p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm text-gray-100 truncate">{t.name}</span>
                      <span className={`status-badge ${statusBadgeClass(t.status)}`}>{t.status}</span>
                    </div>
                    <p className="text-xs text-gray-500 font-mono truncate">{t.id}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Connections: {t.conns_active || 0}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button className="btn-secondary" onClick={() => setDetailId(t.id)}>
                      <EyeIcon className="w-4 h-4 inline mr-1.5" />Detail
                    </button>
                    <button className="btn-danger" onClick={() => setDeleteTarget({ id: t.id, name: t.name })}>
                      <TrashIcon className="w-4 h-4 inline mr-1.5" />Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Zones" icon={GlobeAltIcon}>
          {zones === null ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : zonesError ? (
            <p className="text-sm text-yellow-400">{zonesError}</p>
          ) : zones.length === 0 ? (
            <p className="text-sm text-gray-500">No zones found</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {zones.map((z) => (
                <div key={z.id} className="bg-white/5 rounded-lg p-3">
                  <p className="font-semibold text-sm text-gray-100 truncate">{z.name}</p>
                  <p className={`text-xs mt-1 ${z.status === "active" ? "text-green-400" : "text-yellow-400"}`}>
                    {z.status}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {detailId && (
        <TunnelDetailModal
          tunnelId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={loadTunnels}
        />
      )}

      {deleteTarget && (
        <Modal title="Delete tunnel" onClose={() => setDeleteTarget(null)}>
          <p className="text-sm text-gray-300">
            Delete tunnel <span className="font-semibold text-gray-100">{deleteTarget.name}</span>? This cannot be
            undone.
          </p>
          <div className="flex gap-2 mt-5">
            <button className="btn-danger flex-1" onClick={deleteTunnel}>
              Delete
            </button>
            <button className="btn-secondary flex-1" onClick={() => setDeleteTarget(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TunnelDetailModal({
  tunnelId,
  onClose,
  onChanged,
}: {
  tunnelId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { show } = useToast();
  const [tunnel, setTunnel] = useState<CfTunnelDetail | null>(null);
  const [config, setConfig] = useState<TunnelConfig | null>(null);
  const [routeModal, setRouteModal] = useState<{ mode: "add" | "edit"; index?: number } | null>(null);

  async function load() {
    try {
      const [tunnelRes, configRes] = await Promise.all([
        api<{ success: boolean; tunnel: CfTunnelDetail; error?: string }>(`/cloudflare/tunnels/${tunnelId}`),
        api<{ success: boolean; config: TunnelConfig }>(`/cloudflare/tunnels/${tunnelId}/config`),
      ]);
      if (!tunnelRes.success) {
        show(tunnelRes.error ?? "Failed to load tunnel", "error");
        onClose();
        return;
      }
      setTunnel(tunnelRes.tunnel);
      setConfig(configRes.config ?? { ingress: [] });
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load tunnel", "error");
      onClose();
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tunnelId]);

  async function saveConfig(nextIngress: IngressRoute[]) {
    try {
      const data = await api<{ success: boolean; config: TunnelConfig; error?: string }>(
        `/cloudflare/tunnels/${tunnelId}/config`,
        { method: "PUT", body: JSON.stringify({ config: { ingress: nextIngress } }) }
      );
      if (!data.success) {
        show(data.error ?? "Failed to update config", "error");
        return;
      }
      show("Route saved", "success");
      setConfig(data.config);
      setRouteModal(null);
      onChanged();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to update config", "error");
    }
  }

  if (!tunnel || !config) {
    return (
      <Modal title="Tunnel" onClose={onClose}>
        <p className="text-sm text-gray-500">Loading...</p>
      </Modal>
    );
  }

  const connections = tunnel.connections ?? [];
  const ingress = config.ingress ?? [];

  return (
    <>
      <Modal title={tunnel.name} onClose={onClose} wide>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-white/5 rounded-lg p-3">
            <p className="text-gray-500 text-xs">Status</p>
            <p className={`font-semibold text-sm mt-0.5 ${tunnel.status === "healthy" ? "text-green-400" : "text-yellow-400"}`}>
              {tunnel.status}
            </p>
          </div>
          <div className="bg-white/5 rounded-lg p-3">
            <p className="text-gray-500 text-xs">Config type</p>
            <p className="font-semibold text-sm mt-0.5 text-gray-100">
              {tunnel.remote_config ? "Remote (dashboard)" : "Local (config.yml)"}
            </p>
          </div>
        </div>
        <div className="bg-white/5 rounded-lg p-3 mb-4">
          <p className="text-gray-500 text-xs mb-1">Tunnel ID</p>
          <code className="text-xs font-mono text-gray-300 break-all">{tunnel.id}</code>
        </div>

        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-300">Routes ({ingress.length})</h4>
          {tunnel.remote_config && (
            <button className="btn-secondary" onClick={() => setRouteModal({ mode: "add" })}>
              <PlusIcon className="w-4 h-4 inline mr-1.5" />Add route
            </button>
          )}
        </div>
        <div className="space-y-2 mb-5">
          {ingress.length === 0 ? (
            <p className="text-sm text-gray-500">No routes configured (using local config.yml)</p>
          ) : (
            ingress.map((r, i) => (
              <div key={i} className="bg-white/5 rounded-lg p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-100 truncate">{r.hostname ?? "catch-all"}</p>
                  <p className="text-xs text-gray-500 truncate">&rarr; {r.service}</p>
                </div>
                {r.hostname ? (
                  <button className="btn-secondary shrink-0" onClick={() => setRouteModal({ mode: "edit", index: i })}>
                    <PencilIcon className="w-4 h-4" />
                  </button>
                ) : (
                  <span className="text-xs text-gray-500 shrink-0">Default</span>
                )}
              </div>
            ))
          )}
        </div>

        <h4 className="text-sm font-semibold text-gray-300 mb-2">Connections ({connections.length})</h4>
        <div className="space-y-2">
          {connections.length === 0 ? (
            <p className="text-sm text-gray-500">No active connections</p>
          ) : (
            connections.map((c) => (
              <div key={c.id} className="bg-white/5 rounded-lg p-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-100">{c.colo_name || "Unknown"}</span>
                  <span className={`text-xs ${c.is_pending_reconnect ? "text-yellow-400" : "text-green-400"}`}>
                    {c.is_pending_reconnect ? "Reconnecting" : "Connected"}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">Client: {c.client_id ?? "N/A"}</p>
                <p className="text-xs text-gray-500">Opened: {new Date(c.opened_at).toLocaleString()}</p>
              </div>
            ))
          )}
        </div>
      </Modal>

      {routeModal && (
        <RouteFormModal
          mode={routeModal.mode}
          route={routeModal.index !== undefined ? ingress[routeModal.index] : undefined}
          onClose={() => setRouteModal(null)}
          onSave={(hostname, service) => {
            const next = [...ingress];
            if (routeModal.mode === "edit" && routeModal.index !== undefined) {
              next[routeModal.index] = { ...next[routeModal.index], service };
            } else {
              const newRoute: IngressRoute = { hostname, service };
              if (next.length > 0) {
                next.splice(next.length - 1, 0, newRoute);
              } else {
                next.push(newRoute, { service: "http_status:404" });
              }
            }
            saveConfig(next);
          }}
        />
      )}
    </>
  );
}

function RouteFormModal({
  mode,
  route,
  onClose,
  onSave,
}: {
  mode: "add" | "edit";
  route?: IngressRoute;
  onClose: () => void;
  onSave: (hostname: string, service: string) => void;
}) {
  const { show } = useToast();
  const [hostname, setHostname] = useState(route?.hostname ?? "");
  const [service, setService] = useState(route?.service ?? "");

  function submit() {
    if (mode === "add" && (!hostname || !service)) {
      show("Both hostname and service URL are required", "warning");
      return;
    }
    if (mode === "edit" && !service) {
      show("Service URL is required", "warning");
      return;
    }
    onSave(hostname, service);
  }

  return (
    <Modal title={mode === "add" ? "Add route" : "Edit route"} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-gray-500 text-xs mb-1.5">Hostname</label>
          <input
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            disabled={mode === "edit"}
            placeholder="app.example.com"
            className="input-field w-full disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-gray-500 text-xs mb-1.5">Service URL</label>
          <input
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="http://localhost:3000"
            className="input-field w-full"
          />
        </div>
      </div>
      <div className="flex gap-2 mt-5">
        <button className="btn-primary flex-1" onClick={submit}>
          {mode === "add" ? "Add route" : "Save"}
        </button>
        <button className="btn-secondary flex-1" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

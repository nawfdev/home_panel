import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useInterval } from "../hooks/useInterval";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { formatBytes } from "../lib/format";
import { ArrowPathIcon, GlobeAltIcon, CloudIcon, ServerIcon } from "@heroicons/react/24/outline";

interface NetInterface {
  name: string;
  ip4?: string | null;
  ip6?: string | null;
  mac?: string | null;
}

interface NetStat {
  interface: string;
  rx_bytes: number;
  tx_bytes: number;
  rx_sec: number;
  tx_sec: number;
}

interface CloudflareInfo {
  domain?: string;
  tunnelId?: string;
  status: string;
}

interface NetworkInfo {
  publicIp: string;
  interfaces: NetInterface[];
  stats: NetStat[];
  cloudflare: CloudflareInfo | null;
  connectivity: boolean;
  dns: string[];
  gateway: string;
}

export function Network() {
  const { show } = useToast();
  const [info, setInfo] = useState<NetworkInfo | null>(null);

  async function load() {
    try {
      const data = await api<{ success: boolean; network: NetworkInfo }>("/network/info");
      setInfo(data.network);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load network info", "error");
    }
  }

  useInterval(load, 10000);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Network</h2>
          <p className="text-gray-500 text-sm mt-1">Connectivity, interfaces, and traffic on this host</p>
        </div>
        <button className="btn-secondary" onClick={load}>
          <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
        </button>
      </div>

      <div className="space-y-4">
        <Panel title="Overview" icon={GlobeAltIcon}>
          <div className="info-row">
            <span className="info-row-label">Public IP</span>
            <span className="info-row-value font-mono">{info?.publicIp ?? "Loading..."}</span>
          </div>
          <div className="info-row">
            <span className="info-row-label">Connectivity</span>
            <span className={`info-row-value ${info?.connectivity ? "text-green-400" : "text-red-400"}`}>
              {info === null ? "Loading..." : info.connectivity ? "Internet connected" : "No internet"}
            </span>
          </div>
        </Panel>

        <Panel title="Cloudflare tunnel" icon={CloudIcon}>
          {info?.cloudflare ? (
            <>
              <div className="info-row">
                <span className="info-row-label">Status</span>
                <span
                  className={`info-row-value ${info.cloudflare.status === "running" ? "text-green-400" : "text-red-400"}`}
                >
                  {info.cloudflare.status === "running" ? "Running" : "Stopped"}
                </span>
              </div>
              <div className="info-row">
                <span className="info-row-label">Domain</span>
                <span className="info-row-value font-mono">{info.cloudflare.domain || "Not configured"}</span>
              </div>
              <div className="info-row">
                <span className="info-row-label">Tunnel ID</span>
                <span className="info-row-value font-mono">{info.cloudflare.tunnelId || "N/A"}</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">
              Tunnel not configured. Set one up on the Tunnel page to expose this host.
            </p>
          )}
        </Panel>

        <Panel title="Local interfaces" icon={ServerIcon}>
          {info === null ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : info.interfaces.length === 0 ? (
            <p className="text-sm text-gray-500">No interfaces found</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {info.interfaces.map((iface) => (
                <div key={iface.name} className="bg-white/5 rounded-lg p-3">
                  <p className="font-semibold text-sm text-gray-100 mb-2">{iface.name}</p>
                  <div className="space-y-1 text-xs text-gray-400">
                    {iface.ip4 && (
                      <p>
                        IPv4: <span className="font-mono text-gray-300">{iface.ip4}</span>
                      </p>
                    )}
                    {iface.ip6 && (
                      <p>
                        IPv6: <span className="font-mono text-gray-300">{iface.ip6}</span>
                      </p>
                    )}
                    {iface.mac && (
                      <p>
                        MAC: <span className="font-mono text-gray-300">{iface.mac}</span>
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="DNS & gateway">
          {info === null ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : !info.gateway && info.dns.length === 0 ? (
            <p className="text-sm text-gray-500">Information not available</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {info.gateway && (
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-xs mb-1">Gateway</p>
                  <p className="font-mono text-sm text-gray-100">{info.gateway}</p>
                </div>
              )}
              {info.dns.length > 0 && (
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-gray-500 text-xs mb-1">DNS servers</p>
                  {info.dns.map((dns) => (
                    <p key={dns} className="font-mono text-sm text-gray-100">
                      {dns}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Traffic">
          {info === null ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : info.stats.length === 0 ? (
            <p className="text-sm text-gray-500">No statistics available</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {info.stats.map((stat) => (
                <div key={stat.interface} className="bg-white/5 rounded-lg p-4">
                  <p className="font-semibold text-sm text-gray-100 mb-3">{stat.interface}</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Download</span>
                      <span className="font-mono">{formatBytes(stat.rx_bytes)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Upload</span>
                      <span className="font-mono">{formatBytes(stat.tx_bytes)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">DL speed</span>
                      <span className="font-mono text-green-400">{formatBytes(stat.rx_sec)}/s</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">UP speed</span>
                      <span className="font-mono text-blue-400">{formatBytes(stat.tx_sec)}/s</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { formatBytes } from "../lib/format";
import {
  CircleStackIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  FireIcon,
  ChevronDownIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import type { Host } from "../lib/hosts";

type DriveType = "NVMe" | "SATA SSD" | "HDD" | "eMMC/SD" | "Storage";

interface SmartAttribute {
  id: number;
  name: string;
  value: number;
  worst: number;
  threshold: number;
  rawValue: string;
  failed: boolean;
}

interface DiskInfo {
  device: string;
  model: string;
  serial: string;
  type: DriveType;
  sizeBytes: number;
  health: string;
  temperature: number;
  powerOnHours: number;
  powerCycles: number;
  wearLevelPercent?: number;
  totalWrittenTB?: number;
  badSectors: number;
  rotationRate: number;
  attributes?: SmartAttribute[];
}

interface StorageOverview {
  hostId: number;
  hostName: string;
  totalDisks: number;
  healthyDisks: number;
  warningDisks: number;
  totalCapacity: number;
  avgTemp: number;
  disks: DiskInfo[];
}

export function Storage() {
  const { show } = useToast();
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [hostId, setHostId] = useState(0);
  const [expandedAttrs, setExpandedAttrs] = useState<Record<string, boolean>>({});

  async function loadData(targetHostId = hostId) {
    setLoading(true);
    try {
      const res = await api<{ success: boolean; overview: StorageOverview }>(
        `/storage/disks?host=${targetHostId}`
      );
      if (res && res.overview) {
        setOverview(res.overview);
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load disk health", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api<Host[]>("/hosts").then((res) => setHosts(res || [])).catch(() => setHosts([]));
  }, []);

  useEffect(() => {
    loadData(hostId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId]);

  function toggleAttrs(device: string) {
    setExpandedAttrs((prev) => ({ ...prev, [device]: !prev[device] }));
  }

  const disks = overview?.disks || [];

  return (
    <div className="space-y-6">
      {/* Header & Host Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
            <CircleStackIcon className="w-7 h-7 text-blue-400" />
            Storage & S.M.A.R.T. Health
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Drive wear-level endurance, bad sector detection, and temperature monitoring
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={hostId}
            onChange={(e) => setHostId(Number(e.target.value))}
            className="input-field text-sm min-w-44"
            aria-label="Storage host"
          >
            <option value={0}>Local panel</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <button className="btn-secondary shrink-0 text-xs" onClick={() => loadData(hostId)} disabled={loading}>
            <ArrowPathIcon className={`w-4 h-4 inline mr-1 ${loading ? "animate-spin" : ""}`} />
            Scan drives
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Storage Capacity</p>
          <div className="flex items-baseline gap-2 mt-1.5">
            <span className="text-2xl font-extrabold text-blue-400 font-mono">
              {overview ? formatBytes(overview.totalCapacity) : "—"}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">{overview?.totalDisks ?? 0} connected block drive(s)</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Drive Health</p>
          <div className="flex items-center gap-2 mt-1.5">
            <CheckCircleIcon className="w-6 h-6 text-emerald-400" />
            <span className="text-2xl font-extrabold text-gray-100 font-mono">{overview?.healthyDisks ?? 0}</span>
            <span className="text-xs text-gray-500">/ {overview?.totalDisks ?? 0} PASSED</span>
          </div>
          <p className="text-[11px] text-emerald-400/80 mt-1">S.M.A.R.T. self-test verified</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Warnings / Bad Sectors</p>
          <div className="flex items-center gap-2 mt-1.5">
            <ExclamationTriangleIcon
              className={`w-6 h-6 ${(overview?.warningDisks ?? 0) > 0 ? "text-amber-400" : "text-gray-500"}`}
            />
            <span
              className={`text-2xl font-extrabold font-mono ${
                (overview?.warningDisks ?? 0) > 0 ? "text-amber-400" : "text-gray-100"
              }`}
            >
              {overview?.warningDisks ?? 0}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Reallocated sectors or endurance alerts</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Average Temperature</p>
          <div className="flex items-center gap-2 mt-1.5">
            <FireIcon className="w-6 h-6 text-amber-400" />
            <span className="text-2xl font-extrabold text-gray-100 font-mono">
              {(overview?.avgTemp ?? 0) > 0 ? `${overview?.avgTemp}°C` : "N/A"}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Operating drive thermal status</p>
        </div>
      </div>

      {/* Disks List */}
      <Panel title={`Connected Storage Drives (${disks.length})`}>
        {loading && disks.length === 0 ? (
          <p className="text-xs text-gray-500 py-6 text-center">Scanning storage drives and S.M.A.R.T. metrics...</p>
        ) : disks.length === 0 ? (
          <p className="text-xs text-gray-500 py-6 text-center">No storage block devices discovered on this host.</p>
        ) : (
          <div className="space-y-4">
            {disks.map((d) => {
              const isPassed = d.health === "PASSED";
              const isAttrsOpen = !!expandedAttrs[d.device];
              return (
                <div
                  key={d.device}
                  className="bg-white/5 border border-white/5 rounded-xl p-4.5 space-y-4 hover:bg-white/7 transition"
                >
                  {/* Drive Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span
                          className={`w-3 h-3 rounded-full shrink-0 ${
                            isPassed ? "bg-emerald-400 shadow-emerald-500/50" : "bg-amber-400 animate-pulse"
                          }`}
                        />
                        <h3 className="font-bold text-sm text-gray-100">{d.model}</h3>
                        <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30 font-semibold">
                          {d.type}
                        </span>
                        {d.rotationRate > 0 && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/5 text-gray-400">
                            {d.rotationRate} RPM
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 font-mono mt-1">
                        Device: <span className="text-gray-300">{d.device}</span>
                        {d.serial && <> &middot; Serial: <span className="text-gray-300">{d.serial}</span></>}
                        {d.sizeBytes > 0 && <> &middot; Capacity: <span className="text-blue-300 font-bold">{formatBytes(d.sizeBytes)}</span></>}
                      </p>
                    </div>

                    {/* Status Badges */}
                    <div className="flex items-center gap-2 shrink-0">
                      {d.temperature > 0 && (
                        <span
                          className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 ${
                            d.temperature > 55
                              ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                              : d.temperature > 45
                              ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                              : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          }`}
                        >
                          <FireIcon className="w-3.5 h-3.5" />
                          {d.temperature}°C
                        </span>
                      )}

                      <span
                        className={`text-xs font-bold px-3 py-1 rounded-lg uppercase tracking-wider flex items-center gap-1 ${
                          isPassed
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                            : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                        }`}
                      >
                        <ShieldCheckIcon className="w-4 h-4" />
                        {d.health}
                      </span>
                    </div>
                  </div>

                  {/* Drive Health Telemetry Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-black/20 p-3 rounded-xl font-mono">
                    <div>
                      <p className="text-gray-500 text-[10px]">POWER ON TIME</p>
                      <p className="text-gray-200 font-semibold mt-0.5">
                        {d.powerOnHours > 0 ? (
                          <>
                            {Math.floor(d.powerOnHours / 24)}d {d.powerOnHours % 24}h{" "}
                            <span className="text-gray-500 text-[10px]">({d.powerOnHours}h)</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </p>
                    </div>

                    <div>
                      <p className="text-gray-500 text-[10px]">POWER CYCLES</p>
                      <p className="text-gray-200 font-semibold mt-0.5">{d.powerCycles > 0 ? `${d.powerCycles} cycles` : "—"}</p>
                    </div>

                    <div>
                      <p className="text-gray-500 text-[10px]">REALLOCATED / BAD SECTORS</p>
                      <p className={`font-semibold mt-0.5 ${d.badSectors > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                        {d.badSectors} sectors
                      </p>
                    </div>

                    <div>
                      <p className="text-gray-500 text-[10px]">TOTAL WRITTEN (TBW)</p>
                      <p className="text-gray-200 font-semibold mt-0.5">
                        {d.totalWrittenTB != null ? `${d.totalWrittenTB.toFixed(2)} TB` : "—"}
                      </p>
                    </div>
                  </div>

                  {/* Wear Level Progress Bar (for SSD / NVMe) */}
                  {d.wearLevelPercent != null && (
                    <div className="space-y-1.5 bg-black/20 p-3 rounded-xl border border-white/5">
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-gray-400">SSD Remaining Endurance (Wear Level)</span>
                        <span className="text-emerald-400 font-bold">{d.wearLevelPercent}% Health</span>
                      </div>
                      <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            d.wearLevelPercent < 20
                              ? "bg-rose-500"
                              : d.wearLevelPercent < 50
                              ? "bg-amber-500"
                              : "bg-emerald-400"
                          }`}
                          style={{ width: `${d.wearLevelPercent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* SMART Attributes Toggle */}
                  {d.attributes && d.attributes.length > 0 && (
                    <div className="pt-2">
                      <button
                        onClick={() => toggleAttrs(d.device)}
                        className="text-xs font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1 transition"
                      >
                        <ChevronDownIcon
                          className={`w-3.5 h-3.5 transition-transform ${isAttrsOpen ? "rotate-180" : ""}`}
                        />
                        <span>{isAttrsOpen ? "Hide" : "View"} {d.attributes.length} SMART diagnostic attributes</span>
                      </button>

                      {isAttrsOpen && (
                        <div className="mt-3 overflow-x-auto border border-white/10 rounded-xl bg-black/40">
                          <table className="w-full text-xs font-mono">
                            <thead>
                              <tr className="text-left text-gray-500 border-b border-white/10 bg-white/5">
                                <th className="p-2.5">ID</th>
                                <th className="p-2.5">Attribute Name</th>
                                <th className="p-2.5">Value</th>
                                <th className="p-2.5">Worst</th>
                                <th className="p-2.5">Thresh</th>
                                <th className="p-2.5">Raw Value</th>
                                <th className="p-2.5">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {d.attributes.map((a) => (
                                <tr key={a.id} className="border-t border-white/5 hover:bg-white/5">
                                  <td className="p-2.5 text-gray-400">{a.id}</td>
                                  <td className="p-2.5 font-semibold text-gray-200">{a.name}</td>
                                  <td className="p-2.5 text-gray-300">{a.value}</td>
                                  <td className="p-2.5 text-gray-400">{a.worst}</td>
                                  <td className="p-2.5 text-gray-500">{a.threshold}</td>
                                  <td className="p-2.5 text-blue-300 font-bold">{a.rawValue}</td>
                                  <td className="p-2.5">
                                    <span
                                      className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                        a.failed ? "bg-rose-500/20 text-rose-400" : "text-emerald-400"
                                      }`}
                                    >
                                      {a.failed ? "FAILED" : "OK"}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

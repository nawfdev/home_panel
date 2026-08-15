import { useEffect, useState } from "react";
import { ServerIcon, CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon } from "@heroicons/react/24/outline";

type PublicMonitorStatus = "up" | "down" | "pending";

interface PublicHeartbeat {
  timestamp: number;
  status: PublicMonitorStatus;
}

interface PublicMonitor {
  id: string;
  name: string;
  type: string;
  status: PublicMonitorStatus;
  latencyMs: number;
  lastChecked?: string;
  uptime24h: number;
  uptime30d: number;
  history: PublicHeartbeat[];
}

interface PublicStatusResponse {
  success: boolean;
  overall: "operational" | "degraded" | "outage";
  monitors: PublicMonitor[];
  upCount: number;
  downCount: number;
  total: number;
}

const OVERALL_COPY: Record<PublicStatusResponse["overall"], { label: string; className: string }> = {
  operational: { label: "All Systems Operational", className: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" },
  degraded: { label: "Partial Service Disruption", className: "bg-amber-500/10 border-amber-500/30 text-amber-300" },
  outage: { label: "Major Service Outage", className: "bg-rose-500/10 border-rose-500/30 text-rose-300" },
};

export function Status() {
  const [data, setData] = useState<PublicStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/status/public");
      if (!res.ok) throw new Error("Unable to reach status service");
      const body = (await res.json()) as PublicStatusResponse;
      setData(body);
      setError(null);
      setLastFetched(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load status");
    }
  }

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const overall = data?.overall ?? "operational";
  const overallCopy = OVERALL_COPY[overall];
  const monitors = data?.monitors ?? [];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 px-4 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="brand-mark">
            <ServerIcon />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Nestcore Status</h1>
            <p className="text-sm text-gray-500">Live service availability</p>
          </div>
        </div>

        {error ? (
          <div className="border border-rose-500/30 bg-rose-500/10 text-rose-300 rounded-xl p-4 text-sm">{error}</div>
        ) : (
          <div className={`flex items-center gap-3 border rounded-xl p-4 ${overallCopy.className}`}>
            {overall === "operational" ? (
              <CheckCircleIcon className="w-6 h-6 shrink-0" />
            ) : overall === "degraded" ? (
              <ExclamationTriangleIcon className="w-6 h-6 shrink-0" />
            ) : (
              <XCircleIcon className="w-6 h-6 shrink-0" />
            )}
            <div>
              <p className="font-semibold text-sm">{overallCopy.label}</p>
              {data && (
                <p className="text-xs opacity-80 mt-0.5">
                  {data.upCount} of {data.total} monitored services operational
                </p>
              )}
            </div>
          </div>
        )}

        {data && monitors.length === 0 && !error && (
          <div className="border border-white/10 bg-white/5 rounded-xl p-8 text-center text-sm text-gray-500">
            No public status information is available right now.
          </div>
        )}

        <div className="space-y-3">
          {monitors.map((m) => {
            const isUp = m.status === "up";
            const isPending = m.status === "pending";
            return (
              <div key={m.id} className="border border-white/10 bg-white/5 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        isUp ? "bg-emerald-400" : isPending ? "bg-amber-400" : "bg-rose-500 animate-pulse"
                      }`}
                    />
                    <p className="font-semibold text-sm truncate">{m.name}</p>
                  </div>
                  <span className="text-xs font-mono text-gray-400 shrink-0">{m.uptime30d.toFixed(2)}% (30d)</span>
                </div>

                <div className="flex items-center gap-1 h-6 bg-black/30 rounded-lg p-1 border border-white/5 overflow-hidden">
                  {Array.from({ length: 30 }).map((_, i) => {
                    const historyIdx = (m.history?.length || 0) - 30 + i;
                    const hb = historyIdx >= 0 && m.history ? m.history[historyIdx] : null;
                    return (
                      <div
                        key={i}
                        className={`flex-1 h-full rounded-sm ${
                          !hb ? "bg-white/5" : hb.status === "up" ? "bg-emerald-400/80" : "bg-rose-500"
                        }`}
                        title={hb ? `${new Date(hb.timestamp).toLocaleString()} — ${hb.status.toUpperCase()}` : "No data"}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-center text-[11px] text-gray-600">
          {lastFetched ? `Updated ${lastFetched.toLocaleTimeString()} · refreshes every 15s` : "Loading..."}
        </p>
      </div>
    </div>
  );
}

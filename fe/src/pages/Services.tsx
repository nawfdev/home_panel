import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { ArrowPathIcon, PlayIcon, StopIcon } from "@heroicons/react/24/outline";

interface ServiceInfo {
  name: string;
  status: string;
  type: string;
}

export function Services() {
  const { show } = useToast();
  const [platform, setPlatform] = useState<string>("linux");
  const [services, setServices] = useState<ServiceInfo[] | null>(null);

  async function load() {
    try {
      const data = await api<{ success: boolean; services: ServiceInfo[]; platform: string }>("/services");
      setPlatform(data.platform);
      setServices(data.services ?? []);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load services", "error");
      setServices([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function action(name: string, act: "start" | "stop") {
    try {
      await api(`/services/${name}/${act}`, { method: "POST" });
      load();
    } catch (err) {
      show(err instanceof Error ? err.message : `Failed to ${act} service`, "error");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Services</h2>
          <p className="text-gray-500 text-sm mt-1">
            {platform === "windows" ? "Windows services" : "systemd units"} on this host
          </p>
        </div>
        <button className="btn-secondary" onClick={load}>
          <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
        </button>
      </div>

      <Panel title={`Services${services ? ` (${services.length})` : ""}`}>
        {services === null ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : services.length === 0 ? (
          <p className="text-sm text-gray-500">No services found or not supported on this platform</p>
        ) : (
          <div className="space-y-2">
            {services.map((s) => {
              const isRunning = s.status === "running";
              return (
                <div key={s.name} className="bg-white/5 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="metric-dot" style={{ color: isRunning ? "#4ade80" : "#f87171" }} />
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-gray-100 truncate">{s.name}</p>
                      <p className="text-xs text-gray-500 capitalize">{s.status}</p>
                    </div>
                  </div>
                  {isRunning ? (
                    <button className="btn-danger shrink-0" onClick={() => action(s.name, "stop")}>
                      <StopIcon className="w-4 h-4 inline mr-1.5" />Stop
                    </button>
                  ) : (
                    <button className="btn-secondary shrink-0" onClick={() => action(s.name, "start")}>
                      <PlayIcon className="w-4 h-4 inline mr-1.5" />Start
                    </button>
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

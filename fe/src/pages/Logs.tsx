import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { ArrowPathIcon } from "@heroicons/react/24/outline";

interface Source {
  id: string;
  name: string;
  type: string;
  available?: boolean;
}

interface Target {
  id: string;
  name: string;
}

const LINE_OPTIONS = [50, 100, 200, 500];

export function Logs() {
  const { show } = useToast();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetId, setTargetId] = useState("");
  const [lines, setLines] = useState(100);
  const [search, setSearch] = useState("");
  const [logs, setLogs] = useState<string>("Select a log source");

  useEffect(() => {
    api<{ success: boolean; sources: Source[] }>("/logs/sources")
      .then((data) => setSources(data.sources.filter((s) => s.id === "panel" || s.available)))
      .catch((err) => show(err instanceof Error ? err.message : "Failed to load log sources", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setTargetId("");
    setLogs(sourceId ? "Select a target" : "Select a log source");
    if (!sourceId) {
      setTargets([]);
      return;
    }
    if (sourceId === "panel") {
      setTargets([]);
      loadLogs("panel", "");
      return;
    }
    api<{ success: boolean; targets: Target[] }>(`/logs/sources/${sourceId}/targets`)
      .then((data) => setTargets(data.targets))
      .catch(() => setTargets([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);

  useEffect(() => {
    if (sourceId && sourceId !== "panel" && targetId) loadLogs(sourceId, targetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  useEffect(() => {
    if (sourceId === "panel" || (sourceId && targetId)) loadLogs(sourceId, targetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  useEffect(() => {
    if (!(sourceId === "panel" || (sourceId && targetId))) return;
    const t = setTimeout(() => loadLogs(sourceId, targetId), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function loadLogs(src: string, tgt: string) {
    if (!src) {
      setLogs("Select a log source");
      return;
    }
    if (src !== "panel" && !tgt) {
      setLogs("Select a target");
      return;
    }
    try {
      let url = `/logs/sources/${src}?lines=${lines}`;
      if (tgt) url += `&target=${tgt}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      const data = await api<{ success: boolean; logs?: string }>(url);
      setLogs(data.logs || "No logs available");
    } catch (err) {
      setLogs(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Logs</h2>
          <p className="text-gray-500 text-sm mt-1">Tail logs from the panel, systemd units, Docker, or PM2</p>
        </div>
        <button className="btn-secondary" onClick={() => loadLogs(sourceId, targetId)}>
          <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
        </button>
      </div>

      <div className="space-y-4">
        <Panel>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Source</label>
              <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="input-field w-full">
                <option value="">Select source...</option>
                {sources?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Target</label>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                disabled={sourceId === "panel" || !sourceId}
                className="input-field w-full disabled:opacity-50"
              >
                {sourceId === "panel" ? (
                  <option value="">N/A</option>
                ) : (
                  <>
                    <option value="">Select target...</option>
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Lines</label>
              <select
                value={lines}
                onChange={(e) => setLines(Number(e.target.value))}
                className="input-field w-full"
              >
                {LINE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    Last {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-gray-500 text-xs mb-1.5">Search</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter logs..."
                className="input-field w-full"
              />
            </div>
          </div>
          <pre className="bg-black/30 rounded-lg p-4 max-h-[500px] overflow-y-auto font-mono text-xs whitespace-pre-wrap text-gray-300">
            {logs}
          </pre>
        </Panel>
      </div>
    </div>
  );
}

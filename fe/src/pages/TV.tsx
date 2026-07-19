import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { TvPlayer, type TvChannel } from "./TvPlayer";
import { MagnifyingGlassIcon, TvIcon } from "@heroicons/react/24/outline";

export function TV() {
  const { show } = useToast();
  const [channels, setChannels] = useState<TvChannel[] | null>(null);
  const [group, setGroup] = useState("Semua");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<TvChannel | null>(null);
  const [brokenLogos, setBrokenLogos] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const data = await api<{ success: boolean; channels: TvChannel[]; error?: string }>("/tv/channels");
        if (data.success) {
          setChannels(data.channels ?? []);
        } else {
          show(data.error ?? "Couldn't load TV channels", "error");
          setChannels([]);
        }
      } catch (err) {
        show(err instanceof Error ? err.message : "Couldn't load TV channels", "error");
        setChannels([]);
      }
    })();
  }, [show]);

  const groups = useMemo(() => {
    if (!channels) return [];
    const map = new Map<string, number>();
    for (const c of channels) map.set(c.group, (map.get(c.group) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  }, [channels]);

  const filtered = useMemo(() => {
    if (!channels) return [];
    const q = query.trim().toLowerCase();
    return channels.filter((c) => {
      if (group !== "Semua" && c.group !== group) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [channels, group, query]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Live TV</h2>
          <p className="text-gray-500 text-sm mt-1">
            Free-to-air Indonesian channels via dhanytv, with DASH/DRM support.
          </p>
        </div>
      </div>

      {active && (
        <div className="mb-6">
          <TvPlayer channel={active} />
          <div className="flex items-center gap-2 mt-2">
            <p className="text-sm text-gray-200">{active.name}</p>
            {active.drm && <span className="status-badge bg-yellow-500/15 text-yellow-400">DRM</span>}
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search channel…"
            className="input-field w-full text-sm pl-9"
          />
        </div>
        <select value={group} onChange={(e) => setGroup(e.target.value)} className="input-field text-sm sm:w-56">
          <option value="Semua">All groups ({channels?.length ?? 0})</option>
          {groups.map((g) => (
            <option key={g.name} value={g.name}>
              {g.name} ({g.count})
            </option>
          ))}
        </select>
      </div>

      <Panel>
        {channels === null ? (
          <p className="text-sm text-gray-500">Loading channels…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-500">No channels match.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => setActive(c)}
                className={`group text-left bg-white/5 rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500/60 transition ${
                  active?.id === c.id ? "ring-2 ring-blue-500" : ""
                }`}
              >
                <div className="aspect-video bg-white/5 flex items-center justify-center overflow-hidden p-3">
                  {c.logo && !brokenLogos.has(c.id) ? (
                    <img
                      src={c.logo}
                      alt={c.name}
                      loading="lazy"
                      className="max-w-full max-h-full object-contain"
                      onError={() => setBrokenLogos((prev) => new Set(prev).add(c.id))}
                    />
                  ) : (
                    <TvIcon className="w-8 h-8 text-gray-600" />
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs text-gray-200 line-clamp-2">{c.name}</p>
                  {c.drm && <p className="text-[10px] text-yellow-500 mt-0.5">DRM</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

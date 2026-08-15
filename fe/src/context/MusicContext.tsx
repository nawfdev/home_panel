import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";

export interface MusicTrack {
  uri: string;
  name: string;
  artist_names: string[];
  album_name: string;
  album_cover_url: string | null;
  position: number;
  duration: number;
}

export interface MusicStatus {
  device_name: string;
  play_origin: string;
  stopped: boolean;
  paused: boolean;
  buffering: boolean;
  volume: number;
  volume_steps: number;
  repeat_context: boolean;
  repeat_track: boolean;
  shuffle_context: boolean;
  track: MusicTrack | null;
}

interface MusicContextValue {
  // Whether the server has go-librespot installed at all — independent of
  // the "music" RBAC feature grant, which callers check separately before
  // even mounting this.
  available: boolean;
  // True once /events is connected — doesn't mean a Spotify session is
  // paired yet, only that the local go-librespot daemon is reachable.
  connected: boolean;
  status: MusicStatus | null;
  streamUrl: string;
  play: (uri: string, contextUri?: string) => void;
  playPause: () => void;
  next: () => void;
  prev: () => void;
  seek: (positionMs: number) => void;
  setVolume: (steps: number) => void;
  toggleShuffle: () => void;
  toggleRepeatContext: () => void;
  toggleRepeatTrack: () => void;
}

const MusicContext = createContext<MusicContextValue | null>(null);

export function useMusic(): MusicContextValue {
  const ctx = useContext(MusicContext);
  if (!ctx) throw new Error("useMusic must be used inside MusicProvider");
  return ctx;
}

const LIBRESPOT_BASE = "/api/music/librespot";

export function MusicProvider({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState(false);
  const [checked, setChecked] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<MusicStatus | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`${LIBRESPOT_BASE}/status`, { credentials: "include" });
      if (res.status === 204) {
        setStatus(null);
        return;
      }
      if (!res.ok) return;
      setStatus((await res.json()) as MusicStatus);
    } catch {
      /* keep last known status; the next event/poll will resync */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<{ available: boolean }>("/music/available")
      .then((r) => {
        if (!cancelled) setAvailable(r.available);
      })
      .catch(() => setAvailable(false))
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!available) return;
    refreshStatus();

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}${LIBRESPOT_BASE}/events`);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    // Every event type shares one concern here (something about playback
    // changed) — refetching the full snapshot is simpler and less
    // error-prone than hand-merging each event's partial payload shape.
    ws.onmessage = () => refreshStatus();

    // Status can also drift from actions taken on OTHER Spotify Connect
    // clients (someone paused from their phone) with no guarantee the
    // WebSocket delivers every event instantly, so poll as a backstop.
    const poll = window.setInterval(refreshStatus, 15000);

    return () => {
      window.clearInterval(poll);
      ws.close();
    };
  }, [available, refreshStatus]);

  const post = useCallback(
    async (path: string, body?: Record<string, unknown>) => {
      try {
        await fetch(`${LIBRESPOT_BASE}${path}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } finally {
        refreshStatus();
      }
    },
    [refreshStatus]
  );

  const value: MusicContextValue = {
    available: available && checked,
    connected,
    status,
    streamUrl: "/api/music/stream",
    play: (uri, contextUri) => post("/player/play", contextUri ? { uri: contextUri, skip_to_uri: uri } : { uri }),
    playPause: () => post("/player/playpause"),
    next: () => post("/player/next"),
    prev: () => post("/player/prev"),
    seek: (positionMs) => post("/player/seek", { position: positionMs }),
    setVolume: (steps) => post("/player/volume", { volume: steps }),
    toggleShuffle: () => post("/player/shuffle_context", { shuffle_context: !status?.shuffle_context }),
    toggleRepeatContext: () => post("/player/repeat_context", { repeat_context: !status?.repeat_context }),
    toggleRepeatTrack: () => post("/player/repeat_track", { repeat_track: !status?.repeat_track }),
  };

  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>;
}

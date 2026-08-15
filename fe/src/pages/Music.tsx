import { useEffect, useState } from "react";
import { Panel } from "../components/ui/Panel";
import { useMusic } from "../context/MusicContext";
import { MagnifyingGlassIcon, PlayIcon, MusicalNoteIcon, WifiIcon } from "@heroicons/react/24/outline";

interface SpotifyImage {
  url: string;
}
interface SpotifyArtist {
  name: string;
}
interface SpotifyTrack {
  uri: string;
  name: string;
  artists: SpotifyArtist[];
  album: { name: string; images: SpotifyImage[] };
  duration_ms: number;
}
interface SpotifyPlaylist {
  uri: string;
  name: string;
  images: SpotifyImage[];
  tracks: { total: number };
  owner: { display_name: string };
}

function fmtDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

// Every request here goes through go-librespot's own /web-api/* proxy
// (see internal/music), which forwards verbatim to api.spotify.com using
// the session established when this device was paired — no separate
// Spotify Developer App/OAuth client is registered by the panel itself.
async function spotifyGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/music/librespot/web-api/${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`Spotify API request failed (${res.status})`);
  return (await res.json()) as T;
}

export function Music() {
  const { available, connected, status, play } = useMusic();
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<SpotifyTrack[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    spotifyGet<{ items: SpotifyPlaylist[] }>("v1/me/playlists?limit=20")
      .then((r) => setPlaylists(r.items ?? []))
      .catch(() => setPlaylists([]));
  }, [connected]);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true);
    setError(null);
    try {
      const r = await spotifyGet<{ tracks: { items: SpotifyTrack[] } }>(
        `v1/search?type=track&limit=20&q=${encodeURIComponent(query)}`
      );
      setTracks(r.tracks.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setTracks([]);
    } finally {
      setSearching(false);
    }
  }

  if (!available) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-100 mb-2">Music</h2>
        <Panel>
          <p className="text-sm text-gray-500">
            Music isn't set up on this server — go-librespot isn't installed.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Music</h2>
          <p className="text-gray-500 text-sm mt-1">Spotify Connect — this server as a speaker on your account.</p>
        </div>
      </div>

      {!connected && (
        <Panel className="mb-6">
          <p className="text-sm text-gray-500 flex items-center gap-2">
            <WifiIcon className="w-4 h-4" /> Connecting to the music service…
          </p>
        </Panel>
      )}

      {connected && !status?.track && (
        <Panel className="mb-6">
          <p className="text-sm text-gray-300 font-medium mb-1">Pair this device</p>
          <p className="text-xs text-gray-500">
            Open Spotify on your phone or desktop (Premium required), tap the Devices icon while something is
            playing, and select <span className="text-gray-300">Nestcore</span>. Playback then continues here —
            control it from this page or the player bar at the bottom of the panel.
          </p>
        </Panel>
      )}

      <form onSubmit={search} className="flex gap-2 mb-6">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a track…"
          className="input-field flex-1 text-sm"
        />
        <button type="submit" className="btn-primary disabled:opacity-60" disabled={searching}>
          <MagnifyingGlassIcon className="w-4 h-4 inline mr-1.5" />
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {tracks !== null && (
        <Panel className="mb-6">
          {tracks.length === 0 ? (
            <p className="text-sm text-gray-500">No results.</p>
          ) : (
            <div className="space-y-1">
              {tracks.map((t) => (
                <button
                  key={t.uri}
                  onClick={() => play(t.uri)}
                  className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 text-left group"
                >
                  {t.album.images[2]?.url || t.album.images[0]?.url ? (
                    <img
                      src={t.album.images[2]?.url || t.album.images[0]?.url}
                      alt={t.album.name}
                      className="w-10 h-10 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-white/5 flex items-center justify-center shrink-0">
                      <MusicalNoteIcon className="w-4 h-4 text-gray-600" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-100 truncate">{t.name}</p>
                    <p className="text-xs text-gray-500 truncate">{t.artists.map((a) => a.name).join(", ")}</p>
                  </div>
                  <span className="text-xs font-mono text-gray-500 shrink-0">{fmtDuration(t.duration_ms)}</span>
                  <PlayIcon className="w-4 h-4 text-gray-500 opacity-0 group-hover:opacity-100 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </Panel>
      )}

      <Panel>
        <p className="section-heading">Your playlists</p>
        {playlists === null ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : playlists.length === 0 ? (
          <p className="text-sm text-gray-500">No playlists found.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {playlists.map((p) => (
              <button
                key={p.uri}
                onClick={() => play(p.uri, p.uri)}
                className="group text-left bg-white/5 rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500/60 transition"
              >
                <div className="aspect-square bg-white/5 flex items-center justify-center overflow-hidden relative">
                  {p.images[0]?.url ? (
                    <img src={p.images[0].url} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  ) : (
                    <MusicalNoteIcon className="w-8 h-8 text-gray-600" />
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
                    <PlayIcon className="w-7 h-7 text-white opacity-0 group-hover:opacity-100 transition" />
                  </div>
                </div>
                <div className="p-2">
                  <p className="text-xs text-gray-200 line-clamp-2">{p.name}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{p.tracks.total} tracks</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useMusic } from "../../context/MusicContext";
import {
  PlayIcon,
  PauseIcon,
  BackwardIcon,
  ForwardIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  MusicalNoteIcon,
  ArrowPathRoundedSquareIcon,
} from "@heroicons/react/24/solid";
import { ArrowsRightLeftIcon } from "@heroicons/react/24/outline";

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

// Mounted only while AppLayout's MusicAwareMain confirms a track is
// actually playing/paused — never renders as an empty "connecting…" bar
// eating layout space before a Spotify session has been paired.
export function MiniPlayer() {
  const { status, streamUrl, playPause, next, prev, seek, setVolume, toggleShuffle, toggleRepeatContext } = useMusic();
  const track = status!.track!;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [localPosition, setLocalPosition] = useState(track.position);
  const [muted, setMuted] = useState(false);

  // The audio element is the actual playback source (a live relay of
  // whatever go-librespot is decoding); it should only be attached to the
  // stream while something is actually playing, not idling connected 24/7.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!status!.paused && !status!.stopped) {
      if (!audio.src) audio.src = streamUrl;
      audio.play().catch(() => {});
    } else {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
  }, [status, streamUrl]);

  // The track's own position only updates on player events (track change,
  // seek, pause/resume), not continuously — interpolate locally between
  // updates so the progress bar visibly moves instead of jumping once every
  // 15s (the status-poll backstop interval).
  useEffect(() => {
    setLocalPosition(track.position);
    if (status!.paused || status!.stopped) return;
    const start = Date.now();
    const base = track.position;
    const id = window.setInterval(() => {
      setLocalPosition(Math.min(base + (Date.now() - start), track.duration));
    }, 500);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.uri, track.position, status!.paused, status!.stopped]);

  const pct = track.duration > 0 ? (localPosition / track.duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 md:left-64 z-30 bg-gray-950/95 backdrop-blur border-t border-white/10">
      <audio ref={audioRef} className="hidden" muted={muted} />
      <div className="px-3 py-2 md:px-4">
        <div
          className="np-seek mb-2 cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            seek(Math.round(x * track.duration));
          }}
        >
          <div className="np-played" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center gap-3">
          {track.album_cover_url ? (
            <img src={track.album_cover_url} alt={track.album_name} className="w-10 h-10 rounded-md object-cover shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-md bg-white/5 flex items-center justify-center shrink-0">
              <MusicalNoteIcon className="w-5 h-5 text-gray-600" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-100 truncate">{track.name}</p>
            <p className="text-xs text-gray-500 truncate">{track.artist_names.join(", ")}</p>
          </div>
          <span className="hidden sm:block text-[11px] font-mono text-gray-500 shrink-0">
            {fmt(localPosition)} / {fmt(track.duration)}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button className={`np-btn ${status!.shuffle_context ? "text-white" : ""}`} title="Shuffle" onClick={toggleShuffle}>
              <ArrowsRightLeftIcon className="w-4 h-4" />
            </button>
            <button className="np-btn" title="Previous" onClick={prev}>
              <BackwardIcon className="w-4 h-4" />
            </button>
            <button className="np-btn" title={status!.paused ? "Play" : "Pause"} onClick={playPause}>
              {status!.paused ? <PlayIcon className="w-5 h-5" /> : <PauseIcon className="w-5 h-5" />}
            </button>
            <button className="np-btn" title="Next" onClick={next}>
              <ForwardIcon className="w-4 h-4" />
            </button>
            <button className={`np-btn ${status!.repeat_context ? "text-white" : ""}`} title="Repeat" onClick={toggleRepeatContext}>
              <ArrowPathRoundedSquareIcon className="w-4 h-4" />
            </button>
          </div>
          <div className="hidden md:flex items-center gap-1.5 shrink-0 w-28">
            <button className="np-btn" title={muted ? "Unmute" : "Mute"} onClick={() => setMuted((m) => !m)}>
              {muted ? <SpeakerXMarkIcon className="w-4 h-4" /> : <SpeakerWaveIcon className="w-4 h-4" />}
            </button>
            <input
              type="range"
              className="np-vol !w-full !opacity-100"
              min={0}
              max={status!.volume_steps ?? 100}
              value={status!.volume ?? 0}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Spotify volume"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

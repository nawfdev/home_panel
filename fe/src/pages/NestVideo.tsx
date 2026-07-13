import { useEffect, useRef, useState } from "react";

// Inline SVG icons matching the public share player.
const IcoPlay = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const IcoPause = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
  </svg>
);
const IcoVol = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M4 9v6h4l5 5V4L8 9H4z" />
    <path d="M16 8.5a4 4 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);
const IcoMute = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M4 9v6h4l5 5V4L8 9H4z" />
    <path d="M17 9l4 4m0-4l-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);
const IcoCC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M9.5 10.5a2 2 0 1 0 0 3M15.5 10.5a2 2 0 1 0 0 3" strokeLinecap="round" />
  </svg>
);
const IcoFull = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
  </svg>
);
const IcoGear = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

interface Track {
  label: string;
  url: string;
}

function fmt(t: number) {
  if (!isFinite(t)) t = 0;
  t = Math.floor(t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p = (n: number) => (n < 10 ? "0" : "") + n;
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SUB_BGS = [
  { id: "solid", label: "Solid" },
  { id: "semi", label: "Semi" },
  { id: "none", label: "None" },
] as const;
const SUB_SIZES = [
  { id: "sm", label: "S" },
  { id: "md", label: "M" },
  { id: "lg", label: "L" },
  { id: "xl", label: "XL" },
] as const;
const SUB_COLORS = [
  { id: "white", label: "White", hex: "#fff" },
  { id: "yellow", label: "Yellow", hex: "#ffeb3b" },
  { id: "cyan", label: "Cyan", hex: "#00e5ff" },
  { id: "green", label: "Green", hex: "#76ff03" },
] as const;
const SUB_EDGES = [
  { id: "none", label: "None" },
  { id: "drop", label: "Drop shadow" },
  { id: "outline", label: "Outline" },
] as const;
type SubBg = (typeof SUB_BGS)[number]["id"];
type SubSize = (typeof SUB_SIZES)[number]["id"];
type SubColor = (typeof SUB_COLORS)[number]["id"];
type SubEdge = (typeof SUB_EDGES)[number]["id"];

function loadSubSetting<T extends string>(key: string, valid: readonly T[], fallback: T): T {
  const v = localStorage.getItem(key);
  return (valid as readonly string[]).includes(v ?? "") ? (v as T) : fallback;
}
const loadSubBg = () => loadSubSetting<SubBg>("np-subbg", ["solid", "semi", "none"], "solid");
const loadSubSize = () => loadSubSetting<SubSize>("np-subsize", ["sm", "md", "lg", "xl"], "md");
const loadSubColor = () => loadSubSetting<SubColor>("np-subcolor", ["white", "yellow", "cyan", "green"], "white");
const loadSubEdge = () => loadSubSetting<SubEdge>("np-subedge", ["none", "drop", "outline"], "none");

export function NestVideo({ src, tracks }: { src: string; tracks: Track[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [selTrack, setSelTrack] = useState(-1);
  const [subBg, setSubBg] = useState<SubBg>(loadSubBg);
  const [subSize, setSubSize] = useState<SubSize>(loadSubSize);
  const [subColor, setSubColor] = useState<SubColor>(loadSubColor);
  const [subEdge, setSubEdge] = useState<SubEdge>(loadSubEdge);
  const [ccOpen, setCcOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const hideTimer = useRef<number | undefined>(undefined);

  const allTracks = [...tracks, ...localTracks];

  function toggle() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    for (let i = 0; i < v.textTracks.length; i++) {
      v.textTracks[i].mode = i === selTrack ? "showing" : "disabled";
    }
    const t = window.setTimeout(() => {
      for (let i = 0; i < v.textTracks.length; i++) {
        v.textTracks[i].mode = i === selTrack ? "showing" : "disabled";
      }
    }, 80);
    return () => clearTimeout(t);
  }, [selTrack, allTracks.length]);

  useEffect(() => {
    return () => localTracks.forEach((t) => URL.revokeObjectURL(t.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function activity() {
    setHidden(false);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setHidden(true);
    }, 2500);
  }

  function seekFromEvent(clientX: number) {
    const v = videoRef.current;
    const bar = wrapRef.current?.querySelector(".np-seek") as HTMLElement | null;
    if (!v || !bar || !v.duration) return;
    const r = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    v.currentTime = x * v.duration;
  }

  function onSeekDown(e: React.MouseEvent) {
    seekFromEvent(e.clientX);
    const move = (ev: MouseEvent) => seekFromEvent(ev.clientX);
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function toggleFull() {
    const doc = document as unknown as {
      fullscreenElement?: Element;
      webkitFullscreenElement?: Element;
      exitFullscreen?: () => void;
      webkitExitFullscreen?: () => void;
    };
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      (doc.exitFullscreen || doc.webkitExitFullscreen)?.call(document);
      return;
    }
    const el = wrapRef.current as unknown as {
      requestFullscreen?: () => void;
      webkitRequestFullscreen?: () => void;
    } | null;
    const vid = videoRef.current as unknown as { webkitEnterFullscreen?: () => void } | null;
    if (el?.requestFullscreen) el.requestFullscreen();
    else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else if (vid?.webkitEnterFullscreen) vid.webkitEnterFullscreen(); // iOS
  }

  function onPickLocal(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      let text = String(reader.result ?? "");
      if (/\.srt$/i.test(f.name)) {
        text = "WEBVTT\n\n" + text.replace(/\r\n/g, "\n").replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, "$1.$2");
      }
      const url = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
      setLocalTracks((prev) => [...prev, { label: `${f.name} (local)`, url }]);
      setSelTrack(allTracks.length);
    };
    reader.readAsText(f);
    setCcOpen(false);
  }

  const pct = dur ? (cur / dur) * 100 : 0;

  return (
    <div
      ref={wrapRef}
      className={`np subbg-${subBg} subsize-${subSize} subcolor-${subColor} subedge-${subEdge} ${hidden ? "hide hidecursor" : ""}`}
      tabIndex={0}
      onMouseMove={activity}
      onKeyDown={(e) => {
        const v = videoRef.current;
        if (!v) return;
        if (e.key === " " || e.key === "k") {
          e.preventDefault();
          toggle();
        } else if (e.key === "ArrowRight") v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
        else if (e.key === "ArrowLeft") v.currentTime = Math.max(0, v.currentTime - 5);
        else if (e.key === "f") toggleFull();
        else if (e.key === "m") {
          v.muted = !v.muted;
          setMuted(v.muted);
        }
        activity();
      }}
    >
      <video
        ref={videoRef}
        className="np-video"
        src={src}
        playsInline
        onClick={toggle}
        onDoubleClick={toggleFull}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDur(e.currentTarget.duration)}
        onProgress={(e) => {
          const v = e.currentTarget;
          if (v.buffered.length && v.duration) setBuffered((v.buffered.end(v.buffered.length - 1) / v.duration) * 100);
        }}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
        }}
      >
        {allTracks.map((t, i) => (
          <track key={`${t.url}-${i}`} kind="subtitles" label={t.label} src={t.url} />
        ))}
      </video>

      <div className="np-center">
        {paused && (
          <button className="np-bigplay" onClick={toggle} aria-label="Play">
            <IcoPlay />
          </button>
        )}
      </div>
      <div className="np-scrim" />

      <div className="np-controls">
        <div className="np-seek" onMouseDown={onSeekDown}>
          <div className="np-buffered" style={{ width: `${buffered}%` }} />
          <div className="np-played" style={{ width: `${pct}%` }} />
          <div className="np-thumb" style={{ left: `${pct}%` }} />
        </div>
        <div className="np-row">
          <button className="np-btn" onClick={toggle} aria-label="Play/Pause">
            {paused ? <IcoPlay /> : <IcoPause />}
          </button>
          <button
            className="np-btn"
            onClick={() => {
              const v = videoRef.current;
              if (v) {
                v.muted = !v.muted;
                setMuted(v.muted);
              }
            }}
            aria-label="Mute"
          >
            {muted || volume === 0 ? <IcoMute /> : <IcoVol />}
          </button>
          <input
            className="np-vol"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => {
              const v = videoRef.current;
              if (v) {
                v.volume = Number(e.target.value);
                v.muted = v.volume === 0;
              }
            }}
            aria-label="Volume"
          />
          <span className="np-time">
            {fmt(cur)} / {fmt(dur)}
          </span>
          <div className="np-spacer" />

          <div className="np-pop">
            <button
              className="np-btn"
              onClick={(e) => {
                e.stopPropagation();
                setSpeedOpen(false);
                setSettingsOpen(false);
                setCcOpen((o) => !o);
              }}
              aria-label="Subtitles"
            >
              <IcoCC />
            </button>
            {ccOpen && (
              <div className="np-menu">
                <button className={`np-item ${selTrack === -1 ? "active" : ""}`} onClick={() => { setSelTrack(-1); setCcOpen(false); }}>
                  Off
                </button>
                {allTracks.map((t, i) => (
                  <button key={i} className={`np-item ${selTrack === i ? "active" : ""}`} onClick={() => { setSelTrack(i); setCcOpen(false); }}>
                    {t.label}
                  </button>
                ))}
                <label className="np-item cursor-pointer">
                  ＋ Load subtitle…
                  <input type="file" accept=".srt,.vtt" hidden onChange={onPickLocal} />
                </label>
              </div>
            )}
          </div>

          <div className="np-pop">
            <button
              className="np-btn"
              onClick={(e) => {
                e.stopPropagation();
                setCcOpen(false);
                setSpeedOpen(false);
                setSettingsOpen((o) => !o);
              }}
              aria-label="Subtitle settings"
            >
              <IcoGear />
            </button>
            {settingsOpen && (
              <div className="np-menu np-menu-wide">
                <div className="np-setrow">
                  <div className="np-setlabel">Size</div>
                  <div className="np-chips">
                    {SUB_SIZES.map((o) => (
                      <button
                        key={o.id}
                        className={`np-chip ${subSize === o.id ? "active" : ""}`}
                        onClick={() => { setSubSize(o.id); localStorage.setItem("np-subsize", o.id); }}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="np-setrow">
                  <div className="np-setlabel">Color</div>
                  <div className="np-chips">
                    {SUB_COLORS.map((o) => (
                      <button
                        key={o.id}
                        className={`np-swatch ${subColor === o.id ? "active" : ""}`}
                        style={{ background: o.hex }}
                        aria-label={o.label}
                        onClick={() => { setSubColor(o.id); localStorage.setItem("np-subcolor", o.id); }}
                      />
                    ))}
                  </div>
                </div>
                <div className="np-setrow">
                  <div className="np-setlabel">Background</div>
                  <div className="np-chips">
                    {SUB_BGS.map((o) => (
                      <button
                        key={o.id}
                        className={`np-chip ${subBg === o.id ? "active" : ""}`}
                        onClick={() => { setSubBg(o.id); localStorage.setItem("np-subbg", o.id); }}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="np-setrow">
                  <div className="np-setlabel">Edge style</div>
                  <div className="np-chips">
                    {SUB_EDGES.map((o) => (
                      <button
                        key={o.id}
                        className={`np-chip ${subEdge === o.id ? "active" : ""}`}
                        onClick={() => { setSubEdge(o.id); localStorage.setItem("np-subedge", o.id); }}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="np-pop">
            <button
              className="np-btn np-speedbtn"
              onClick={(e) => {
                e.stopPropagation();
                setCcOpen(false);
                setSettingsOpen(false);
                setSpeedOpen((o) => !o);
              }}
              aria-label="Speed"
            >
              {speed}x
            </button>
            {speedOpen && (
              <div className="np-menu">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    className={`np-item ${s === speed ? "active" : ""}`}
                    onClick={() => {
                      if (videoRef.current) videoRef.current.playbackRate = s;
                      setSpeed(s);
                      setSpeedOpen(false);
                    }}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className="np-btn" onClick={toggleFull} aria-label="Fullscreen">
            <IcoFull />
          </button>
        </div>
      </div>
    </div>
  );
}

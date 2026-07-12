import { useEffect, useRef, useState } from "react";
import { Modal } from "../components/ui/Modal";

interface Subtitle {
  name: string;
  label: string;
}

interface LocalTrack {
  label: string;
  url: string;
}

// srtToVtt mirrors the server-side conversion so viewers can load their own
// .srt file locally (browsers can't attach .srt to <track> natively).
function srtToVtt(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, "$1.$2");
  return "WEBVTT\n\n" + normalized;
}

export function MediaPlayer({
  path,
  name,
  type,
  subtitles,
  onClose,
}: {
  path: string;
  name: string;
  type: "video" | "image" | "audio";
  subtitles: Subtitle[];
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [selectedTrack, setSelectedTrack] = useState(-1);
  const [localTracks, setLocalTracks] = useState<LocalTrack[]>([]);

  const rawUrl = `/api/files/download?path=${encodeURIComponent(path)}`;

  // Sidecar subtitles served (converted to VTT) by the authenticated endpoint.
  const serverTracks: LocalTrack[] = subtitles.map((s) => ({
    label: s.label,
    url: `/api/files/subtitle?path=${encodeURIComponent(path)}&name=${encodeURIComponent(s.name)}`,
  }));
  const allTracks = [...serverTracks, ...localTracks];

  // Reflect the selected track onto the actual <track> elements' mode.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const apply = () => {
      for (let i = 0; i < v.textTracks.length; i++) {
        v.textTracks[i].mode = i === selectedTrack ? "showing" : "disabled";
      }
    };
    apply();
    const t = setTimeout(apply, 100); // let freshly-added tracks register
    return () => clearTimeout(t);
  }, [selectedTrack, allTracks.length]);

  useEffect(() => {
    return () => localTracks.forEach((t) => URL.revokeObjectURL(t.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onPickLocalSubtitle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let text = String(reader.result ?? "");
      if (/\.srt$/i.test(file.name)) text = srtToVtt(text);
      const url = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
      setLocalTracks((prev) => [...prev, { label: `${file.name} (local)`, url }]);
      setSelectedTrack(allTracks.length); // select the newly added track
    };
    reader.readAsText(file);
  }

  return (
    <Modal title={name} onClose={onClose} wide>
      <div className="bg-black rounded-lg overflow-hidden flex items-center justify-center">
        {type === "image" ? (
          <img src={rawUrl} alt={name} className="max-h-[70vh] max-w-full" />
        ) : type === "audio" ? (
          <audio src={rawUrl} controls className="w-full p-6" />
        ) : (
          <video ref={videoRef} src={rawUrl} controls playsInline className="w-full max-h-[70vh] bg-black">
            {allTracks.map((t, i) => (
              <track key={`${t.url}-${i}`} kind="subtitles" label={t.label} src={t.url} />
            ))}
          </video>
        )}
      </div>

      {type === "video" && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="text-xs text-gray-500">Subtitle:</span>
          <select
            value={selectedTrack}
            onChange={(e) => setSelectedTrack(Number(e.target.value))}
            className="input-field text-sm !py-1.5 !w-auto"
          >
            <option value={-1}>Off</option>
            {allTracks.map((t, i) => (
              <option key={i} value={i}>
                {t.label}
              </option>
            ))}
          </select>
          <label className="btn-secondary !py-1.5 !px-3 text-xs cursor-pointer">
            Load .srt/.vtt
            <input type="file" accept=".srt,.vtt" hidden onChange={onPickLocalSubtitle} />
          </label>
        </div>
      )}

      <a href={rawUrl} download className="inline-block mt-3 text-sm text-gray-300 hover:text-gray-100 hover:underline">
        Download
      </a>
    </Modal>
  );
}

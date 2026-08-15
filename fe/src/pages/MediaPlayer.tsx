import { Modal } from "../components/ui/Modal";
import { NestVideo, type AudioTrackInfo } from "./NestVideo";

interface Subtitle {
  name: string;
  label: string;
}

export function MediaPlayer({
  path,
  playPath,
  name,
  type,
  subtitles,
  audioTracks = [],
  onClose,
}: {
  path: string;
  // Defaults to path when omitted/equal — only differs for a video that
  // needed a codec/container/faststart fix to play in-browser (see
  // EnsureWebPlayable). The player uses this; Download always uses path,
  // so it's always the exact original bytes, never a remuxed copy.
  playPath?: string;
  name: string;
  type: "video" | "image" | "audio";
  subtitles: Subtitle[];
  audioTracks?: AudioTrackInfo[];
  onClose: () => void;
}) {
  const rawUrl = `/api/files/download?path=${encodeURIComponent(path)}`;
  const playUrl = `/api/files/download?path=${encodeURIComponent(playPath || path)}`;

  // Sidecar subtitles served (converted to VTT) by the authenticated endpoint.
  const tracks = subtitles.map((s) => ({
    label: s.label,
    url: `/api/files/subtitle?path=${encodeURIComponent(path)}&name=${encodeURIComponent(s.name)}`,
  }));

  return (
    <Modal title={name} onClose={onClose} wide>
      {type === "image" ? (
        <div className="bg-black rounded-lg overflow-hidden flex items-center justify-center">
          <img src={playUrl} alt={name} className="max-h-[70vh] max-w-full" />
        </div>
      ) : type === "audio" ? (
        <div className="bg-black rounded-lg overflow-hidden flex items-center justify-center p-6">
          <audio src={playUrl} controls className="w-full" />
        </div>
      ) : (
        <NestVideo src={playUrl} tracks={tracks} audioTracks={audioTracks} />
      )}

      <div className="text-center mt-4">
        <a
          href={rawUrl}
          download
          className="inline-flex items-center gap-2 bg-gray-100 hover:bg-white text-gray-900 font-semibold text-sm px-6 py-2.5 rounded-lg transition active:scale-[0.98]"
        >
          <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12M8 11l4 4 4-4M5 21h14" />
          </svg>
          Download
        </a>
      </div>
    </Modal>
  );
}

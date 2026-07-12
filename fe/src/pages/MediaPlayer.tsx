import { Modal } from "../components/ui/Modal";
import { NestVideo } from "./NestVideo";

interface Subtitle {
  name: string;
  label: string;
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
  const rawUrl = `/api/files/download?path=${encodeURIComponent(path)}`;

  // Sidecar subtitles served (converted to VTT) by the authenticated endpoint.
  const tracks = subtitles.map((s) => ({
    label: s.label,
    url: `/api/files/subtitle?path=${encodeURIComponent(path)}&name=${encodeURIComponent(s.name)}`,
  }));

  return (
    <Modal title={name} onClose={onClose} wide>
      {type === "image" ? (
        <div className="bg-black rounded-lg overflow-hidden flex items-center justify-center">
          <img src={rawUrl} alt={name} className="max-h-[70vh] max-w-full" />
        </div>
      ) : type === "audio" ? (
        <div className="bg-black rounded-lg overflow-hidden flex items-center justify-center p-6">
          <audio src={rawUrl} controls className="w-full" />
        </div>
      ) : (
        <NestVideo src={rawUrl} tracks={tracks} />
      )}

      <a href={rawUrl} download className="inline-block mt-3 text-sm text-gray-300 hover:text-gray-100 hover:underline">
        Download
      </a>
    </Modal>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { ArrowLeftIcon, PaperClipIcon } from "@heroicons/react/24/outline";

interface Device {
  id: number;
  name: string;
  host: string;
  port: number;
  token: string;
}

const FRAME_TAG = 0x01;
const FILE_CHUNK_TAG = 0x02;
const CHUNK_SIZE = 64 * 1024;

type Status = "loading" | "connecting" | "connected" | "disconnected" | "error";

export function RemoteDesktopView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { show } = useToast();
  const [device, setDevice] = useState<Device | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState("");
  const [fileProgress, setFileProgress] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const imgWrapRef = useRef<HTMLDivElement | null>(null);
  const frameUrlRef = useRef<string | null>(null);

  useEffect(() => {
    api<Device>(`/remote-desktop/${id}`)
      .then(setDevice)
      .catch((err) => {
        show(err instanceof Error ? err.message : "Device not found", "error");
        navigate("/remote-desktop");
      });
  }, [id, navigate, show]);

  useEffect(() => {
    if (!device) return;
    setStatus("connecting");
    const ws = new WebSocket(`ws://${device.host}:${device.port}/ws?token=${encodeURIComponent(device.token)}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => setStatus("connected");
    ws.onclose = () => setStatus("disconnected");
    ws.onerror = () => setStatus("error");

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "clipboard") setClipboard(msg.text ?? "");
        } catch {
          // ignore malformed control messages
        }
        return;
      }
      const bytes = new Uint8Array(ev.data as ArrayBuffer);
      if (bytes[0] !== FRAME_TAG) return;
      const blob = new Blob([bytes.slice(1)], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
      frameUrlRef.current = url;
      setFrameUrl(url);
    };

    return () => {
      ws.close();
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device]);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  }, []);

  function normalized(e: React.MouseEvent) {
    const rect = imgWrapRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }

  function onMouseMove(e: React.MouseEvent) {
    send({ type: "mouse_move", ...normalized(e) });
  }

  function buttonName(e: React.MouseEvent) {
    return e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
  }

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    send({ type: "mouse_down", ...normalized(e), button: buttonName(e) });
  }

  function onMouseUp(e: React.MouseEvent) {
    send({ type: "mouse_up", ...normalized(e), button: buttonName(e) });
  }

  function onWheel(e: React.WheelEvent) {
    send({ type: "scroll", dy: e.deltaY });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    e.preventDefault();
    send({ type: "key_down", code: e.code });
  }

  function onKeyUp(e: React.KeyboardEvent) {
    e.preventDefault();
    send({ type: "key_up", code: e.code });
  }

  function sendClipboard() {
    send({ type: "clipboard", text: clipboard });
    show("Clipboard sent to remote", "success");
  }

  async function sendFile(file: File) {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    send({ type: "file_offer", name: file.name, size: file.size });
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      const chunk = bytes.slice(offset, offset + CHUNK_SIZE);
      const framed = new Uint8Array(chunk.length + 1);
      framed[0] = FILE_CHUNK_TAG;
      framed.set(chunk, 1);
      wsRef.current.send(framed);
      setFileProgress(Math.round(((offset + chunk.length) / bytes.length) * 100));
    }
    send({ type: "file_end" });
    setFileProgress(null);
    show(`Sent ${file.name} to remote Downloads`, "success");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button className="btn-secondary" onClick={() => navigate("/remote-desktop")}>
            <ArrowLeftIcon className="w-4 h-4 inline mr-1.5" />Back
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-100">{device?.name ?? "Remote Desktop"}</h2>
            <p className="text-xs text-gray-500">{device && `${device.host}:${device.port}`}</p>
          </div>
        </div>
        <span
          className={`status-badge ${
            status === "connected"
              ? "bg-green-500/15 text-green-400"
              : status === "connecting" || status === "loading"
                ? "bg-yellow-500/15 text-yellow-400"
                : "bg-red-500/15 text-red-400"
          }`}
        >
          {status}
        </span>
      </div>

      <div
        ref={imgWrapRef}
        tabIndex={0}
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(e) => e.preventDefault()}
        className="relative bg-black rounded-lg overflow-hidden outline-none border border-white/10 cursor-crosshair"
        style={{ aspectRatio: "16/9" }}
      >
        {frameUrl ? (
          <img src={frameUrl} alt="Remote screen" className="w-full h-full object-contain select-none" draggable={false} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600 text-sm">
            {status === "connecting" || status === "loading" ? "Connecting..." : "No signal"}
          </div>
        )}
      </div>
      <p className="text-xs text-gray-600 mt-2">Click the screen to focus it, then type/click/scroll as usual.</p>

      <div className="grid md:grid-cols-2 gap-4 mt-6">
        <div className="bg-white/5 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-200 mb-2">Clipboard</h3>
          <textarea
            value={clipboard}
            onChange={(e) => setClipboard(e.target.value)}
            className="input-field w-full h-20 resize-none font-mono text-xs"
            placeholder="Paste text here to send to remote, or receive remote's clipboard here"
          />
          <button className="btn-secondary mt-2" onClick={sendClipboard}>
            Send to remote
          </button>
        </div>

        <div className="bg-white/5 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-200 mb-2">Send file to remote</h3>
          <label className="btn-secondary inline-flex items-center cursor-pointer">
            <PaperClipIcon className="w-4 h-4 inline mr-1.5" />
            Choose file
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) sendFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {fileProgress !== null && <p className="text-xs text-gray-500 mt-2">Sending... {fileProgress}%</p>}
          <p className="text-xs text-gray-600 mt-2">Saved into the remote's Downloads\RemoteAgentReceived folder.</p>
        </div>
      </div>
    </div>
  );
}

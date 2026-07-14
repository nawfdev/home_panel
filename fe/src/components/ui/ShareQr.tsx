import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { QrCodeIcon } from "@heroicons/react/24/outline";

// Renders a "Show QR" toggle that draws the share URL as a scannable code —
// generated client-side (no third-party QR API call, so the share link
// never leaves the browser).
export function ShareQr({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, {
      width: 176,
      margin: 1,
      color: { dark: "#0e0e10", light: "#fafafa" },
    }).catch(() => {});
  }, [open, url]);

  return (
    <div>
      <button className="btn-secondary shrink-0" title="Show QR code" onClick={() => setOpen((o) => !o)}>
        <QrCodeIcon className="w-4 h-4" />
      </button>
      {open && (
        <div className="mt-2 inline-flex flex-col items-center gap-2 bg-white/5 rounded-lg p-3">
          <canvas ref={canvasRef} className="rounded" />
          <p className="text-xs text-gray-500">Scan to open this link</p>
        </div>
      )}
    </div>
  );
}

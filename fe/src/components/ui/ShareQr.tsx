import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { QrCodeIcon, DocumentDuplicateIcon } from "@heroicons/react/24/outline";
import { Modal } from "./Modal";
import { copyText } from "../../lib/clipboard";
import { useToast } from "../../context/ToastContext";

// Renders a QR code toggle that opens a clean modal popup to scan the share link.
export function ShareQr({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { show } = useToast();

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, {
      width: 220,
      margin: 1,
      color: { dark: "#0e0e10", light: "#ffffff" },
    }).catch(() => {});
  }, [open, url]);

  const handleCopy = () => {
    copyText(url);
    setCopied(true);
    show("Link copied to clipboard", "success", 1500);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <button className="btn-secondary shrink-0" title="Scan QR code" onClick={() => setOpen(true)}>
        <QrCodeIcon className="w-4 h-4" />
      </button>
      {open && (
        <Modal title="Scan to open this link" onClose={() => setOpen(false)}>
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="p-3 bg-white rounded-2xl shadow-lg">
              <canvas ref={canvasRef} className="rounded" />
            </div>
            <p className="text-xs text-gray-400 text-center">
              Scan with your phone camera or QR reader to open this link instantly.
            </p>
            <div className="w-full flex items-center gap-2 bg-black/40 border border-white/10 rounded-lg p-2">
              <span className="text-xs text-gray-300 font-mono truncate flex-1 select-all">{url}</span>
              <button
                className="btn-secondary text-xs shrink-0 flex items-center gap-1 py-1 px-2.5"
                onClick={handleCopy}
              >
                <DocumentDuplicateIcon className="w-3.5 h-3.5" />
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { ShareQr } from "../components/ui/ShareQr";
import { copyText } from "../lib/clipboard";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ClipboardIcon,
  DocumentIcon,
  FolderIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

interface ShareRecord {
  token: string;
  path: string;
  name: string;
  isDir: boolean;
  createdAt: number;
  expiresAt: number;
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleString();
}

export function Shares() {
  const { show } = useToast();
  const [shares, setShares] = useState<ShareRecord[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<{ success: boolean; shares: ShareRecord[] }>("/files/shares");
      const list = data.shares ?? [];
      list.sort((a, b) => b.createdAt - a.createdAt);
      setShares(list);
    } catch (err) {
      show(err instanceof Error ? err.message : "Error loading shared links", "error");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function revoke(token: string) {
    setRevoking(token);
    try {
      await api(`/files/shares/${token}`, { method: "DELETE" });
      show("Share revoked", "success");
      await load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to revoke", "error");
    } finally {
      setRevoking(null);
    }
  }

  function shareUrl(token: string) {
    return `${window.location.origin}/share/${token}`;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-gray-100">Shared links</h2>
          <p className="text-gray-500 text-sm mt-1">
            Every public link you have published, from Files, Movies or Stream.
          </p>
        </div>
        <button className="btn-secondary" onClick={load}>
          <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
        </button>
      </div>

      <Panel>
        {shares === null ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : shares.length === 0 ? (
          <p className="text-sm text-gray-500">
            No active shared links. Share a file or movie to create one — anyone with the link can access it
            without logging in.
          </p>
        ) : (
          <div className="space-y-2">
            {shares.map((s) => (
              <div key={s.token} className="bg-white/5 rounded-lg p-3">
                <div className="flex items-center gap-3 min-w-0">
                  {s.isDir ? (
                    <FolderIcon className="w-5 h-5 text-yellow-500 shrink-0" />
                  ) : (
                    <DocumentIcon className="w-5 h-5 text-gray-500 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm text-gray-100 truncate">{s.name}</p>
                    <p className="text-xs text-gray-500 font-mono truncate">{s.path}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-3">
                  <input
                    readOnly
                    value={shareUrl(s.token)}
                    className="input-field flex-1 font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    className="btn-secondary shrink-0"
                    title="Copy"
                    onClick={async () => {
                      const ok = await copyText(shareUrl(s.token));
                      show(ok ? "Link copied" : "Couldn't copy — select the link and copy manually", ok ? "success" : "warning");
                    }}
                  >
                    <ClipboardIcon className="w-4 h-4" />
                  </button>
                  <ShareQr url={shareUrl(s.token)} />
                  <a
                    className="btn-secondary shrink-0"
                    title="Open"
                    href={shareUrl(s.token)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                  </a>
                  <button
                    className="btn-danger shrink-0"
                    title="Revoke"
                    onClick={() => revoke(s.token)}
                    disabled={revoking === s.token}
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-xs text-gray-500 mt-2">
                  Created {formatDate(s.createdAt)} ·{" "}
                  {s.expiresAt === 0 ? "Never expires" : `Expires ${formatDate(s.expiresAt)}`}
                </p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

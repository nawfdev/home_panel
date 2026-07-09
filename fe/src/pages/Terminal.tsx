import { useEffect, useRef, useState } from "react";
import { Panel } from "../components/ui/Panel";
import { ArrowPathIcon, TrashIcon } from "@heroicons/react/24/outline";

const ANSI_COLORS: Record<string, string> = {
  "30": "#2e3436",
  "31": "#cc0000",
  "32": "#4e9a06",
  "33": "#c4a000",
  "34": "#3465a4",
  "35": "#75507b",
  "36": "#06989a",
  "37": "#d3d7cf",
  "90": "#555753",
  "91": "#ef2929",
  "92": "#8ae234",
  "93": "#fce94f",
  "94": "#729fcf",
  "95": "#ad7fa8",
  "96": "#34e2e2",
  "97": "#eeeeec",
};

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  let escaped = div.innerHTML;
  escaped = escaped.replace(/\x1b\[(\d+)m|&#x1b;\[(\d+)m|\[(\d+)m/g, (_match, c1, c2, c3) => {
    const code = c1 || c2 || c3;
    if (code === "0" || code === "00") return "</span>";
    const color = ANSI_COLORS[code];
    return color ? `<span style="color:${color}">` : "";
  });
  escaped = escaped.replace(/\x1b\[\d*;?\d*m/g, "");
  escaped = escaped.replace(/&#x1b;\[\d*;?\d*m/g, "");
  return escaped;
}

export function Terminal() {
  const outputRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [command, setCommand] = useState("");

  function append(html: string) {
    if (outputRef.current) {
      outputRef.current.innerHTML += html;
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }

  function connect() {
    if (outputRef.current) outputRef.current.innerHTML = '<div style="color:#4ade80">Connecting to terminal...</div>';
    wsRef.current?.close();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/terminal`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (outputRef.current) outputRef.current.innerHTML = "";
      append('<div style="color:#4ade80">&check; Terminal connected</div>\n');
      setConnected(true);
    };
    ws.onmessage = (event) => {
      if (event.data === "AUTH_FAILED") {
        ws.close(4001);
        return;
      }
      append(escapeHtml(event.data));
    };
    ws.onclose = () => {
      setConnected(false);
      append('<div style="color:#f87171">&#10007; Terminal disconnected</div>\n');
    };
  }

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sendCommand() {
    if (!command.trim()) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      append('<div style="color:#f87171">&#10007; Not connected. Reconnecting...</div>\n');
      connect();
      return;
    }
    wsRef.current.send(command + "\n");
    setCommand("");
  }

  function clearTerminal() {
    if (outputRef.current) outputRef.current.innerHTML = "";
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send("clear\n");
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Terminal</h2>
          <p className="text-gray-500 text-sm mt-1">Shell access to this host over WebSocket</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={`metric-dot ${connected ? "text-green-400" : "text-red-400"}`} />
          <span className="text-gray-300">{connected ? "Connected" : "Disconnected"}</span>
        </div>
      </div>

      <Panel>
        <div className="flex justify-end gap-2 mb-3">
          <button className="btn-secondary" onClick={clearTerminal}>
            <TrashIcon className="w-4 h-4 inline mr-1.5" />Clear
          </button>
          <button className="btn-secondary" onClick={connect}>
            <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Reconnect
          </button>
        </div>
        <div
          ref={outputRef}
          className="bg-black/40 rounded-lg p-4 h-[420px] overflow-y-auto font-mono text-xs whitespace-pre-wrap text-gray-300 mb-3"
        />
        <div className="flex gap-2">
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendCommand()}
            placeholder="Type a command..."
            className="input-field flex-1 font-mono text-sm"
          />
          <button className="btn-primary" onClick={sendCommand}>
            Send
          </button>
        </div>
      </Panel>
    </div>
  );
}

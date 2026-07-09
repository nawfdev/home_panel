import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { ArrowPathIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";

interface TelegramStatus {
  connected: boolean;
  configured: boolean;
  monitoring: boolean;
  chatId?: string;
  tokenHint?: string;
  notificationsEnabled: boolean;
}

export function Telegram() {
  const { show } = useToast();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function load() {
    try {
      const data = await api<TelegramStatus>("/telegram/status");
      setStatus(data);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load status", "error");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendTest() {
    if (!message.trim()) {
      show("Please enter a message", "warning");
      return;
    }
    setSending(true);
    try {
      const data = await api<{ success: boolean; error?: string }>("/telegram/test", {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      if (data.success) {
        show("Test message sent", "success");
      } else {
        show(data.error ?? "Failed to send message", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to send message", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Telegram</h2>
          <p className="text-gray-500 text-sm mt-1">Bot status and notification delivery</p>
        </div>
        <button className="btn-secondary" onClick={load}>
          <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
        </button>
      </div>

      <div className="space-y-4">
        <Panel title="Bot status">
          {status === null ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : status.connected ? (
            <div className="info-row">
              <span className="info-row-label">Status</span>
              <span className="info-row-value text-green-400">Connected</span>
            </div>
          ) : status.configured ? (
            <div className="info-row">
              <span className="info-row-label">Status</span>
              <span className="info-row-value text-yellow-400">Configured but not connected</span>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Not configured. Add your bot token in Settings to enable this page.
            </p>
          )}
          {status?.connected && (
            <div className="info-row">
              <span className="info-row-label">Monitoring</span>
              <span className={`info-row-value ${status.monitoring ? "text-green-400" : "text-gray-500"}`}>
                {status.monitoring ? "Active" : "Inactive"}
              </span>
            </div>
          )}
        </Panel>

        <Panel title="Configuration">
          <div className="info-row">
            <span className="info-row-label">Bot token</span>
            <span className="info-row-value font-mono">
              {status?.configured ? `••••••••${status.tokenHint ?? ""}` : "Not set"}
            </span>
          </div>
          <div className="info-row">
            <span className="info-row-label">Chat ID</span>
            <span className="info-row-value font-mono">{status?.chatId ?? "Not set"}</span>
          </div>
          <div className="info-row">
            <span className="info-row-label">Notifications</span>
            <span className={`info-row-value ${status?.notificationsEnabled ? "text-green-400" : "text-gray-500"}`}>
              {status?.notificationsEnabled ? "Enabled" : "Disabled"}
            </span>
          </div>
        </Panel>

        <Panel title="Send test message">
          <div className="flex flex-col md:flex-row gap-2">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Test message text"
              className="input-field flex-1"
            />
            <button className="btn-primary disabled:opacity-60" onClick={sendTest} disabled={sending}>
              <PaperAirplaneIcon className="w-4 h-4 inline mr-1.5" />
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

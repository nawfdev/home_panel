import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { Panel } from "../components/ui/Panel";
import {
  PuzzlePieceIcon,
  CloudIcon,
  PaperAirplaneIcon,
  LanguageIcon,
} from "@heroicons/react/24/outline";

export function Integrations() {
  const { show } = useToast();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";

  const [cfApiToken, setCfApiToken] = useState("");
  const [cfAccountId, setCfAccountId] = useState("");
  const [cfTokenPlaceholder, setCfTokenPlaceholder] = useState("Paste token here");
  const [savingCf, setSavingCf] = useState(false);

  const [tgBotToken, setTgBotToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgTokenPlaceholder, setTgTokenPlaceholder] = useState("123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11");
  const [savingTg, setSavingTg] = useState(false);

  const [subsourceKey, setSubsourceKey] = useState("");
  const [subsourceKeyPlaceholder, setSubsourceKeyPlaceholder] = useState("Paste your subsource.net API key");
  const [savingSubsource, setSavingSubsource] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    api<{ hasToken: boolean; accountId?: string }>("/settings/cloudflare")
      .then((res) => {
        if (res.hasToken) setCfTokenPlaceholder("••••••••  (configured)");
        if (res.accountId) setCfAccountId(res.accountId);
      })
      .catch(() => {});
    api<{ botTokenConfigured: boolean; chatId: string; enableNotifications: boolean }>("/settings/telegram")
      .then((res) => {
        if (res.botTokenConfigured) setTgTokenPlaceholder("••••••••  (configured)");
        setTgChatId(res.chatId || "");
        setTgEnabled(res.enableNotifications);
      })
      .catch(() => {});
    api<{ configured: boolean }>("/settings/subsource")
      .then((res) => {
        if (res.configured) setSubsourceKeyPlaceholder("••••••••  (configured)");
      })
      .catch(() => {});
  }, [isAdmin]);

  async function saveCloudflare() {
    setSavingCf(true);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/settings/cloudflare", {
        method: "POST",
        body: JSON.stringify({ apiToken: cfApiToken, accountId: cfAccountId }),
      });
      if (data.success) {
        show(data.message ?? "Cloudflare integration verified successfully", "success");
        setCfTokenPlaceholder("••••••••  (configured)");
        setCfApiToken("");
      } else {
        show(data.error ?? "Failed to verify Cloudflare token", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save Cloudflare settings", "error");
    } finally {
      setSavingCf(false);
    }
  }

  async function saveTelegram() {
    setSavingTg(true);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/settings/telegram", {
        method: "POST",
        body: JSON.stringify({ botToken: tgBotToken, chatId: tgChatId, enableNotifications: tgEnabled }),
      });
      if (data.success) {
        show(data.message ?? "Telegram settings saved and tested", "success");
        setTgTokenPlaceholder("••••••••  (configured)");
        setTgBotToken("");
      } else {
        show(data.error ?? "Failed to save Telegram settings", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save Telegram settings", "error");
    } finally {
      setSavingTg(false);
    }
  }

  async function saveSubsource() {
    setSavingSubsource(true);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/settings/subsource", {
        method: "POST",
        body: JSON.stringify({ apiKey: subsourceKey }),
      });
      if (data.success) {
        show(data.message ?? "Subsource API key saved successfully", "success");
        setSubsourceKeyPlaceholder("••••••••  (configured)");
        setSubsourceKey("");
      } else {
        show(data.error ?? "Failed to save API key", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save API key", "error");
    } finally {
      setSavingSubsource(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
          <PuzzlePieceIcon className="w-7 h-7 text-blue-400" />
          Integrations
        </h2>
        <p className="text-gray-500 text-sm mt-0.5">
          Connect external cloud APIs, notification channels, and media metadata providers
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cloudflare Panel */}
        <Panel title="Cloudflare API integration">
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
            <CloudIcon className="w-4 h-4 text-blue-400 shrink-0" />
            <span>Allows Nestcore to automate zero-trust tunnels, DNS records, and custom domains.</span>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-gray-400 text-xs font-semibold mb-1">API Token</label>
              <input
                type="password"
                value={cfApiToken}
                onChange={(e) => setCfApiToken(e.target.value)}
                placeholder={cfTokenPlaceholder}
                className="input-field w-full text-sm"
              />
              <p className="text-[11px] text-gray-500 mt-1">Requires Account:Tunnel:Edit and Zone:DNS:Edit scopes</p>
            </div>
            <div>
              <label className="block text-gray-400 text-xs font-semibold mb-1">Account ID (optional)</label>
              <input
                value={cfAccountId}
                onChange={(e) => setCfAccountId(e.target.value)}
                placeholder="From Cloudflare dashboard URL"
                className="input-field w-full text-sm"
              />
            </div>
          </div>
          <button
            className="btn-primary w-full mt-5 text-xs disabled:opacity-60 flex items-center justify-center gap-1.5"
            onClick={saveCloudflare}
            disabled={savingCf}
          >
            {savingCf ? "Verifying token..." : "Save & verify token"}
          </button>
        </Panel>

        {/* Telegram Panel */}
        <Panel title="Telegram bot alerts">
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
            <PaperAirplaneIcon className="w-4 h-4 text-blue-400 shrink-0" />
            <span>Sends real-time push alerts for high resource load, tunnel downtime, and logins.</span>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-gray-400 text-xs font-semibold mb-1">Bot Token</label>
              <input
                type="password"
                value={tgBotToken}
                onChange={(e) => setTgBotToken(e.target.value)}
                placeholder={tgTokenPlaceholder}
                className="input-field w-full text-sm"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-xs font-semibold mb-1">Chat ID</label>
              <input
                value={tgChatId}
                onChange={(e) => setTgChatId(e.target.value)}
                placeholder="e.g. 123456789"
                className="input-field w-full text-sm font-mono"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-300 pt-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={tgEnabled}
                onChange={(e) => setTgEnabled(e.target.checked)}
                className="accent-blue-500 rounded"
              />
              Enable Telegram push notifications
            </label>
          </div>
          <button
            className="btn-primary w-full mt-5 text-xs disabled:opacity-60 flex items-center justify-center gap-1.5"
            onClick={saveTelegram}
            disabled={savingTg}
          >
            {savingTg ? "Testing bot..." : "Save & send test message"}
          </button>
        </Panel>

        {/* Subtitles Panel */}
        <div className="lg:col-span-2">
          <Panel title="Subtitle provider (subsource.net)">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
              <LanguageIcon className="w-4 h-4 text-blue-400 shrink-0" />
              <span>
                Powers instant subtitle search and one-click downloads on the Stream player page. Free API keys available at{" "}
                <a href="https://subsource.net" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  subsource.net
                </a>.
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="password"
                value={subsourceKey}
                onChange={(e) => setSubsourceKey(e.target.value)}
                placeholder={subsourceKeyPlaceholder}
                className="input-field flex-1 text-sm"
              />
              <button
                className="btn-primary text-xs disabled:opacity-60 shrink-0"
                onClick={saveSubsource}
                disabled={savingSubsource}
              >
                {savingSubsource ? "Saving..." : "Save API key"}
              </button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

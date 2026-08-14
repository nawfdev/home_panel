import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  ArrowPathIcon,
  TrashIcon,
  PlusIcon,
  XMarkIcon,
  CommandLineIcon,
  Squares2X2Icon,
  Square2StackIcon,
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
  ClipboardDocumentIcon,
  Cog6ToothIcon,
  ServerIcon,
  PlayIcon,
  SparklesIcon,
  ChevronDownIcon,
  ArrowUpTrayIcon,
  BookmarkIcon,
} from "@heroicons/react/24/outline";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Modal } from "../components/ui/Modal";
import type { Host } from "../lib/hosts";

// Termius-inspired color palettes
interface Theme {
  id: string;
  name: string;
  bg: string;
  headerBg: string;
  text: string;
  prompt: string;
  cursor: string;
  border: string;
  selection: string;
}

const THEMES: Record<string, Theme> = {
  termius: {
    id: "termius",
    name: "Termius Dark",
    bg: "#111625",
    headerBg: "#0b0e17",
    text: "#d1d5db",
    prompt: "#38bdf8",
    cursor: "#38bdf8",
    border: "#1e293b",
    selection: "#334155",
  },
  dracula: {
    id: "dracula",
    name: "Dracula",
    bg: "#282a36",
    headerBg: "#1e1f29",
    text: "#f8f8f2",
    prompt: "#50fa7b",
    cursor: "#f8f8f2",
    border: "#44475a",
    selection: "#44475a",
  },
  nord: {
    id: "nord",
    name: "Nord",
    bg: "#2e3440",
    headerBg: "#242933",
    text: "#eceff4",
    prompt: "#88c0d0",
    cursor: "#88c0d0",
    border: "#3b4252",
    selection: "#434c5e",
  },
  tokyo: {
    id: "tokyo",
    name: "Tokyo Night",
    bg: "#1a1b26",
    headerBg: "#16161e",
    text: "#a9b1d6",
    prompt: "#7aa2f7",
    cursor: "#c0caf5",
    border: "#292e42",
    selection: "#33467c",
  },
  catppuccin: {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    bg: "#1e1e2e",
    headerBg: "#181825",
    text: "#cdd6f4",
    prompt: "#a6e3a1",
    cursor: "#f5e0dc",
    border: "#313244",
    selection: "#45475a",
  },
  onedark: {
    id: "onedark",
    name: "One Dark",
    bg: "#1e2227",
    headerBg: "#181a1f",
    text: "#abb2bf",
    prompt: "#61afef",
    cursor: "#528bff",
    border: "#282c34",
    selection: "#3e4451",
  },
};

const DEFAULT_SNIPPETS = [
  { id: "def-1", label: "System overview", cmd: "top -bn1 | head -15" },
  { id: "def-2", label: "Docker containers", cmd: "docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'" },
  { id: "def-3", label: "Disk usage", cmd: "df -h" },
  { id: "def-4", label: "Memory free", cmd: "free -h" },
  { id: "def-5", label: "Network interfaces", cmd: "ip -brief address" },
  { id: "def-6", label: "System logs", cmd: "journalctl -n 25 --no-pager" },
  { id: "def-7", label: "Open ports", cmd: "ss -tulpn | grep LISTEN" },
  { id: "def-8", label: "Kernel info", cmd: "uname -a && uptime" },
];

const ANSI_COLORS: Record<string, string> = {
  "30": "#2e3436",
  "31": "#ef4444",
  "32": "#22c55e",
  "33": "#eab308",
  "34": "#3b82f6",
  "35": "#a855f7",
  "36": "#06b6d4",
  "37": "#f3f4f6",
  "90": "#6b7280",
  "91": "#f87171",
  "92": "#4ade80",
  "93": "#facc15",
  "94": "#60a5fa",
  "95": "#c084fc",
  "96": "#22d3ee",
  "97": "#ffffff",
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

interface Session {
  id: string;
  hostId: number;
  title: string;
  connected: boolean;
  history: string[];
  historyIndex: number;
}

interface CustomSnippet {
  id: string;
  label: string;
  cmd: string;
  category?: string;
  description?: string;
}

export function Terminal() {
  const { show } = useToast();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [sessions, setSessions] = useState<Session[]>([
    { id: "s-local", hostId: 0, title: "Local Host", connected: false, history: [], historyIndex: -1 },
  ]);
  const [activeSessionId, setActiveSessionId] = useState<string>("s-local");
  const [splitView, setSplitView] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeId, setThemeId] = useState<string>(() => localStorage.getItem("hp_term_theme") || "termius");
  const [fontSize, setFontSize] = useState<number>(() => Number(localStorage.getItem("hp_term_size")) || 13);
  const [fontFamily, setFontFamily] = useState<string>(() => localStorage.getItem("hp_term_font") || "monospace");
  const [command, setCommand] = useState("");
  const [showHostPicker, setShowHostPicker] = useState(false);

  // Drag & Drop SFTP Upload State
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  // Custom Snippets State
  const [customSnippets, setCustomSnippets] = useState<CustomSnippet[]>([]);
  const [snippetModalOpen, setSnippetModalOpen] = useState(false);
  const [newSnipLabel, setNewSnipLabel] = useState("");
  const [newSnipCmd, setNewSnipCmd] = useState("");

  const outputRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const wsRefs = useRef<Map<string, WebSocket>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  const activeTheme = THEMES[themeId] || THEMES.termius;

  // Load hosts & custom snippets
  useEffect(() => {
    api<Host[]>("/hosts").then(setHosts).catch(() => setHosts([]));
    api<{ success: boolean; snippets: CustomSnippet[] }>("/snippets")
      .then((res) => setCustomSnippets(res.snippets || []))
      .catch(() => {});
  }, []);

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem("hp_term_theme", themeId);
    localStorage.setItem("hp_term_size", String(fontSize));
    localStorage.setItem("hp_term_font", fontFamily);
  }, [themeId, fontSize, fontFamily]);

  const appendOutput = useCallback((sessionId: string, html: string) => {
    const el = outputRefs.current.get(sessionId);
    if (el) {
      el.innerHTML += html;
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const connectSession = useCallback((sessionId: string, hostId: number) => {
    const existingWs = wsRefs.current.get(sessionId);
    if (existingWs) {
      existingWs.close();
      wsRefs.current.delete(sessionId);
    }

    appendOutput(sessionId, '<div style="color:#60a5fa" class="py-1">⚡ Connecting to shell...</div>');

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const query = hostId === 0 ? "" : `?host=${hostId}`;
    const ws = new WebSocket(`${protocol}//${window.location.host}/terminal/ws${query}`);
    wsRefs.current.set(sessionId, ws);

    ws.onopen = () => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, connected: true } : s))
      );
    };

    ws.onmessage = (event) => {
      if (event.data === "AUTH_FAILED") {
        ws.close(4001);
        return;
      }
      appendOutput(sessionId, escapeHtml(event.data));
    };

    ws.onclose = () => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, connected: false } : s))
      );
      appendOutput(sessionId, '<div style="color:#f87171" class="py-1">✕ Terminal disconnected</div>');
    };
  }, [appendOutput]);

  // Connect active session when created
  useEffect(() => {
    sessions.forEach((s) => {
      if (!wsRefs.current.has(s.id)) {
        connectSession(s.id, s.hostId);
      }
    });
  }, [sessions, connectSession]);

  // Cleanup on unmount
  useEffect(() => {
    const currentWs = wsRefs.current;
    return () => {
      currentWs.forEach((ws) => ws.close());
      currentWs.clear();
    };
  }, []);

  function sendCommandToSession(sessionId: string, cmdToSend?: string) {
    const text = cmdToSend !== undefined ? cmdToSend : command;
    if (!text.trim()) return;

    const ws = wsRefs.current.get(sessionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      const sess = sessions.find((s) => s.id === sessionId);
      if (sess) {
        appendOutput(sessionId, '<div style="color:#f87171">✕ Not connected. Reconnecting...</div>\n');
        connectSession(sessionId, sess.hostId);
      }
      return;
    }

    ws.send(text + "\n");

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === sessionId) {
          const newHist = [text, ...s.history.filter((h) => h !== text)].slice(0, 50);
          return { ...s, history: newHist, historyIndex: -1 };
        }
        return s;
      })
    );

    if (cmdToSend === undefined) {
      setCommand("");
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const sess = sessions.find((s) => s.id === activeSessionId);
    if (!sess) return;

    if (e.key === "Enter") {
      sendCommandToSession(activeSessionId);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (sess.history.length === 0) return;
      const nextIdx = Math.min(sess.historyIndex + 1, sess.history.length - 1);
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSessionId ? { ...s, historyIndex: nextIdx } : s))
      );
      setCommand(sess.history[nextIdx] || "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (sess.historyIndex <= 0) {
        setSessions((prev) =>
          prev.map((s) => (s.id === activeSessionId ? { ...s, historyIndex: -1 } : s))
        );
        setCommand("");
      } else {
        const nextIdx = sess.historyIndex - 1;
        setSessions((prev) =>
          prev.map((s) => (s.id === activeSessionId ? { ...s, historyIndex: nextIdx } : s))
        );
        setCommand(sess.history[nextIdx] || "");
      }
    }
  }

  function addSession(hostId: number) {
    const targetHost = hosts.find((h) => h.id === hostId);
    const newId = `s-${Date.now()}`;
    const title = hostId === 0 ? `Local (${sessions.length + 1})` : targetHost?.name || `Host #${hostId}`;
    const newSession: Session = {
      id: newId,
      hostId,
      title,
      connected: false,
      history: [],
      historyIndex: -1,
    };
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(newId);
    setShowHostPicker(false);
    show(`Session created: ${title}`, "success", 2000);
  }

  function closeSession(sessionId: string) {
    if (sessions.length <= 1) {
      show("Cannot close the only open session", "warning");
      return;
    }
    const ws = wsRefs.current.get(sessionId);
    if (ws) {
      ws.close();
      wsRefs.current.delete(sessionId);
    }
    const remaining = sessions.filter((s) => s.id !== sessionId);
    setSessions(remaining);
    if (activeSessionId === sessionId) {
      setActiveSessionId(remaining[0].id);
    }
  }

  function clearOutput(sessionId: string) {
    const el = outputRefs.current.get(sessionId);
    if (el) el.innerHTML = "";
    const ws = wsRefs.current.get(sessionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send("clear\n");
    }
  }

  function copyBuffer(sessionId: string) {
    const el = outputRefs.current.get(sessionId);
    if (el) {
      const text = el.innerText || el.textContent || "";
      navigator.clipboard.writeText(text).then(() => {
        show("Terminal output copied to clipboard", "success", 2000);
      });
    }
  }

  function toggleFullscreen() {
    if (!terminalContainerRef.current) return;
    if (!document.fullscreenElement) {
      terminalContainerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }

  // --- Drag & Drop SFTP Upload Handler ---

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const sess = sessions.find((s) => s.id === activeSessionId) || sessions[0];

    const fd = new FormData();
    fd.append("file", file);
    fd.append("hostId", String(sess.hostId));

    setUploadingFile(true);
    show(`Uploading ${file.name} to ${sess.title}...`, "info", 3000);

    try {
      const res = await fetch("/api/terminal/upload", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      show(`File ${file.name} uploaded successfully!`, "success", 4000);
      appendOutput(
        sess.id,
        `<div style="color:#4ade80" class="py-1">✓ File "${data.fileName}" uploaded to ${data.path} (${data.size} bytes)</div>\n`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      show(msg, "error");
      appendOutput(sess.id, `<div style="color:#f87171" class="py-1">✕ File upload failed: ${msg}</div>\n`);
    } finally {
      setUploadingFile(false);
    }
  }

  // --- Custom Snippet Handlers ---

  async function addCustomSnippet() {
    if (!newSnipLabel.trim() || !newSnipCmd.trim()) {
      show("Label and command are required", "warning");
      return;
    }
    try {
      const res = await api<{ success: boolean; snippet: CustomSnippet }>("/snippets", {
        method: "POST",
        body: JSON.stringify({ label: newSnipLabel.trim(), cmd: newSnipCmd.trim() }),
      });
      setCustomSnippets((prev) => [...prev, res.snippet]);
      setNewSnipLabel("");
      setNewSnipCmd("");
      show("Snippet saved", "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save snippet", "error");
    }
  }

  async function deleteCustomSnippet(id: string) {
    try {
      await api(`/snippets/${id}`, { method: "DELETE" });
      setCustomSnippets((prev) => prev.filter((s) => s.id !== id));
      show("Snippet deleted", "success");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to delete snippet", "error");
    }
  }

  const allSnippets = [...customSnippets, ...DEFAULT_SNIPPETS];
  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const activeHost = hosts.find((h) => h.id === activeSession?.hostId);

  return (
    <div className={`space-y-4 ${isFullscreen ? "p-4 bg-[#0a0d14] fixed inset-0 z-50 overflow-hidden" : ""}`}>
      {/* Top Header */}
      {!isFullscreen && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
                <CommandLineIcon className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
                  Terminal
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono font-normal">
                    Termius Edition
                  </span>
                </h2>
                <p className="text-gray-500 text-xs mt-0.5">
                  Multi-host remote SSH console &middot; Drag-and-drop SFTP uploads &middot; Custom Snippets
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Snippets Manager Button */}
            <button
              className="btn-secondary text-xs !py-1.5 !px-2.5 flex items-center gap-1.5"
              onClick={() => setSnippetModalOpen(true)}
              title="Manage custom command snippets"
            >
              <BookmarkIcon className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">Snippets</span>
            </button>

            {/* Split view toggle */}
            <button
              className={`btn-secondary text-xs !py-1.5 !px-2.5 flex items-center gap-1.5 ${
                splitView ? "!bg-blue-500/20 !border-blue-500/40 text-blue-300" : ""
              }`}
              onClick={() => setSplitView(!splitView)}
              title="Toggle side-by-side split view"
            >
              {splitView ? <Squares2X2Icon className="w-4 h-4" /> : <Square2StackIcon className="w-4 h-4" />}
              <span className="hidden sm:inline">{splitView ? "Single view" : "Split view"}</span>
            </button>

            {/* Appearance Settings */}
            <button
              className="btn-secondary text-xs !py-1.5 !px-2.5 flex items-center gap-1.5"
              onClick={() => setSettingsOpen(!settingsOpen)}
              title="Terminal appearance & themes"
            >
              <Cog6ToothIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Theme & font</span>
            </button>

            {/* Fullscreen */}
            <button
              className="btn-secondary text-xs !py-1.5 !px-2.5 flex items-center gap-1.5"
              onClick={toggleFullscreen}
              title="Toggle fullscreen terminal"
            >
              {isFullscreen ? <ArrowsPointingInIcon className="w-4 h-4" /> : <ArrowsPointingOutIcon className="w-4 h-4" />}
              <span className="hidden sm:inline">Fullscreen</span>
            </button>
          </div>
        </div>
      )}

      {/* Settings Drawer / Popover */}
      {settingsOpen && (
        <div className="bg-[#121624] border border-white/10 rounded-xl p-4 shadow-2xl grid grid-cols-1 sm:grid-cols-3 gap-4 animate-in fade-in duration-200">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Color theme</label>
            <select
              value={themeId}
              onChange={(e) => setThemeId(e.target.value)}
              className="input-field w-full text-xs"
            >
              {Object.values(THEMES).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Font family</label>
            <select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              className="input-field w-full text-xs font-mono"
            >
              <option value="'JetBrains Mono', Consolas, monospace">JetBrains Mono</option>
              <option value="'Cascadia Code', Consolas, monospace">Cascadia Code</option>
              <option value="'Fira Code', Consolas, monospace">Fira Code</option>
              <option value="Consolas, monospace">Consolas</option>
              <option value="monospace">Default Monospace</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">
              Font size: <span className="text-blue-400">{fontSize}px</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={11}
                max={18}
                step={1}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <span className="text-xs text-gray-400 w-6 text-right">{fontSize}</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Termius Window Container */}
      <div
        ref={terminalContainerRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`rounded-xl overflow-hidden border shadow-2xl flex flex-col relative transition-all duration-200 ${
          isFullscreen ? "h-full" : "h-[620px]"
        }`}
        style={{
          backgroundColor: activeTheme.bg,
          borderColor: activeTheme.border,
        }}
      >
        {/* Drag & Drop SFTP Upload Overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-30 bg-blue-900/80 backdrop-blur-sm border-2 border-dashed border-blue-400 flex flex-col items-center justify-center space-y-3 pointer-events-none animate-in fade-in duration-150">
            <ArrowUpTrayIcon className="w-12 h-12 text-blue-200 animate-bounce" />
            <p className="text-base font-bold text-white">Drop file to upload via SFTP</p>
            <p className="text-xs text-blue-200">
              Uploading to active host: <span className="font-mono font-bold">{activeSession.title}</span>
            </p>
          </div>
        )}

        {/* Termius Window Title Bar / Tabs Header */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b select-none overflow-x-auto gap-2"
          style={{
            backgroundColor: activeTheme.headerBg,
            borderColor: activeTheme.border,
          }}
        >
          {/* macOS / Termius Traffic Light Window Buttons */}
          <div className="flex items-center gap-1.5 shrink-0 pr-2">
            <span className="w-3 h-3 rounded-full bg-[#ff5f56] inline-block shadow-sm" />
            <span className="w-3 h-3 rounded-full bg-[#ffbd2e] inline-block shadow-sm" />
            <span className="w-3 h-3 rounded-full bg-[#27c93f] inline-block shadow-sm" />
          </div>

          {/* Session Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-1">
            {sessions.map((s) => {
              const isActive = s.id === activeSessionId;
              const host = hosts.find((h) => h.id === s.hostId);
              return (
                <div
                  key={s.id}
                  onClick={() => setActiveSessionId(s.id)}
                  className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all duration-150 border shrink-0 ${
                    isActive
                      ? "bg-white/10 text-white border-white/20 shadow-md"
                      : "bg-transparent text-gray-400 hover:text-gray-200 hover:bg-white/5 border-transparent"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      s.connected ? "bg-emerald-400 animate-pulse" : "bg-rose-400"
                    }`}
                  />
                  <ServerIcon className="w-3.5 h-3.5 opacity-70 shrink-0" />
                  <span className="truncate max-w-32 font-mono">
                    {s.title}
                  </span>
                  {host && (
                    <span className="text-[10px] text-gray-500 font-mono hidden md:inline">
                      ({host.user}@{host.address})
                    </span>
                  )}
                  {sessions.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeSession(s.id);
                      }}
                      className="p-0.5 rounded hover:bg-white/20 text-gray-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <XMarkIcon className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}

            {/* New Session Button */}
            <div className="relative shrink-0">
              <button
                onClick={() => setShowHostPicker(!showHostPicker)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 transition-colors"
                title="Open new terminal session"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">New tab</span>
                <ChevronDownIcon className="w-3 h-3 ml-0.5 opacity-60" />
              </button>

              {/* Host Picker Dropdown */}
              {showHostPicker && (
                <div className="absolute top-full left-0 mt-1.5 w-60 bg-[#151928] border border-white/15 rounded-xl shadow-2xl p-1.5 z-30 space-y-1 animate-in fade-in duration-150">
                  <div className="px-2 py-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    Select target host
                  </div>
                  <button
                    onClick={() => addSession(0)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left text-gray-200 hover:bg-blue-600/20 hover:text-blue-300 transition-colors"
                  >
                    <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">Local Host (Server)</div>
                      <div className="text-[10px] text-gray-500 font-mono">localhost (direct bash)</div>
                    </div>
                  </button>
                  {hosts.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => addSession(h.id)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-left text-gray-200 hover:bg-blue-600/20 hover:text-blue-300 transition-colors"
                    >
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate">{h.name}</div>
                        <div className="text-[10px] text-gray-500 font-mono truncate">
                          {h.user}@{h.address}:{h.port}
                        </div>
                      </div>
                    </button>
                  ))}
                  {hosts.length === 0 && (
                    <p className="px-2.5 py-2 text-[11px] text-gray-500 italic">No remote SSH hosts configured</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions in Header */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => copyBuffer(activeSessionId)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Copy output to clipboard"
            >
              <ClipboardDocumentIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => clearOutput(activeSessionId)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Clear terminal buffer"
            >
              <TrashIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => connectSession(activeSessionId, activeSession.hostId)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Reconnect active session"
            >
              <ArrowPathIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick Snippets Bar (Termius Quick Actions) */}
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 overflow-x-auto border-b scrollbar-none text-xs"
          style={{
            backgroundColor: activeTheme.headerBg,
            borderColor: activeTheme.border,
          }}
        >
          <span className="text-[11px] font-semibold text-gray-500 shrink-0 flex items-center gap-1 mr-1">
            <SparklesIcon className="w-3.5 h-3.5 text-blue-400" />
            Snippets:
          </span>
          {allSnippets.map((snip) => (
            <button
              key={snip.id || snip.label}
              onClick={() => sendCommandToSession(activeSessionId, snip.cmd)}
              className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-white/5 hover:bg-blue-500/20 text-gray-300 hover:text-blue-300 border border-white/5 hover:border-blue-500/30 transition-all shrink-0 flex items-center gap-1"
              title={`Execute: ${snip.cmd}`}
            >
              <PlayIcon className="w-2.5 h-2.5 opacity-60" />
              {snip.label}
            </button>
          ))}
          <button
            onClick={() => setSnippetModalOpen(true)}
            className="px-2 py-1 rounded-md text-[11px] text-gray-400 hover:text-white hover:bg-white/10 border border-dashed border-white/15 transition shrink-0 flex items-center gap-1"
            title="Create custom snippet"
          >
            <PlusIcon className="w-3 h-3" />
            Add snippet
          </button>
        </div>

        {/* Terminal Screen Windows (Single or Split View) */}
        <div
          className={`flex-1 overflow-hidden grid ${
            splitView && sessions.length > 1
              ? "grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/10"
              : "grid-cols-1"
          }`}
        >
          {sessions
            .filter((s) => (!splitView ? s.id === activeSessionId : true))
            .slice(0, splitView ? 2 : 1)
            .map((s) => (
              <div
                key={s.id}
                className="h-full flex flex-col relative overflow-hidden"
                style={{ backgroundColor: activeTheme.bg }}
                onClick={() => {
                  setActiveSessionId(s.id);
                  inputRef.current?.focus();
                }}
              >
                {/* Host session sub-header in split view */}
                {splitView && (
                  <div className="px-3 py-1 bg-black/40 text-[11px] font-mono text-gray-400 flex items-center justify-between border-b border-white/5">
                    <span className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${s.connected ? "bg-emerald-400" : "bg-rose-400"}`} />
                      {s.title}
                    </span>
                    <button onClick={() => clearOutput(s.id)} className="text-gray-500 hover:text-gray-300 text-[10px]">
                      Clear
                    </button>
                  </div>
                )}

                {/* Output Screen */}
                <div
                  ref={(el) => {
                    if (el) outputRefs.current.set(s.id, el);
                    else outputRefs.current.delete(s.id);
                  }}
                  className="flex-1 p-4 overflow-y-auto font-mono whitespace-pre-wrap select-text focus:outline-none scrollbar-thin scrollbar-thumb-white/10"
                  style={{
                    fontSize: `${fontSize}px`,
                    fontFamily: fontFamily,
                    color: activeTheme.text,
                    lineHeight: "1.45",
                  }}
                />
              </div>
            ))}
        </div>

        {/* Termius Interactive Virtual Keys Bar */}
        <div
          className="flex items-center gap-1 px-3 py-1.5 border-t overflow-x-auto scrollbar-none"
          style={{
            backgroundColor: activeTheme.headerBg,
            borderColor: activeTheme.border,
          }}
        >
          <span className="text-[10px] uppercase font-bold text-gray-500 shrink-0 mr-1">Keys:</span>
          {[
            { label: "Ctrl+C", cmd: "\x03" },
            { label: "Tab", key: "Tab" },
            { label: "Esc", key: "Escape" },
            { label: "↑ Prev", key: "ArrowUp" },
            { label: "↓ Next", key: "ArrowDown" },
            { label: "Clear", cmd: "clear" },
            { label: "Exit", cmd: "exit" },
          ].map((k) => (
            <button
              key={k.label}
              onClick={() => {
                if (k.cmd) {
                  sendCommandToSession(activeSessionId, k.cmd);
                } else if (k.key === "ArrowUp" || k.key === "ArrowDown") {
                  handleKeyDown({
                    key: k.key,
                    preventDefault: () => {},
                  } as KeyboardEvent<HTMLInputElement>);
                }
              }}
              className="px-2 py-1 rounded bg-white/5 hover:bg-white/15 text-gray-300 text-[11px] font-mono border border-white/5 transition-colors shrink-0 shadow-sm"
            >
              {k.label}
            </button>
          ))}
        </div>

        {/* Command Input Prompt Bar */}
        <div
          className="p-3 border-t flex items-center gap-2"
          style={{
            backgroundColor: activeTheme.headerBg,
            borderColor: activeTheme.border,
          }}
        >
          <div className="flex items-center gap-1 text-xs font-mono shrink-0 select-none">
            <span style={{ color: activeTheme.prompt }} className="font-bold">
              {activeHost ? `${activeHost.user}@${activeHost.name}` : "admin@localhost"}
            </span>
            <span className="text-gray-500">:</span>
            <span className="text-emerald-400">~</span>
            <span style={{ color: activeTheme.prompt }} className="font-bold">
              $
            </span>
          </div>

          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              uploadingFile
                ? "Uploading file via SFTP..."
                : "Type a command, drag & drop a file here, or click a snippet above..."
            }
            className="flex-1 bg-transparent border-none text-gray-100 placeholder-gray-600 focus:outline-none font-mono text-sm"
            style={{
              fontFamily: fontFamily,
              fontSize: `${fontSize}px`,
              caretColor: activeTheme.cursor,
            }}
            disabled={uploadingFile}
            autoFocus
          />

          <button
            onClick={() => sendCommandToSession(activeSessionId)}
            className="btn-primary text-xs !py-1.5 !px-4 shrink-0 flex items-center gap-1"
          >
            <span>Send</span>
            <span className="text-[10px] opacity-60 font-mono hidden sm:inline">↵</span>
          </button>
        </div>
      </div>

      {/* Snippets Manager Modal */}
      {snippetModalOpen && (
        <Modal title="Custom Snippets Manager" onClose={() => setSnippetModalOpen(false)} wide>
          <div className="space-y-4">
            <p className="text-xs text-gray-400">
              Save your frequently used shell commands and one-liners for instant execution across all terminal sessions.
            </p>

            {/* Add Snippet Form */}
            <div className="p-3.5 bg-white/5 border border-white/10 rounded-xl space-y-3">
              <p className="text-xs font-bold text-gray-200">Create new snippet</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  value={newSnipLabel}
                  onChange={(e) => setNewSnipLabel(e.target.value)}
                  placeholder="Snippet label (e.g. Restart Nginx)"
                  className="input-field text-xs sm:col-span-1"
                />
                <input
                  value={newSnipCmd}
                  onChange={(e) => setNewSnipCmd(e.target.value)}
                  placeholder="Command (e.g. systemctl restart nginx)"
                  className="input-field text-xs font-mono sm:col-span-2"
                />
              </div>
              <button
                className="btn-primary text-xs flex items-center gap-1"
                onClick={addCustomSnippet}
              >
                <PlusIcon className="w-3.5 h-3.5" />
                Save snippet
              </button>
            </div>

            {/* Custom Snippets List */}
            <div className="space-y-2 max-h-72 overflow-y-auto">
              <p className="text-xs font-semibold text-gray-400">Saved snippets ({customSnippets.length})</p>
              {customSnippets.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 bg-white/5 rounded-xl p-3 border border-white/5 hover:bg-white/7 transition"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-gray-200">{s.label}</p>
                    <code className="text-[11px] text-blue-300 font-mono truncate block mt-0.5">{s.cmd}</code>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      className="btn-secondary text-xs !py-1 !px-2.5"
                      onClick={() => {
                        sendCommandToSession(activeSessionId, s.cmd);
                        setSnippetModalOpen(false);
                      }}
                      title="Run now in active terminal"
                    >
                      <PlayIcon className="w-3.5 h-3.5 inline mr-1" />
                      Run
                    </button>
                    <button
                      className="btn-danger text-xs !py-1 !px-2"
                      onClick={() => deleteCustomSnippet(s.id)}
                      title="Delete snippet"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {customSnippets.length === 0 && (
                <p className="text-xs text-gray-500 italic py-2">No custom snippets created yet.</p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

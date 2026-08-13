import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import {
  ArrowPathIcon,
  ArrowUpIcon,
  ClipboardIcon,
  Cog6ToothIcon,
  DocumentIcon,
  FolderIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  Squares2X2Icon,
  StarIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { api } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { formatBytes } from "../lib/format";
import type { Host } from "../lib/hosts";

const textEncoder = new TextEncoder();
const LOCAL_HOST: Host = { id: 0, name: "Local host", address: "localhost", port: 0, user: "", created_at: "" };

const TERMINAL_THEMES = {
  nestcore: {
    label: "Nestcore",
    background: "#090b10",
    foreground: "#d1d5db",
    cursor: "#a78bfa",
    selectionBackground: "#6d28d980",
    black: "#111827",
    brightBlack: "#6b7280",
  },
  dracula: {
    label: "Dracula",
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    selectionBackground: "#44475a",
    black: "#21222c",
    brightBlack: "#6272a4",
  },
  solarized: {
    label: "Solarized Dark",
    background: "#002b36",
    foreground: "#839496",
    cursor: "#93a1a1",
    selectionBackground: "#073642",
    black: "#073642",
    brightBlack: "#586e75",
  },
} as const;

type ThemeName = keyof typeof TERMINAL_THEMES;
type FontName = "mono" | "jetbrains" | "system";

const FONT_FAMILIES: Record<FontName, { label: string; value: string }> = {
  mono: { label: "System mono", value: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  jetbrains: { label: "JetBrains Mono", value: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace" },
  system: { label: "Cascadia", value: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace" },
};

interface Appearance {
  theme: ThemeName;
  font: FontName;
  fontSize: number;
}

interface SessionState {
  id: number;
  title: string;
  hostId: number;
  connected: boolean;
}

interface TerminalHandle {
  reconnect: () => void;
  clear: () => void;
  find: (query: string, previous: boolean) => boolean;
  copySelection: () => Promise<boolean>;
  focus: () => void;
}

interface SessionTerminalProps {
  session: SessionState;
  appearance: Appearance;
  visible: boolean;
  focused: boolean;
  hostName: string;
  onFocus: () => void;
  onStatus: (connected: boolean) => void;
  onTitle: (title: string) => void;
}

const SessionTerminal = forwardRef<TerminalHandle, SessionTerminalProps>(function SessionTerminal(
  { session, appearance, visible, focused, hostName, onFocus, onStatus, onTitle },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const sendResize = useCallback(() => {
    const terminal = terminalRef.current;
    const ws = wsRef.current;
    if (!terminal || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
  }, []);

  const connect = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const current = wsRef.current;
    wsRef.current = null;
    current?.close();
    statusRef.current(false);
    terminal.reset();
    terminal.writeln("\x1b[90mConnecting to terminal...\x1b[0m");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams({ cols: String(terminal.cols), rows: String(terminal.rows) });
    if (session.hostId !== 0) params.set("host", String(session.hostId));
    const ws = new WebSocket(`${protocol}//${window.location.host}/terminal/ws?${params}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      terminal.reset();
      statusRef.current(true);
      sendResize();
      if (visibleRef.current) terminal.focus();
    };
    ws.onmessage = async (event) => {
      if (wsRef.current !== ws) return;
      if (event.data instanceof ArrayBuffer) terminal.write(new Uint8Array(event.data));
      else if (event.data instanceof Blob) terminal.write(new Uint8Array(await event.data.arrayBuffer()));
      else terminal.write(event.data);
    };
    ws.onerror = () => {
      if (wsRef.current === ws) terminal.writeln("\r\n\x1b[31mTerminal connection failed.\x1b[0m");
    };
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      statusRef.current(false);
      terminal.writeln("\r\n\x1b[90mTerminal disconnected.\x1b[0m");
    };
  }, [sendResize, session.hostId]);

  useImperativeHandle(ref, () => ({
    reconnect: connect,
    clear: () => {
      terminalRef.current?.clear();
      terminalRef.current?.focus();
    },
    find: (query, previous) => {
      if (!query) return false;
      return previous ? searchRef.current?.findPrevious(query) ?? false : searchRef.current?.findNext(query) ?? false;
    },
    copySelection: async () => {
      const terminal = terminalRef.current;
      return terminal ? copyText(terminal.getSelection()) : false;
    },
    focus: () => terminalRef.current?.focus(),
  }), [connect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const theme = TERMINAL_THEMES[appearance.theme];
    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: false,
      fontFamily: FONT_FAMILIES[appearance.font].value,
      fontSize: appearance.fontSize,
      scrollback: 5000,
      theme,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.open(container);
    terminalRef.current = terminal;
    fitRef.current = fit;
    searchRef.current = search;

    const fitTerminal = () => {
      if (!visible) return;
      try {
        fit.fit();
        sendResize();
      } catch {
        // Hidden tabs temporarily report zero dimensions.
      }
    };
    const observer = new ResizeObserver(fitTerminal);
    observer.observe(container);
    const input = terminal.onData((data) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(textEncoder.encode(data));
    });
    const resize = terminal.onResize(sendResize);

    return () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
    // Terminal instances stay alive across tab switches; appearance updates below.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => connect(), [connect]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const container = containerRef.current;
    if (!terminal || !container) return;
    terminal.options.theme = TERMINAL_THEMES[appearance.theme];
    terminal.options.fontFamily = FONT_FAMILIES[appearance.font].value;
    terminal.options.fontSize = appearance.fontSize;
    container.style.backgroundColor = TERMINAL_THEMES[appearance.theme].background;
    if (visible) requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        sendResize();
      } catch {
        // The pane may have been hidden again before the animation frame.
      }
    });
  }, [appearance, sendResize, visible]);

  return (
    <section
      className={`${visible ? "flex" : "hidden"} min-w-0 flex-col overflow-hidden rounded-lg border ${focused ? "border-violet-500/60" : "border-white/10"}`}
      onMouseDown={onFocus}
    >
      <header className="flex h-10 items-center gap-2 border-b border-white/10 bg-gray-950/70 px-3">
        <span className={`metric-dot shrink-0 ${session.connected ? "text-green-400" : "text-red-400"}`} />
        <input
          value={session.title}
          onChange={(event) => onTitle(event.target.value)}
          aria-label="Session title"
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-gray-200 outline-none focus:text-white"
        />
        <span className="max-w-40 truncate text-xs text-gray-500" title={hostName}>{hostName}</span>
      </header>
      <div
        ref={containerRef}
        className="h-[min(58vh,610px)] min-h-[420px] overflow-hidden p-2"
        style={{ backgroundColor: TERMINAL_THEMES[appearance.theme].background }}
        aria-label={`Interactive terminal ${session.title}`}
      />
    </section>
  );
});

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

function parentPath(path: string): string {
  if (!path || path === "/") return "/";
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  const end = normalized.lastIndexOf("/");
  if (end < 1) return normalized.match(/^[A-Za-z]:/) ? `${normalized.slice(0, 2)}/` : "/";
  return normalized.slice(0, end);
}

function loadAppearance(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem("nestcore-terminal-appearance") ?? "null") as Partial<Appearance> | null;
    return {
      theme: saved?.theme && saved.theme in TERMINAL_THEMES ? saved.theme : "nestcore",
      font: saved?.font && saved.font in FONT_FAMILIES ? saved.font : "mono",
      fontSize: typeof saved?.fontSize === "number" && saved.fontSize >= 10 && saved.fontSize <= 20 ? saved.fontSize : 13,
    };
  } catch {
    return { theme: "nestcore", font: "mono", fontSize: 13 };
  }
}

export function Terminal() {
  const nextIdRef = useRef(2);
  const terminalRefs = useRef(new Map<number, TerminalHandle>());
  const [hosts, setHosts] = useState<Host[]>([]);
  const [sessions, setSessions] = useState<SessionState[]>([
    { id: 1, title: "Local shell", hostId: 0, connected: false },
  ]);
  const [activeId, setActiveId] = useState(1);
  const [splitId, setSplitId] = useState<number | null>(null);
  const [focusedId, setFocusedId] = useState(1);
  const [favorites, setFavorites] = useState<number[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("nestcore-terminal-favorites") ?? "[]") as number[];
    } catch {
      return [];
    }
  });
  const [appearance, setAppearance] = useState<Appearance>(loadAppearance);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [copyResult, setCopyResult] = useState("");
  const [sftpPath, setSftpPath] = useState("/");
  const [sftpItems, setSftpItems] = useState<FileItem[]>([]);
  const [sftpLoading, setSftpLoading] = useState(false);
  const [sftpError, setSftpError] = useState("");

  useEffect(() => {
    api<Host[]>("/hosts").then(setHosts).catch(() => setHosts([]));
  }, []);

  const allHosts = useMemo(() => [LOCAL_HOST, ...hosts], [hosts]);
  const focusedSession = sessions.find((item) => item.id === focusedId) ?? sessions[0];
  const focusedHost = allHosts.find((host) => host.id === focusedSession.hostId) ?? LOCAL_HOST;

  const updateSession = useCallback((id: number, patch: Partial<SessionState>) => {
    setSessions((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }, []);

  function addSession(hostId = 0): number {
    const id = nextIdRef.current++;
    const host = allHosts.find((item) => item.id === hostId) ?? LOCAL_HOST;
    setSessions((current) => [...current, { id, title: hostId === 0 ? `Local shell ${id}` : host.name, hostId, connected: false }]);
    setActiveId(id);
    setFocusedId(id);
    return id;
  }

  function closeSession(id: number) {
    if (sessions.length === 1) return;
    const remaining = sessions.filter((item) => item.id !== id);
    setSessions(remaining);
    terminalRefs.current.delete(id);
    if (splitId === id) setSplitId(null);
    if (activeId === id) setActiveId(remaining.find((item) => item.id !== splitId)?.id ?? remaining[0].id);
    if (focusedId === id) setFocusedId(remaining[0].id);
  }

  function toggleSplit() {
    if (splitId !== null) {
      setSplitId(null);
      setFocusedId(activeId);
      requestAnimationFrame(() => terminalRefs.current.get(activeId)?.focus());
      return;
    }
    const existing = sessions.find((item) => item.id !== activeId);
    if (existing) {
      setSplitId(existing.id);
      setFocusedId(existing.id);
    } else {
      const id = addSession(focusedSession.hostId);
      setActiveId(activeId);
      setSplitId(id);
      setFocusedId(id);
    }
  }

  function selectTab(id: number) {
    if (id === splitId) {
      setFocusedId(id);
    } else {
      setActiveId(id);
      setFocusedId(id);
    }
    requestAnimationFrame(() => terminalRefs.current.get(id)?.focus());
  }

  function selectHost(hostId: number) {
    const host = allHosts.find((item) => item.id === hostId) ?? LOCAL_HOST;
    updateSession(focusedId, { hostId, title: hostId === 0 ? "Local shell" : host.name, connected: false });
  }

  function toggleFavorite(hostId: number) {
    setFavorites((current) => {
      const next = current.includes(hostId) ? current.filter((id) => id !== hostId) : [...current, hostId];
      localStorage.setItem("nestcore-terminal-favorites", JSON.stringify(next));
      return next;
    });
  }

  function saveAppearance(patch: Partial<Appearance>) {
    setAppearance((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem("nestcore-terminal-appearance", JSON.stringify(next));
      return next;
    });
  }

  const loadSftp = useCallback(async (path: string, hostId: number) => {
    setSftpLoading(true);
    setSftpError("");
    try {
      const data = await api<{ success: boolean; path: string; items: FileItem[] }>("/files/list", {
        method: "POST",
        body: JSON.stringify({ path, host: hostId }),
      });
      setSftpPath(data.path || path);
      setSftpItems(data.items ?? []);
    } catch (error) {
      setSftpItems([]);
      setSftpError(error instanceof Error ? error.message : "Unable to list files");
    } finally {
      setSftpLoading(false);
    }
  }, []);

  useEffect(() => {
    setSftpPath("/");
    void loadSftp("/", focusedSession.hostId);
  }, [focusedSession.hostId, loadSftp]);

  async function copySelection() {
    const ok = await terminalRefs.current.get(focusedId)?.copySelection();
    setCopyResult(ok ? "Copied" : "Select terminal text first");
    window.setTimeout(() => setCopyResult(""), 1800);
  }

  const visibleIds = new Set([activeId, ...(splitId === null ? [] : [splitId])]);
  const favoriteHosts = allHosts.filter((host) => host.id === 0 || favorites.includes(host.id));

  return (
    <div>
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Terminal</h2>
          <p className="mt-1 text-sm text-gray-500">Multi-session shell and SFTP workspace</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary" onClick={() => addSession(focusedSession.hostId)}>
            <PlusIcon className="mr-1.5 inline h-4 w-4" />New session
          </button>
          <button className={`btn-secondary ${splitId !== null ? "border-violet-500/60 text-violet-300" : ""}`} onClick={toggleSplit}>
            <Squares2X2Icon className="mr-1.5 inline h-4 w-4" />{splitId === null ? "Split" : "Unsplit"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[190px_minmax(0,1fr)_290px]">
        <aside className="panel order-2 p-3 xl:order-1">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Favorites</h3>
          <div className="space-y-1">
            {favoriteHosts.map((host) => (
              <HostButton
                key={`favorite-${host.id}`}
                host={host}
                active={focusedSession.hostId === host.id}
                favorite={host.id === 0 || favorites.includes(host.id)}
                onSelect={() => selectHost(host.id)}
                onFavorite={host.id === 0 ? undefined : () => toggleFavorite(host.id)}
              />
            ))}
          </div>
          {hosts.length > 0 && <>
            <div className="my-3 border-t border-white/10" />
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">All SSH hosts</h3>
            <div className="space-y-1">
              {hosts.map((host) => (
                <HostButton
                  key={host.id}
                  host={host}
                  active={focusedSession.hostId === host.id}
                  favorite={favorites.includes(host.id)}
                  onSelect={() => selectHost(host.id)}
                  onFavorite={() => toggleFavorite(host.id)}
                />
              ))}
            </div>
          </>}
        </aside>

        <main className="order-1 min-w-0 xl:order-2">
          <div className="panel overflow-hidden p-0">
            <div className="flex min-h-11 items-end gap-1 overflow-x-auto border-b border-white/10 px-2 pt-2">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => selectTab(session.id)}
                  className={`group flex max-w-52 shrink-0 items-center gap-2 rounded-t-md border border-b-0 px-3 py-2 text-xs ${visibleIds.has(session.id) ? "border-white/15 bg-gray-900 text-gray-100" : "border-transparent text-gray-500 hover:text-gray-300"}`}
                >
                  <span className={`metric-dot ${session.connected ? "text-green-400" : "text-gray-600"}`} />
                  <span className="truncate">{session.title}</span>
                  {sessions.length > 1 && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Close ${session.title}`}
                      onClick={(event) => { event.stopPropagation(); closeSession(session.id); }}
                      onKeyDown={(event) => { if (event.key === "Enter") closeSession(session.id); }}
                      className="rounded p-0.5 opacity-0 hover:bg-white/10 group-hover:opacity-100"
                    >
                      <XMarkIcon className="h-3.5 w-3.5" />
                    </span>
                  )}
                </button>
              ))}
              <button title="New session" className="mb-1 rounded p-2 text-gray-500 hover:bg-white/5 hover:text-gray-200" onClick={() => addSession(focusedSession.hostId)}>
                <PlusIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="relative flex min-h-12 flex-wrap items-center gap-2 border-b border-white/10 bg-gray-950/40 px-3 py-2">
              <button className="btn-secondary" onClick={() => terminalRefs.current.get(focusedId)?.reconnect()} title="Reconnect focused session">
                <ArrowPathIcon className="h-4 w-4" />
              </button>
              <button className="btn-secondary" onClick={() => terminalRefs.current.get(focusedId)?.clear()} title="Clear focused session">
                <TrashIcon className="h-4 w-4" />
              </button>
              <button className="btn-secondary" onClick={() => setSearchOpen((value) => !value)} title="Search scrollback">
                <MagnifyingGlassIcon className="h-4 w-4" />
              </button>
              <button className="btn-secondary" onClick={() => void copySelection()} title="Copy selection">
                <ClipboardIcon className="h-4 w-4" />
              </button>
              {copyResult && <span className="text-xs text-gray-400">{copyResult}</span>}
              <div className="ml-auto flex items-center gap-2">
                <span className="hidden text-xs text-gray-500 sm:inline">Focused: {focusedSession.title}</span>
                <button className="btn-secondary" onClick={() => setSettingsOpen((value) => !value)} title="Terminal appearance">
                  <Cog6ToothIcon className="h-4 w-4" />
                </button>
              </div>

              {searchOpen && (
                <form
                  className="flex w-full items-center gap-2 border-t border-white/10 pt-2"
                  onSubmit={(event) => { event.preventDefault(); terminalRefs.current.get(focusedId)?.find(search, false); }}
                >
                  <MagnifyingGlassIcon className="h-4 w-4 text-gray-500" />
                  <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} className="input-field min-w-0 flex-1 text-sm" placeholder="Search terminal output" />
                  <button type="button" className="btn-secondary" onClick={() => terminalRefs.current.get(focusedId)?.find(search, true)}>Previous</button>
                  <button type="submit" className="btn-secondary">Next</button>
                  <button type="button" className="rounded p-1 text-gray-500 hover:text-gray-200" onClick={() => setSearchOpen(false)}><XMarkIcon className="h-4 w-4" /></button>
                </form>
              )}

              {settingsOpen && (
                <div className="absolute right-3 top-12 z-30 w-72 rounded-lg border border-white/10 bg-gray-900 p-4 shadow-2xl">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-200">Appearance</h3>
                    <button onClick={() => setSettingsOpen(false)} className="text-gray-500 hover:text-gray-200"><XMarkIcon className="h-4 w-4" /></button>
                  </div>
                  <label className="mb-3 block text-xs text-gray-400">
                    Theme
                    <select className="input-field mt-1 w-full text-sm" value={appearance.theme} onChange={(event) => saveAppearance({ theme: event.target.value as ThemeName })}>
                      {Object.entries(TERMINAL_THEMES).map(([id, theme]) => <option key={id} value={id}>{theme.label}</option>)}
                    </select>
                  </label>
                  <label className="mb-3 block text-xs text-gray-400">
                    Font
                    <select className="input-field mt-1 w-full text-sm" value={appearance.font} onChange={(event) => saveAppearance({ font: event.target.value as FontName })}>
                      {Object.entries(FONT_FAMILIES).map(([id, font]) => <option key={id} value={id}>{font.label}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs text-gray-400">
                    Font size <span className="float-right text-gray-300">{appearance.fontSize}px</span>
                    <input className="mt-2 w-full accent-violet-500" type="range" min={10} max={20} value={appearance.fontSize} onChange={(event) => saveAppearance({ fontSize: Number(event.target.value) })} />
                  </label>
                </div>
              )}
            </div>

            <div className={`grid gap-2 p-2 ${splitId === null ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2"}`}>
              {sessions.map((session) => (
                <SessionTerminal
                  key={session.id}
                  ref={(handle) => { if (handle) terminalRefs.current.set(session.id, handle); else terminalRefs.current.delete(session.id); }}
                  session={session}
                  appearance={appearance}
                  visible={visibleIds.has(session.id)}
                  focused={focusedId === session.id}
                  hostName={allHosts.find((host) => host.id === session.hostId)?.name ?? "Unknown host"}
                  onFocus={() => setFocusedId(session.id)}
                  onStatus={(connected) => updateSession(session.id, { connected })}
                  onTitle={(title) => updateSession(session.id, { title })}
                />
              ))}
            </div>
          </div>
        </main>

        <aside className="panel order-3 flex min-h-72 min-w-0 flex-col p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-200"><FolderIcon className="h-4 w-4 text-violet-400" />SFTP files</h3>
              <p className="mt-0.5 truncate text-xs text-gray-500">{focusedHost.name}</p>
            </div>
            <button className="rounded p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-200" title="Refresh files" onClick={() => void loadSftp(sftpPath, focusedSession.hostId)}>
              <ArrowPathIcon className={`h-4 w-4 ${sftpLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="mb-2 flex gap-1">
            <button className="btn-secondary shrink-0" title="Parent folder" onClick={() => void loadSftp(parentPath(sftpPath), focusedSession.hostId)}><ArrowUpIcon className="h-4 w-4" /></button>
            <input
              value={sftpPath}
              onChange={(event) => setSftpPath(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void loadSftp(sftpPath, focusedSession.hostId); }}
              aria-label="SFTP path"
              className="input-field min-w-0 flex-1 font-mono text-xs"
            />
          </div>
          {sftpError ? (
            <p className="rounded bg-red-500/10 p-2 text-xs text-red-300">{sftpError}</p>
          ) : (
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              {sftpLoading && sftpItems.length === 0 && <p className="p-2 text-xs text-gray-500">Loading...</p>}
              {!sftpLoading && sftpItems.length === 0 && <p className="p-2 text-xs text-gray-500">Folder is empty</p>}
              {sftpItems.map((item) => (
                <button
                  key={item.path}
                  title={item.path}
                  onClick={() => item.isDirectory ? void loadSftp(item.path, focusedSession.hostId) : void copyText(item.path)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-white/5"
                >
                  {item.isDirectory ? <FolderIcon className="h-4 w-4 shrink-0 text-amber-400" /> : <DocumentIcon className="h-4 w-4 shrink-0 text-gray-500" />}
                  <span className="min-w-0 flex-1 truncate text-xs text-gray-300">{item.name}</span>
                  {!item.isDirectory && <span className="shrink-0 text-[10px] text-gray-600">{formatBytes(item.size)}</span>}
                </button>
              ))}
            </div>
          )}
          <p className="mt-2 border-t border-white/10 pt-2 text-[10px] text-gray-600">Click a folder to open it. Click a file to copy its path.</p>
        </aside>
      </div>
    </div>
  );
}

function HostButton({ host, active, favorite, onSelect, onFavorite }: {
  host: Host;
  active: boolean;
  favorite: boolean;
  onSelect: () => void;
  onFavorite?: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs ${active ? "bg-violet-500/15 text-violet-200" : "text-gray-400 hover:bg-white/5 hover:text-gray-200"}`}
    >
      <span className={`metric-dot shrink-0 ${active ? "text-violet-400" : "text-gray-600"}`} />
      <span className="min-w-0 flex-1 truncate">{host.name}</span>
      {onFavorite && (
        <span
          role="button"
          tabIndex={0}
          title={favorite ? "Remove favorite" : "Add favorite"}
          onClick={(event) => { event.stopPropagation(); onFavorite(); }}
          onKeyDown={(event) => { if (event.key === "Enter") onFavorite(); }}
          className={`rounded p-0.5 ${favorite ? "text-amber-400" : "text-gray-700 opacity-0 group-hover:opacity-100"}`}
        >
          <StarIcon className={`h-3.5 w-3.5 ${favorite ? "fill-current" : ""}`} />
        </span>
      )}
    </button>
  );
}

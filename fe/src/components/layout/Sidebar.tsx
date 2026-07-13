import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import {
  HomeIcon,
  ArrowsRightLeftIcon,
  CloudIcon,
  PaperAirplaneIcon,
  GlobeAltIcon,
  CubeIcon,
  ServerStackIcon,
  DocumentTextIcon,
  AdjustmentsHorizontalIcon,
  FolderIcon,
  CommandLineIcon,
  RectangleStackIcon,
  SparklesIcon,
  Cog6ToothIcon,
  ArrowLeftOnRectangleIcon,
  ServerIcon,
  XMarkIcon,
  FilmIcon,
  ArrowDownTrayIcon,
  PlayIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import type { ComponentType, SVGProps } from "react";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

interface NavLeaf {
  to: string;
  label: string;
  icon: IconType;
}

// Groups collapse related pages under one dropdown so the sidebar doesn't
// list 16 flat items — the pages/routes themselves are untouched, this is
// purely a nav presentation grouping.
interface NavGroup {
  label: string;
  icon: IconType;
  children: NavLeaf[];
}

type NavEntry = (NavLeaf & { children?: undefined }) | NavGroup;

const NAV_ITEMS: NavEntry[] = [
  { to: "/dashboard", label: "Dashboard", icon: HomeIcon },
  {
    label: "Networking",
    icon: ArrowsRightLeftIcon,
    children: [
      { to: "/tunnel", label: "Tunnel", icon: ArrowsRightLeftIcon },
      { to: "/cloudflare", label: "Cloudflare", icon: CloudIcon },
      { to: "/network", label: "Network", icon: GlobeAltIcon },
    ],
  },
  {
    label: "Processes",
    icon: CubeIcon,
    children: [
      { to: "/docker", label: "Docker", icon: CubeIcon },
      { to: "/pm2", label: "PM2", icon: ServerStackIcon },
      { to: "/services", label: "Services", icon: AdjustmentsHorizontalIcon },
    ],
  },
  {
    label: "Diagnostics",
    icon: DocumentTextIcon,
    children: [
      { to: "/logs", label: "Logs", icon: DocumentTextIcon },
      { to: "/terminal", label: "Terminal", icon: CommandLineIcon },
    ],
  },
  {
    label: "Files",
    icon: FolderIcon,
    children: [
      { to: "/files", label: "Files", icon: FolderIcon },
      { to: "/projects", label: "Projects", icon: RectangleStackIcon },
    ],
  },
  { to: "/ai-gateway", label: "AI Gateway", icon: SparklesIcon },
  { to: "/telegram", label: "Telegram", icon: PaperAirplaneIcon },
  {
    label: "Movies",
    icon: FilmIcon,
    children: [
      { to: "/movies", label: "Movies", icon: FilmIcon },
      { to: "/downloads", label: "Downloads", icon: ArrowDownTrayIcon },
      { to: "/stream", label: "Stream", icon: PlayIcon },
    ],
  },
  { to: "/settings", label: "Settings", icon: Cog6ToothIcon },
];

function isGroup(item: NavEntry): item is NavGroup {
  return item.children !== undefined;
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { logout } = useAuth();
  const location = useLocation();
  const [gitInfo, setGitInfo] = useState<{ branch?: string; commit?: string } | null>(null);
  // Group whose children contain the active route auto-expands; the rest
  // start collapsed. Keyed by group label since groups have no route of
  // their own.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const item of NAV_ITEMS) {
      if (isGroup(item) && item.children.some((c) => location.pathname.startsWith(c.to))) {
        initial[item.label] = true;
      }
    }
    return initial;
  });

  useEffect(() => {
    api<{ branch?: string; commit?: string; error?: string }>("/update/info")
      .then((res) => {
        if (!res.error) setGitInfo(res);
      })
      .catch(() => {});
  }, []);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed left-0 top-0 h-full w-60 bg-gray-900 z-50 transform transition-transform duration-300 flex flex-col border-r border-white/7 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-4 border-b border-white/7">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="brand-mark">
                <ServerIcon />
              </div>
              <div>
                <h1 className="font-bold tracking-tight text-sm">Nestcore</h1>
                <p className="text-xs text-gray-500">Server Management</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-11 h-11 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 rounded-xl active:scale-95 transition md:hidden"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
        <nav className="p-3 overflow-y-auto flex-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            if (!isGroup(item)) {
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
                >
                  <Icon /> {item.label}
                </NavLink>
              );
            }

            const expanded = !!openGroups[item.label];
            const groupActive = item.children.some((c) => location.pathname.startsWith(c.to));
            return (
              <div key={item.label}>
                <button
                  type="button"
                  onClick={() => setOpenGroups((g) => ({ ...g, [item.label]: !g[item.label] }))}
                  className={`nav-link w-full text-left ${groupActive && !expanded ? "active" : ""}`}
                >
                  <Icon /> {item.label}
                  <ChevronDownIcon
                    className={`w-4 h-4 ml-auto transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                </button>
                {expanded && (
                  <div className="ml-4 pl-2 border-l border-white/7">
                    {item.children.map((c) => {
                      const ChildIcon = c.icon;
                      return (
                        <NavLink
                          key={c.to}
                          to={c.to}
                          onClick={onClose}
                          className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
                        >
                          <ChildIcon /> {c.label}
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/7">
          <button
            onClick={() => logout()}
            className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-red-500/15 text-gray-300 hover:text-red-400 py-2.5 rounded-lg transition active:scale-[0.98] text-sm font-medium"
          >
            <ArrowLeftOnRectangleIcon className="w-4 h-4" /> Logout
          </button>
          {gitInfo?.commit && (
            <p className="text-center text-[11px] text-gray-600 mt-2 font-mono">
              commit {gitInfo.commit}
              {gitInfo.branch ? ` on ${gitInfo.branch}` : ""}
            </p>
          )}
        </div>
      </aside>
    </>
  );
}

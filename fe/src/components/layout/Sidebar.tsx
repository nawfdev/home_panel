import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
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
  CpuChipIcon,
  SparklesIcon,
  Cog6ToothIcon,
  ArrowLeftOnRectangleIcon,
  ServerIcon,
  XMarkIcon,
  FilmIcon,
} from "@heroicons/react/24/outline";
import type { ComponentType, SVGProps } from "react";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

interface NavItem {
  to: string;
  label: string;
  icon: IconType;
  live: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: HomeIcon, live: true },
  { to: "/tunnel", label: "Tunnel", icon: ArrowsRightLeftIcon, live: true },
  { to: "/cloudflare", label: "Cloudflare", icon: CloudIcon, live: true },
  { to: "/telegram", label: "Telegram", icon: PaperAirplaneIcon, live: true },
  { to: "/network", label: "Network", icon: GlobeAltIcon, live: true },
  { to: "/docker", label: "Docker", icon: CubeIcon, live: true },
  { to: "/pm2", label: "PM2", icon: ServerStackIcon, live: true },
  { to: "/logs", label: "Logs", icon: DocumentTextIcon, live: true },
  { to: "/services", label: "Services", icon: AdjustmentsHorizontalIcon, live: true },
  { to: "/files", label: "Files", icon: FolderIcon, live: true },
  { to: "/terminal", label: "Terminal", icon: CommandLineIcon, live: true },
  { to: "/projects", label: "Projects", icon: RectangleStackIcon, live: true },
  { to: "/system", label: "System", icon: CpuChipIcon, live: true },
  { to: "/ai-gateway", label: "AI Gateway", icon: SparklesIcon, live: true },
  { to: "/movies", label: "Movies", icon: FilmIcon, live: true },
  { to: "/settings", label: "Settings", icon: Cog6ToothIcon, live: true },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { logout } = useAuth();
  const { show } = useToast();
  const [gitInfo, setGitInfo] = useState<{ branch?: string; commit?: string } | null>(null);

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
            return item.live ? (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
              >
                <Icon /> {item.label}
              </NavLink>
            ) : (
              <button
                key={item.to}
                type="button"
                onClick={() => show(`${item.label} belum dimigrasi ke UI baru.`, "info")}
                className="nav-link opacity-40 w-full text-left cursor-not-allowed hover:opacity-40 hover:bg-transparent"
              >
                <Icon /> {item.label}
              </button>
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

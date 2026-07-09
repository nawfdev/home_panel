import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
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
  Cog6ToothIcon,
  ArrowLeftOnRectangleIcon,
  ServerIcon,
  XMarkIcon,
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
  { to: "/cloudflare", label: "Cloudflare", icon: CloudIcon, live: false },
  { to: "/telegram", label: "Telegram", icon: PaperAirplaneIcon, live: false },
  { to: "/network", label: "Network", icon: GlobeAltIcon, live: false },
  { to: "/docker", label: "Docker", icon: CubeIcon, live: false },
  { to: "/pm2", label: "PM2", icon: ServerStackIcon, live: false },
  { to: "/logs", label: "Logs", icon: DocumentTextIcon, live: false },
  { to: "/services", label: "Services", icon: AdjustmentsHorizontalIcon, live: false },
  { to: "/files", label: "Files", icon: FolderIcon, live: false },
  { to: "/terminal", label: "Terminal", icon: CommandLineIcon, live: false },
  { to: "/projects", label: "Projects", icon: RectangleStackIcon, live: false },
  { to: "/system", label: "System", icon: CpuChipIcon, live: false },
  { to: "/settings", label: "Settings", icon: Cog6ToothIcon, live: false },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { logout } = useAuth();
  const { show } = useToast();

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
                <h1 className="font-bold tracking-tight text-sm">Home Panel</h1>
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
        </div>
      </aside>
    </>
  );
}

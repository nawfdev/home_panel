import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { hasFeature } from "../../lib/features";
import { Sidebar } from "./Sidebar";
import { MobileHeader } from "./MobileHeader";
import { DownloadNotifier } from "./DownloadNotifier";
import { MusicProvider } from "../../context/MusicContext";
import { MiniPlayer } from "./MiniPlayer";

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const canMusic = !!user && hasFeature(user.features, user.role, "music");

  const shell = (
    <div className="min-h-screen">
      <DownloadNotifier />
      <MobileHeader onOpen={() => setSidebarOpen(true)} />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className={`md:ml-64 p-4 md:p-6 pt-20 md:pt-6 max-w-[1440px] ${canMusic ? "pb-24" : ""}`}>
        <Outlet />
      </main>
      {canMusic && <MiniPlayer />}
    </div>
  );

  // Only mount the WebSocket/polling provider for users who can actually
  // see the player — no point opening a connection to go-librespot for
  // roles that were never granted the "music" feature.
  return canMusic ? <MusicProvider>{shell}</MusicProvider> : shell;
}

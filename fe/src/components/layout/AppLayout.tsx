import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { hasFeature } from "../../lib/features";
import { Sidebar } from "./Sidebar";
import { MobileHeader } from "./MobileHeader";
import { DownloadNotifier } from "./DownloadNotifier";
import { MusicProvider, useMusic } from "../../context/MusicContext";
import { MiniPlayer } from "./MiniPlayer";

const MAIN_CLASS = "md:ml-64 p-4 md:p-6 pt-20 md:pt-6 max-w-[1440px]";

// Rendered only as a descendant of <MusicProvider>, so the bar — and the
// space reserved for it — appears exclusively once a Spotify session is
// actually paired and playing something. No permanent "connecting…" bar
// eating layout space on every page while nothing is happening.
function MusicAwareMain() {
  const { available, status } = useMusic();
  const showPlayer = available && !!status?.track;
  return (
    <>
      <main className={`${MAIN_CLASS} ${showPlayer ? "pb-24" : ""}`}>
        <Outlet />
      </main>
      {showPlayer && <MiniPlayer />}
    </>
  );
}

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const canMusic = !!user && hasFeature(user.features, user.role, "music");

  const body = (
    <div className="min-h-screen">
      <DownloadNotifier />
      <MobileHeader onOpen={() => setSidebarOpen(true)} />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {canMusic ? (
        <MusicAwareMain />
      ) : (
        <main className={MAIN_CLASS}>
          <Outlet />
        </main>
      )}
    </div>
  );

  // Only mount the WebSocket/polling provider for users who can actually
  // see the player — no point opening a connection to go-librespot for
  // roles that were never granted the "music" feature.
  return canMusic ? <MusicProvider>{body}</MusicProvider> : body;
}

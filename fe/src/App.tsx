import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { canAccessPath } from "./lib/features";
import { ToastProvider } from "./context/ToastContext";
import { AppLayout } from "./components/layout/AppLayout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Tunnel } from "./pages/Tunnel";
import { Cloudflare } from "./pages/Cloudflare";
import { Telegram } from "./pages/Telegram";
import { Network } from "./pages/Network";
import { Docker } from "./pages/Docker";
import { PM2 } from "./pages/PM2";
import { Logs } from "./pages/Logs";
import { Services } from "./pages/Services";
import { Files } from "./pages/Files";
import { Movies } from "./pages/Movies";
import { Downloads } from "./pages/Downloads";
import { Stream } from "./pages/Stream";
import { Watch } from "./pages/Watch";
import { TV } from "./pages/TV";
import { Terminal } from "./pages/Terminal";
import { Projects } from "./pages/Projects";
import { RemoteDesktop } from "./pages/RemoteDesktop";
import { RemoteDesktopView } from "./pages/RemoteDesktopView";
import { Settings } from "./pages/Settings";
import { AiGateway } from "./pages/AiGateway";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

// Client-side defense in depth for the RBAC feature grant — real enforcement
// is server-side (RequireFeature middleware). Routes with no gating entry in
// featureForPath (dashboard, settings) always pass through.
function RequireFeature({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return null; // RequireAuth wraps this and handles the redirect
  if (!canAccessPath(user.features, user.role, location.pathname)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { user, isLoading } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={!isLoading && user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/tunnel" element={<RequireFeature><Tunnel /></RequireFeature>} />
        <Route path="/cloudflare" element={<RequireFeature><Cloudflare /></RequireFeature>} />
        <Route path="/telegram" element={<RequireFeature><Telegram /></RequireFeature>} />
        <Route path="/network" element={<RequireFeature><Network /></RequireFeature>} />
        <Route path="/docker" element={<RequireFeature><Docker /></RequireFeature>} />
        <Route path="/pm2" element={<RequireFeature><PM2 /></RequireFeature>} />
        <Route path="/logs" element={<RequireFeature><Logs /></RequireFeature>} />
        <Route path="/services" element={<RequireFeature><Services /></RequireFeature>} />
        <Route path="/files" element={<RequireFeature><Files /></RequireFeature>} />
        <Route path="/movies" element={<RequireFeature><Movies /></RequireFeature>} />
        <Route path="/downloads" element={<RequireFeature><Downloads /></RequireFeature>} />
        <Route path="/stream" element={<RequireFeature><Stream /></RequireFeature>} />
        <Route path="/movies/watch/:id" element={<RequireFeature><Watch /></RequireFeature>} />
        <Route path="/tv" element={<RequireFeature><TV /></RequireFeature>} />
        <Route path="/terminal" element={<RequireFeature><Terminal /></RequireFeature>} />
        <Route path="/remote-desktop" element={<RequireFeature><RemoteDesktop /></RequireFeature>} />
        <Route path="/remote-desktop/:id/view" element={<RequireFeature><RemoteDesktopView /></RequireFeature>} />
        <Route path="/projects" element={<RequireFeature><Projects /></RequireFeature>} />
        <Route path="/system" element={<Navigate to="/dashboard" replace />} />
        <Route path="/ai-gateway" element={<RequireFeature><AiGateway /></RequireFeature>} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

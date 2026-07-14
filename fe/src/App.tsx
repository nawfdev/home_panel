import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
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
        <Route path="/tunnel" element={<Tunnel />} />
        <Route path="/cloudflare" element={<Cloudflare />} />
        <Route path="/telegram" element={<Telegram />} />
        <Route path="/network" element={<Network />} />
        <Route path="/docker" element={<Docker />} />
        <Route path="/pm2" element={<PM2 />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/services" element={<Services />} />
        <Route path="/files" element={<Files />} />
        <Route path="/movies" element={<Movies />} />
        <Route path="/downloads" element={<Downloads />} />
        <Route path="/stream" element={<Stream />} />
        <Route path="/movies/watch/:id" element={<Watch />} />
        <Route path="/terminal" element={<Terminal />} />
        <Route path="/remote-desktop" element={<RemoteDesktop />} />
        <Route path="/remote-desktop/:id/view" element={<RemoteDesktopView />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/system" element={<Navigate to="/dashboard" replace />} />
        <Route path="/ai-gateway" element={<AiGateway />} />
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

import type { ReactNode } from "react";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { canAccessPath } from "./lib/features";
import { ToastProvider } from "./context/ToastContext";
import { AppLayout } from "./components/layout/AppLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Every routed page is lazy-loaded (one chunk per page instead of one
// eagerly-loaded ~1.1 MB bundle covering every page in the app) so the
// initial load only pays for the app shell + whichever page is actually
// being visited. Pages use named exports, hence the ".then(m => ({default:
// m.X}))" — React.lazy requires a module with a default export.
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Tunnel = lazy(() => import("./pages/Tunnel").then((m) => ({ default: m.Tunnel })));
const Cloudflare = lazy(() => import("./pages/Cloudflare").then((m) => ({ default: m.Cloudflare })));
const Telegram = lazy(() => import("./pages/Telegram").then((m) => ({ default: m.Telegram })));
const Network = lazy(() => import("./pages/Network").then((m) => ({ default: m.Network })));
const Docker = lazy(() => import("./pages/Docker").then((m) => ({ default: m.Docker })));
const PM2 = lazy(() => import("./pages/PM2").then((m) => ({ default: m.PM2 })));
const Logs = lazy(() => import("./pages/Logs").then((m) => ({ default: m.Logs })));
const Services = lazy(() => import("./pages/Services").then((m) => ({ default: m.Services })));
const Files = lazy(() => import("./pages/Files").then((m) => ({ default: m.Files })));
const Shares = lazy(() => import("./pages/Shares").then((m) => ({ default: m.Shares })));
const Library = lazy(() => import("./pages/Library").then((m) => ({ default: m.Library })));
const AddMovie = lazy(() => import("./pages/AddMovie").then((m) => ({ default: m.AddMovie })));
const Music = lazy(() => import("./pages/Music").then((m) => ({ default: m.Music })));
const Watch = lazy(() => import("./pages/Watch").then((m) => ({ default: m.Watch })));
const TV = lazy(() => import("./pages/TV").then((m) => ({ default: m.TV })));
const Terminal = lazy(() => import("./pages/Terminal").then((m) => ({ default: m.Terminal })));
const Projects = lazy(() => import("./pages/Projects").then((m) => ({ default: m.Projects })));
const RemoteDesktop = lazy(() => import("./pages/RemoteDesktop").then((m) => ({ default: m.RemoteDesktop })));
const RemoteDesktopView = lazy(() => import("./pages/RemoteDesktopView").then((m) => ({ default: m.RemoteDesktopView })));
const AiGateway = lazy(() => import("./pages/AiGateway").then((m) => ({ default: m.AiGateway })));
const Hosts = lazy(() => import("./pages/Hosts").then((m) => ({ default: m.Hosts })));
const Users = lazy(() => import("./pages/Users").then((m) => ({ default: m.Users })));
const Operations = lazy(() => import("./pages/Operations").then((m) => ({ default: m.Operations })));
const Integrations = lazy(() => import("./pages/Integrations").then((m) => ({ default: m.Integrations })));
const Updates = lazy(() => import("./pages/Updates").then((m) => ({ default: m.Updates })));
const Account = lazy(() => import("./pages/Account").then((m) => ({ default: m.Account })));
const Monitoring = lazy(() => import("./pages/Monitoring").then((m) => ({ default: m.Monitoring })));
const Storage = lazy(() => import("./pages/Storage").then((m) => ({ default: m.Storage })));
const Status = lazy(() => import("./pages/Status").then((m) => ({ default: m.Status })));
const AdGuard = lazy(() => import("./pages/AdGuard").then((m) => ({ default: m.AdGuard })));

function PageLoading() {
  return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return <PageLoading />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

// Client-side defense in depth for the RBAC feature grant — real enforcement
// is server-side (RequireFeature middleware). Routes with no gating entry in
// featureForPath (dashboard, account) always pass through.
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
  const location = useLocation();

  return (
    // Keyed by pathname so a page-level render error (see ErrorBoundary)
    // clears itself on the next navigation instead of leaving every
    // subsequent page stuck on the error screen until "Try again" is clicked.
    <ErrorBoundary key={location.pathname}>
      <Routes>
        <Route path="/login" element={!isLoading && user ? <Navigate to="/dashboard" replace /> : <Login />} />
        <Route path="/status" element={<Status />} />
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
          <Route path="/adguard" element={<RequireFeature><AdGuard /></RequireFeature>} />
          <Route path="/docker" element={<RequireFeature><Docker /></RequireFeature>} />
          <Route path="/pm2" element={<RequireFeature><PM2 /></RequireFeature>} />
          <Route path="/logs" element={<RequireFeature><Logs /></RequireFeature>} />
          <Route path="/services" element={<RequireFeature><Services /></RequireFeature>} />
          <Route path="/files" element={<RequireFeature><Files /></RequireFeature>} />
          <Route path="/shares" element={<RequireFeature><Shares /></RequireFeature>} />
          <Route path="/movies" element={<RequireFeature><Library /></RequireFeature>} />
          <Route path="/movies/add" element={<RequireFeature><AddMovie /></RequireFeature>} />
          <Route path="/music" element={<RequireFeature><Music /></RequireFeature>} />
          <Route path="/movies/watch/:id" element={<RequireFeature><Watch /></RequireFeature>} />
          <Route path="/downloads" element={<Navigate to="/movies" replace />} />
          <Route path="/stream" element={<Navigate to="/movies" replace />} />
          <Route path="/tv" element={<RequireFeature><TV /></RequireFeature>} />
          <Route path="/terminal" element={<RequireFeature><Terminal /></RequireFeature>} />
          <Route path="/remote-desktop" element={<RequireFeature><RemoteDesktop /></RequireFeature>} />
          <Route path="/remote-desktop/:id/view" element={<RequireFeature><RemoteDesktopView /></RequireFeature>} />
          <Route path="/projects" element={<RequireFeature><Projects /></RequireFeature>} />
          <Route path="/monitoring" element={<RequireFeature><Monitoring /></RequireFeature>} />
          <Route path="/storage" element={<RequireFeature><Storage /></RequireFeature>} />
          <Route path="/system" element={<Navigate to="/dashboard" replace />} />
          <Route path="/ai-gateway" element={<RequireFeature><AiGateway /></RequireFeature>} />
          <Route path="/hosts" element={user?.role === "admin" ? <Hosts /> : <Navigate to="/dashboard" replace />} />
          <Route path="/users" element={user?.role === "admin" ? <Users /> : <Navigate to="/dashboard" replace />} />
          <Route path="/operations" element={user?.role === "admin" ? <Operations /> : <Navigate to="/dashboard" replace />} />
          <Route path="/integrations" element={user?.role === "admin" ? <Integrations /> : <Navigate to="/dashboard" replace />} />
          <Route path="/updates" element={user?.role === "admin" ? <Updates /> : <Navigate to="/dashboard" replace />} />
          <Route path="/account" element={<Account />} />
          <Route path="/settings" element={<Navigate to="/account" replace />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<PageLoading />}>
            <AppRoutes />
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

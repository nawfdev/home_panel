// Mirrors store.FeatureKeys in be/internal/store/store.go — keep both lists
// in sync by hand (14 keys, small enough not to warrant codegen).
export const FEATURE_KEYS = [
  "tunnel",
  "cloudflare",
  "network",
  "docker",
  "pm2",
  "services",
  "logs",
  "terminal",
  "remote-desktop",
  "files",
  "projects",
  "ai-gateway",
  "telegram",
  "movies",
  "tv",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  tunnel: "Tunnel",
  cloudflare: "Cloudflare",
  network: "Network",
  docker: "Docker",
  pm2: "PM2",
  services: "Services",
  logs: "Logs",
  terminal: "Terminal",
  "remote-desktop": "Remote Desktop",
  files: "Files",
  projects: "Projects",
  "ai-gateway": "AI Gateway",
  telegram: "Telegram",
  movies: "Movies (incl. Downloads & Stream)",
  tv: "Live TV",
};

// Route path -> gating feature key. Routes absent from this map (dashboard,
// settings) are available to every authenticated user; Settings' sensitive
// sub-tabs are gated separately by role === "admin" inside the page itself.
const ROUTE_FEATURE: Record<string, FeatureKey> = {
  "/tunnel": "tunnel",
  "/cloudflare": "cloudflare",
  "/telegram": "telegram",
  "/network": "network",
  "/docker": "docker",
  "/pm2": "pm2",
  "/logs": "logs",
  "/services": "services",
  "/files": "files",
  "/movies": "movies",
  "/downloads": "movies",
  "/stream": "movies",
  "/movies/watch": "movies",
  "/tv": "tv",
  "/terminal": "terminal",
  "/remote-desktop": "remote-desktop",
  "/projects": "projects",
  "/ai-gateway": "ai-gateway",
};

export function featureForPath(path: string): FeatureKey | null {
  for (const [prefix, key] of Object.entries(ROUTE_FEATURE)) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return key;
  }
  return null;
}

export function hasFeature(features: string[], role: string, key: FeatureKey): boolean {
  return role === "admin" || features.includes(key);
}

export function canAccessPath(features: string[], role: string, path: string): boolean {
  const key = featureForPath(path);
  if (!key) return true; // ungated route (dashboard, settings)
  return hasFeature(features, role, key);
}

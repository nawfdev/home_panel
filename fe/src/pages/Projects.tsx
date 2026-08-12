import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { useAuth } from "../context/AuthContext";
import { Modal } from "../components/ui/Modal";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CodeBracketIcon,
  CommandLineIcon,
  GlobeAltIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RocketLaunchIcon,
  StopIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

interface Host {
  id: number;
  name: string;
  address: string;
  user: string;
}

interface Release {
  id: string;
  path: string;
  deployed_at: string;
}

interface Site {
  id: number;
  name: string;
  host_id: number;
  type: SiteType;
  path: string;
  source_path?: string;
  build_command?: string;
  start_command?: string;
  publish_dir?: string;
  port?: number;
  domains?: string[];
  domain?: string;
  tunnel_id?: string;
  tunnel_config?: string;
  tunnel_service?: string;
  status: string;
  health?: string;
  last_deployed_at?: string;
  current_release?: string;
  previous_release?: string;
  releases?: Release[];
}

type SiteType = "static" | "node" | "proxy" | "php";

type SiteForm = {
  name: string;
  hostId: string;
  type: SiteType;
  path: string;
  sourcePath: string;
  buildCommand: string;
  startCommand: string;
  publishDir: string;
  port: string;
  domains: string;
  tunnelId: string;
  tunnelConfig: string;
  tunnelService: string;
};

interface ActionResult {
  success: boolean;
  message?: string;
  output?: string;
}

interface LogLine {
  type: string;
  data: string;
  time: string;
}

const emptyForm: SiteForm = {
  name: "",
  hostId: "",
  type: "static",
  path: "/srv/storage/www/domains/",
  sourcePath: "/srv/storage/www/staging/",
  buildCommand: "",
  startCommand: "",
  publishDir: "dist",
  port: "",
  domains: "",
  tunnelId: "6e68d696-b5ad-4f42-a5b0-c23edcecf7f7c",
  tunnelConfig: "/etc/cloudflared/config.yml",
  tunnelService: "cloudflared",
};

const typeCopy: Record<SiteType, string> = {
  static: "Built files served by Nginx",
  node: "Node process managed by systemd",
  proxy: "Existing service behind Nginx",
  php: "PHP-FPM application",
};

function hostLabel(site: Site, hosts: Host[]) {
  if (!site.host_id) return "Local panel";
  const host = hosts.find((item) => item.id === site.host_id);
  return host ? `${host.name} · ${host.address}` : `Host #${site.host_id}`;
}

function siteToForm(site: Site): SiteForm {
  return {
    name: site.name,
    hostId: site.host_id ? String(site.host_id) : "",
    type: site.type || "node",
    path: site.path,
    sourcePath: site.source_path ?? "",
    buildCommand: site.build_command ?? "",
    startCommand: site.start_command ?? "",
    publishDir: site.publish_dir ?? "",
    port: site.port ? String(site.port) : "",
    domains: (site.domains?.length ? site.domains : site.domain ? [site.domain] : []).join("\n"),
    tunnelId: site.tunnel_id ?? "",
    tunnelConfig: site.tunnel_config ?? "/etc/cloudflared/config.yml",
    tunnelService: site.tunnel_service ?? "cloudflared",
  };
}

function payload(form: SiteForm) {
  return {
    name: form.name.trim(),
    hostId: form.hostId ? Number(form.hostId) : 0,
    type: form.type,
    path: form.path.trim(),
    sourcePath: form.sourcePath.trim(),
    buildCommand: form.buildCommand.trim(),
    startCommand: form.startCommand.trim(),
    publishDir: form.publishDir.trim(),
    port: form.port ? Number(form.port) : 0,
    domains: form.domains.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean),
    tunnelId: form.tunnelId.trim(),
    tunnelConfig: form.tunnelConfig.trim(),
    tunnelService: form.tunnelService.trim(),
  };
}

function statusClass(status: string) {
  if (status === "running") return "bg-green-500/15 text-green-400";
  if (status === "deploying") return "bg-blue-500/15 text-blue-400";
  if (status === "degraded" || status === "failed") return "bg-amber-500/15 text-amber-400";
  return "bg-white/5 text-gray-400";
}

export function Projects() {
  const { show } = useToast();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Site | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Site | null>(null);
  const [logsSite, setLogsSite] = useState<Site | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [form, setForm] = useState<SiteForm>(emptyForm);
  const [busy, setBusy] = useState<string | null>(null);
  const { user } = useAuth();
  const canManage = user?.role === "admin";
  const remoteHosts = useMemo(() => hosts.filter((host) => host.id > 0), [hosts]);

  async function load() {
    try {
      const [siteData, hostData] = await Promise.all([
        api<Site[]>("/projects"),
        api<Host[]>("/hosts"),
      ]);
      setSites(siteData);
      setHosts(hostData);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load sites", "error");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openAdd() {
    setEditing(null);
    setForm({ ...emptyForm, hostId: remoteHosts[0] ? String(remoteHosts[0].id) : "" });
    setFormOpen(true);
  }

  function openEdit(site: Site) {
    setEditing(site);
    setForm(siteToForm(site));
    setFormOpen(true);
  }

  function setField<K extends keyof SiteForm>(key: K, value: SiteForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!form.name.trim() || !form.path.trim()) {
      show("Name and deployment path are required", "warning");
      return;
    }
    if ((form.type === "node" || form.type === "proxy") && !form.port) {
      show("Node and proxy sites require a port", "warning");
      return;
    }
    setBusy("save");
    try {
      await api(editing ? `/projects/${editing.id}` : "/projects", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(payload(form)),
      });
      show(editing ? "Site updated" : "Site created", "success");
      setFormOpen(false);
      await load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save site", "error");
    } finally {
      setBusy(null);
    }
  }

  async function run(site: Site, action: "start" | "stop" | "restart" | "deploy" | "rollback" | "configure") {
    const key = `${site.id}:${action}`;
    setBusy(key);
    try {
      const result = await api<ActionResult>(`/projects/${site.id}/${action}`, { method: "POST" });
      show(result.message ?? action, result.success ? "success" : "error");
      if (result.output) show(result.output, "info");
      await load();
    } catch (err) {
      show(err instanceof Error ? err.message : `Failed to ${action} site`, "error");
    } finally {
      setBusy(null);
    }
  }

  async function checkHealth(site: Site) {
    setBusy(`${site.id}:health`);
    try {
      const result = await api<{ healthy: boolean; message: string; statusCode?: number }>(`/projects/${site.id}/health`);
      show(`${site.name}: ${result.message}`, result.healthy ? "success" : "warning");
      await load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Health check failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function openLogs(site: Site) {
    setBusy(`${site.id}:logs`);
    try {
      setLogs(await api<LogLine[]>(`/projects/${site.id}/logs`));
      setLogsSite(site);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load logs", "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusy(`${deleteTarget.id}:delete`);
    try {
      const result = await api<ActionResult>(`/projects/${deleteTarget.id}`, { method: "DELETE" });
      show(result.message ?? "Site removed", result.success ? "success" : "error");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to remove site", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">
            <GlobeAltIcon className="w-4 h-4" /> Hosting control plane
          </div>
          <h2 className="text-2xl font-bold text-gray-100">Sites</h2>
          <p className="text-gray-500 text-sm mt-1">Build, release, route, and operate sites on saved SSH hosts.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => void load()}>
            <ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Refresh
          </button>
          {canManage && <button className="btn-primary" onClick={openAdd}>
            <PlusIcon className="w-4 h-4 inline mr-1.5" />Add site
          </button>}
        </div>
      </div>

      <div className="metric-strip mb-5">
        <div className="metric-item">
          <div className="metric-label">Sites</div>
          <div className="metric-value">{sites?.length ?? "—"}</div>
        </div>
        <div className="metric-item">
          <div className="metric-label">Healthy</div>
          <div className="metric-value">{sites?.filter((site) => site.status === "running").length ?? "—"}</div>
        </div>
        <div className="metric-item">
          <div className="metric-label">Remote hosts</div>
          <div className="metric-value">{remoteHosts.length}</div>
        </div>
        <div className="metric-item">
          <div className="metric-label">Domains</div>
          <div className="metric-value">{sites?.reduce((count, site) => count + (site.domains?.length ?? (site.domain ? 1 : 0)), 0) ?? "—"}</div>
        </div>
      </div>

      <Panel title={`Managed sites${sites ? ` · ${sites.length}` : ""}`}>
        {sites === null ? (
          <p className="text-sm text-gray-500">Loading sites…</p>
        ) : sites.length === 0 ? (
          <div className="py-10 text-center">
            <GlobeAltIcon className="w-8 h-8 text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-300">No sites configured.</p>
            <p className="text-xs text-gray-500 mt-1">Add a remote host in Settings, then create the first site.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {sites.map((site) => {
              const domains = site.domains?.length ? site.domains : site.domain ? [site.domain] : [];
              const pending = (action: string) => busy === `${site.id}:${action}`;
              return (
                <article key={site.id} className="py-5 first:pt-1 last:pb-1">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-semibold text-gray-100">{site.name}</h3>
                        <span className={`status-badge ${statusClass(site.status)}`}>{site.status || "stopped"}</span>
                        <span className="status-badge bg-white/5 text-gray-400">{site.type || "node"}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{hostLabel(site, hosts)}</p>
                      <p className="font-mono text-xs text-gray-400 mt-3 truncate">{site.path}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
                        {!!site.port && <span>localhost:{site.port}</span>}
                        {!!site.last_deployed_at && <span>Deployed {new Date(site.last_deployed_at).toLocaleString()}</span>}
                        {!!site.current_release && <span>Release {site.current_release.split("/").pop()}</span>}
                        {!!site.health && <span>{site.health}</span>}
                      </div>
                      {domains.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {domains.map((domain) => (
                            <a key={domain} href={`https://${domain}`} target="_blank" rel="noreferrer" className="status-badge bg-blue-500/10 text-blue-300 hover:bg-blue-500/20">
                              {domain}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 xl:max-w-xl xl:justify-end">
                      {canManage && !!site.host_id && !!site.source_path && site.type !== "proxy" && (
                        <button className="btn-primary" disabled={pending("deploy")} onClick={() => void run(site, "deploy")}>
                          <RocketLaunchIcon className="w-4 h-4 inline mr-1.5" />{pending("deploy") ? "Deploying…" : "Deploy"}
                        </button>
                      )}
                      {canManage && (site.status === "running" ? (
                        <button className="btn-secondary" onClick={() => void run(site, "stop")}>
                          <StopIcon className="w-4 h-4 inline mr-1.5" />Stop
                        </button>
                      ) : (
                        <button className="btn-secondary" onClick={() => void run(site, "start")}>
                          <PlayIcon className="w-4 h-4 inline mr-1.5" />Enable
                        </button>
                      ))}
                      {canManage && !!site.previous_release && <button className="btn-secondary" onClick={() => void run(site, "rollback")}><ArrowPathIcon className="w-4 h-4 inline mr-1.5" />Rollback</button>}
                      {canManage && !!site.host_id && <button className="btn-secondary" onClick={() => void run(site, "configure")}><GlobeAltIcon className="w-4 h-4 inline mr-1.5" />Sync domains</button>}
                      <button className="btn-secondary" onClick={() => void checkHealth(site)}><CheckCircleIcon className="w-4 h-4 inline mr-1.5" />Check</button>
                      <button className="btn-secondary" onClick={() => void openLogs(site)}><CommandLineIcon className="w-4 h-4 inline mr-1.5" />Logs</button>
                      {canManage && <button className="btn-secondary" onClick={() => openEdit(site)} aria-label={`Edit ${site.name}`}><PencilIcon className="w-4 h-4" /></button>}
                      {canManage && <button className="btn-danger" onClick={() => setDeleteTarget(site)} aria-label={`Delete ${site.name}`}><TrashIcon className="w-4 h-4" /></button>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>

      {formOpen && (
        <Modal title={editing ? `Edit ${editing.name}` : "Add site"} onClose={() => setFormOpen(false)}>
          <div className="max-h-[68vh] overflow-y-auto pr-1 space-y-5">
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-300"><CodeBracketIcon className="w-4 h-4" />Site</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Name"><input value={form.name} onChange={(event) => setField("name", event.target.value)} className="input-field w-full" placeholder="portfolio" /></Field>
                <Field label="Host">
                  <select value={form.hostId} onChange={(event) => setField("hostId", event.target.value)} className="input-field w-full">
                    <option value="">Local panel</option>
                    {remoteHosts.map((host) => <option key={host.id} value={host.id}>{host.name} · {host.address}</option>)}
                  </select>
                </Field>
                <Field label="Site type">
                  <select value={form.type} onChange={(event) => setField("type", event.target.value as SiteType)} className="input-field w-full">
                    {(Object.keys(typeCopy) as SiteType[]).map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                  <p className="text-[11px] text-gray-600 mt-1">{typeCopy[form.type]}</p>
                </Field>
                {(form.type === "node" || form.type === "proxy") && <Field label="Backend port"><input type="number" value={form.port} onChange={(event) => setField("port", event.target.value)} className="input-field w-full" placeholder="3000" /></Field>}
              </div>
              <Field label="Deployment root"><input value={form.path} onChange={(event) => setField("path", event.target.value)} className="input-field w-full font-mono" placeholder="/srv/storage/www/domains/portfolio" /></Field>
            </section>

            {form.type !== "proxy" && (
              <section className="space-y-3 border-t border-white/[0.06] pt-5">
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-300"><RocketLaunchIcon className="w-4 h-4" />Release</div>
                <Field label="Source directory"><input value={form.sourcePath} onChange={(event) => setField("sourcePath", event.target.value)} className="input-field w-full font-mono" placeholder="/srv/storage/www/staging/portfolio" /></Field>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Build command"><input value={form.buildCommand} onChange={(event) => setField("buildCommand", event.target.value)} className="input-field w-full font-mono" placeholder="npm ci && npm run build" /></Field>
                  <Field label="Publish directory"><input value={form.publishDir} onChange={(event) => setField("publishDir", event.target.value)} className="input-field w-full font-mono" placeholder="dist" /></Field>
                </div>
                {form.type === "node" && <Field label="Start command"><input value={form.startCommand} onChange={(event) => setField("startCommand", event.target.value)} className="input-field w-full font-mono" placeholder="npm start" /></Field>}
              </section>
            )}

            <section className="space-y-3 border-t border-white/[0.06] pt-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-300"><GlobeAltIcon className="w-4 h-4" />Domains & tunnel</div>
              <Field label="Domains" note="One hostname per line. Sync creates Nginx vhosts, Cloudflare tunnel ingress, and DNS routes.">
                <textarea value={form.domains} onChange={(event) => setField("domains", event.target.value)} className="input-field w-full min-h-20 font-mono" placeholder="portfolio.example.com" />
              </Field>
              <details className="group">
                <summary className="text-xs text-gray-500 cursor-pointer flex items-center gap-1.5"><ChevronDownIcon className="w-3.5 h-3.5 group-open:rotate-180" />Tunnel settings</summary>
                <div className="grid sm:grid-cols-2 gap-3 mt-3">
                  <Field label="Tunnel ID"><input value={form.tunnelId} onChange={(event) => setField("tunnelId", event.target.value)} className="input-field w-full font-mono" /></Field>
                  <Field label="Systemd service"><input value={form.tunnelService} onChange={(event) => setField("tunnelService", event.target.value)} className="input-field w-full font-mono" /></Field>
                </div>
                <div className="mt-3"><Field label="Tunnel config"><input value={form.tunnelConfig} onChange={(event) => setField("tunnelConfig", event.target.value)} className="input-field w-full font-mono" /></Field></div>
              </details>
            </section>
          </div>
          <div className="flex gap-2 mt-5 border-t border-white/[0.06] pt-4">
            <button className="btn-primary flex-1 disabled:opacity-60" onClick={() => void save()} disabled={busy === "save"}>{busy === "save" ? "Saving…" : editing ? "Save changes" : "Create site"}</button>
            <button className="btn-secondary flex-1" onClick={() => setFormOpen(false)}>Cancel</button>
          </div>
        </Modal>
      )}

      {logsSite && (
        <Modal title={`${logsSite.name} logs`} onClose={() => setLogsSite(null)}>
          <div className="bg-black/40 border border-white/[0.06] rounded-lg p-3 max-h-[60vh] overflow-auto font-mono text-xs leading-5">
            {logs.length === 0 ? <p className="text-gray-600">No deploy or runtime logs.</p> : logs.map((line, index) => (
              <div key={`${line.time}-${index}`} className={line.type === "stderr" ? "text-red-300" : line.type === "runtime" ? "text-blue-300" : "text-gray-300"}>
                <span className="text-gray-600 mr-2">{new Date(line.time).toLocaleTimeString()}</span>{line.data}
              </div>
            ))}
          </div>
          <button className="btn-secondary w-full mt-4" onClick={() => setLogsSite(null)}>Close</button>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Remove site" onClose={() => setDeleteTarget(null)}>
          <p className="text-sm text-gray-300">Remove <span className="font-semibold text-gray-100">{deleteTarget.name}</span> from Nestcore?</p>
          <p className="text-xs text-gray-500 mt-2">Managed Nginx, tunnel ingress, and service configuration are removed. Release files are preserved.</p>
          <div className="flex gap-2 mt-5">
            <button className="btn-danger flex-1" onClick={() => void remove()}>Remove site</button>
            <button className="btn-secondary flex-1" onClick={() => setDeleteTarget(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-gray-500 text-xs mb-1.5">{label}</span>
      {children}
      {note && <span className="block text-[11px] leading-4 text-gray-600 mt-1">{note}</span>}
    </label>
  );
}

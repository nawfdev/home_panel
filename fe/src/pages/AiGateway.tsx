import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Panel } from "../components/ui/Panel";
import { Modal } from "../components/ui/Modal";
import { SparklesIcon, KeyIcon, ChartBarIcon, CurrencyDollarIcon, ScissorsIcon, PlusIcon, TrashIcon, PencilIcon, Squares2X2Icon, ArrowPathIcon, CheckCircleIcon, ExclamationCircleIcon } from "@heroicons/react/24/outline";
import { logoForBaseUrl, PRESET_LOGOS } from "./providerLogos";
import { copyText } from "../lib/clipboard";

type ProviderKind = "openai" | "anthropic" | "gemini";

interface AiKeyView {
  id: string;
  label: string;
  masked: string;
  addedAt: string;
}

interface AiProviderView {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  priority: number;
  enabled: boolean;
  keys: AiKeyView[];
}

interface ProviderStatus {
  online: boolean;
  models: string[];
  error?: string;
}

interface KeyUsage {
  requestCount: number;
  errorCount: number;
  rateLimitCount: number;
  tokensIn: number;
  tokensOut: number;
  estimatedCostUsd: number;
  lastUsedAt?: number;
  lastErrorAt?: number;
  lastErrorMsg?: string;
}

interface UsageSnapshot {
  providers: Record<string, Record<string, KeyUsage>>;
  currentKeyIndex: Record<string, number>;
  flushedAt: number;
}

interface ModelPrice {
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
}

interface CompressionSettings {
  enabled: boolean;
  stripWhitespace: boolean;
  dedupeMessages: boolean;
  truncateLongBlocks: boolean;
  truncateCharLimit: number;
}

function kindLabel(kind: ProviderKind) {
  if (kind === "openai") return "OpenAI-compatible";
  if (kind === "anthropic") return "Anthropic";
  return "Gemini";
}

// Official, publicly documented base URLs only — no auth tricks, no OAuth
// session-borrowing. Base URLs match exactly what each adapter kind in
// be/internal/aigateway/adapters.go appends its own path onto.
interface ProviderPreset {
  key: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  docsHint: string;
}

const CUSTOM_PRESET_KEY = "custom";

const PROVIDER_PRESETS: ProviderPreset[] = [
  { key: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", docsHint: "Get a key: platform.openai.com/api-keys" },
  { key: "anthropic", label: "Anthropic (Claude)", kind: "anthropic", baseUrl: "https://api.anthropic.com", docsHint: "Get a key: console.anthropic.com/settings/keys" },
  { key: "gemini", label: "Google Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com", docsHint: "Get a key: aistudio.google.com/apikey" },
  { key: "groq", label: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", docsHint: "Get a key: console.groq.com/keys" },
  { key: "deepseek", label: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", docsHint: "Get a key: platform.deepseek.com/api_keys" },
  { key: "openrouter", label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", docsHint: "Get a key: openrouter.ai/keys" },
  { key: "mistral", label: "Mistral", kind: "openai", baseUrl: "https://api.mistral.ai/v1", docsHint: "Get a key: console.mistral.ai/api-keys" },
  { key: "together", label: "Together AI", kind: "openai", baseUrl: "https://api.together.xyz/v1", docsHint: "Get a key: api.together.ai/settings/api-keys" },
  { key: "xai", label: "xAI (Grok)", kind: "openai", baseUrl: "https://api.x.ai/v1", docsHint: "Get a key: console.x.ai" },
  { key: CUSTOM_PRESET_KEY, label: "Custom / other (OpenAI-compatible)", kind: "openai", baseUrl: "", docsHint: "" },
];

function formatTime(ms?: number) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export function AiGateway() {
  const { show } = useToast();

  const [gatewayConfigured, setGatewayConfigured] = useState<boolean | null>(null);
  const [gatewayPrefix, setGatewayPrefix] = useState("");
  const [rotating, setRotating] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copiedAck, setCopiedAck] = useState(false);

  const [providers, setProviders] = useState<AiProviderView[] | null>(null);
  const [providerModal, setProviderModal] = useState<AiProviderView | "new" | null>(null);
  const [presetForModal, setPresetForModal] = useState<ProviderPreset | null>(null);
  const [keysModalProvider, setKeysModalProvider] = useState<AiProviderView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  // providerId -> live status (online + models or error), fetched on demand.
  const [statuses, setStatuses] = useState<Record<string, ProviderStatus>>({});
  const [checkingStatus, setCheckingStatus] = useState<Record<string, boolean>>({});

  const [usage, setUsage] = useState<UsageSnapshot | null>(null);

  const [pricing, setPricing] = useState<ModelPrice[] | null>(null);
  const [savingPricing, setSavingPricing] = useState(false);

  const [compression, setCompression] = useState<CompressionSettings | null>(null);
  const [savingCompression, setSavingCompression] = useState(false);

  async function loadGatewayKey() {
    try {
      const data = await api<{ configured: boolean; prefix: string }>("/ai-gateway/gateway-key");
      setGatewayConfigured(data.configured);
      setGatewayPrefix(data.prefix);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load gateway key", "error");
    }
  }

  async function loadProviders() {
    try {
      const data = await api<{ success: boolean; providers: AiProviderView[] }>("/ai-gateway/providers");
      setProviders(data.providers ?? []);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load providers", "error");
      setProviders([]);
    }
  }

  async function checkStatus(providerId: string) {
    setCheckingStatus((s) => ({ ...s, [providerId]: true }));
    try {
      const data = await api<{ success: boolean; online: boolean; models?: string[]; error?: string }>(
        `/ai-gateway/providers/${providerId}/status`
      );
      setStatuses((s) => ({ ...s, [providerId]: { online: data.online, models: data.models ?? [], error: data.error } }));
    } catch (err) {
      setStatuses((s) => ({
        ...s,
        [providerId]: { online: false, models: [], error: err instanceof Error ? err.message : "Check failed" },
      }));
    } finally {
      setCheckingStatus((s) => ({ ...s, [providerId]: false }));
    }
  }

  async function loadUsage() {
    try {
      const data = await api<{ success: boolean; usage: UsageSnapshot }>("/ai-gateway/usage");
      setUsage(data.usage);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load usage", "error");
    }
  }

  async function loadPricing() {
    try {
      const data = await api<{ success: boolean; pricing: ModelPrice[] }>("/ai-gateway/pricing");
      setPricing(data.pricing ?? []);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load pricing", "error");
      setPricing([]);
    }
  }

  async function loadCompression() {
    try {
      const data = await api<{ success: boolean; compression: CompressionSettings }>("/ai-gateway/compression");
      setCompression(data.compression);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to load compression settings", "error");
    }
  }

  function loadAll() {
    loadGatewayKey();
    loadProviders();
    loadUsage();
    loadPricing();
    loadCompression();
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function rotateGatewayKey() {
    setConfirmRotate(false);
    setRotating(true);
    try {
      const data = await api<{ success: boolean; key?: string; error?: string }>("/ai-gateway/gateway-key/rotate", {
        method: "POST",
      });
      if (data.success && data.key) {
        setRevealedKey(data.key);
        setCopiedAck(false);
        loadGatewayKey();
      } else {
        show(data.error ?? "Failed to rotate key", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to rotate key", "error");
    } finally {
      setRotating(false);
    }
  }

  async function deleteProvider() {
    if (!deleteTarget) return;
    try {
      const data = await api<{ success: boolean; error?: string }>(`/ai-gateway/providers/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (data.success) {
        show("Provider deleted", "success");
        loadProviders();
      } else {
        show(data.error ?? "Failed to delete provider", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to delete provider", "error");
    } finally {
      setDeleteTarget(null);
    }
  }

  async function savePricing() {
    if (!pricing) return;
    setSavingPricing(true);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/ai-gateway/pricing", {
        method: "PUT",
        body: JSON.stringify({ pricing }),
      });
      if (data.success) {
        show(data.message ?? "Pricing saved", "success");
      } else {
        show(data.error ?? "Failed to save pricing", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save pricing", "error");
    } finally {
      setSavingPricing(false);
    }
  }

  async function saveCompression() {
    if (!compression) return;
    setSavingCompression(true);
    try {
      const data = await api<{ success: boolean; message?: string; error?: string }>("/ai-gateway/compression", {
        method: "PUT",
        body: JSON.stringify(compression),
      });
      if (data.success) {
        show(data.message ?? "Compression settings saved", "success");
      } else {
        show(data.error ?? "Failed to save compression settings", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save compression settings", "error");
    } finally {
      setSavingCompression(false);
    }
  }

  const usageRows: { providerId: string; providerName: string; keyId: string; keyLabel: string; u: KeyUsage }[] = [];
  if (usage && providers) {
    for (const [providerId, keys] of Object.entries(usage.providers)) {
      const provider = providers.find((p) => p.id === providerId);
      for (const [keyId, u] of Object.entries(keys)) {
        const key = provider?.keys.find((k) => k.id === keyId);
        usageRows.push({
          providerId,
          providerName: provider?.name ?? providerId,
          keyId,
          keyLabel: key?.label || key?.masked || keyId,
          u,
        });
      }
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">AI Gateway</h2>
          <p className="text-gray-500 text-sm mt-1">
            Route chat requests across multiple AI providers with automatic fallback
          </p>
        </div>
        <button className="btn-secondary" onClick={loadAll}>
          Refresh
        </button>
      </div>

      <div className="space-y-4">
        <Panel title="Gateway key" icon={KeyIcon}>
          <p className="text-xs text-gray-500 mb-3">
            External clients (any OpenAI-SDK-compatible app) authenticate to{" "}
            <span className="font-mono">/api/ai-gateway/v1/chat/completions</span> with this key — separate from your
            panel login.
          </p>
          {gatewayConfigured === null ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : gatewayConfigured ? (
            <div className="info-row">
              <span className="info-row-label">Status</span>
              <span className="info-row-value font-mono text-green-400">{gatewayPrefix}…</span>
            </div>
          ) : (
            <p className="text-sm text-gray-500 mb-3">Not configured yet — the proxy endpoint will refuse requests.</p>
          )}
          <button
            className="btn-primary w-full mt-3 disabled:opacity-60"
            onClick={() => setConfirmRotate(true)}
            disabled={rotating}
          >
            {rotating ? "Generating..." : gatewayConfigured ? "Rotate key" : "Generate key"}
          </button>
        </Panel>

        <Panel title={`Providers${providers ? ` (${providers.length})` : ""}`} icon={SparklesIcon}>
          <div className="flex justify-end gap-2 mb-3">
            <button className="btn-primary" onClick={() => setCatalogOpen(true)}>
              <Squares2X2Icon className="w-4 h-4 inline mr-1.5" />
              Browse catalog
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setPresetForModal(null);
                setProviderModal("new");
              }}
            >
              <PlusIcon className="w-4 h-4 inline mr-1.5" />
              Add manually
            </button>
          </div>
          {providers === null ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : providers.length === 0 ? (
            <p className="text-sm text-gray-500">No providers yet — browse the catalog to add one.</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {[...providers]
                .sort((a, b) => a.priority - b.priority)
                .map((p) => {
                  const Logo = logoForBaseUrl(p.baseUrl);
                  const st = statuses[p.id];
                  return (
                    <div key={p.id} className="bg-white/5 rounded-xl p-4 flex flex-col gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-11 h-11 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                          <Logo className="w-7 h-7" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-gray-100 truncate">{p.name}</span>
                            <span className="status-badge bg-blue-500/15 text-blue-400">{kindLabel(p.kind)}</span>
                            <span
                              className={`status-badge ${p.enabled ? "bg-green-500/15 text-green-400" : "bg-gray-500/15 text-gray-400"}`}
                            >
                              {p.enabled ? "enabled" : "disabled"}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 font-mono truncate mt-1">{p.baseUrl}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Priority {p.priority} · {p.keys.length} key{p.keys.length === 1 ? "" : "s"}
                          </p>
                        </div>
                      </div>

                      <div className="bg-black/20 rounded-lg px-3 py-2 text-xs">
                        {checkingStatus[p.id] ? (
                          <span className="text-gray-400">Checking…</span>
                        ) : st ? (
                          st.online ? (
                            <div>
                              <span className="text-green-400 inline-flex items-center gap-1">
                                <CheckCircleIcon className="w-4 h-4" /> Online · {st.models.length} models
                              </span>
                              {st.models.length > 0 && (
                                <div className="mt-1.5 max-h-20 overflow-y-auto flex flex-wrap gap-1">
                                  {st.models.slice(0, 40).map((m) => (
                                    <span key={m} className="font-mono text-[10px] bg-white/5 text-gray-400 rounded px-1.5 py-0.5">
                                      {m}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-red-400 inline-flex items-center gap-1" title={st.error}>
                              <ExclamationCircleIcon className="w-4 h-4 shrink-0" />
                              <span className="truncate">Offline{st.error ? ` — ${st.error}` : ""}</span>
                            </span>
                          )
                        ) : (
                          <span className="text-gray-500">Status unknown</span>
                        )}
                      </div>

                      <div className="flex gap-2 flex-wrap">
                        <button
                          className="btn-secondary !py-1.5 !px-2.5 text-xs disabled:opacity-60"
                          onClick={() => checkStatus(p.id)}
                          disabled={checkingStatus[p.id]}
                        >
                          <ArrowPathIcon className="w-3.5 h-3.5 inline mr-1" />
                          Check
                        </button>
                        <button className="btn-secondary !py-1.5 !px-2.5 text-xs" onClick={() => setKeysModalProvider(p)}>
                          <KeyIcon className="w-3.5 h-3.5 inline mr-1" />
                          Keys
                        </button>
                        <button
                          className="btn-secondary !py-1.5 !px-2.5 text-xs"
                          onClick={() => {
                            setPresetForModal(null);
                            setProviderModal(p);
                          }}
                        >
                          <PencilIcon className="w-3.5 h-3.5 inline mr-1" />
                          Edit
                        </button>
                        <button
                          className="btn-danger !py-1.5 !px-2.5 text-xs"
                          onClick={() => setDeleteTarget({ id: p.id, name: p.name })}
                        >
                          <TrashIcon className="w-3.5 h-3.5 inline mr-1" />
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </Panel>

        <Panel title="Usage & cost" icon={ChartBarIcon}>
          <p className="text-xs text-gray-500 mb-3">
            Recent errors/rate-limit events per key — no provider exposes a live "quota remaining" number, so this is
            observed activity, not a live quota.
          </p>
          {usage === null ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : usageRows.length === 0 ? (
            <p className="text-sm text-gray-500">No requests recorded yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-white/7">
                    <th className="text-left py-2 font-medium">Provider</th>
                    <th className="text-left py-2 font-medium">Key</th>
                    <th className="text-left py-2 font-medium">Requests</th>
                    <th className="text-left py-2 font-medium">Errors</th>
                    <th className="text-left py-2 font-medium">Rate-limits</th>
                    <th className="text-left py-2 font-medium">Tokens in/out</th>
                    <th className="text-left py-2 font-medium">Est. cost</th>
                    <th className="text-left py-2 font-medium">Last used</th>
                    <th className="text-left py-2 font-medium">Last error</th>
                  </tr>
                </thead>
                <tbody>
                  {usageRows.map((row) => (
                    <tr key={`${row.providerId}-${row.keyId}`} className="border-b border-white/5 text-gray-300">
                      <td className="py-2">{row.providerName}</td>
                      <td className="py-2 font-mono text-xs">{row.keyLabel}</td>
                      <td className="py-2 font-mono">{row.u.requestCount}</td>
                      <td className="py-2 font-mono">{row.u.errorCount}</td>
                      <td className="py-2 font-mono">{row.u.rateLimitCount}</td>
                      <td className="py-2 font-mono">
                        {row.u.tokensIn}/{row.u.tokensOut}
                      </td>
                      <td className="py-2 font-mono">${row.u.estimatedCostUsd.toFixed(4)}</td>
                      <td className="py-2 text-xs">{formatTime(row.u.lastUsedAt)}</td>
                      <td className="py-2 text-xs text-yellow-400 max-w-xs truncate" title={row.u.lastErrorMsg}>
                        {row.u.lastErrorMsg ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Model pricing" icon={CurrencyDollarIcon}>
          <p className="text-xs text-gray-500 mb-3">
            Used to estimate cost above. No universal pricing API exists across providers, so fill this in manually.
          </p>
          {pricing === null ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : (
            <div className="space-y-2">
              {pricing.map((row, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    value={row.model}
                    onChange={(e) => {
                      const next = [...pricing];
                      next[i] = { ...next[i], model: e.target.value };
                      setPricing(next);
                    }}
                    placeholder="Model name (e.g. gpt-4o)"
                    className="input-field flex-1 text-sm"
                  />
                  <input
                    type="number"
                    value={row.inputPerMillion}
                    onChange={(e) => {
                      const next = [...pricing];
                      next[i] = { ...next[i], inputPerMillion: parseFloat(e.target.value) || 0 };
                      setPricing(next);
                    }}
                    placeholder="$/1M in"
                    className="input-field w-28 text-sm"
                  />
                  <input
                    type="number"
                    value={row.outputPerMillion}
                    onChange={(e) => {
                      const next = [...pricing];
                      next[i] = { ...next[i], outputPerMillion: parseFloat(e.target.value) || 0 };
                      setPricing(next);
                    }}
                    placeholder="$/1M out"
                    className="input-field w-28 text-sm"
                  />
                  <button
                    className="btn-danger !px-2.5"
                    onClick={() => setPricing(pricing.filter((_, j) => j !== i))}
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                className="btn-secondary w-full"
                onClick={() => setPricing([...(pricing ?? []), { model: "", inputPerMillion: 0, outputPerMillion: 0 }])}
              >
                <PlusIcon className="w-4 h-4 inline mr-1.5" />
                Add model
              </button>
              <button className="btn-primary w-full disabled:opacity-60" onClick={savePricing} disabled={savingPricing}>
                {savingPricing ? "Saving..." : "Save pricing"}
              </button>
            </div>
          )}
        </Panel>

        <Panel title="Compression" icon={ScissorsIcon}>
          <p className="text-xs text-gray-500 mb-3">
            Heuristic, rule-based token trimming applied before requests are sent upstream (no ML — just whitespace,
            truncation, and duplicate removal).
          </p>
          {compression === null ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={compression.enabled}
                  onChange={(e) => setCompression({ ...compression, enabled: e.target.checked })}
                />
                Enable compression
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={compression.stripWhitespace}
                  onChange={(e) => setCompression({ ...compression, stripWhitespace: e.target.checked })}
                />
                Strip excess whitespace
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={compression.dedupeMessages}
                  onChange={(e) => setCompression({ ...compression, dedupeMessages: e.target.checked })}
                />
                Drop exact-duplicate messages
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={compression.truncateLongBlocks}
                  onChange={(e) => setCompression({ ...compression, truncateLongBlocks: e.target.checked })}
                />
                Truncate long message blocks
              </label>
              <div>
                <label className="block text-gray-500 text-xs mb-1.5">Truncate char limit</label>
                <input
                  type="number"
                  value={compression.truncateCharLimit}
                  onChange={(e) => setCompression({ ...compression, truncateCharLimit: parseInt(e.target.value) || 0 })}
                  className="input-field w-full text-sm"
                />
              </div>
              <button
                className="btn-primary w-full disabled:opacity-60"
                onClick={saveCompression}
                disabled={savingCompression}
              >
                {savingCompression ? "Saving..." : "Save compression settings"}
              </button>
            </div>
          )}
        </Panel>
      </div>

      {confirmRotate && (
        <Modal title={gatewayConfigured ? "Rotate gateway key" : "Generate gateway key"} onClose={() => setConfirmRotate(false)}>
          <p className="text-sm text-gray-300">
            {gatewayConfigured
              ? "This invalidates the current key immediately — any client using it will stop working until you update it with the new one."
              : "This creates the key external clients need to call the AI Gateway proxy endpoint."}
          </p>
          <div className="flex gap-2 mt-5">
            <button className="btn-primary flex-1" onClick={rotateGatewayKey}>
              {gatewayConfigured ? "Rotate now" : "Generate"}
            </button>
            <button className="btn-secondary flex-1" onClick={() => setConfirmRotate(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {revealedKey && (
        <Modal title="Gateway key generated" onClose={() => copiedAck && setRevealedKey(null)}>
          <p className="text-sm text-gray-300 mb-3">
            Copy this now — it will not be shown again. Use it as the API key/Bearer token in any OpenAI-SDK-compatible
            client, pointed at this panel's <span className="font-mono">/api/ai-gateway/v1</span> base URL.
          </p>
          <div className="flex gap-2">
            <input readOnly value={revealedKey} className="input-field flex-1 font-mono text-xs" />
            <button
              className="btn-secondary shrink-0"
              onClick={async () => {
                const ok = await copyText(revealedKey);
                show(ok ? "Copied to clipboard" : "Couldn't copy — select the key and copy manually", ok ? "success" : "warning");
              }}
            >
              Copy
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300 mt-4">
            <input type="checkbox" checked={copiedAck} onChange={(e) => setCopiedAck(e.target.checked)} />
            I've copied this key
          </label>
          <button
            className="btn-primary w-full mt-4 disabled:opacity-60"
            onClick={() => setRevealedKey(null)}
            disabled={!copiedAck}
          >
            Done
          </button>
        </Modal>
      )}

      {catalogOpen && (
        <Modal title="Provider catalog" onClose={() => setCatalogOpen(false)} wide>
          <p className="text-xs text-gray-500 mb-4">
            Pick a provider to pre-fill its base URL — you'll add your own API key next. All use official documented
            API endpoints; keys are never obtained via OAuth or borrowed subscriptions.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {PROVIDER_PRESETS.map((preset) => {
              const Logo = PRESET_LOGOS[preset.key] ?? PRESET_LOGOS.custom;
              return (
                <button
                  key={preset.key}
                  className="bg-white/5 hover:bg-white/10 rounded-xl p-4 flex flex-col items-center gap-2 text-center transition active:scale-95"
                  onClick={() => {
                    setPresetForModal(preset.key === CUSTOM_PRESET_KEY ? null : preset);
                    setCatalogOpen(false);
                    setProviderModal("new");
                  }}
                >
                  <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center">
                    <Logo className="w-8 h-8" />
                  </div>
                  <span className="text-xs text-gray-200 font-medium leading-tight">{preset.label}</span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}

      {providerModal && (
        <ProviderFormModal
          provider={providerModal === "new" ? undefined : providerModal}
          preset={presetForModal}
          onClose={() => {
            setProviderModal(null);
            setPresetForModal(null);
          }}
          onSaved={() => {
            setProviderModal(null);
            setPresetForModal(null);
            loadProviders();
          }}
        />
      )}

      {keysModalProvider && (
        <KeysModal
          provider={keysModalProvider}
          onClose={() => setKeysModalProvider(null)}
          onChanged={() => {
            loadProviders();
          }}
        />
      )}

      {deleteTarget && (
        <Modal title="Delete provider" onClose={() => setDeleteTarget(null)}>
          <p className="text-sm text-gray-300">
            Delete provider <span className="font-semibold text-gray-100">{deleteTarget.name}</span>? This cannot be
            undone.
          </p>
          <div className="flex gap-2 mt-5">
            <button className="btn-danger flex-1" onClick={deleteProvider}>
              Delete
            </button>
            <button className="btn-secondary flex-1" onClick={() => setDeleteTarget(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ProviderFormModal({
  provider,
  preset,
  onClose,
  onSaved,
}: {
  provider?: AiProviderView;
  preset?: ProviderPreset | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { show } = useToast();
  const [name, setName] = useState(provider?.name ?? preset?.label ?? "");
  const [kind, setKind] = useState<ProviderKind>(provider?.kind ?? preset?.kind ?? "openai");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? preset?.baseUrl ?? "");
  const [priority, setPriority] = useState(provider?.priority ?? 0);
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [presetKey, setPresetKey] = useState(preset?.key ?? "");

  function applyPreset(key: string) {
    setPresetKey(key);
    const p = PROVIDER_PRESETS.find((pp) => pp.key === key);
    if (!p || p.key === CUSTOM_PRESET_KEY) {
      return;
    }
    setName(p.label);
    setKind(p.kind);
    setBaseUrl(p.baseUrl);
  }

  const selectedPreset = PROVIDER_PRESETS.find((p) => p.key === presetKey);

  async function save() {
    if (!name || !baseUrl) {
      show("Name and base URL are required", "warning");
      return;
    }
    setSaving(true);
    try {
      const data = provider
        ? await api<{ success: boolean; error?: string }>(`/ai-gateway/providers/${provider.id}`, {
            method: "PUT",
            body: JSON.stringify({ name, baseUrl, priority, enabled }),
          })
        : await api<{ success: boolean; error?: string }>("/ai-gateway/providers", {
            method: "POST",
            body: JSON.stringify({ name, kind, baseUrl, priority, enabled }),
          });
      if (data.success) {
        show(provider ? "Provider updated" : "Provider added", "success");
        onSaved();
      } else {
        show(data.error ?? "Failed to save provider", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to save provider", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={provider ? "Edit provider" : "Add provider"} onClose={onClose}>
      <div className="space-y-3">
        {!provider && (
          <div>
            <label className="block text-gray-500 text-xs mb-1.5">Quick fill</label>
            <select value={presetKey} onChange={(e) => applyPreset(e.target.value)} className="input-field w-full">
              <option value="">— pick a provider —</option>
              {PROVIDER_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            {selectedPreset?.docsHint && <p className="text-xs text-gray-500 mt-1">{selectedPreset.docsHint}</p>}
          </div>
        )}
        <div>
          <label className="block text-gray-500 text-xs mb-1.5">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input-field w-full" placeholder="e.g. OpenAI primary" />
        </div>
        {!provider && (
          <div>
            <label className="block text-gray-500 text-xs mb-1.5">Kind</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as ProviderKind)} className="input-field w-full">
              <option value="openai">OpenAI-compatible (OpenAI, Groq, DeepSeek, OpenRouter, ...)</option>
              <option value="anthropic">Anthropic (native Messages API)</option>
              <option value="gemini">Gemini (native generateContent API)</option>
            </select>
          </div>
        )}
        <div>
          <label className="block text-gray-500 text-xs mb-1.5">Base URL</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="input-field w-full font-mono text-sm"
            placeholder="https://api.openai.com/v1"
          />
        </div>
        <div>
          <label className="block text-gray-500 text-xs mb-1.5">Priority (lower tried first)</label>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
            className="input-field w-full"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
      </div>
      <button className="btn-primary w-full mt-4 disabled:opacity-60" onClick={save} disabled={saving}>
        {saving ? "Saving..." : provider ? "Save changes" : "Add provider"}
      </button>
    </Modal>
  );
}

function KeysModal({
  provider,
  onClose,
  onChanged,
}: {
  provider: AiProviderView;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { show } = useToast();
  const [keys, setKeys] = useState(provider.keys);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [adding, setAdding] = useState(false);

  async function addKey() {
    if (!secret) {
      show("Secret is required", "warning");
      return;
    }
    setAdding(true);
    try {
      const data = await api<{ success: boolean; key?: AiKeyView; error?: string }>(
        `/ai-gateway/providers/${provider.id}/keys`,
        { method: "POST", body: JSON.stringify({ label, secret }) }
      );
      if (data.success && data.key) {
        setKeys([...keys, data.key]);
        setLabel("");
        setSecret("");
        onChanged();
        show("Key added", "success");
      } else {
        show(data.error ?? "Failed to add key", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to add key", "error");
    } finally {
      setAdding(false);
    }
  }

  async function deleteKey(keyId: string) {
    try {
      const data = await api<{ success: boolean; error?: string }>(`/ai-gateway/providers/${provider.id}/keys/${keyId}`, {
        method: "DELETE",
      });
      if (data.success) {
        setKeys(keys.filter((k) => k.id !== keyId));
        onChanged();
        show("Key deleted", "success");
      } else {
        show(data.error ?? "Failed to delete key", "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to delete key", "error");
    }
  }

  return (
    <Modal title={`Keys — ${provider.name}`} onClose={onClose}>
      <div className="space-y-2 mb-4">
        {keys.length === 0 ? (
          <p className="text-sm text-gray-500">No keys yet</p>
        ) : (
          keys.map((k) => (
            <div key={k.id} className="bg-white/5 rounded-lg p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-gray-100 truncate">{k.label || "(unlabeled)"}</p>
                <p className="text-xs text-gray-500 font-mono">{k.masked}</p>
              </div>
              <button className="btn-danger !px-2.5 shrink-0" onClick={() => deleteKey(k.id)}>
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
      <div className="space-y-2 border-t border-white/7 pt-4">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className="input-field w-full text-sm" />
        <input
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="API key / secret"
          type="password"
          className="input-field w-full text-sm"
        />
        <button className="btn-primary w-full disabled:opacity-60" onClick={addKey} disabled={adding}>
          {adding ? "Adding..." : "Add key"}
        </button>
      </div>
    </Modal>
  );
}

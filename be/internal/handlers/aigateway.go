package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/kaysa/home-panel/internal/aigateway"
	"github.com/kaysa/home-panel/internal/httpx"
)

// AiGateway serves the config/dashboard endpoints (cookie-session auth, same
// as every other domain in this app). The proxy endpoint itself lives in
// aigateway_proxy.go behind a separate gateway-key auth mechanism.
type AiGateway struct {
	Svc *aigateway.Service
}

// ---- DTOs: never echo raw key secrets back to the browser ----

type aiKeyView struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Masked  string `json:"masked"`
	AddedAt string `json:"addedAt"`
}

type aiProviderView struct {
	ID       string      `json:"id"`
	Name     string      `json:"name"`
	Kind     string      `json:"kind"`
	BaseURL  string      `json:"baseUrl"`
	Priority int         `json:"priority"`
	Enabled  bool        `json:"enabled"`
	Keys     []aiKeyView `json:"keys"`
}

func maskSecret(s string) string {
	if len(s) <= 8 {
		return "••••••••"
	}
	return s[:3] + "…" + s[len(s)-4:]
}

func toProviderView(p aigateway.ProviderConfig) aiProviderView {
	keys := make([]aiKeyView, len(p.Keys))
	for i, k := range p.Keys {
		keys[i] = aiKeyView{ID: k.ID, Label: k.Label, Masked: maskSecret(k.Secret), AddedAt: k.AddedAt}
	}
	return aiProviderView{
		ID: p.ID, Name: p.Name, Kind: string(p.Kind), BaseURL: p.BaseURL,
		Priority: p.Priority, Enabled: p.Enabled, Keys: keys,
	}
}

// ---- Providers ----

func (h *AiGateway) ListProviders(w http.ResponseWriter, r *http.Request) {
	providers := h.Svc.ListProviders()
	views := make([]aiProviderView, len(providers))
	for i, p := range providers {
		views[i] = toProviderView(p)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "providers": views})
}

func (h *AiGateway) CreateProvider(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string `json:"name"`
		Kind     string `json:"kind"`
		BaseURL  string `json:"baseUrl"`
		Priority int    `json:"priority"`
		Enabled  bool   `json:"enabled"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Name == "" || body.BaseURL == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "name and baseUrl are required"})
		return
	}
	kind := aigateway.ProviderKind(body.Kind)
	if !kind.Valid() {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "kind must be openai, anthropic, or gemini"})
		return
	}
	p, err := h.Svc.CreateProvider(aigateway.ProviderConfig{
		Name: body.Name, Kind: kind, BaseURL: body.BaseURL, Priority: body.Priority, Enabled: body.Enabled,
	})
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "provider": toProviderView(p)})
}

func (h *AiGateway) UpdateProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Name     *string `json:"name"`
		BaseURL  *string `json:"baseUrl"`
		Priority *int    `json:"priority"`
		Enabled  *bool   `json:"enabled"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	p, err := h.Svc.UpdateProvider(id, func(pc *aigateway.ProviderConfig) {
		if body.Name != nil {
			pc.Name = *body.Name
		}
		if body.BaseURL != nil {
			pc.BaseURL = *body.BaseURL
		}
		if body.Priority != nil {
			pc.Priority = *body.Priority
		}
		if body.Enabled != nil {
			pc.Enabled = *body.Enabled
		}
	})
	if err != nil {
		httpx.JSON(w, http.StatusNotFound, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "provider": toProviderView(p)})
}

func (h *AiGateway) DeleteProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.Svc.DeleteProvider(id); err != nil {
		httpx.JSON(w, http.StatusNotFound, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Provider deleted"})
}

func (h *AiGateway) AddKey(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Label  string `json:"label"`
		Secret string `json:"secret"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Secret == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "secret is required"})
		return
	}
	key, err := h.Svc.AddKey(id, aigateway.ProviderKey{Label: body.Label, Secret: body.Secret})
	if err != nil {
		httpx.JSON(w, http.StatusNotFound, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"success": true,
		"key":     aiKeyView{ID: key.ID, Label: key.Label, Masked: maskSecret(key.Secret), AddedAt: key.AddedAt},
	})
}

func (h *AiGateway) DeleteKey(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	keyID := chi.URLParam(r, "keyId")
	if err := h.Svc.DeleteKey(id, keyID); err != nil {
		httpx.JSON(w, http.StatusNotFound, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Key deleted"})
}

// ProviderStatus pings the provider's model-list endpoint: success means it's
// reachable and the key is valid (online), and returns the available models.
func (h *AiGateway) ProviderStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	models, err := h.Svc.ProviderModels(r.Context(), id)
	if err != nil {
		httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "online": false, "error": err.Error(), "models": []string{}})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "online": true, "models": models})
}

// ---- Usage / cost dashboard ----

func (h *AiGateway) Usage(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "usage": h.Svc.UsageSnapshot()})
}

// ---- Pricing table ----

func (h *AiGateway) GetPricing(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "pricing": h.Svc.GetPricing()})
}

func (h *AiGateway) SavePricing(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Pricing []aigateway.ModelPrice `json:"pricing"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if err := h.Svc.SavePricing(body.Pricing); err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Pricing saved"})
}

// ---- Compression settings ----

func (h *AiGateway) GetCompression(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "compression": h.Svc.GetCompression()})
}

func (h *AiGateway) SaveCompression(w http.ResponseWriter, r *http.Request) {
	var body aigateway.CompressionSettings
	_ = json.NewDecoder(r.Body).Decode(&body)
	if err := h.Svc.SaveCompression(body); err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Compression settings saved"})
}

// ---- Gateway key (shown once on rotate, masked prefix otherwise) ----

func (h *AiGateway) GetGatewayKey(w http.ResponseWriter, r *http.Request) {
	prefix, configured := h.Svc.GatewayKeyInfo()
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "configured": configured, "prefix": prefix})
}

func (h *AiGateway) RotateGatewayKey(w http.ResponseWriter, r *http.Request) {
	raw, err := h.Svc.RotateGatewayKey()
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"success": true,
		"key":     raw,
		"message": "Save this key now — it will not be shown again.",
	})
}

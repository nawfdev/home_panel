package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/kaysa/home-panel/internal/aigateway"
	"github.com/kaysa/home-panel/internal/httpx"
)

// GatewayAuth guards the proxy endpoint, which is called by an external
// client application, not a logged-in browser — it needs a long-lived
// gateway key, not the panel's own cookie session (auth.RequireAuth).
type GatewayAuth struct {
	Svc *aigateway.Service
}

func (g *GatewayAuth) RequireGatewayKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, configured := g.Svc.GatewayKeyInfo(); !configured {
			httpx.JSON(w, http.StatusServiceUnavailable, map[string]any{"error": "AI Gateway is not configured yet"})
			return
		}
		authHeader := r.Header.Get("Authorization")
		raw := strings.TrimPrefix(authHeader, "Bearer ")
		if raw == authHeader || !g.Svc.VerifyGatewayKey(raw) {
			httpx.JSON(w, http.StatusUnauthorized, map[string]any{"error": "Invalid gateway key"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ChatCompletions is the OpenAI-compatible proxy entrypoint
// (POST /api/ai-gateway/v1/chat/completions), routed by aigateway.Service
// across whichever providers/keys are configured, with automatic fallback.
func (h *AiGateway) ChatCompletions(w http.ResponseWriter, r *http.Request) {
	var req aigateway.ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}
	if req.Stream {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"error": "streaming responses are not supported yet"})
		return
	}
	resp, err := h.Svc.ChatCompletion(r.Context(), req)
	if err != nil {
		httpx.JSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, resp)
}

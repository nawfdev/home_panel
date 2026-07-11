package aigateway

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

// Canonical wire format the proxy endpoint speaks: OpenAI's chat-completions
// shape, since it's the one every existing AI client SDK already knows.
// adapters below translate this to/from each provider's native shape.
//
// v1 scope: plain string message content only (no multi-part/image content),
// no tool/function-calling translation (shapes differ too much between
// providers to translate generically — a clearly-flagged v2+ item).
type ChatMessage struct {
	Role    string `json:"role"` // "system" | "user" | "assistant"
	Content string `json:"content"`
}

type ChatRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	Temperature *float64      `json:"temperature,omitempty"`
	MaxTokens   *int          `json:"max_tokens,omitempty"`
	Stream      bool          `json:"stream,omitempty"` // rejected with a clear error in v1
}

type ChatChoice struct {
	Index        int         `json:"index"`
	Message      ChatMessage `json:"message"`
	FinishReason string      `json:"finish_reason"`
}

type ChatUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type ChatResponse struct {
	ID      string       `json:"id"`
	Model   string       `json:"model"`
	Choices []ChatChoice `json:"choices"`
	Usage   *ChatUsage   `json:"usage,omitempty"`
}

// providerError carries the upstream HTTP status so the fallback loop in
// proxy.go can tell a transient problem (429/5xx — try the next key) from a
// hard client error (other 4xx — fail fast, no point burning through keys).
type providerError struct {
	StatusCode int
	Message    string
}

func (e *providerError) Error() string { return e.Message }

func callProvider(ctx context.Context, kind ProviderKind, baseURL, key string, req ChatRequest) (ChatResponse, error) {
	switch kind {
	case KindAnthropic:
		return callAnthropic(ctx, baseURL, key, req)
	case KindGemini:
		return callGemini(ctx, baseURL, key, req)
	default:
		return callOpenAI(ctx, baseURL, key, req)
	}
}

// listModels queries the provider's model-list endpoint. A successful call
// doubles as a health/auth check (the key works and the provider is
// reachable), so the UI uses it for both the online indicator and the model
// dropdown. All three shapes normalize to a plain sorted []string of model IDs.
func listModels(ctx context.Context, kind ProviderKind, baseURL, key string) ([]string, error) {
	switch kind {
	case KindAnthropic:
		return listAnthropicModels(ctx, baseURL, key)
	case KindGemini:
		return listGeminiModels(ctx, baseURL, key)
	default:
		return listOpenAIModels(ctx, baseURL, key)
	}
}

func doModelListGet(ctx context.Context, url string, headers map[string]string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, &providerError{StatusCode: resp.StatusCode, Message: extractErrorMessage(raw, resp.StatusCode)}
	}
	return raw, nil
}

func listOpenAIModels(ctx context.Context, baseURL, key string) ([]string, error) {
	raw, err := doModelListGet(ctx, strings.TrimRight(baseURL, "/")+"/models", map[string]string{
		"Authorization": "Bearer " + key,
	})
	if err != nil {
		return nil, err
	}
	var out struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode models response: %w", err)
	}
	models := make([]string, 0, len(out.Data))
	for _, m := range out.Data {
		if m.ID != "" {
			models = append(models, m.ID)
		}
	}
	sort.Strings(models)
	return models, nil
}

func listAnthropicModels(ctx context.Context, baseURL, key string) ([]string, error) {
	raw, err := doModelListGet(ctx, strings.TrimRight(baseURL, "/")+"/v1/models", map[string]string{
		"x-api-key":         key,
		"anthropic-version": "2023-06-01",
	})
	if err != nil {
		return nil, err
	}
	var out struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode models response: %w", err)
	}
	models := make([]string, 0, len(out.Data))
	for _, m := range out.Data {
		if m.ID != "" {
			models = append(models, m.ID)
		}
	}
	sort.Strings(models)
	return models, nil
}

func listGeminiModels(ctx context.Context, baseURL, key string) ([]string, error) {
	raw, err := doModelListGet(ctx, fmt.Sprintf("%s/v1beta/models?key=%s", strings.TrimRight(baseURL, "/"), key), nil)
	if err != nil {
		return nil, err
	}
	var out struct {
		Models []struct {
			Name string `json:"name"` // e.g. "models/gemini-1.5-pro"
		} `json:"models"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode models response: %w", err)
	}
	models := make([]string, 0, len(out.Models))
	for _, m := range out.Models {
		name := strings.TrimPrefix(m.Name, "models/")
		if name != "" {
			models = append(models, name)
		}
	}
	sort.Strings(models)
	return models, nil
}

// extractErrorMessage pulls a human-readable message out of a provider's
// error body, which nearly every provider shapes as either
// {"error":{"message":...}} or {"message":...}.
func extractErrorMessage(raw []byte, statusCode int) string {
	var generic struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if json.Unmarshal(raw, &generic) == nil {
		if generic.Error != nil && generic.Error.Message != "" {
			return generic.Error.Message
		}
		if generic.Message != "" {
			return generic.Message
		}
	}
	if len(raw) > 0 && len(raw) < 500 {
		return string(raw)
	}
	return fmt.Sprintf("provider returned HTTP %d", statusCode)
}

// ---- OpenAI-compatible (OpenAI, Groq, DeepSeek, OpenRouter, ...) ----
// Near-trivial passthrough: the canonical shape already *is* this shape.

func callOpenAI(ctx context.Context, baseURL, key string, req ChatRequest) (ChatResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return ChatResponse{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(baseURL, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return ChatResponse{}, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+key)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return ChatResponse{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return ChatResponse{}, &providerError{StatusCode: resp.StatusCode, Message: extractErrorMessage(raw, resp.StatusCode)}
	}
	var out ChatResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return ChatResponse{}, fmt.Errorf("decode openai-compatible response: %w", err)
	}
	return out, nil
}

// ---- Anthropic native Messages API ----

type anthropicMessage struct {
	Role    string `json:"role"` // "user" | "assistant" only — no "system" role here
	Content string `json:"content"`
}

type anthropicRequest struct {
	Model       string             `json:"model"`
	System      string             `json:"system,omitempty"`
	Messages    []anthropicMessage `json:"messages"`
	MaxTokens   int                `json:"max_tokens"` // required by Anthropic, unlike OpenAI
	Temperature *float64           `json:"temperature,omitempty"`
}

type anthropicContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type anthropicUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

type anthropicResponse struct {
	ID         string                  `json:"id"`
	Model      string                  `json:"model"`
	Content    []anthropicContentBlock `json:"content"`
	StopReason string                  `json:"stop_reason"`
	Usage      anthropicUsage          `json:"usage"`
}

const anthropicDefaultMaxTokens = 4096

func callAnthropic(ctx context.Context, baseURL, key string, req ChatRequest) (ChatResponse, error) {
	var systemParts []string
	msgs := make([]anthropicMessage, 0, len(req.Messages))
	for _, m := range req.Messages {
		if m.Role == "system" {
			systemParts = append(systemParts, m.Content)
			continue
		}
		msgs = append(msgs, anthropicMessage{Role: m.Role, Content: m.Content})
	}
	maxTokens := anthropicDefaultMaxTokens
	if req.MaxTokens != nil && *req.MaxTokens > 0 {
		maxTokens = *req.MaxTokens
	}
	areq := anthropicRequest{
		Model:       req.Model,
		System:      strings.Join(systemParts, "\n\n"),
		Messages:    msgs,
		MaxTokens:   maxTokens,
		Temperature: req.Temperature,
	}
	body, err := json.Marshal(areq)
	if err != nil {
		return ChatResponse{}, err
	}
	url := strings.TrimRight(baseURL, "/") + "/v1/messages"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return ChatResponse{}, err
	}
	httpReq.Header.Set("x-api-key", key)
	httpReq.Header.Set("anthropic-version", "2023-06-01")
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return ChatResponse{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return ChatResponse{}, &providerError{StatusCode: resp.StatusCode, Message: extractErrorMessage(raw, resp.StatusCode)}
	}
	var out anthropicResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return ChatResponse{}, fmt.Errorf("decode anthropic response: %w", err)
	}

	var text strings.Builder
	for _, c := range out.Content {
		if c.Type == "text" {
			text.WriteString(c.Text)
		}
	}
	return ChatResponse{
		ID:    out.ID,
		Model: out.Model,
		Choices: []ChatChoice{{
			Index:        0,
			Message:      ChatMessage{Role: "assistant", Content: text.String()},
			FinishReason: out.StopReason,
		}},
		Usage: &ChatUsage{
			PromptTokens:     out.Usage.InputTokens,
			CompletionTokens: out.Usage.OutputTokens,
			TotalTokens:      out.Usage.InputTokens + out.Usage.OutputTokens,
		},
	}, nil
}

// ---- Gemini native generateContent API ----

type geminiPart struct {
	Text string `json:"text"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"` // "user" | "model" (Gemini's name for "assistant")
	Parts []geminiPart `json:"parts"`
}

type geminiGenerationConfig struct {
	Temperature     *float64 `json:"temperature,omitempty"`
	MaxOutputTokens *int     `json:"maxOutputTokens,omitempty"`
}

type geminiRequest struct {
	Contents          []geminiContent         `json:"contents"`
	SystemInstruction *geminiContent          `json:"systemInstruction,omitempty"`
	GenerationConfig  *geminiGenerationConfig `json:"generationConfig,omitempty"`
}

type geminiUsageMetadata struct {
	PromptTokenCount     int `json:"promptTokenCount"`
	CandidatesTokenCount int `json:"candidatesTokenCount"`
	TotalTokenCount      int `json:"totalTokenCount"`
}

type geminiCandidate struct {
	Content      geminiContent `json:"content"`
	FinishReason string        `json:"finishReason"`
}

type geminiResponse struct {
	Candidates    []geminiCandidate   `json:"candidates"`
	UsageMetadata geminiUsageMetadata `json:"usageMetadata"`
}

const geminiDefaultModel = "gemini-pro"

func callGemini(ctx context.Context, baseURL, key string, req ChatRequest) (ChatResponse, error) {
	var sys *geminiContent
	contents := make([]geminiContent, 0, len(req.Messages))
	for _, m := range req.Messages {
		if m.Role == "system" {
			if sys == nil {
				sys = &geminiContent{}
			}
			sys.Parts = append(sys.Parts, geminiPart{Text: m.Content})
			continue
		}
		role := "user"
		if m.Role == "assistant" {
			role = "model"
		}
		contents = append(contents, geminiContent{Role: role, Parts: []geminiPart{{Text: m.Content}}})
	}

	greq := geminiRequest{Contents: contents, SystemInstruction: sys}
	if req.Temperature != nil || req.MaxTokens != nil {
		greq.GenerationConfig = &geminiGenerationConfig{Temperature: req.Temperature, MaxOutputTokens: req.MaxTokens}
	}

	body, err := json.Marshal(greq)
	if err != nil {
		return ChatResponse{}, err
	}
	model := req.Model
	if model == "" {
		model = geminiDefaultModel
	}
	url := fmt.Sprintf("%s/v1beta/models/%s:generateContent?key=%s", strings.TrimRight(baseURL, "/"), model, key)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return ChatResponse{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return ChatResponse{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return ChatResponse{}, &providerError{StatusCode: resp.StatusCode, Message: extractErrorMessage(raw, resp.StatusCode)}
	}
	var out geminiResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return ChatResponse{}, fmt.Errorf("decode gemini response: %w", err)
	}

	var text strings.Builder
	finish := ""
	if len(out.Candidates) > 0 {
		finish = out.Candidates[0].FinishReason
		for _, p := range out.Candidates[0].Content.Parts {
			text.WriteString(p.Text)
		}
	}
	return ChatResponse{
		Model: model,
		Choices: []ChatChoice{{
			Index:        0,
			Message:      ChatMessage{Role: "assistant", Content: text.String()},
			FinishReason: finish,
		}},
		Usage: &ChatUsage{
			PromptTokens:     out.UsageMetadata.PromptTokenCount,
			CompletionTokens: out.UsageMetadata.CandidatesTokenCount,
			TotalTokens:      out.UsageMetadata.TotalTokenCount,
		},
	}, nil
}

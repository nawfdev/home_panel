package aigateway

import (
	"context"
	"errors"
	"fmt"
	"net/http"
)

var ErrNoProviders = errors.New("no enabled AI providers configured")

// ChatCompletion tries enabled providers in priority order, and within each
// provider tries its keys starting from whichever key last worked. On a
// 429/5xx/network error it advances to the next key (or provider once keys
// are exhausted); any other 4xx (bad request, invalid model, ...) fails
// immediately since retrying a different key won't fix a client error.
func (s *Service) ChatCompletion(ctx context.Context, req ChatRequest) (ChatResponse, error) {
	if req.Stream {
		return ChatResponse{}, fmt.Errorf("streaming responses are not supported yet")
	}

	req = s.maybeCompress(req)

	providers := s.sortedEnabledProviders()
	if len(providers) == 0 {
		return ChatResponse{}, ErrNoProviders
	}

	var lastErr error
	for _, p := range providers {
		if len(p.Keys) == 0 {
			continue
		}
		start := s.usage.currentKeyIndexFor(p.ID)
		for i := 0; i < len(p.Keys); i++ {
			idx := (start + i) % len(p.Keys)
			key := p.Keys[idx]

			resp, err := callProvider(ctx, p.Kind, p.BaseURL, key.Secret, req)
			if err == nil {
				s.usage.setCurrentKeyIndex(p.ID, idx)
				cost, _ := s.EstimateCost(resp.Model, tokensIn(resp), tokensOut(resp))
				s.usage.recordSuccess(p.ID, key.ID, tokensIn(resp), tokensOut(resp), cost)
				return resp, nil
			}

			lastErr = err
			var perr *providerError
			retryable := true
			rateLimited := false
			if errors.As(err, &perr) {
				rateLimited = perr.StatusCode == http.StatusTooManyRequests
				retryable = rateLimited || perr.StatusCode >= 500
			}
			s.usage.recordError(p.ID, key.ID, rateLimited, err.Error())
			if !retryable {
				return ChatResponse{}, err
			}
			// else: try the next key/provider
		}
	}

	if lastErr != nil {
		return ChatResponse{}, fmt.Errorf("all providers failed, last error: %w", lastErr)
	}
	return ChatResponse{}, ErrNoProviders
}

func tokensIn(r ChatResponse) int {
	if r.Usage == nil {
		return 0
	}
	return r.Usage.PromptTokens
}

func tokensOut(r ChatResponse) int {
	if r.Usage == nil {
		return 0
	}
	return r.Usage.CompletionTokens
}

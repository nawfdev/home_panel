package aigateway

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/kaysa/home-panel/internal/store"
)

// KeyUsage is per-provider-key operational state. Kept OUT of Config: it
// changes on every proxied request, so it's tracked in memory and flushed to
// the store periodically instead of on every single write (the store
// rewrites the entire db.json on every SetSetting call — see store.go).
type KeyUsage struct {
	RequestCount     uint64  `json:"requestCount"`
	ErrorCount       uint64  `json:"errorCount"`
	RateLimitCount   uint64  `json:"rateLimitCount"`
	TokensIn         uint64  `json:"tokensIn"`
	TokensOut        uint64  `json:"tokensOut"`
	EstimatedCostUSD float64 `json:"estimatedCostUsd"`
	LastUsedAt       int64   `json:"lastUsedAt,omitempty"`
	LastErrorAt      int64   `json:"lastErrorAt,omitempty"`
	LastErrorMsg     string  `json:"lastErrorMsg,omitempty"`
}

// UsageSnapshot is the persisted (approximate, ~30s-stale-at-most) view of
// KeyUsage across every provider/key, plus which key each provider is
// currently "stuck" on after a fallback.
type UsageSnapshot struct {
	Providers       map[string]map[string]KeyUsage `json:"providers"` // providerID -> keyID -> counters
	CurrentKeyIndex map[string]int                 `json:"currentKeyIndex"`
	FlushedAt       int64                          `json:"flushedAt"`
}

func loadUsage(st *store.Store) UsageSnapshot {
	v, ok := st.GetSetting(usageSettingKey)
	if !ok {
		return UsageSnapshot{}
	}
	b, err := json.Marshal(v)
	if err != nil {
		return UsageSnapshot{}
	}
	var snap UsageSnapshot
	_ = json.Unmarshal(b, &snap)
	return snap
}

// usageState is the in-memory, high-write-frequency mirror. All mutation
// happens here; the store is only touched by periodic/shutdown flushes.
type usageState struct {
	mu              sync.Mutex
	providers       map[string]map[string]*KeyUsage
	currentKeyIndex map[string]int
	dirty           bool
}

func newUsageState() *usageState {
	return &usageState{
		providers:       map[string]map[string]*KeyUsage{},
		currentKeyIndex: map[string]int{},
	}
}

func (u *usageState) loadSnapshot(snap UsageSnapshot) {
	u.mu.Lock()
	defer u.mu.Unlock()
	for pid, keys := range snap.Providers {
		m := map[string]*KeyUsage{}
		for kid, ku := range keys {
			kuCopy := ku
			m[kid] = &kuCopy
		}
		u.providers[pid] = m
	}
	for pid, idx := range snap.CurrentKeyIndex {
		u.currentKeyIndex[pid] = idx
	}
}

func (u *usageState) snapshot() UsageSnapshot {
	u.mu.Lock()
	defer u.mu.Unlock()
	out := UsageSnapshot{
		Providers:       map[string]map[string]KeyUsage{},
		CurrentKeyIndex: map[string]int{},
		FlushedAt:       time.Now().UnixMilli(),
	}
	for pid, keys := range u.providers {
		m := map[string]KeyUsage{}
		for kid, ku := range keys {
			m[kid] = *ku
		}
		out.Providers[pid] = m
	}
	for pid, idx := range u.currentKeyIndex {
		out.CurrentKeyIndex[pid] = idx
	}
	return out
}

func (u *usageState) getOrCreate(providerID, keyID string) *KeyUsage {
	m, ok := u.providers[providerID]
	if !ok {
		m = map[string]*KeyUsage{}
		u.providers[providerID] = m
	}
	ku, ok := m[keyID]
	if !ok {
		ku = &KeyUsage{}
		m[keyID] = ku
	}
	return ku
}

func (u *usageState) recordSuccess(providerID, keyID string, tokensIn, tokensOut int, cost float64) {
	u.mu.Lock()
	defer u.mu.Unlock()
	ku := u.getOrCreate(providerID, keyID)
	ku.RequestCount++
	ku.TokensIn += uint64(tokensIn)
	ku.TokensOut += uint64(tokensOut)
	ku.EstimatedCostUSD += cost
	ku.LastUsedAt = time.Now().UnixMilli()
	u.dirty = true
}

func (u *usageState) recordError(providerID, keyID string, rateLimited bool, msg string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	ku := u.getOrCreate(providerID, keyID)
	ku.ErrorCount++
	if rateLimited {
		ku.RateLimitCount++
	}
	ku.LastErrorAt = time.Now().UnixMilli()
	ku.LastErrorMsg = msg
	u.dirty = true
}

func (u *usageState) setCurrentKeyIndex(providerID string, idx int) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.currentKeyIndex[providerID] != idx {
		u.currentKeyIndex[providerID] = idx
		u.dirty = true
	}
}

func (u *usageState) currentKeyIndexFor(providerID string) int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.currentKeyIndex[providerID]
}

// takeSnapshotIfDirty returns (snapshot, true) only if something changed
// since the last call, so idle periods don't rewrite an unchanged blob.
func (u *usageState) takeSnapshotIfDirty() (UsageSnapshot, bool) {
	u.mu.Lock()
	dirty := u.dirty
	u.dirty = false
	u.mu.Unlock()
	if !dirty {
		return UsageSnapshot{}, false
	}
	return u.snapshot(), true
}

// UsageSnapshot returns the current live counters (not the possibly-~30s-old
// persisted copy) for the dashboard.
func (s *Service) UsageSnapshot() UsageSnapshot {
	return s.usage.snapshot()
}

// FlushUsage writes the in-memory counters to the store if they've changed
// since the last flush. Safe to call frequently (on a ticker) or once on
// shutdown — a no-op when nothing changed.
func (s *Service) FlushUsage() {
	snap, dirty := s.usage.takeSnapshotIfDirty()
	if !dirty {
		return
	}
	_ = s.store.SetSetting(usageSettingKey, snap)
}

// StartUsageFlusher periodically flushes usage counters until ctx is
// cancelled. Call FlushUsage() once more on graceful shutdown to bound the
// data-loss window.
func (s *Service) StartUsageFlusher(ctx context.Context, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.FlushUsage()
			}
		}
	}()
}

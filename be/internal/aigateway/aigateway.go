// Package aigateway is a Go-native, from-scratch AI gateway inspired by the
// core idea behind the OmniRoute project (github.com/diegosouzapw/OmniRoute):
// one endpoint that routes chat requests across multiple AI providers/keys
// with automatic fallback. It is not a port of OmniRoute — a much smaller,
// original implementation scoped to this panel's Go backend.
package aigateway

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/kaysa/home-panel/internal/store"
)

const (
	configSettingKey = "aigateway_config"
	usageSettingKey  = "aigateway_usage"
)

type ProviderKind string

const (
	KindOpenAI    ProviderKind = "openai"    // OpenAI-compatible passthrough (OpenAI, Groq, DeepSeek, OpenRouter, ...)
	KindAnthropic ProviderKind = "anthropic" // native Messages API
	KindGemini    ProviderKind = "gemini"    // native generateContent API
)

func (k ProviderKind) Valid() bool {
	switch k {
	case KindOpenAI, KindAnthropic, KindGemini:
		return true
	default:
		return false
	}
}

type ProviderKey struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Secret  string `json:"secret"` // plaintext, matches existing Cloudflare/Telegram precedent
	AddedAt string `json:"addedAt"`
}

type ProviderConfig struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	Kind     ProviderKind  `json:"kind"`
	BaseURL  string        `json:"baseUrl"`
	Priority int           `json:"priority"` // lower tried first
	Enabled  bool          `json:"enabled"`
	Keys     []ProviderKey `json:"keys"`
}

type CompressionSettings struct {
	Enabled            bool `json:"enabled"`
	StripWhitespace    bool `json:"stripWhitespace"`
	DedupeMessages     bool `json:"dedupeMessages"`
	TruncateLongBlocks bool `json:"truncateLongBlocks"`
	TruncateCharLimit  int  `json:"truncateCharLimit"`
}

type ModelPrice struct {
	Model            string  `json:"model"`
	InputPerMillion  float64 `json:"inputPerMillion"`
	OutputPerMillion float64 `json:"outputPerMillion"`
}

type GatewayKeyRecord struct {
	HashHex   string `json:"hashHex"` // sha256 of the raw key
	Prefix    string `json:"prefix"`  // first ~12 chars, display-only
	CreatedAt string `json:"createdAt"`
}

// Config is the low-write-frequency settings blob: everything an operator
// edits through the UI. Stored whole under one store.SetSetting key.
type Config struct {
	Providers   []ProviderConfig    `json:"providers"`
	Compression CompressionSettings `json:"compression"`
	Pricing     []ModelPrice        `json:"pricing"`
	GatewayKey  *GatewayKeyRecord   `json:"gatewayKey"`
}

// Service is the AI Gateway's backend: config CRUD, gateway-key auth, and
// (via proxy.go/usage.go/adapters.go/compress.go/pricing.go) the actual
// routing/fallback/usage-tracking/compression logic.
type Service struct {
	store *store.Store

	mu  sync.RWMutex
	cfg Config

	usage *usageState
}

func New(st *store.Store) *Service {
	s := &Service{store: st, usage: newUsageState()}
	s.cfg = loadConfig(st)
	s.usage.loadSnapshot(loadUsage(st))
	return s
}

// loadConfig round-trips through JSON because store.GetSetting returns a bare
// interface{}: on first boot after a restart it's a generic
// map[string]interface{} (from json.Unmarshal into the store's own
// map[string]interface{} Settings blob), not our concrete Config type.
func loadConfig(st *store.Store) Config {
	v, ok := st.GetSetting(configSettingKey)
	if !ok {
		return Config{}
	}
	b, err := json.Marshal(v)
	if err != nil {
		return Config{}
	}
	var cfg Config
	_ = json.Unmarshal(b, &cfg)
	return cfg
}

// persist assumes the caller already holds s.mu (write lock).
func (s *Service) persist() error {
	return s.store.SetSetting(configSettingKey, s.cfg)
}

func randID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func nowRFC3339() string { return time.Now().UTC().Format(time.RFC3339) }

// ---- Provider CRUD ----

func (s *Service) ListProviders() []ProviderConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]ProviderConfig, len(s.cfg.Providers))
	copy(out, s.cfg.Providers)
	return out
}

func (s *Service) CreateProvider(p ProviderConfig) (ProviderConfig, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p.ID = randID()
	for i := range p.Keys {
		p.Keys[i].ID = randID()
		p.Keys[i].AddedAt = nowRFC3339()
	}
	s.cfg.Providers = append(s.cfg.Providers, p)
	if err := s.persist(); err != nil {
		return ProviderConfig{}, err
	}
	return p, nil
}

func (s *Service) UpdateProvider(id string, mutate func(*ProviderConfig)) (ProviderConfig, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.cfg.Providers {
		if s.cfg.Providers[i].ID == id {
			mutate(&s.cfg.Providers[i])
			if err := s.persist(); err != nil {
				return ProviderConfig{}, err
			}
			return s.cfg.Providers[i], nil
		}
	}
	return ProviderConfig{}, fmt.Errorf("provider not found")
}

func (s *Service) DeleteProvider(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.cfg.Providers {
		if s.cfg.Providers[i].ID == id {
			s.cfg.Providers = append(s.cfg.Providers[:i], s.cfg.Providers[i+1:]...)
			return s.persist()
		}
	}
	return fmt.Errorf("provider not found")
}

func (s *Service) AddKey(providerID string, key ProviderKey) (ProviderKey, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.cfg.Providers {
		if s.cfg.Providers[i].ID == providerID {
			key.ID = randID()
			key.AddedAt = nowRFC3339()
			s.cfg.Providers[i].Keys = append(s.cfg.Providers[i].Keys, key)
			if err := s.persist(); err != nil {
				return ProviderKey{}, err
			}
			return key, nil
		}
	}
	return ProviderKey{}, fmt.Errorf("provider not found")
}

func (s *Service) DeleteKey(providerID, keyID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.cfg.Providers {
		if s.cfg.Providers[i].ID != providerID {
			continue
		}
		keys := s.cfg.Providers[i].Keys
		for j := range keys {
			if keys[j].ID == keyID {
				s.cfg.Providers[i].Keys = append(keys[:j], keys[j+1:]...)
				return s.persist()
			}
		}
		return fmt.Errorf("key not found")
	}
	return fmt.Errorf("provider not found")
}

// sortedEnabledProviders returns enabled providers ordered by ascending
// Priority (lower tried first), used by the fallback loop in proxy.go.
func (s *Service) sortedEnabledProviders() []ProviderConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]ProviderConfig, 0, len(s.cfg.Providers))
	for _, p := range s.cfg.Providers {
		if p.Enabled {
			out = append(out, p)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Priority < out[j].Priority })
	return out
}

// ---- Compression settings ----

func (s *Service) GetCompression() CompressionSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg.Compression
}

func (s *Service) SaveCompression(c CompressionSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg.Compression = c
	return s.persist()
}

// ---- Pricing table ----

func (s *Service) GetPricing() []ModelPrice {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]ModelPrice, len(s.cfg.Pricing))
	copy(out, s.cfg.Pricing)
	return out
}

func (s *Service) SavePricing(p []ModelPrice) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg.Pricing = p
	return s.persist()
}

// EstimateCost looks up model in the saved pricing table and returns the
// estimated USD cost for the given token counts. ok=false when the model
// isn't in the table (no pricing configured for it yet).
func (s *Service) EstimateCost(model string, tokensIn, tokensOut int) (cost float64, ok bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, p := range s.cfg.Pricing {
		if p.Model == model {
			cost = (float64(tokensIn)/1_000_000)*p.InputPerMillion + (float64(tokensOut)/1_000_000)*p.OutputPerMillion
			return cost, true
		}
	}
	return 0, false
}

// ---- Gateway key (separate long-lived credential for external clients) ----

func (s *Service) GatewayKeyInfo() (prefix string, configured bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.cfg.GatewayKey == nil {
		return "", false
	}
	return s.cfg.GatewayKey.Prefix, true
}

// RotateGatewayKey generates a new key, returning the raw value exactly once
// (only its SHA-256 hash + display prefix are persisted).
func (s *Service) RotateGatewayKey() (raw string, err error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	raw = "ngw_" + hex.EncodeToString(b)

	s.mu.Lock()
	defer s.mu.Unlock()
	sum := sha256.Sum256([]byte(raw))
	prefix := raw
	if len(prefix) > 12 {
		prefix = prefix[:12]
	}
	s.cfg.GatewayKey = &GatewayKeyRecord{
		HashHex:   hex.EncodeToString(sum[:]),
		Prefix:    prefix,
		CreatedAt: nowRFC3339(),
	}
	if err := s.persist(); err != nil {
		return "", err
	}
	return raw, nil
}

// VerifyGatewayKey uses a constant-time comparison since this is checked on
// every proxied request — SHA-256 rather than bcrypt deliberately, bcrypt's
// ~100ms cost is fine for infrequent human logins, not per-request auth.
func (s *Service) VerifyGatewayKey(raw string) bool {
	if raw == "" {
		return false
	}
	s.mu.RLock()
	rec := s.cfg.GatewayKey
	s.mu.RUnlock()
	if rec == nil {
		return false
	}
	sum := sha256.Sum256([]byte(raw))
	got := hex.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(got), []byte(rec.HashHex)) == 1
}

package cloudflare

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/nawfdev/home-panel/internal/store"
)

const apiURL = "https://api.cloudflare.com/client/v4"

type Service struct {
	store *store.Store
	mu    sync.Mutex

	tunnels       []Tunnel
	tunnelsExpiry time.Time
	zones         []Zone
	zonesExpiry   time.Time
}

func New(s *store.Store) *Service { return &Service{store: s} }

type Tunnel struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Status       string `json:"status"`
	CreatedAt    string `json:"created_at"`
	ConnsActive  int    `json:"conns_active"`
	Connections  any    `json:"connections"`
	RemoteConfig any    `json:"remote_config"`
}

type Zone struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

type TunnelDetail struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Status       string `json:"status"`
	Connections  any    `json:"connections"`
	CreatedAt    string `json:"created_at"`
	RemoteConfig any    `json:"remote_config"`
}

type apiResponse[T any] struct {
	Success bool `json:"success"`
	Result  T    `json:"result"`
	Errors  []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

func (s *Service) setting() (token, accountID string) {
	v, ok := s.store.GetSetting("cloudflare")
	if !ok {
		return "", ""
	}
	m, ok := v.(map[string]any)
	if !ok {
		return "", ""
	}
	token, _ = m["apiToken"].(string)
	accountID, _ = m["accountId"].(string)
	return strings.TrimSpace(token), strings.TrimSpace(accountID)
}

func (s *Service) accountID(ctx context.Context) (string, error) {
	token, accountID := s.setting()
	if accountID != "" {
		return accountID, nil
	}
	if token == "" {
		return "", fmt.Errorf("Cloudflare API Token not configured")
	}
	var out apiResponse[[]struct {
		ID string `json:"id"`
	}]
	if err := s.do(ctx, http.MethodGet, "/accounts", nil, &out); err != nil {
		return "", err
	}
	if !out.Success || len(out.Result) == 0 {
		return "", fmt.Errorf("Could not fetch Cloudflare Account ID: %s", firstError(out.Errors, "Unknown error"))
	}
	return out.Result[0].ID, nil
}

func (s *Service) do(ctx context.Context, method, path string, body any, out any) error {
	token, _ := s.setting()
	if token == "" {
		return fmt.Errorf("Not authenticated")
	}
	var reader *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	} else {
		reader = bytes.NewReader(nil)
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, apiURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return json.NewDecoder(resp.Body).Decode(out)
}

// VerifyToken makes a live call to Cloudflare to confirm the stored API
// token is still valid (e.g. hasn't been revoked from the dashboard).
func (s *Service) VerifyToken(ctx context.Context) (bool, error) {
	token, _ := s.setting()
	if token == "" {
		return false, fmt.Errorf("Cloudflare API Token not configured")
	}
	var out apiResponse[struct {
		Status string `json:"status"`
	}]
	if err := s.do(ctx, http.MethodGet, "/user/tokens/verify", nil, &out); err != nil {
		return false, err
	}
	if !out.Success {
		return false, fmt.Errorf("%s", firstError(out.Errors, "Cloudflare API Token is invalid or has been revoked"))
	}
	return true, nil
}

func (s *Service) ListTunnels(ctx context.Context) ([]Tunnel, error) {
	s.mu.Lock()
	if s.tunnels != nil && time.Now().Before(s.tunnelsExpiry) {
		cached := append([]Tunnel(nil), s.tunnels...)
		s.mu.Unlock()
		return cached, nil
	}
	s.mu.Unlock()

	accountID, err := s.accountID(ctx)
	if err != nil {
		return nil, err
	}
	var out apiResponse[[]struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		Status       string `json:"status"`
		CreatedAt    string `json:"created_at"`
		ConnsActive  int    `json:"conns_active"`
		Connections  any    `json:"connections"`
		RemoteConfig any    `json:"remote_config"`
	}]
	if err := s.do(ctx, http.MethodGet, "/accounts/"+accountID+"/tunnels?is_deleted=false", nil, &out); err != nil {
		return nil, err
	}
	if !out.Success {
		return nil, fmt.Errorf("%s", firstError(out.Errors, "Failed to list tunnels"))
	}
	res := make([]Tunnel, 0, len(out.Result))
	for _, t := range out.Result {
		res = append(res, Tunnel{ID: t.ID, Name: t.Name, Status: t.Status, CreatedAt: t.CreatedAt, ConnsActive: t.ConnsActive, Connections: t.Connections, RemoteConfig: t.RemoteConfig})
	}
	s.mu.Lock()
	s.tunnels, s.tunnelsExpiry = append([]Tunnel(nil), res...), time.Now().Add(time.Minute)
	s.mu.Unlock()
	return res, nil
}

func (s *Service) ListZones(ctx context.Context) ([]Zone, error) {
	s.mu.Lock()
	if s.zones != nil && time.Now().Before(s.zonesExpiry) {
		cached := append([]Zone(nil), s.zones...)
		s.mu.Unlock()
		return cached, nil
	}
	s.mu.Unlock()

	var out apiResponse[[]Zone]
	if err := s.do(ctx, http.MethodGet, "/zones?status=active", nil, &out); err != nil {
		return nil, err
	}
	if !out.Success {
		return nil, fmt.Errorf("Failed to list zones")
	}
	s.mu.Lock()
	s.zones, s.zonesExpiry = append([]Zone(nil), out.Result...), time.Now().Add(time.Minute)
	s.mu.Unlock()
	return out.Result, nil
}

func (s *Service) GetTunnelConnections(ctx context.Context, tunnelID string) (TunnelDetail, error) {
	accountID, err := s.accountID(ctx)
	if err != nil {
		return TunnelDetail{}, err
	}
	var out apiResponse[struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		Status       string `json:"status"`
		Connections  any    `json:"connections"`
		CreatedAt    string `json:"created_at"`
		RemoteConfig any    `json:"remote_config"`
	}]
	if err := s.do(ctx, http.MethodGet, "/accounts/"+accountID+"/tunnels/"+tunnelID, nil, &out); err != nil {
		return TunnelDetail{}, err
	}
	if !out.Success {
		return TunnelDetail{}, fmt.Errorf("Failed to get tunnel")
	}
	t := out.Result
	return TunnelDetail{ID: t.ID, Name: t.Name, Status: t.Status, Connections: t.Connections, CreatedAt: t.CreatedAt, RemoteConfig: t.RemoteConfig}, nil
}

func (s *Service) DeleteTunnel(ctx context.Context, tunnelID string) error {
	accountID, err := s.accountID(ctx)
	if err != nil {
		return err
	}
	var ignored apiResponse[any]
	_ = s.do(ctx, http.MethodDelete, "/accounts/"+accountID+"/tunnels/"+tunnelID+"/connections", nil, &ignored)
	if err := s.do(ctx, http.MethodDelete, "/accounts/"+accountID+"/tunnels/"+tunnelID, nil, &ignored); err != nil {
		return err
	}
	if !ignored.Success {
		return fmt.Errorf("%s", firstError(ignored.Errors, "Failed to delete tunnel"))
	}
	s.clearTunnels()
	return nil
}

func (s *Service) GetTunnelConfig(ctx context.Context, tunnelID string) (map[string]any, error) {
	accountID, err := s.accountID(ctx)
	if err != nil {
		return nil, err
	}
	var out apiResponse[struct {
		Config map[string]any `json:"config"`
	}]
	if err := s.do(ctx, http.MethodGet, "/accounts/"+accountID+"/cfd_tunnel/"+tunnelID+"/configurations", nil, &out); err != nil || !out.Success {
		return map[string]any{"ingress": []any{}, "originRequest": map[string]any{}}, nil
	}
	if out.Result.Config == nil {
		return map[string]any{"ingress": []any{}, "originRequest": map[string]any{}}, nil
	}
	return out.Result.Config, nil
}

func (s *Service) UpdateTunnelConfig(ctx context.Context, tunnelID string, config map[string]any) (map[string]any, error) {
	accountID, err := s.accountID(ctx)
	if err != nil {
		return nil, err
	}
	var out apiResponse[struct {
		Config map[string]any `json:"config"`
	}]
	if err := s.do(ctx, http.MethodPut, "/accounts/"+accountID+"/cfd_tunnel/"+tunnelID+"/configurations", map[string]any{"config": config}, &out); err != nil {
		return nil, err
	}
	if !out.Success {
		return nil, fmt.Errorf("%s", firstError(out.Errors, "Failed to update tunnel config"))
	}
	s.clearTunnels()
	return out.Result.Config, nil
}

func (s *Service) clearTunnels() {
	s.mu.Lock()
	s.tunnels, s.tunnelsExpiry = nil, time.Time{}
	s.mu.Unlock()
}

func firstError(errs []struct {
	Message string `json:"message"`
}, fallback string) string {
	if len(errs) > 0 && errs[0].Message != "" {
		return errs[0].Message
	}
	return fallback
}

// Package telegram ports backend/services/telegram.js: a minimal Telegram Bot
// client (sendMessage / notifications) configured from the JSON store settings.
package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/kaysa/home-panel/internal/store"
)

type Service struct {
	mu         sync.RWMutex
	botToken   string
	chatID     string
	enable     bool
	connected  bool
	monitoring bool
	store      *store.Store
}

func New(s *store.Store) *Service {
	svc := &Service{store: s, enable: true}
	svc.loadFromStore()
	return svc
}

func (s *Service) loadFromStore() {
	v, ok := s.store.GetSetting("telegram")
	if !ok {
		return
	}
	m, ok := v.(map[string]interface{})
	if !ok {
		return
	}
	token, _ := m["botToken"].(string)
	chatID, _ := m["chatId"].(string)
	enable := true
	if e, ok := m["enableNotifications"].(bool); ok {
		enable = e
	}
	s.mu.Lock()
	s.botToken, s.chatID, s.enable = token, chatID, enable
	s.connected = token != ""
	s.mu.Unlock()
}

// UpdateConfig validates the token with getMe and stores the new config.
func (s *Service) UpdateConfig(botToken, chatID string, enableNotifications bool) bool {
	if botToken == "" {
		s.mu.Lock()
		s.botToken, s.chatID, s.enable, s.connected = "", chatID, enableNotifications, false
		s.mu.Unlock()
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	ok := s.getMe(ctx, botToken)

	s.mu.Lock()
	s.botToken, s.chatID, s.enable, s.connected = botToken, chatID, enableNotifications, ok
	s.mu.Unlock()
	return ok
}

func (s *Service) getMe(ctx context.Context, token string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("https://api.telegram.org/bot%s/getMe", token), nil)
	if err != nil {
		return false
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var out struct {
		OK bool `json:"ok"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return out.OK
}

// SendMessage ports sendMessage(chatId, text); returns nil on success.
func (s *Service) SendMessage(ctx context.Context, chatID, text string) error {
	s.mu.RLock()
	token := s.botToken
	s.mu.RUnlock()
	if token == "" {
		return fmt.Errorf("bot not configured")
	}
	if chatID == "" {
		s.mu.RLock()
		chatID = s.chatID
		s.mu.RUnlock()
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"chat_id": chatID, "text": text, "parse_mode": "Markdown",
	})
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", token), bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var out struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if !out.OK {
		return fmt.Errorf("telegram: %s", out.Description)
	}
	return nil
}

// SendNotification respects the enable flag (ports sendNotification).
func (s *Service) SendNotification(ctx context.Context, text string) error {
	s.mu.RLock()
	enable, chatID := s.enable, s.chatID
	s.mu.RUnlock()
	if !enable {
		return nil
	}
	return s.SendMessage(ctx, chatID, text)
}

// SetMonitoring lets the alerts module flag active monitoring for getBotStatus.
func (s *Service) SetMonitoring(on bool) {
	s.mu.Lock()
	s.monitoring = on
	s.mu.Unlock()
}

type Status struct {
	Connected  bool `json:"connected"`
	Configured bool `json:"configured"`
	Monitoring bool `json:"monitoring"`
}

func (s *Service) Status() Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return Status{
		Connected:  s.connected,
		Configured: s.botToken != "" && s.chatID != "",
		Monitoring: s.monitoring,
	}
}

func (s *Service) Config() (chatID, token string, enable bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.chatID, s.botToken, s.enable
}

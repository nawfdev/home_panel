package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kaysa/home-panel/internal/httpx"
	"github.com/kaysa/home-panel/internal/store"
)

// Settings ports backend/routes/settings.js. Telegram delivery is performed by
// the telegram service once configured; here we persist + verify settings.
type Settings struct {
	Store    *store.Store
	Telegram TelegramConfigurer // optional; nil until telegram module is wired
}

// TelegramConfigurer lets the telegram service receive config updates without a
// hard dependency (decoupled so settings can persist even if telegram is absent).
type TelegramConfigurer interface {
	UpdateConfig(botToken, chatID string, enableNotifications bool) bool
	SendMessage(ctx context.Context, chatID, text string) error
}

func settingMap(st *store.Store, key string) map[string]interface{} {
	v, ok := st.GetSetting(key)
	if !ok {
		return map[string]interface{}{}
	}
	if m, ok := v.(map[string]interface{}); ok {
		return m
	}
	return map[string]interface{}{}
}

func (s *Settings) settingMap(key string) map[string]interface{} { return settingMap(s.Store, key) }

func str(m map[string]interface{}, k string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

// ---- Cloudflare ----

func (s *Settings) GetCloudflare(w http.ResponseWriter, r *http.Request) {
	cf := s.settingMap("cloudflare")
	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"success":   true,
		"hasToken":  str(cf, "apiToken") != "",
		"accountId": str(cf, "accountId"),
	})
}

func (s *Settings) SaveCloudflare(w http.ResponseWriter, r *http.Request) {
	var body struct {
		APIToken  string `json:"apiToken"`
		AccountID string `json:"accountId"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.APIToken == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "API Token is required"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.cloudflare.com/client/v4/user/tokens/verify", nil)
	req.Header.Set("Authorization", "Bearer "+body.APIToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]interface{}{"success": false, "error": err.Error()})
		return
	}
	defer resp.Body.Close()
	var verify struct {
		Success bool          `json:"success"`
		Errors  []interface{} `json:"errors"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&verify)
	if !verify.Success {
		httpx.JSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "Invalid API Token", "details": verify.Errors})
		return
	}

	_ = s.Store.SetSetting("cloudflare", map[string]interface{}{"apiToken": body.APIToken, "accountId": body.AccountID})
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "message": "Cloudflare credentials verified and saved!"})
}

// ---- Telegram ----

func (s *Settings) GetTelegram(w http.ResponseWriter, r *http.Request) {
	tg := s.settingMap("telegram")
	masked := ""
	if str(tg, "botToken") != "" {
		masked = "••••••••"
	}
	enable := true
	if v, ok := tg["enableNotifications"].(bool); ok {
		enable = v
	}
	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true, "botToken": masked, "chatId": str(tg, "chatId"), "enableNotifications": enable,
	})
}

func (s *Settings) SaveTelegram(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BotToken            string `json:"botToken"`
		ChatID              string `json:"chatId"`
		EnableNotifications *bool  `json:"enableNotifications"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	existing := s.settingMap("telegram")
	newToken := body.BotToken
	if newToken == "" || newToken == "••••••••" {
		newToken = str(existing, "botToken")
	}
	enable := true
	if body.EnableNotifications != nil {
		enable = *body.EnableNotifications
	}

	cfg := map[string]interface{}{"botToken": newToken, "chatId": body.ChatID, "enableNotifications": enable}
	_ = s.Store.SetSetting("telegram", cfg)

	if s.Telegram != nil {
		if !s.Telegram.UpdateConfig(newToken, body.ChatID, enable) {
			httpx.JSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "Failed to initialize bot with these settings"})
			return
		}
		if body.ChatID != "" {
			_ = s.Telegram.SendMessage(r.Context(), body.ChatID, "🔔 *Home Panel*\nTest notification from Settings!")
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "message": "Telegram settings saved & test message sent!"})
}

// ---- Service paths ----

func (s *Settings) GetPaths(w http.ResponseWriter, r *http.Request) {
	p := s.settingMap("servicePaths")
	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"paths":   map[string]string{"pm2": str(p, "pm2"), "docker": str(p, "docker"), "cloudflared": str(p, "cloudflared")},
	})
}

func (s *Settings) SavePaths(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PM2         string `json:"pm2"`
		Docker      string `json:"docker"`
		Cloudflared string `json:"cloudflared"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	_ = s.Store.SetSetting("servicePaths", map[string]interface{}{
		"pm2": body.PM2, "docker": body.Docker, "cloudflared": body.Cloudflared,
	})
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "message": "Service paths saved!"})
}

// ---- Panel service (how the panel process itself is supervised) ----

func (s *Settings) GetPanelService(w http.ResponseWriter, r *http.Request) {
	m := s.settingMap("panelService")
	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"manager": str(m, "manager"),
		"name":    str(m, "name"),
	})
}

func (s *Settings) SavePanelService(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Manager string `json:"manager"`
		Name    string `json:"name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Manager != "" && body.Manager != "systemd" && body.Manager != "pm2" {
		httpx.JSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "manager must be \"systemd\" or \"pm2\""})
		return
	}
	if name := strings.TrimSpace(body.Name); name != "" && !sanitizeServiceName(name) {
		httpx.JSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "Invalid service/process name format"})
		return
	}
	_ = s.Store.SetSetting("panelService", map[string]interface{}{
		"manager": body.Manager,
		"name":    strings.TrimSpace(body.Name),
	})
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "message": "Panel service settings saved"})
}

// DetectPath ports /paths/detect/:service using `where` (Windows) / `command -v`.
func (s *Settings) DetectPath(w http.ResponseWriter, r *http.Request) {
	service := chi.URLParam(r, "service")
	// Allow only a known set so we never shell-inject an arbitrary binary name.
	switch service {
	case "pm2", "docker", "cloudflared":
	default:
		httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": false, "error": "Unknown service"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var out []byte
	var err error
	if runtime.GOOS == "windows" {
		out, err = exec.CommandContext(ctx, "where", service).Output()
	} else {
		out, err = exec.CommandContext(ctx, "sh", "-c", "command -v "+service).Output()
	}
	path := strings.TrimSpace(string(out))
	if idx := strings.IndexAny(path, "\r\n"); idx >= 0 {
		path = path[:idx]
	}
	if err != nil || path == "" {
		httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": false, "error": service + " not found in PATH"})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "path": path})
}

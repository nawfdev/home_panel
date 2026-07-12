package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/nawfdev/home-panel/internal/httpx"
	"github.com/nawfdev/home-panel/internal/telegram"
)

type telegramBot interface {
	Status() telegram.Status
	Config() (chatID, token string, enable bool)
	SendMessage(ctx context.Context, chatID, text string) error
}

// Telegram ports backend/routes/telegram.js.
type Telegram struct {
	Bot telegramBot
}

func (t *Telegram) Status(w http.ResponseWriter, r *http.Request) {
	status := t.Bot.Status()
	chatID, token, enable := t.Bot.Config()

	var chatHint interface{}
	if chatID != "" {
		if len(chatID) > 4 {
			chatHint = chatID[:4] + "..."
		} else {
			chatHint = chatID + "..."
		}
	}

	var tokenHint interface{}
	if token != "" {
		if len(token) > 4 {
			tokenHint = "..." + token[len(token)-4:]
		} else {
			tokenHint = "..." + token
		}
	}

	httpx.JSON(w, http.StatusOK, map[string]interface{}{
		"connected":            status.Connected,
		"configured":           status.Configured,
		"monitoring":           status.Monitoring,
		"chatId":               chatHint,
		"tokenHint":            tokenHint,
		"notificationsEnabled": enable,
	})
}

func (t *Telegram) Test(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Message string `json:"message"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	chatID, _, _ := t.Bot.Config()
	if chatID == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]interface{}{"success": false, "error": "Chat ID not configured"})
		return
	}

	msg := body.Message
	if msg == "" {
		msg = "🔔 Test from Home Panel"
	}
	if err := t.Bot.SendMessage(r.Context(), chatID, msg); err != nil {
		httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": false, "error": "Failed to send message - check bot token"})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "message": "Test message sent"})
}

func (t *Telegram) Send(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ChatID  string `json:"chatId"`
		Message string `json:"message"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	if body.ChatID == "" || body.Message == "" {
		httpx.JSON(w, http.StatusBadRequest, map[string]interface{}{"error": "chatId and message are required"})
		return
	}
	if err := t.Bot.SendMessage(r.Context(), body.ChatID, body.Message); err != nil {
		httpx.JSON(w, http.StatusInternalServerError, map[string]interface{}{"error": err.Error()})
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]interface{}{"success": true, "message": "Message sent"})
}

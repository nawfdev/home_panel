const express = require("express");
const router = express.Router();
const { sendMessage, sendNotification, getBotStatus } = require("../services/telegram");
const { getSetting } = require("../services/database");

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        next();
    } else {
        res.status(401).json({ error: "Unauthorized" });
    }
}

// Get bot status with more details
router.get("/status", isAuthenticated, (req, res) => {
    try {
        const status = getBotStatus();
        const config = getSetting('telegram') || {};

        res.json({
            connected: status.connected,
            configured: status.configured,
            monitoring: status.monitoring,
            chatId: config.chatId ? config.chatId.toString().slice(0, 4) + '...' : null,
            tokenHint: config.botToken ? '...' + config.botToken.slice(-4) : null,
            notificationsEnabled: config.enableNotifications
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Send test message to configured chat
router.post("/test", isAuthenticated, async (req, res) => {
    try {
        const { message } = req.body;
        const config = getSetting('telegram');

        if (!config || !config.chatId) {
            return res.status(400).json({ success: false, error: "Chat ID not configured" });
        }

        const result = await sendMessage(config.chatId, message || "🔔 Test from Home Panel");

        if (result) {
            res.json({ success: true, message: "Test message sent" });
        } else {
            res.json({ success: false, error: "Failed to send message - check bot token" });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send manual message (admin only)
router.post("/send", isAuthenticated, async (req, res) => {
    try {
        const { chatId, message } = req.body;

        if (!chatId || !message) {
            return res.status(400).json({ error: "chatId and message are required" });
        }

        const result = await sendMessage(chatId, message);

        if (result) {
            res.json({ success: true, message: "Message sent" });
        } else {
            res.status(500).json({ error: "Failed to send message" });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

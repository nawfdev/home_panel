const express = require("express");
const router = express.Router();
const { sendMessage, getBotStatus } = require("../services/telegram");

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        next();
    } else {
        res.status(401).json({ error: "Unauthorized" });
    }
}

// Get bot status
router.get("/status", isAuthenticated, (req, res) => {
    try {
        const status = getBotStatus();
        res.json({ success: true, status });
    } catch (error) {
        res.status(500).json({ error: error.message });
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

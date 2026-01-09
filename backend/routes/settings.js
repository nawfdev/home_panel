const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../services/auth');
const { getSetting, setSetting } = require('../services/database');
const fetch = require('node-fetch'); // Need to install if not present, or use native in Node 18+

// Get Cloudflare Settings
router.get('/cloudflare', isAuthenticated, (req, res) => {
    const cf = getSetting('cloudflare') || {};
    res.json({
        success: true,
        hasToken: !!cf.apiToken,
        accountId: cf.accountId || ''
    });
});

// Save Cloudflare Settings
router.post('/cloudflare', isAuthenticated, async (req, res) => {
    try {
        const { apiToken, accountId } = req.body;

        if (!apiToken) {
            return res.status(400).json({ success: false, error: 'API Token is required' });
        }

        // Verify Token by calling Cloudflare API
        const verifyRes = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            }
        });

        const verifyData = await verifyRes.json();

        if (!verifyData.success) {
            return res.status(400).json({ success: false, error: 'Invalid API Token', details: verifyData.errors });
        }

        // Save Settings
        setSetting('cloudflare', { apiToken, accountId });

        res.json({ success: true, message: 'Cloudflare credentials verified and saved!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// === Telegram Settings ===

// Get Telegram Settings
router.get('/telegram', isAuthenticated, (req, res) => {
    const telegram = getSetting('telegram') || {};
    res.json({
        success: true,
        botToken: telegram.botToken ? '••••••••' : '', // Masked
        chatId: telegram.chatId || '',
        enableNotifications: telegram.enableNotifications !== false // Default true
    });
});

// Save Telegram Settings
router.post('/telegram', isAuthenticated, async (req, res) => {
    try {
        const { botToken, chatId, enableNotifications } = req.body;

        // Get existing to preserve token if masked
        const existing = getSetting('telegram') || {};
        const newToken = (botToken && botToken !== '••••••••') ? botToken : existing.botToken;

        const { updateConfig, sendMessage } = require('../services/telegram');

        const success = updateConfig({
            botToken: newToken,
            chatId,
            enableNotifications
        });

        if (success) {
            // Send test message
            if (chatId) {
                await sendMessage(chatId, "🔔 *Home Panel*\nTest notification from Settings!");
            }
            res.json({ success: true, message: 'Telegram settings saved & test message sent!' });
        } else {
            res.status(400).json({ success: false, error: 'Failed to initialize bot with these settings' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

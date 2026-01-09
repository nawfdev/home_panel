const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../routes/auth');
const { getSetting, setSetting } = require('../services/database');
// Note: Node 18+ has native fetch, no need for node-fetch

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

// Get Service Paths
router.get('/paths', isAuthenticated, (req, res) => {
    const paths = getSetting('servicePaths') || {};
    res.json({
        success: true,
        paths: {
            pm2: paths.pm2 || '',
            docker: paths.docker || '',
            cloudflared: paths.cloudflared || ''
        }
    });
});

// Save Service Paths
router.post('/paths', isAuthenticated, (req, res) => {
    try {
        const { pm2, docker, cloudflared } = req.body;
        setSetting('servicePaths', {
            pm2: pm2 || '',
            docker: docker || '',
            cloudflared: cloudflared || ''
        });
        res.json({ success: true, message: 'Service paths saved!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Auto-detect service path
router.get('/paths/detect/:service', isAuthenticated, async (req, res) => {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execPromise = promisify(exec);

    const service = req.params.service;

    try {
        const { stdout } = await execPromise(`which ${service} 2>/dev/null || command -v ${service} 2>/dev/null`);
        const path = stdout.trim();
        if (path) {
            res.json({ success: true, path });
        } else {
            res.json({ success: false, error: 'Not found' });
        }
    } catch {
        res.json({ success: false, error: `${service} not found in PATH` });
    }
});

module.exports = router;


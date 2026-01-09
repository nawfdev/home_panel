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

module.exports = router;

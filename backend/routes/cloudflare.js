const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../routes/auth');
const cfService = require('../services/cloudflare');
const { getSetting } = require('../services/database');

// Check if Cloudflare is configured
router.get('/status', isAuthenticated, (req, res) => {
    const cf = getSetting('cloudflare');
    res.json({
        configured: !!(cf && cf.apiToken),
        accountId: cf?.accountId
    });
});

// List Tunnels
router.get('/tunnels', isAuthenticated, async (req, res) => {
    try {
        const tunnels = await cfService.listTunnels();
        res.json({ success: true, tunnels });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// List Zones (Domains)
router.get('/zones', isAuthenticated, async (req, res) => {
    try {
        const zones = await cfService.listZones();
        res.json({ success: true, zones });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

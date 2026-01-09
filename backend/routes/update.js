const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('./auth');
const updater = require('../services/updater');

// Check for updates
router.get('/check', isAuthenticated, async (req, res) => {
    try {
        const updateInfo = await updater.checkForUpdates();
        res.json(updateInfo);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get current git info
router.get('/info', isAuthenticated, async (req, res) => {
    try {
        const gitInfo = await updater.getGitInfo();
        res.json(gitInfo);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Apply updates
router.post('/apply', isAuthenticated, async (req, res) => {
    try {
        const result = await updater.applyUpdates();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

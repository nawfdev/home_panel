const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("./auth");
const logsService = require("../services/logs");

// Get available log sources
router.get("/sources", isAuthenticated, async (req, res) => {
    try {
        const sources = await logsService.getLogSources();
        res.json({ success: true, sources });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get targets for a source
router.get("/sources/:sourceId/targets", isAuthenticated, async (req, res) => {
    try {
        const targets = await logsService.getLogTargets(req.params.sourceId);
        res.json({ success: true, targets });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get logs from source
router.get("/sources/:sourceId", isAuthenticated, async (req, res) => {
    try {
        const { sourceId } = req.params;
        const { target, lines = 100, search } = req.query;

        let logs = await logsService.getLogsFromSource(sourceId, target, parseInt(lines));

        if (search) {
            logs = logsService.searchInLogs(logs, search);
        }

        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

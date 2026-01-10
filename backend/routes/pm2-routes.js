const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("./auth");
const pm2Service = require("../services/pm2");

// List all PM2 processes
router.get("/processes", isAuthenticated, async (req, res) => {
    try {
        const processes = await pm2Service.listProcesses();
        res.json({ success: true, processes });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            pm2Available: false
        });
    }
});

// Get process details
router.get("/processes/:name", isAuthenticated, async (req, res) => {
    try {
        const process = await pm2Service.getProcess(req.params.name);
        res.json({ success: true, process });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start process
router.post("/processes/:name/start", isAuthenticated, async (req, res) => {
    try {
        const result = await pm2Service.startProcess(req.params.name);
        res.json({ success: true, message: "Process started", result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Stop process
router.post("/processes/:name/stop", isAuthenticated, async (req, res) => {
    try {
        const result = await pm2Service.stopProcess(req.params.name);
        res.json({ success: true, message: "Process stopped", result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Restart process
router.post("/processes/:name/restart", isAuthenticated, async (req, res) => {
    try {
        const result = await pm2Service.restartProcess(req.params.name);
        res.json({ success: true, message: "Process restarted", result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete process
router.delete("/processes/:name", isAuthenticated, async (req, res) => {
    try {
        const result = await pm2Service.deleteProcess(req.params.name);
        res.json({ success: true, message: "Process deleted", result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get process logs
router.get("/processes/:name/logs", isAuthenticated, async (req, res) => {
    try {
        const lines = parseInt(req.query.lines) || 100;
        const logs = await pm2Service.getProcessLogs(req.params.name, lines);
        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check PM2 availability
router.get("/status", isAuthenticated, async (req, res) => {
    try {
        const result = await pm2Service.checkPm2Available();
        res.json(result);
    } catch (error) {
        res.json({ available: false, error: error.message });
    }
});

module.exports = router;

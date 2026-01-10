const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("./auth");
const { body, param, validationResult } = require("express-validator");
const dockerService = require("../services/docker");

// List all containers
router.get("/containers", isAuthenticated, async (req, res) => {
    try {
        const containers = await dockerService.listContainers(true); // Include stopped
        res.json({ success: true, containers });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            dockerAvailable: false
        });
    }
});

// Run a new container
router.post("/run", isAuthenticated, async (req, res) => {
    try {
        const { name, image, ports } = req.body;
        if (!image) {
            return res.status(400).json({ success: false, error: "Image is required" });
        }
        const result = await dockerService.runContainer(name, image, ports);
        res.json({ success: true, message: "Container started", result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Remove container
router.delete("/containers/:id", isAuthenticated, async (req, res) => {
    try {
        const result = await dockerService.removeContainer(req.params.id);
        res.json({ success: true, message: "Container removed", result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get container details
router.get("/containers/:id", isAuthenticated, async (req, res) => {
    try {
        const container = await dockerService.getContainer(req.params.id);
        res.json({ success: true, container });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start container
router.post("/containers/:id/start", isAuthenticated, async (req, res) => {
    try {
        const result = await dockerService.startContainer(req.params.id);
        res.json({ success: true, message: "Container started", result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Stop container
router.post("/containers/:id/stop", isAuthenticated, async (req, res) => {
    try {
        const result = await dockerService.stopContainer(req.params.id);
        res.json({ success: true, message: "Container stopped", result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Restart container
router.post("/containers/:id/restart", isAuthenticated, async (req, res) => {
    try {
        const result = await dockerService.restartContainer(req.params.id);
        res.json({ success: true, message: "Container restarted", result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get container logs
router.get("/containers/:id/logs", isAuthenticated, async (req, res) => {
    try {
        const lines = parseInt(req.query.lines) || 100;
        const logs = await dockerService.getContainerLogs(req.params.id, lines);
        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get container stats
router.get("/containers/:id/stats", isAuthenticated, async (req, res) => {
    try {
        const stats = await dockerService.getContainerStats(req.params.id);
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check Docker availability
router.get("/status", isAuthenticated, async (req, res) => {
    try {
        const result = await dockerService.checkDockerAvailable();
        res.json(result);
    } catch (error) {
        res.json({ available: false, error: error.message });
    }
});

module.exports = router;

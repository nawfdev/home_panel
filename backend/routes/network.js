const express = require("express");
const router = express.Router();
const networkService = require("../services/network");

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        next();
    } else {
        res.status(401).json({ error: "Unauthorized" });
    }
}

// Get complete network information
router.get("/info", isAuthenticated, async (req, res) => {
    try {
        const networkInfo = await networkService.getNetworkInfo();
        const cloudflareInfo = await networkService.getCloudflareInfo();
        const connectivity = await networkService.testConnectivity();
        const dns = await networkService.getDnsServers();
        const gateway = await networkService.getGateway();

        res.json({
            success: true,
            network: {
                ...networkInfo,
                cloudflare: cloudflareInfo,
                connectivity,
                dns,
                gateway
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get public IP only
router.get("/public-ip", isAuthenticated, async (req, res) => {
    try {
        const publicIp = await networkService.getPublicIp();
        res.json({ success: true, publicIp });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get local interfaces
router.get("/interfaces", isAuthenticated, async (req, res) => {
    try {
        const interfaces = networkService.getLocalInterfaces();
        res.json({ success: true, interfaces });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test connectivity
router.get("/connectivity", isAuthenticated, async (req, res) => {
    try {
        const isConnected = await networkService.testConnectivity();
        res.json({ success: true, connected: isConnected });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

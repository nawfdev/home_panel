const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("./auth");
const servicesManager = require("../services/system-services");

router.get("/", isAuthenticated, async (req, res) => {
    try {
        const services = await servicesManager.listServices();
        res.json({ success: true, services, platform: servicesManager.isWindows() ? 'windows' : 'linux' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post("/:name/start", isAuthenticated, async (req, res) => {
    try {
        await servicesManager.startService(req.params.name);
        res.json({ success: true, message: "Service started" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post("/:name/stop", isAuthenticated, async (req, res) => {
    try {
        await servicesManager.stopService(req.params.name);
        res.json({ success: true, message: "Service stopped" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

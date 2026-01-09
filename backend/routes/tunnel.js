const express = require("express");
const { isAuthenticated } = require("./auth");
const cloudflared = require("../services/cloudflared");

const router = express.Router();

router.get("/status", isAuthenticated, async (req, res) => {
  try {
    const [status, installed] = await Promise.all([
      cloudflared.getTunnelStatus(),
      cloudflared.checkCloudflaredInstalled()
    ]);
    res.json({ ...status, cloudflared: installed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/list", isAuthenticated, async (req, res) => {
  try {
    const result = await cloudflared.listTunnels();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/create", isAuthenticated, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Tunnel name required" });
    }
    const result = await cloudflared.createTunnel(name);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/configure", isAuthenticated, async (req, res) => {
  try {
    const { tunnelId, domain, localPort } = req.body;
    if (!tunnelId || !domain || !localPort) {
      return res.status(400).json({ error: "tunnelId, domain, and localPort required" });
    }
    const result = await cloudflared.configureTunnel(tunnelId, domain, localPort);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/route", isAuthenticated, async (req, res) => {
  try {
    const { tunnelId, domain } = req.body;
    if (!tunnelId || !domain) {
      return res.status(400).json({ error: "tunnelId and domain required" });
    }
    const result = await cloudflared.routeTunnel(tunnelId, domain);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/start", isAuthenticated, async (req, res) => {
  try {
    const result = await cloudflared.startTunnel();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/stop", isAuthenticated, async (req, res) => {
  try {
    const result = await cloudflared.stopTunnel();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

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

// ===== SYSTEMD ROUTES =====
router.get("/systemd/status", isAuthenticated, async (req, res) => {
  try {
    const result = await cloudflared.getSystemdStatus();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/systemd/restart", isAuthenticated, async (req, res) => {
  try {
    const result = await cloudflared.restartSystemdService();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/systemd/stop", isAuthenticated, async (req, res) => {
  try {
    const result = await cloudflared.stopSystemdService();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/systemd/start", isAuthenticated, async (req, res) => {
  try {
    const result = await cloudflared.startSystemdService();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/systemd/protocol", isAuthenticated, async (req, res) => {
  try {
    const { protocol } = req.body;
    if (!protocol) {
      return res.status(400).json({ error: "protocol required (http2, quic, or auto)" });
    }
    const result = await cloudflared.setSystemdProtocol(protocol);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get detailed tunnel metrics
router.get("/metrics", isAuthenticated, async (req, res) => {
  try {
    const result = await cloudflared.getTunnelMetrics();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/set-autorestart", isAuthenticated, async (req, res) => {
  try {
    const { enabled } = req.body;
    const result = cloudflared.setAutoRestart(enabled);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get tunnel logs
router.get("/logs", isAuthenticated, async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    // Try to get logs from journalctl (systemd)
    let logs = [];
    if (process.platform === 'linux') {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      try {
        const { stdout } = await execAsync(
          `journalctl -u cloudflared -n ${limit} --no-pager -o json`
        );
        const jsonLogs = JSON.parse(stdout || '[]');

        logs = jsonLogs.map(entry => ({
          timestamp: entry.__REALTIME_TIMESTAMP ? new Date(parseInt(entry.__REALTIME_TIMESTAMP) / 1000).toISOString() : new Date().toISOString(),
          message: entry.MESSAGE || '',
          priority: entry.PRIORITY || 'info',
          unit: entry._SYSTEMD_UNIT || 'cloudflared'
        })).reverse();
      } catch (e) {
        // Journalctl not available or failed
        logs = [];
      }
    }

    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;


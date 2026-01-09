const express = require("express");
const { isAuthenticated } = require("./auth");
const { getSystemStats, getTemperature } = require("../services/monitor");
const { getTunnelStatus, checkCloudflaredInstalled } = require("../services/cloudflared");
const { getAllProjects } = require("../services/projects");
const { getSetting } = require("../services/database");
const cfService = require("../services/cloudflare");

const router = express.Router();

router.get("/", isAuthenticated, async (req, res) => {
  try {
    const [stats, localTunnelStatus, cloudflaredCheck, projects, temperature] = await Promise.all([
      getSystemStats(),
      getTunnelStatus(),
      checkCloudflaredInstalled(),
      getAllProjects(),
      getTemperature()
    ]);

    const runningProjects = projects.filter(p => p.status === "running").length;
    const totalProjects = projects.length;

    // Check if Cloudflare API is configured
    let cfTunnels = null;
    const cfConfig = getSetting('cloudflare');

    // Cache CF API failures to avoid spam (stored in module scope)
    const now = Date.now();
    if (!global._cfApiFailedUntil) global._cfApiFailedUntil = 0;

    if (cfConfig && cfConfig.apiToken && now > global._cfApiFailedUntil) {
      try {
        cfTunnels = await cfService.listTunnels();
        global._cfApiFailedUntil = 0; // Reset on success
      } catch (e) {
        // Log once, then suppress for 5 minutes
        if (global._cfApiFailedUntil === 0) {
          console.log("CF API fetch failed:", e.message, "- Will retry in 5 minutes");
        }
        global._cfApiFailedUntil = now + 300000; // 5 minutes
      }
    }

    // Determine tunnel status - prefer Cloudflare API if available
    let tunnelInfo = localTunnelStatus;
    if (cfTunnels && cfTunnels.length > 0) {
      const healthyCount = cfTunnels.filter(t => t.status === 'healthy').length;
      tunnelInfo = {
        configured: true,
        processRunning: healthyCount > 0,
        apiConnected: true,
        tunnels: cfTunnels,
        healthyCount,
        totalCount: cfTunnels.length
      };
    }

    res.json({
      system: stats,
      tunnel: tunnelInfo,
      cloudflared: cloudflaredCheck,
      temperature,
      projects: {
        total: totalProjects,
        running: runningProjects
      }
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ error: "Failed to get dashboard data" });
  }
});

module.exports = router;


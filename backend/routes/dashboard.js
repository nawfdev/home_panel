const express = require("express");
const { isAuthenticated } = require("./auth");
const { getSystemStats, getTemperature } = require("../services/monitor");
const { getTunnelStatus, checkCloudflaredInstalled } = require("../services/cloudflared");
const { getAllProjects } = require("../services/projects");

const router = express.Router();

router.get("/", isAuthenticated, async (req, res) => {
  try {
    const [stats, tunnelStatus, cloudflaredCheck, projects, temperature] = await Promise.all([
      getSystemStats(),
      getTunnelStatus(),
      checkCloudflaredInstalled(),
      getAllProjects(),
      getTemperature()
    ]);

    const runningProjects = projects.filter(p => p.status === "running").length;
    const totalProjects = projects.length;

    res.json({
      system: stats,
      tunnel: tunnelStatus,
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

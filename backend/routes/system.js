const express = require("express");
const { isAuthenticated } = require("./auth");
const { getSystemStats, getProcessList } = require("../services/monitor");

const router = express.Router();

router.get("/stats", isAuthenticated, async (req, res) => {
  try {
    const stats = await getSystemStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/processes", isAuthenticated, async (req, res) => {
  try {
    const processes = await getProcessList();
    res.json(processes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

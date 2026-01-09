const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("./auth");
const { getHistoricalData } = require("../services/metrics");

router.get("/cpu", isAuthenticated, (req, res) => {
    const data = getHistoricalData('cpu', req.query.range);
    res.json({ success: true, data });
});

router.get("/memory", isAuthenticated, (req, res) => {
    const data = getHistoricalData('memory', req.query.range);
    res.json({ success: true, data });
});

router.get("/network", isAuthenticated, (req, res) => {
    const rx = getHistoricalData('network_rx', req.query.range);
    const tx = getHistoricalData('network_tx', req.query.range);
    res.json({ success: true, data: { rx, tx } });
});

router.get("/temperature", isAuthenticated, (req, res) => {
    const data = getHistoricalData('temperature', req.query.range);
    res.json({ success: true, data });
});

module.exports = router;

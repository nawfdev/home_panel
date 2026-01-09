const { getSystemStats } = require("./monitor");
const si = require("systeminformation");

// Metrics storage (in-memory, 24 hours)
const metricsData = {
    cpu: [],
    memory: [],
    network: { rx: [], tx: [] },
    temperature: []
};

const MAX_DATA_POINTS = 1440; // 24h at 1min intervals

// Collect metrics
async function collectMetrics() {
    try {
        const stats = await getSystemStats();
        const timestamp = Date.now();

        // CPU
        metricsData.cpu.push({ timestamp, value: stats.cpu.usage });
        if (metricsData.cpu.length > MAX_DATA_POINTS) metricsData.cpu.shift();

        // Memory
        metricsData.memory.push({ timestamp, value: stats.memory.usagePercent });
        if (metricsData.memory.length > MAX_DATA_POINTS) metricsData.memory.shift();

        // Network
        if (stats.network && stats.network.length > 0) {
            const totalRx = stats.network.reduce((sum, n) => sum + (n.rx_sec || 0), 0);
            const totalTx = stats.network.reduce((sum, n) => sum + (n.tx_sec || 0), 0);
            metricsData.network.rx.push({ timestamp, value: totalRx / 1024 / 1024 }); // MB/s
            metricsData.network.tx.push({ timestamp, value: totalTx / 1024 / 1024 });
            if (metricsData.network.rx.length > MAX_DATA_POINTS) metricsData.network.rx.shift();
            if (metricsData.network.tx.length > MAX_DATA_POINTS) metricsData.network.tx.shift();
        }

        // Temperature
        const temp = await si.cpuTemperature();
        if (temp.main && temp.main > 0) {
            metricsData.temperature.push({ timestamp, value: Math.round(temp.main) });
            if (metricsData.temperature.length > MAX_DATA_POINTS) metricsData.temperature.shift();
        }
    } catch (error) {
        console.error("Metrics collection error:", error.message);
    }
}

// Start metrics collection  
function startMetricsCollection() {
    console.log("📊 Starting metrics collection (every 60s)...");
    collectMetrics(); // Initial collection
    setInterval(collectMetrics, 60000); // Every 60 seconds
}

// Get historical data
function getHistoricalData(metric, range = '24h') {
    const data = {
        cpu: metricsData.cpu,
        memory: metricsData.memory,
        network_rx: metricsData.network.rx,
        network_tx: metricsData.network.tx,
        temperature: metricsData.temperature
    };

    return data[metric] || [];
}

module.exports = {
    startMetricsCollection,
    getHistoricalData,
    metricsData
};

const config = require("../../config/config.json");
const { getSystemStats } = require("./monitor");
const si = require("systeminformation");

let sendNotification = null;
try {
    const telegram = require("./telegram");
    sendNotification = telegram.sendNotification;
} catch (err) {
    // Telegram not configured
}

// Alert state tracking
const alertStates = {
    cpu: { triggered: false, lastAlert: 0 },
    memory: { triggered: false, lastAlert: 0 },
    disk: { triggered: false, lastAlert: 0 },
    temperature: { triggered: false, lastAlert: 0 }
};

let monitoringInterval = null;

// Start alert monitoring
function startAlertMonitoring() {
    if (!config.alerts || !config.alerts.enabled) {
        console.log("⚠️  Alert monitoring disabled in config");
        return;
    }

    console.log("🔔 Starting alert threshold monitoring...");

    // Check every 60 seconds
    monitoringInterval = setInterval(async () => {
        await checkThresholds();
    }, 60000);

    // Initial check
    checkThresholds();
}

// Stop alert monitoring
function stopAlertMonitoring() {
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
        console.log("Alert monitoring stopped");
    }
}

// Check all thresholds
async function checkThresholds() {
    try {
        const stats = await getSystemStats();
        const thresholds = config.alerts.thresholds;
        const cooldown = config.alerts.cooldown || 300000; // 5 minutes default
        const now = Date.now();

        // CPU Check
        const cpuUsage = stats.cpu.usage;
        if (cpuUsage >= thresholds.cpu.critical) {
            await handleAlert("cpu", "critical", cpuUsage, thresholds.cpu.critical, "%", cooldown, now);
        } else if (cpuUsage >= thresholds.cpu.warning) {
            await handleAlert("cpu", "warning", cpuUsage, thresholds.cpu.warning, "%", cooldown, now);
        } else if (alertStates.cpu.triggered) {
            await handleRecovery("cpu", cpuUsage, "%");
        }

        // Memory Check
        const memUsage = stats.memory.usagePercent;
        if (memUsage >= thresholds.memory.critical) {
            await handleAlert("memory", "critical", memUsage, thresholds.memory.critical, "%", cooldown, now);
        } else if (memUsage >= thresholds.memory.warning) {
            await handleAlert("memory", "warning", memUsage, thresholds.memory.warning, "%", cooldown, now);
        } else if (alertStates.memory.triggered) {
            await handleRecovery("memory", memUsage, "%");
        }

        // Disk Check (primary disk)
        if (stats.disk && stats.disk.length > 0) {
            const primaryDisk = stats.disk[0];
            const diskUsage = primaryDisk.usagePercent;

            if (diskUsage >= thresholds.disk.critical) {
                await handleAlert("disk", "critical", diskUsage, thresholds.disk.critical, "%", cooldown, now);
            } else if (diskUsage >= thresholds.disk.warning) {
                await handleAlert("disk", "warning", diskUsage, thresholds.disk.warning, "%", cooldown, now);
            } else if (alertStates.disk.triggered) {
                await handleRecovery("disk", diskUsage, "%");
            }
        }

        // Temperature Check
        try {
            const temp = await si.cpuTemperature();
            if (temp.main && temp.main > 0) {
                const tempValue = Math.round(temp.main);

                if (tempValue >= thresholds.temperature.critical) {
                    await handleAlert("temperature", "critical", tempValue, thresholds.temperature.critical, "°C", cooldown, now);
                } else if (tempValue >= thresholds.temperature.warning) {
                    await handleAlert("temperature", "warning", tempValue, thresholds.temperature.warning, "°C", cooldown, now);
                } else if (alertStates.temperature.triggered) {
                    await handleRecovery("temperature", tempValue, "°C");
                }
            }
        } catch (err) {
            // Temperature not available, skip
        }

    } catch (error) {
        console.error("Alert monitoring error:", error.message);
    }
}

// Handle alert
async function handleAlert(metric, level, currentValue, threshold, unit, cooldown, now) {
    const state = alertStates[metric];

    // Check cooldown
    if (state.triggered && (now - state.lastAlert) < cooldown) {
        // Still in cooldown, skip
        return;
    }

    // Mark as triggered
    state.triggered = true;
    state.lastAlert = now;

    const emoji = level === "critical" ? "🔴" : "⚠️";
    const levelText = level.toUpperCase();

    const message = `${emoji} *${levelText}: High ${metric.charAt(0).toUpperCase() + metric.slice(1)} Usage*\n\n` +
        `${metric.toUpperCase()}: ${currentValue.toFixed(1)}${unit} (threshold: ${threshold}${unit})\n` +
        `Time: ${new Date().toLocaleTimeString()}\n\n` +
        `${level === "critical" ? "⚡ Action required!" : "Monitor closely"}`;

    console.log(`🔔 Alert: ${metric} ${level} - ${currentValue}${unit}`);

    if (sendNotification) {
        await sendNotification(message, level);
    }
}

// Handle recovery
async function handleRecovery(metric, currentValue, unit) {
    const state = alertStates[metric];
    state.triggered = false;

    const message = `✅ *Resolved: ${metric.charAt(0).toUpperCase() + metric.slice(1)} Back to Normal*\n\n` +
        `${metric.toUpperCase()}: ${currentValue.toFixed(1)}${unit}\n` +
        `Time: ${new Date().toLocaleTimeString()}`;

    console.log(`✅ Recovery: ${metric} - ${currentValue}${unit}`);

    if (sendNotification) {
        await sendNotification(message, "success");
    }
}

// Get alert status
function getAlertStatus() {
    return {
        enabled: config.alerts?.enabled || false,
        monitoring: monitoringInterval !== null,
        states: alertStates,
        thresholds: config.alerts?.thresholds || {}
    };
}

module.exports = {
    startAlertMonitoring,
    stopAlertMonitoring,
    getAlertStatus
};

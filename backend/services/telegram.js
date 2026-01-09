const TelegramBot = require("node-telegram-bot-api");
const baseConfig = require("../../config/config.json"); // Renamed to avoid confusion
const { getTunnelStatus } = require("./cloudflared");
const { getSystemStats } = require("./monitor");
const { getSetting, setSetting } = require("./database");

let bot = null;
let isConnected = false;
let lastTunnelStatus = null;
let monitoringInterval = null;

// Helper to get active config
function getConfig() {
    const dbConfig = getSetting('telegram');
    if (dbConfig) return dbConfig;
    return baseConfig.telegram || {};
}

// Initialize Telegram Bot
function initBot() {
    try {
        // Clear previous bot if exists
        if (bot) {
            try {
                bot.stopPolling();
            } catch (e) { /* ignore */ }
            bot = null;
        }

        const config = getConfig();
        const token = config.botToken;
        const chatId = config.chatId;

        if (!token || token === "YOUR_BOT_TOKEN_HERE") {
            console.log("⚠️  Telegram bot token not configured.");
            isConnected = false;
            return false;
        }

        // Initialize bot
        bot = new TelegramBot(token, { polling: true });
        isConnected = true;
        console.log("✅ Telegram Bot initialized successfully!");

        // Setup handlers
        setupCommandHandlers();

        // Start monitoring if enabled
        if (config.enableNotifications) {
            startMonitoring();
        } else {
            stopMonitoring();
        }

        return true;
    } catch (error) {
        console.error("❌ Failed to initialize Telegram bot:", error.message);
        isConnected = false;
        return false;
    }
}

// Update runtime config
function updateConfig(newConfig) {
    const currentConfig = getConfig();
    const mergedConfig = { ...currentConfig, ...newConfig };

    // Save to DB
    setSetting('telegram', mergedConfig);

    // Re-init bot with new config
    return initBot();
}

// Setup all command handlers
function setupCommandHandlers() {
    if (!bot) return;

    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const welcomeMessage = `
🤖 *Cloudflare Panel Bot*

Selamat datang! Bot ini bisa membantu Anda memantau dan mengelola server.

*Perintah yang tersedia:*
/status - Status sistem & tunnel
/docker - Daftar Docker containers
/pm2 - Daftar PM2 processes
/ip - Informasi jaringan
/logs - Lihat logs
/restart - Restart service
/help - Bantuan lengkap
    `;
        await sendMessage(chatId, welcomeMessage);
    });

    // Help command
    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        const helpMessage = `
📚 *Bantuan Lengkap*

*Status & Monitoring:*
/status - Status sistem lengkap
/ip - IP publik & lokal

*Container & Process:*
/docker - Daftar containers
/docker restart <name>
/pm2 - Daftar processes
/pm2 restart <name>

*System:*
/restart tunnel - Restart tunnel
        `;
        await sendMessage(chatId, helpMessage);
    });

    // Other commands
    bot.onText(/\/status/, (msg) => handleStatusCommand(msg.chat.id));
    bot.onText(/\/ip/, (msg) => handleIpCommand(msg.chat.id));
    bot.onText(/\/docker(.*)/, (msg, match) => handleDockerCommand(msg.chat.id, match[1].trim()));
    bot.onText(/\/pm2(.*)/, (msg, match) => handlePm2Command(msg.chat.id, match[1].trim()));
    bot.onText(/\/restart(.*)/, (msg, match) => handleRestartCommand(msg.chat.id, match[1].trim()));

    bot.on("polling_error", (error) => {
        // Suppress polling errors to avoid log spam if token is invalid
        if (error.code !== 'EFATAL') console.error("Telegram polling error:", error.message);
    });
}

// Command Handlers (Compact version)
async function handleStatusCommand(chatId) {
    try {
        const [tunnelStatus, systemStats] = await Promise.all([getTunnelStatus(), getSystemStats()]);
        const emoji = tunnelStatus.processRunning ? "🟢" : "🔴";
        const message = `
📊 *Status Sistem*
*Tunnel:* ${emoji} ${tunnelStatus.processRunning ? "Running" : "Stopped"}
*CPU:* ${systemStats.cpu.usage.toFixed(1)}% | *RAM:* ${systemStats.memory.usagePercent.toFixed(1)}%
*Disk:* ${systemStats.disk[0]?.usagePercent.toFixed(1)}% | *Temp:* ${await getCpuTemp()}°C
        `;
        await sendMessage(chatId, message);
    } catch (err) { await sendMessage(chatId, `Error: ${err.message}`); }
}

async function getCpuTemp() {
    try {
        const si = require("systeminformation");
        const temp = await si.cpuTemperature();
        return temp.main || 'N/A';
    } catch { return 'N/A'; }
}

async function handleIpCommand(chatId) {
    try {
        const network = await require("./network").getNetworkInfo();
        await sendMessage(chatId, `🌐 *IP Info*\nPublic: \`${network.publicIp}\``);
    } catch (err) { await sendMessage(chatId, `Error: ${err.message}`); }
}

async function handleDockerCommand(chatId, args) {
    try {
        const docker = require("./docker");
        if (!args) {
            const list = await docker.listContainers();
            const text = list.length ? list.map(c => `${c.state === 'running' ? '🟢' : '🔴'} ${c.name}`).join('\n') : "No containers";
            await sendMessage(chatId, `🐳 *Docker*\n${text}`);
        } else if (args.startsWith('restart ')) {
            await docker.restartContainer(args.replace('restart ', ''));
            await sendMessage(chatId, "✅ Restarted");
        }
    } catch (err) { await sendMessage(chatId, `Error: ${err.message}`); }
}

async function handlePm2Command(chatId, args) {
    try {
        const pm2 = require("./pm2");
        if (!args) {
            const list = await pm2.listProcesses();
            const text = list.length ? list.map(p => `${p.status === 'online' ? '🟢' : '🔴'} ${p.name}`).join('\n') : "No processes";
            await sendMessage(chatId, `⚙️ *PM2*\n${text}`);
        } else if (args.startsWith('restart ')) {
            await pm2.restartProcess(args.replace('restart ', ''));
            await sendMessage(chatId, "✅ Restarted");
        }
    } catch (err) { await sendMessage(chatId, `Error: ${err.message}`); }
}

async function handleRestartCommand(chatId, args) {
    if (args === 'tunnel') {
        require("./cloudflared").restartTunnel(); // simplified
        await sendMessage(chatId, "🔄 Restarting tunnel...");
    }
}

// Send message
async function sendMessage(targetChatId, text, options = {}) {
    if (!bot || !isConnected) return false;
    try {
        await bot.sendMessage(targetChatId, text, { parse_mode: "Markdown", ...options });
        return true;
    } catch (error) {
        console.error("Error sending message:", error.message);
        return false;
    }
}

// Send notification (uses configured chatId)
async function sendNotification(message, type = "info") {
    const config = getConfig();
    if (!config.chatId || !config.enableNotifications) return false;

    const icons = { info: "ℹ️", success: "✅", warning: "⚠️", error: "❌", tunnel_up: "🟢", tunnel_down: "🔴" };
    const icon = icons[type] || icons.info;
    return await sendMessage(config.chatId, `${icon} ${message}`);
}

// Monitor Loop
async function startMonitoring() {
    stopMonitoring();
    monitoringInterval = setInterval(async () => {
        try {
            const status = await getTunnelStatus();
            const isRunning = status.processRunning;
            if (lastTunnelStatus !== null && lastTunnelStatus !== isRunning) {
                await sendNotification(isRunning ? "*Tunnel UP* 🟢" : "*Tunnel DOWN* 🔴", isRunning ? "tunnel_up" : "tunnel_down");
            }
            lastTunnelStatus = isRunning;
        } catch (e) { }
    }, 60000);
}

function stopMonitoring() {
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
    }
}

function getBotStatus() {
    const config = getConfig();
    return {
        connected: isConnected,
        monitoring: monitoringInterval !== null,
        configured: !!(config.botToken && config.chatId)
    };
}

module.exports = {
    initBot,
    sendMessage,
    sendNotification,
    getBotStatus,
    updateConfig,
    stopMonitoring
};

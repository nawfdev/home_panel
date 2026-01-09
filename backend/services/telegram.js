const TelegramBot = require("node-telegram-bot-api");
const config = require("../../config/config.json");
const { getTunnelStatus } = require("./cloudflared");
const { getSystemStats } = require("./monitor");

let bot = null;
let isConnected = false;
let lastTunnelStatus = null;
let monitoringInterval = null;

// Initialize Telegram Bot
function initBot() {
    try {
        const token = config.telegram?.botToken;
        const chatId = config.telegram?.chatId;

        if (!token || token === "YOUR_BOT_TOKEN_HERE") {
            console.log("⚠️  Telegram bot token not configured. Skipping bot initialization.");
            console.log("📝 Please add your bot token to config/config.json");
            return false;
        }

        if (!chatId || chatId === "YOUR_CHAT_ID_HERE") {
            console.log("⚠️  Telegram chat ID not configured.");
            console.log("📝 Please add your chat ID to config/config.json");
        }

        bot = new TelegramBot(token, { polling: true });
        isConnected = true;

        console.log("✅ Telegram Bot initialized successfully!");

        // Setup command handlers
        setupCommandHandlers();

        // Start monitoring if enabled
        if (config.telegram?.enableNotifications) {
            startMonitoring();
        }

        return true;
    } catch (error) {
        console.error("❌ Failed to initialize Telegram bot:", error.message);
        isConnected = false;
        return false;
    }
}

// Setup all command handlers
function setupCommandHandlers() {
    if (!bot) return;

    // /start command
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

Bot akan mengirim notifikasi otomatis jika:
🔴 Tunnel down
🟢 Tunnel up
⚠️ Error terdeteksi
    `;
        await sendMessage(chatId, welcomeMessage);
    });

    // /help command
    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        const helpMessage = `
📚 *Bantuan Lengkap*

*Status & Monitoring:*
/status - Status sistem lengkap
/ip - IP publik & lokal

*Docker Management:*
/docker - Daftar containers
/docker ps - Container yang running
/docker restart <name> - Restart container

*PM2 Management:*
/pm2 - Daftar processes
/pm2 restart <name> - Restart process
/pm2 logs <name> - Lihat logs

*Cloudflare Tunnel:*
/restart tunnel - Restart tunnel

*Logs:*
/logs cloudflared - Logs tunnel
/logs system - Logs sistem

*Tips:*
- Bot akan otomatis memberi tahu jika ada masalah
- Semua perintah case-insensitive
- Gunakan /status untuk quick check
    `;
        await sendMessage(chatId, helpMessage);
    });

    // /status command
    bot.onText(/\/status/, async (msg) => {
        const chatId = msg.chat.id;
        await handleStatusCommand(chatId);
    });

    // /ip command
    bot.onText(/\/ip/, async (msg) => {
        const chatId = msg.chat.id;
        await handleIpCommand(chatId);
    });

    // /docker command
    bot.onText(/\/docker(.*)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const args = match[1].trim();
        await handleDockerCommand(chatId, args);
    });

    // /pm2 command
    bot.onText(/\/pm2(.*)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const args = match[1].trim();
        await handlePm2Command(chatId, args);
    });

    // /restart command
    bot.onText(/\/restart(.*)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const args = match[1].trim();
        await handleRestartCommand(chatId, args);
    });

    // /logs command
    bot.onText(/\/logs(.*)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const args = match[1].trim();
        await handleLogsCommand(chatId, args);
    });

    // Handle errors
    bot.on("polling_error", (error) => {
        console.error("Telegram polling error:", error.message);
    });
}

// Command Handlers
async function handleStatusCommand(chatId) {
    try {
        const [tunnelStatus, systemStats] = await Promise.all([
            getTunnelStatus(),
            getSystemStats()
        ]);

        const tunnelEmoji = tunnelStatus.processRunning ? "🟢" : "🔴";
        const tunnelText = tunnelStatus.processRunning ? "Running" : "Stopped";

        const message = `
📊 *Status Sistem*

*Cloudflare Tunnel:* ${tunnelEmoji} ${tunnelText}
${tunnelStatus.tunnel ? `Domain: ${tunnelStatus.tunnel.domain || '-'}` : ''}
${tunnelStatus.processRunning ? `PID: ${tunnelStatus.pid}` : ''}

*Sistem:*
🖥️ CPU: ${systemStats.cpu.usage.toFixed(1)}%
💾 RAM: ${systemStats.memory.usagePercent.toFixed(1)}% (${Math.round(systemStats.memory.used / 1024 / 1024 / 1024)}GB / ${Math.round(systemStats.memory.total / 1024 / 1024 / 1024)}GB)
💿 Disk: ${systemStats.disk[0]?.usagePercent.toFixed(1)}%
⏰ Uptime: ${Math.floor(systemStats.uptime / 3600)}h ${Math.floor((systemStats.uptime % 3600) / 60)}m

*OS:*
Platform: ${systemStats.os.platform}
Hostname: ${systemStats.os.hostname}
    `;

        await sendMessage(chatId, message);
    } catch (error) {
        await sendMessage(chatId, `❌ Error mengambil status: ${error.message}`);
    }
}

async function handleIpCommand(chatId) {
    try {
        const networkService = require("./network");
        const networkInfo = await networkService.getNetworkInfo();

        const message = `
🌐 *Informasi Jaringan*

*IP Publik:* ${networkInfo.publicIp}

*Network Interfaces:*
${networkInfo.interfaces.map(iface =>
            `${iface.name}: ${iface.ip4 || 'N/A'}`
        ).join('\n')}

*Active Connections:* ${networkInfo.connections}
    `;

        await sendMessage(chatId, message);
    } catch (error) {
        await sendMessage(chatId, `❌ Error mengambil info network: ${error.message}`);
    }
}

async function handleDockerCommand(chatId, args) {
    try {
        const dockerService = require("./docker");

        if (!args || args === "ps") {
            // List containers
            const containers = await dockerService.listContainers();

            if (containers.length === 0) {
                await sendMessage(chatId, "📦 Tidak ada Docker container yang running");
                return;
            }

            const message = `
🐳 *Docker Containers*

${containers.map(c =>
                `${c.state === 'running' ? '🟢' : '🔴'} *${c.name}*
  Status: ${c.state}
  Image: ${c.image}
  Uptime: ${c.uptime}`
            ).join('\n\n')}
      `;

            await sendMessage(chatId, message);
        } else if (args.startsWith("restart ")) {
            const containerName = args.replace("restart ", "").trim();
            await dockerService.restartContainer(containerName);
            await sendMessage(chatId, `✅ Container '${containerName}' direstart`);
        } else {
            await sendMessage(chatId, "❓ Perintah tidak dikenali. Gunakan: /docker atau /docker restart <name>");
        }
    } catch (error) {
        if (error.message.includes("Docker not available")) {
            await sendMessage(chatId, "⚠️ Docker tidak tersedia di sistem ini");
        } else {
            await sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
}

async function handlePm2Command(chatId, args) {
    try {
        const pm2Service = require("./pm2");

        if (!args) {
            // List processes
            const processes = await pm2Service.listProcesses();

            if (processes.length === 0) {
                await sendMessage(chatId, "📋 Tidak ada PM2 process yang running");
                return;
            }

            const message = `
⚙️ *PM2 Processes*

${processes.map(p =>
                `${p.status === 'online' ? '🟢' : '🔴'} *${p.name}*
  Status: ${p.status}
  CPU: ${p.cpu}%
  Memory: ${p.memory}MB
  Uptime: ${p.uptime}`
            ).join('\n\n')}
      `;

            await sendMessage(chatId, message);
        } else if (args.startsWith("restart ")) {
            const processName = args.replace("restart ", "").trim();
            await pm2Service.restartProcess(processName);
            await sendMessage(chatId, `✅ Process '${processName}' direstart`);
        } else {
            await sendMessage(chatId, "❓ Perintah tidak dikenali. Gunakan: /pm2 atau /pm2 restart <name>");
        }
    } catch (error) {
        if (error.message.includes("PM2 not available")) {
            await sendMessage(chatId, "⚠️ PM2 tidak tersedia di sistem ini");
        } else {
            await sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
}

async function handleRestartCommand(chatId, args) {
    if (args === "tunnel") {
        try {
            const { stopTunnel, startTunnel } = require("./cloudflared");
            await stopTunnel();
            await new Promise(resolve => setTimeout(resolve, 2000));
            await startTunnel();
            await sendMessage(chatId, "✅ Tunnel berhasil direstart");
        } catch (error) {
            await sendMessage(chatId, `❌ Error restart tunnel: ${error.message}`);
        }
    } else {
        await sendMessage(chatId, "❓ Gunakan: /restart tunnel");
    }
}

async function handleLogsCommand(chatId, args) {
    await sendMessage(chatId, "🚧 Fitur logs sedang dalam pengembangan");
}

// Send message with error handling
async function sendMessage(chatId, text, options = {}) {
    if (!bot || !isConnected) {
        console.error("Bot not initialized or connected");
        return false;
    }

    try {
        await bot.sendMessage(chatId, text, {
            parse_mode: "Markdown",
            ...options
        });
        return true;
    } catch (error) {
        console.error("Error sending message:", error.message);
        return false;
    }
}

// Send notification to configured chat
async function sendNotification(message, type = "info") {
    const chatId = config.telegram?.chatId;

    if (!chatId || chatId === "YOUR_CHAT_ID_HERE") {
        console.log("Notification skipped: Chat ID not configured");
        return false;
    }

    if (!config.telegram?.enableNotifications) {
        console.log("Notification skipped: Notifications disabled");
        return false;
    }

    const icons = {
        info: "ℹ️",
        success: "✅",
        warning: "⚠️",
        error: "❌",
        tunnel_up: "🟢",
        tunnel_down: "🔴"
    };

    const icon = icons[type] || icons.info;
    const formattedMessage = `${icon} ${message}`;

    return await sendMessage(chatId, formattedMessage);
}

// Monitor tunnel status
async function startMonitoring() {
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
    }

    console.log("🔍 Starting tunnel monitoring...");

    monitoringInterval = setInterval(async () => {
        try {
            const tunnelStatus = await getTunnelStatus();
            const isRunning = tunnelStatus.processRunning;

            // Check if status changed
            if (lastTunnelStatus !== null && lastTunnelStatus !== isRunning) {
                if (isRunning) {
                    await sendNotification(
                        `*Tunnel UP* 🟢\n\nCloudflare tunnel berhasil running!\nDomain: ${tunnelStatus.tunnel?.domain || '-'}`,
                        "tunnel_up"
                    );
                } else {
                    await sendNotification(
                        `*Tunnel DOWN* 🔴\n\nCloudflare tunnel berhenti!\nSilakan cek sistem Anda.`,
                        "tunnel_down"
                    );
                }
            }

            lastTunnelStatus = isRunning;
        } catch (error) {
            console.error("Monitoring error:", error.message);
        }
    }, 30000); // Check every 30 seconds
}

function stopMonitoring() {
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
        console.log("🛑 Tunnel monitoring stopped");
    }
}

// Get bot status
function getBotStatus() {
    return {
        connected: isConnected,
        monitoring: monitoringInterval !== null,
        configured: config.telegram?.botToken && config.telegram?.botToken !== "YOUR_BOT_TOKEN_HERE"
    };
}

module.exports = {
    initBot,
    sendMessage,
    sendNotification,
    getBotStatus,
    stopMonitoring
};

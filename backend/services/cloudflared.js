const { spawn, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { getDb } = require("./database");

let tunnelProcess = null;
let autoRestart = true; // Enable auto-restart by default
let restartCount = 0;
let lastRestartTime = 0;
let healthCheckInterval = null;

// Get Telegram notification function (optional, only if configured)
let sendNotification = null;
try {
  const telegram = require("./telegram");
  sendNotification = telegram.sendNotification;
} catch (err) {
  // Telegram not configured yet, that's ok
}

async function checkCloudflaredInstalled() {
  return new Promise((resolve) => {
    exec("cloudflared --version", (error, stdout) => {
      if (error) {
        resolve({ installed: false, version: null });
      } else {
        resolve({ installed: true, version: stdout.trim() });
      }
    });
  });
}

async function getTunnelStatus() {
  const db = getDb();
  const tunnel = db.prepare("SELECT * FROM tunnels ORDER BY id DESC LIMIT 1").get();

  return {
    configured: !!tunnel,
    tunnel: tunnel || null,
    processRunning: tunnelProcess !== null && !tunnelProcess.killed,
    pid: tunnelProcess ? tunnelProcess.pid : null,
    autoRestart,
    restartCount
  };
}

async function createTunnel(name) {
  return new Promise((resolve, reject) => {
    exec(`cloudflared tunnel create ${name}`, (error, stdout, stderr) => {
      if (error) {
        reject({ success: false, message: stderr || error.message });
        return;
      }

      const tunnelIdMatch = stdout.match(/Created tunnel ([a-zA-Z0-9-]+)/);
      const tunnelId = tunnelIdMatch ? tunnelIdMatch[1] : null;

      const db = getDb();
      db.prepare("INSERT INTO tunnels (name, tunnel_id, status) VALUES (?, ?, ?)").run(
        name, tunnelId, "created"
      );

      resolve({ success: true, tunnelId, output: stdout });
    });
  });
}

async function configureTunnel(tunnelId, domain, localPort) {
  const configDir = path.join(process.env.USERPROFILE || process.env.HOME, ".cloudflared");
  const configPath = path.join(configDir, "config.yml");

  const config = `tunnel: ${tunnelId}
credentials-file: ${path.join(configDir, `${tunnelId}.json`)}

ingress:
  - hostname: ${domain}
    service: http://localhost:${localPort}
  - service: http_status:404
`;

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, config);

  const db = getDb();
  db.prepare("UPDATE tunnels SET domain = ?, local_port = ?, config = ? WHERE tunnel_id = ?").run(
    domain, localPort, config, tunnelId
  );

  return { success: true, configPath };
}

async function routeTunnel(tunnelId, domain) {
  return new Promise((resolve, reject) => {
    exec(`cloudflared tunnel route dns ${tunnelId} ${domain}`, (error, stdout, stderr) => {
      if (error) {
        reject({ success: false, message: stderr || error.message });
        return;
      }
      resolve({ success: true, output: stdout });
    });
  });
}

async function startTunnel(manualStart = false) {
  if (tunnelProcess && !tunnelProcess.killed) {
    return { success: false, message: "Tunnel is already running" };
  }

  const configPath = path.join(process.env.USERPROFILE || process.env.HOME, ".cloudflared", "config.yml");

  if (!fs.existsSync(configPath)) {
    return { success: false, message: "Tunnel not configured. Please configure tunnel first." };
  }

  try {
    tunnelProcess = spawn("cloudflared", ["tunnel", "run"], {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const pid = tunnelProcess.pid;
    console.log(`🟢 Cloudflare Tunnel started (PID: ${pid})`);

    // Log output for debugging
    tunnelProcess.stdout.on("data", (data) => {
      const output = data.toString();
      if (output.includes("Connection") || output.includes("error")) {
        console.log(`[Tunnel] ${output.trim()}`);
      }
    });

    tunnelProcess.stderr.on("data", (data) => {
      console.error(`[Tunnel Error] ${data.toString().trim()}`);
    });

    // Handle tunnel exit/crash
    tunnelProcess.on("close", async (code) => {
      console.log(`🔴 Tunnel process exited with code ${code}`);
      tunnelProcess = null;

      const db = getDb();
      db.prepare("UPDATE tunnels SET status = ? WHERE id = (SELECT MAX(id) FROM tunnels)").run("stopped");

      // Send notification if available
      if (sendNotification && !manualStart) {
        await sendNotification(
          `⚠️ *Tunnel Stopped*\n\nTunnel exited with code ${code}\n${autoRestart ? 'Auto-restart will attempt...' : 'Auto-restart disabled'}`,
          "warning"
        );
      }

      // Auto-restart logic
      if (autoRestart && !manualStart) {
        const now = Date.now();
        const timeSinceLastRestart = now - lastRestartTime;

        // Reset counter if last restart was more than 5 minutes ago
        if (timeSinceLastRestart > 300000) {
          restartCount = 0;
        }

        // Exponential backoff: 5s, 10s, 30s, 60s, 300s
        const delays = [5000, 10000, 30000, 60000, 300000];
        const delay = delays[Math.min(restartCount, delays.length - 1)];

        restartCount++;
        lastRestartTime = now;

        console.log(`⏳ Auto-restart in ${delay / 1000}s (attempt ${restartCount})...`);

        setTimeout(async () => {
          console.log(`🔄 Attempting to restart tunnel...`);
          const result = await startTunnel(false);

          if (result.success) {
            console.log(`✅ Tunnel restarted successfully`);
            if (sendNotification) {
              await sendNotification(
                `✅ *Tunnel Restarted*\n\nTunnel is back online after ${restartCount} attempt(s)`,
                "success"
              );
            }
          } else {
            console.log(`❌ Restart failed: ${result.message}`);
          }
        }, delay);
      }
    });

    tunnelProcess.on("error", (err) => {
      console.error(`❌ Tunnel process error:`, err);
    });

    const db = getDb();
    db.prepare("UPDATE tunnels SET status = ? WHERE id = (SELECT MAX(id) FROM tunnels)").run("running");

    // Start health monitoring
    startHealthCheck();

    return { success: true, pid, message: "Tunnel started successfully" };
  } catch (error) {
    console.error("Failed to start tunnel:", error);
    return { success: false, message: error.message };
  }
}

async function stopTunnel() {
  if (!tunnelProcess) {
    return { success: false, message: "No tunnel process running" };
  }

  // Disable auto-restart temporarily for manual stop
  const wasAutoRestart = autoRestart;
  autoRestart = false;

  tunnelProcess.kill("SIGTERM");
  tunnelProcess = null;

  const db = getDb();
  db.prepare("UPDATE tunnels SET status = ? WHERE id = (SELECT MAX(id) FROM tunnels)").run("stopped");

  // Stop health check
  stopHealthCheck();

  // Re-enable after 2 seconds
  setTimeout(() => {
    autoRestart = wasAutoRestart;
  }, 2000);

  console.log("🛑 Tunnel stopped manually");

  return { success: true, message: "Tunnel stopped" };
}

// Health check to ensure tunnel is alive
function startHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }

  healthCheckInterval = setInterval(async () => {
    if (tunnelProcess && tunnelProcess.pid) {
      try {
        // Check if process is still alive
        process.kill(tunnelProcess.pid, 0);
      } catch (err) {
        console.error("⚠️ Tunnel process not responding, marked as dead");
        tunnelProcess = null;
      }
    }
  }, 30000); // Check every 30 seconds
}

function stopHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

function setAutoRestart(enabled) {
  autoRestart = enabled;
  console.log(`Auto-restart ${enabled ? 'enabled' : 'disabled'}`);
  return { success: true, autoRestart: enabled };
}

async function listTunnels() {
  return new Promise((resolve, reject) => {
    exec("cloudflared tunnel list", (error, stdout, stderr) => {
      if (error) {
        reject({ success: false, message: stderr || error.message });
        return;
      }
      resolve({ success: true, output: stdout });
    });
  });
}

module.exports = {
  checkCloudflaredInstalled,
  getTunnelStatus,
  createTunnel,
  configureTunnel,
  routeTunnel,
  startTunnel,
  stopTunnel,
  listTunnels,
  setAutoRestart,
  stopHealthCheck
};


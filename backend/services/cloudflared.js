const { spawn, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { getDb } = require("./database");

let tunnelProcess = null;
let autoRestart = true; // Enable auto-restart by default
let restartCount = 0;
let lastRestartTime = 0;
let healthCheckInterval = null;

// Downtime tracking
let downtimeStartTime = null; // When tunnel went down (null = running)
let totalDowntimeMs = 0; // Total accumulated downtime in this session
let downtimeHistory = []; // Array of { start, end, duration } for recent downtimes
const MAX_DOWNTIME_HISTORY = 10; // Keep last 10 downtime events

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
    // First try the PATH
    exec("cloudflared --version", (error, stdout) => {
      if (!error && stdout) {
        resolve({ installed: true, version: stdout.trim() });
        return;
      }

      // Fallback: check common locations
      const commonPaths = process.platform === 'win32'
        ? [
          'C:\\Program Files\\Cloudflare\\cloudflared.exe',
          'C:\\Program Files (x86)\\Cloudflare\\cloudflared.exe',
          path.join(process.env.USERPROFILE || '', 'cloudflared.exe')
        ]
        : [
          '/usr/local/bin/cloudflared',
          '/usr/bin/cloudflared',
          '/opt/cloudflared/cloudflared',
          path.join(process.env.HOME || '', '.cloudflared/bin/cloudflared')
        ];

      for (const cfPath of commonPaths) {
        if (fs.existsSync(cfPath)) {
          exec(`"${cfPath}" --version`, (err, out) => {
            if (!err && out) {
              resolve({ installed: true, version: out.trim(), path: cfPath });
            } else {
              resolve({ installed: true, version: 'Unknown', path: cfPath });
            }
          });
          return;
        }
      }

      resolve({ installed: false, version: null });
    });
  });
}

const METRICS_PORT = 36500;
const METRICS_URL = `http://127.0.0.1:${METRICS_PORT}`;

async function getTunnelStatus() {
  const db = getDb();
  const tunnel = db.prepare("SELECT * FROM tunnels ORDER BY id DESC LIMIT 1").get();

  // Check if actually ready via metrics
  let isReady = false;
  let connCount = 0;

  if (tunnelProcess && !tunnelProcess.killed) {
    try {
      // Short timeout for local check
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 500);

      const res = await fetch(`${METRICS_URL}/ready`, { signal: controller.signal });
      if (res.ok) {
        isReady = true;
      }

      // Try to get connection count from /metrics (text format)
      // cloudflared_tunnel_total_sessions gauge
      // This is optional/advanced, just readiness is good for now
    } catch (e) {
      // Not ready yet
    }
  }

  // Calculate next retry time if in backoff
  let nextRetryIn = 0;
  if (autoRestart && !tunnelProcess && restartCount > 0) {
    const delays = [5000, 10000, 30000, 60000, 300000];
    const delay = delays[Math.min(restartCount - 1, delays.length - 1)]; // restartCount is already incremented after crash
    const nextTime = lastRestartTime + delay;
    nextRetryIn = Math.max(0, Math.ceil((nextTime - Date.now()) / 1000));
  }

  // Calculate current downtime if tunnel is down
  let currentDowntimeMs = 0;
  if (downtimeStartTime) {
    currentDowntimeMs = Date.now() - downtimeStartTime;
  }

  return {
    configured: !!tunnel,
    tunnel: tunnel || null,
    processRunning: tunnelProcess !== null && !tunnelProcess.killed,
    isReady,
    pid: tunnelProcess ? tunnelProcess.pid : null,
    autoRestart,
    restartCount,
    nextRetryIn, // Seconds until next retry
    // Downtime info
    downtime: {
      isDown: downtimeStartTime !== null,
      currentDowntimeMs,
      currentDowntimeSec: Math.floor(currentDowntimeMs / 1000),
      totalDowntimeMs,
      totalDowntimeSec: Math.floor(totalDowntimeMs / 1000),
      history: downtimeHistory.slice(-5) // Last 5 events
    }
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

  // Check multiple config locations
  const possibleConfigPaths = [
    path.join(process.env.HOME || '/root', '.cloudflared', 'config.yml'),
    path.join(process.env.USERPROFILE || '', '.cloudflared', 'config.yml'),
    '/etc/cloudflared/config.yml',
    '/root/.cloudflared/config.yml',
    path.join(process.env.HOME || '/root', '.cloudflared', 'config.yaml')
  ];

  let configPath = null;
  for (const p of possibleConfigPaths) {
    if (fs.existsSync(p)) {
      configPath = p;
      console.log(`[Tunnel] Found config at: ${p}`);
      break;
    }
  }

  // If no config found, try running without config (using named tunnel from credentials)
  // Many tunnels are configured via cloudflared service install and don't need manual config
  if (!configPath) {
    console.log("[Tunnel] No config.yml found, trying to run with default settings...");
  }

  try {
    // Add metrics flag and use HTTP2 protocol (avoids ISP QUIC blocks)
    const args = ["tunnel", "run", "--protocol", "http2", "--metrics", `127.0.0.1:${METRICS_PORT}`];

    // If config found, use it
    if (configPath) {
      args.push("--config", configPath);
    }

    tunnelProcess = spawn("cloudflared", args, {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const pid = tunnelProcess.pid;
    console.log(`🟢 Cloudflare Tunnel started (PID: ${pid})`);

    // Log output for debugging
    tunnelProcess.stdout.on("data", (data) => {
      const output = data.toString();
      // ... same logging ...
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

      // Start downtime tracking
      if (!downtimeStartTime) {
        downtimeStartTime = Date.now();
        console.log(`⏱️ Downtime started at ${new Date(downtimeStartTime).toISOString()}`);
      }

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

    // End downtime tracking if was down
    if (downtimeStartTime) {
      const downtimeEnd = Date.now();
      const duration = downtimeEnd - downtimeStartTime;
      totalDowntimeMs += duration;

      // Add to history
      downtimeHistory.push({
        start: downtimeStartTime,
        end: downtimeEnd,
        durationMs: duration,
        durationSec: Math.floor(duration / 1000)
      });

      // Keep only last N entries
      if (downtimeHistory.length > MAX_DOWNTIME_HISTORY) {
        downtimeHistory = downtimeHistory.slice(-MAX_DOWNTIME_HISTORY);
      }

      console.log(`⏱️ Downtime ended. Duration: ${Math.floor(duration / 1000)}s. Total: ${Math.floor(totalDowntimeMs / 1000)}s`);
      downtimeStartTime = null;
    }

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

// ===== SYSTEMD INTEGRATION =====
const { promisify } = require('util');
const execPromise = promisify(exec);

// Check if cloudflared is running as systemd service
async function getSystemdStatus() {
  if (process.platform !== 'linux') {
    return { available: false, reason: 'Systemd only available on Linux' };
  }

  try {
    const { stdout } = await execPromise('systemctl is-active cloudflared');
    const isActive = stdout.trim() === 'active';

    // Get more details
    const { stdout: statusOut } = await execPromise('systemctl show cloudflared --property=MainPID,ActiveState,SubState,ExecMainStartTimestamp');
    const props = {};
    statusOut.split('\n').forEach(line => {
      const [key, val] = line.split('=');
      if (key && val) props[key] = val;
    });

    // Get protocol from service file
    let protocol = 'auto';
    try {
      const { stdout: serviceContent } = await execPromise('cat /etc/systemd/system/cloudflared.service');
      if (serviceContent.includes('--protocol http2')) protocol = 'http2';
      else if (serviceContent.includes('--protocol quic')) protocol = 'quic';
    } catch { }

    // Track downtime for systemd service
    if (!isActive && !downtimeStartTime) {
      downtimeStartTime = Date.now();
    } else if (isActive && downtimeStartTime) {
      // Service came back up
      const downtimeEnd = Date.now();
      const duration = downtimeEnd - downtimeStartTime;
      totalDowntimeMs += duration;
      downtimeHistory.push({
        start: downtimeStartTime,
        end: downtimeEnd,
        durationMs: duration,
        durationSec: Math.floor(duration / 1000)
      });
      if (downtimeHistory.length > MAX_DOWNTIME_HISTORY) {
        downtimeHistory = downtimeHistory.slice(-MAX_DOWNTIME_HISTORY);
      }
      downtimeStartTime = null;
    }

    // Calculate current downtime
    let currentDowntimeMs = 0;
    if (downtimeStartTime) {
      currentDowntimeMs = Date.now() - downtimeStartTime;
    }

    return {
      available: true,
      active: isActive,
      state: props.ActiveState || 'unknown',
      subState: props.SubState || 'unknown',
      pid: props.MainPID || null,
      startTime: props.ExecMainStartTimestamp || null,
      protocol,
      // Downtime info
      downtime: {
        isDown: !isActive,
        currentDowntimeMs,
        currentDowntimeSec: Math.floor(currentDowntimeMs / 1000),
        totalDowntimeMs,
        totalDowntimeSec: Math.floor(totalDowntimeMs / 1000),
        history: downtimeHistory.slice(-5)
      }
    };
  } catch (error) {
    // Service doesn't exist or systemd not available
    return { available: false, reason: error.message };
  }
}

// Restart cloudflared systemd service
async function restartSystemdService() {
  if (process.platform !== 'linux') {
    return { success: false, error: 'Systemd only available on Linux' };
  }

  try {
    await execPromise('sudo systemctl restart cloudflared');
    return { success: true, message: 'Cloudflared service restarted' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Stop cloudflared systemd service
async function stopSystemdService() {
  if (process.platform !== 'linux') {
    return { success: false, error: 'Systemd only available on Linux' };
  }

  try {
    await execPromise('sudo systemctl stop cloudflared');
    return { success: true, message: 'Cloudflared service stopped' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Start cloudflared systemd service
async function startSystemdService() {
  if (process.platform !== 'linux') {
    return { success: false, error: 'Systemd only available on Linux' };
  }

  try {
    await execPromise('sudo systemctl start cloudflared');
    return { success: true, message: 'Cloudflared service started' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Change protocol in systemd service file
async function setSystemdProtocol(protocol) {
  if (process.platform !== 'linux') {
    return { success: false, error: 'Systemd only available on Linux' };
  }

  if (!['http2', 'quic', 'auto'].includes(protocol)) {
    return { success: false, error: 'Invalid protocol. Use: http2, quic, or auto' };
  }

  try {
    // Read current service file
    const { stdout: serviceContent } = await execPromise('cat /etc/systemd/system/cloudflared.service');

    // Replace or add protocol flag
    let newContent = serviceContent;
    if (protocol === 'auto') {
      // Remove protocol flags
      newContent = newContent.replace(/--protocol\s+(http2|quic)\s*/g, '');
    } else {
      if (newContent.includes('--protocol')) {
        newContent = newContent.replace(/--protocol\s+(http2|quic|auto)/g, `--protocol ${protocol}`);
      } else {
        // Add protocol before 'tunnel run'
        newContent = newContent.replace('tunnel run', `--protocol ${protocol} tunnel run`);
      }
    }

    // Write back (requires sudo)
    const tempFile = '/tmp/cloudflared.service.tmp';
    fs.writeFileSync(tempFile, newContent);
    await execPromise(`sudo cp ${tempFile} /etc/systemd/system/cloudflared.service`);
    await execPromise('sudo systemctl daemon-reload');
    await execPromise('sudo systemctl restart cloudflared');

    return { success: true, message: `Protocol changed to ${protocol}. Service restarted.` };
  } catch (error) {
    return { success: false, error: error.message };
  }
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
  stopHealthCheck,
  // Systemd functions
  getSystemdStatus,
  restartSystemdService,
  stopSystemdService,
  startSystemdService,
  setSystemdProtocol
};

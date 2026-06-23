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

// Tunnel readiness tracking
let currentReadyState = false; // Current readiness state
let readyStateHistory = []; // Track recent readiness states for stability
const MAX_READY_HISTORY = 5; // Track last 5 checks

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

// Get detailed tunnel metrics from Prometheus endpoint
async function getTunnelMetrics() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${METRICS_URL}/metrics`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error('Metrics endpoint not available');
    }

    const metricsText = await res.text();

    // Parse Prometheus metrics
    const metrics = {
      connections: 0,
      activeConnections: 0,
      requests: 0,
      errors: 0,
      bytesIn: 0,
      bytesOut: 0,
      connectionsPerRegion: {},
      uptime: 0,
      buildVersion: 'Unknown'
    };

    const lines = metricsText.split('\n');

    lines.forEach(line => {
      line = line.trim();

      if (line.startsWith('#') || !line) return;

      const parts = line.split(' ');
      if (parts.length < 2) return;

      const metricName = parts[0];
      const value = parseFloat(parts[1]);

      // Parse cloudflared metrics (updated to match actual metric names)
      if (metricName === 'cloudflared_tunnel_ha_connections') {
        metrics.activeConnections = Math.round(value);
      } else if (metricName === 'cloudflared_tunnel_total_requests') {
        metrics.requests = Math.round(value);
      } else if (metricName === 'cloudflared_tunnel_request_errors') {
        metrics.errors = Math.round(value);
      } else if (metricName === 'cloudflared_tunnel_concurrent_requests_per_tunnel') {
        metrics.connections = Math.round(value);
      } else if (metricName.includes('build_info')) {
        // Parse version from build_info
        const match = metricName.match(/version="([^"]+)"/);
        if (match) {
          metrics.buildVersion = match[1];
        }
      } else if (metricName.startsWith('cloudflared_tunnel_server_locations')) {
        // Parse region-specific connections
        const locationMatch = metricName.match(/edge_location="([^"]+)"/);
        if (locationMatch) {
          const region = locationMatch[1];
          if (!metrics.connectionsPerRegion[region]) {
            metrics.connectionsPerRegion[region] = 0;
          }
          // Each server location represents one connection
          metrics.connectionsPerRegion[region]++;
        }
      }
    });

    // Calculate uptime from systemd process
    if (process.platform === 'linux') {
      try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        const { stdout } = await execAsync('systemctl show cloudflared --property=ActiveEnterTimestamp');
        const timestampStr = stdout.trim().split('=')[1];

        if (timestampStr && timestampStr !== '') {
          const startTime = new Date(timestampStr);
          metrics.uptime = Math.floor((Date.now() - startTime.getTime()) / 1000);
        }
      } catch (e) {
        // Fallback to uptime calculation
      }
    }

    return { success: true, metrics };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getTunnelStatus() {
  const db = getDb();
  const tunnel = db.prepare("SELECT * FROM tunnels ORDER BY id DESC LIMIT 1").get();

  // Use the stable readiness state from health check if available
  let isReady = currentReadyState;
  let processRunning = tunnelProcess !== null && !tunnelProcess.killed;
  let pid = tunnelProcess ? tunnelProcess.pid : null;

  // Also check if running via systemd on Linux
  if (!processRunning && process.platform === 'linux') {
    try {
      const systemdStatus = await getSystemdStatus();
      if (systemdStatus.isActive) {
        processRunning = true;
        // Use systemd's isReady state
        if (systemdStatus.downtime && !systemdStatus.downtime.isDown) {
          isReady = true;
        }
        pid = systemdStatus.pid || null;
      }
    } catch (e) {
      // Systemd not available or error
    }
  }

  // Also check via pgrep for any cloudflared process
  if (!processRunning) {
    try {
      const { promisify } = require('util');
      const execPromise = promisify(exec);
      const cmd = process.platform === 'win32'
        ? 'tasklist /FI "IMAGENAME eq cloudflared.exe" /NH'
        : 'pgrep -f "cloudflared tunnel"';

      const { stdout } = await execPromise(cmd, { timeout: 2000 });
      if (stdout.trim() && !stdout.includes('No tasks')) {
        processRunning = true;
        // Try to extract PID
        const match = stdout.match(/\d+/);
        if (match) {
          pid = parseInt(match[0]);
        }
      }
    } catch (e) {
      // No process found or error, that's ok
    }
  }

  // Only do a fresh metrics check if we don't have a stable state yet
  if (processRunning && readyStateHistory.length < 3) {
    try {
      // Increased timeout to 3s for better accuracy
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${METRICS_URL}/ready`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        isReady = true;
        currentReadyState = true;
      }
    } catch (e) {
      // Metrics not available, but process might still be running
      if (readyStateHistory.length === 0) {
        currentReadyState = false;
      }
    }
  }

  // Calculate next retry time if in backoff
  let nextRetryIn = 0;
  if (autoRestart && !tunnelProcess && restartCount > 0) {
    const delays = [5000, 10000, 30000, 60000, 300000];
    const delay = delays[Math.min(restartCount - 1, delays.length - 1)];
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
    processRunning,
    isReady,
    pid,
    autoRestart,
    restartCount,
    nextRetryIn,
    downtime: {
      isDown: downtimeStartTime !== null,
      currentDowntimeMs,
      currentDowntimeSec: Math.floor(currentDowntimeMs / 1000),
      totalDowntimeMs,
      totalDowntimeSec: Math.floor(totalDowntimeMs / 1000),
      history: downtimeHistory.slice(-5)
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

      // Clear ready state history
      readyStateHistory = [];
      currentReadyState = false;

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
            console.log(`✅ Tunnel process started, waiting for readiness check...`);

            // Wait up to 30 seconds for tunnel to become ready
            let ready = false;
            for (let i = 0; i < 30; i++) {
              await new Promise(resolve => setTimeout(resolve, 1000));

              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000);
                const res = await fetch(`${METRICS_URL}/ready`, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (res.ok) {
                  ready = true;
                  currentReadyState = true;
                  console.log(`✅ Tunnel is ready and operational`);
                  break;
                }
              } catch (e) {
                // Not ready yet, continue waiting
              }
            }

            if (ready) {
              if (sendNotification) {
                await sendNotification(
                  `✅ *Tunnel Restarted*\n\nTunnel is back online after ${restartCount} attempt(s)`,
                  "success"
                );
              }
            } else {
              console.log(`⚠️ Tunnel started but not ready after 30 seconds`);
              if (sendNotification) {
                await sendNotification(
                  `⚠️ *Tunnel Not Ready*\n\nTunnel started but failed to connect after 30 seconds`,
                  "warning"
                );
              }
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

  // Clear ready state
  readyStateHistory = [];
  currentReadyState = false;

  // Start downtime tracking for manual stop
  if (!downtimeStartTime) {
    downtimeStartTime = Date.now();
  }

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

// Health check to ensure tunnel is alive and ready
function startHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }

  // Check every 5 seconds for more accurate monitoring
  healthCheckInterval = setInterval(async () => {
    // First, check if process is still running
    let isProcessRunning = false;
    if (tunnelProcess && tunnelProcess.pid) {
      try {
        process.kill(tunnelProcess.pid, 0);
        isProcessRunning = true;
      } catch (err) {
        console.error("⚠️ Tunnel process not responding, marked as dead");
        tunnelProcess = null;
      }
    }

    // If process is running, check if tunnel is actually ready
    let isActuallyReady = false;
    if (isProcessRunning) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // Increased to 3s

        const res = await fetch(`${METRICS_URL}/ready`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          isActuallyReady = true;
        }
      } catch (e) {
        // Metrics not available, tunnel is not ready
      }
    }

    // Update readiness state history
    readyStateHistory.push(isActuallyReady);
    if (readyStateHistory.length > MAX_READY_HISTORY) {
      readyStateHistory.shift();
    }

    // Determine stable state (must be consistent for at least 3 checks)
    const stableReady = readyStateHistory.length >= 3 &&
      readyStateHistory.slice(-3).every(state => state === isActuallyReady);

    // Handle state changes only when stable
    if (stableReady && isActuallyReady !== currentReadyState) {
      const previousState = currentReadyState;
      currentReadyState = isActuallyReady;

      if (!isActuallyReady && previousState) {
        // Tunnel went down
        if (!downtimeStartTime) {
          downtimeStartTime = Date.now();
          console.log(`⏱️ Downtime started at ${new Date(downtimeStartTime).toISOString()} (tunnel not ready)`);
        }
      } else if (isActuallyReady && !previousState) {
        // Tunnel came back up
        if (downtimeStartTime) {
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

          console.log(`⏱️ Downtime ended. Duration: ${Math.floor(duration / 1000)}s. Total: ${Math.floor(totalDowntimeMs / 1000)}s`);
          downtimeStartTime = null;
        }
      }
    }
  }, 5000); // Check every 5 seconds (more frequent for accuracy)
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

// Auto-connect to tunnel on server startup
async function autoConnectTunnel() {
  const db = getDb();
  const tunnel = db.prepare("SELECT * FROM tunnels ORDER BY id DESC LIMIT 1").get();

  if (!tunnel) {
    console.log("[AutoConnect] No tunnel configured, skipping auto-connect");
    return;
  }

  // Check if systemd service is available and running (Linux)
  if (process.platform === 'linux') {
    try {
      const { stdout } = await execPromise('systemctl is-active cloudflared');
      const isActive = stdout.trim() === 'active';

      if (isActive) {
        console.log("[AutoConnect] Systemd service is already running");
        return;
      }

      // Try to start systemd service
      console.log("[AutoConnect] Starting systemd service...");
      await execPromise('sudo systemctl start cloudflared');
      console.log("[AutoConnect] Systemd service started");
      return;
    } catch (e) {
      console.log("[AutoConnect] Systemd service not available or failed:", e.message);
    }
  }

  // Fallback to process-based tunnel
  if (tunnelProcess && !tunnelProcess.killed) {
    console.log("[AutoConnect] Tunnel process is already running");
    return;
  }

  console.log("[AutoConnect] Starting tunnel process...");
  const result = await startTunnel(false);

  if (result.success) {
    console.log("[AutoConnect] Tunnel process started");

    // Wait for tunnel to be ready
    console.log("[AutoConnect] Waiting for tunnel to be ready...");
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${METRICS_URL}/ready`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          ready = true;
          currentReadyState = true;
          console.log("[AutoConnect] Tunnel is ready!");
          break;
        }
      } catch (e) {
        // Not ready yet
      }
    }

    if (!ready) {
      console.log("[AutoConnect] Warning: Tunnel did not become ready after 30 seconds");
    }
  } else {
    console.log("[AutoConnect] Failed to start tunnel:", result.message);
  }
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

// Systemd continuous monitoring
let systemdMonitorInterval = null;
let systemdLastActive = true; // Track previous state for change detection

// Start systemd monitoring for accurate downtime tracking
function startSystemdMonitor() {
  if (process.platform !== 'linux' || systemdMonitorInterval) {
    return;
  }

  // Check every 5 seconds for accuracy
  systemdMonitorInterval = setInterval(async () => {
    try {
      const { stdout } = await execPromise('systemctl is-active cloudflared');
      const isActive = stdout.trim() === 'active';

      // Track downtime changes
      if (!isActive && systemdLastActive) {
        // Service just went down
        if (!downtimeStartTime) {
          downtimeStartTime = Date.now();
          console.log(`⏱️ Systemd downtime started at ${new Date(downtimeStartTime).toISOString()}`);
        }
      } else if (isActive && !systemdLastActive) {
        // Service just came back up
        if (downtimeStartTime) {
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
          console.log(`⏱️ Systemd downtime ended. Duration: ${Math.floor(duration / 1000)}s`);
          downtimeStartTime = null;
        }
      }

      systemdLastActive = isActive;
    } catch (e) {
      // Service doesn't exist, ignore
    }
  }, 5000);
}

function stopSystemdMonitor() {
  if (systemdMonitorInterval) {
    clearInterval(systemdMonitorInterval);
    systemdMonitorInterval = null;
  }
}

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

    // Start monitoring if not already running
    if (!systemdMonitorInterval) {
      startSystemdMonitor();
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
        isDown: downtimeStartTime !== null,
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
  autoConnectTunnel,
  getTunnelMetrics,
  // Systemd functions
  getSystemdStatus,
  restartSystemdService,
  stopSystemdService,
  startSystemdService,
  setSystemdProtocol,
  stopSystemdMonitor
};

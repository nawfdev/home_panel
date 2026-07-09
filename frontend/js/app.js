const API = "/api";
let refreshInterval;
let systemRefreshInterval;
let networkRefreshInterval;
let tunnelRefreshInterval;

// Helper function to format duration in seconds to human readable
function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

// Helper function to open terminal with a command ready to run
function openTerminalWithCommand(command) {
  // Navigate to terminal page
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelector('[data-page="terminal"]').classList.add('active');
  document.getElementById('page-terminal').classList.remove('hidden');

  // Load terminal and send command after a short delay
  if (typeof loadTerminalPage === 'function') {
    loadTerminalPage();
    setTimeout(() => {
      if (typeof sendToTerminal === 'function') {
        sendToTerminal(command);
      }
    }, 1000);
  }

  alert(`Command ready in terminal. Press Enter to run:\n\n${command}`);
}
async function api(endpoint, options = {}) {
  const res = await fetch(`${API}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    },
    credentials: "include"
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function checkAuth() {
  try {
    await api("/auth/me");
    showPanel();
    loadDashboard();
    loadGraphs(); // Load graphs on dashboard
  } catch {
    // Try auto-login with saved credentials
    const saved = localStorage.getItem('hp_auth');
    if (saved) {
      try {
        const { username, password } = JSON.parse(saved);
        await api("/auth/login", {
          method: "POST",
          body: JSON.stringify({ username, password })
        });
        showPanel();
        loadDashboard();
        loadGraphs();
        return;
      } catch {
        localStorage.removeItem('hp_auth');
      }
    }
    showLogin();
  }
}

function showLogin() {
  document.getElementById("login-page").classList.remove("hidden");
  document.getElementById("main-panel").classList.add("hidden");
  if (refreshInterval) clearInterval(refreshInterval);
  if (systemRefreshInterval) clearInterval(systemRefreshInterval);
  if (networkRefreshInterval) clearInterval(networkRefreshInterval);
  if (tunnelRefreshInterval) clearInterval(tunnelRefreshInterval);
}

function showPanel() {
  document.getElementById("login-page").classList.add("hidden");
  document.getElementById("main-panel").classList.remove("hidden");
  refreshInterval = setInterval(loadDashboard, 10000);
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  const rememberMe = document.getElementById("remember-me").checked;
  const errorEl = document.getElementById("login-error");

  try {
    await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });

    // Save credentials if remember me is checked
    if (rememberMe) {
      localStorage.setItem('hp_auth', JSON.stringify({ username, password }));
    } else {
      localStorage.removeItem('hp_auth');
    }

    errorEl.classList.add("hidden");
    showPanel();
    loadDashboard();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  localStorage.removeItem('hp_auth'); // Clear saved credentials
  await api("/auth/logout", { method: "POST" });
  showLogin();
});

// Mobile Sidebar Toggle
function toggleSidebar(show) {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");

  if (show) {
    sidebar.classList.remove("-translate-x-full");
    overlay.classList.remove("hidden");
  } else {
    sidebar.classList.add("-translate-x-full");
    overlay.classList.add("hidden");
  }
}

document.getElementById("hamburger-btn")?.addEventListener("click", () => toggleSidebar(true));
document.getElementById("close-sidebar-btn")?.addEventListener("click", () => toggleSidebar(false));
document.getElementById("sidebar-overlay")?.addEventListener("click", () => toggleSidebar(false));

// Close sidebar when nav link clicked on mobile
document.querySelectorAll(".nav-link").forEach(link => {
  link.addEventListener("click", () => {
    if (window.innerWidth < 768) toggleSidebar(false);
  });
});

document.querySelectorAll(".nav-link").forEach(link => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const page = link.dataset.page;
    document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
    link.classList.add("active");
    document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
    document.getElementById(`page-${page}`).classList.remove("hidden");

    // Clear intervals
    if (systemRefreshInterval) clearInterval(systemRefreshInterval);
    if (networkRefreshInterval) clearInterval(networkRefreshInterval);
    if (tunnelRefreshInterval) clearInterval(tunnelRefreshInterval);

    // Initial load
    if (page === 'dashboard') loadDashboard();

    switch (page) {
      case 'tunnel':
        loadTunnelPage();
        tunnelRefreshInterval = setInterval(loadTunnelPage, 2000);
        break;
      case 'cloudflare': loadCloudflarePage(); break;
      case 'telegram': loadTelegramPage(); break;
      case 'projects': loadProjects(); break;
      case 'system':
        loadSystemPage();
        systemRefreshInterval = setInterval(loadSystemPage, 5000);
        break;
      case 'network':
        loadNetworkPage();
        networkRefreshInterval = setInterval(loadNetworkPage, 10000);
        break;
      case 'docker': loadDockerPage(); break;
      case 'pm2': loadPm2Page(); break;
      case 'logs': loadLogsPage(); break;
      case 'services': loadServicesPage(); break;
      case 'files': loadFilesPage(); break;
      case 'terminal': loadTerminalPage(); break;
      case 'settings':
        // Load settings data when navigating to settings page
        if (typeof loadCfSettings === 'function') loadCfSettings();
        if (typeof loadTelegramSettings === 'function') loadTelegramSettings();
        if (typeof loadServicePaths === 'function') loadServicePaths();
        break;
    }
  });
});

async function loadDashboard() {
  try {
    const data = await api("/dashboard");

    document.getElementById("cpu-usage").textContent = `${data.system.cpu.usage}%`;
    document.getElementById("cpu-bar").style.width = `${data.system.cpu.usage}%`;

    document.getElementById("mem-usage").textContent = `${data.system.memory.usagePercent}%`;
    document.getElementById("mem-bar").style.width = `${data.system.memory.usagePercent}%`;

    // Tunnel Status - show Cloudflare API info if available
    const tunnelEl = document.getElementById("tunnel-status");
    const tunnelDetail = document.getElementById("tunnel-detail");
    const tunnelIcon = document.getElementById("tunnel-icon");
    const tunnelAutoRestart = document.getElementById("tunnel-auto-restart");

    if (data.tunnel.apiConnected && data.tunnel.tunnels) {
      // Cloudflare API connected - show real status
      const healthy = data.tunnel.healthyCount || 0;
      const total = data.tunnel.totalCount || 0;
      tunnelEl.textContent = `${healthy}/${total} Healthy`;
      tunnelEl.className = `text-2xl font-bold ${healthy > 0 ? "text-green-500" : "text-red-500"}`;
      tunnelIcon.className = `fas fa-wifi text-3xl ${healthy > 0 ? "text-green-500" : "text-red-500"}`;
      tunnelDetail.textContent = healthy > 0 ? "All tunnels healthy" : "Tunnels need attention";
    } else {
      // Debounce: Only update dashboard tunnel status when isReady state is stable
      const statusKey = `${data.tunnel.processRunning}-${data.tunnel.isReady}`;
      if (!window._tunnelDashboardHistory) window._tunnelDashboardHistory = [];
      window._tunnelDashboardHistory.push(statusKey);
      if (window._tunnelDashboardHistory.length > MAX_TUNNEL_HISTORY) {
        window._tunnelDashboardHistory.shift();
      }

      const isStable = window._tunnelDashboardHistory.length === MAX_TUNNEL_HISTORY &&
        window._tunnelDashboardHistory.every(s => s === statusKey);

      if (!isStable && window._tunnelDashboardHistory.length === MAX_TUNNEL_HISTORY) {
        console.log("[Dashboard] Tunnel status unstable, skipping update");
        // Update other stats but skip tunnel
      } else {
        // Fallback to local cloudflared process status
        const isRunning = data.tunnel.processRunning;
        const isReady = data.tunnel.isReady;

        tunnelEl.textContent = isRunning && isReady ? "Online" : (isRunning ? "Starting..." : "Offline");
        tunnelEl.className = `text-2xl font-bold ${isRunning && isReady ? "text-green-500" : (isRunning ? "text-yellow-500" : "text-red-500")}`;
        tunnelIcon.className = `fas fa-wifi text-3xl ${isRunning && isReady ? "text-green-500" : (isRunning ? "text-yellow-500" : "text-red-500")}`;

        // Show downtime info
        if (data.tunnel.downtime && data.tunnel.downtime.isDown) {
          const downtimeSec = data.tunnel.downtime.currentDowntimeSec;
          tunnelDetail.textContent = `Down: ${formatDuration(downtimeSec)}`;
          tunnelDetail.className = "text-xs mt-1 text-red-400";
        } else if (isRunning && isReady) {
          tunnelDetail.textContent = "Tunnel is online";
          tunnelDetail.className = "text-xs mt-1 text-green-400";
        } else if (isRunning) {
          tunnelDetail.textContent = "Tunnel is starting...";
          tunnelDetail.className = "text-xs mt-1 text-yellow-400";
        } else {
          tunnelDetail.textContent = "Tunnel not running";
          tunnelDetail.className = "text-xs mt-1 text-red-400";
        }
      }
    }

    // Auto-restart indicator
    if (data.tunnel.autoRestart !== undefined) {
      tunnelAutoRestart.textContent = data.tunnel.autoRestart ? "⟳ Auto" : "";
      tunnelAutoRestart.className = "text-xs mt-1 text-blue-400";
    }

    document.getElementById("running-projects").textContent = data.projects.running;
    document.getElementById("total-projects").textContent = data.projects.total;

    // Temperature display
    if (data.temperature && data.temperature.available && data.temperature.main) {
      const temp = Math.round(data.temperature.main);
      document.getElementById("cpu-temp").textContent = `${temp}°C`;

      // Color code based on temperature
      const tempEl = document.getElementById("cpu-temp");
      const statusEl = document.getElementById("temp-status");

      if (temp < 50) {
        tempEl.className = "text-2xl font-bold text-green-400";
        statusEl.textContent = "Normal";
        statusEl.className = "mt-2 text-xs text-green-400";
      } else if (temp < 70) {
        tempEl.className = "text-2xl font-bold text-yellow-400";
        statusEl.textContent = "Warm";
        statusEl.className = "mt-2 text-xs text-yellow-400";
      } else if (temp < 85) {
        tempEl.className = "text-2xl font-bold text-orange-400";
        statusEl.textContent = "Hot";
        statusEl.className = "mt-2 text-xs text-orange-400";
      } else {
        tempEl.className = "text-2xl font-bold text-red-400";
        statusEl.textContent = "Critical!";
        statusEl.className = "mt-2 text-xs text-red-400";
      }
    } else {
      document.getElementById("cpu-temp").textContent = "N/A";
      document.getElementById("temp-status").textContent = "Not available";
      document.getElementById("temp-status").className = "mt-2 text-xs text-gray-500";
    }

    // Power/Battery display
    if (data.system.battery) {
      const battery = data.system.battery;
      const powerIcon = document.getElementById("power-icon");

      if (battery.hasBattery) {
        document.getElementById("power-status").textContent = `${battery.percent}%`;

        if (battery.isCharging) {
          document.getElementById("battery-info").textContent = "Charging";
          document.getElementById("battery-info").className = "mt-2 text-xs text-green-400";
          powerIcon.className = "fas fa-battery-three-quarters text-3xl text-green-500";
        } else if (battery.acConnected) {
          document.getElementById("battery-info").textContent = "AC Connected";
          document.getElementById("battery-info").className = "mt-2 text-xs text-blue-400";
          powerIcon.className = "fas fa-plug text-3xl text-blue-500";
        } else {
          document.getElementById("battery-info").textContent = "On Battery";
          document.getElementById("battery-info").className = "mt-2 text-xs text-yellow-400";
          powerIcon.className = "fas fa-battery-half text-3xl text-yellow-500";
        }
      } else {
        // Desktop - no battery
        document.getElementById("power-status").textContent = "AC";
        document.getElementById("battery-info").textContent = "Desktop Mode";
        document.getElementById("battery-info").className = "mt-2 text-xs text-gray-400";
        powerIcon.className = "fas fa-plug text-3xl text-blue-500";
      }
    }

    // Uptime display
    if (data.system.uptime) {
      const uptimeSec = data.system.uptime;
      const days = Math.floor(uptimeSec / 86400);
      const hours = Math.floor((uptimeSec % 86400) / 3600);
      const minutes = Math.floor((uptimeSec % 3600) / 60);
      document.getElementById("system-uptime").textContent = `${days}d ${hours}h ${minutes}m`;

      // Calculate boot time
      const bootTime = new Date(Date.now() - uptimeSec * 1000);
      document.getElementById("uptime-since").textContent = `Since ${bootTime.toLocaleDateString()} ${bootTime.toLocaleTimeString()}`;
    }

    document.getElementById("system-info").innerHTML = `
      <p><span class="text-gray-400">OS:</span> ${data.system.os.distro} ${data.system.os.release}</p>
      <p><span class="text-gray-400">Hostname:</span> ${data.system.os.hostname}</p>
      <p><span class="text-gray-400">Platform:</span> ${data.system.os.platform}</p>
      <p><span class="text-gray-400">Architecture:</span> ${data.system.os.arch}</p>
      <p><span class="text-gray-400">Uptime:</span> ${formatUptime(data.system.uptime)}</p>
      <p><span class="text-gray-400">CPU Cores:</span> ${data.system.cpu.cores}</p>
    `;

    document.getElementById("disk-info").innerHTML = data.system.disk.map(d => {
      // Truncate long mount paths for mobile display
      const mountDisplay = d.mount.length > 15 ? d.mount.slice(-12) + '...' : d.mount;
      const usagePercent = Math.round(d.usagePercent || 0);

      return `
        <div class="mb-3">
          <div class="flex flex-col sm:flex-row sm:justify-between text-sm mb-1 gap-1">
            <span class="text-gray-300 truncate" title="${d.mount}">${mountDisplay}</span>
            <span class="text-gray-400 text-xs sm:text-sm">${formatBytes(d.used)} / ${formatBytes(d.size)} (${usagePercent}%)</span>
          </div>
          <div class="bg-gray-700 rounded-full h-2">
            <div class="h-2 rounded-full ${usagePercent > 90 ? 'bg-red-500' : usagePercent > 70 ? 'bg-yellow-500' : 'bg-orange-500'}" style="width: ${usagePercent}%"></div>
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error("Dashboard error:", err);
  }
}

// Tunnel status history for debouncing (prevent flickering)
let tunnelStatusHistory = [];
const MAX_TUNNEL_HISTORY = 3;
let metricsInterval = null;

// Switch tunnel tabs
function switchTunnelTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.tunnel-tab-btn').forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.classList.remove('bg-gray-700', 'text-gray-400', 'hover:bg-gray-600');
      btn.classList.add('bg-blue-600', 'text-white');
    } else {
      btn.classList.add('bg-gray-700', 'text-gray-400', 'hover:bg-gray-600');
      btn.classList.remove('bg-blue-600', 'text-white');
    }
  });

  // Show/hide tab content
  document.querySelectorAll('.tunnel-tab-content').forEach(content => {
    content.classList.add('hidden');
  });
  document.getElementById(`tunnel-tab-${tabName}`).classList.remove('hidden');

  // Load content based on tab
  if (tabName === 'metrics') {
    refreshTunnelMetrics();
    if (metricsInterval) clearInterval(metricsInterval);
    metricsInterval = setInterval(refreshTunnelMetrics, 5000);
  } else {
    if (metricsInterval) clearInterval(metricsInterval);
  }

  if (tabName === 'logs') {
    loadTunnelLogs();
  }

  if (tabName === 'settings') {
    loadAutoRestartStatus();
    loadTunnelConfigInfo();
  }
}

async function refreshTunnelMetrics() {
  try {
    const data = await api("/tunnel/metrics");

    if (data.success && data.metrics) {
      const m = data.metrics;

      // Update status metrics
      document.getElementById('tunnel-connections').textContent = m.activeConnections || 0;
      document.getElementById('tunnel-requests').textContent = formatNumber(m.requests || 0);
      document.getElementById('tunnel-errors').textContent = formatNumber(m.errors || 0);

      // Update metrics tab
      document.getElementById('metrics-total-connections').textContent = formatNumber(m.connections || 0);
      document.getElementById('metrics-total-requests').textContent = formatNumber(m.requests || 0);
      document.getElementById('metrics-total-errors').textContent = formatNumber(m.errors || 0);

      // Calculate error rate
      const errorRate = m.requests > 0 ? ((m.errors / m.requests) * 100).toFixed(2) : 0;
      document.getElementById('metrics-error-rate').textContent = `${errorRate}%`;
      document.getElementById('metrics-error-rate').className = `text-lg font-bold ${errorRate > 5 ? 'text-red-400' : errorRate > 1 ? 'text-yellow-400' : 'text-green-400'}`;

      // Bandwidth
      document.getElementById('tunnel-bytes-in').textContent = formatBytes(m.bytesIn || 0);
      document.getElementById('tunnel-bytes-out').textContent = formatBytes(m.bytesOut || 0);

      // Uptime
      document.getElementById('metrics-uptime').textContent = formatDuration(m.uptime || 0);

      // Last update
      document.getElementById('metrics-last-update').textContent = new Date().toLocaleTimeString();

      // Update regions
      const regionsEl = document.getElementById('tunnel-regions');
      if (Object.keys(m.connectionsPerRegion || {}).length > 0) {
        regionsEl.innerHTML = Object.entries(m.connectionsPerRegion).map(([region, count]) => `
          <div class="bg-gray-700 rounded p-3">
            <p class="font-bold text-sm">${region}</p>
            <p class="text-lg text-green-400">${count}</p>
            <p class="text-xs text-gray-400">connections</p>
          </div>
        `).join('');
      } else {
        regionsEl.innerHTML = '<p class="text-gray-400 text-sm col-span-4">No active connections yet</p>';
      }
    } else {
      document.getElementById('tunnel-connections').textContent = 'N/A';
      document.getElementById('tunnel-requests').textContent = 'N/A';
      document.getElementById('tunnel-errors').textContent = 'N/A';
    }
  } catch (err) {
    console.error("Metrics error:", err);
  }
}

async function loadTunnelLogs() {
  const limit = document.getElementById('log-limit')?.value || 50;
  const logsEl = document.getElementById('tunnel-logs');

  try {
    const data = await api(`/tunnel/logs?limit=${limit}`);

    if (data.success && data.logs) {
      if (data.logs.length === 0) {
        logsEl.innerHTML = '<p class="text-gray-400">No logs available</p>';
        return;
      }

      logsEl.innerHTML = data.logs.map(log => {
        let colorClass = 'text-gray-400';
        if (log.priority === '3' || log.priority === 'err') colorClass = 'text-red-400';
        else if (log.priority === '4' || log.priority === 'warning') colorClass = 'text-yellow-400';
        else if (log.priority === '6' || log.priority === 'info') colorClass = 'text-blue-400';

        const time = new Date(log.timestamp).toLocaleTimeString();

        return `<div class="${colorClass} mb-1">
          <span class="text-gray-500">[${time}]</span>
          ${log.message || log.MESSAGE || ''}
        </div>`;
      }).join('');
    } else {
      logsEl.innerHTML = '<p class="text-red-400">Failed to load logs</p>';
    }
  } catch (err) {
    console.error("Logs error:", err);
    logsEl.innerHTML = `<p class="text-red-400">Error: ${err.message}</p>`;
  }
}

async function loadTunnelConfigInfo() {
  const infoEl = document.getElementById('tunnel-config-info');

  try {
    const data = await api("/tunnel/status");

    let html = '';

    // Systemd tunnel info
    const systemdStatus = await api("/tunnel/systemd/status").catch(() => ({ available: false }));

    if (systemdStatus.available) {
      html += `
        <div class="grid grid-cols-2 gap-2 mb-4">
          <div>
            <span class="text-gray-400">Type:</span>
            <span class="text-green-400 font-bold">Systemd Service</span>
          </div>
          <div>
            <span class="text-gray-400">Status:</span>
            <span class="${systemdStatus.active ? 'text-green-400' : 'text-red-400'}">${systemdStatus.active ? 'Running' : 'Stopped'}</span>
          </div>
          <div>
            <span class="text-gray-400">PID:</span>
            <span>${systemdStatus.pid || 'N/A'}</span>
          </div>
          <div>
            <span class="text-gray-400">Protocol:</span>
            <span class="text-blue-400 font-bold">${systemdStatus.protocol || 'auto'}</span>
          </div>
        </div>
        ${systemdStatus.startTime ? `
          <div class="bg-gray-700 rounded p-3">
            <p class="text-gray-400 text-sm">Started: <span class="text-white">${systemdStatus.startTime}</span></p>
          </div>
        ` : ''}
      `;
    }

    // Local process tunnel info
    if (data.tunnel && !systemdStatus.available) {
      html += `
        <div class="grid grid-cols-2 gap-2 mb-4">
          <div>
            <span class="text-gray-400">Type:</span>
            <span class="text-blue-400 font-bold">Local Process</span>
          </div>
          <div>
            <span class="text-gray-400">Status:</span>
            <span class="${data.isReady ? 'text-green-400' : (data.processRunning ? 'text-yellow-400' : 'text-red-400')}">
              ${data.isReady ? 'Connected' : (data.processRunning ? 'Starting' : 'Stopped')}
            </span>
          </div>
          ${data.tunnel.name ? `
            <div>
              <span class="text-gray-400">Name:</span>
              <span>${data.tunnel.name}</span>
            </div>
          ` : ''}
          ${data.tunnel.tunnel_id ? `
            <div>
              <span class="text-gray-400">Tunnel ID:</span>
              <code class="text-xs bg-gray-800 px-1 rounded">${data.tunnel.tunnel_id}</code>
            </div>
          ` : ''}
          ${data.tunnel.domain ? `
            <div>
              <span class="text-gray-400">Domain:</span>
              <code class="text-xs bg-gray-800 px-1 rounded">${data.tunnel.domain}</code>
            </div>
          ` : ''}
          ${data.tunnel.local_port ? `
            <div>
              <span class="text-gray-400">Local Port:</span>
              <span>${data.tunnel.local_port}</span>
            </div>
          ` : ''}
        </div>
      `;
    }

    // Auto-restart info
    html += `
      <div class="bg-gray-700 rounded p-3">
        <p class="text-gray-400 text-sm">Auto-Restart: <span class="${data.autoRestart ? 'text-green-400' : 'text-red-400'}">${data.autoRestart ? 'Enabled' : 'Disabled'}</span></p>
        ${data.restartCount > 0 ? `<p class="text-xs text-gray-500 mt-1">Restart attempts this session: ${data.restartCount}</p>` : ''}
      </div>
    `;

    // Cloudflared binary info
    if (data.cloudflared && data.cloudflared.installed) {
      html += `
        <div class="bg-gray-700 rounded p-3 mt-2">
          <p class="text-gray-400 text-sm">Cloudflared Version: <span class="text-white">${data.cloudflared.version}</span></p>
        </div>
      `;
    }

    // Metrics endpoint info
    html += `
      <div class="bg-gray-700 rounded p-3 mt-2">
        <p class="text-gray-400 text-sm">Metrics Endpoint: <code class="text-xs bg-gray-800 px-1 rounded">http://127.0.0.1:36500</code></p>
      </div>
    `;

    infoEl.innerHTML = html || '<p class="text-gray-400">No tunnel configuration found</p>';
  } catch (err) {
    console.error("Config info error:", err);
    infoEl.innerHTML = `<p class="text-red-400">Error: ${err.message}</p>`;
  }
}

async function loadAutoRestartStatus() {
  const btn = document.getElementById('toggle-autorestart-btn');

  try {
    const data = await api("/tunnel/status");
    const isEnabled = data.autoRestart !== false;

    btn.textContent = isEnabled ? 'Enabled' : 'Disabled';
    btn.className = `px-4 py-2 rounded transition ${isEnabled ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`;
  } catch (err) {
    btn.textContent = 'Error';
  }
}

async function loadTunnelConfigInfo() {
  const infoEl = document.getElementById('tunnel-config-info');

  try {
    const data = await api("/tunnel/status");

    let html = '';

    // Systemd tunnel info
    const systemdStatus = await api("/tunnel/systemd/status").catch(() => ({ available: false }));

    if (systemdStatus.available) {
      html += `
        <div class="grid grid-cols-2 gap-2 mb-4">
          <div>
            <span class="text-gray-400">Type:</span>
            <span class="text-green-400 font-bold">Systemd Service</span>
          </div>
          <div>
            <span class="text-gray-400">Status:</span>
            <span class="${systemdStatus.active ? 'text-green-400' : 'text-red-400'}">${systemdStatus.active ? 'Running' : 'Stopped'}</span>
          </div>
          <div>
            <span class="text-gray-400">PID:</span>
            <span>${systemdStatus.pid || 'N/A'}</span>
          </div>
          <div>
            <span class="text-gray-400">Protocol:</span>
            <span class="text-blue-400 font-bold">${systemdStatus.protocol || 'auto'}</span>
          </div>
        </div>
        ${systemdStatus.startTime ? `
          <div class="bg-gray-700 rounded p-3">
            <p class="text-gray-400 text-sm">Started: <span class="text-white">${systemdStatus.startTime}</span></p>
          </div>
        ` : ''}
      `;
    }

    // Local process tunnel info
    if (data.tunnel && !systemdStatus.available) {
      html += `
        <div class="grid grid-cols-2 gap-2 mb-4">
          <div>
            <span class="text-gray-400">Type:</span>
            <span class="text-blue-400 font-bold">Local Process</span>
          </div>
          <div>
            <span class="text-gray-400">Status:</span>
            <span class="${data.isReady ? 'text-green-400' : (data.processRunning ? 'text-yellow-400' : 'text-red-400')}">
              ${data.isReady ? 'Connected' : (data.processRunning ? 'Starting' : 'Stopped')}
            </span>
          </div>
          ${data.tunnel.name ? `
            <div>
              <span class="text-gray-400">Name:</span>
              <span>${data.tunnel.name}</span>
            </div>
          ` : ''}
          ${data.tunnel.tunnel_id ? `
            <div>
              <span class="text-gray-400">Tunnel ID:</span>
              <code class="text-xs bg-gray-800 px-1 rounded">${data.tunnel.tunnel_id}</code>
            </div>
          ` : ''}
          ${data.tunnel.domain ? `
            <div>
              <span class="text-gray-400">Domain:</span>
              <code class="text-xs bg-gray-800 px-1 rounded">${data.tunnel.domain}</code>
            </div>
          ` : ''}
          ${data.tunnel.local_port ? `
            <div>
              <span class="text-gray-400">Local Port:</span>
              <span>${data.tunnel.local_port}</span>
            </div>
          ` : ''}
        </div>
      `;
    }

    // Auto-restart info
    html += `
      <div class="bg-gray-700 rounded p-3">
        <p class="text-gray-400 text-sm">Auto-Restart: <span class="${data.autoRestart ? 'text-green-400' : 'text-red-400'}">${data.autoRestart ? 'Enabled' : 'Disabled'}</span></p>
        ${data.restartCount > 0 ? `<p class="text-xs text-gray-500 mt-1">Restart attempts this session: ${data.restartCount}</p>` : ''}
      </div>
    `;

    // Cloudflared binary info
    if (data.cloudflared && data.cloudflared.installed) {
      html += `
        <div class="bg-gray-700 rounded p-3 mt-2">
          <p class="text-gray-400 text-sm">Cloudflared Version: <span class="text-white">${data.cloudflared.version}</span></p>
        </div>
      `;
    }

    // Metrics endpoint info
    html += `
      <div class="bg-gray-700 rounded p-3 mt-2">
        <p class="text-gray-400 text-sm">Metrics Endpoint: <code class="text-xs bg-gray-800 px-1 rounded">http://127.0.0.1:36500</code></p>
      </div>
    `;

    infoEl.innerHTML = html || '<p class="text-gray-400">No tunnel configuration found</p>';
  } catch (err) {
    console.error("Config info error:", err);
    infoEl.innerHTML = `<p class="text-red-400">Error: ${err.message}</p>`;
  }
}

async function toggleAutoRestart() {
  try {
    const data = await api("/tunnel/status");
    const currentStatus = data.autoRestart !== false;
    const newStatus = !currentStatus;

    await api("/tunnel/set-autorestart", {
      method: "POST",
      body: JSON.stringify({ enabled: newStatus })
    });

    await loadAutoRestartStatus();
    alert(`Auto-restart ${newStatus ? 'enabled' : 'disabled'}`);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

async function loadTunnelPage() {
  try {
    // First check if systemd service is available (Linux)
    const systemdStatus = await api("/tunnel/systemd/status").catch(() => ({ available: false }));

    if (systemdStatus.available) {
      // Show systemd-based tunnel UI
      document.getElementById("cloudflared-version").textContent = "Running via Systemd";

      const statusColor = systemdStatus.active ? 'green' : 'red';
      const statusText = systemdStatus.active ? 'Active (Running)' : 'Stopped';

      // Debounce: Only update UI if status is stable for 3 consecutive checks
      tunnelStatusHistory.push(systemdStatus.active);
      if (tunnelStatusHistory.length > MAX_TUNNEL_HISTORY) {
        tunnelStatusHistory.shift();
      }

      const isStable = tunnelStatusHistory.length === MAX_TUNNEL_HISTORY &&
        tunnelStatusHistory.every(status => status === systemdStatus.active);

      if (!isStable && tunnelStatusHistory.length === MAX_TUNNEL_HISTORY) {
        console.log("[Tunnel] Status unstable, skipping UI update");
        return;
      }

      // Build downtime info HTML
      let downtimeHtml = '';
      if (systemdStatus.downtime) {
        const dt = systemdStatus.downtime;
        const downtimeCard = document.getElementById('tunnel-downtime-card');
        const downtimeInfo = document.getElementById('tunnel-downtime-info');

        // Show downtime card if there's info
        if (downtimeCard) downtimeCard.style.display = 'block';

        downtimeHtml = `
          <div class="grid grid-cols-2 gap-4 mb-4">
            <div>
              <span class="text-gray-400">Current Status:</span>
              <span class="${dt.isDown ? 'text-red-400 font-bold' : 'text-green-400 font-bold'}">${dt.isDown ? 'DOWN' : 'ONLINE'}</span>
            </div>
            <div>
              <span class="text-gray-400">Current Downtime:</span>
              <span class="${dt.isDown ? 'text-red-400' : 'text-green-400'}">${dt.isDown ? formatDuration(dt.currentDowntimeSec) : 'None'}</span>
            </div>
            <div>
              <span class="text-gray-400">Total (Session):</span>
              <span class="text-yellow-400">${formatDuration(dt.totalDowntimeSec)}</span>
            </div>
            <div>
              <span class="text-gray-400">Events Count:</span>
              <span class="text-blue-400">${dt.history ? dt.history.length : 0}</span>
            </div>
          </div>
        `;

        if (dt.history && dt.history.length > 0) {
          downtimeHtml += `
            <div class="border-t border-gray-600 pt-3 mt-3">
              <h6 class="font-bold text-sm mb-2">Recent Downtime Events:</h6>
              <div class="space-y-2 max-h-[200px] overflow-y-auto">
                ${dt.history.slice(-10).reverse().map(h => `
                  <div class="bg-gray-800 rounded p-2 text-sm">
                    <div class="flex justify-between items-center mb-1">
                      <span class="text-gray-400">${new Date(h.start).toLocaleString()}</span>
                      <span class="text-red-400 font-bold">${formatDuration(h.durationSec)}</span>
                    </div>
                    <p class="text-xs text-gray-500">Duration: ${Math.floor(h.durationMs / 1000)} seconds</p>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }

        if (downtimeInfo) {
          downtimeInfo.innerHTML = downtimeHtml;
        }
      }

      document.getElementById("tunnel-info").innerHTML = `
        <div class="bg-gray-700 rounded-lg p-4 mb-4">
          <div class="flex items-center justify-between mb-3">
            <h4 class="font-bold text-blue-400"><i class="fas fa-cog mr-2"></i>Systemd Service</h4>
            <span class="px-3 py-1 rounded text-xs font-bold ${systemdStatus.active ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}">
              ${statusText}
            </span>
          </div>
          <p><span class="text-gray-400">Status:</span> ${systemdStatus.state} (${systemdStatus.subState})</p>
          <p><span class="text-gray-400">PID:</span> ${systemdStatus.pid || 'N/A'}</p>
          <p><span class="text-gray-400">Protocol:</span> <strong class="text-blue-400">${systemdStatus.protocol || 'auto'}</strong></p>
          ${systemdStatus.startTime ? `<p><span class="text-gray-400">Started:</span> ${systemdStatus.startTime}</p>` : ''}
        </div>

        <!-- Controls -->
        <div class="flex flex-wrap gap-2 mb-4">
          ${systemdStatus.active ? `
            <button onclick="systemdAction('restart')" class="bg-yellow-600 hover:bg-yellow-700 px-4 py-2 rounded transition">
              <i class="fas fa-redo mr-2"></i>Restart
            </button>
            <button onclick="systemdAction('stop')" class="bg-red-600 hover:bg-red-700 px-4 py-2 rounded transition">
              <i class="fas fa-stop mr-2"></i>Stop
            </button>
          ` : `
            <button onclick="systemdAction('start')" class="bg-green-600 hover:bg-green-700 px-4 py-2 rounded transition">
              <i class="fas fa-play mr-2"></i>Start
            </button>
          `}
        </div>

        <!-- Protocol Selector -->
        <div class="bg-gray-700 rounded-lg p-4">
          <h5 class="font-bold mb-2 text-sm">Change Protocol</h5>
          <p class="text-xs text-gray-400 mb-3">HTTP2 is recommended if QUIC is blocked by your ISP.</p>
          <div class="flex gap-2">
            <button onclick="setTunnelProtocol('http2')" class="px-3 py-1 rounded text-sm ${systemdStatus.protocol === 'http2' ? 'bg-blue-600' : 'bg-gray-600 hover:bg-gray-500'}">HTTP/2</button>
            <button onclick="setTunnelProtocol('quic')" class="px-3 py-1 rounded text-sm ${systemdStatus.protocol === 'quic' ? 'bg-blue-600' : 'bg-gray-600 hover:bg-gray-500'}">QUIC</button>
            <button onclick="setTunnelProtocol('auto')" class="px-3 py-1 rounded text-sm ${systemdStatus.protocol === 'auto' ? 'bg-blue-600' : 'bg-gray-600 hover:bg-gray-500'}">Auto</button>
          </div>
        </div>

        ${downtimeHtml}
      `;

      // Update status badge
      const statusBadge = document.getElementById('tunnel-status-badge');
      if (statusBadge) {
        statusBadge.textContent = systemdStatus.active ? 'Online' : 'Offline';
        statusBadge.className = `text-xl font-bold ${systemdStatus.active ? 'text-green-400' : 'text-red-400'}`;
      }

      // Load metrics once
      refreshTunnelMetrics();
      return;
    }

    // Fallback: Original config.yml based tunnel status
    const data = await api("/tunnel/status");

    document.getElementById("cloudflared-version").textContent =
      data.cloudflared.installed ? data.cloudflared.version : "Not installed";

    let tunnelHtml = "";
    if (data.tunnel) {
      // Debounce: Track status for stability
      const statusKey = `${data.processRunning}-${data.isReady}-${data.autoRestart}-${data.nextRetryIn}`;
      tunnelStatusHistory.push(statusKey);
      if (tunnelStatusHistory.length > MAX_TUNNEL_HISTORY) {
        tunnelStatusHistory.shift();
      }

      const isStable = tunnelStatusHistory.length === MAX_TUNNEL_HISTORY &&
        tunnelStatusHistory.every(s => s === statusKey);

      if (!isStable && tunnelStatusHistory.length === MAX_TUNNEL_HISTORY) {
        console.log("[Tunnel] Status unstable, skipping UI update");
        return;
      }

      // Determine status display
      let statusHtml = '';
      if (data.processRunning) {
        if (data.isReady) {
          statusHtml = `<span class="status-badge status-online">Connected</span>`;
        } else {
          statusHtml = `<span class="status-badge bg-yellow-600 text-white animate-pulse">Starting...</span>`;
        }
      } else {
        if (data.autoRestart && data.nextRetryIn > 0) {
          statusHtml = `<span class="status-badge bg-orange-600 text-white">Reconnecting in ${data.nextRetryIn}s...</span>`;
        } else {
          statusHtml = `<span class="status-badge status-offline">Stopped</span>`;
        }
      }

      if (data.restartCount > 0) {
        statusHtml += `<div class="text-xs text-gray-400 mt-1">Restart attempts: ${data.restartCount}</div>`;
      }

      // Build downtime HTML for config.yml tunnel
      let downtimeHtml = '';
      if (data.downtime) {
        const dt = data.downtime;
        downtimeHtml = `
          <div class="mt-4 pt-4 border-t border-gray-600">
            <h5 class="font-bold mb-2 text-sm"><i class="fas fa-clock mr-2"></i>Downtime Tracking</h5>
            <div class="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span class="text-gray-400">Current:</span>
                <span class="${dt.isDown ? 'text-red-400 font-bold' : 'text-green-400'}">${dt.isDown ? formatDuration(dt.currentDowntimeSec) : 'Online'}</span>
              </div>
              <div>
                <span class="text-gray-400">Total (Session):</span>
                <span class="text-yellow-400">${formatDuration(dt.totalDowntimeSec)}</span>
              </div>
            </div>
            ${dt.history && dt.history.length > 0 ? `
              <div class="mt-2 text-xs text-gray-400">
                Recent: ${dt.history.slice(-3).reverse().map(h =>
          `${new Date(h.start).toLocaleTimeString()} (${formatDuration(h.durationSec)})`
        ).join(', ')}
              </div>
            ` : ''}
          </div>
        `;
      }

      tunnelHtml = `
        <p><span class="text-gray-400">Name:</span> ${data.tunnel.name || "N/A"}</p>
        <p><span class="text-gray-400">Tunnel ID:</span> ${data.tunnel.tunnel_id || "N/A"}</p>
        <p><span class="text-gray-400">Domain:</span> ${data.tunnel.domain || "Not configured"}</p>
        <p><span class="text-gray-400">Local Port:</span> ${data.tunnel.local_port || "N/A"}</p>
        <div class="mt-2">
           <span class="text-gray-400">Status:</span>
           ${statusHtml}
        </div>
        ${downtimeHtml}
      `;
    } else {
      tunnelHtml = "<p class=\"text-gray-400\">No tunnel configured. Create one below or use systemd service.</p>";
    }
    document.getElementById("tunnel-info").innerHTML = tunnelHtml;
  } catch (err) {
    console.error("Tunnel page error:", err);
  }
}

// Systemd control functions
async function systemdAction(action) {
  try {
    const result = await api(`/tunnel/systemd/${action}`, { method: "POST" });
    if (result.success) {
      alert(result.message);
    } else {
      alert("Error: " + result.error);
    }
    loadTunnelPage();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

async function setTunnelProtocol(protocol) {
  showConfirm(`Change protocol to ${protocol}? This will restart the tunnel.`, async () => {

    try {
      const result = await api("/tunnel/systemd/protocol", {
        method: "POST",
        body: JSON.stringify({ protocol })
      });
      if (result.success) {
        alert(result.message);
      } else {
        alert("Error: " + result.error);
      }
      loadTunnelPage();
    } catch (err) {
      alert("Error: " + err.message);
    }
  });
}
document.getElementById("start-tunnel-btn").addEventListener("click", async () => {
  try {
    const result = await api("/tunnel/start", { method: "POST" });
    alert(result.message);
    loadTunnelPage();
  } catch (err) {
    alert("Error: " + err.message);
  }
});

document.getElementById("stop-tunnel-btn").addEventListener("click", async () => {
  try {
    const result = await api("/tunnel/stop", { method: "POST" });
    alert(result.message);
    loadTunnelPage();
  } catch (err) {
    alert("Error: " + err.message);
  }
});

document.getElementById("create-tunnel-btn").addEventListener("click", async () => {
  const name = document.getElementById("tunnel-name").value;
  const domain = document.getElementById("tunnel-domain").value;
  const port = document.getElementById("tunnel-port").value;

  if (!name || !domain || !port) {
    alert("Please fill all fields");
    return;
  }

  try {
    const createResult = await api("/tunnel/create", {
      method: "POST",
      body: JSON.stringify({ name })
    });

    await api("/tunnel/configure", {
      method: "POST",
      body: JSON.stringify({ tunnelId: createResult.tunnelId, domain, localPort: parseInt(port) })
    });

    await api("/tunnel/route", {
      method: "POST",
      body: JSON.stringify({ tunnelId: createResult.tunnelId, domain })
    });

    alert("Tunnel created and configured successfully!");
    loadTunnelPage();
  } catch (err) {
    alert("Error: " + err.message);
  }
});

async function loadProjects() {
  try {
    const projects = await api("/projects");
    const container = document.getElementById("projects-list");

    if (projects.length === 0) {
      container.innerHTML = "<p class=\"text-gray-400\">No projects yet. Click Add Project to create one.</p>";
      return;
    }

    container.innerHTML = projects.map(p => `
      <div class="project-card">
        <div class="flex justify-between items-start mb-3">
          <div>
            <h4 class="font-bold">${p.name}</h4>
            <p class="text-gray-400 text-sm">${p.path}</p>
          </div>
          <span class="status-badge ${p.status === "running" ? "status-running" : "status-stopped"}">
            ${p.status}
          </span>
        </div>
        <div class="flex gap-2 text-sm text-gray-400 mb-3">
          <span><i class="fas fa-network-wired mr-1"></i>Port: ${p.port}</span>
          ${p.domain ? `<span><i class="fas fa-globe mr-1"></i>${p.domain}</span>` : ""}
        </div>
        <div class="flex gap-2">
          ${p.status === "running" ? `
            <button onclick="stopProject(${p.id})" class="bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-sm">
              <i class="fas fa-stop mr-1"></i>Stop
            </button>
            <button onclick="restartProject(${p.id})" class="bg-yellow-600 hover:bg-yellow-700 px-3 py-1 rounded text-sm">
              <i class="fas fa-redo mr-1"></i>Restart
            </button>
          ` : `
            <button onclick="startProject(${p.id})" class="bg-green-600 hover:bg-green-700 px-3 py-1 rounded text-sm">
              <i class="fas fa-play mr-1"></i>Start
            </button>
          `}
          <button onclick="deleteProject(${p.id})" class="bg-gray-600 hover:bg-gray-700 px-3 py-1 rounded text-sm">
            <i class="fas fa-trash mr-1"></i>Delete
          </button>
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error("Projects error:", err);
  }
}

async function startProject(id) {
  try {
    const result = await api(`/projects/${id}/start`, { method: "POST" });
    alert(result.message);
    loadProjects();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

async function stopProject(id) {
  try {
    const result = await api(`/projects/${id}/stop`, { method: "POST" });
    alert(result.message);
    loadProjects();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

async function restartProject(id) {
  try {
    const result = await api(`/projects/${id}/restart`, { method: "POST" });
    alert(result.message);
    loadProjects();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

async function deleteProject(id) {
  showConfirm("Are you sure you want to delete this project?", async () => {
    try {
      await api(`/projects/${id}`, { method: "DELETE" });
      loadProjects();
    } catch (err) {
      alert("Error: " + err.message);
    }
  });
}
document.getElementById("add-project-btn").addEventListener("click", () => {
  document.getElementById("project-modal").classList.remove("hidden");
  document.getElementById("project-modal").classList.add("flex");
});

document.getElementById("close-modal").addEventListener("click", () => {
  document.getElementById("project-modal").classList.add("hidden");
  document.getElementById("project-modal").classList.remove("flex");
});

document.getElementById("project-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("project-name").value;
  const path = document.getElementById("project-path").value;
  const port = document.getElementById("project-port").value;
  const domain = document.getElementById("project-domain").value;

  try {
    await api("/projects", {
      method: "POST",
      body: JSON.stringify({ name, path, port: parseInt(port), domain: domain || null })
    });
    document.getElementById("project-modal").classList.add("hidden");
    document.getElementById("project-form").reset();
    loadProjects();
  } catch (err) {
    alert("Error: " + err.message);
  }
});

async function loadSystemPage() {
  try {
    const [processes, stats] = await Promise.all([
      api("/system/processes"),
      api("/system/stats")
    ]);

    document.getElementById("process-list").innerHTML = processes.map(p => `
      <tr class="border-b border-gray-700">
        <td class="py-2">${p.pid}</td>
        <td class="py-2">${p.name}</td>
        <td class="py-2">${p.cpu}%</td>
        <td class="py-2">${p.mem}%</td>
        <td class="py-2">${p.state}</td>
      </tr>
    `).join("");

    document.getElementById("network-stats").innerHTML = stats.network.map(n => `
      <div class="bg-gray-700 rounded p-3">
        <h4 class="font-bold mb-2">${n.iface}</h4>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <p><span class="text-gray-400">RX:</span> ${formatBytes(n.rx_bytes)}</p>
          <p><span class="text-gray-400">TX:</span> ${formatBytes(n.tx_bytes)}</p>
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error("System page error:", err);
  }
}

document.getElementById("change-password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const currentPassword = document.getElementById("current-password").value;
  const newPassword = document.getElementById("new-password").value;

  try {
    await api("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword })
    });
    alert("Password changed successfully!");
    document.getElementById("change-password-form").reset();
  } catch (err) {
    alert("Error: " + err.message);
  }
});

async function loadNetworkPage() {
  // Add refresh button listener if not already added
  addNetworkRefreshListener();

  try {
    const data = await api("/network/info");

    // Public IP
    document.getElementById("public-ip").textContent = data.network.publicIp;

    // Connectivity status
    const connectivityEl = document.getElementById("connectivity-status");
    if (data.network.connectivity) {
      connectivityEl.innerHTML = `
        <i class="fas fa-circle text-green-500 mr-2"></i>
        <span class="text-green-400">Internet Connected</span>
      `;
    } else {
      connectivityEl.innerHTML = `
        <i class="fas fa-circle text-red-500 mr-2"></i>
        <span class="text-red-400">No Internet</span>
      `;
    }

    // Cloudflare Tunnel Info
    const cfInfo = document.getElementById("cloudflare-info");
    if (data.network.cloudflare) {
      const cf = data.network.cloudflare;
      cfInfo.innerHTML = `
        <div class="flex items-center justify-between p-3 bg-gray-700 rounded">
          <div>
            <p class="text-sm text-gray-400">Status</p>
            <p class="font-bold ${cf.status === 'running' ? 'text-green-400' : 'text-red-400'}">
              ${cf.status === 'running' ? '🟢 Running' : '🔴 Stopped'}
            </p>
          </div>
        </div>
        <div class="p-3 bg-gray-700 rounded">
          <p class="text-sm text-gray-400 mb-1">Domain</p>
          <p class="font-mono text-sm">${cf.domain || 'Not configured'}</p>
        </div>
        <div class="p-3 bg-gray-700 rounded">
          <p class="text-sm text-gray-400 mb-1">Tunnel ID</p>
          <p class="font-mono text-xs text-gray-300">${cf.tunnelId || 'N/A'}</p>
        </div>
      `;
    } else {
      cfInfo.innerHTML = `
        <p class="text-gray-400 text-sm">Tunnel belum dikonfigurasi</p>
        <p class="text-gray-500 text-xs mt-2">Buat tunnel di tab Tunnel untuk expose project Anda ke internet</p>
      `;
    }

    // Local Interfaces
    const interfacesEl = document.getElementById("local-interfaces");
    if (data.network.interfaces && data.network.interfaces.length > 0) {
      interfacesEl.innerHTML = data.network.interfaces.map(iface => `
        <div class="p-3 bg-gray-700 rounded">
          <p class="font-bold text-sm mb-2">${iface.name}</p>
          <div class="space-y-1 text-sm">
            ${iface.ip4 ? `<p><span class="text-gray-400">IPv4:</span> <span class="font-mono">${iface.ip4}</span></p>` : ''}
            ${iface.ip6 ? `<p><span class="text-gray-400">IPv6:</span> <span class="font-mono text-xs">${iface.ip6}</span></p>` : ''}
            ${iface.mac ? `<p><span class="text-gray-400">MAC:</span> <span class="font-mono text-xs">${iface.mac}</span></p>` : ''}
          </div>
        </div>
      `).join('');
    } else {
      interfacesEl.innerHTML = '<p class="text-gray-400">No interfaces found</p>';
    }

    // DNS & Gateway
    const dnsEl = document.getElementById("dns-info");
    let dnsHtml = '';

    if (data.network.gateway) {
      dnsHtml += `
        <div class="p-3 bg-gray-700 rounded">
          <p class="text-sm text-gray-400 mb-1">Gateway</p>
          <p class="font-mono">${data.network.gateway}</p>
        </div>
      `;
    }

    if (data.network.dns && data.network.dns.length > 0) {
      dnsHtml += `
        <div class="p-3 bg-gray-700 rounded">
          <p class="text-sm text-gray-400 mb-2">DNS Servers</p>
          <div class="space-y-1">
            ${data.network.dns.map(dns => `<p class="font-mono text-sm">${dns}</p>`).join('')}
          </div>
        </div>
      `;
    }

    if (dnsHtml) {
      dnsEl.innerHTML = dnsHtml;
    } else {
      dnsEl.innerHTML = '<p class="text-gray-400">Information not available</p>';
    }

    // Network Statistics
    const statsEl = document.getElementById("network-stats-detail");
    if (data.network.stats && data.network.stats.length > 0) {
      statsEl.innerHTML = data.network.stats.map(stat => `
        <div class="bg-gray-700 rounded p-4">
          <h4 class="font-bold mb-3">${stat.interface}</h4>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-400">Download:</span>
              <span class="font-mono">${formatBytes(stat.rx_bytes)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">Upload:</span>
              <span class="font-mono">${formatBytes(stat.tx_bytes)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">DL Speed:</span>
              <span class="font-mono text-green-400">${formatBytes(stat.rx_sec)}/s</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">UP Speed:</span>
              <span class="font-mono text-blue-400">${formatBytes(stat.tx_sec)}/s</span>
            </div>
          </div>
        </div>
      `).join('');
    } else {
      statsEl.innerHTML = '<p class="text-gray-400 col-span-3">No statistics available</p>';
    }
  } catch (err) {
    console.error("Network page error:", err);
    document.getElementById("public-ip").textContent = "Error loading";
  }
}

// Refresh network button - only add listener after DOM loaded
let networkRefreshListenerAdded = false;

function addNetworkRefreshListener() {
  if (networkRefreshListenerAdded) return;

  const refreshBtn = document.getElementById("refresh-network-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      const icon = refreshBtn.querySelector("i");
      icon.classList.add("fa-spin");
      await loadNetworkPage();
      setTimeout(() => icon.classList.remove("fa-spin"), 500);
    });
    networkRefreshListenerAdded = true;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${mins}m`;
}

checkAuth();

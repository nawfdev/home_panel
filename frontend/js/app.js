const API = "/api";
let refreshInterval;
let systemRefreshInterval;
let networkRefreshInterval;
let tunnelRefreshInterval;

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
      case 'projects': loadProjectsPage(); break;
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
    if (data.tunnel.apiConnected && data.tunnel.tunnels) {
      // Cloudflare API connected - show real status
      const healthy = data.tunnel.healthyCount || 0;
      const total = data.tunnel.totalCount || 0;
      tunnelEl.textContent = `${healthy}/${total} Healthy`;
      tunnelEl.className = `text-2xl font-bold ${healthy > 0 ? "text-green-500" : "text-red-500"}`;
    } else {
      // Fallback to local cloudflared process status
      const tunnelStatus = data.tunnel.processRunning ? "Online" : "Offline";
      tunnelEl.textContent = tunnelStatus;
      tunnelEl.className = `text-2xl font-bold ${data.tunnel.processRunning ? "text-green-500" : "text-red-500"}`;
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

    document.getElementById("disk-info").innerHTML = data.system.disk.map(d => `
      <div>
        <div class="flex justify-between text-sm mb-1">
          <span>${d.mount}</span>
          <span>${formatBytes(d.used)} / ${formatBytes(d.size)}</span>
        </div>
        <div class="bg-gray-700 rounded-full h-2">
          <div class="bg-orange-500 h-2 rounded-full" style="width: ${d.usagePercent}%"></div>
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error("Dashboard error:", err);
  }
}

async function loadTunnelPage() {
  try {
    const data = await api("/tunnel/status");

    document.getElementById("cloudflared-version").textContent =
      data.cloudflared.installed ? data.cloudflared.version : "Not installed";

    let tunnelHtml = "";
    if (data.tunnel) {
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

      tunnelHtml = `
        <p><span class="text-gray-400">Name:</span> ${data.tunnel.name || "N/A"}</p>
        <p><span class="text-gray-400">Tunnel ID:</span> ${data.tunnel.tunnel_id || "N/A"}</p>
        <p><span class="text-gray-400">Domain:</span> ${data.tunnel.domain || "Not configured"}</p>
        <p><span class="text-gray-400">Local Port:</span> ${data.tunnel.local_port || "N/A"}</p>
        <div class="mt-2">
           <span class="text-gray-400">Status:</span> 
           ${statusHtml}
        </div>
      `;
    } else {
      tunnelHtml = "<p class=\"text-gray-400\">No tunnel configured. Create one below.</p>";
    }
    document.getElementById("tunnel-info").innerHTML = tunnelHtml;
  } catch (err) {
    console.error("Tunnel page error:", err);
  }
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
  if (!confirm("Are you sure you want to delete this project?")) return;
  try {
    await api(`/projects/${id}`, { method: "DELETE" });
    loadProjects();
  } catch (err) {
    alert("Error: " + err.message);
  }
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

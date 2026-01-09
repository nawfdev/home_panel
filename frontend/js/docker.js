// Docker page loader
async function loadDockerPage() {
  try {
    const statusData = await api("/docker/status");

    if (!statusData.available) {
      const install = statusData.install || { command: 'Visit docker.com', note: '' };
      document.getElementById("docker-status").innerHTML = `
        <div class="bg-yellow-900 border border-yellow-700 rounded-lg p-4">
          <div class="flex items-start">
            <i class="fas fa-exclamation-triangle text-yellow-400 text-xl mr-3 mt-1"></i>
            <div class="flex-1">
              <h4 class="font-bold text-yellow-300 mb-1">Docker Not Available</h4>
              <p class="text-sm text-yellow-200 mb-3">${statusData.reason || 'Docker is not installed or not running on this system.'}</p>
              
              <div class="bg-gray-800 rounded p-3 mb-3">
                <p class="text-xs text-gray-400 mb-1">Install command:</p>
                <div class="flex items-center gap-2">
                  <code class="flex-1 text-sm text-green-400 font-mono">${install.command}</code>
                  <button onclick="navigator.clipboard.writeText('${install.command.replace(/'/g, "\\'")}'); alert('Copied!')" 
                    class="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded text-xs" title="Copy">
                    <i class="fas fa-copy"></i>
                  </button>
                </div>
                ${install.note ? `<p class="text-xs text-gray-400 mt-2">${install.note}</p>` : ''}
              </div>
              
              <button onclick="openTerminalWithCommand('${install.command.replace(/'/g, "\\'")}')" 
                class="bg-green-600 hover:bg-green-700 px-4 py-2 rounded transition">
                <i class="fas fa-terminal mr-2"></i>Install Now (Open Terminal)
              </button>
            </div>
          </div>
        </div>
      `;
      document.getElementById("docker-containers").innerHTML = `
        <p class="text-gray-500">Docker service is not available</p>
      `;
      return;
    }

    const data = await api("/docker/containers");

    if (data.containers && data.containers.length > 0) {
      document.getElementById("docker-containers").innerHTML = data.containers.map(container => {
        const isRunning = container.state === "running";
        const statusColor = isRunning ? "green" : "red";
        const statusIcon = isRunning ? "play" : "stop";

        return `
          <div class="bg-gray-700 rounded-lg p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center">
                <i class="fas fa-${statusIcon}-circle text-${statusColor}-500 mr-3"></i>
                <div>
                  <h4 class="font-bold">${container.name}</h4>
                  <p class="text-xs text-gray-400">${container.image}</p>
                </div>
              </div>
              <span class="px-3 py-1 rounded text-xs font-bold ${isRunning ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}">
                ${container.status}
              </span>
            </div>
            
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-sm">
              <div>
                <span class="text-gray-400">ID:</span>
                <p class="font-mono text-xs">${container.id.substring(0, 12)}</p>
              </div>
              <div>
                <span class="text-gray-400">Ports:</span>
                <p class="text-xs">${container.ports || 'N/A'}</p>
              </div>
              <div>
                <span class="text-gray-400">Created:</span>
                <p class="text-xs">${new Date(container.created * 1000).toLocaleDateString()}</p>
              </div>
              <div>
                <span class="text-gray-400">State:</span>
                <p class="text-xs capitalize">${container.state}</p>
              </div>
            </div>
            
            <div class="flex gap-2">
              ${isRunning ? `
                <button onclick="dockerAction('${container.id}', 'stop')" class="bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-sm transition">
                  <i class="fas fa-stop mr-1"></i>Stop
                </button>
                <button onclick="dockerAction('${container.id}', 'restart')" class="bg-yellow-600 hover:bg-yellow-700 px-3 py-1 rounded text-sm transition">
                  <i class="fas fa-redo mr-1"></i>Restart
                </button>
              ` : `
                <button onclick="dockerAction('${container.id}', 'start')" class="bg-green-600 hover:bg-green-700 px-3 py-1 rounded text-sm transition">
                  <i class="fas fa-play mr-1"></i>Start
                </button>
              `}
              <button onclick="showDockerLogs('${container.id}', '${container.name}')" class="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm transition">
                <i class="fas fa-file-alt mr-1"></i>Logs
              </button>
            </div>
          </div>
        `;
      }).join('');
    } else {
      document.getElementById("docker-containers").innerHTML = `
        <p class="text-gray-400">No containers found</p>
      `;
    }

    document.getElementById("docker-status").innerHTML = `
      <div class="bg-green-900 border border-green-700 rounded-lg p-4">
        <div class="flex items-center">
          <i class="fas fa-check-circle text-green-400 text-xl mr-3"></i>
          <div>
            <h4 class="font-bold text-green-300">Docker is running</h4>
            <p class="text-sm text-green-200">${data.containers.length} container(s) found</p>
          </div>
        </div>
      </div>
    `;

  } catch (err) {
    console.error("Docker page error:", err);
    document.getElementById("docker-status").innerHTML = `
      <div class="bg-red-900 border border-red-700 rounded-lg p-4">
        <div class="flex items-center">
          <i class="fas fa-exclamation-circle text-red-400 text-xl mr-3"></i>
          <div>
            <h4 class="font-bold text-red-300">Error loading Docker</h4>
            <p class="text-sm text-red-200">${err.message}</p>
          </div>
        </div>
      </div>
    `;
  }
}

// Docker action handler
async function dockerAction(containerId, action) {
  try {
    const result = await api(`/docker/containers/${containerId}/${action}`, { method: 'POST' });
    if (result.success) {
      // Reload Docker page
      await loadDockerPage();
    }
  } catch (err) {
    alert(`Failed to ${action} container: ${err.message}`);
  }
}

// Show Docker logs
async function showDockerLogs(containerId, containerName) {
  const modal = document.getElementById("docker-logs-modal");
  const logsContent = document.getElementById("docker-logs-content");
  const nameEl = document.getElementById("logs-container-name");

  nameEl.textContent = `${containerName} - Logs`;
  logsContent.textContent = "Loading logs...";
  modal.classList.remove("hidden");
  modal.classList.add("flex");

  try {
    const result = await api(`/docker/containers/${containerId}/logs?lines=100`);
    if (result.success) {
      logsContent.textContent = result.logs || "No logs available";
    } else {
      logsContent.textContent = `Error: ${result.error}`;
    }
  } catch (err) {
    logsContent.textContent = `Error loading logs: ${err.message}`;
  }
}

// Close logs modal
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById("close-logs-btn");
  const modal = document.getElementById("docker-logs-modal");

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    });
  }

  // Close on outside click
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
      }
    });
  }
});

// Refresh Docker button
document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById("refresh-docker-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      const icon = refreshBtn.querySelector("i");
      icon.classList.add("fa-spin");
      await loadDockerPage();
      setTimeout(() => icon.classList.remove("fa-spin"), 500);
    });
  }
});

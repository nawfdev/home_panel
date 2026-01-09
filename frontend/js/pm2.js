// PM2 page loader
async function loadPm2Page() {
    try {
        const statusData = await api("/pm2/status");

        if (!statusData.available) {
            document.getElementById("pm2-status").innerHTML = `
        <div class="bg-yellow-900 border border-yellow-700 rounded-lg p-4">
          <div class="flex items-start">
            <i class="fas fa-exclamation-triangle text-yellow-400 text-xl mr-3 mt-1"></i>
            <div>
              <h4 class="font-bold text-yellow-300 mb-1">PM2 Not Available</h4>
              <p class="text-sm text-yellow-200">
                PM2 is not installed on this system.
                <br>Install: <code class="bg-gray-900 px-2 py-1 rounded">npm install -g pm2</code>
              </p>
            </div>
          </div>
        </div>
      `;
            document.getElementById("pm2-processes").innerHTML = `
        <p class="text-gray-500">PM2 is not available</p>
      `;
            return;
        }

        const data = await api("/pm2/processes");

        if (data.processes && data.processes.length > 0) {
            document.getElementById("pm2-processes").innerHTML = data.processes.map(proc => {
                const isOnline = proc.status === "online";
                const statusColor = isOnline ? "green" : "red";

                return `
          <div class="bg-gray-700 rounded-lg p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center">
                <i class="fas fa-circle text-${statusColor}-500 mr-3"></i>
                <div>
                  <h4 class="font-bold">${proc.name}</h4>
                  <p class="text-xs text-gray-400">PID: ${proc.pid || 'N/A'} | Mode: ${proc.mode || 'fork'}</p>
                </div>
              </div>
              <span class="px-3 py-1 rounded text-xs font-bold ${isOnline ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}">
                ${proc.status}
              </span>
            </div>
            
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-sm">
              <div>
                <span class="text-gray-400">CPU:</span>
                <p class="font-bold">${proc.cpu}%</p>
              </div>
              <div>
                <span class="text-gray-400">Memory:</span>
                <p class="font-bold">${proc.memory}</p>
              </div>
              <div>
                <span class="text-gray-400">Uptime:</span>
                <p class="text-xs">${proc.uptime || 'N/A'}</p>
              </div>
              <div>
                <span class="text-gray-400">Restarts:</span>
                <p class="font-bold text-yellow-400">${proc.restarts || 0}</p>
              </div>
            </div>
            
            <div class="flex gap-2">
              ${isOnline ? `
                <button onclick="pm2Action('${proc.name}', 'stop')" class="bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-sm transition">
                  <i class="fas fa-stop mr-1"></i>Stop
                </button>
                <button onclick="pm2Action('${proc.name}', 'restart')" class="bg-yellow-600 hover:bg-yellow-700 px-3 py-1 rounded text-sm transition">
                  <i class="fas fa-redo mr-1"></i>Restart
                </button>
              ` : `
                <button onclick="pm2Action('${proc.name}', 'start')" class="bg-green-600 hover:bg-green-700 px-3 py-1 rounded text-sm transition">
                  <i class="fas fa-play mr-1"></i>Start
                </button>
              `}
              <button onclick="showPm2Logs('${proc.name}')" class="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm transition">
                <i class="fas fa-file-alt mr-1"></i>Logs
              </button>
              <button onclick="pm2Delete('${proc.name}')" class="bg-gray-600 hover:bg-gray-700 px-3 py-1 rounded text-sm transition">
                <i class="fas fa-trash mr-1"></i>Delete
              </button>
            </div>
          </div>
        `;
            }).join('');

            document.getElementById("pm2-status").innerHTML = `
        <div class="bg-green-900 border border-green-700 rounded-lg p-4">
          <div class="flex items-center">
            <i class="fas fa-check-circle text-green-400 text-xl mr-3"></i>
            <div>
              <h4 class="font-bold text-green-300">PM2 is running</h4>
              <p class="text-sm text-green-200">${data.processes.length} process(es) found</p>
            </div>
          </div>
        </div>
      `;
        } else {
            document.getElementById("pm2-processes").innerHTML = `
        <p class="text-gray-400">No processes found</p>
      `;

            document.getElementById("pm2-status").innerHTML = `
        <div class="bg-blue-900 border border-blue-700 rounded-lg p-4">
          <div class="flex items-center">
            <i class="fas fa-info-circle text-blue-400 text-xl mr-3"></i>
            <div>
              <h4 class="font-bold text-blue-300">PM2 is ready</h4>
              <p class="text-sm text-blue-200">No processes running</p>
            </div>
          </div>
        </div>
      `;
        }

    } catch (err) {
        console.error("PM2 page error:", err);
        document.getElementById("pm2-status").innerHTML = `
      <div class="bg-red-900 border border-red-700 rounded-lg p-4">
        <div class="flex items-center">
          <i class="fas fa-exclamation-circle text-red-400 text-xl mr-3"></i>
          <div>
            <h4 class="font-bold text-red-300">Error loading PM2</h4>
            <p class="text-sm text-red-200">${err.message}</p>
          </div>
        </div>
      </div>
    `;
    }
}

// PM2 action handler
async function pm2Action(processName, action) {
    try {
        const result = await api(`/pm2/processes/${processName}/${action}`, { method: 'POST' });
        if (result.success) {
            await loadPm2Page();
        }
    } catch (err) {
        alert(`Failed to ${action} process: ${err.message}`);
    }
}

// PM2 delete with confirmation
async function pm2Delete(processName) {
    if (confirm(`Are you sure you want to delete process "${processName}"?`)) {
        try {
            const result = await api(`/pm2/processes/${processName}`, { method: 'DELETE' });
            if (result.success) {
                await loadPm2Page();
            }
        } catch (err) {
            alert(`Failed to delete process: ${err.message}`);
        }
    }
}

// Show PM2 logs
async function showPm2Logs(processName) {
    const modal = document.getElementById("pm2-logs-modal");
    const logsContent = document.getElementById("pm2-logs-content");
    const nameEl = document.getElementById("pm2-logs-process-name");

    nameEl.textContent = `${processName} - Logs`;
    logsContent.textContent = "Loading logs...";
    modal.classList.remove("hidden");
    modal.classList.add("flex");

    try {
        const result = await api(`/pm2/processes/${processName}/logs?lines=100`);
        if (result.success) {
            logsContent.textContent = result.logs || "No logs available";
        } else {
            logsContent.textContent = `Error: ${result.error}`;
        }
    } catch (err) {
        logsContent.textContent = `Error loading logs: ${err.message}`;
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Close PM2 logs
    const closePm2LogsBtn = document.getElementById("close-pm2-logs-btn");
    const pm2LogsModal = document.getElementById("pm2-logs-modal");

    if (closePm2LogsBtn) {
        closePm2LogsBtn.addEventListener("click", () => {
            pm2LogsModal.classList.add("hidden");
            pm2LogsModal.classList.remove("flex");
        });
    }

    if (pm2LogsModal) {
        pm2LogsModal.addEventListener("click", (e) => {
            if (e.target === pm2LogsModal) {
                pm2LogsModal.classList.add("hidden");
                pm2LogsModal.classList.remove("flex");
            }
        });
    }

    // Refresh PM2
    const refreshPm2Btn = document.getElementById("refresh-pm2-btn");
    if (refreshPm2Btn) {
        refreshPm2Btn.addEventListener("click", async () => {
            const icon = refreshPm2Btn.querySelector("i");
            icon.classList.add("fa-spin");
            await loadPm2Page();
            setTimeout(() => icon.classList.remove("fa-spin"), 500);
        });
    }
});

// Cloudflare Tunnels Manager

async function loadProjectsPage() {
    await checkCloudflareStatus();
    await loadTunnels();
}

async function checkCloudflareStatus() {
    try {
        const res = await api('/cloudflare/status');
        const banner = document.getElementById('cf-status-banner');

        if (res.configured) {
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
        }
        return res.configured;
    } catch (err) {
        console.error('CF Status Check Failed:', err);
        return false;
    }
}

async function loadTunnels() {
    const listContainer = document.getElementById('tunnel-list');
    listContainer.innerHTML = '<p class="text-gray-400 text-center py-4"><i class="fas fa-spinner fa-spin mr-2"></i>Loading tunnels...</p>';

    try {
        const isConfigured = await checkCloudflareStatus();

        if (!isConfigured) {
            // Fallback UI if not configured
            listContainer.innerHTML = `
        <div class="text-center py-6">
          <i class="fas fa-cloud-slash text-gray-500 text-4xl mb-3"></i>
          <p class="text-gray-400 mb-4">Cloudflare API not configured</p>
          <a href="#" onclick="showPage('page-settings')" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm text-white">
            Configure in Settings
          </a>
        </div>
      `;
            return;
        }

        // Fetch from API
        const res = await api('/cloudflare/tunnels');

        if (!res.success) throw new Error(res.error);

        if (res.tunnels.length === 0) {
            listContainer.innerHTML = '<p class="text-gray-400 text-center">No tunnels found</p>';
            return;
        }

        listContainer.innerHTML = res.tunnels.map(t => {
            const statusColor = t.status === 'healthy' ? 'text-green-500' : 'text-red-500';
            const statusIcon = t.status === 'healthy' ? 'fa-check-circle' : 'fa-exclamation-circle';

            return `
        <div class="bg-gray-700 rounded p-4 border-l-4 ${t.status === 'healthy' ? 'border-green-500' : 'border-red-500'}">
          <div class="flex justify-between items-start">
            <div>
              <h4 class="font-bold text-white flex items-center">
                ${t.name}
              </h4>
              <p class="text-xs text-gray-400 mt-1">ID: ${t.id}</p>
            </div>
            <div class="flex flex-col items-end">
              <span class="${statusColor} text-sm font-bold flex items-center">
                <i class="fas ${statusIcon} mr-1"></i> ${t.status.toUpperCase()}
              </span>
              <span class="text-xs text-gray-400 mt-1">${new Date(t.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          
          ${t.remote_config ? '<div class="mt-2 text-xs bg-gray-800 p-2 rounded text-blue-300"><i class="fas fa-cog mr-1"></i>Remotely Managed</div>' : ''}
        </div>
      `;
        }).join('');

    } catch (err) {
        listContainer.innerHTML = `
      <div class="text-red-400 text-center py-4">
        <p>Failed to load tunnels</p>
        <p class="text-xs mt-1">${err.message}</p>
      </div>
    `;
    }
}

// Add to global scope for onclick handler
window.loadTunnels = loadTunnels;

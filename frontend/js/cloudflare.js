// Cloudflare API Page
async function loadCloudflarePage() {
    // Load API status
    loadCfApiStatus();
    // Load tunnels
    loadCfTunnels();
    // Load zones
    loadCfZones();
}

async function loadCfApiStatus() {
    const statusEl = document.getElementById('cf-api-status');
    const accountEl = document.getElementById('cf-account-info');

    try {
        const res = await fetch('/api/cloudflare/status', { credentials: 'include' });
        const data = await res.json();

        if (data.configured) {
            statusEl.innerHTML = `
                <div class="flex items-center gap-2">
                    <i class="fas fa-check-circle text-green-500"></i>
                    <span class="text-green-400">API Connected</span>
                </div>
                <p class="text-sm text-gray-400">Account ID: <code class="bg-gray-700 px-2 py-1 rounded">${data.accountId || 'Auto-detect'}</code></p>
            `;

            accountEl.innerHTML = `
                <p><span class="text-gray-400">Status:</span> <span class="text-green-400">Active</span></p>
                <p><span class="text-gray-400">Account ID:</span> <code class="text-xs bg-gray-700 px-2 py-1 rounded">${data.accountId || 'N/A'}</code></p>
            `;
        } else {
            statusEl.innerHTML = `
                <div class="flex items-center gap-2">
                    <i class="fas fa-times-circle text-red-500"></i>
                    <span class="text-red-400">Not Configured</span>
                </div>
                <p class="text-sm text-gray-400 mt-2">Go to Settings to add your API Token</p>
                <a href="#" class="nav-link inline-block mt-3 bg-orange-500 hover:bg-orange-600 px-4 py-2 rounded text-sm" data-page="settings">
                    <i class="fas fa-cog mr-2"></i>Configure API
                </a>
            `;
            accountEl.innerHTML = '<p class="text-gray-400">No account connected</p>';
        }
    } catch (err) {
        statusEl.innerHTML = `<p class="text-red-400">Error: ${err.message}</p>`;
    }
}

async function loadCfTunnels() {
    const el = document.getElementById('cf-tunnels-list');

    try {
        const res = await fetch('/api/cloudflare/tunnels', { credentials: 'include' });
        const data = await res.json();

        if (!data.success) {
            el.innerHTML = `<p class="text-yellow-400"><i class="fas fa-exclamation-triangle mr-2"></i>${data.error || 'Could not load tunnels'}</p>`;
            return;
        }

        if (!data.tunnels || data.tunnels.length === 0) {
            el.innerHTML = '<p class="text-gray-400">No tunnels found</p>';
            return;
        }

        el.innerHTML = data.tunnels.map(t => `
            <div class="bg-gray-700 rounded-lg p-4 flex items-center justify-between">
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="font-bold">${t.name}</span>
                        <span class="px-2 py-0.5 rounded text-xs ${t.status === 'healthy' ? 'bg-green-600' : t.status === 'degraded' ? 'bg-yellow-600' : 'bg-red-600'}">${t.status}</span>
                    </div>
                    <p class="text-xs text-gray-400">ID: ${t.id}</p>
                    <p class="text-xs text-gray-400">Connections: ${t.conns_active || 0}</p>
                </div>
                <div class="flex gap-2">
                    <button onclick="viewTunnelDetails('${t.id}')" class="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm transition">
                        <i class="fas fa-eye mr-1"></i>Detail
                    </button>
                    <button onclick="deleteTunnelConfirm('${t.id}', '${t.name}')" class="bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-sm transition">
                        <i class="fas fa-trash mr-1"></i>Delete
                    </button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        el.innerHTML = `<p class="text-red-400">Error: ${err.message}</p>`;
    }
}

async function viewTunnelDetails(tunnelId) {
    try {
        // Fetch tunnel info and config in parallel
        const [tunnelRes, configRes] = await Promise.all([
            fetch(`/api/cloudflare/tunnels/${tunnelId}`, { credentials: 'include' }),
            fetch(`/api/cloudflare/tunnels/${tunnelId}/config`, { credentials: 'include' })
        ]);
        const tunnelData = await tunnelRes.json();
        const configData = await configRes.json();

        if (!tunnelData.success) {
            alert('Error: ' + tunnelData.error);
            return;
        }

        const t = tunnelData.tunnel;
        const conns = t.connections || [];
        const config = configData.config || { ingress: [] };
        const ingress = config.ingress || [];

        const connectionsHtml = conns.length > 0
            ? conns.map(c => `
                <div class="bg-gray-700 rounded p-3 mb-2">
                    <div class="flex justify-between items-center">
                        <span class="font-bold">${c.colo_name || 'Unknown'}</span>
                        <span class="text-xs ${c.is_pending_reconnect ? 'text-yellow-400' : 'text-green-400'}">
                            ${c.is_pending_reconnect ? 'Reconnecting...' : 'Connected'}
                        </span>
                    </div>
                    <p class="text-xs text-gray-400">ID: ${c.id}</p>
                    <p class="text-xs text-gray-400">Client: ${c.client_id || 'N/A'}</p>
                    <p class="text-xs text-gray-400">Opened: ${new Date(c.opened_at).toLocaleString()}</p>
                </div>
            `).join('')
            : '<p class="text-gray-400">No active connections</p>';

        // Ingress routes display
        const ingressHtml = ingress.length > 0
            ? ingress.map((r, i) => `
                <div class="bg-gray-700 rounded p-3 mb-2 flex justify-between items-center">
                    <div class="flex-1">
                        <p class="font-bold text-blue-400">${r.hostname || 'catch-all'}</p>
                        <p class="text-sm text-gray-300">→ ${r.service}</p>
                        ${r.path ? `<p class="text-xs text-gray-400">Path: ${r.path}</p>` : ''}
                    </div>
                    ${r.hostname ? `
                        <button onclick="editIngressRoute('${tunnelId}', ${i})" class="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm">
                            <i class="fas fa-edit"></i>
                        </button>
                    ` : '<span class="text-xs text-gray-500">Default</span>'}
                </div>
            `).join('')
            : '<p class="text-gray-400">No routes configured (using local config.yml)</p>';

        // Show modal
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50';
        modal.id = 'tunnel-detail-modal';
        modal.innerHTML = `
            <div class="bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-xl font-bold"><i class="fas fa-network-wired mr-2"></i>${t.name}</h3>
                    <button onclick="document.getElementById('tunnel-detail-modal').remove()" class="text-gray-400 hover:text-white">
                        <i class="fas fa-times text-2xl"></i>
                    </button>
                </div>
                <div class="grid grid-cols-2 gap-4 mb-4">
                    <div class="bg-gray-700 rounded p-3">
                        <p class="text-gray-400 text-sm">Status</p>
                        <p class="font-bold ${t.status === 'healthy' ? 'text-green-400' : 'text-yellow-400'}">${t.status}</p>
                    </div>
                    <div class="bg-gray-700 rounded p-3">
                        <p class="text-gray-400 text-sm">Config Type</p>
                        <p class="font-bold">${t.remote_config ? 'Remote (Dashboard)' : 'Local (config.yml)'}</p>
                    </div>
                </div>
                <div class="bg-gray-700 rounded p-3 mb-4">
                    <p class="text-gray-400 text-sm mb-1">Tunnel ID</p>
                    <code class="text-xs bg-gray-900 px-2 py-1 rounded block">${t.id}</code>
                </div>
                
                <!-- Ingress Routes Section -->
                <div class="mb-4">
                    <div class="flex justify-between items-center mb-2">
                        <h4 class="font-bold"><i class="fas fa-route mr-2"></i>Published Routes (${ingress.length})</h4>
                        ${t.remote_config ? `
                            <button onclick="addIngressRoute('${tunnelId}')" class="bg-green-600 hover:bg-green-700 px-3 py-1 rounded text-sm">
                                <i class="fas fa-plus mr-1"></i>Add Route
                            </button>
                        ` : ''}
                    </div>
                    ${ingressHtml}
                </div>
                
                <h4 class="font-bold mb-2"><i class="fas fa-plug mr-2"></i>Active Connections (${conns.length})</h4>
                ${connectionsHtml}
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// Edit ingress route
async function editIngressRoute(tunnelId, routeIndex) {
    const newService = prompt('Enter new service URL (e.g., http://localhost:3000):');
    if (!newService) return;

    try {
        // Fetch current config
        const res = await fetch(`/api/cloudflare/tunnels/${tunnelId}/config`, { credentials: 'include' });
        const data = await res.json();

        if (!data.success || !data.config) {
            alert('Could not load config');
            return;
        }

        // Update the specific route
        const config = data.config;
        if (config.ingress && config.ingress[routeIndex]) {
            config.ingress[routeIndex].service = newService;
        }

        // Save updated config
        const updateRes = await fetch(`/api/cloudflare/tunnels/${tunnelId}/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ config })
        });
        const updateData = await updateRes.json();

        if (updateData.success) {
            alert('Route updated successfully');
            document.getElementById('tunnel-detail-modal')?.remove();
            viewTunnelDetails(tunnelId);
        } else {
            alert('Error: ' + updateData.error);
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// Add new ingress route
async function addIngressRoute(tunnelId) {
    const hostname = prompt('Enter hostname (e.g., app.example.com):');
    if (!hostname) return;

    const service = prompt('Enter service URL (e.g., http://localhost:3000):');
    if (!service) return;

    try {
        // Fetch current config
        const res = await fetch(`/api/cloudflare/tunnels/${tunnelId}/config`, { credentials: 'include' });
        const data = await res.json();

        const config = data.config || { ingress: [] };

        // Insert before catch-all (last item)
        const newRoute = { hostname, service };
        if (config.ingress.length > 0) {
            config.ingress.splice(config.ingress.length - 1, 0, newRoute);
        } else {
            config.ingress = [newRoute, { service: 'http_status:404' }];
        }

        // Save updated config
        const updateRes = await fetch(`/api/cloudflare/tunnels/${tunnelId}/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ config })
        });
        const updateData = await updateRes.json();

        if (updateData.success) {
            alert('Route added successfully');
            document.getElementById('tunnel-detail-modal')?.remove();
            viewTunnelDetails(tunnelId);
        } else {
            alert('Error: ' + updateData.error);
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function deleteTunnelConfirm(tunnelId, tunnelName) {
    showConfirm(`Are you sure you want to delete tunnel "${tunnelName}"? This cannot be undone.`, async () => {
        try {
            const res = await fetch(`/api/cloudflare/tunnels/${tunnelId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            const data = await res.json();

            if (data.success) {
                alert('Tunnel deleted successfully');
                loadCfTunnels();
            } else {
                alert('Error: ' + data.error);
            }
        } catch (err) {
            alert('Error: ' + err.message);
        }
    });
}

async function loadCfZones() {
    const el = document.getElementById('cf-zones-list');

    try {
        const res = await fetch('/api/cloudflare/zones', { credentials: 'include' });
        const data = await res.json();

        if (!data.success) {
            el.innerHTML = `<p class="text-yellow-400"><i class="fas fa-exclamation-triangle mr-2"></i>${data.error || 'Could not load zones'}</p>`;
            return;
        }

        if (!data.zones || data.zones.length === 0) {
            el.innerHTML = '<p class="text-gray-400 col-span-3">No zones found</p>';
            return;
        }

        el.innerHTML = data.zones.map(z => `
            <div class="bg-gray-700 rounded-lg p-4">
                <div class="flex items-center gap-2 mb-2">
                    <i class="fas fa-globe text-blue-400"></i>
                    <span class="font-bold">${z.name}</span>
                </div>
                <p class="text-xs text-gray-400">Status: <span class="${z.status === 'active' ? 'text-green-400' : 'text-yellow-400'}">${z.status}</span></p>
            </div>
        `).join('');
    } catch (err) {
        el.innerHTML = `<p class="text-red-400 col-span-3">Error: ${err.message}</p>`;
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('refresh-cf-btn')?.addEventListener('click', loadCloudflarePage);
});

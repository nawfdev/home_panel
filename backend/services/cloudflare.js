// Using native fetch (Node 18+)
const { getSetting } = require('./database');

const CF_API_URL = 'https://api.cloudflare.com/client/v4';

// Cache for API responses (60 seconds)
let tunnelsCache = { data: null, expiry: 0 };
let zonesCache = { data: null, expiry: 0 };
const CACHE_TTL = 60000; // 60 seconds

async function getHeaders() {
    const cf = getSetting('cloudflare');
    if (!cf || !cf.apiToken) return null;
    return {
        'Authorization': `Bearer ${cf.apiToken.trim()}`,
        'Content-Type': 'application/json'
    };
}

async function getAccountId() {
    const cf = getSetting('cloudflare');
    if (cf && cf.accountId) return cf.accountId;

    const headers = await getHeaders();
    if (!headers) throw new Error('Cloudflare API Token not configured');

    const res = await fetch(`${CF_API_URL}/accounts`, { headers });
    const data = await res.json();

    if (!data.success || !data.result || data.result.length === 0) {
        throw new Error('Could not fetch Cloudflare Account ID: ' + (data.errors?.[0]?.message || 'Unknown error'));
    }

    return data.result[0].id;
}

// === Tunnels ===

async function listTunnels() {
    // Return cached data if still valid
    const now = Date.now();
    if (tunnelsCache.data && now < tunnelsCache.expiry) {
        return tunnelsCache.data;
    }

    const headers = await getHeaders();
    if (!headers) throw new Error('Not authenticated');

    const accountId = await getAccountId();
    const res = await fetch(`${CF_API_URL}/accounts/${accountId}/tunnels?is_deleted=false`, { headers });
    const data = await res.json();

    if (!data.success) {
        throw new Error(data.errors[0]?.message || 'Failed to list tunnels');
    }

    // Transform and cache data
    const result = data.result.map(t => ({
        id: t.id,
        name: t.name,
        status: t.status,
        created_at: t.created_at,
        conns_active: t.conns_active || 0,
        connections: t.connections || [],
        remote_config: t.remote_config
    }));

    tunnelsCache = { data: result, expiry: Date.now() + CACHE_TTL };
    return result;
}

async function getTunnelDetails(tunnelId) {
    const headers = await getHeaders();
    const accountId = await getAccountId();

    const res = await fetch(`${CF_API_URL}/accounts/${accountId}/tunnels/${tunnelId}`, { headers });
    const data = await res.json();

    if (!data.success) throw new Error('Failed to get tunnel details');
    return data.result;
}

// === DNS ===

async function listZones() {
    const headers = await getHeaders();
    if (!headers) throw new Error('Not authenticated');

    const res = await fetch(`${CF_API_URL}/zones?status=active`, { headers });
    const data = await res.json();

    if (!data.success) throw new Error('Failed to list zones');
    return data.result.map(z => ({
        id: z.id,
        name: z.name,
        status: z.status
    }));
}

async function getTunnelConnections(tunnelId) {
    const headers = await getHeaders();
    if (!headers) throw new Error('Not authenticated');

    const accountId = await getAccountId();
    const res = await fetch(`${CF_API_URL}/accounts/${accountId}/tunnels/${tunnelId}`, { headers });
    const data = await res.json();

    if (!data.success) throw new Error('Failed to get tunnel');

    return {
        id: data.result.id,
        name: data.result.name,
        status: data.result.status,
        connections: data.result.connections || [],
        created_at: data.result.created_at,
        remote_config: data.result.remote_config
    };
}

async function deleteTunnel(tunnelId) {
    const headers = await getHeaders();
    if (!headers) throw new Error('Not authenticated');

    const accountId = await getAccountId();

    // First cleanup connections
    await fetch(`${CF_API_URL}/accounts/${accountId}/tunnels/${tunnelId}/connections`, {
        method: 'DELETE',
        headers
    });

    // Then delete tunnel
    const res = await fetch(`${CF_API_URL}/accounts/${accountId}/tunnels/${tunnelId}`, {
        method: 'DELETE',
        headers
    });
    const data = await res.json();

    if (!data.success) throw new Error(data.errors?.[0]?.message || 'Failed to delete tunnel');

    // Clear cache
    tunnelsCache = { data: null, expiry: 0 };

    return { success: true };
}

// Get tunnel configuration (ingress rules)
async function getTunnelConfig(tunnelId) {
    const headers = await getHeaders();
    if (!headers) throw new Error('Not authenticated');

    const accountId = await getAccountId();
    const res = await fetch(`${CF_API_URL}/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, { headers });
    const data = await res.json();

    if (!data.success) {
        // Tunnel might not have remote config, return empty
        return { ingress: [], originRequest: {} };
    }

    return data.result.config || { ingress: [], originRequest: {} };
}

// Update tunnel configuration (ingress rules)
async function updateTunnelConfig(tunnelId, config) {
    const headers = await getHeaders();
    if (!headers) throw new Error('Not authenticated');

    const accountId = await getAccountId();
    const res = await fetch(`${CF_API_URL}/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ config })
    });
    const data = await res.json();

    if (!data.success) {
        throw new Error(data.errors?.[0]?.message || 'Failed to update tunnel config');
    }

    // Clear cache
    tunnelsCache = { data: null, expiry: 0 };

    return { success: true, config: data.result.config };
}

module.exports = {
    listTunnels,
    getTunnelDetails,
    getTunnelConnections,
    deleteTunnel,
    listZones,
    getTunnelConfig,
    updateTunnelConfig
};

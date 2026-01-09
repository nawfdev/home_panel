// Using native fetch (Node 18+)
const { getSetting } = require('./database');

const CF_API_URL = 'https://api.cloudflare.com/client/v4';

async function getHeaders() {
    const cf = getSetting('cloudflare');
    if (!cf || !cf.apiToken) return null;
    return {
        'Authorization': `Bearer ${cf.apiToken}`,
        'Content-Type': 'application/json'
    };
}

async function getAccountId() {
    // If stored, return it
    const cf = getSetting('cloudflare');
    if (cf && cf.accountId) return cf.accountId;

    // Fetch from API if not stored (takes first account)
    const headers = await getHeaders();
    if (!headers) throw new Error('Cloudflare API Token not configured');

    const res = await fetch(`${CF_API_URL}/accounts`, { headers });
    const data = await res.json();

    if (!data.success || !data.result || data.result.length === 0) {
        throw new Error('Could not fetch Cloudflare Account ID');
    }

    return data.result[0].id;
}

// === Tunnels ===

async function listTunnels() {
    const headers = await getHeaders();
    if (!headers) throw new Error('Not authenticated');

    const accountId = await getAccountId();
    const res = await fetch(`${CF_API_URL}/accounts/${accountId}/tunnels?is_deleted=false`, { headers });
    const data = await res.json();

    if (!data.success) throw new Error(data.errors[0]?.message || 'Failed to list tunnels');

    // Transform data
    return data.result.map(t => ({
        id: t.id,
        name: t.name,
        status: t.status, // healthy, degraded, down
        created_at: t.created_at,
        conns_active: t.conns_active || 0,
        connections: t.connections || [],
        remote_config: t.remote_config
    }));
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

module.exports = {
    listTunnels,
    getTunnelDetails,
    listZones
};

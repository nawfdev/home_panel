const { networkInterfaces } = require("os");
const { promisify } = require("util");
const { exec } = require("child_process");

const execPromise = promisify(exec);

// Get public IP address
async function getPublicIp() {
    try {
        // Try multiple services for reliability
        const services = [
            "https://api.ipify.org",
            "https://ifconfig.me/ip",
            "https://icanhazip.com"
        ];

        for (const service of services) {
            try {
                const response = await fetch(service);
                const ip = await response.text();
                return ip.trim();
            } catch (error) {
                continue;
            }
        }

        throw new Error("All IP detection services failed");
    } catch (error) {
        return "Unable to detect";
    }
}

// Get local network interfaces
function getLocalInterfaces() {
    const interfaces = networkInterfaces();
    const result = [];

    for (const [name, addresses] of Object.entries(interfaces)) {
        const ipv4 = addresses.find(addr => addr.family === "IPv4" && !addr.internal);
        const ipv6 = addresses.find(addr => addr.family === "IPv6" && !addr.internal);

        if (ipv4 || ipv6) {
            result.push({
                name,
                ip4: ipv4?.address || null,
                ip6: ipv6?.address || null,
                mac: ipv4?.mac || ipv6?.mac || null,
                internal: false
            });
        }
    }

    return result;
}

// Get network connections count
async function getConnectionsCount() {
    try {
        if (process.platform === "win32") {
            const { stdout } = await execPromise("netstat -an | find /c \"ESTABLISHED\"");
            return parseInt(stdout.trim()) || 0;
        } else {
            const { stdout } = await execPromise("netstat -an | grep ESTABLISHED | wc -l");
            return parseInt(stdout.trim()) || 0;
        }
    } catch (error) {
        return 0;
    }
}

// Get network statistics
async function getNetworkStats() {
    const si = require("systeminformation");

    try {
        const stats = await si.networkStats();
        return stats.map(stat => ({
            interface: stat.iface,
            rx_bytes: stat.rx_bytes,
            tx_bytes: stat.tx_bytes,
            rx_sec: stat.rx_sec,
            tx_sec: stat.tx_sec,
            ms: stat.ms
        }));
    } catch (error) {
        return [];
    }
}

// Get complete network information
async function getNetworkInfo() {
    try {
        const [publicIp, interfaces, connections, stats] = await Promise.all([
            getPublicIp(),
            Promise.resolve(getLocalInterfaces()),
            getConnectionsCount(),
            getNetworkStats()
        ]);

        return {
            publicIp,
            interfaces,
            connections,
            stats
        };
    } catch (error) {
        throw new Error(`Failed to get network info: ${error.message}`);
    }
}

// Get Cloudflare tunnel info (if available)
async function getCloudflareInfo() {
    try {
        const { getTunnelStatus } = require("./cloudflared");
        const tunnelStatus = await getTunnelStatus();

        // Return info even if tunnel is running but not in database
        if (tunnelStatus.processRunning) {
            return {
                domain: tunnelStatus.tunnel?.domain || "Systemd/External",
                tunnelId: tunnelStatus.tunnel?.tunnel_id || tunnelStatus.pid?.toString() || "N/A",
                status: "running",
                pid: tunnelStatus.pid
            };
        }

        // If not running and no config, return null
        if (!tunnelStatus.tunnel && !tunnelStatus.processRunning) {
            return null;
        }

        return {
            domain: tunnelStatus.tunnel?.domain || "Not configured",
            tunnelId: tunnelStatus.tunnel?.tunnel_id || "N/A",
            status: tunnelStatus.processRunning ? "running" : "stopped",
            pid: tunnelStatus.pid
        };
    } catch (error) {
        return null;
    }
}

// Test internet connectivity
async function testConnectivity() {
    try {
        const response = await fetch("https://www.google.com", {
            method: "HEAD",
            timeout: 5000
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

// Get DNS servers
async function getDnsServers() {
    try {
        if (process.platform === "win32") {
            const { stdout } = await execPromise("ipconfig /all | findstr /C:\"DNS Servers\"");
            const matches = stdout.match(/\d+\.\d+\.\d+\.\d+/g);
            return matches || [];
        } else {
            const { stdout } = await execPromise("cat /etc/resolv.conf | grep nameserver | awk '{print $2}'");
            return stdout.trim().split("\n").filter(Boolean);
        }
    } catch (error) {
        return [];
    }
}

// Get gateway
async function getGateway() {
    try {
        if (process.platform === "win32") {
            const { stdout } = await execPromise("ipconfig | findstr /C:\"Default Gateway\"");
            const match = stdout.match(/\d+\.\d+\.\d+\.\d+/);
            return match ? match[0] : null;
        } else {
            const { stdout } = await execPromise("ip route | grep default | awk '{print $3}'");
            return stdout.trim() || null;
        }
    } catch (error) {
        return null;
    }
}

module.exports = {
    getPublicIp,
    getLocalInterfaces,
    getConnectionsCount,
    getNetworkStats,
    getNetworkInfo,
    getCloudflareInfo,
    testConnectivity,
    getDnsServers,
    getGateway
};

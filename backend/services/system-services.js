const { exec } = require("child_process");
const { promisify } = require("util");

const execPromise = promisify(exec);

// Sanitize service name to prevent command injection
function sanitizeServiceName(name) {
    // Only allow alphanumeric, underscore, hyphen, and dot
    if (!/^[a-zA-Z0-9_\-\.@]+$/.test(name)) {
        throw new Error("Invalid service name format");
    }
    return name;
}

// Check if running on Windows
function isWindows() {
    return process.platform === 'win32';
}

// List all services (Windows)
async function listServicesWindows() {
    try {
        const { stdout } = await execPromise('sc query type= service state= all');
        const services = [];
        const lines = stdout.split('\n');

        let currentService = null;
        for (const line of lines) {
            if (line.includes('SERVICE_NAME:')) {
                if (currentService) services.push(currentService);
                currentService = { name: line.split(':')[1].trim(), status: 'unknown', type: 'service' };
            }
            if (line.includes('STATE') && currentService) {
                const running = line.includes('RUNNING');
                currentService.status = running ? 'running' : 'stopped';
            }
        }
        if (currentService) services.push(currentService);

        return services.slice(0, 50); // Limit to 50 services
    } catch (error) {
        throw new Error(`Failed to list services: ${error.message}`);
    }
}

// List services Linux (systemd)
async function listServicesLinux() {
    try {
        const { stdout } = await execPromise('systemctl list-units --type=service --all --no-pager --no-legend');
        const services = [];
        const lines = stdout.split('\n');

        for (const line of lines) {
            if (line.trim() && line.includes('.service')) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 4) {
                    const name = parts[0].replace('.service', '');
                    const loadState = parts[1]; // loaded/not-found
                    const activeState = parts[2]; // active/inactive
                    const subState = parts[3]; // running/dead/exited

                    const status = (activeState === 'active' && subState === 'running') ? 'running' : 'stopped';
                    services.push({ name, status, type: 'service', load: loadState, active: activeState });
                }
            }
        }

        return services.slice(0, 50);
    } catch (error) {
        console.error("Linux services error:", error.message);
        return []; // Return empty if systemctl not available
    }
}

// List services (platform-agnostic)
async function listServices() {
    if (isWindows()) {
        return await listServicesWindows();
    } else {
        return await listServicesLinux();
    }
}

// Start service
async function startService(name) {
    const safeName = sanitizeServiceName(name);

    if (isWindows()) {
        await execPromise(`sc start "${safeName}"`);
        return { success: true };
    } else {
        // Linux - use systemctl without sudo (assumes user has permissions)
        await execPromise(`systemctl start ${safeName}`);
        return { success: true };
    }
}

// Stop service
async function stopService(name) {
    const safeName = sanitizeServiceName(name);

    if (isWindows()) {
        await execPromise(`sc stop "${safeName}"`);
        return { success: true };
    } else {
        await execPromise(`systemctl stop ${safeName}`);
        return { success: true };
    }
}

// Restart service
async function restartService(name) {
    const safeName = sanitizeServiceName(name);

    if (isWindows()) {
        await stopService(safeName);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await startService(safeName);
        return { success: true };
    } else {
        await execPromise(`systemctl restart ${safeName}`);
        return { success: true };
    }
}

// Get service details
async function getServiceDetails(name) {
    const safeName = sanitizeServiceName(name);

    if (isWindows()) {
        try {
            const { stdout } = await execPromise(`sc query "${safeName}"`);
            const running = stdout.includes('RUNNING');
            return { name, status: running ? 'running' : 'stopped' };
        } catch (error) {
            return { name, status: 'not found' };
        }
    } else {
        try {
            const { stdout } = await execPromise(`systemctl status ${safeName}`);
            const running = stdout.includes('Active: active (running)');
            return { name, status: running ? 'running' : 'stopped' };
        } catch (error) {
            return { name, status: 'not found' };
        }
    }
}

module.exports = {
    listServices,
    startService,
    stopService,
    restartService,
    getServiceDetails,
    isWindows
};

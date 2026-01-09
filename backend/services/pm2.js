const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");

const execPromise = promisify(exec);

let pm2Available = false;

// Get install command based on platform
function getInstallCommand() {
    return {
        command: 'npm install -g pm2',
        note: 'Requires Node.js and npm to be installed'
    };
}

// Check if PM2 is available with fallback paths
async function checkPm2Available() {
    try {
        await execPromise("pm2 --version");
        pm2Available = true;
        return { available: true };
    } catch (error) {
        // Try using 'which' command on Linux
        if (process.platform !== 'win32') {
            try {
                const { stdout } = await execPromise("which pm2 2>/dev/null || command -v pm2 2>/dev/null");
                const pm2Path = stdout.trim();
                if (pm2Path) {
                    await execPromise(`"${pm2Path}" --version`);
                    pm2Available = true;
                    return { available: true, path: pm2Path };
                }
            } catch {
                // which failed
            }

            // Try finding in NVM directories
            try {
                const nvmDir = path.join(process.env.HOME || '/root', '.nvm', 'versions', 'node');
                if (fs.existsSync(nvmDir)) {
                    const versions = fs.readdirSync(nvmDir);
                    for (const ver of versions) {
                        const pm2Path = path.join(nvmDir, ver, 'bin', 'pm2');
                        if (fs.existsSync(pm2Path)) {
                            await execPromise(`"${pm2Path}" --version`);
                            pm2Available = true;
                            return { available: true, path: pm2Path };
                        }
                    }
                }
            } catch {
                // NVM search failed
            }
        }

        // Try static fallback paths
        const fallbackPaths = process.platform === 'win32'
            ? [
                path.join(process.env.APPDATA || '', 'npm', 'pm2.cmd'),
                path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'npm', 'pm2.cmd')
            ]
            : [
                '/usr/local/bin/pm2',
                '/usr/bin/pm2',
                path.join(process.env.HOME || '', '.npm-global', 'bin', 'pm2'),
                '/root/.local/bin/pm2'
            ];

        for (const pm2Path of fallbackPaths) {
            if (fs.existsSync(pm2Path)) {
                try {
                    await execPromise(`"${pm2Path}" --version`);
                    pm2Available = true;
                    return { available: true, path: pm2Path };
                } catch {
                    // Continue to next path
                }
            }
        }

        pm2Available = false;
        return {
            available: false,
            install: getInstallCommand()
        };
    }
}

// Parse PM2 list output
function parsePm2List(output) {
    try {
        const data = JSON.parse(output);
        return data.map(proc => ({
            name: proc.name,
            pid: proc.pid,
            status: proc.pm2_env.status,
            cpu: proc.monit.cpu || 0,
            memory: Math.round(proc.monit.memory / 1024 / 1024) || 0, // MB
            uptime: formatUptime(proc.pm2_env.pm_uptime),
            restarts: proc.pm2_env.restart_time || 0,
            mode: proc.pm2_env.exec_mode
        }));
    } catch (error) {
        throw new Error(`Failed to parse PM2 output: ${error.message}`);
    }
}

// Format uptime
function formatUptime(timestamp) {
    if (!timestamp) return "N/A";

    const uptimeMs = Date.now() - timestamp;
    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
}

// List all PM2 processes
async function listProcesses() {
    await checkPm2Available();

    try {
        const { stdout } = await execPromise("pm2 jlist");
        return parsePm2List(stdout);
    } catch (error) {
        throw new Error(`Failed to list PM2 processes: ${error.message}`);
    }
}

// Get specific process info
async function getProcessInfo(nameOrId) {
    await checkPm2Available();

    try {
        const processes = await listProcesses();
        const process = processes.find(p =>
            p.name === nameOrId || p.pid === parseInt(nameOrId)
        );

        if (!process) {
            throw new Error(`Process '${nameOrId}' not found`);
        }

        return process;
    } catch (error) {
        throw new Error(`Failed to get process info: ${error.message}`);
    }
}

// Start process
async function startProcess(name) {
    await checkPm2Available();

    try {
        await execPromise(`pm2 start ${name}`);
        return { success: true, message: `Process '${name}' started` };
    } catch (error) {
        throw new Error(`Failed to start process: ${error.message}`);
    }
}

// Stop process
async function stopProcess(nameOrId) {
    await checkPm2Available();

    try {
        await execPromise(`pm2 stop ${nameOrId}`);
        return { success: true, message: `Process '${nameOrId}' stopped` };
    } catch (error) {
        throw new Error(`Failed to stop process: ${error.message}`);
    }
}

// Restart process
async function restartProcess(nameOrId) {
    await checkPm2Available();

    try {
        await execPromise(`pm2 restart ${nameOrId}`);
        return { success: true, message: `Process '${nameOrId}' restarted` };
    } catch (error) {
        throw new Error(`Failed to restart process: ${error.message}`);
    }
}

// Delete process
async function deleteProcess(nameOrId) {
    await checkPm2Available();

    try {
        await execPromise(`pm2 delete ${nameOrId}`);
        return { success: true, message: `Process '${nameOrId}' deleted` };
    } catch (error) {
        throw new Error(`Failed to delete process: ${error.message}`);
    }
}

// Get process logs
async function getProcessLogs(nameOrId, lines = 100) {
    await checkPm2Available();

    try {
        const { stdout } = await execPromise(`pm2 logs ${nameOrId} --lines ${lines} --nostream`);
        return stdout;
    } catch (error) {
        throw new Error(`Failed to get logs: ${error.message}`);
    }
}

// Reload all processes
async function reloadAll() {
    await checkPm2Available();

    try {
        await execPromise("pm2 reload all");
        return { success: true, message: "All processes reloaded" };
    } catch (error) {
        throw new Error(`Failed to reload all: ${error.message}`);
    }
}

// Get PM2 info
async function getPm2Info() {
    await checkPm2Available();

    try {
        const { stdout } = await execPromise("pm2 info");
        return stdout;
    } catch (error) {
        throw new Error(`Failed to get PM2 info: ${error.message}`);
    }
}

module.exports = {
    checkPm2Available,
    listProcesses,
    getProcessInfo,
    startProcess,
    stopProcess,
    restartProcess,
    deleteProcess,
    getProcessLogs,
    reloadAll,
    getPm2Info
};

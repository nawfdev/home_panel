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
    console.log("[PM2] Starting detection...");
    console.log("[PM2] Platform:", process.platform);
    console.log("[PM2] HOME:", process.env.HOME);

    // Try direct command first
    try {
        const { stdout } = await execPromise("pm2 --version");
        if (stdout.trim()) {
            console.log("[PM2] ✅ Found via direct command:", stdout.trim());
            pm2Available = true;
            return { available: true, version: stdout.trim() };
        }
    } catch (error) {
        console.log("[PM2] ❌ Direct command failed:", error.message);
    }

    // Try with bash -l -c (login shell with NVM loaded)
    try {
        const { stdout } = await execPromise("bash -l -c 'pm2 --version'");
        if (stdout.trim()) {
            console.log("[PM2] ✅ Found via bash login shell:", stdout.trim());
            pm2Available = true;
            return { available: true, version: stdout.trim(), method: 'bash-login' };
        }
    } catch (error) {
        console.log("[PM2] ❌ Bash login shell failed:", error.message);
    }

    // Try sourcing NVM and then running pm2
    try {
        const nvmScript = process.env.NVM_DIR
            ? `${process.env.NVM_DIR}/nvm.sh`
            : `${process.env.HOME}/.nvm/nvm.sh`;
        const { stdout } = await execPromise(`bash -c 'source ${nvmScript} 2>/dev/null && pm2 --version'`);
        if (stdout.trim()) {
            console.log("[PM2] ✅ Found via NVM source:", stdout.trim());
            pm2Available = true;
            return { available: true, version: stdout.trim(), method: 'nvm-source' };
        }
    } catch (error) {
        console.log("[PM2] ❌ NVM source failed:", error.message);
    }

    // Try npx pm2
    try {
        const { stdout } = await execPromise("npx --yes pm2 --version", { timeout: 30000 });
        if (stdout.trim()) {
            console.log("[PM2] ✅ Found via npx:", stdout.trim());
            pm2Available = true;
            return { available: true, version: stdout.trim(), method: 'npx' };
        }
    } catch (error) {
        console.log("[PM2] ❌ npx failed:", error.message);
    }

    // Linux/Mac: Try which command
    if (process.platform !== 'win32') {
        try {
            const { stdout } = await execPromise("which pm2 2>/dev/null || command -v pm2 2>/dev/null");
            const pm2Path = stdout.trim();
            console.log("[PM2] which pm2 result:", pm2Path || "(empty)");
            if (pm2Path && fs.existsSync(pm2Path)) {
                const { stdout: version } = await execPromise(`"${pm2Path}" --version`);
                console.log("[PM2] ✅ Found via which:", version.trim());
                pm2Available = true;
                return { available: true, version: version.trim(), path: pm2Path };
            }
        } catch (error) {
            console.log("[PM2] ❌ which command failed:", error.message);
        }

        // Try NVM directories
        const nvmDirs = [
            path.join(process.env.HOME || '', '.nvm', 'versions', 'node'),
            '/root/.nvm/versions/node',
            '/home'  // Will scan subdirs
        ];

        for (const nvmDir of nvmDirs) {
            console.log("[PM2] Checking NVM dir:", nvmDir);
            if (fs.existsSync(nvmDir)) {
                try {
                    let versions;
                    if (nvmDir === '/home') {
                        // Scan /home/*/. nvm/versions/node
                        const users = fs.readdirSync('/home');
                        for (const user of users) {
                            const userNvmDir = `/home/${user}/.nvm/versions/node`;
                            if (fs.existsSync(userNvmDir)) {
                                console.log("[PM2] Found user NVM dir:", userNvmDir);
                                versions = fs.readdirSync(userNvmDir).sort().reverse();
                                for (const ver of versions) {
                                    const pm2Path = path.join(userNvmDir, ver, 'bin', 'pm2');
                                    console.log("[PM2] Checking:", pm2Path, "exists:", fs.existsSync(pm2Path));
                                    if (fs.existsSync(pm2Path)) {
                                        const { stdout } = await execPromise(`"${pm2Path}" --version`);
                                        console.log("[PM2] ✅ Found in user NVM:", stdout.trim());
                                        pm2Available = true;
                                        return { available: true, version: stdout.trim(), path: pm2Path };
                                    }
                                }
                            }
                        }
                    } else {
                        versions = fs.readdirSync(nvmDir).sort().reverse();
                        console.log("[PM2] NVM versions found:", versions.join(", "));
                        for (const ver of versions) {
                            const pm2Path = path.join(nvmDir, ver, 'bin', 'pm2');
                            console.log("[PM2] Checking:", pm2Path, "exists:", fs.existsSync(pm2Path));
                            if (fs.existsSync(pm2Path)) {
                                const { stdout } = await execPromise(`"${pm2Path}" --version`);
                                console.log("[PM2] ✅ Found in NVM:", stdout.trim());
                                pm2Available = true;
                                return { available: true, version: stdout.trim(), path: pm2Path };
                            }
                        }
                    }
                } catch (error) {
                    console.log("[PM2] ❌ NVM dir scan error:", error.message);
                }
            } else {
                console.log("[PM2] NVM dir not found:", nvmDir);
            }
        }

        // Static fallback paths
        const fallbackPaths = [
            '/usr/local/bin/pm2',
            '/usr/bin/pm2',
            path.join(process.env.HOME || '', '.npm-global', 'bin', 'pm2'),
            path.join(process.env.HOME || '', 'node_modules', '.bin', 'pm2')
        ];

        for (const pm2Path of fallbackPaths) {
            console.log("[PM2] Checking fallback:", pm2Path, "exists:", fs.existsSync(pm2Path));
            if (fs.existsSync(pm2Path)) {
                try {
                    const { stdout } = await execPromise(`"${pm2Path}" --version`);
                    console.log("[PM2] ✅ Found in fallback:", stdout.trim());
                    pm2Available = true;
                    return { available: true, version: stdout.trim(), path: pm2Path };
                } catch (error) {
                    console.log("[PM2] ❌ Fallback exec error:", error.message);
                }
            }
        }
    }

    // Windows specific
    if (process.platform === 'win32') {
        // ... Windows code stays the same
    }

    console.log("[PM2] ❌ Not found after all checks");
    pm2Available = false;
    return {
        available: false,
        install: getInstallCommand()
    };
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

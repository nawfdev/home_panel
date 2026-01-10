const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");

const execPromise = promisify(exec);

let pm2Available = false;
let pm2Command = "pm2"; // Will be updated if we find PM2 in a specific path

// Get install command based on platform
function getInstallCommand() {
    return {
        command: 'npm install -g pm2',
        note: 'Requires Node.js and npm to be installed'
    };
}

// Execute PM2 command using the correct path/method
async function execPm2(args) {
    // Try stored command first
    try {
        const { stdout, stderr } = await execPromise(`${pm2Command} ${args}`);
        return stdout;
    } catch (error) {
        // If stored command fails, try bash -l -c (login shell)
        if (process.platform !== 'win32') {
            try {
                const { stdout } = await execPromise(`bash -l -c 'pm2 ${args}'`);
                return stdout;
            } catch {
                throw error; // Rethrow original error
            }
        }
        throw error;
    }
}

// Check if PM2 is available with fallback paths
async function checkPm2Available() {
    console.log("[PM2] Starting detection on", process.platform);

    // 1. Try direct command first (works if pm2 is in PATH)
    try {
        const { stdout } = await execPromise("pm2 --version");
        if (stdout.trim()) {
            console.log("[PM2] ✅ Found via direct command:", stdout.trim());
            pm2Available = true;
            pm2Command = "pm2";
            return { available: true, version: stdout.trim() };
        }
    } catch (error) {
        console.log("[PM2] Direct command not in PATH");
    }

    // 2. Try bash login shell (loads ~/.bashrc which has NVM)
    if (process.platform !== 'win32') {
        try {
            const { stdout } = await execPromise("bash -l -c 'pm2 --version'");
            if (stdout.trim()) {
                console.log("[PM2] ✅ Found via bash login shell:", stdout.trim());
                pm2Available = true;
                pm2Command = "bash -l -c 'pm2'";
                return { available: true, version: stdout.trim(), method: 'bash-login' };
            }
        } catch (error) {
            console.log("[PM2] Bash login shell failed:", error.message);
        }

        // 2.5 Try hardcoded known paths first (user confirmed this works)
        const knownPaths = [
            '/root/.nvm/versions/node/v20.19.6/bin/pm2',
            '/root/.nvm/versions/node/v22.0.0/bin/pm2',
            '/root/.nvm/versions/node/v21.0.0/bin/pm2',
            '/root/.nvm/versions/node/v18.0.0/bin/pm2'
        ];

        for (const pm2Path of knownPaths) {
            console.log("[PM2] Checking known path:", pm2Path);
            if (fs.existsSync(pm2Path)) {
                try {
                    const { stdout } = await execPromise(`${pm2Path} --version`);
                    console.log("[PM2] ✅ Found at known path:", stdout.trim());
                    pm2Available = true;
                    pm2Command = pm2Path;
                    return { available: true, version: stdout.trim(), path: pm2Path };
                } catch (error) {
                    console.log("[PM2] Known path failed:", error.message);
                }
            }
        }
    }

    // 3. Try specific NVM paths (dynamic scan)
    if (process.platform !== 'win32') {
        const home = process.env.HOME || '/root';
        const nvmNodeDir = path.join(home, '.nvm', 'versions', 'node');

        console.log("[PM2] Checking NVM directory:", nvmNodeDir);

        if (fs.existsSync(nvmNodeDir)) {
            try {
                const versions = fs.readdirSync(nvmNodeDir).sort().reverse();
                console.log("[PM2] Found node versions:", versions.join(", "));

                for (const ver of versions) {
                    const pm2Path = path.join(nvmNodeDir, ver, 'bin', 'pm2');
                    if (fs.existsSync(pm2Path)) {
                        console.log("[PM2] Found PM2 at:", pm2Path);
                        try {
                            const { stdout } = await execPromise(`"${pm2Path}" --version`);
                            console.log("[PM2] ✅ PM2 version:", stdout.trim());
                            pm2Available = true;
                            pm2Command = `"${pm2Path}"`;
                            return { available: true, version: stdout.trim(), path: pm2Path };
                        } catch (error) {
                            console.log("[PM2] Could not execute:", error.message);
                        }
                    }
                }
            } catch (error) {
                console.log("[PM2] Error scanning NVM dir:", error.message);
            }
        }

        // Also check /root/.nvm specifically
        const rootNvmDir = '/root/.nvm/versions/node';
        if (rootNvmDir !== nvmNodeDir && fs.existsSync(rootNvmDir)) {
            try {
                const versions = fs.readdirSync(rootNvmDir).sort().reverse();
                for (const ver of versions) {
                    const pm2Path = path.join(rootNvmDir, ver, 'bin', 'pm2');
                    if (fs.existsSync(pm2Path)) {
                        const { stdout } = await execPromise(`"${pm2Path}" --version`);
                        console.log("[PM2] ✅ Found in /root NVM:", stdout.trim());
                        pm2Available = true;
                        pm2Command = `"${pm2Path}"`;
                        return { available: true, version: stdout.trim(), path: pm2Path };
                    }
                }
            } catch { }
        }

        // Static fallback paths
        const fallbackPaths = [
            '/usr/local/bin/pm2',
            '/usr/bin/pm2',
            path.join(home, '.npm-global', 'bin', 'pm2')
        ];

        for (const pm2Path of fallbackPaths) {
            if (fs.existsSync(pm2Path)) {
                try {
                    const { stdout } = await execPromise(`"${pm2Path}" --version`);
                    console.log("[PM2] ✅ Found at:", pm2Path);
                    pm2Available = true;
                    pm2Command = `"${pm2Path}"`;
                    return { available: true, version: stdout.trim(), path: pm2Path };
                } catch { }
            }
        }
    }

    // Windows specific
    if (process.platform === 'win32') {
        const windowsPaths = [
            path.join(process.env.APPDATA || '', 'npm', 'pm2.cmd'),
            path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'npm', 'pm2.cmd')
        ];

        for (const pm2Path of windowsPaths) {
            if (fs.existsSync(pm2Path)) {
                try {
                    const { stdout } = await execPromise(`"${pm2Path}" --version`);
                    pm2Available = true;
                    pm2Command = `"${pm2Path}"`;
                    return { available: true, version: stdout.trim(), path: pm2Path };
                } catch { }
            }
        }
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
        return data.map(proc => {
            // Try to extract port from various sources
            let port = null;

            // Check pm2_env.env.PORT
            if (proc.pm2_env && proc.pm2_env.env && proc.pm2_env.env.PORT) {
                port = proc.pm2_env.env.PORT;
            }
            // Check pm2_env.PORT
            else if (proc.pm2_env && proc.pm2_env.PORT) {
                port = proc.pm2_env.PORT;
            }
            // Check args for --port or -p
            else if (proc.pm2_env && proc.pm2_env.args) {
                const args = Array.isArray(proc.pm2_env.args) ? proc.pm2_env.args.join(' ') : proc.pm2_env.args;
                const portMatch = args.match(/(?:--port|-p)\s*[=\s]?\s*(\d+)/i);
                if (portMatch) {
                    port = portMatch[1];
                }
            }
            // Try to extract from pm_exec_path or script if contains port
            else if (proc.pm2_env && proc.pm2_env.pm_exec_path) {
                const scriptMatch = proc.pm2_env.pm_exec_path.match(/:(\d{4,5})$/);
                if (scriptMatch) {
                    port = scriptMatch[1];
                }
            }

            return {
                name: proc.name,
                pid: proc.pid,
                status: proc.pm2_env.status,
                cpu: proc.monit.cpu || 0,
                memory: Math.round(proc.monit.memory / 1024 / 1024) || 0, // MB
                uptime: formatUptime(proc.pm2_env.pm_uptime),
                restarts: proc.pm2_env.restart_time || 0,
                mode: proc.pm2_env.exec_mode,
                port: port,
                cwd: proc.pm2_env.pm_cwd || null
            };
        });
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
    if (!pm2Available) {
        await checkPm2Available();
    }

    try {
        const stdout = await execPm2("jlist");
        return parsePm2List(stdout);
    } catch (error) {
        throw new Error(`Failed to list PM2 processes: ${error.message}`);
    }
}

// Get specific process info
async function getProcessInfo(nameOrId) {
    if (!pm2Available) {
        await checkPm2Available();
    }

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
    if (!pm2Available) {
        await checkPm2Available();
    }

    try {
        await execPm2(`start ${name}`);
        return { success: true, message: `Process '${name}' started` };
    } catch (error) {
        throw new Error(`Failed to start process: ${error.message}`);
    }
}

// Stop process
async function stopProcess(nameOrId) {
    if (!pm2Available) {
        await checkPm2Available();
    }

    try {
        await execPm2(`stop ${nameOrId}`);
        return { success: true, message: `Process '${nameOrId}' stopped` };
    } catch (error) {
        throw new Error(`Failed to stop process: ${error.message}`);
    }
}

// Restart process
async function restartProcess(nameOrId) {
    if (!pm2Available) {
        await checkPm2Available();
    }

    try {
        await execPm2(`restart ${nameOrId}`);
        return { success: true, message: `Process '${nameOrId}' restarted` };
    } catch (error) {
        throw new Error(`Failed to restart process: ${error.message}`);
    }
}

// Delete process
async function deleteProcess(nameOrId) {
    if (!pm2Available) {
        await checkPm2Available();
    }

    try {
        await execPm2(`delete ${nameOrId}`);
        return { success: true, message: `Process '${nameOrId}' deleted` };
    } catch (error) {
        throw new Error(`Failed to delete process: ${error.message}`);
    }
}

// Get process logs
async function getProcessLogs(nameOrId, lines = 100) {
    if (!pm2Available) {
        await checkPm2Available();
    }

    try {
        const stdout = await execPm2(`logs ${nameOrId} --lines ${lines} --nostream`);
        return stdout;
    } catch (error) {
        throw new Error(`Failed to get logs: ${error.message}`);
    }
}

// Reload all processes
async function reloadAll() {
    if (!pm2Available) {
        await checkPm2Available();
    }

    try {
        await execPm2("reload all");
        return { success: true, message: "All processes reloaded" };
    } catch (error) {
        throw new Error(`Failed to reload all: ${error.message}`);
    }
}

// Get PM2 info
async function getPm2Info() {
    if (!pm2Available) {
        await checkPm2Available();
    }

    try {
        const stdout = await execPm2("info");
        return stdout;
    } catch (error) {
        throw new Error(`Failed to get PM2 info: ${error.message}`);
    }
}

// Start a new app
async function startNewApp(name, script) {
    if (!pm2Available) {
        await checkPm2Available();
    }

    try {
        // Build command
        let cmd = `start "${script}"`;
        if (name) {
            cmd += ` --name "${name}"`;
        }

        await execPm2(cmd);
        return { success: true, message: `App started: ${name || script}` };
    } catch (error) {
        throw new Error(`Failed to start app: ${error.message}`);
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
    getPm2Info,
    startNewApp
};

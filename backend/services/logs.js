const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");

const execPromise = promisify(exec);

// Get available log sources
async function getLogSources() {
    const sources = [
        { id: "panel", name: "Panel Application", type: "file" },
        { id: "docker", name: "Docker Containers", type: "docker", available: false },
        { id: "pm2", name: "PM2 Processes", type: "pm2", available: false }
    ];

    // Check Docker availability
    try {
        const dockerService = require("./docker");
        const dockerStatus = await dockerService.checkDockerAvailable();
        const dockerAvailable = dockerStatus.available;
        const dockerSource = sources.find(s => s.id === "docker");
        if (dockerSource) dockerSource.available = dockerAvailable;
    } catch (err) {
        // Docker not available
    }

    // Check PM2 availability
    try {
        const pm2Service = require("./pm2");
        const pm2Status = await pm2Service.checkPm2Available();
        const pm2Available = pm2Status.available;
        const pm2Source = sources.find(s => s.id === "pm2");
        if (pm2Source) pm2Source.available = pm2Available;
    } catch (err) {
        // PM2 not available
    }

    return sources;
}

// Read panel logs
async function readPanelLogs(lines = 100) {
    const logFile = path.join(__dirname, "../../logs/panel.log");

    try {
        if (!fs.existsSync(logFile)) {
            return "No logs available yet";
        }

        if (process.platform === "win32") {
            const { stdout } = await execPromise(`powershell -Command "Get-Content '${logFile}' -Tail ${lines}"`);
            return stdout;
        } else {
            const { stdout } = await execPromise(`tail -n ${lines} "${logFile}"`);
            return stdout;
        }
    } catch (error) {
        return `Error reading logs: ${error.message}`;
    }
}

// Read Docker container logs
async function readDockerLogs(containerName, lines = 100) {
    try {
        const dockerService = require("./docker");
        const containers = await dockerService.listContainers();
        const container = containers.find(c => c.name === containerName);

        if (!container) {
            return `Container "${containerName}" not found`;
        }

        const logs = await dockerService.getContainerLogs(container.id, lines);
        return logs;
    } catch (error) {
        return `Error reading Docker logs: ${error.message}`;
    }
}

// Read PM2 process logs
async function readPm2Logs(processName, lines = 100) {
    try {
        const pm2Service = require("./pm2");
        const logs = await pm2Service.getProcessLogs(processName, lines);
        return logs;
    } catch (error) {
        return `Error reading PM2 logs: ${error.message}`;
    }
}

// Get logs from source
async function getLogsFromSource(sourceId, target, lines = 100) {
    switch (sourceId) {
        case "panel":
            return await readPanelLogs(lines);

        case "docker":
            if (!target) {
                return "Please specify a container name";
            }
            return await readDockerLogs(target, lines);

        case "pm2":
            if (!target) {
                return "Please specify a process name";
            }
            return await readPm2Logs(target, lines);

        default:
            return "Unknown log source";
    }
}

// Get targets for a source (e.g., list of containers or processes)
async function getLogTargets(sourceId) {
    switch (sourceId) {
        case "docker":
            try {
                const dockerService = require("./docker");
                const containers = await dockerService.listContainers();
                return containers.map(c => ({ id: c.name, name: c.name }));
            } catch (err) {
                return [];
            }

        case "pm2":
            try {
                const pm2Service = require("./pm2");
                const processes = await pm2Service.listProcesses();
                return processes.map(p => ({ id: p.name, name: p.name }));
            } catch (err) {
                return [];
            }

        default:
            return [];
    }
}

// Search in logs
function searchInLogs(logs, query) {
    if (!query) return logs;

    const lines = logs.split('\n');
    const filtered = lines.filter(line =>
        line.toLowerCase().includes(query.toLowerCase())
    );

    return filtered.join('\n');
}

module.exports = {
    getLogSources,
    getLogsFromSource,
    getLogTargets,
    searchInLogs
};

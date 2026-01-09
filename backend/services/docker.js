const Docker = require("dockerode");

let docker = null;
let dockerAvailable = false;

// Get install command based on platform
function getInstallCommand() {
    if (process.platform === 'win32') {
        return {
            command: 'Download from https://www.docker.com/products/docker-desktop',
            note: 'Install Docker Desktop for Windows'
        };
    } else if (process.platform === 'darwin') {
        return {
            command: 'brew install --cask docker',
            note: 'Or download from https://www.docker.com/products/docker-desktop'
        };
    } else {
        return {
            command: 'curl -fsSL https://get.docker.com | sh',
            note: 'Then run: sudo usermod -aG docker $USER && newgrp docker'
        };
    }
}

// Initialize Docker
function initDocker() {
    try {
        docker = new Docker();
        dockerAvailable = true;
        return true;
    } catch (error) {
        console.log("⚠️  Docker not available:", error.message);
        dockerAvailable = false;
        return false;
    }
}

// Check if Docker is available
async function checkDockerAvailable() {
    if (!docker) {
        initDocker();
    }

    if (!dockerAvailable) {
        return {
            available: false,
            reason: 'Docker not installed',
            install: getInstallCommand()
        };
    }

    try {
        await docker.ping();
        return { available: true };
    } catch (error) {
        return {
            available: false,
            reason: 'Docker daemon not running',
            install: getInstallCommand()
        };
    }
}

// List all containers
async function listContainers(all = false) {
    await checkDockerAvailable();

    try {
        const containers = await docker.listContainers({ all });

        return containers.map(container => ({
            id: container.Id.substring(0, 12),
            name: container.Names[0].replace("/", ""),
            image: container.Image,
            state: container.State,
            status: container.Status,
            uptime: container.Status,
            ports: container.Ports.map(p =>
                p.PublicPort ? `${p.PublicPort}:${p.PrivatePort}` : p.PrivatePort
            ).join(", ")
        }));
    } catch (error) {
        throw new Error(`Failed to list containers: ${error.message}`);
    }
}

// Get container by name or ID
async function getContainer(nameOrId) {
    await checkDockerAvailable();

    try {
        const containers = await docker.listContainers({ all: true });
        const containerInfo = containers.find(c =>
            c.Id.startsWith(nameOrId) ||
            c.Names.some(name => name.includes(nameOrId))
        );

        if (!containerInfo) {
            throw new Error(`Container '${nameOrId}' not found`);
        }

        return docker.getContainer(containerInfo.Id);
    } catch (error) {
        throw new Error(`Failed to get container: ${error.message}`);
    }
}

// Start container
async function startContainer(nameOrId) {
    await checkDockerAvailable();

    try {
        const container = await getContainer(nameOrId);
        await container.start();
        return { success: true, message: `Container '${nameOrId}' started` };
    } catch (error) {
        throw new Error(`Failed to start container: ${error.message}`);
    }
}

// Stop container
async function stopContainer(nameOrId) {
    await checkDockerAvailable();

    try {
        const container = await getContainer(nameOrId);
        await container.stop();
        return { success: true, message: `Container '${nameOrId}' stopped` };
    } catch (error) {
        throw new Error(`Failed to stop container: ${error.message}`);
    }
}

// Restart container
async function restartContainer(nameOrId) {
    await checkDockerAvailable();

    try {
        const container = await getContainer(nameOrId);
        await container.restart();
        return { success: true, message: `Container '${nameOrId}' restarted` };
    } catch (error) {
        throw new Error(`Failed to restart container: ${error.message}`);
    }
}

// Get container logs
async function getContainerLogs(nameOrId, lines = 100) {
    await checkDockerAvailable();

    try {
        const container = await getContainer(nameOrId);
        const logs = await container.logs({
            stdout: true,
            stderr: true,
            tail: lines
        });

        return logs.toString('utf8');
    } catch (error) {
        throw new Error(`Failed to get logs: ${error.message}`);
    }
}

// Get container stats
async function getContainerStats(nameOrId) {
    await checkDockerAvailable();

    try {
        const container = await getContainer(nameOrId);
        const stats = await container.stats({ stream: false });

        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
        const cpuPercent = (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;

        const memUsage = stats.memory_stats.usage;
        const memLimit = stats.memory_stats.limit;
        const memPercent = (memUsage / memLimit) * 100;

        return {
            cpu: cpuPercent.toFixed(2),
            memory: {
                usage: memUsage,
                limit: memLimit,
                percent: memPercent.toFixed(2)
            },
            network: stats.networks
        };
    } catch (error) {
        throw new Error(`Failed to get stats: ${error.message}`);
    }
}

// Initialize on module load
initDocker();

module.exports = {
    checkDockerAvailable,
    listContainers,
    startContainer,
    stopContainer,
    restartContainer,
    getContainerLogs,
    getContainerStats
};

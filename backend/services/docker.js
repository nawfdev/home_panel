const Docker = require("dockerode");
const { exec } = require("child_process");
const { promisify } = require("util");

const execPromise = promisify(exec);

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

// Initialize Docker with multiple socket options
function initDocker() {
    const socketPaths = process.platform === 'win32'
        ? ['//./pipe/docker_engine', 'npipe:////./pipe/docker_engine']
        : ['/var/run/docker.sock', '/run/docker.sock', `${process.env.HOME}/.docker/run/docker.sock`];

    for (const socketPath of socketPaths) {
        try {
            if (process.platform === 'win32') {
                docker = new Docker({ socketPath });
            } else {
                const fs = require('fs');
                if (fs.existsSync(socketPath)) {
                    docker = new Docker({ socketPath });
                    dockerAvailable = true;
                    console.log(`✅ Docker initialized with socket: ${socketPath}`);
                    return true;
                }
            }
        } catch (error) {
            // Try next socket
        }
    }

    // Try default (no options)
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

// Check if Docker is available (also try CLI)
async function checkDockerAvailable() {
    // First try dockerode
    if (!docker) {
        initDocker();
    }

    if (docker) {
        try {
            await docker.ping();
            return { available: true, method: 'dockerode' };
        } catch (error) {
            // dockerode failed, try CLI
        }
    }

    // Try docker CLI directly
    try {
        const { stdout } = await execPromise("docker info --format '{{.ServerVersion}}'");
        if (stdout.trim()) {
            // Docker CLI works, reinitialize dockerode
            docker = new Docker();
            dockerAvailable = true;
            return { available: true, version: stdout.trim(), method: 'cli' };
        }
    } catch (error) {
        // Docker CLI also failed
    }

    // Try docker version command (simpler)
    try {
        const { stdout } = await execPromise("docker --version");
        if (stdout.includes("Docker")) {
            // Docker is installed but daemon might not be running
            return {
                available: false,
                reason: 'Docker installed but daemon not running. Start Docker Desktop or run: sudo systemctl start docker',
                install: getInstallCommand()
            };
        }
    } catch { }

    dockerAvailable = false;
    return {
        available: false,
        reason: 'Docker not installed',
        install: getInstallCommand()
    };
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

// Run a new container
async function runContainer(name, image, ports) {
    const available = await checkDockerAvailable();
    if (!available.available) {
        throw new Error("Docker is not available");
    }

    try {
        // Parse ports (format: "8080:80" or "3000:3000")
        const portBindings = {};
        const exposedPorts = {};

        if (ports) {
            const portMappings = ports.split(',').map(p => p.trim());
            for (const mapping of portMappings) {
                const [hostPort, containerPort] = mapping.split(':');
                const port = containerPort || hostPort;
                exposedPorts[`${port}/tcp`] = {};
                portBindings[`${port}/tcp`] = [{ HostPort: hostPort }];
            }
        }

        // Pull image first
        console.log(`[Docker] Pulling image: ${image}`);
        await new Promise((resolve, reject) => {
            docker.pull(image, (err, stream) => {
                if (err) return reject(err);
                docker.modem.followProgress(stream, (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        });

        // Create container
        const containerConfig = {
            Image: image,
            ExposedPorts: exposedPorts,
            HostConfig: {
                PortBindings: portBindings,
                RestartPolicy: { Name: 'unless-stopped' }
            }
        };

        if (name) {
            containerConfig.name = name;
        }

        console.log(`[Docker] Creating container from ${image}`);
        const container = await docker.createContainer(containerConfig);
        await container.start();

        return { success: true, containerId: container.id };
    } catch (error) {
        throw new Error(`Failed to run container: ${error.message}`);
    }
}

// Remove container
async function removeContainer(nameOrId) {
    const available = await checkDockerAvailable();
    if (!available.available) {
        throw new Error("Docker is not available");
    }

    try {
        const container = await getContainer(nameOrId);

        // Stop if running
        try {
            await container.stop();
        } catch (e) {
            // Might already be stopped
        }

        await container.remove();
        return { success: true, message: `Container '${nameOrId}' removed` };
    } catch (error) {
        throw new Error(`Failed to remove container: ${error.message}`);
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
    getContainerStats,
    runContainer,
    removeContainer
};

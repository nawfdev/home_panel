const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("./auth");
const archiver = require("archiver");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const { promisify } = require("util");

const execPromise = promisify(exec);

// Patterns to exclude from export
const EXCLUDE_PATTERNS = [
    'node_modules',
    '.git',
    '.env',
    'dist',
    'build',
    '.next',
    '__pycache__',
    '*.log',
    '.cache',
    'coverage',
    '.nyc_output',
    'vendor',  // PHP composer
    'venv',    // Python virtual env
    '.venv'
];

// Get PM2 process working directory
async function getPm2ProcessPath(processName) {
    try {
        const { stdout } = await execPromise(`pm2 jlist`);
        const processes = JSON.parse(stdout);
        const proc = processes.find(p => p.name === processName);

        if (proc && proc.pm2_env && proc.pm2_env.pm_cwd) {
            return proc.pm2_env.pm_cwd;
        }
        return null;
    } catch (e) {
        console.error("Error getting PM2 path:", e);
        return null;
    }
}

// Get Docker container working directory (mount paths)
async function getDockerContainerMounts(containerId) {
    try {
        const { stdout } = await execPromise(`docker inspect ${containerId} --format "{{json .Mounts}}"`);
        const mounts = JSON.parse(stdout);

        // Get source paths from bind mounts
        const paths = mounts
            .filter(m => m.Type === 'bind')
            .map(m => m.Source);

        return paths.length > 0 ? paths[0] : null;
    } catch (e) {
        console.error("Error getting Docker mounts:", e);
        return null;
    }
}

// Check if path should be excluded
function shouldExclude(filePath) {
    const basename = path.basename(filePath);
    return EXCLUDE_PATTERNS.some(pattern => {
        if (pattern.includes('*')) {
            // Simple wildcard matching
            const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
            return regex.test(basename);
        }
        return basename === pattern;
    });
}

// Export PM2 project
router.get("/pm2/:name", isAuthenticated, async (req, res) => {
    const processName = req.params.name;

    try {
        const projectPath = await getPm2ProcessPath(processName);

        if (!projectPath || !fs.existsSync(projectPath)) {
            return res.status(404).json({
                success: false,
                error: "Project path not found. Make sure the PM2 process is running."
            });
        }

        const zipName = `${processName}-${Date.now()}.zip`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

        const archive = archiver('zip', { zlib: { level: 5 } });

        archive.on('error', (err) => {
            console.error("Archive error:", err);
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        archive.pipe(res);

        // Add files recursively, excluding patterns
        archive.glob('**/*', {
            cwd: projectPath,
            ignore: EXCLUDE_PATTERNS,
            dot: true
        });

        await archive.finalize();

    } catch (error) {
        console.error("Export error:", error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

// Export Docker project (from mount path)
router.get("/docker/:id", isAuthenticated, async (req, res) => {
    const containerId = req.params.id;

    try {
        const projectPath = await getDockerContainerMounts(containerId);

        if (!projectPath || !fs.existsSync(projectPath)) {
            return res.status(404).json({
                success: false,
                error: "No bind mount found or path doesn't exist. Container might be using volumes instead of bind mounts."
            });
        }

        const containerName = containerId.substring(0, 12);
        const zipName = `docker-${containerName}-${Date.now()}.zip`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

        const archive = archiver('zip', { zlib: { level: 5 } });

        archive.on('error', (err) => {
            console.error("Archive error:", err);
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        archive.pipe(res);

        // Add files recursively, excluding patterns
        archive.glob('**/*', {
            cwd: projectPath,
            ignore: EXCLUDE_PATTERNS,
            dot: true
        });

        await archive.finalize();

    } catch (error) {
        console.error("Export error:", error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

module.exports = router;

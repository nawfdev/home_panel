const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execPromise = promisify(exec);

// Get the project root directory
const projectRoot = path.join(__dirname, '../..');

// Check if there are updates available
async function checkForUpdates() {
    try {
        // Fetch latest from remote
        await execPromise('git fetch origin', { cwd: projectRoot });

        // Get current commit
        const { stdout: localCommit } = await execPromise('git rev-parse HEAD', { cwd: projectRoot });

        // Get remote commit
        const { stdout: remoteCommit } = await execPromise('git rev-parse origin/main', { cwd: projectRoot });

        // Get commit counts
        const { stdout: behindCount } = await execPromise('git rev-list HEAD..origin/main --count', { cwd: projectRoot });

        // Get current version from package.json
        const packagePath = path.join(projectRoot, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

        // Get commit messages for pending updates
        let pendingChanges = [];
        if (parseInt(behindCount.trim()) > 0) {
            const { stdout: logOutput } = await execPromise(
                'git log HEAD..origin/main --oneline --format="%s"',
                { cwd: projectRoot }
            );
            pendingChanges = logOutput.trim().split('\n').filter(Boolean);
        }

        return {
            currentVersion: pkg.version,
            localCommit: localCommit.trim().substring(0, 7),
            remoteCommit: remoteCommit.trim().substring(0, 7),
            updateAvailable: localCommit.trim() !== remoteCommit.trim(),
            behindBy: parseInt(behindCount.trim()) || 0,
            pendingChanges
        };
    } catch (error) {
        console.error('Update check error:', error.message);
        return {
            error: error.message,
            updateAvailable: false
        };
    }
}

// Apply updates from remote
async function applyUpdates() {
    try {
        // Stash any local changes
        await execPromise('git stash', { cwd: projectRoot });

        // Pull latest changes
        const { stdout, stderr } = await execPromise('git pull origin main', { cwd: projectRoot });

        // Install any new dependencies
        await execPromise('npm install --production', { cwd: projectRoot });

        return {
            success: true,
            message: 'Update applied successfully. Please restart the server.',
            output: stdout || stderr,
            needsRestart: true
        };
    } catch (error) {
        console.error('Update apply error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// Get current git info
async function getGitInfo() {
    try {
        const { stdout: branch } = await execPromise('git branch --show-current', { cwd: projectRoot });
        const { stdout: commit } = await execPromise('git rev-parse --short HEAD', { cwd: projectRoot });
        const { stdout: remoteUrl } = await execPromise('git remote get-url origin', { cwd: projectRoot });

        return {
            branch: branch.trim(),
            commit: commit.trim(),
            remoteUrl: remoteUrl.trim()
        };
    } catch (error) {
        return {
            error: error.message
        };
    }
}

module.exports = {
    checkForUpdates,
    applyUpdates,
    getGitInfo
};

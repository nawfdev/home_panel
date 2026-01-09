const express = require("express");
const router = express.Router();
const { isAuthenticated } = require("./auth");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const os = require("os");

// Configure upload with size limit (10MB)
const upload = multer({
    dest: path.join(os.tmpdir(), 'panel-uploads'),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB max
    }
});

// Safe base paths - users can only access these
const SAFE_BASE_PATHS = {
    windows: ['C:\\Users', 'C:\\temp', 'C:\\logs'],
    linux: ['/home', '/tmp', '/var/log', '/opt']
};

// System paths that are BLOCKED
const BLOCKED_PATHS = [
    '/etc/shadow',
    '/etc/passwd',
    'C:\\Windows\\System32',
    'C:\\Program Files',
    '/root',
    '/sys',
    '/proc'
];

// Check if path is safe
function isPathSafe(fullPath) {
    const normalized = path.normalize(fullPath);

    // Check blocked paths
    for (const blocked of BLOCKED_PATHS) {
        if (normalized.toLowerCase().includes(blocked.toLowerCase())) {
            return false;
        }
    }

    // Check if within safe base paths
    const isWindows = process.platform === 'win32';
    const safePaths = isWindows ? SAFE_BASE_PATHS.windows : SAFE_BASE_PATHS.linux;

    return safePaths.some(safePath => normalized.startsWith(safePath));
}

// Get safe absolute path
function getSafePath(userPath) {
    if (!userPath || userPath === '/') {
        return process.platform === 'win32' ? 'C:\\Users' : '/home';
    }

    // Normalize and make absolute
    let fullPath = path.normalize(userPath);
    if (!path.isAbsolute(fullPath)) {
        fullPath = path.join(process.platform === 'win32' ? 'C:\\' : '/', fullPath);
    }

    // Security check
    if (!isPathSafe(fullPath)) {
        throw new Error('Access to this path is restricted');
    }

    return fullPath;
}

// List directory contents
router.post("/list", isAuthenticated, async (req, res) => {
    try {
        const { path: userPath } = req.body;
        const fullPath = getSafePath(userPath);

        console.log(`📁 [${req.session.user.username}] List: ${fullPath}`);

        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ success: false, error: "Path not found" });
        }

        const stats = fs.statSync(fullPath);
        if (!stats.isDirectory()) {
            return res.status(400).json({ success: false, error: "Not a directory" });
        }

        const items = fs.readdirSync(fullPath).map(name => {
            const itemPath = path.join(fullPath, name);
            try {
                const itemStats = fs.statSync(itemPath);
                return {
                    name,
                    path: itemPath,
                    isDirectory: itemStats.isDirectory(),
                    size: itemStats.size,
                    modified: itemStats.mtime
                };
            } catch (err) {
                return null;
            }
        }).filter(Boolean);

        res.json({
            success: true,
            path: fullPath,
            items
        });
    } catch (error) {
        console.error('Files list error:', error);
        res.status(403).json({ success: false, error: error.message });
    }
});

// Read file content
router.post("/read", isAuthenticated, async (req, res) => {
    try {
        const { path: userPath } = req.body;
        const fullPath = getSafePath(userPath);

        console.log(`📄 [${req.session.user.username}] Read: ${fullPath}`);

        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ success: false, error: "File not found" });
        }

        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) {
            return res.status(400).json({ success: false, error: "Cannot read directory" });
        }

        // Only read text files (< 1MB)
        if (stats.size > 1024 * 1024) {
            return res.status(400).json({ success: false, error: "File too large (max 1MB)" });
        }

        const content = fs.readFileSync(fullPath, 'utf-8');
        res.json({ success: true, content });
    } catch (error) {
        res.status(403).json({ success: false, error: error.message });
    }
});

// Write file content
router.post("/write", isAuthenticated, async (req, res) => {
    try {
        const { path: userPath, content } = req.body;
        const fullPath = getSafePath(userPath);

        console.log(`✏️  [${req.session.user.username}] Write: ${fullPath}`);

        // Check file doesn't end with dangerous extensions
        const ext = path.extname(fullPath).toLowerCase();
        const dangerousExts = ['.exe', '.dll', '.sys', '.bat', '.cmd', '.ps1'];
        if (dangerousExts.includes(ext)) {
            return res.status(403).json({ success: false, error: 'Cannot write executable files' });
        }

        fs.writeFileSync(fullPath, content, 'utf-8');
        res.json({ success: true, message: "File saved" });
    } catch (error) {
        res.status(403).json({ success: false, error: error.message });
    }
});

// Delete file/directory
router.post("/delete", isAuthenticated, async (req, res) => {
    try {
        const { path: userPath } = req.body;
        const fullPath = getSafePath(userPath);

        console.log(`🗑️  [${req.session.user.username}] Delete: ${fullPath}`);

        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ success: false, error: "Path not found" });
        }

        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) {
            // Only delete if directory has < 100 items (safety check)
            const items = fs.readdirSync(fullPath);
            if (items.length > 100) {
                return res.status(403).json({ success: false, error: 'Directory too large. Delete items individually.' });
            }
            fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(fullPath);
        }

        res.json({ success: true, message: "Deleted successfully" });
    } catch (error) {
        res.status(403).json({ success: false, error: error.message });
    }
});

// Download file
router.get("/download", isAuthenticated, (req, res) => {
    try {
        const { path: userPath } = req.query;
        const fullPath = getSafePath(userPath);

        console.log(`⬇️  [${req.session.user.username}] Download: ${fullPath}`);

        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ success: false, error: "File not found" });
        }

        res.download(fullPath);
    } catch (error) {
        res.status(403).json({ success: false, error: error.message });
    }
});

// Upload file
router.post("/upload", isAuthenticated, upload.single('file'), async (req, res) => {
    try {
        const { path: userPath } = req.body;
        const fullPath = getSafePath(userPath);

        if (!req.file) {
            return res.status(400).json({ success: false, error: "No file uploaded" });
        }

        console.log(`⬆️  [${req.session.user.username}] Upload: ${req.file.originalname} to ${fullPath}`);

        const targetPath = path.join(fullPath, req.file.originalname);
        fs.renameSync(req.file.path, targetPath);

        res.json({ success: true, message: "File uploaded" });
    } catch (error) {
        // Clean up temp file on error
        if (req.file && req.file.path) {
            try { fs.unlinkSync(req.file.path); } catch { }
        }
        res.status(403).json({ success: false, error: error.message });
    }
});

module.exports = router;

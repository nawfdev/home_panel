const WebSocket = require('ws');
const { spawn } = require('child_process');
const os = require('os');
const url = require('url');
const cookie = require('cookie');

// Dangerous commands blacklist
const BLOCKED_COMMANDS = [
    'rm -rf /',
    'format',
    'del /f /s /q',
    'shutdown',
    'reboot',
    'mkfs',
    'dd if=',
    '> /dev/sda'
];

// Check if command is dangerous
function isDangerousCommand(command) {
    const lower = command.toLowerCase().trim();
    return BLOCKED_COMMANDS.some(blocked => lower.includes(blocked.toLowerCase()));
}

function initTerminalServer(server, sessionParser) {
    const wss = new WebSocket.Server({
        server,
        path: '/terminal',
        // verifyClient removed or set to true, we check inside connection
        verifyClient: (info, cb) => {
            sessionParser(info.req, {}, () => {
                // Pass session to connection handler
                info.req.session = info.req.session;
                cb(true);
            });
        }
    });

    wss.on('connection', (ws, req) => {
        // Auth Check
        if (!req.session || !req.session.user) {
            console.log('monitor: Rejected unauthorized terminal connection');
            ws.send('\x1b[31mError: Unauthorized via WebSocket. Please refresh.\x1b[0m');
            ws.send('AUTH_FAILED'); // Protocol message
            ws.close(4001, 'Unauthorized');
            return;
        }

        const user = req.session.user;
        console.log(`🖥️  Terminal connected: ${user.username}`);

        let terminal = null;
        const isWindows = os.platform() === 'win32';

        // Send welcome message
        ws.send('\x1b[32m✓ Terminal connected\x1b[0m\r\n');
        ws.send(`User: ${user.username} | Platform: ${os.platform()} | Shell: ${isWindows ? 'cmd' : 'bash'}\r\n`);
        ws.send('Enter commands below:\r\n');
        ws.send('\x1b[33m⚠️  Dangerous commands are blocked for safety\x1b[0m\r\n\r\n');

        // WebSocket -> Execute command
        ws.on('message', (msg) => {
            const command = msg.toString().trim();

            if (!command) return;

            // Log command
            console.log(`🖥️  [${user.username}] Command: ${command}`);

            // Echo command
            ws.send(`\x1b[36m$ ${command}\x1b[0m\r\n`);

            // Special commands
            if (command === 'clear') {
                ws.send('\x1b[2J\x1b[H'); // Clear screen
                return;
            }

            // Security check - block dangerous commands
            if (isDangerousCommand(command)) {
                ws.send('\x1b[31m✗ BLOCKED: This command is not allowed for security reasons\x1b[0m\r\n\r\n');
                console.warn(`⚠️  [${user.username}] BLOCKED dangerous command: ${command}`);
                return;
            }

            // Execute command
            try {
                const shell = isWindows ? 'cmd' : 'bash';
                const args = isWindows ? ['/c', command] : ['-c', command];

                const proc = spawn(shell, args, {
                    cwd: process.cwd(),
                    env: process.env,
                    timeout: 30000 // 30 second timeout
                });

                proc.stdout.on('data', (data) => {
                    ws.send(data.toString());
                });

                proc.stderr.on('data', (data) => {
                    ws.send(`\x1b[31m${data.toString()}\x1b[0m`);
                });

                proc.on('close', (code) => {
                    if (code !== 0) {
                        ws.send(`\x1b[31m[Exit code: ${code}]\x1b[0m\r\n`);
                    }
                    ws.send('\r\n');
                });

                proc.on('error', (err) => {
                    ws.send(`\x1b[31mError: ${err.message}\x1b[0m\r\n`);
                });

            } catch (err) {
                ws.send(`\x1b[31mError executing command: ${err.message}\x1b[0m\r\n`);
            }
        });

        ws.on('close', () => {
            console.log(`🖥️  Terminal disconnected: ${user.username}`);
            if (terminal) {
                try {
                    terminal.kill();
                } catch (e) { }
            }
        });

        ws.on('error', (err) => {
            console.error('Terminal WS error:', err);
        });
    });

    console.log('🖥️  Web Terminal server initialized (secure mode)');
}

module.exports = { initTerminalServer };

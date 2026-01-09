// Web Terminal with auto-reconnect
let terminalWs = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000; // 3 seconds

function loadTerminalPage() {
    initTerminal();
}

function initTerminal() {
    const terminalOutput = document.getElementById('terminal-output');
    if (!terminalOutput) return;

    // Clear previous
    terminalOutput.innerHTML = '<div class="text-green-400">Connecting to terminal...</div>';

    if (terminalWs) {
        terminalWs.close();
    }

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/terminal`;

    terminalWs = new WebSocket(wsUrl);

    terminalWs.onopen = () => {
        terminalOutput.innerHTML = '';
        appendTerminalOutput('<div class="text-green-400">✓ Terminal connected</div>\n');
        reconnectAttempts = 0; // Reset on successful connection
    };

    terminalWs.onmessage = (event) => {
        if (event.data === 'AUTH_FAILED') {
            terminalWs.close(4001); // Trigger special handling in onclose
            return;
        }
        appendTerminalOutput(escapeHtml(event.data));
    };

    terminalWs.onerror = (error) => {
    };
}

function sendTerminalCommand() {
    const input = document.getElementById('terminal-input');
    const command = input.value;

    if (!command.trim() || !terminalWs || terminalWs.readyState !== WebSocket.OPEN) {
        if (!terminalWs || terminalWs.readyState !== WebSocket.OPEN) {
            appendTerminalOutput('<div class="text-red-400">✗ Not connected. Reconnecting...</div>\n');
            initTerminal();
        }
        return;
    }

    terminalWs.send(command + '\n');
    input.value = '';
}

function appendTerminalOutput(text) {
    const output = document.getElementById('terminal-output');
    output.innerHTML += text;
    output.scrollTop = output.scrollHeight;
}

function clearTerminal() {
    document.getElementById('terminal-output').innerHTML = '';
    if (terminalWs && terminalWs.readyState === WebSocket.OPEN) {
        terminalWs.send('clear\n');
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    let escaped = div.innerHTML;

    // Convert ANSI color codes to HTML spans
    const ansiColors = {
        '30': 'color: #2e3436',      // black
        '31': 'color: #cc0000',      // red
        '32': 'color: #4e9a06',      // green
        '33': 'color: #c4a000',      // yellow
        '34': 'color: #3465a4',      // blue
        '35': 'color: #75507b',      // magenta
        '36': 'color: #06989a',      // cyan
        '37': 'color: #d3d7cf',      // white
        '90': 'color: #555753',      // bright black
        '91': 'color: #ef2929',      // bright red
        '92': 'color: #8ae234',      // bright green
        '93': 'color: #fce94f',      // bright yellow
        '94': 'color: #729fcf',      // bright blue
        '95': 'color: #ad7fa8',      // bright magenta
        '96': 'color: #34e2e2',      // bright cyan
        '97': 'color: #eeeeec',      // bright white
    };

    // Replace ANSI escape sequences with HTML spans
    // Pattern: ESC[<code>m or \x1b[<code>m or \033[<code>m
    escaped = escaped.replace(/\x1b\[(\d+)m|&#x1b;\[(\d+)m|\[(\d+)m/g, (match, c1, c2, c3) => {
        const code = c1 || c2 || c3;
        if (code === '0' || code === '00') {
            return '</span>'; // Reset
        }
        const style = ansiColors[code];
        if (style) {
            return `<span style="${style}">`;
        }
        return ''; // Strip unknown codes
    });

    // Clean up any remaining escape sequences
    escaped = escaped.replace(/\x1b\[\d*;?\d*m/g, '');
    escaped = escaped.replace(/&#x1b;\[\d*;?\d*m/g, '');

    return escaped;
}

document.addEventListener('DOMContentLoaded', () => {
    const terminalInput = document.getElementById('terminal-input');
    if (terminalInput) {
        terminalInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendTerminalCommand();
            }
        });
    }

    document.getElementById('send-command-btn')?.addEventListener('click', sendTerminalCommand);
    document.getElementById('clear-terminal-btn')?.addEventListener('click', clearTerminal);
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (terminalWs) terminalWs.close();
});

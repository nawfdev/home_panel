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
    return div.innerHTML;
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

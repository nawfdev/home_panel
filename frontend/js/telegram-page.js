// Telegram Page
async function loadTelegramPage() {
    loadTelegramStatus();
}

async function loadTelegramStatus() {
    const statusEl = document.getElementById('telegram-bot-status');
    const configEl = document.getElementById('telegram-config');

    try {
        const res = await fetch('/api/telegram/status', { credentials: 'include' });
        const data = await res.json();

        if (data.connected) {
            statusEl.innerHTML = `
                <div class="flex items-center gap-2">
                    <i class="fas fa-check-circle text-green-500"></i>
                    <span class="text-green-400">Bot Connected</span>
                </div>
                <p class="text-gray-400 text-sm">Monitoring: ${data.monitoring ? 'Active' : 'Inactive'}</p>
            `;
        } else if (data.configured) {
            statusEl.innerHTML = `
                <div class="flex items-center gap-2">
                    <i class="fas fa-exclamation-circle text-yellow-500"></i>
                    <span class="text-yellow-400">Configured but not connected</span>
                </div>
                <p class="text-gray-400 text-sm">Check your bot token</p>
            `;
        } else {
            statusEl.innerHTML = `
                <div class="flex items-center gap-2">
                    <i class="fas fa-times-circle text-red-500"></i>
                    <span class="text-red-400">Not Configured</span>
                </div>
                <p class="text-gray-400 text-sm mt-2">Go to Settings to add your Bot Token</p>
                <a href="#" class="nav-link inline-block mt-3 bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded text-sm" data-page="settings">
                    <i class="fas fa-cog mr-2"></i>Configure Bot
                </a>
            `;
        }

        configEl.innerHTML = `
            <p><span class="text-gray-400">Bot Token:</span> ${data.configured ? '••••••••' + (data.tokenHint || '') : 'Not set'}</p>
            <p><span class="text-gray-400">Chat ID:</span> ${data.chatId || 'Not set'}</p>
            <p><span class="text-gray-400">Notifications:</span> ${data.notificationsEnabled ? '<span class="text-green-400">Enabled</span>' : '<span class="text-gray-500">Disabled</span>'}</p>
        `;
    } catch (err) {
        statusEl.innerHTML = `<p class="text-red-400">Error: ${err.message}</p>`;
    }
}

async function sendTelegramTest() {
    const message = document.getElementById('telegram-test-message').value;
    if (!message.trim()) {
        alert('Please enter a message');
        return;
    }

    try {
        const res = await fetch('/api/telegram/test', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });
        const data = await res.json();

        if (data.success) {
            alert('✅ Test message sent successfully!');
        } else {
            alert('❌ Failed: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('refresh-telegram-btn')?.addEventListener('click', loadTelegramPage);
    document.getElementById('send-telegram-test')?.addEventListener('click', sendTelegramTest);
});

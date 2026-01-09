document.addEventListener('DOMContentLoaded', () => {
    // Settings will be loaded when navigating to settings page via loadSettings() in app.js
    // Do NOT load here to avoid 401 errors before login

    // Cloudflare Form
    const cfForm = document.getElementById('cf-settings-form');
    if (cfForm) {
        cfForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveCloudflare(cfForm);
        });
    }

    // Telegram Form
    const tgForm = document.getElementById('telegram-settings-form');
    if (tgForm) {
        tgForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveTelegram(tgForm);
        });
    }
});

// === Cloudflare Functions ===
async function loadCfSettings() {
    try {
        const res = await api('/settings/cloudflare');
        if (res.success && res.hasToken) {
            document.getElementById('cf-api-token').placeholder = '•••••••••••••••• (Token Saved)';
            if (res.accountId) {
                document.getElementById('cf-account-id').value = res.accountId;
            }
        }
    } catch (err) {
        console.error('Failed to load CF settings:', err);
    }
}

async function saveCloudflare(form) {
    const apiToken = document.getElementById('cf-api-token').value;
    const accountId = document.getElementById('cf-account-id').value;

    const btn = form.querySelector('button');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Verifying...';

    try {
        const res = await api('/settings/cloudflare', {
            method: 'POST',
            body: JSON.stringify({ apiToken, accountId })
        });

        if (res.success) {
            alert('✅ ' + res.message);
            document.getElementById('cf-api-token').value = '';
            document.getElementById('cf-api-token').placeholder = '•••••••••••••••• (Token Saved)';
        } else {
            alert('❌ Error: ' + res.error);
        }
    } catch (err) {
        alert('❌ Connection Error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// === Telegram Functions ===
async function loadTelegramSettings() {
    try {
        const res = await api('/settings/telegram');
        if (res.success) {
            if (res.botToken) document.getElementById('tg-bot-token').placeholder = '•••••••• (Saved)';
            if (res.chatId) document.getElementById('tg-chat-id').value = res.chatId;
            document.getElementById('tg-enabled').checked = res.enableNotifications;
        }
    } catch (err) {
        console.error('Failed to load Telegram settings:', err);
    }
}

async function saveTelegram(form) {
    const botToken = document.getElementById('tg-bot-token').value;
    const chatId = document.getElementById('tg-chat-id').value;
    const enableNotifications = document.getElementById('tg-enabled').checked;

    const btn = form.querySelector('button');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Testing...';

    try {
        const res = await api('/settings/telegram', {
            method: 'POST',
            body: JSON.stringify({ botToken, chatId, enableNotifications })
        });

        if (res.success) {
            alert('✅ ' + res.message);
            if (botToken) {
                document.getElementById('tg-bot-token').value = '';
                document.getElementById('tg-bot-token').placeholder = '•••••••• (Saved)';
            }
        } else {
            alert('❌ Error: ' + res.error);
        }
    } catch (err) {
        alert('❌ Error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// === Update Functions ===
async function checkForUpdates() {
    const statusEl = document.getElementById('update-status');
    statusEl.innerHTML = '<p class="text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>Checking for updates...</p>';

    try {
        const res = await api('/update/check');

        if (res.error) {
            statusEl.innerHTML = `
                <div class="bg-red-900/30 border border-red-700 rounded p-4">
                    <p class="text-red-400"><i class="fas fa-exclamation-circle mr-2"></i>Error: ${res.error}</p>
                </div>
            `;
            return;
        }

        if (res.updateAvailable) {
            statusEl.innerHTML = `
                <div class="bg-green-900/30 border border-green-700 rounded p-4 mb-4">
                    <div class="flex items-center gap-2 mb-2">
                        <i class="fas fa-arrow-circle-up text-green-400 text-xl"></i>
                        <span class="text-green-400 font-bold">Update Available!</span>
                    </div>
                    <p class="text-sm text-gray-300 mb-2">You are <strong>${res.behindBy}</strong> commit(s) behind.</p>
                    <p class="text-xs text-gray-400">Local: ${res.localCommit} → Remote: ${res.remoteCommit}</p>
                </div>
                ${res.pendingChanges.length > 0 ? `
                    <div class="bg-gray-700 rounded p-3 mb-4">
                        <p class="text-xs text-gray-400 mb-2">Changes included:</p>
                        <ul class="text-sm text-gray-300 space-y-1">
                            ${res.pendingChanges.slice(0, 5).map(c => `<li>• ${c}</li>`).join('')}
                        </ul>
                        ${res.pendingChanges.length > 5 ? `<p class="text-xs text-gray-400 mt-1">...and ${res.pendingChanges.length - 5} more</p>` : ''}
                    </div>
                ` : ''}
                <button onclick="applyUpdate()" class="bg-green-600 hover:bg-green-700 px-4 py-2 rounded transition">
                    <i class="fas fa-download mr-2"></i>Update Now
                </button>
            `;
        } else {
            statusEl.innerHTML = `
                <div class="bg-blue-900/30 border border-blue-700 rounded p-4">
                    <div class="flex items-center gap-2">
                        <i class="fas fa-check-circle text-blue-400"></i>
                        <span class="text-blue-400">You're up to date!</span>
                    </div>
                    <p class="text-sm text-gray-400 mt-1">Version: ${res.currentVersion} (${res.localCommit})</p>
                </div>
            `;
        }
    } catch (err) {
        statusEl.innerHTML = `
            <div class="bg-red-900/30 border border-red-700 rounded p-4">
                <p class="text-red-400"><i class="fas fa-exclamation-circle mr-2"></i>Error: ${err.message}</p>
            </div>
        `;
    }
}

async function applyUpdate() {
    if (!confirm('This will update the panel and requires a server restart. Continue?')) return;

    const statusEl = document.getElementById('update-status');
    statusEl.innerHTML = '<p class="text-yellow-400"><i class="fas fa-spinner fa-spin mr-2"></i>Applying update... Please wait.</p>';

    try {
        const res = await api('/update/apply', { method: 'POST' });

        if (res.success) {
            statusEl.innerHTML = `
                <div class="bg-green-900/30 border border-green-700 rounded p-4">
                    <div class="flex items-center gap-2 mb-2">
                        <i class="fas fa-check-circle text-green-400 text-xl"></i>
                        <span class="text-green-400 font-bold">Update Applied!</span>
                    </div>
                    <p class="text-sm text-gray-300">${res.message}</p>
                    <p class="text-sm text-yellow-400 mt-2"><i class="fas fa-redo mr-1"></i>Please restart the server to apply changes.</p>
                </div>
            `;
        } else {
            statusEl.innerHTML = `
                <div class="bg-red-900/30 border border-red-700 rounded p-4">
                    <p class="text-red-400"><i class="fas fa-exclamation-circle mr-2"></i>Update failed: ${res.error}</p>
                </div>
            `;
        }
    } catch (err) {
        statusEl.innerHTML = `
            <div class="bg-red-900/30 border border-red-700 rounded p-4">
                <p class="text-red-400"><i class="fas fa-exclamation-circle mr-2"></i>Error: ${err.message}</p>
            </div>
        `;
    }
}

// Check Update Button
document.addEventListener('DOMContentLoaded', () => {
    const checkBtn = document.getElementById('check-update-btn');
    if (checkBtn) {
        checkBtn.addEventListener('click', checkForUpdates);
    }
});


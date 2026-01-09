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

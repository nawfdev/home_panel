document.addEventListener('DOMContentLoaded', () => {
    const cfForm = document.getElementById('cf-settings-form');

    if (cfForm) {
        // Load current settings
        loadCfSettings();

        cfForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const apiToken = document.getElementById('cf-api-token').value;
            const accountId = document.getElementById('cf-account-id').value;

            const btn = cfForm.querySelector('button');
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
                    document.getElementById('cf-api-token').value = ''; // Clear for security
                } else {
                    alert('❌ Error: ' + res.error);
                }
            } catch (err) {
                alert('❌ Connection Error: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        });
    }
});

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

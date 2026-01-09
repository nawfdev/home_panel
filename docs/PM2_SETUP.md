# 🚀 Setup PM2 untuk Auto-Start Panel

Gunakan PM2 untuk memastikan **Cloudflare Panel** selalu running, bahkan setelah reboot komputer.

## 📦 Install PM2

```bash
npm install -g pm2
```

## 🎯 Start Panel dengan PM2

### Windows

```bash
# Dari directory project
cd c:\Users\kaysa\OneDrive\Documents\panel_cf

# Start dengan PM2
pm2 start npm --name "cloudflare-panel" -- start

# Lihat status
pm2 status

# Lihat logs
pm2 logs cloudflare-panel

# Save konfigurasi
pm2 save

# Auto-start saat boot (harus run as Administrator)
pm2 startup
```

Copy dan jalankan command yang muncul dari `pm2 startup`.

## 🔄 Commands Berguna

```bash
# Stop panel
pm2 stop cloudflare-panel

# Restart panel
pm2 restart cloudflare-panel

# Lihat logs real-time
pm2 logs cloudflare-panel --lines 100

# Monitor resource usage
pm2 monit

# Hapus dari PM2
pm2 delete cloudflare-panel

# List semua process
pm2 list
```

## ⚙️ Konfigurasi Lanjutan

Buat file `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'cloudflare-panel',
    script: 'npm',
    args: 'start',
    cwd: 'c:/Users/kaysa/OneDrive/Documents/panel_cf',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
```

Lalu jalankan:
```bash
pm2 start ecosystem.config.js
pm2 save
```

## ✅ Verifikasi

Cek panel berjalan:
1. Buka **http://localhost:3000**
2. Panel harus accessible
3. Cek `pm2 logs` untuk memastikan tidak ada error

## 🎉 Selesai!

Panel Anda kini akan:
- ✅ Auto-start saat komputer boot
- ✅ Auto-restart jika crash
- ✅ Monitoring resource usage
- ✅ Log management

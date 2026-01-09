# 🔄 Auto-Restart Tunnel - Dokumentasi

Cloudflare Tunnel kini dilengkapi dengan **auto-restart otomatis** untuk memastikan tunnel tetap online 24/7.

## ✨ Fitur Auto-Restart

### 1. **Restart Otomatis**
Jika tunnel crash atau berhenti, sistem akan **otomatis restart** dengan strategi exponential backoff:
- Attempt 1: Restart setelah **5 detik**
- Attempt 2: Restart setelah **10 detik**
- Attempt 3: Restart setelah **30 detik**
- Attempt 4: Restart setelah **60 detik**
- Attempt 5+: Restart setelah **5 menit**

### 2. **Health Monitoring**
- Check status tunnel setiap **30 detik**
- Deteksi otomatis jika process tunnel mati
- Automatic recovery tanpa intervensi manual

### 3. **Notifikasi Telegram**
Jika bot Telegram sudah dikonfigurasi, Anda akan menerima notifikasi:
- 🔴 **Tunnel Down** - Saat tunnel berhenti
- 🟢 **Tunnel UP** - Saat tunnel berhasil restart
- ⏳ **Auto-restart** - Info berapa kali restart attempt

### 4. **Smart Restart Logic**
- Restart counter di-reset jika tunnel sudah stabil > 5 menit
- Manual stop tidak trigger auto-restart
- Exponential backoff mencegah restart loop

## 🚀 Cara Kerja

### Scenario 1: Tunnel Crash
```
1. Tunnel berjalan normal
2. Tunnel crash (misalnya: network issue)
3. Sistem deteksi tunnel mati
4. Auto-restart dimulai (5 detik)
5. Tunnel berhasil restart
6. Notifikasi Telegram: ✅ Tunnel UP
```

### Scenario 2: Network ISP Mati
```
1. Tunnel berjalan normal
2. ISP/Internet mati
3. Tunnel exit dengan error
4. Auto-restart attempt #1 (gagal - no internet)
5. Auto-restart attempt #2 (gagal - no internet)
6. Auto-restart attempt #3 (gagal - no internet)
7. ISP kembali online
8. Auto-restart attempt #4 (BERHASIL!)
9. Tunnel kembali online ✅
```

### Scenario 3: Manual Stop
```
1. User klik "Stop Tunnel" di panel
2. Auto-restart dinonaktifkan sementara
3. Tunnel berhenti
4. Tidak ada restart otomatis
5. Auto-restart kembali aktif setelah 2 detik
```

## ⚙️ Konfigurasi

### Auto-Restart (Default: ON)
Auto-restart **sudah aktif secara default**. Tidak perlu konfigurasi tambahan!

### Menonaktifkan Auto-Restart (Tidak disarankan)
Jika Anda ingin menonaktifkan fitur ini, edit `backend/services/cloudflared.js`:
```javascript
let autoRestart = false; // Ubah dari true ke false
```

## 📊 Monitoring

### Via Console Log
Lihat status auto-restart di console server:
```
🟢 Cloudflare Tunnel started (PID: 12345)
[Tunnel] Connection established...
🔴 Tunnel process exited with code 1
⏳ Auto-restart in 5s (attempt 1)...
🔄 Attempting to restart tunnel...
✅ Tunnel restarted successfully
```

### Via Telegram Bot
Jika bot Telegram sudah dikonfigurasi:
```
🔴 Tunnel Stopped
Tunnel exited with code 1
Auto-restart will attempt...

✅ Tunnel Restarted
Tunnel is back online after 2 attempt(s)
```

### Via Panel Dashboard
- Lihat status tunnel di **Dashboard**
- Tab **Tunnel** menampilkan status real-time
- Indicator 🟢 Online / 🔴 Offline

## 🛡️ Keamanan & Stabilitas

### Exponential Backoff
Mencegah restart loop yang berlebihan:
- Memberikan waktu untuk masalah network pulih
- Tidak membebani sistem dengan restart terus-menerus
- Smart retry strategy

### Restart Counter Reset
- Counter di-reset jika tunnel stabil > 5 menit
- Memastikan restart tracking akurat
- Menghindari false positive

### Process Health Check
- Monitoring setiap 30 detik
- Deteksi zombie process
- Clean process management

## 🔍 Troubleshooting

### Tunnel Terus Restart
**Penyebab:**
- Config tunnel salah
- Domain tidak ter-route
- Port local tidak tersedia
- Cloudflared tidak terinstall

**Solusi:**
1. Cek logs di console
2. Verifikasi config di `.cloudflared/config.yml`
3. Pastikan domain sudah di-route
4. Cek port local tidak bentrok

### Restart Tidak Jalan
**Kemungkinan:**
- Auto-restart dinonaktifkan
- Server panel mati
- Manual stop baru saja diklik

**Cek:**
```bash
# Lihat logs server
# Pastikan ada pesan: "Auto-restart enabled"
```

### Notifikasi Tidak Masuk
**Penyebab:**
- Telegram bot belum dikonfigurasi
- Chat ID salah
- Bot token tidak valid

**Solusi:**
- Ikuti panduan di `TELEGRAM_SETUP.md`
- Test bot dengan command `/status`

## 🎯 Best Practices

### 1. Gunakan PM2 untuk Panel
Agar panel server juga auto-restart:
```bash
npm install -g pm2
pm2 start npm --name "cloudflare-panel" -- start
pm2 save
pm2 startup
```

### 2. Monitor via Telegram
Setup Telegram bot untuk notifikasi real-time:
- Tahu kapan tunnel down
- Konfirmasi saat tunnel restart
- Remote monitoring dari mana saja

### 3. Cek Logs Berkala
Review console logs untuk:
- Mendeteksi pattern crash
- Identifikasi masalah network
- Optimasi konfigurasi

### 4. Keep Cloudflared Updated
```bash
# Windows
winget upgrade cloudflare.cloudflared

# Manual
# Download versi terbaru dari cloudflare.com
```

## 📈 Performance

### Resource Usage
- **CPU**: Minimal (hanya saat restart)
- **Memory**: ~10-20MB per tunnel process
- **Network**: Minimal overhead untuk health check

### Restart Time
- **Average**: 5-10 detik
- **With backoff**: Tergantung attempt count
- **Network recovery**: Tergantung ISP

## ✅ Checklist Setup

Untuk tunnel yang 99.9% uptime:

- [x] ✅ Auto-restart sudah aktif (default)
- [ ] 📱 Setup Telegram bot untuk notifikasi
- [ ] 🔄 Install PM2 untuk panel auto-restart
- [ ] ⚡ Test tunnel restart (stop lalu cek auto-restart)
- [ ] 📊 Monitor logs untuk memastikan tidak ada loop
- [ ] 🔒 Pastikan config tunnel benar
- [ ] 🌐 Verifikasi domain accessible dari luar

---

## 🎉 Kesimpulan

Dengan fitur auto-restart, Cloudflare Tunnel Anda akan:
✅ **Selalu online** (kecuali ISP mati total)
✅ **Auto-recovery** dari crash
✅ **Smart retry** dengan backoff
✅ **Notifikasi real-time** via Telegram
✅ **Production-ready** untuk 24/7 uptime

**Tunnel Anda kini tangguh terhadap:**
- Network hiccups
- Process crashes
- Temporary failures
- ISP disconnections

**Nikmati uptime maksimal! 🚀**

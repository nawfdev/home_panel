# 🤖 Telegram Bot - Cloudflare Panel

Bot Telegram untuk monitoring dan management Cloudflare Panel secara remote.

## 📋 Fitur

### Notifikasi Otomatis
- 🟢 **Tunnel UP** - Notifikasi saat tunnel berhasil running
- 🔴 **Tunnel DOWN** - Alert saat tunnel berhenti
- ⚠️ **Error Logs** - Notifikasi error kritis
- 📊 **Resource Alert** - Peringatan CPU/Memory tinggi (opsional)

### Command Bot
| Command | Deskripsi | Contoh |
|---------|-----------|---------|
| `/start` | Mulai bot & lihat intro | `/start` |
| `/status` | Status sistem & tunnel lengkap | `/status` |
| `/docker` | Daftar Docker containers | `/docker` |
| `/docker restart <name>` | Restart container | `/docker restart nginx` |
| `/pm2` | Daftar PM2 processes | `/pm2` |
| `/pm2 restart <name>` | Restart process | `/pm2 restart api` |
| `/ip` | Info jaringan (IP publik & lokal) | `/ip` |
| `/restart tunnel` | Restart Cloudflare tunnel | `/restart tunnel` |
| `/logs <service>` | Lihat logs service | `/logs cloudflared` |
| `/help` | Bantuan lengkap | `/help` |

## 🚀 Setup

### 1. Buat Telegram Bot

1. Buka [@BotFather](https://t.me/BotFather) di Telegram
2. Kirim `/newbot`
3. Ikuti instruksi:
   - Berikan nama bot (contoh: `My Panel Bot`)
   - Berikan username bot (harus diakhiri `bot`, contoh: `mypanel_bot`)
4. **Simpan token** yang diberikan (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Dapatkan Chat ID Anda

**Cara 1 - Menggunakan Bot:**
1. Buka [@userinfobot](https://t.me/userinfobot)
2. Kirim `/start`
3. **Simpan ID** yang ditampilkan (format: `123456789`)

**Cara 2 - Manual:**
1. Kirim pesan ke bot Anda (yang baru dibuat)
2. Buka browser dan akses:
   ```
   https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   ```
3. Cari field `"chat":{"id":123456789}` dan simpan ID-nya

### 3. Konfigurasi Bot

Edit file `config/config.json` dan masukkan token & chat ID:

```json
{
  "telegram": {
    "botToken": "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
    "chatId": "123456789",
    "enableNotifications": true,
    "commands": {
      "status": true,
      "docker": true,
      "pm2": true,
      "ip": true,
      "restart": true,
      "logs": true
    }
  }
}
```

### 4. Restart Server

```bash
npm start
```

**Output sukses:**
```
✅ Telegram Bot initialized successfully!
🔍 Starting tunnel monitoring...
```

**Jika token belum dikonfigurasi:**
```
⚠️  Telegram bot token not configured. Skipping bot initialization.
📝 Please add your bot token to config/config.json
```

## 📱 Cara Menggunakan

### Test Koneksi Bot

1. Buka chat dengan bot Anda di Telegram
2. Kirim `/start`
3. Anda akan menerima welcome message

### Monitoring Status

Kirim `/status` untuk melihat:
- Status Cloudflare tunnel (running/stopped)
- CPU & Memory usage
- Disk usage
- System uptime
- OS info

### Mengelola Docker

```
/docker                    # Lihat semua containers
/docker restart nginx      # Restart container nginx
```

### Mengelola PM2

```
/pm2                      # Lihat semua processes
/pm2 restart api          # Restart process api
```

### Check Network

```
/ip                       # Lihat IP publik & lokal
```

### Restart Tunnel

```
/restart tunnel           # Restart Cloudflare tunnel
```

## ⚙️ Konfigurasi Lanjutan

### Menonaktifkan Notifikasi Otomatis

Edit `config/config.json`:

```json
{
  "telegram": {
    "enableNotifications": false
  }
}
```

### Menonaktifkan Command Tertentu

Edit `config/config.json`:

```json
{
  "telegram": {
    "commands": {
      "status": true,
      "docker": false,    // Nonaktifkan Docker commands
      "pm2": false,       // Nonaktifkan PM2 commands
      "ip": true,
      "restart": true,
      "logs": false
    }
  }
}
```

## 🔒 Keamanan

### Best Practices

1. **Jangan share Bot Token** - Token adalah password bot Anda
2. **Gunakan Chat ID pribadi** - Hanya Anda yang bisa mengontrol bot
3. **Simpan config.json dengan aman** - Jangan commit ke Git dengan token asli
4. **Gunakan environment variables** (opsional):

```bash
export TELEGRAM_BOT_TOKEN="your_token_here"
export TELEGRAM_CHAT_ID="your_chat_id_here"
```

### Membatasi Akses

Bot secara default hanya merespon Chat ID yang dikonfigurasi. Pesan dari user lain akan diabaikan.

## 🐛 Troubleshooting

### Bot tidak merespon

**Cek:**
1. Token sudah benar?
2. Chat ID sudah benar?
3. Server sudah running?
4. Lihat console untuk error messages

**Test manual:**
```bash
curl https://api.telegram.org/bot<YOUR_TOKEN>/getMe
```

### Notifikasi tidak muncul

**Cek:**
1. `enableNotifications: true` di config?
2. Chat ID sudah benar?
3. Tunnel benar-benar down/up?

### Docker/PM2 command tidak jalan

**Normal behavior jika:**
- Docker tidak terinstall → Bot akan bilang "Docker tidak tersedia"
- PM2 tidak terinstall → Bot akan bilang "PM2 tidak tersedia"

Bot akan **gracefully handle** service yang tidak tersedia tanpa crash.

## 📊 Monitoring Interval

Bot melakukan pengecekan status tunnel setiap **30 detik**.

Untuk mengubah interval, edit `go-backend/internal/telegram/telegram.go` lalu rebuild
(`go build ./...`).

## 🔄 Auto-Restart Bot

Jika menggunakan PM2:

```bash
pm2 start npm --name "cloudflare-panel" -- start
pm2 save
```

Bot akan otomatis restart jika crash.

## 📝 Development

### Menambah Command Baru atau Notifikasi Custom

Edit `go-backend/internal/telegram/telegram.go` lalu rebuild (`go build ./...`).

## 🆘 Support

Jika ada masalah, cek:
1. Server logs di console
2. Telegram API status: https://status.telegram.org/
3. Config file sudah benar

## 📄 License

Same as parent project.

---

**Selamat menggunakan! 🚀**

Jika ada pertanyaan, buka issue di GitHub atau hubungi developer.

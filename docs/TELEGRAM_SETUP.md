# 🚀 Quick Start - Telegram Bot Setup

Ikuti langkah-langkah ini untuk setup Telegram Bot dalam 5 menit!

## ⚡ Langkah Cepat

### 1️⃣ Buat Bot (2 menit)

1. Buka Telegram, cari **@BotFather**
2. Kirim pesan: `/newbot`
3. Ikuti instruksi:
   ```
   BotFather: Alright, a new bot. How are we going to call it?
   Anda: My Panel Bot
   
   BotFather: Good. Now let's choose a username for your bot.
   Anda: mypanel_bot
   ```
4. **SIMPAN TOKEN** yang diberikan!
   ```
   Format: 1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
   ```

### 2️⃣ Dapatkan Chat ID (1 menit)

1. Cari **@userinfobot** di Telegram
2. Kirim `/start`
3. **SIMPAN ID** yang muncul!
   ```
   Format: 123456789
   ```

### 3️⃣ Konfigurasi (1 menit)

Buka file: `config/config.json`

Ganti bagian ini:
```json
"telegram": {
  "botToken": "PASTE_TOKEN_ANDA_DISINI",
  "chatId": "PASTE_CHAT_ID_ANDA_DISINI",
  "enableNotifications": true
}
```

**Contoh hasil akhir:**
```json
"telegram": {
  "botToken": "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz",
  "chatId": "123456789",
  "enableNotifications": true
}
```

### 4️⃣ Restart Server (30 detik)

```bash
# Stop server yang sedang running (Ctrl+C)
# Lalu jalankan lagi:
npm start
```

**Cek console, harus muncul:**
```
✅ Telegram Bot initialized successfully!
🔍 Starting tunnel monitoring...
```

### 5️⃣ Test Bot! (30 detik)

1. Buka chat dengan bot Anda
2. Kirim: `/start`
3. Bot akan reply dengan welcome message! 🎉

**Selamat! Bot sudah jalan! 🚀**

---

## 🎮 Command Cepat

```
/status     → Lihat status sistem
/ip         → Lihat IP server
/docker     → Lihat containers (jika ada)
/pm2        → Lihat processes (jika ada)
/help       → Bantuan lengkap
```

## ⚠️ Troubleshooting Cepat

### Bot tidak merespon?

**Cek 3 hal ini:**
1. ✅ Token benar? (tidak ada spasi, lengkap copy-paste)
2. ✅ Chat ID benar? (angka saja, tidak ada tanda tambahan)
3. ✅ Server running? (cek console ada pesan success)

**Test token manual:**
```bash
# Ganti YOUR_TOKEN dengan token Anda
curl https://api.telegram.org/botYOUR_TOKEN/getMe
```

Jika berhasil, akan muncul info bot Anda.

### Console ada warning?

**Jika muncul:**
```
⚠️ Telegram bot token not configured
```

Berarti token masih default. Cek lagi `config.json`.

**Jika muncul:**
```
⚠️ Docker not available
⚠️ PM2 not available
```

Ini **NORMAL**! Bot tetap jalan, hanya fitur Docker/PM2 yang tidak aktif.

---

## 📚 Dokumentasi Lengkap

Untuk info lebih detail, baca: **[TELEGRAM_BOT.md](./TELEGRAM_BOT.md)**

---

**Happy monitoring! 🎉**

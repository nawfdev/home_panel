# 🖥️ Quick Start - Remote Desktop Setup

Kontrol mouse+keyboard laptop lain dari panel, selama masih satu jaringan/router. Ini custom-built, bukan RustDesk — dua bagian:

- **`remoteagent.exe`** — jalan di laptop yang MAU dikontrol. Streaming layarnya, terima perintah mouse/keyboard.
- **Panel (Remote Desktop page)** — browser kamu connect langsung ke `remoteagent.exe` itu lewat WebSocket, no relay, no cloud, satu LAN doang.

## ⚡ Langkah Cepat

### 1️⃣ Build/dapatkan `remoteagent.exe`

Dari folder project, di komputer manapun yang ada Go toolchain-nya:

```bash
cd be
GOOS=windows GOARCH=amd64 go build -o remoteagent.exe ./cmd/remoteagent
```

Copy `remoteagent.exe` itu ke laptop yang mau dikontrol.

### 2️⃣ Jalanin di laptop target

1. Double-click `remoteagent.exe` (atau run dari terminal)
2. Pertama kali jalan, muncul di console:
   ```
   =================================================
    Remote Desktop Agent
   =================================================
    Port:  8791
    Token: a1b2c3d4e5f6...
   ```
3. **SIMPAN Port + Token** ini — kesave otomatis di `remoteagent.json` sebelah exe-nya, jadi gak berubah tiap restart
4. Biarin window-nya tetep kebuka (atau jadiin Windows service/scheduled task biar jalan terus di background)
5. Cek firewall Windows kalau gagal connect — buka port `8791` (TCP) buat inbound

### 3️⃣ Cari IP laptop target

Di laptop target, buka cmd: `ipconfig` → catat IPv4 Address (misal `192.168.1.20`)

### 4️⃣ Tambah device di Panel

1. Buka panel → **Diagnostics → Remote Desktop**
2. Klik **Add device**, isi:
   - **Name**: nama bebas
   - **Host**: IP laptop target (langkah 3)
   - **Port**: `8791` (atau sesuai yang muncul di console)
   - **Token**: dari console langkah 2
3. Save

### 5️⃣ Connect!

Klik **Connect** → langsung kebuka viewer di dalam panel (gak ada app terpisah kebuka). Klik layarnya buat fokus, terus mouse/keyboard langsung jalan ke laptop target.

**Fitur yang ada:**
- Live screen view (~8fps, JPEG)
- Mouse (gerak, klik kiri/kanan/tengah, scroll)
- Keyboard (huruf, angka, F1-F12, arrow, modifier, dll)
- Clipboard sync dua arah (lewat textarea, bukan otomatis — browser gak izinin baca clipboard langsung di koneksi non-HTTPS)
- Kirim file dari panel ke laptop target (masuk ke folder `Downloads\RemoteAgentReceived`)

---

## ⚠️ Troubleshooting Cepat

### Status "connecting" terus, gak pernah "connected"?
1. Cek `remoteagent.exe` masih jalan di laptop target
2. Cek IP di form device masih benar (kalau DHCP, IP bisa berubah)
3. Cek firewall Windows di laptop target — buka port `8791` (TCP) inbound
4. Kedua device harus satu jaringan/router yang sama

### Layar item aja, "No signal"?
Cek console `remoteagent.exe` ada error capture atau enggak. Kalau laptop lagi di-lock screen, capture tetep jalan tapi biasanya nunjukin lock screen.

### Klik/ketik gak ngaruh ke laptop target?
Klik dulu area layarnya biar fokus (border-nya harus keliatan aktif) sebelum ngetik — browser butuh elemen di-fokus dulu buat nangkep keyboard event.

### Kenapa clipboard gak otomatis sync pas copy di browser?
`navigator.clipboard` API browser butuh HTTPS/localhost buat baca clipboard langsung — panel ini jalan di LAN HTTP biasa. Makanya dibikin manual lewat textarea (paste manual → klik "Send to remote"), tetep jalan tanpa syarat itu.

---

**Selamat, laptop kamu sekarang bisa diremote dari panel! 🎉**

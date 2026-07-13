# 🖥️ Quick Start - Remote Desktop Setup

Kontrol mouse+keyboard laptop lain dari panel, selama masih satu jaringan/router. Pakai RustDesk self-hosted (gratis, open source) — panel cuma nyimpen daftar device dan buka RustDesk-nya, bukan proses remote control-nya sendiri.

## ⚡ Langkah Cepat

### 1️⃣ Jalanin RustDesk Server di host panel ini (5 menit)

1. Download `rustdesk-server` dari [github.com/rustdesk/rustdesk-server/releases](https://github.com/rustdesk/rustdesk-server/releases) — pilih file untuk Windows (`x86_64-pc-windows-msvc`)
2. Extract, dapet 2 file: `hbbs.exe` (rendezvous/ID server) dan `hbbr.exe` (relay server)
3. Jalanin dua-duanya (bisa di folder yang sama dengan panel, atau folder terpisah):
   ```
   hbbs.exe
   hbbr.exe
   ```
4. Pertama kali jalan, `hbbs` generate key pair dan nunjukin **public key** di console — **SIMPAN KEY INI**:
   ```
   Key: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=
   ```
5. Buka port di firewall Windows (kalau laptop lain gagal connect): `21115-21119` (TCP+UDP)

**Biar jalan terus:** daftarin `hbbs.exe`/`hbbr.exe` sebagai Windows service (pakai NSSM) atau tambahin ke Task Scheduler run-at-startup — kalau host reboot dan server ini mati, semua device jadi gak bisa connect.

### 2️⃣ Install RustDesk di laptop yang mau di-remote (2 menit)

1. Download RustDesk client dari [rustdesk.com](https://rustdesk.com/) → install di laptop target
2. Buka RustDesk → **ID/Relay Server** (icon titik tiga → Network) → isi:
   ```
   ID Server:    <IP host panel>:21116
   Relay Server: <IP host panel>:21117
   Key:          <public key dari langkah 1>
   ```
3. Apply, tunggu status jadi "Ready"
4. Set **Permanent Password**: Settings → Security → Set permanent password (biar gak perlu buka layar laptop tiap connect — ini yang bikin "unattended access" jalan)
5. Catat **ID** RustDesk yang muncul di layar utama (9 digit angka)

### 3️⃣ Install RustDesk juga di device kamu buat connect (2 menit)

Device yang dipakai buat mengontrol (HP/PC/laptop kamu) juga perlu RustDesk client terinstall — panel cuma memicu link `rustdesk://`, appnya sendiri yang harus sudah ada di device kamu.

1. Install RustDesk di device kamu juga
2. Set ID/Relay Server + Key sama seperti langkah 2 (biar satu jaringan RustDesk)

### 4️⃣ Tambah device di Panel (1 menit)

1. Buka panel → **Diagnostics → Remote Desktop**
2. Klik **Add device**, isi:
   - **Name**: nama bebas, misal "Laptop Kerja"
   - **RustDesk ID**: ID 9 digit dari langkah 2
   - **Self-hosted server**: `<IP host panel>:21116`
   - **Server key**: public key dari langkah 1
3. Save

### 5️⃣ Connect!

Klik tombol **Connect** di device tersebut → browser minta izin buka RustDesk → RustDesk kebuka dengan ID sudah keisi → masukin permanent password (sekali aja, biasanya RustDesk inget setelahnya) → langsung bisa kontrol mouse+keyboard laptop itu.

---

## ⚠️ Troubleshooting Cepat

### Klik Connect tapi gak kejadian apa-apa / browser bilang "unknown protocol"?
RustDesk belum terinstall di device yang kamu pakai buat connect, atau protocol handler `rustdesk://` belum kedaftar. Install ulang RustDesk client-nya.

### RustDesk kebuka tapi "Connection Error" / gagal connect ke ID?
1. Cek `hbbs.exe` dan `hbbr.exe` masih jalan di host panel
2. Cek laptop target statusnya "Ready" (bukan "Not ready") di RustDesk-nya
3. Cek firewall — port `21115-21119` (TCP+UDP) harus kebuka di host panel
4. Cek IP host panel di form device masih benar (kalau pakai DHCP dan IP berubah, update lagi)

### Permanent password diminta tiap kali connect?
Normal untuk koneksi pertama kali dari device baru. Setelahnya biasanya RustDesk simpen kredensial per-peer di device kamu.

### Kenapa gak disimpen password-nya di panel aja biar sekali klik langsung connect?
Sengaja tidak — RustDesk `rustdesk://` URI belum reliable buat prefill password (masih dalam diskusi upstream), dan nyimpen password remote-control di JSON store itu resiko keamanan kalau file store bocor. Password tetap di RustDesk client masing-masing device.

---

**Selamat, laptop kamu sekarang bisa diremote dari panel! 🎉**

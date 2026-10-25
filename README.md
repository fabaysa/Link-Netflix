# iLink Netflix Bot & Web Portal v5.3 (Unified) — Vercel + Supabase

Versi terpadu (Unified) yang menggabungkan seluruh fitur bisnis dari **iLink-Netflix-Bot** (Sistem Paket Garansi, Voucher Redeem, Limit Harian, Panel Admin, Pencarian Negara Otomatis, Auto-Click Working Status, dan Format Login PC/Mobile/TV) ke dalam arsitektur **Serverless Vercel + Supabase** dengan antarmuka **Web Portal**.

Modul ShopeePay dihilangkan sepenuhnya sehingga sistem berjalan 100% serverless tanpa membutuhkan server/VPS yang menyala 24 jam nonstop.

---

## Fitur Utama

- 🍿 **Generator Link Netflix Otomatis**: Mendukung pengambilan link login instan untuk 🖥️ **PC/Laptop**, 📱 **HP/Mobile**, dan 📺 **Smart TV**.
- 🌍 **Pencarian Negara Dinamis**: Otomatis menjelajahi halaman bot target untuk menemukan negara prioritas (default: `ID`, `MY`, `SG`) dengan stok tersedia.
- ✅ **Auto-Confirm Working Status**: Otomatis mendeteksi dan menekan tombol status `Working ✅` pada bot target serta mengirimkan foto verifikasi otomatis.
- 🛡️ **Sistem Paket Garansi & Kuota Harian**:
  - Pilihan paket (1 Hari, 7 Hari, 30 Hari, Lifetime).
  - Limit klaim harian terintegrasi (misal 5x atau 10x per hari, reset otomatis setiap pukul 00:00 WIB).
- 🎟️ **Sistem Voucher (`/redeem`)**:
  - Admin dapat membuat voucher paket atau saldo secara instan.
  - Pengguna mengaktifkan garansi langsung dengan mengetik `/redeem KODE`.
- 👑 **Panel Admin Lengkap (`/admin`)**:
  - Buat voucher paket baru (`/admin_voucher`).
  - Beri garansi manual ke user (`/admin_garansi`).
  - Ubah prioritas negara secara realtime (`/setnegara ID,MY,SG`).
  - Ubah target bot username (`/settarget SSNetflixBot`).
  - Toggle wajib garansi (`/toggle_garansi`).
  - Broadcast pengumuman ke seluruh pengguna (`/broadcast`).
- 🌐 **Web Portal SPA**:
  - Antarmuka web modern untuk generate token, cek status job realtime, dan akses link perangkat.

---

## Perintah Telegram Pengguna

- `/start` — Menampilkan sapaan, status garansi aktif, sisa kuota harian, dan menu tombol inline.
- `/ambil` — Meminta/mengambil link login Netflix (PC/HP/TV) langsung.
- `/cek` — Mengecek rincian paket garansi, masa berlaku, dan sisa kuota hari ini.
- `/paket` — Melihat daftar paket harga, durasi, limit klaim, dan kontak admin untuk beli.
- `/redeem KODE` — Mengaktifkan voucher garansi atau saldo.
- `/bantuan` — Panduan penggunaan bot.

---

## Perintah Admin

- `/admin` — Membuka panel kontrol admin dengan tombol menu interaktif.
- `/admin_voucher <paket_id> <jumlah>` — Membuat voucher (contoh: `/admin_voucher 30_hari 5`).
- `/admin_garansi <user_id> <hari>` — Memberikan garansi langsung ke ID Telegram tertentu.
- `/setnegara ID,MY,SG` — Mengatur urutan negara prioritas.
- `/settarget SSNetflixBot` — Mengatur username bot target.
- `/toggle_garansi` — Mengaktifkan/menonaktifkan kewajiban garansi untuk klaim token.
- `/broadcast <pesan>` — Mengirimkan pengumuman massal ke seluruh pengguna bot.
- `/engine` — Memeriksa status konfigurasi runtime.

---

## Langkah Instalasi & Deploy

### 1. Jalankan SQL di Supabase
Buka dashboard **Supabase → SQL Editor**, lalu jalankan seluruh isi file [`supabase.sql`](file:///d:/Project%20Bot/Link-Netflix/Link-Netflix-vercel.supabase/supabase.sql).

### 2. Environment Variables di Vercel
Atur environment variables berikut pada project Vercel Anda:

```dotenv
# Telegram Bot Token dari @BotFather
TELEGRAM_BOT_TOKEN=

# Rahasia webhook & setup
TELEGRAM_WEBHOOK_SECRET=
WEBHOOK_SETUP_KEY=

# URL root deployment Vercel (tanpa / di akhir)
BASE_URL=https://link-netflix.vercel.app

# Telegram ID Admin (bisa lebih dari satu dipisahkan koma)
OWNER_TELEGRAM_ID=123456789
ADMIN_IDS=123456789

# Kredensial Database Supabase
SUPABASE_URL=https://xxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJh...

# Kredensial Userbot MTProto (dari my.telegram.org)
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_USER_SESSION=

# Bot Target (default SSNetflixBot)
TARGET_BOT_USERNAME=SSNetflixBot
BRIDGE_WORKER_SECRET=rahasia-worker-internal-anda

# Timeout relay
RELAY_TIMEOUT_MS=90000
```

### 3. Generate `TELEGRAM_USER_SESSION`
1. Buka browser: `https://DOMAIN-ANDA/setup-userbot.html`
2. Masukkan `WEBHOOK_SETUP_KEY`, nomor HP Telegram userbot, kode OTP, dan password 2FA (jika ada).
3. Salin `sessionString` yang didapat dan simpan ke environment variable `TELEGRAM_USER_SESSION` di Vercel, lalu **Redeploy**.

### 4. Aktifkan Webhook Telegram
Buka URL ini sekali di browser untuk mengaktifkan webhook:
```text
https://DOMAIN-ANDA/api/setup-webhook?key=WEBHOOK_SETUP_KEY_ANDA
```
Bot sekarang siap digunakan 100%!

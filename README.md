# Telegram Account Auto Sender v2

Pengirim otomatis yang **menggunakan akun Telegram Anda sendiri** lewat MTProto/GramJS. Control bot hanya dipakai sebagai panel untuk mengubah target, interval, dan teks. Pesan sebenarnya dikirim oleh akun Telegram yang Anda hubungkan.

## Fitur

- Login akun Telegram dengan `API_ID`, `API_HASH`, dan session string.
- Jika `SESSION_STRING` kosong, program meminta nomor, kode Telegram, dan password 2FA saat login pertama kali.
- Kirim ke grup, channel, atau chat/bot yang memang dapat diakses akun tersebut.
- Interval bisa diubah, minimum 30 detik.
- Teks bisa diubah tanpa deploy ulang.
- `/on`, `/off`, `/status`, `/sendnow`.
- Konfigurasi tersimpan di `data/state.json`.

## Setup

1. Buat API credentials di `my.telegram.org`.
2. Buat bot kontrol dengan BotFather.
3. Salin `.env.example` menjadi `.env`.
4. Isi `API_ID`, `API_HASH`, `CONTROL_BOT_TOKEN`, dan `ADMIN_USER_ID`.
5. Jalankan:

```bash
npm install
npm start
```

Pada login pertama, terminal akan meminta nomor, kode Telegram, dan password 2FA bila aktif. Setelah berhasil, program mencetak `SESSION_STRING`. Simpan nilai tersebut ke `.env` supaya restart berikutnya tidak meminta kode lagi.

## Perintah control bot

```text
/start
/settarget @nama_channel
/setinterval 30
/settext Promo hari ini tersedia!
/on
/off
/status
/sendnow
```

Contoh target:

```text
/settarget @nama_channel
/settarget -1001234567890
/settarget @username_bot_tujuan
```

Akun Telegram yang terhubung harus bisa mengakses chat target. Untuk channel, akun tersebut harus punya hak yang diperlukan untuk mengirim. Untuk chat dengan bot lain, akun pengguna dapat mengirim pesan ke bot yang tersedia.

## Deployment

Ini adalah proses yang harus **selalu hidup**, karena interval berjalan dengan timer Node.js. Gunakan VPS atau worker/service yang persistent (mis. Railway/Render worker/VPS). Jangan mengandalkan Vercel Functions untuk timer 30 detik.

## Keamanan

`SESSION_STRING` memberi akses ke sesi akun Telegram. Jangan commit `.env`, jangan membagikannya, dan simpan sebagai secret environment variable.

Gunakan auto-sender hanya pada grup/channel/chat yang mengizinkan pengiriman otomatis agar tidak dianggap spam oleh Telegram.

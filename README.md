# Telegram Userbot Relay — Vercel + Supabase

Versi 5.0 mengubah project lama dari checker khusus menjadi **relay teks generik**.

## Alur

1. Anda mengirim teks ke Telegram Bot milik Anda.
2. Webhook Vercel menyimpan job ke Supabase.
3. Worker Vercel login ke akun Telegram biasa melalui MTProto (`TELEGRAM_USER_SESSION`).
4. Userbot mengirim **teks yang sama** ke bot tujuan (`TARGET_BOT_USERNAME`).
5. Worker menunggu balasan bot tujuan.
6. Teks balasan dikirim kembali ke chat Telegram Bot Anda.
7. Tombol URL pada balasan bot tujuan ikut dibuat ulang sebagai inline button pada bot Anda.

Job diproses **serial** agar balasan dari bot tujuan tidak tertukar antara dua request.

## 1. Supabase

Jalankan seluruh isi `supabase.sql` di **Supabase → SQL Editor**.

Jika tabel project v4 sudah ada, SQL ini tetap kompatibel dan dapat dijalankan ulang.

## 2. Telegram API ID / Hash

Buka `https://my.telegram.org` menggunakan akun Telegram biasa yang akan dijadikan userbot, lalu buat API credentials.

Set di Vercel:

```text
TELEGRAM_API_ID=...
TELEGRAM_API_HASH=...
```

## 3. Environment Variables Vercel

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
WEBHOOK_SETUP_KEY=
BASE_URL=https://domain-anda.vercel.app
OWNER_TELEGRAM_ID=123456789

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_USER_SESSION=

TARGET_BOT_USERNAME=NamaBotTujuan
BRIDGE_WORKER_SECRET=

RELAY_TIMEOUT_MS=120000
RELAY_POLL_MS=1200
RELAY_SETTLE_MS=2200
MAX_RELAY_TEXT_CHARS=4000
```

`TARGET_BOT_USERNAME` dapat ditulis `NamaBotTujuan` atau `@NamaBotTujuan`.

`OWNER_TELEGRAM_ID` opsional tetapi disarankan. Jika diisi, hanya Telegram user ID tersebut yang dapat memakai bot relay.

`BASE_URL` adalah URL root deployment production Vercel, misalnya `https://nama-project.vercel.app`. Variable ini sengaja tidak memakai prefix `PUBLIC_`, sehingga dapat disimpan sebagai environment variable Sensitive/Secret jika kebijakan Vercel Anda mewajibkannya. Jangan tambahkan `/api` atau path lain.


## 4. Membuat TELEGRAM_USER_SESSION

Setelah deploy dan API ID/Hash sudah tersedia, buka:

```text
https://DOMAIN/setup-userbot.html
```

Masukkan `WEBHOOK_SETUP_KEY`, nomor Telegram userbot, kode login Telegram, dan password 2FA jika diminta.

Setelah berhasil, copy `sessionString` ke Vercel sebagai:

```text
TELEGRAM_USER_SESSION=...
```

Lalu Redeploy.

Session string adalah kredensial login penuh akun Telegram tersebut. Simpan sebagai secret dan jangan commit ke repository.

## 5. Setup webhook

Buka:

```text
https://DOMAIN/api/setup-webhook?key=WEBHOOK_SETUP_KEY_ANDA
```

Cek health:

```text
https://DOMAIN/api/health
```

Tes userbot + resolve bot tujuan:

```text
https://DOMAIN/api/userbot-test?key=WEBHOOK_SETUP_KEY_ANDA
```

Tes percakapan `/start` ke bot tujuan:

```text
https://DOMAIN/api/target-test?key=WEBHOOK_SETUP_KEY_ANDA
```

## 6. Penggunaan

Kirim pesan teks biasa ke bot Anda. Contoh:

```text
ABC-123-XYZ
```

Bot Anda akan menampilkan progress, userbot meneruskan `ABC-123-XYZ` ke bot tujuan, kemudian progress tersebut diubah menjadi balasan dari bot tujuan.

Jika balasan bot tujuan memiliki URL button, button tersebut ikut tampil pada bot Anda.

Untuk debug satu request:

```text
/debug ABC-123-XYZ
```

Debug menambahkan target, Job ID, jumlah message, dan ID message terakhir.

## Catatan Vercel

Project ini menggunakan pola **connect → kirim → poll balasan → disconnect** pada setiap job. Ini cocok untuk Vercel tanpa worker VPS persisten, selama bot tujuan membalas sebelum batas `RELAY_TIMEOUT_MS` dan batas durasi function Vercel.

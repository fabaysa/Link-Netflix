# Link Netflix Web v5.5 — Vercel + Supabase

Versi 5.5 melanjutkan perbaikan Web Access v5.4 dan menambahkan panel akses perangkat PC/Laptop, HP/Mobile, dan TV/Smart TV dengan tombol Buka serta Salin URL. Alur browser tetap tidak menerima atau mengekspos cookie/session login.

## Perbaikan utama v5.4

- Web Access tidak lagi bergantung pada HTTP self-call melalui `BASE_URL` untuk memulai worker browser.
- `api/web.js` memproses job browser melalui direct background worker.
- Polling browser dapat mencoba kembali job yang masih `queued`.
- Health check baru: `GET /api/web?health=1`.
- Health check memvalidasi environment penting, tabel/kolom Supabase, dan RPC `claim_gemini_checker_web_job`.
- Pesan error setup lebih jelas di website.
- Polling tidak langsung gagal hanya karena satu network hiccup/cold start.
- Request lama di `localStorage` dibersihkan otomatis.
- `api/web.js` diberi `maxDuration: 300`.

> Mode browser tetap khusus demo non-sensitif. Jangan mengirim cookie akun, password, session ID, access token, atau kredensial login melalui Web Access.

## 1. Supabase

Buka **Supabase → SQL Editor**, lalu jalankan **seluruh isi `supabase.sql`**.

Ini wajib dilakukan lagi saat upgrade dari v5.3 karena v5.4 menambahkan RPC:

```text
claim_gemini_checker_web_job(uuid, text)
```

RPC ini membuat job browser dapat diklaim langsung oleh Web Access tanpa perlu memanggil deployment Vercel melalui `BASE_URL`.

Setelah SQL berhasil, ambil:

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Gunakan server-side secret/service-role key. Jangan pernah meletakkan key ini di `public/`, HTML, atau JavaScript browser.

## 2. Environment Variables Vercel

Gunakan `.env.example` sebagai daftar variabel.

Minimal untuk Web Access:

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_USER_SESSION=
TARGET_BOT_USERNAME=
```

Untuk bot Telegram dan endpoint admin:

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
WEBHOOK_SETUP_KEY=
BASE_URL=https://domain-production-anda.vercel.app
BRIDGE_WORKER_SECRET=
OWNER_TELEGRAM_ID=
```

Opsional:

```text
RELAY_TIMEOUT_MS=120000
RELAY_POLL_MS=1200
RELAY_SETTLE_MS=2200
MAX_RELAY_TEXT_CHARS=4000
```

Setelah mengubah Environment Variables di Vercel, lakukan **Redeploy**.

## 3. TELEGRAM_USER_SESSION

Jika session belum ada, setelah deploy buka:

```text
https://DOMAIN/setup-userbot.html
```

Masukkan `WEBHOOK_SETUP_KEY`, nomor Telegram userbot, kode login, dan password 2FA jika diminta.

Copy `sessionString` hasilnya ke Vercel:

```text
TELEGRAM_USER_SESSION=...
```

Lalu redeploy.

`TELEGRAM_USER_SESSION` adalah kredensial login akun Telegram. Simpan hanya sebagai secret server-side.

## 4. Cek Web Access

Buka:

```text
https://DOMAIN/api/web?health=1
```

Jika benar, respons akan berisi:

```json
{
  "ok": true,
  "ready": true,
  "version": "5.4"
}
```

Jika `ready` bernilai `false`, lihat `checks` dan `message` untuk mengetahui bagian yang belum siap.

Kemudian buka:

```text
https://DOMAIN/
```

Indikator header akan menampilkan:

- `System ready` — backend siap.
- `Setup required` — ada environment/schema yang belum lengkap.
- `System offline` — endpoint web tidak dapat diakses.

Tes browser:

```text
DEMO: Test Web Access
```

Demo memverifikasi alur Vercel → Supabase → Telegram userbot → target bot tanpa meneruskan cookie/session login pengguna.

## 5. Setup webhook Telegram

Setelah `BASE_URL` memakai domain production yang benar, buka:

```text
https://DOMAIN/api/setup-webhook?key=WEBHOOK_SETUP_KEY_ANDA
```

Endpoint pengecekan lain:

```text
https://DOMAIN/api/health
https://DOMAIN/api/config-test?key=WEBHOOK_SETUP_KEY_ANDA
https://DOMAIN/api/runtime-test?key=WEBHOOK_SETUP_KEY_ANDA
https://DOMAIN/api/userbot-test?key=WEBHOOK_SETUP_KEY_ANDA
https://DOMAIN/api/target-test?key=WEBHOOK_SETUP_KEY_ANDA
```

## 6. Jika website masih berhenti di Queued

Periksa berurutan:

1. `https://DOMAIN/api/web?health=1` harus `ready: true`.
2. Pastikan seluruh `supabase.sql` v5.4 sudah dijalankan.
3. Vercel → Project → Logs, cari `claim web job failed` atau `direct web worker failed`.
4. Pastikan `TELEGRAM_USER_SESSION` masih valid.
5. Pastikan `TARGET_BOT_USERNAME` benar dan akun userbot dapat membuka target tersebut.
6. Redeploy setelah setiap perubahan Environment Variables.

Untuk v5.4, `BASE_URL` tidak lagi menentukan apakah job **browser** dapat dimulai. `BASE_URL` masih dipakai oleh webhook/admin/worker Telegram lama.

## 8. Device Access v5.5

Setelah request Web Access selesai, halaman hasil sekarang menampilkan tiga pilihan perangkat:

- PC / Laptop
- HP / Mobile
- TV / Smart TV

Setiap pilihan memiliki tombol **Buka** dan **Salin URL**. URL default menggunakan halaman resmi Netflix dan tidak membawa cookie, password, session ID, access token, atau token login lainnya.

Opsional, URL publik dapat diatur di Vercel dengan:

```text
WEB_PC_ACCESS_URL=https://www.netflix.com/id/login
WEB_MOBILE_ACCESS_URL=https://www.netflix.com/id/login
WEB_TV_ACCESS_URL=https://www.netflix.com/tv8
```

Untuk mencegah URL kredensial terekspos, backend hanya menerima URL HTTPS pada domain `netflix.com`, `www.netflix.com`, atau `help.netflix.com`. URL dengan penanda seperti `nftoken`, `sessionid`, `access_token`, `password`, atau `cookie` otomatis ditolak dan diganti dengan default aman.

# Telegram Bot — Safe Demo Flow

Project ini mempertahankan struktur Vercel + Supabase, tetapi alur token/login pihak ketiga diubah menjadi **mode demo aman**.

## Alur bot

1. Pengguna mengetik `/start`.
2. Bot menampilkan tombol **🗝️ Generate Cookie**.
3. Setelah tombol ditekan, bot meminta teks demo/test.
4. Bot membalas contoh hasil per-device dengan placeholder URL.
5. Tidak ada cookie sesi, password, token login, atau kredensial pihak ketiga yang diproses.

## Environment Variables

Gunakan variable lama yang memang dibutuhkan project Anda, misalnya:

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
WEBHOOK_SETUP_KEY=
BASE_URL=https://domain-anda.vercel.app
OWNER_TELEGRAM_ID=123456789
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Fitur `TARGET_BOT_USERNAME`, `TELEGRAM_USER_SESSION`, dan relay MTProto tidak dipakai pada alur demo ini.

## Contoh penggunaan

```text
/start
```

Tekan:

```text
🗝️ Generate Cookie
```

Kemudian kirim misalnya:

```text
DEMO-123
```

Bot akan mengembalikan contoh link placeholder untuk PC/Laptop, HP/Mobile, dan TV/Smart TV.


## v5.4 safe flow
- `/start` sends the menu first.
- `🗝️ Generate Cookie` must be clicked before the next text message is accepted.
- The next text is one-shot demo input only.
- Real session cookies, passwords, and login tokens are not processed or forwarded.

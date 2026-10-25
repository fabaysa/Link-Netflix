import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { Bot } from 'grammy';

const API_ID = Number(process.env.API_ID || 0);
const API_HASH = process.env.API_HASH || '';
const SESSION_STRING = process.env.SESSION_STRING || '';
const BOT_TOKEN = process.env.CONTROL_BOT_TOKEN || '';
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID || 0);
const DEFAULT_TARGET = process.env.TARGET_CHAT || '';
const DEFAULT_INTERVAL = Number(process.env.INTERVAL_SECONDS || 30);
const DEFAULT_TEXT = process.env.MESSAGE_TEXT || 'Pesan otomatis dari akun Telegram.';
const DEFAULT_ENABLED = String(process.env.ENABLED || 'false').toLowerCase() === 'true';

if (!API_ID || !API_HASH) {
  throw new Error('API_ID dan API_HASH wajib diisi. Ambil dari my.telegram.org.');
}
if (!BOT_TOKEN) {
  throw new Error('CONTROL_BOT_TOKEN wajib diisi untuk panel kontrol.');
}
if (!ADMIN_USER_ID) {
  throw new Error('ADMIN_USER_ID wajib diisi.');
}

const STATE_FILE = path.resolve('data/state.json');
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });

const defaults = {
  targetChat: DEFAULT_TARGET,
  intervalSeconds: Number.isFinite(DEFAULT_INTERVAL) && DEFAULT_INTERVAL >= 30 ? Math.floor(DEFAULT_INTERVAL) : 30,
  messageText: DEFAULT_TEXT,
  enabled: DEFAULT_ENABLED,
};

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadState() {
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
  } catch {
    saveState(defaults);
    return { ...defaults };
  }
}

let state = loadState();
let timer = null;
let sending = false;

const client = new TelegramClient(
  new StringSession(SESSION_STRING),
  API_ID,
  API_HASH,
  { connectionRetries: 5 }
);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

async function ensureLogin() {
  await client.start({
    phoneNumber: async () => await ask('Nomor Telegram (+62...): '),
    password: async () => await ask('Password 2FA: '),
    phoneCode: async () => await ask('Kode Telegram: '),
    onError: (err) => console.error('Login error:', err?.message || err),
  });

  const session = client.session.save();
  if (session && session !== SESSION_STRING) {
    console.log('\nSESSION_STRING baru (simpan di .env):\n');
    console.log(session);
    console.log('');
  }
}

function helpText() {
  return [
    '👤 *Telegram Account Auto Sender*',
    '',
    '`/settarget @username` — target grup/channel/bot',
    '`/setinterval 30` — interval dalam detik (minimum 30)',
    '`/settext Teks pesan` — ubah pesan otomatis',
    '`/on` — aktifkan pengiriman',
    '`/off` — hentikan pengiriman',
    '`/status` — lihat konfigurasi',
    '`/sendnow` — kirim sekali sekarang',
    '`/help` — bantuan',
    '',
    'Pengiriman menggunakan akun Telegram yang terhubung melalui MTProto.',
  ].join('\n');
}

function isAdmin(ctx) {
  return Number(ctx.from?.id || 0) === ADMIN_USER_ID;
}

async function deny(ctx) {
  await ctx.reply('⛔ Kamu tidak memiliki akses untuk mengatur sender ini.');
}

async function resolveTarget() {
  if (!state.targetChat) throw new Error('Target belum diatur. Gunakan /settarget.');
  return await client.getEntity(state.targetChat);
}

async function sendConfiguredMessage() {
  if (!state.enabled) return { skipped: true, reason: 'disabled' };
  if (!state.targetChat) return { skipped: true, reason: 'no-target' };
  if (!state.messageText.trim()) return { skipped: true, reason: 'no-text' };
  if (sending) return { skipped: true, reason: 'busy' };

  sending = true;
  try {
    const entity = await resolveTarget();
    await client.sendMessage(entity, { message: state.messageText });
    return { skipped: false };
  } finally {
    sending = false;
  }
}

function restartTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(async () => {
    try {
      const result = await sendConfiguredMessage();
      if (!result.skipped) console.log(`[${new Date().toISOString()}] Pesan terkirim ke ${state.targetChat}`);
    } catch (err) {
      console.error('[send error]', err?.message || err);
    }
  }, state.intervalSeconds * 1000);
}

const bot = new Bot(BOT_TOKEN);

bot.use(async (ctx, next) => {
  if (ctx.chat?.type !== 'private' || !isAdmin(ctx)) return deny(ctx);
  return next();
});

bot.command('start', async (ctx) => ctx.reply(helpText(), { parse_mode: 'Markdown' }));
bot.command('help', async (ctx) => ctx.reply(helpText(), { parse_mode: 'Markdown' }));

bot.command('settarget', async (ctx) => {
  const value = ctx.match?.trim();
  if (!value) return ctx.reply('Contoh: `/settarget @nama_channel` atau `/settarget -1001234567890`', { parse_mode: 'Markdown' });
  try {
    await client.getEntity(value);
    state.targetChat = value;
    saveState(state);
    await ctx.reply(`✅ Target disimpan: ${value}`);
  } catch (err) {
    await ctx.reply(`❌ Target tidak bisa diakses akun Telegram: ${err?.message || err}`);
  }
});

bot.command('setinterval', async (ctx) => {
  const seconds = Number(ctx.match?.trim());
  if (!Number.isFinite(seconds) || seconds < 30) return ctx.reply('❌ Interval harus angka dan minimal 30 detik.');
  state.intervalSeconds = Math.floor(seconds);
  saveState(state);
  restartTimer();
  await ctx.reply(`✅ Interval diubah menjadi ${state.intervalSeconds} detik.`);
});

bot.command('settext', async (ctx) => {
  const text = ctx.match?.trim();
  if (!text) return ctx.reply('❌ Teks tidak boleh kosong.');
  if (text.length > 4096) return ctx.reply('❌ Teks maksimal 4096 karakter.');
  state.messageText = text;
  saveState(state);
  await ctx.reply('✅ Teks otomatis berhasil diubah.');
});

bot.command('on', async (ctx) => {
  state.enabled = true;
  saveState(state);
  await ctx.reply('✅ Auto sender diaktifkan.');
});

bot.command('off', async (ctx) => {
  state.enabled = false;
  saveState(state);
  await ctx.reply('⏸️ Auto sender dihentikan.');
});

bot.command('status', async (ctx) => {
  await ctx.reply([
    '📊 *Status Auto Sender*',
    `Target: \`${state.targetChat || '-'}\``,
    `Interval: *${state.intervalSeconds} detik*`,
    `Aktif: *${state.enabled ? 'YA' : 'TIDAK'}*`,
    `Teks: ${state.messageText}`,
  ].join('\n'), { parse_mode: 'Markdown' });
});

bot.command('sendnow', async (ctx) => {
  try {
    await sendConfiguredMessage();
    await ctx.reply('✅ Pesan dikirim sekarang menggunakan akun Telegram terhubung.');
  } catch (err) {
    await ctx.reply(`❌ Gagal mengirim: ${err?.message || err}`);
  }
});

bot.catch((err) => console.error('[control bot error]', err.error));

(async () => {
  await ensureLogin();
  const me = await client.getMe();
  console.log(`Akun Telegram terhubung: ${me?.username ? '@' + me.username : me?.id}`);
  restartTimer();
  bot.start({ onStart: (info) => console.log(`Panel kontrol @${info.username} aktif. Sender interval ${state.intervalSeconds}s`) });
})();

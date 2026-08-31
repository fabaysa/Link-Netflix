import { waitUntil } from "@vercel/functions";
import { getSupabase } from "../lib/supabase.js";
import { sendMessage, botApi } from "../lib/telegram-bot.js";
import { maxRelayChars, normalizeRelayText } from "../lib/input.js";
import { enqueueJob } from "../lib/queue.js";
import { kickBridgeWorker } from "../lib/kick-worker.js";

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}


function ownerAllowed(from) {
  const configured = String(process.env.OWNER_TELEGRAM_ID || "").trim();
  if (!configured) return true;
  return String(from?.id || "") === configured;
}

async function upsertUser(from) {
  if (!from?.id) return;
  const supabase = getSupabase();
  const { error } = await supabase
    .from("gemini_checker_users")
    .upsert({
      telegram_user_id: from.id,
      username: from.username || null,
      first_name: from.first_name || null,
      last_name: from.last_name || null,
      updated_at: new Date().toISOString()
    }, { onConflict: "telegram_user_id" });
  if (error) throw error;
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  const from = message.from;
  if (!chatId) return;

  const rawText = typeof message.text === "string" ? message.text : "";

  if (!ownerAllowed(from)) {
    await sendMessage(chatId, "⛔ Bot ini bersifat private.");
    return;
  }

  if (/^\/start(?:@\w+)?$/i.test(rawText.trim())) {
    // Kirim sapaan secepat mungkin; pencatatan user tidak perlu memblokir UI.
    waitUntil(
      upsertUser(from).catch(error => {
        console.error("upsertUser /start failed:", error);
      })
    );

    const firstName = esc(from?.first_name || "User");
    await sendMessage(chatId, [
      `👋 <b>Halo, ${firstName}!</b>`,
      "",
      "Selamat datang di 🍪 <b>Netflix Token Generator Bot</b>",
      "",
      "Bot siap digunakan. Silakan pilih menu atau gunakan perintah yang tersedia.",
      "",
      "<b>Supported Devices:</b>",
      "• 🖥️ PC / Laptop",
      "• 📱 HP / Mobile",
      "• 📺 TV / Smart TV",
      "",
      "⚠️ <b>Penting:</b> Pastikan Cookies Masih Aktif",
      "",
      "📖 Klik <b>Bantuan/tutor</b> untuk melihat panduan penggunaan."
    ].join("\n"), {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🗝️ Generate Cookie", callback_data: "generate_cookie" }],
          [{ text: "📖 Bantuan/tutor", callback_data: "bantuan" }]
        ]
      }
    });
    return;
  }

  if (/^\/help(?:@\w+)?$/i.test(rawText.trim())) {
    await sendMessage(chatId, [
      "📖 <b>Cara Menggunakan Bot:</b>",
      "",
      "1️⃣ Klik tombol <b>🗝️ Generate Cookie</b>",
      "2️⃣ Kirim/paste cookies Netflix kamu",
      "3️⃣ Tunggu bot memproses dan generate link",
      "4️⃣ Kamu akan mendapat link login untuk PC, HP, dan TV",
      "",
      "⚠️ Pastikan cookies masih aktif/valid",
      "💡 Kalo link udah expired, generate lagi aja",
      "",
      "Ketik /start untuk kembali ke menu utama"
    ].join("\n"));
    return;
  }

  if (/^\/engine(?:@\w+)?$/i.test(rawText.trim())) {
    await sendMessage(
      chatId,
      "⚙️ Engine aktif: <code>5.2-branded-relay-vercel</code>"
    );
    return;
  }

  if (!rawText) {
    await sendMessage(chatId, "❌ Saat ini relay menerima pesan teks.");
    return;
  }

  const debugMode = /^\/debug(?:@\w+)?\s+/i.test(rawText);
  const stripped = debugMode
    ? rawText.replace(/^\/debug(?:@\w+)?\s+/i, "")
    : rawText;
  const payload = normalizeRelayText(stripped);

  if (!payload.trim()) {
    await sendMessage(chatId, "❌ Teks kosong.");
    return;
  }

  if (payload.length > maxRelayChars()) {
    await sendMessage(
      chatId,
      `❌ Teks terlalu panjang: <b>${payload.length}</b> karakter. Maksimal <b>${maxRelayChars()}</b> karakter per relay.`
    );
    return;
  }

  await upsertUser(from);

  const progress = await sendMessage(
    chatId,
    "⏳ <b>Permintaan diterima.</b>\n\nSedang memproses NETFLIX Token..."
  );

  const job = await enqueueJob({
    telegramUserId: from?.id,
    chatId,
    inputType: "text",
    payload,
    progressMessageId: progress.message_id,
    debugMode
  });

  waitUntil(
    kickBridgeWorker().catch(error => {
      console.error("kickBridgeWorker failed:", error);
    })
  );

  console.log(`Queued relay job ${job.id}`);
}

async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  const data = callbackQuery.data;
  const from = callbackQuery.from;

  if (!chatId) return;

  // Jalankan acknowledgment tombol tanpa memblokir respons menu.
  waitUntil(
    botApi("answerCallbackQuery", {
      callback_query_id: callbackQuery.id
    }).catch(() => {})
  );

  if (!ownerAllowed(from)) {
    await sendMessage(chatId, "⛔ Bot ini bersifat private.");
    return;
  }

  if (data === "generate_cookie") {
    await sendMessage(chatId, [
      "📤 <b>Kirim cookies Netflix kamu sekarang.</b>",
      "",
      "Paste cookies Netflix kamu di chat ini.",
      "Pastikan cookies masih aktif dan dalam format yang benar.",
      "",
      "⏳ Setelah kamu kirim, aku akan generate NETFLIX Token link untuk kamu.",
      "",
      "💡 <i>Langsung kirim/paste cookies-nya ya!</i>"
    ].join("\n"));
    return;
  }

  if (data === "bantuan") {
    await sendMessage(chatId, [
      "📖 <b>Cara Menggunakan Bot:</b>",
      "",
      "1️⃣ Klik tombol <b>🗝️ Generate Cookie</b>",
      "2️⃣ Kirim/paste cookies Netflix kamu",
      "3️⃣ Tunggu bot memproses dan generate link",
      "4️⃣ Kamu akan mendapat link login untuk PC, HP, dan TV",
      "",
      "⚠️ Pastikan cookies masih aktif/valid",
      "💡 Kalo link udah expired, generate lagi aja",
      "",
      "Ketik /start untuk kembali ke menu utama"
    ].join("\n"));
    return;
  }
}

async function processUpdate(update) {
  try {
    if (update?.message) await handleMessage(update.message);
    if (update?.callback_query) await handleCallbackQuery(update.callback_query);
  } catch (error) {
    console.error(error);
    try {
      const chatId =
        update?.message?.chat?.id ||
        update?.callback_query?.message?.chat?.id;
      if (chatId) {
        await sendMessage(
          chatId,
          `💔 Terjadi error server: <code>${esc(error.message)}</code>`
        );
      }
    } catch {}
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      service: "telegram-webhook",
      engine: "5.2-branded-relay-vercel"
    });
  }

  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const actual = req.headers["x-telegram-bot-api-secret-token"];

  if (expected && actual !== expected) {
    return res.status(401).json({ ok: false, error: "invalid webhook secret" });
  }

  waitUntil(processUpdate(req.body || {}));
  return res.status(200).json({ ok: true });
}

import { waitUntil } from "@vercel/functions";
import { getSupabase } from "../lib/supabase.js";
import { sendMessage } from "../lib/telegram-bot.js";
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
    await upsertUser(from);
    await sendMessage(chatId, [
      "👋 <b>Selamat datang di iLinkin Store!</b>",
      "",
      "✨ Layanan otomatis siap digunakan.",
      "Silakan kirim teks yang ingin diproses dan tunggu sebentar sampai hasilnya dikirim kembali ke chat ini.",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "📢 <b>Grup:</b> https://t.me/ilinkinstore",
      "🤖 <b>Bot Auto Order:</b> @iLinkinBot",
      "💬 Berminat produk kami? Silakan hubungi melalui bot di atas."
    ].join("\n"), {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📢 Join Grup", url: "https://t.me/ilinkinstore" },
            { text: "🤖 Auto Order", url: "https://t.me/iLinkinBot" }
          ]
        ]
      }
    });
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
    "⏳ <b>Meneruskan pesan ke bot tujuan...</b>"
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

async function processUpdate(update) {
  try {
    if (update?.message) await handleMessage(update.message);
  } catch (error) {
    console.error(error);
    try {
      const chatId = update?.message?.chat?.id;
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

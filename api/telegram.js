import { waitUntil } from "@vercel/functions";
import { getSupabase } from "../lib/supabase.js";
import { sendMessage } from "../lib/telegram-bot.js";

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

function startMessage() {
  return [
    "👋 <b>Hello Freze!</b>",
    "",
    "🤖 <b>Netflix NFT Token Generator Bot</b>",
    "",
    "🗝️ <b>Generate Cookie</b>",
    "Kirim data <b>demo/test</b> setelah menekan tombol di bawah untuk melihat format hasil.",
    "",
    "📱 <b>Supported Devices:</b>",
    "• 🖥️ PC/Laptop",
    "• 📱 HP/Mobile",
    "• 📺 TV/Smart TV",
    "",
    "⚠️ <b>Penting:</b> Jangan kirim cookie sesi, password, token login, atau kredensial akun.",
    "",
    "📖 Ketik /help untuk bantuan."
  ].join("\n");
}

function safeDemoResult() {
  const expires = new Date(Date.now() + 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", " UTC");

  return [
    "✅ <b>Demo Token Berhasil Dibuat!</b>",
    "",
    "🔗 <b>Demo Links by Device:</b>",
    "",
    "🖥️ <b>PC / Laptop:</b>",
    "<code>https://example.com/?demo_token=DEMO-PC-TOKEN</code>",
    "",
    "📱 <b>HP / Mobile:</b>",
    "<code>https://example.com/unsupported?demo_token=DEMO-MOBILE-TOKEN</code>",
    "",
    "📺 <b>TV / Smart TV:</b>",
    "<code>https://example.com/tv9?demo_token=DEMO-TV-TOKEN</code>",
    "",
    `⏰ <b>Expired:</b> ${esc(expires)}`,
    "",
    "⚠️ <b>Penting:</b> Ini hanya data demo dan tidak digunakan untuk login layanan pihak ketiga.",
    "",
    "💡 Untuk penggunaan yang sah, gunakan API resmi dan mekanisme autentikasi yang didukung layanan.",
    "",
    "KETIK /start untuk kembali ke menu utama",
    "",
    "📢 <b>Grup:</b> <a href=\"https://t.me/ilinkinstore\">iLinkin Store</a>",
    "🤖 <b>Bot Auto Order:</b> @iLinkinBot"
  ].join("\n");
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  const from = message.from;
  if (!chatId) return;

  const rawText = typeof message.text === "string" ? message.text.trim() : "";

  if (!ownerAllowed(from)) {
    await sendMessage(chatId, "⛔ Bot ini bersifat private.");
    return;
  }

  if (/^\/start(?:@\w+)?$/i.test(rawText)) {
    await upsertUser(from);
    await sendMessage(chatId, startMessage(), {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🗝️ Generate Cookie", callback_data: "generate_cookie_demo" }],
          [
            { text: "📖 Bantuan / tutor", callback_data: "help" },
            { text: "🛒 Order cookies", url: "https://t.me/iLinkinBot" }
          ],
          [{ text: "👥 Grup admin", url: "https://t.me/ilinkinstore" }]
        ]
      }
    });
    return;
  }

  if (/^\/help(?:@\w+)?$/i.test(rawText)) {
    await sendMessage(chatId, [
      "📖 <b>Bantuan</b>",
      "",
      "1. Tekan <b>🗝️ Generate Cookie</b>.",
      "2. Kirim teks demo/test apa saja.",
      "3. Bot akan membalas dengan contoh format link per device.",
      "",
      "⚠️ Jangan kirim cookie sesi, password, token login, atau kredensial akun."
    ].join("\n"));
    return;
  }

  if (/^\/engine(?:@\w+)?$/i.test(rawText)) {
    await sendMessage(chatId, "⚙️ <b>Engine:</b> <code>safe-demo-token-flow</code>");
    return;
  }

  if (!rawText) {
    await sendMessage(chatId, "❌ Saat ini bot menerima pesan teks untuk mode demo.");
    return;
  }

  // Do not accept or process real session cookies / login credentials.
  // The bot always returns a safe mock result for arbitrary text input.
  await upsertUser(from);
  const progress = await sendMessage(chatId, "⏳ <b>Membuat hasil demo...</b>");

  waitUntil((async () => {
    try {
      await new Promise(resolve => setTimeout(resolve, 450));
      await import("../lib/telegram-bot.js").then(({ editMessage }) =>
        editMessage(chatId, progress.message_id, safeDemoResult())
      );
    } catch (error) {
      console.error("demo result failed", error);
      try {
        await sendMessage(chatId, `💔 Error: <code>${esc(error.message || String(error))}</code>`);
      } catch {}
    }
  })());
}

async function processUpdate(update) {
  try {
    if (update?.message) await handleMessage(update.message);
    if (update?.callback_query) await handleCallbackQuery(update.callback_query);
  } catch (error) {
    console.error(error);
    try {
      const chatId = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id;
      if (chatId) await sendMessage(chatId, `💔 Terjadi error server: <code>${esc(error.message)}</code>`);
    } catch {}
  }
}

async function answerCallbackQuery(callbackQueryId) {
  try {
    const { botApi } = await import("../lib/telegram-bot.js");
    await botApi("answerCallbackQuery", {
      callback_query_id: callbackQueryId
    });
  } catch (error) {
    console.error("answerCallbackQuery failed", error);
  }
}

async function handleCallbackQuery(query) {
  const chatId = query?.message?.chat?.id;
  if (!chatId) return;
  await answerCallbackQuery(query.id);

  if (query.data === "generate_cookie_demo") {
    await sendMessage(chatId, [
      "🗝️ <b>Generate Cookie — Mode Demo</b>",
      "",
      "Silakan kirim teks demo/test sekarang.",
      "",
      "⚠️ Jangan kirim cookie sesi Netflix, password, token login, atau kredensial akun apa pun."
    ].join("\n"));
    return;
  }

  if (query.data === "help") {
    await sendMessage(chatId, "📖 Tekan <b>🗝️ Generate Cookie</b>, lalu kirim teks demo/test untuk melihat contoh hasil.");
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      service: "telegram-webhook",
      engine: "safe-demo-token-flow"
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

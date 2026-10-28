import { waitUntil } from "@vercel/functions";
import crypto from "node:crypto";
import {
  connectAuthorizedUser,
  sendRelayText,
  waitForTargetReply,
  targetUsername,
  targetCookieUsername,
  targetLoginUsername
} from "../lib/userbot.js";
import { executeNetflixBridgeFlow } from "../lib/netflix-bridge.js";
import {
  consumeClaimQuota,
  getBridgeAccounts,
  getSetting,
  getActiveTargetBots,
  isAdmin,
  checkUserWarranty,
  saveUserLastAccountCookies
} from "../lib/store.js";
import { extractCookiesFromResult } from "../lib/bot-parser.js";
import {
  claimJob,
  completeJob,
  failJob,
  queuedCount
} from "../lib/queue.js";
import {
  editMessage,
  editPlainMessage,
  sendMessage,
  sendPlainMessage
} from "../lib/telegram-bot.js";
import { kickBridgeWorker } from "../lib/kick-worker.js";

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function authorized(req) {
  const expected = String(process.env.BRIDGE_WORKER_SECRET || "");
  const header = String(req.headers.authorization || "");
  return expected && header === `Bearer ${expected}`;
}

function telegramKeyboard(urlButtons) {
  const rows = (urlButtons || [])
    .map(row =>
      (row || [])
        .filter(button => button?.text && button?.url)
        .filter(button => !/order/i.test(button.text))
        .map(button => ({ text: button.text, url: button.url }))
    )
    .filter(row => row.length);

  rows.push([{ text: "🌐 Akses Website", url: "https://link-netflix.vercel.app" }]);

  return { inline_keyboard: rows };
}

function mergeButtons(messages) {
  const rows = [];
  for (const item of messages || []) {
    for (const row of item.urlButtons || []) rows.push(row);
  }
  return rows;
}

function brandingFooterHtml() {
  return "\n\n⚡ <i>Powered by iLink.in Store</i>";
}

function brandingFooterPlain() {
  return "\n\nPowered by iLink.in Store";
}

function alreadyHasBranding(text) {
  // Branding dihilangkan — selalu return true agar footer tidak ditambahkan.
  return true;
}
function transformReplyText(text) {
  let out = text;

  // Samakan branding yang terlihat pengguna.
  out = out.replace(/Netflix NFT Token Generator Bot/gi, "Netflix Token Generator Bot");
  out = out.replace(/NFT Token Berhasil Digenerate/g, "NETFLIX Token Berhasil Digenerate");
  out = out.replace(/NFT Token Links by Device/g, "NETFLIX Token Links by Device");

  // Hapus baris branding target bot
  out = out
    .split("\n")
    .filter(line => {
      const l = line.toLowerCase();
      if (l.includes("grup skynet")) return false;
      if (l.includes("bot auto order")) return false;
      if (l.includes("minat produk kami")) return false;
      if (l.includes("@skystoreautobot")) return false;
      if (l.includes("t.me/+e1djocxf2og3nzk9")) return false;
      return true;
    })
    .join("\n");

  // Ganti blok peringatan lama dengan versi yang lebih rapi
  out = out.replace(
    /⚠️\s*Penting:.*?Pake link.*?\n[\s\S]*?generate.* lagi aja\./i,
    [
      "⚠️ Perhatian: Gunakan link sebelum waktu kedaluwarsa yang tertera.",
      "📱 Buka link pada perangkat yang sesuai sebelum masa berlakunya habis.",
      "🏠 Ketik /start untuk kembali ke menu utama.",
      "🔄 Jika link sudah kedaluwarsa, lakukan generate ulang."
    ].join("\n")
  );

  // Bersihkan baris kosong berlebihan
  out = out.replace(/\n{3,}/g, "\n\n").trim();

  return out;
}

function buildReplyText(result) {
  const parts = (result.messages || [])
    .map(item => String(item.text || "").trim())
    .filter(Boolean);

  let text = parts.join("\n\n") || "(Bot tujuan membalas tanpa teks.)";
  text = transformReplyText(text);
  if (!text.includes("iLink.in Store")) {
    text += brandingFooterPlain();
  }
  return text;
}

function buildReplyHtml(result) {
  const parts = (result.messages || [])
    .map(item => String(item.html || "").trim())
    .filter(Boolean);

  let html = parts.join("\n\n") || "(Bot tujuan membalas tanpa teks.)";
  html = transformReplyText(html);
  if (!html.includes("iLink.in Store")) {
    html += brandingFooterHtml();
  }
  return html;
}

function buildNetflixResultHtml(result) {
  const lines = [
    "🍿 <b>NETFLIX Login Token Berhasil Digenerate!</b>",
    "",
    result.country ? `🌍 <b>Negara:</b> <code>${esc(result.country)}</code>\n` : "",
    "<b>Pilih link sesuai perangkat Anda:</b>",
    "",
    result.pcUrl ? `🖥️ <b>PC / Laptop:</b>\n<a href="${esc(result.pcUrl)}">${esc(result.pcUrl)}</a>\n` : "",
    result.mobileUrl ? `📱 <b>HP / Mobile:</b>\n<a href="${esc(result.mobileUrl)}">${esc(result.mobileUrl)}</a>\n` : "",
    result.tvUrl ? `📺 <b>TV / Smart TV:</b>\n<a href="${esc(result.tvUrl)}">${esc(result.tvUrl)}</a>\n` : "",
    "⚠️ <i>Gunakan link sebelum kedaluwarsa.</i>",
    brandingFooterHtml()
  ].filter(Boolean);

  return lines.join("\n");
}

async function sendResultToUser(job, result) {
  if (!job.telegram_chat_id || Number(job.telegram_chat_id) === 0) {
    return;
  }

  // Jika hasil dari bridge otomatis memiliki PC/Mobile/TV URLs
  if (result.pcUrl || result.mobileUrl || result.tvUrl) {
    const html = buildNetflixResultHtml(result);
    const buttons = result.urlButtons ? result.urlButtons.map((row) => [...row]) : [];
    // Quick action buttons for same account or new account
    buttons.push([
      { text: "🔄 Ambil Link (Akun Sama)", callback_data: "ambil_akun_sama" },
      { text: "✨ Ambil Akun Baru", callback_data: "ambil_akun_baru" }
    ]);
    const extra = { reply_markup: { inline_keyboard: buttons } };

    if (job.telegram_progress_message_id) {
      try {
        await editMessage(
          job.telegram_chat_id,
          job.telegram_progress_message_id,
          html,
          extra
        );
        return;
      } catch (error) {
        console.error("edit progress failed, sending new message:", error.message);
      }
    }
    await sendMessage(job.telegram_chat_id, html, extra);
    return;
  }

  const plainText = buildReplyText(result);
  const html = buildReplyHtml(result);
  const baseButtons = mergeButtons(result.messages);
  const keyboard = telegramKeyboard(baseButtons) || { inline_keyboard: [] };
  // Add quick actions if this is a success response with token
  if (/nftoken=|berhasil/i.test(plainText) || /nftoken=/i.test(html)) {
    keyboard.inline_keyboard = keyboard.inline_keyboard || [];
    keyboard.inline_keyboard.push([
      { text: "🔄 Ambil Link (Akun Sama)", callback_data: "ambil_akun_sama" },
      { text: "✨ Ambil Akun Baru", callback_data: "ambil_akun_baru" }
    ]);
  }
  const extra = keyboard.inline_keyboard?.length ? { reply_markup: keyboard } : {};

  // Pertahankan formatting Telegram target jika hasil masih muat dalam satu message.
  // Untuk output sangat panjang, fallback ke plain text chunk agar tag HTML tidak terpotong.
  if (html.length <= 3900) {
    if (job.telegram_progress_message_id) {
      try {
        await editMessage(
          job.telegram_chat_id,
          job.telegram_progress_message_id,
          html,
          extra
        );
      } catch (error) {
        console.error("edit formatted progress failed:", error);
        await sendMessage(job.telegram_chat_id, html, extra);
      }
    } else {
      await sendMessage(job.telegram_chat_id, html, extra);
    }
  } else {
    const chunks = [];
    for (let i = 0; i < plainText.length; i += 3900) {
      chunks.push(plainText.slice(i, i + 3900));
    }
    if (!chunks.length) chunks.push("(Balasan kosong)");

    if (job.telegram_progress_message_id) {
      try {
        await editPlainMessage(
          job.telegram_chat_id,
          job.telegram_progress_message_id,
          chunks[0],
          chunks.length === 1 ? extra : {}
        );
      } catch (error) {
        console.error("edit progress failed:", error);
        await sendPlainMessage(
          job.telegram_chat_id,
          chunks[0],
          chunks.length === 1 ? extra : {}
        );
      }
    } else {
      await sendPlainMessage(
        job.telegram_chat_id,
        chunks[0],
        chunks.length === 1 ? extra : {}
      );
    }

    for (let i = 1; i < chunks.length; i++) {
      await sendPlainMessage(
        job.telegram_chat_id,
        chunks[i],
        i === chunks.length - 1 ? extra : {}
      );
    }
  }

  if (job.debug_mode) {
    const debug = [
      "🧪 <b>Relay Debug</b>",
      `Target: <code>@${esc(targetUsername())}</code>`,
      `Job: <code>${esc(job.id)}</code>`,
      `Messages: <code>${result.messages?.length || 0}</code>`,
      `Last message ID: <code>${result.resultMessageId || 0}</code>`
    ].join("\n");
    await sendMessage(job.telegram_chat_id, debug);
  }
}

async function sendFailureToUser(job, error) {
  if (!job.telegram_chat_id || Number(job.telegram_chat_id) === 0) {
    return;
  }

  const text = [
    "💔 <b>Relay gagal diproses</b>",
    "",
    `<code>${esc(error?.message || String(error))}</code>`,
    "",
    "Coba lagi. Jika berulang, cek /api/userbot-test dan /api/target-test."
  ].join("\n");

  if (job.telegram_progress_message_id) {
    try {
      await editMessage(
        job.telegram_chat_id,
        job.telegram_progress_message_id,
        text
      );
      return;
    } catch {}
  }

  await sendMessage(job.telegram_chat_id, text);
}

async function processOneJob(job) {
  let client;

  try {
    if (job.telegram_user_id) {
      const requireWarranty = await getSetting("require_warranty", true);
      const isUserAdmin = isAdmin(job.telegram_user_id);
      if (!isUserAdmin && requireWarranty) {
        const warranty = await checkUserWarranty(job.telegram_user_id);
        if (!warranty.hasActiveWarranty) {
          throw new Error("Akses dibatasi: Status akun Anda belum berlisensi VIP aktif.");
        }
        if (warranty.remainingToday <= 0) {
          throw new Error(`Akses dibatasi: Batas kuota harian (${warranty.dailyLimit}x) Anda telah habis.`);
        }
      }
    }

    const bridgeAccounts = await getBridgeAccounts();
    const enabledAccounts = bridgeAccounts.filter(a => a.enabled !== false && a.sessionString);
    let sessionToUse = "";
    if (enabledAccounts.length > 0) {
      sessionToUse = enabledAccounts[Math.floor(Math.random() * enabledAccounts.length)].sessionString;
    }

    const connected = await connectAuthorizedUser(sessionToUse);
    client = connected.client;

    const payloadText = String(job.input_payload || "").trim();
    const isAutoGenerate = !payloadText || /^(generate|ambil|\/ambil|token)$/i.test(payloadText);

    let result = null;
    let lastError = null;
    let successfulTarget = null;

    if (isAutoGenerate) {
      // ═══════════════════════════════════════════════════════════════════════
      // 🎬 1. FITUR MENGAMBIL LINK LOGIN (NETFLIX ACCOUNT / LOGIN LINK GENERATOR)
      // Bot target khusus: SSNetflixBot atau daftar bot login
      // ═══════════════════════════════════════════════════════════════════════
      const activeLoginBots = await getActiveTargetBots("login");
      const candidateBots = activeLoginBots.length > 0
        ? activeLoginBots.map((b) => b.username)
        : [await getSetting("target_bot_login", await getSetting("target_bot", targetLoginUsername()))];

      const countryPriority = await getSetting("country_priority", ["ID", "MY", "SG"]);
      successfulTarget = candidateBots[0];

      for (const botName of candidateBots) {
        try {
          console.log(`[worker] [AMBIL LINK LOGIN] Menjalankan bridge flow ke @${botName} untuk job ${job.id}`);
          result = await executeNetflixBridgeFlow(client, {
            targetBot: botName,
            countryPriorities: countryPriority,
            timeoutMs: 90000
          });
          if (result && (result.pcUrl || result.mobileUrl || result.tvUrl)) {
            successfulTarget = botName;
            break;
          }
        } catch (err) {
          console.warn(`[worker] Bot ambil link @${botName} gagal (${err.message}). Mencoba bot login berikutnya...`);
          lastError = err;
        }
      }
      if (!result && lastError) throw lastError;

      // Simpan cookies dari hasil generator akun Netflix jika ada
      const extractedCookies = extractCookiesFromResult(result);
      if (extractedCookies && job.telegram_user_id) {
        console.log(`[worker] Menyimpan cookies akun login untuk user ${job.telegram_user_id}`);
        await saveUserLastAccountCookies(job.telegram_user_id, extractedCookies, {
          country: result.country,
          targetBot: successfulTarget
        });
      }
    } else {
      // ═══════════════════════════════════════════════════════════════════════
      // 🍪 2. FITUR GENERATE COOKIES (COOKIE TO LOGIN TOKEN RELAY)
      // Bot target khusus: cookiesnetflixskystorebot atau daftar bot cookies
      // ═══════════════════════════════════════════════════════════════════════
      const activeCookieBots = await getActiveTargetBots("cookie");
      const candidateBots = activeCookieBots.length > 0
        ? activeCookieBots.map((b) => b.username)
        : [await getSetting("target_bot_cookie", targetCookieUsername())];

      successfulTarget = candidateBots[0];

      for (const botName of candidateBots) {
        try {
          console.log(`[worker] [GENERATE COOKIES] Menjalankan relay cookies ke @${botName} untuk job ${job.id}`);
          const sent = await sendRelayText(client, payloadText, { targetBot: botName });
          const relayRes = await waitForTargetReply(client, sent.sentMessageId, { targetBot: botName });
          result = {
            ...relayRes,
            sentMessageId: sent.sentMessageId
          };
          successfulTarget = botName;
          break;
        } catch (err) {
          console.warn(`[worker] Bot generate cookie @${botName} gagal (${err.message}). Mencoba bot cookie berikutnya...`);
          lastError = err;
        }
      }
      if (!result && lastError) throw lastError;

      // Jika user mengirimkan cookies langsung atau dari alur akun sama, simpan cookies tersebut
      if (job.telegram_user_id && payloadText && /NetflixId|\[\s*\{/i.test(payloadText)) {
        console.log(`[worker] Menyimpan cookies akun relay untuk user ${job.telegram_user_id}`);
        await saveUserLastAccountCookies(job.telegram_user_id, payloadText, {
          targetBot: successfulTarget
        });
      }
    }

    const storedResult = {
      bridge: "iLink-Netflix-v5.3",
      target: `@${successfulTarget}`,
      country: result.country || null,
      pcUrl: result.pcUrl || null,
      mobileUrl: result.mobileUrl || null,
      tvUrl: result.tvUrl || null,
      cookies: extractCookiesFromResult(result) || (payloadText && /NetflixId|\[\s*\{/i.test(payloadText) ? payloadText : null),
      messages: result.messages || [],
      received_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    };

    await completeJob(job.id, storedResult, {
      target_sent_message_id: result.sentMessageId || 0,
      target_result_message_id: result.resultMessageId || 0
    });

    // Konsumsi kuota garansi jika job berasal dari user Telegram
    if (job.telegram_user_id) {
      try {
        await consumeClaimQuota(job.telegram_user_id);
      } catch (quotaErr) {
        console.warn("consumeClaimQuota failed:", quotaErr.message);
      }
    }

    await sendResultToUser(job, result);

    return {
      ok: true,
      jobId: job.id
    };
  } catch (error) {
    console.error("relay job failed", job.id, error);

    try {
      await failJob(job.id, error.message || String(error));
    } catch (dbError) {
      console.error("failJob update failed:", dbError);
    }

    try {
      await sendFailureToUser(job, error);
    } catch (sendError) {
      console.error("sendFailureToUser failed:", sendError);
    }

    return {
      ok: false,
      jobId: job.id,
      error: error.message || String(error)
    };
  } finally {
    try {
      if (client) await client.disconnect();
    } catch {}
  }
}

async function runWorkerInvocation() {
  const workerId = `vercel-${crypto.randomUUID()}`;
  let job;

  try {
    job = await claimJob(workerId);
  } catch (error) {
    console.error("worker claim failed:", error);
    return;
  }

  if (!job) return;

  await processOneJob(job);

  try {
    if ((await queuedCount()) > 0) {
      await kickBridgeWorker();
    }
  } catch (error) {
    console.error("next worker kick failed:", error);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  if (!authorized(req)) {
    return res.status(401).json({ ok: false, error: "invalid worker secret" });
  }

  waitUntil(
    runWorkerInvocation().catch(error => {
      console.error("bridge worker background error:", error);
    })
  );

  return res.status(202).json({
    ok: true,
    accepted: true,
    engine: "5.2-branded-relay-vercel"
  });
}

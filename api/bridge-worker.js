import { waitUntil } from "@vercel/functions";
import crypto from "node:crypto";
import {
  connectAuthorizedUser,
  sendRelayText,
  waitForTargetReply,
  targetUsername
} from "../lib/userbot.js";
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
        .map(button => ({ text: button.text, url: button.url }))
    )
    .filter(row => row.length);

  return rows.length ? { inline_keyboard: rows } : undefined;
}

function mergeButtons(messages) {
  const rows = [];
  for (const item of messages || []) {
    for (const row of item.urlButtons || []) rows.push(row);
  }
  return rows;
}

function buildReplyText(result) {
  const parts = (result.messages || [])
    .map(item => String(item.text || "").trim())
    .filter(Boolean);

  return parts.join("\n\n") || "(Bot tujuan membalas tanpa teks.)";
}

async function sendResultToUser(job, result) {
  const text = buildReplyText(result);
  const keyboard = telegramKeyboard(mergeButtons(result.messages));
  const extra = keyboard ? { reply_markup: keyboard } : {};

  // Telegram Bot API membatasi text message sekitar 4096 karakter.
  // Untuk reply umum, chunk agar output panjang tetap kembali ke user.
  const chunks = [];
  for (let i = 0; i < text.length; i += 3900) {
    chunks.push(text.slice(i, i + 3900));
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
    const connected = await connectAuthorizedUser();
    client = connected.client;

    const sent = await sendRelayText(client, job.input_payload);
    const result = await waitForTargetReply(client, sent.sentMessageId);

    const storedResult = {
      bridge: "5.0-generic-relay-vercel",
      target: `@${targetUsername()}`,
      messages: result.messages,
      received_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    };

    await completeJob(job.id, storedResult, {
      target_sent_message_id: sent.sentMessageId,
      target_result_message_id: result.resultMessageId
    });

    await sendResultToUser(job, result);

    return {
      ok: true,
      jobId: job.id,
      messageCount: result.messages.length
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
    engine: "5.0-generic-relay-vercel"
  });
}

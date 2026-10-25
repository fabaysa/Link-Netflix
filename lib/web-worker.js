import crypto from "node:crypto";
import { getSupabase } from "./supabase.js";
import { completeJob, failJob } from "./queue.js";
import {
  connectAuthorizedUser,
  testTargetConversation
} from "./userbot.js";
import { isSafeDemoInput, sanitizeWebOutput } from "./safe-relay.js";

function workerId() {
  return `web-${crypto.randomUUID()}`;
}

async function claimWebJob(jobId, id) {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("claim_gemini_checker_web_job", {
    p_job_id: jobId,
    p_worker_id: id
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function markSetupFailure(jobId, error) {
  const message = String(error?.message || error || "Web worker setup error").slice(0, 1200);
  const supabase = getSupabase();

  await supabase
    .from("gemini_checker_jobs")
    .update({
      status: "failed",
      input_payload: null,
      last_error: /claim_gemini_checker_web_job|schema cache|function/i.test(message)
        ? "Supabase belum memakai schema Web Access terbaru. Jalankan ulang supabase.sql lalu redeploy Vercel."
        : "Web worker gagal dimulai. Periksa konfigurasi Supabase dan Vercel.",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", jobId)
    .eq("request_source", "web")
    .eq("status", "queued");
}

function safeMessages(messages = []) {
  return messages.map(item => ({
    messageId: item?.messageId || null,
    text: sanitizeWebOutput(item?.text || "")
  }));
}

async function processWebJob(job) {
  if (job.request_source !== "web") {
    throw new Error("Web worker hanya boleh memproses request browser.");
  }

  const payload = String(job.input_payload || "");
  if (!isSafeDemoInput(payload)) {
    throw new Error("Request web ditolak karena bukan input demo non-sensitif.");
  }

  let client;
  try {
    const connected = await connectAuthorizedUser();
    client = connected.client;

    // Browser mode is an operational demo only: verify that the configured
    // Telegram user session can reach the target bot without forwarding any
    // account cookies, passwords, session IDs, or login tokens.
    const result = await testTargetConversation(client, 30000);
    if (!result.ok) {
      throw new Error(result.reason || "Target bot tidak merespons demo check.");
    }

    const preview = sanitizeWebOutput(result.replyPreview || "").slice(0, 1200);
    const storedResult = {
      bridge: "5.4-web-direct-worker",
      messages: safeMessages([{
        messageId: result.replyMessageId,
        text: [
          "Web Access demo berhasil.",
          "Koneksi Vercel → Supabase → Telegram userbot → target bot aktif.",
          preview ? `Balasan target: ${preview}` : "Target bot merespons tanpa teks."
        ].join("\n\n")
      }]),
      received_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    };

    await completeJob(job.id, storedResult, {
      target_sent_message_id: result.sentMessageId || null,
      target_result_message_id: result.replyMessageId || null
    });

    return {
      ok: true,
      jobId: job.id,
      messageCount: storedResult.messages.length
    };
  } catch (error) {
    try {
      await failJob(job.id, error?.message || String(error));
    } catch (dbError) {
      console.error("web worker failJob failed:", dbError);
    }

    return {
      ok: false,
      jobId: job.id,
      error: error?.message || String(error)
    };
  } finally {
    try {
      if (client) await client.disconnect();
    } catch {}
  }
}

/**
 * Process one specific browser job. The SQL claim function serializes this with
 * the Telegram worker, so one MTProto account is never used by two jobs at once.
 */
export async function runWebWorker(jobId) {
  let job;
  try {
    job = await claimWebJob(jobId, workerId());
  } catch (error) {
    console.error("claim web job failed:", error);
    try {
      await markSetupFailure(jobId, error);
    } catch (markError) {
      console.error("mark web setup failure failed:", markError);
    }
    return { ok: false, claimed: false, error: error?.message || String(error) };
  }

  if (!job) {
    return { ok: true, claimed: false };
  }

  return processWebJob(job);
}

import crypto from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { getSupabase } from "../lib/supabase.js";
import { maxRelayChars, normalizeRelayText } from "../lib/input.js";
import { enqueueJob } from "../lib/queue.js";
import { isSafeDemoInput } from "../lib/safe-relay.js";
import { runWebWorker } from "../lib/web-worker.js";

function accessHash(token = "") {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function publicJob(row) {
  const response = {
    ok: true,
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null
  };

  if (row.status === "completed") response.result = row.result || null;
  if (row.status === "failed") response.error = row.last_error || "Request gagal diproses.";
  return response;
}

function configChecks() {
  const apiId = String(process.env.TELEGRAM_API_ID || "").trim();
  const apiHash = String(process.env.TELEGRAM_API_HASH || "").trim();
  const session = String(process.env.TELEGRAM_USER_SESSION || "").trim();
  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
  const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const target = String(process.env.TARGET_BOT_USERNAME || process.env.GOCHECKER_USERNAME || "").trim();

  return {
    supabaseUrl: /^https:\/\//i.test(supabaseUrl),
    supabaseKey: Boolean(supabaseKey),
    telegramApiId: /^\d+$/.test(apiId),
    telegramApiHash: Boolean(apiHash),
    telegramUserSession: Boolean(session),
    targetBot: Boolean(target)
  };
}

async function handleHealth(_req, res) {
  const checks = configChecks();
  let database = false;
  let workerRpc = false;
  let databaseMessage = "Belum dicek.";

  if (checks.supabaseUrl && checks.supabaseKey) {
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from("gemini_checker_jobs")
        .select("id,request_source,web_access_hash", { head: true })
        .limit(1);

      if (error) throw error;
      database = true;

      // Harmless claim against an impossible ID verifies that the v5.4 RPC
      // migration is visible through PostgREST. No real job is claimed.
      const rpcCheck = await supabase.rpc("claim_gemini_checker_web_job", {
        p_job_id: "00000000-0000-0000-0000-000000000000",
        p_worker_id: "health-check"
      });
      if (rpcCheck.error) throw rpcCheck.error;
      workerRpc = true;
      databaseMessage = "Supabase terhubung dan schema Web Access v5.4 terbaca.";
    } catch (error) {
      databaseMessage = /claim_gemini_checker_web_job|request_source|web_access_hash|column|schema|function/i.test(String(error?.message || error))
        ? "Schema Supabase belum terbaru. Jalankan ulang seluruh supabase.sql."
        : "Supabase tidak dapat diakses dari Vercel.";
    }
  } else {
    databaseMessage = "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum lengkap.";
  }

  const ready = database && workerRpc && Object.values(checks).every(Boolean);
  return res.status(200).json({
    ok: true,
    ready,
    version: "5.4",
    checks: { ...checks, database, workerRpc },
    message: ready ? "Web Access siap digunakan." : databaseMessage
  });
}

async function handleSubmit(req, res) {
  const payload = normalizeRelayText(req.body?.payload || "");

  if (!payload.trim()) {
    return res.status(400).json({ ok: false, error: "Input tidak boleh kosong." });
  }

  if (payload.length > Math.min(maxRelayChars(), 1000)) {
    return res.status(400).json({ ok: false, error: "Input web maksimal 1000 karakter." });
  }

  if (!isSafeDemoInput(payload)) {
    return res.status(400).json({
      ok: false,
      code: "SAFE_WEB_INPUT_REQUIRED",
      error: "Web Access hanya menerima input demo non-sensitif yang diawali DEMO:. Jangan kirim cookie, password, access token, atau session login."
    });
  }

  const checks = configChecks();
  if (!Object.values(checks).every(Boolean)) {
    const missing = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
    return res.status(503).json({
      ok: false,
      code: "WEB_NOT_CONFIGURED",
      error: `Web Access belum siap. Konfigurasi yang belum lengkap: ${missing.join(", ")}.`
    });
  }

  const accessToken = crypto.randomBytes(24).toString("hex");
  const job = await enqueueJob({
    telegramUserId: null,
    chatId: null,
    inputType: "text",
    payload,
    progressMessageId: null,
    debugMode: false,
    requestSource: "web",
    webAccessHash: accessHash(accessToken)
  });

  // v5.4: proses job web langsung di invocation ini, sehingga tidak bergantung
  // pada BASE_URL atau self-fetch ke /api/bridge-worker.
  waitUntil(
    runWebWorker(job.id).catch(error => {
      console.error("direct web worker failed:", error);
    })
  );

  return res.status(202).json({
    ok: true,
    id: job.id,
    accessToken,
    status: job.status,
    message: "Request masuk antrean."
  });
}

async function handleStatus(req, res) {
  const id = String(req.query?.id || "").trim();
  const token = String(req.query?.token || "").trim();

  if (!/^[0-9a-f-]{36}$/i.test(id) || token.length < 20) {
    return res.status(400).json({ ok: false, error: "ID atau access token tidak valid." });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("gemini_checker_jobs")
    .select("id,status,result,last_error,created_at,updated_at,completed_at,request_source,web_access_hash")
    .eq("id", id)
    .eq("request_source", "web")
    .single();

  if (error || !data) {
    return res.status(404).json({ ok: false, error: "Request tidak ditemukan." });
  }

  const incoming = accessHash(token);
  const expected = String(data.web_access_hash || "");
  const valid = expected.length === incoming.length &&
    expected.length > 0 &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(incoming));

  if (!valid) {
    return res.status(403).json({ ok: false, error: "Access token tidak cocok." });
  }

  // Self-healing: jika request masih queued karena invocation awal terputus,
  // polling berikutnya mencoba menjalankan job lagi. SQL memastikan hanya satu
  // worker dapat mengklaim job yang sama.
  if (data.status === "queued") {
    waitUntil(
      runWebWorker(id).catch(workerError => {
        console.error("queued web retry failed:", workerError);
      })
    );
  }

  return res.status(200).json(publicJob(data));
}

function safeServerError(error) {
  const message = String(error?.message || error || "");
  if (/SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/i.test(message)) {
    return "Konfigurasi Supabase di Vercel belum lengkap.";
  }
  if (/gemini_checker_jobs|request_source|web_access_hash|schema cache|relation|column/i.test(message)) {
    return "Schema Supabase belum sesuai. Jalankan ulang seluruh supabase.sql lalu redeploy Vercel.";
  }
  return "Terjadi error server. Cek Vercel Function Logs untuk detailnya.";
}

export default async function handler(req, res) {
  noStore(res);

  try {
    if (req.method === "GET" && String(req.query?.health || "") === "1") {
      return await handleHealth(req, res);
    }
    if (req.method === "POST") return await handleSubmit(req, res);
    if (req.method === "GET") return await handleStatus(req, res);
    return res.status(405).json({ ok: false, error: "GET/POST only" });
  } catch (error) {
    console.error("web api error:", error);
    return res.status(500).json({ ok: false, error: safeServerError(error) });
  }
}

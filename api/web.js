import crypto from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { getSupabase } from "../lib/supabase.js";
import { maxRelayChars, normalizeRelayText } from "../lib/input.js";
import { enqueueJob } from "../lib/queue.js";
import { kickBridgeWorker } from "../lib/kick-worker.js";
import { isSafeDemoInput } from "../lib/safe-relay.js";

function accessHash(token = "") {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
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

  if (row.status === "completed") {
    response.result = row.result || null;
  }

  if (row.status === "failed") {
    response.error = row.last_error || "Request gagal diproses.";
  }

  return response;
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

  waitUntil(
    kickBridgeWorker().catch(error => {
      console.error("web kickBridgeWorker failed:", error);
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
  const valid = expected.length === incoming.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(incoming));

  if (!valid) {
    return res.status(403).json({ ok: false, error: "Access token tidak cocok." });
  }

  return res.status(200).json(publicJob(data));
}

export default async function handler(req, res) {
  noStore(res);

  try {
    if (req.method === "POST") return await handleSubmit(req, res);
    if (req.method === "GET") return await handleStatus(req, res);
    return res.status(405).json({ ok: false, error: "GET/POST only" });
  } catch (error) {
    console.error("web api error:", error);
    return res.status(500).json({ ok: false, error: "Terjadi error server." });
  }
}

import { getSupabase } from "../lib/supabase.js";
import { parseBotReply } from "../lib/bot-parser.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metode tidak diizinkan. Gunakan GET." });
  }

  const jobId = String(req.query?.id || req.query?.jobId || "").trim();

  if (!jobId) {
    return res.status(400).json({ ok: false, error: "Parameter 'id' (job ID) wajib diisi." });
  }

  // Basic UUID format validation
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    return res.status(400).json({ ok: false, error: "Format Job ID tidak valid (harus UUID)." });
  }

  try {
    const supabase = getSupabase();
    const { data: job, error } = await supabase
      .from("gemini_checker_jobs")
      .select("id, status, attempts, last_error, result, created_at, completed_at")
      .eq("id", jobId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!job) {
      return res.status(404).json({ ok: false, error: "Job tidak ditemukan." });
    }

    let parsed = null;
    if (job.status === "completed" && job.result) {
      parsed = parseBotReply(job.result);
    }

    return res.status(200).json({
      ok: true,
      jobId: job.id,
      status: job.status,
      attempts: job.attempts,
      createdAt: job.created_at,
      completedAt: job.completed_at,
      error: job.last_error,
      result: job.result,
      parsed
    });
  } catch (error) {
    console.error("api/job-status failed:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Terjadi kesalahan saat memeriksa status antrian."
    });
  }
}

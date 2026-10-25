import { waitUntil } from "@vercel/functions";
import { enqueueJob } from "../lib/queue.js";
import { kickBridgeWorker } from "../lib/kick-worker.js";
import { maxRelayChars, normalizeRelayText } from "../lib/input.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metode tidak diizinkan. Gunakan POST." });
  }

  try {
    const rawPayload = req.body?.payload ?? req.body?.cookie ?? req.body?.text ?? "";
    const payload = normalizeRelayText(rawPayload);

    if (!payload.trim()) {
      return res.status(400).json({ ok: false, error: "Cookie atau teks tidak boleh kosong." });
    }

    const maxChars = maxRelayChars();
    if (payload.length > maxChars) {
      return res.status(400).json({
        ok: false,
        error: `Teks terlalu panjang (${payload.length} karakter). Maksimal ${maxChars} karakter.`
      });
    }

    const job = await enqueueJob({
      chatId: 0,
      inputType: "text",
      payload,
      debugMode: Boolean(req.body?.debug)
    });

    waitUntil(
      kickBridgeWorker().catch(err => {
        console.error("Worker kick error from generate endpoint:", err);
      })
    );

    return res.status(202).json({
      ok: true,
      jobId: job.id,
      status: job.status,
      message: "Job berhasil dimasukkan ke dalam antrian."
    });
  } catch (error) {
    console.error("api/generate failed:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Terjadi kesalahan pada server saat memasukkan job ke antrian."
    });
  }
}

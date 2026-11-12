import { waitUntil } from "@vercel/functions";
import { enqueueJob } from "../lib/queue.js";
import { kickBridgeWorker } from "../lib/kick-worker.js";
import {
  getClaimStatusByCode,
  redeemVoucherForWeb,
  getUserLastAccountCookies,
  getSetting,
  isAdmin
} from "../lib/store.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metode tidak diizinkan. Gunakan POST." });
  }

  const code = String(req.body?.code || req.body?.license || req.body?.voucher || "").trim();
  const reqMode = String(req.body?.mode || "baru").toLowerCase();
  const reqCountry = String(req.body?.country || "").toUpperCase().trim();

  if (!code) {
    return res.status(400).json({ ok: false, error: "Kode lisensi atau voucher wajib diisi." });
  }

  try {
    let status = await getClaimStatusByCode(code);
    if (!status.ok) {
      return res.status(404).json({ ok: false, error: status.error || "Kode lisensi tidak valid." });
    }

    // Jika voucher belum di-redeem, kita auto-aktivasi untuk web
    if (status.needsActivation) {
      const redeemRes = await redeemVoucherForWeb(code);
      if (!redeemRes.ok) {
        return res.status(400).json({ ok: false, error: redeemRes.message || "Gagal mengaktifkan voucher." });
      }
      status = await getClaimStatusByCode(code);
    }

    const userId = status.userId;
    const isAdminUser = isAdmin(userId);
    const requireWarranty = await getSetting("require_warranty", true);

    if (status.isBanned) {
      return res.status(403).json({ ok: false, error: "Akun atau lisensi ini telah dinonaktifkan." });
    }

    if (!isAdminUser && requireWarranty && !status.hasActiveWarranty) {
      return res.status(403).json({
        ok: false,
        code: "WARRANTY_EXPIRED",
        error: "Lisensi garansi Anda belum aktif atau sudah kedaluwarsa. Silakan perpanjang paket atau redeem voucher baru."
      });
    }

    if (!isAdminUser && requireWarranty && status.remainingToday <= 0) {
      return res.status(429).json({
        ok: false,
        code: "DAILY_LIMIT_EXCEEDED",
        error: `Batas klaim harian Anda hari ini sudah habis (Maksimal ${status.dailyLimit}x per hari). Kuota akan direset pukul 00:00 WIB.`
      });
    }

    // Penentuan Payload berdasarkan Mode (Akun Baru vs Akun Sama)
    let payload = "generate";
    let finalMode = "baru";

    if (reqMode === "sama") {
      const lastAccount = await getUserLastAccountCookies(userId);
      if (lastAccount?.cookies) {
        payload = lastAccount.cookies;
        finalMode = "sama";
      } else {
        payload = reqCountry ? `generate:${reqCountry}` : "generate";
        finalMode = "baru";
      }
    } else {
      payload = reqCountry ? `generate:${reqCountry}` : "generate";
      finalMode = "baru";
    }

    const job = await enqueueJob({
      telegramUserId: userId,
      chatId: 0,
      inputType: "text",
      payload,
      debugMode: Boolean(req.body?.debug)
    });

    waitUntil(
      kickBridgeWorker().catch((err) => {
        console.error("Worker kick error from claim endpoint:", err);
      })
    );

    return res.status(202).json({
      ok: true,
      jobId: job.id,
      status: job.status,
      mode: finalMode,
      message: finalMode === "sama"
        ? "Sedang memproses link login baru untuk akun yang sama..."
        : "Permintaan klaim akun Netflix baru sedang diproses..."
    });
  } catch (error) {
    console.error("api/claim failed:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Terjadi kesalahan pada server saat memproses klaim."
    });
  }
}


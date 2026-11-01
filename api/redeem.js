import { redeemVoucherForWeb, getClaimStatusByCode } from "../lib/store.js";

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

  const code = String(req.body?.code || req.body?.voucher || "").trim();
  if (!code) {
    return res.status(400).json({ ok: false, error: "Kode voucher tidak boleh kosong." });
  }

  try {
    const result = await redeemVoucherForWeb(code);
    if (!result.ok) {
      return res.status(400).json(result);
    }

    const status = await getClaimStatusByCode(code);
    return res.status(200).json({
      ok: true,
      message: result.message || "Voucher berhasil diaktifkan!",
      status
    });
  } catch (error) {
    console.error("api/redeem failed:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Terjadi kesalahan pada server saat redeem voucher."
    });
  }
}


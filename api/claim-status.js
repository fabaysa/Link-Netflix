import { getClaimStatusByCode, getPackages, getSetting } from "../lib/store.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metode tidak diizinkan. Gunakan GET." });
  }

  const code = String(req.query?.code || "").trim();
  const includePackages = req.query?.packages === "1" || req.query?.packages === "true";

  let packages = null;
  let supportUsername = "iLinkinStore";
  if (includePackages) {
    try {
      packages = await getPackages({ onlyEnabled: true });
      supportUsername = await getSetting("support_username", "iLinkinStore");
    } catch (e) {
      console.warn("Failed fetching packages:", e);
    }
  }

  if (!code) {
    return res.status(200).json({
      ok: true,
      packages,
      supportUsername,
      message: "Silakan masukkan kode lisensi / voucher untuk memeriksa status."
    });
  }

  try {
    const status = await getClaimStatusByCode(code);
    return res.status(status.ok ? 200 : 404).json({
      ...status,
      packages,
      supportUsername
    });
  } catch (error) {
    console.error("api/claim-status failed:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Terjadi kesalahan pada server saat memeriksa status kode."
    });
  }
}


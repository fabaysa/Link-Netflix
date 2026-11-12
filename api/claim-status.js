import { getClaimStatusByCode, getPackages, getSetting } from "../lib/store.js";
import { formatCountryButtonLabel } from "../lib/country-button-finder.js";

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
  let allowedCountries = [
    { code: "ID", name: formatCountryButtonLabel("ID") },
    { code: "MY", name: formatCountryButtonLabel("MY") },
    { code: "SG", name: formatCountryButtonLabel("SG") }
  ];

  try {
    const rawCountries = await getSetting("country_priority", ["ID", "MY", "SG"]);
    const normalized = [...new Set(
      (Array.isArray(rawCountries) && rawCountries.length ? rawCountries : ["ID", "MY", "SG"])
        .map((c) => String(c || "").toUpperCase().trim())
        .filter(Boolean)
    )];
    allowedCountries = normalized.map((c) => ({
      code: c,
      name: formatCountryButtonLabel(c)
    }));
  } catch (e) {
    console.warn("Failed fetching country_priority:", e);
  }

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
      allowedCountries,
      message: "Silakan masukkan kode lisensi / voucher untuk memeriksa status."
    });
  }

  try {
    const status = await getClaimStatusByCode(code);
    return res.status(status.ok ? 200 : 404).json({
      ...status,
      packages,
      supportUsername,
      allowedCountries
    });
  } catch (error) {
    console.error("api/claim-status failed:", error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Terjadi kesalahan pada server saat memeriksa status kode."
    });
  }
}


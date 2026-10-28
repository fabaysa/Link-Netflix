import crypto from "node:crypto";
import { getSupabase } from "./supabase.js";

function todayJakarta() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function normalizeCode(raw) {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
}

function hashCode(raw) {
  return crypto.createHash("sha256").update(normalizeCode(raw)).digest("hex");
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(prefix = "NETFLIX") {
  const bytes = crypto.randomBytes(12);
  let rand = "";
  for (let i = 0; i < 12; i++) {
    rand += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return `${prefix}-${rand.slice(0, 4)}-${rand.slice(4, 8)}-${rand.slice(8, 12)}`;
}

// ─── USER & WARRANTY ───────────────────────────────────────────────────────────

export async function upsertUser(from) {
  if (!from?.id) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("gemini_checker_users")
    .upsert({
      telegram_user_id: from.id,
      username: from.username || null,
      first_name: from.first_name || null,
      last_name: from.last_name || null,
      updated_at: new Date().toISOString()
    }, { onConflict: "telegram_user_id" })
    .select()
    .single();

  if (error) {
    console.error("upsertUser error:", error.message);
    throw error;
  }
  return data;
}

export async function getUser(userId) {
  if (!userId) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("gemini_checker_users")
      .select("*")
      .eq("telegram_user_id", userId)
      .maybeSingle();

    if (error) {
      console.warn("[store] getUser error:", error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn("[store] getUser exception:", err.message);
    return null;
  }
}

export async function getAllUserIds() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("gemini_checker_users")
    .select("telegram_user_id");

  if (error) return [];
  return (data || []).map((u) => String(u.telegram_user_id));
}

export function isAdmin(userId) {
  if (!userId) return false;
  const ownerId = String(process.env.OWNER_TELEGRAM_ID || "").trim();
  const adminIds = String(process.env.ADMIN_IDS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const uid = String(userId);
  return (ownerId && uid === ownerId) || adminIds.includes(uid);
}

export async function checkUserWarranty(userId) {
  const user = await getUser(userId);
  const today = todayJakarta();

  if (!user) {
    return {
      exists: false,
      hasActiveWarranty: false,
      isExpired: true,
      isLifetime: false,
      expiresAt: null,
      dailyLimit: 0,
      claimsToday: 0,
      remainingToday: 0,
      packageName: null,
      isBanned: false
    };
  }

  const isBanned = Boolean(user.is_banned);
  const isLifetime = Boolean(user.warranty_lifetime);
  const expiresAt = user.warranty_expires_at ? new Date(user.warranty_expires_at) : null;
  const isExpired = !isLifetime && (!expiresAt || expiresAt.getTime() <= Date.now());
  const hasActiveWarranty = !isBanned && (isLifetime || !isExpired);

  const dailyLimit = hasActiveWarranty ? Math.max(1, Number(user.warranty_daily_limit || 5)) : 0;
  const isSameDay = user.warranty_last_claim_date === today;
  const claimsToday = isSameDay ? Math.max(0, Number(user.warranty_claims_today || 0)) : 0;
  const remainingToday = hasActiveWarranty ? Math.max(0, dailyLimit - claimsToday) : 0;

  return {
    exists: true,
    user,
    hasActiveWarranty,
    isExpired,
    isLifetime,
    expiresAt,
    dailyLimit,
    claimsToday,
    remainingToday,
    packageName: user.warranty_package_name || (isLifetime ? "Lifetime" : null),
    isBanned
  };
}

export async function consumeClaimQuota(userId) {
  if (!userId) return;
  const supabase = getSupabase();
  const today = todayJakarta();

  const user = await getUser(userId);
  if (!user) return;

  const isSameDay = user.warranty_last_claim_date === today;
  const nextClaims = isSameDay ? (Number(user.warranty_claims_today || 0) + 1) : 1;

  await supabase
    .from("gemini_checker_users")
    .update({
      warranty_claims_today: nextClaims,
      warranty_last_claim_date: today,
      updated_at: new Date().toISOString()
    })
    .eq("telegram_user_id", userId);
}

// ─── RESILIENT FALLBACK STORES (For zero-downtime and missing table recovery) ───

export function isTableMissingError(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  const code = String(err.code || "");
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    /schema cache|relation.*does not exist|could not find the table/i.test(msg)
  );
}

const defaultPackages = [
  { id: "1_hari", name: "1 Hari", duration_days: 1, duration_hours: 0, lifetime: false, daily_limit: 5, price: 5000, enabled: true },
  { id: "7_hari", name: "7 Hari", duration_days: 7, duration_hours: 0, lifetime: false, daily_limit: 5, price: 15000, enabled: true },
  { id: "30_hari", name: "1 Bulan (30 Hari)", duration_days: 30, duration_hours: 0, lifetime: false, daily_limit: 10, price: 35000, enabled: true },
  { id: "lifetime", name: "Lifetime (Selamanya)", duration_days: 0, duration_hours: 0, lifetime: true, daily_limit: 20, price: 100000, enabled: true }
];
let memoryPackages = [...defaultPackages];

const defaultSettings = {
  country_priority: ["ID", "MY", "SG"],
  target_bot: "SSNetflixBot",
  target_bot_login: "SSNetflixBot",
  target_bot_cookie: "cookiesnetflixskystorebot",
  target_bots: [
    {
      id: "target-login-1",
      username: "SSNetflixBot",
      label: "@SSNetflixBot (Ambil Link Login)",
      type: "login",
      enabled: true,
      priority: 1,
      createdAt: new Date().toISOString()
    },
    {
      id: "target-cookie-1",
      username: "cookiesnetflixskystorebot",
      label: "@cookiesnetflixskystorebot (Generate Cookies)",
      type: "cookie",
      enabled: true,
      priority: 1,
      createdAt: new Date().toISOString()
    }
  ],
  bridge_workflows: {},
  support_username: "iLinkinStore",
  require_warranty: true,
  daily_limit_default: 5,
  workflow_photos: [],
  bridge_accounts: []
};
const memorySettings = new Map();

// ─── STATS ────────────────────────────────────────────────────────────────────

export async function getStats() {
  const supabase = getSupabase();

  let usersCount = 0;
  let activeWarrantiesCount = 0;
  let totalJobsCount = 0;
  let totalCodes = 0;
  let usedCodes = 0;

  try {
    const res = await supabase.from("gemini_checker_users").select("*", { count: "exact", head: true });
    if (!res.error) usersCount = res.count || 0;
  } catch {}

  try {
    const res = await supabase
      .from("gemini_checker_users")
      .select("*", { count: "exact", head: true })
      .or("warranty_lifetime.eq.true,warranty_expires_at.gt.now()");
    if (!res.error) activeWarrantiesCount = res.count || 0;
  } catch {}

  try {
    const res = await supabase
      .from("gemini_checker_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", "completed");
    if (!res.error) totalJobsCount = res.count || 0;
  } catch {}

  try {
    const res = await supabase.from("vouchers").select("is_redeemed");
    if (!res.error && Array.isArray(res.data)) {
      totalCodes = res.data.length;
      usedCodes = res.data.filter((v) => v.is_redeemed).length;
    }
  } catch {}

  return {
    users: usersCount,
    activeWarranties: activeWarrantiesCount,
    totalUrlsFetched: totalJobsCount,
    codes: {
      total: totalCodes,
      used: usedCodes,
      unused: totalCodes - usedCodes
    }
  };
}

// ─── PACKAGES ─────────────────────────────────────────────────────────────────

export async function getPackages({ onlyEnabled = false } = {}) {
  try {
    const supabase = getSupabase();
    let query = supabase.from("packages").select("*").order("price", { ascending: true });
    if (onlyEnabled) {
      query = query.eq("enabled", true);
    }
    const { data, error } = await query;
    if (!error && Array.isArray(data) && data.length > 0) {
      memoryPackages = data;
      return data;
    }
    if (error && isTableMissingError(error)) {
      console.warn("[store] Tabel 'packages' belum ada di Supabase. Menggunakan paket default.");
    }
  } catch (err) {
    if (!isTableMissingError(err)) {
      console.warn("[store] getPackages warning:", err.message);
    }
  }

  return onlyEnabled ? memoryPackages.filter((p) => p.enabled) : memoryPackages;
}

export async function getPackage(packageId) {
  if (!packageId) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("packages")
      .select("*")
      .eq("id", packageId)
      .maybeSingle();

    if (!error && data) return data;
  } catch {}

  return memoryPackages.find((p) => p.id === packageId) || null;
}

export async function addPackage({ name, price, durationDays = 0, durationHours = 0, lifetime = false, dailyLimit = 5 }) {
  const id = `pkg_${Date.now().toString(36)}`;
  const newPkg = {
    id,
    name,
    price: Number(price) || 0,
    duration_days: Number(durationDays) || 0,
    duration_hours: Number(durationHours) || 0,
    lifetime: Boolean(lifetime),
    daily_limit: Math.max(1, Number(dailyLimit) || 5),
    enabled: true
  };
  memoryPackages.push(newPkg);

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("packages")
      .insert(newPkg)
      .select()
      .maybeSingle();

    if (!error && data) return data;
  } catch (err) {
    if (!isTableMissingError(err)) throw err;
  }

  return newPkg;
}

export async function updatePackage(id, patch = {}) {
  const pkgIdx = memoryPackages.findIndex((p) => p.id === id);
  if (pkgIdx !== -1) {
    memoryPackages[pkgIdx] = { ...memoryPackages[pkgIdx], ...patch };
  }

  try {
    const supabase = getSupabase();
    const fields = {};
    if (patch.name !== undefined) fields.name = patch.name;
    if (patch.price !== undefined) fields.price = Number(patch.price);
    if (patch.duration_days !== undefined) fields.duration_days = Number(patch.duration_days);
    if (patch.durationDays !== undefined) fields.duration_days = Number(patch.durationDays);
    if (patch.duration_hours !== undefined) fields.duration_hours = Number(patch.duration_hours);
    if (patch.durationHours !== undefined) fields.duration_hours = Number(patch.durationHours);
    if (patch.lifetime !== undefined) fields.lifetime = Boolean(patch.lifetime);
    if (patch.daily_limit !== undefined) fields.daily_limit = Math.max(1, Number(patch.daily_limit));
    if (patch.dailyReclaimLimit !== undefined) fields.daily_limit = Math.max(1, Number(patch.dailyReclaimLimit));
    if (patch.enabled !== undefined) fields.enabled = Boolean(patch.enabled);

    const { data, error } = await supabase
      .from("packages")
      .update(fields)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (!error && data) return data;
  } catch (err) {
    if (!isTableMissingError(err)) throw err;
  }

  return memoryPackages.find((p) => p.id === id) || null;
}

export async function deletePackage(id) {
  memoryPackages = memoryPackages.filter((p) => p.id !== id);
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("packages").delete().eq("id", id);
    if (error && !isTableMissingError(error)) throw error;
  } catch (err) {
    if (!isTableMissingError(err)) throw err;
  }
  return true;
}

// ─── VOUCHERS ─────────────────────────────────────────────────────────────────

export async function createVouchers({ packageId, credits = 0, count = 1, expiresAt = null }) {
  const supabase = getSupabase();
  const qty = Math.max(1, Math.min(100, Number(count) || 1));
  const vouchers = [];

  for (let i = 0; i < qty; i++) {
    const raw = randomCode("NETFLIX");
    vouchers.push({
      code_hash: hashCode(raw),
      raw_code: raw,
      package_id: packageId || null,
      credits: Number(credits) || 0,
      expires_at: expiresAt || null
    });
  }

  const { data, error } = await supabase
    .from("vouchers")
    .insert(vouchers)
    .select();

  if (error) {
    if (isTableMissingError(error)) {
      throw new Error("Tabel 'vouchers' belum dibuat di Supabase. Silakan jalankan query supabase.sql terlebih dahulu di Supabase SQL Editor.");
    }
    throw error;
  }
  return data || [];
}

export async function generateCustomVouchers(count, { packageName, durationDays, durationHours, lifetime, dailyLimit }) {
  const supabase = getSupabase();
  const qty = Math.max(1, Math.min(100, Number(count) || 1));
  const vouchers = [];

  for (let i = 0; i < qty; i++) {
    const raw = randomCode("NETFLIX");
    vouchers.push({
      code_hash: hashCode(raw),
      raw_code: raw,
      package_id: null,
      custom_package_name: String(packageName || "Custom Voucher").slice(0, 100),
      custom_duration_days: durationDays ? Number(durationDays) : 0,
      custom_duration_hours: durationHours ? Number(durationHours) : 0,
      custom_lifetime: Boolean(lifetime),
      custom_daily_limit: Math.max(1, Number(dailyLimit) || 5),
      credits: 0
    });
  }

  const { data, error } = await supabase
    .from("vouchers")
    .insert(vouchers)
    .select();

  if (error) {
    if (isTableMissingError(error)) {
      throw new Error("Tabel 'vouchers' belum dibuat di Supabase. Silakan jalankan query supabase.sql terlebih dahulu di Supabase SQL Editor.");
    }
    throw error;
  }
  return data || [];
}

export async function redeemVoucher(userId, rawCode) {
  const cleanCode = normalizeCode(rawCode);
  if (!cleanCode) {
    return { ok: false, message: "Kode voucher tidak boleh kosong." };
  }

  const hash = hashCode(cleanCode);
  const supabase = getSupabase();

  const { data: voucher, error: vErr } = await supabase
    .from("vouchers")
    .select("*, package:packages(*)")
    .eq("code_hash", hash)
    .maybeSingle();

  if (vErr) {
    if (isTableMissingError(vErr)) {
      return { ok: false, message: "Tabel 'vouchers' belum dibuat di Supabase. Silakan jalankan query supabase.sql di Supabase SQL Editor." };
    }
    return { ok: false, message: "Kode voucher tidak ditemukan atau salah." };
  }

  if (!voucher) {
    return { ok: false, message: "Kode voucher tidak ditemukan atau salah." };
  }

  if (voucher.is_redeemed) {
    return { ok: false, message: "Kode voucher ini sudah pernah digunakan sebelumnya." };
  }

  if (voucher.expires_at && new Date(voucher.expires_at).getTime() < Date.now()) {
    return { ok: false, message: "Kode voucher ini sudah kedaluwarsa." };
  }

  const user = await getUser(userId);
  if (!user) {
    return { ok: false, message: "User Telegram belum terdaftar di sistem. Ketik /start dahulu." };
  }

  const now = new Date();
  let updateFields = { updated_at: now.toISOString() };
  let resultSummary = "";

  if (voucher.package) {
    const pkg = voucher.package;
    const isLifetime = Boolean(pkg.lifetime);
    let newExpiresAt = null;

    if (isLifetime) {
      updateFields.warranty_lifetime = true;
      updateFields.warranty_expires_at = null;
    } else {
      const durationDays = Number(pkg.duration_days || 0);
      const durationHours = Number(pkg.duration_hours || 0);
      const addMs = (durationDays * 24 * 3600 * 1000) + (durationHours * 3600 * 1000);

      const currentExpiry = user.warranty_expires_at ? new Date(user.warranty_expires_at) : null;
      const baseTime = (currentExpiry && currentExpiry.getTime() > now.getTime())
        ? currentExpiry.getTime()
        : now.getTime();

      newExpiresAt = new Date(baseTime + addMs);
      updateFields.warranty_expires_at = newExpiresAt.toISOString();
      updateFields.warranty_lifetime = false;
    }

    updateFields.warranty_package_id = pkg.id;
    updateFields.warranty_package_name = pkg.name;
    updateFields.warranty_daily_limit = Math.max(1, Number(pkg.daily_limit || 5));

    resultSummary = `Paket <b>${pkg.name}</b> berhasil diaktifkan!` +
      (isLifetime ? " (Masa aktif: Selamanya)" : ` (Aktif s/d: ${newExpiresAt.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" })})`);
  } else if (voucher.custom_package_name || voucher.custom_duration_days || voucher.custom_lifetime) {
    // Custom voucher handling
    const isLifetime = Boolean(voucher.custom_lifetime);
    let newExpiresAt = null;

    if (isLifetime) {
      updateFields.warranty_lifetime = true;
      updateFields.warranty_expires_at = null;
    } else {
      const days = Number(voucher.custom_duration_days || 0);
      const hours = Number(voucher.custom_duration_hours || 0);
      const addMs = (days * 24 * 3600 * 1000) + (hours * 3600 * 1000);

      const currentExpiry = user.warranty_expires_at ? new Date(user.warranty_expires_at) : null;
      const baseTime = (currentExpiry && currentExpiry.getTime() > now.getTime())
        ? currentExpiry.getTime()
        : now.getTime();

      newExpiresAt = new Date(baseTime + addMs);
      updateFields.warranty_expires_at = newExpiresAt.toISOString();
      updateFields.warranty_lifetime = false;
    }

    const pkgName = voucher.custom_package_name || (isLifetime ? "Lifetime" : `${voucher.custom_duration_days} Hari`);
    updateFields.warranty_package_id = "custom";
    updateFields.warranty_package_name = pkgName;
    updateFields.warranty_daily_limit = Math.max(1, Number(voucher.custom_daily_limit || 5));

    resultSummary = `Voucher <b>${pkgName}</b> berhasil diaktifkan!` +
      (isLifetime ? " (Masa aktif: Selamanya)" : ` (Aktif s/d: ${newExpiresAt.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" })})`);
  } else if (voucher.credits > 0) {
    const currentCredits = Number(user.credits || 0);
    const newCredits = currentCredits + Number(voucher.credits);
    updateFields.credits = newCredits;
    resultSummary = `Saldo sebesar <b>${voucher.credits}</b> berhasil ditambahkan ke akun Anda!`;
  } else {
    return { ok: false, message: "Voucher tidak memiliki paket atau saldo yang valid." };
  }

  // Update user
  const { error: uErr } = await supabase
    .from("gemini_checker_users")
    .update(updateFields)
    .eq("telegram_user_id", userId);

  if (uErr) {
    throw new Error(`Gagal memperbarui garansi user: ${uErr.message}`);
  }

  // Mark voucher redeemed
  await supabase
    .from("vouchers")
    .update({
      is_redeemed: true,
      redeemed_by: userId,
      redeemed_at: now.toISOString()
    })
    .eq("id", voucher.id);

  return {
    ok: true,
    message: resultSummary,
    voucher
  };
}

export async function listVouchers({ limit = 20, redeemed = null } = {}) {
  try {
    const supabase = getSupabase();
    let query = supabase
      .from("vouchers")
      .select("*, package:packages(*)")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (redeemed !== null) {
      query = query.eq("is_redeemed", Boolean(redeemed));
    }

    const { data, error } = await query;
    if (error) {
      if (isTableMissingError(error)) return [];
      throw error;
    }
    return data || [];
  } catch (err) {
    if (isTableMissingError(err)) return [];
    throw err;
  }
}

// ─── BOT SETTINGS ─────────────────────────────────────────────────────────────

export async function getSetting(key, defaultValue = null) {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("bot_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (!error && data !== null && data !== undefined) {
      memorySettings.set(key, data.value);
      return data.value ?? defaultValue;
    }
  } catch (err) {
    if (!isTableMissingError(err)) {
      console.warn(`[store] getSetting(${key}) warning:`, err.message);
    }
  }

  if (memorySettings.has(key)) {
    return memorySettings.get(key);
  }
  if (defaultSettings[key] !== undefined) {
    return defaultSettings[key];
  }
  return defaultValue;
}

export async function setSetting(key, value) {
  memorySettings.set(key, value);

  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("bot_settings")
      .upsert({
        key,
        value,
        updated_at: new Date().toISOString()
      }, { onConflict: "key" });

    if (error) {
      if (isTableMissingError(error)) {
        console.warn(`[store] Tabel 'public.bot_settings' belum ada di Supabase. Menggunakan in-memory untuk key '${key}'. Jalankan supabase.sql.`);
        return;
      }
      console.warn(`[store] setSetting error for key '${key}':`, error.message);
    }
  } catch (err) {
    if (isTableMissingError(err)) {
      console.warn(`[store] Tabel 'public.bot_settings' belum ada. Fallback in-memory aktif.`);
      return;
    }
    console.warn(`[store] setSetting exception for key '${key}':`, err.message);
  }
}

export async function getAllSettings() {
  const settings = { ...defaultSettings };
  for (const [k, v] of memorySettings.entries()) {
    settings[k] = v;
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("bot_settings")
      .select("*");

    if (!error && Array.isArray(data)) {
      for (const item of data) {
        settings[item.key] = item.value;
        memorySettings.set(item.key, item.value);
      }
    }
  } catch {}

  return settings;
}

// ─── WORKFLOW PHOTOS (ROTATOR) ────────────────────────────────────────────────

export async function getWorkflowPhotos() {
  const photos = await getSetting("workflow_photos", []);
  return Array.isArray(photos) ? photos : [];
}

export async function addWorkflowPhoto(photoRef) {
  const photos = await getWorkflowPhotos();
  photos.push(photoRef);
  await setSetting("workflow_photos", photos);
  return photos.length;
}

export async function removeWorkflowPhoto(index) {
  const photos = await getWorkflowPhotos();
  if (index < 0 || index >= photos.length) return false;
  photos.splice(index, 1);
  await setSetting("workflow_photos", photos);
  return true;
}

// ─── BRIDGE ACCOUNTS ──────────────────────────────────────────────────────────

export async function getBridgeAccounts() {
  const accounts = await getSetting("bridge_accounts", []);
  return Array.isArray(accounts) ? accounts : [];
}

export async function addBridgeAccount({ id, phone, sessionString, label = "", username = "", firstName = "" }) {
  const accounts = await getBridgeAccounts();
  const safeId = id || `bridge-${Date.now().toString(36)}`;
  accounts.push({
    id: safeId,
    phone,
    sessionString,
    label: label || phone,
    username,
    firstName,
    enabled: true,
    cooldownUntil: 0,
    createdAt: new Date().toISOString()
  });
  await setSetting("bridge_accounts", accounts);
  return safeId;
}

export async function deleteBridgeAccount(id) {
  const accounts = await getBridgeAccounts();
  const filtered = accounts.filter((acc) => String(acc.id) !== String(id));
  await setSetting("bridge_accounts", filtered);
  return true;
}

// ─── ADMIN WIZARD STATE (Persisted in Supabase & Fallback In-Memory) ───────────

export async function getAdminWizard(userId) {
  return await getSetting(`wizard_${userId}`, null);
}

export async function setAdminWizard(userId, wizardState) {
  return await setSetting(`wizard_${userId}`, wizardState);
}

export async function clearAdminWizard(userId) {
  memorySettings.delete(`wizard_${userId}`);
  try {
    const supabase = getSupabase();
    await supabase.from("bot_settings").delete().eq("key", `wizard_${userId}`);
  } catch {}
}

// ─── TARGET BOTS (Separated: Login Link Bots vs Cookie Generator Bots) ──────────

export async function getTargetBots(filterType = "all") {
  const list = await getSetting("target_bots", null);
  let bots = [];
  if (Array.isArray(list) && list.length > 0) {
    bots = [...list];
  } else {
    // Initialize with both login bot and cookie bot
    const legacyLogin = String(await getSetting("target_bot_login", await getSetting("target_bot", "SSNetflixBot"))).replace(/^@/, "").trim();
    const legacyCookie = String(await getSetting("target_bot_cookie", "cookiesnetflixskystorebot")).replace(/^@/, "").trim();
    bots = [
      {
        id: "target-login-1",
        username: legacyLogin,
        label: `@${legacyLogin} (Ambil Link Login)`,
        type: "login",
        enabled: true,
        priority: 1,
        createdAt: new Date().toISOString()
      },
      {
        id: "target-cookie-1",
        username: legacyCookie,
        label: `@${legacyCookie} (Generate Cookies)`,
        type: "cookie",
        enabled: true,
        priority: 1,
        createdAt: new Date().toISOString()
      }
    ];
    await setSetting("target_bots", bots);
  }

  // Ensure each bot has a normalized type ('login' or 'cookie')
  const normalized = bots.map((b) => ({
    ...b,
    type: b.type || (/cookie/i.test(b.username) ? "cookie" : "login")
  }));

  if (filterType === "login") {
    return normalized
      .filter((b) => b.type === "login")
      .sort((a, b) => (Number(a.priority) || 1) - (Number(b.priority) || 1));
  }
  if (filterType === "cookie") {
    return normalized
      .filter((b) => b.type === "cookie")
      .sort((a, b) => (Number(a.priority) || 1) - (Number(b.priority) || 1));
  }
  return normalized.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "login" ? -1 : 1;
    }
    return (Number(a.priority) || 1) - (Number(b.priority) || 1);
  });
}

export async function getActiveTargetBots(filterType = "login") {
  const bots = await getTargetBots(filterType);
  const enabled = bots.filter((b) => b.enabled !== false);
  if (enabled.length > 0) return enabled;
  if (bots.length > 0) return bots.slice(0, 1);

  if (filterType === "cookie") {
    const fallbackCookie = String(await getSetting("target_bot_cookie", "cookiesnetflixskystorebot")).replace(/^@/, "").trim();
    return [{ id: "fallback-cookie", username: fallbackCookie, label: `@${fallbackCookie}`, type: "cookie", enabled: true, priority: 1 }];
  }
  const fallbackLogin = String(await getSetting("target_bot_login", await getSetting("target_bot", "SSNetflixBot"))).replace(/^@/, "").trim();
  return [{ id: "fallback-login", username: fallbackLogin, label: `@${fallbackLogin}`, type: "login", enabled: true, priority: 1 }];
}

export async function getTargetBot(idOrUsername) {
  const bots = await getTargetBots("all");
  const search = String(idOrUsername || "").replace(/^@/, "").toLowerCase().trim();
  return (
    bots.find(
      (b) => String(b.id).toLowerCase() === search || b.username.toLowerCase() === search
    ) || null
  );
}

export async function addTargetBot({ username, label = "", enabled = true, priority = null, type = "login" }) {
  const clean = String(username || "").replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{4,32}$/.test(clean)) {
    throw new Error("Username bot tidak valid. Gunakan 4-32 karakter alfanumerik atau garis bawah.");
  }

  const cleanType = String(type || "").toLowerCase() === "cookie" ? "cookie" : "login";
  const bots = await getTargetBots("all");
  if (bots.some((b) => b.username.toLowerCase() === clean.toLowerCase())) {
    throw new Error(`Bot target @${clean} sudah terdaftar.`);
  }

  const sameTypeBots = bots.filter((b) => b.type === cleanType);
  const nextPriority = priority !== null ? Number(priority) : sameTypeBots.length + 1;

  const newBot = {
    id: `target-${cleanType}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    username: clean,
    label: label || `@${clean} (${cleanType === "cookie" ? "Generate Cookies" : "Ambil Link Login"})`,
    type: cleanType,
    enabled: Boolean(enabled),
    priority: nextPriority,
    createdAt: new Date().toISOString()
  };

  bots.push(newBot);
  await setSetting("target_bots", bots);

  if (cleanType === "login") {
    const firstLogin = bots.filter((b) => b.type === "login").sort((a, b) => a.priority - b.priority)[0];
    if (firstLogin?.username) {
      await setSetting("target_bot", firstLogin.username);
      await setSetting("target_bot_login", firstLogin.username);
    }
  } else {
    const firstCookie = bots.filter((b) => b.type === "cookie").sort((a, b) => a.priority - b.priority)[0];
    if (firstCookie?.username) {
      await setSetting("target_bot_cookie", firstCookie.username);
    }
  }

  return newBot;
}

export async function updateTargetBot(idOrUsername, patch = {}) {
  const bots = await getTargetBots("all");
  const search = String(idOrUsername || "").replace(/^@/, "").toLowerCase().trim();
  const idx = bots.findIndex(
    (b) => String(b.id).toLowerCase() === search || b.username.toLowerCase() === search
  );
  if (idx === -1) return null;

  bots[idx] = { ...bots[idx], ...patch };
  await setSetting("target_bots", bots);

  const updatedType = bots[idx].type || "login";
  if (updatedType === "login") {
    const firstLogin = bots.filter((b) => b.type === "login").sort((a, b) => a.priority - b.priority)[0];
    if (firstLogin?.username) {
      await setSetting("target_bot", firstLogin.username);
      await setSetting("target_bot_login", firstLogin.username);
    }
  } else {
    const firstCookie = bots.filter((b) => b.type === "cookie").sort((a, b) => a.priority - b.priority)[0];
    if (firstCookie?.username) {
      await setSetting("target_bot_cookie", firstCookie.username);
    }
  }

  return bots[idx];
}

export async function setPrimaryTargetBot(idOrUsername) {
  const bots = await getTargetBots("all");
  const search = String(idOrUsername || "").replace(/^@/, "").toLowerCase().trim();
  const target = bots.find(
    (b) => String(b.id).toLowerCase() === search || b.username.toLowerCase() === search
  );
  if (!target) return false;

  target.priority = 1;
  target.enabled = true;

  let currentPriority = 2;
  for (const b of bots) {
    if (b.type === target.type && b.id !== target.id) {
      b.priority = currentPriority++;
    }
  }

  await setSetting("target_bots", bots);
  if (target.type === "login") {
    await setSetting("target_bot", target.username);
    await setSetting("target_bot_login", target.username);
  } else {
    await setSetting("target_bot_cookie", target.username);
  }
  return true;
}

export async function deleteTargetBot(idOrUsername) {
  const bots = await getTargetBots("all");
  const search = String(idOrUsername || "").replace(/^@/, "").toLowerCase().trim();
  const target = bots.find(
    (b) => String(b.id).toLowerCase() === search || b.username.toLowerCase() === search
  );
  if (!target) return false;

  const targetType = target.type;
  const filtered = bots.filter(
    (b) => String(b.id).toLowerCase() !== search && b.username.toLowerCase() !== search
  );

  const sameTypeBots = filtered.filter((b) => b.type === targetType).sort((a, b) => a.priority - b.priority);
  sameTypeBots.forEach((b, i) => {
    b.priority = i + 1;
  });

  await setSetting("target_bots", filtered);
  if (targetType === "login") {
    const firstLogin = sameTypeBots[0];
    if (firstLogin?.username) {
      await setSetting("target_bot", firstLogin.username);
      await setSetting("target_bot_login", firstLogin.username);
    }
  } else {
    const firstCookie = sameTypeBots[0];
    if (firstCookie?.username) {
      await setSetting("target_bot_cookie", firstCookie.username);
    }
  }

  await deleteRecordedWorkflow(search);
  return true;
}

// ─── RECORDED BRIDGE WORKFLOW ─────────────────────────────────────────────────

export async function getRecordedWorkflow(targetBot = null) {
  const workflows = (await getSetting("bridge_workflows", {})) || {};
  const legacy = await getSetting("bridge_workflow_steps", null);

  if (targetBot) {
    const botKey = String(targetBot).replace(/^@/, "").toLowerCase().trim();
    if (workflows[botKey]) return workflows[botKey];
    if (legacy && String(legacy.targetBot || "").toLowerCase().trim() === botKey) {
      return legacy;
    }
    return null;
  }

  const primaryBot = String(await getSetting("target_bot", "SSNetflixBot")).replace(/^@/, "").toLowerCase().trim();
  if (workflows[primaryBot]) return workflows[primaryBot];
  if (legacy) return legacy;

  return null;
}

export async function saveRecordedWorkflow(workflow, targetBot = null) {
  const botName = targetBot || workflow.targetBot || (await getSetting("target_bot", "SSNetflixBot"));
  const cleanName = String(botName).replace(/^@/, "").trim();
  const botKey = cleanName.toLowerCase();

  const workflows = (await getSetting("bridge_workflows", {})) || {};
  workflows[botKey] = {
    ...workflow,
    targetBot: cleanName
  };
  await setSetting("bridge_workflows", workflows);
  await setSetting("bridge_workflow_steps", workflows[botKey]);
  return true;
}

export async function deleteRecordedWorkflow(targetBot = null) {
  const workflows = (await getSetting("bridge_workflows", {})) || {};
  const legacy = await getSetting("bridge_workflow_steps", null);

  const botKey = targetBot
    ? String(targetBot).replace(/^@/, "").toLowerCase().trim()
    : String(legacy?.targetBot || (await getSetting("target_bot", "SSNetflixBot"))).replace(/^@/, "").toLowerCase().trim();

  if (workflows && workflows[botKey]) {
    delete workflows[botKey];
    await setSetting("bridge_workflows", workflows);
  }

  if (!targetBot || (legacy && String(legacy.targetBot || "").toLowerCase().trim() === botKey)) {
    await setSetting("bridge_workflow_steps", null);
  }
  return true;
}

export async function getAllRecordedWorkflows() {
  const workflows = (await getSetting("bridge_workflows", {})) || {};
  const legacy = await getSetting("bridge_workflow_steps", null);
  if (legacy?.targetBot) {
    const legKey = String(legacy.targetBot).replace(/^@/, "").toLowerCase().trim();
    if (!workflows[legKey]) {
      workflows[legKey] = legacy;
    }
  }
  return workflows;
}

export async function grantUserWarranty(userId, { packageId, durationDays = 30, lifetime = false, dailyLimit = 5 }) {
  const supabase = getSupabase();
  const user = await getUser(userId);
  if (!user) throw new Error("User tidak ditemukan.");

  const now = new Date();
  let expiresAt = null;

  if (!lifetime) {
    const currentExpiry = user.warranty_expires_at ? new Date(user.warranty_expires_at) : null;
    const baseTime = (currentExpiry && currentExpiry.getTime() > now.getTime())
      ? currentExpiry.getTime()
      : now.getTime();
    expiresAt = new Date(baseTime + (durationDays * 24 * 3600 * 1000));
  }

  const { data, error } = await supabase
    .from("gemini_checker_users")
    .update({
      warranty_package_id: packageId || (lifetime ? "lifetime" : "custom"),
      warranty_package_name: lifetime ? "Lifetime" : `${durationDays} Hari`,
      warranty_expires_at: expiresAt ? expiresAt.toISOString() : null,
      warranty_lifetime: Boolean(lifetime),
      warranty_daily_limit: Math.max(1, dailyLimit),
      updated_at: now.toISOString()
    })
    .eq("telegram_user_id", userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

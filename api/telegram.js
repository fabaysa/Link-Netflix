import { waitUntil } from "@vercel/functions";
import { getSupabase } from "../lib/supabase.js";
import { sendMessage, sendPlainMessage, editMessage, botApi } from "../lib/telegram-bot.js";
import { maxRelayChars, normalizeRelayText } from "../lib/input.js";
import { enqueueJob } from "../lib/queue.js";
import { kickBridgeWorker } from "../lib/kick-worker.js";
import {
  upsertUser,
  checkUserWarranty,
  getPackages,
  getPackage,
  addPackage,
  updatePackage,
  deletePackage,
  createVouchers,
  generateCustomVouchers,
  redeemVoucher,
  listVouchers,
  getStats,
  getSetting,
  setSetting,
  getAllSettings,
  getWorkflowPhotos,
  addWorkflowPhoto,
  removeWorkflowPhoto,
  getBridgeAccounts,
  addBridgeAccount,
  deleteBridgeAccount,
  getAdminWizard,
  setAdminWizard,
  clearAdminWizard,
  grantUserWarranty,
  getAllUserIds,
  getUserByIdOrUsername,
  listVipUsers,
  activateUserVip,
  revokeUserVip,
  extendUserVip,
  getRecordedWorkflow,
  deleteRecordedWorkflow,
  getAllRecordedWorkflows,
  getTargetBots,
  getActiveTargetBots,
  getTargetBot,
  addTargetBot,
  updateTargetBot,
  setPrimaryTargetBot,
  deleteTargetBot,
  getUserLastAccountCookies
} from "../lib/store.js";
import {
  startTelegramLogin,
  submitTelegramCode,
  submitTelegram2FA
} from "../lib/telegram-login-helper.js";
import {
  startWorkflowRecording,
  sendWorkflowRecordingText,
  clickWorkflowRecordingButton,
  finishWorkflowRecording,
  cancelWorkflowRecording,
  renderFlowSnapshot
} from "../lib/workflow-recorder.js";

import {
  COUNTRY_NAMES
} from "../lib/country-button-finder.js";

const BOT_NAME = "iLink Netflix Bot";
const BOT_VERSION = "5.3";

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function isAdmin(userId) {
  const ownerId = String(process.env.OWNER_TELEGRAM_ID || "").trim();
  const adminIds = String(process.env.ADMIN_IDS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const uid = String(userId);
  return uid === ownerId || adminIds.includes(uid);
}

function fmtDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function fmtDateTime(d) {
  if (!d) return "-";
  return new Date(d).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function fmtRupiah(amount) {
  return `Rp ${Number(amount || 0).toLocaleString("id-ID")}`;
}

function fmtDuration(durationDays, lifetime, durationHours = null) {
  if (lifetime) return "Selamanya ♾️";
  if (durationHours && Number(durationHours) > 0) {
    const hrs = Number(durationHours);
    if (hrs < 24) return `${hrs} Jam`;
    const days = Math.floor(hrs / 24);
    const rem = hrs % 24;
    return rem > 0 ? `${days} Hari ${rem} Jam` : `${days} Hari`;
  }
  if (!durationDays) return "-";
  if (durationDays === 1) return "1 Hari";
  if (durationDays < 30) return `${durationDays} Hari`;
  const months = Math.round(durationDays / 30);
  return `${months} Bulan`;
}

// ─── ADMIN DASHBOARD & SUBMENUS (SAMA PERSIS DENGAN ILINK BOT) ──────────────────

async function renderAdminDashboard(chatId, messageId = null) {
  const stats = await getStats();
  const loginBot = await getSetting("target_bot_login", await getSetting("target_bot", "SSNetflixBot"));
  const cookieBot = await getSetting("target_bot_cookie", "cookiesnetflixskystorebot");
  const loginBots = await getTargetBots("login");
  const cookieBots = await getTargetBots("cookie");
  const countryPriority = await getSetting("country_priority", ["ID", "MY", "SG"]);
  const photos = await getWorkflowPhotos();
  const bridgeAccounts = await getBridgeAccounts();
  const reqWarranty = await getSetting("require_warranty", true);

  const countriesStr = countryPriority
    .map((c) => COUNTRY_NAMES[c] || c)
    .join(" → ");

  const text = [
    `👑 <b>Admin Panel — ${BOT_NAME} v${BOT_VERSION}</b>`,
    "",
    "📊 <b>Statistik:</b>",
    `• Users: <b>${stats.users}</b>`,
    `• Garansi aktif: <b>${stats.activeWarranties}</b>`,
    `• Total hasil terkirim: <b>${stats.totalUrlsFetched}</b>`,
    "",
    `🎬 <b>Bot Ambil Link:</b> @${esc(loginBot)} (${loginBots.filter((b) => b.enabled).length}/${loginBots.length} aktif)`,
    `🍪 <b>Bot Generate Cookies:</b> @${esc(cookieBot)} (${cookieBots.filter((b) => b.enabled).length}/${cookieBots.length} aktif)`,
    `🌉 <b>Akun Bridge:</b> ${bridgeAccounts.filter((a) => a.enabled !== false).length}/${bridgeAccounts.length} akun siap`,
    `🌏 <b>Prioritas negara:</b> ${countriesStr}`,
    `📸 <b>Foto Working:</b> ${photos.length} foto`,
    `🛡️ <b>Wajib Garansi / Lisensi:</b> ${reqWarranty ? "✅ Aktif (Wajib)" : "❌ Nonaktif (Bebas)"}`,
    "",
    "Silakan pilih menu di bawah:"
  ].join("\n");

  const replyMarkup = {
    inline_keyboard: [
      [{ text: "🌉 Telegram Bridge", callback_data: "admin_bridge" }],
      [{ text: "🌏 Negara & Foto Working", callback_data: "admin_workflow" }],
      [
        { text: "👑 Daftar User VIP", callback_data: "admin_vip_users:1:all" },
        { text: "⚡ Aktifkan VIP", callback_data: "admin_vip_act_start" }
      ],
      [{ text: "📦 Kelola Paket", callback_data: "admin_packages" }],
      [
        { text: "🎟️ Generate Voucher", callback_data: "admin_gen_voucher" },
        { text: "📊 Stats Lengkap", callback_data: "admin_stats" }
      ],
      [
        { text: "📢 Broadcast", callback_data: "admin_broadcast" },
        { text: "⚙️ Pengaturan", callback_data: "admin_settings" }
      ]
    ]
  };

  if (messageId) {
    try {
      await editMessage(chatId, messageId, text, { reply_markup: replyMarkup });
      return;
    } catch {}
  }
  await sendMessage(chatId, text, { reply_markup: replyMarkup });
}

async function renderBridgeMenu(chatId, messageId = null) {
  const accounts = await getBridgeAccounts();
  const loginBots = await getTargetBots("login");
  const cookieBots = await getTargetBots("cookie");
  const allWorkflows = await getAllRecordedWorkflows();

  const formatBotLines = (bots) => {
    if (!bots.length) return "   <i>(Belum ada bot terdaftar)</i>";
    return bots
      .map((b, i) => {
        const wf = allWorkflows[b.username.toLowerCase()];
        const wfTag = wf?.steps?.length ? `🎬 ${wf.steps.length} langkah` : "⚡ default";
        const star = b.priority === 1 ? "⭐ " : "";
        const status = b.enabled ? "✅" : "❌";
        return `   ${i + 1}. ${star}<b>@${esc(b.username)}</b> [${status} | ${wfTag}]`;
      })
      .join("\n");
  };

  const accountLines = accounts.length
    ? accounts
        .map(
          (acc, i) =>
            `${i + 1}. <b>${esc(acc.label || acc.phone)}</b> — ${acc.enabled ? "✅ siap" : "❌ nonaktif"}`
        )
        .join("\n")
    : "Belum ada akun bridge.";

  const text = [
    `🌉 <b>Telegram Bridge v${BOT_VERSION}</b>`,
    "",
    "<b>1️⃣ 🎬 Bot Ambil Link Login (Netflix Generator):</b>",
    formatBotLines(loginBots),
    "<i>Khusus fitur ambil akun / link login Netflix (PC/HP/TV).</i>",
    "",
    "<b>2️⃣ 🍪 Bot Generate Cookies (Cookie Relay):</b>",
    formatBotLines(cookieBots),
    "<i>Khusus fitur convert cookies yang dikirim user menjadi link.</i>",
    "",
    "━━━━━━━━━━━━━━━━━━",
    `📱 <b>Akun Bridge:</b> <b>${accounts.filter((a) => a.enabled !== false).length}/${accounts.length} siap</b>`,
    accountLines,
    "",
    "💡 <i>Kedua fungsi bot target dipisahkan secara rapi dan mandiri.</i>"
  ].join("\n");

  const keyboard = [
    [
      { text: "🎬 Kelola Bot Ambil Link", callback_data: "admin_bots:login" },
      { text: "🍪 Kelola Bot Cookies", callback_data: "admin_bots:cookie" }
    ],
    [
      { text: "🌏 Prioritas Negara", callback_data: "admin_country_priority" },
      { text: "🎥 Rekam Alur", callback_data: "bridge_record_start" }
    ],
    [
      { text: "➕ Tambah Akun Bridge", callback_data: "bridge_add_account" },
      { text: "🗑️ Hapus Akun Bridge", callback_data: "bridge_del_account" }
    ],
    [
      { text: "🔄 Refresh Status", callback_data: "admin_bridge" },
      { text: "🔙 Kembali", callback_data: "admin_back" }
    ]
  ];

  if (messageId) {
    try {
      await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      return;
    } catch {}
  }
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function renderTargetBotsMenu(chatId, messageId = null, botType = "login") {
  const isLogin = botType === "login";
  const targetBots = await getTargetBots(botType);
  const allWorkflows = await getAllRecordedWorkflows();

  const title = isLogin ? "🎬 Bot Ambil Link Login" : "🍪 Bot Generate Cookies";
  const desc = isLogin
    ? "Bot tujuan untuk <b>mengambil akun / link login Netflix</b> (PC/HP/TV) via alur tombol dan pencarian prioritas negara."
    : "Bot tujuan untuk <b>mengubah raw cookies Netflix</b> yang dikirim pengguna menjadi link token login.";

  const botList = targetBots.map((b, i) => {
    const wf = allWorkflows[b.username.toLowerCase()];
    const wfStatus = wf?.steps?.length ? `✅ Terekam (${wf.steps.length} langkah)` : "⚠️ Default";
    const status = b.enabled ? "✅ Aktif" : "❌ Nonaktif";
    const star = b.priority === 1 ? "⭐ (Utama)" : `#${b.priority}`;
    return `<b>${i + 1}. @${esc(b.username)}</b> ${star}\n   • Status: ${status}\n   • Alur: ${wfStatus}`;
  }).join("\n\n");

  const text = [
    `🤖 <b>Kelola ${title}</b>`,
    "",
    desc,
    "",
    botList || `<i>Belum ada bot ${title.toLowerCase()} terdaftar.</i>`,
    "",
    "Pilih bot di bawah untuk detail/atur atau tambah bot baru:"
  ].join("\n");

  const keyboard = [];
  keyboard.push([
    { text: `➕ Tambah ${isLogin ? "Bot Ambil Link" : "Bot Cookies"} Baru`, callback_data: `bot_add_start:${botType}` }
  ]);

  for (const b of targetBots) {
    const star = b.priority === 1 ? "⭐ " : "";
    const status = b.enabled ? "🟢" : "🔴";
    keyboard.push([
      {
        text: `${status} ${star}@${b.username} (#${b.priority})`,
        callback_data: `bot_detail:${b.id}`
      }
    ]);
  }

  keyboard.push([
    {
      text: isLogin ? "🍪 Beralih ke Bot Generate Cookies" : "🎬 Beralih ke Bot Ambil Link",
      callback_data: isLogin ? "admin_bots:cookie" : "admin_bots:login"
    }
  ]);

  keyboard.push([{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]);

  if (messageId) {
    try {
      await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      return;
    } catch {}
  }
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function renderCountryPriorityMenu(chatId, messageId = null) {
  const current = await getSetting("country_priority", ["ID", "MY", "SG"]);
  const listStr = current
    .map((code, idx) => `  <b>${idx + 1}.</b> ${COUNTRY_NAMES[code] || code} (<code>${code}</code>)`)
    .join("\n");

  const text = [
    "🌏 <b>Pengaturan Urutan Prioritas Negara</b>",
    "",
    "<b>Urutan Prioritas Saat Ini:</b>",
    listStr,
    "",
    "━━━━━━━━━━━━━━━━━━",
    "<b>Sistem Smart Fallback Netflix:</b>",
    "1️⃣ Bot selalu mencari <b>Prioritas 1</b> terlebih dahulu di semua halaman bot target.",
    "2️⃣ Jika stok Prioritas 1 habis (0) atau tidak ditemukan, bot otomatis berpindah ke <b>Prioritas 2</b>.",
    "3️⃣ Jika Prioritas 2 juga habis, otomatis lanjut ke <b>Prioritas 3</b>, dan seterusnya.",
    "━━━━━━━━━━━━━━━━━━",
    "",
    "Pilih preset cepat di bawah atau gunakan tombol <b>✏️ Ketik Manual</b>:"
  ].join("\n");

  const keyboard = [
    [
      { text: "🇮🇩 ID ➔ 🇲🇾 MY ➔ 🇸🇬 SG", callback_data: "preset_country:ID,MY,SG" },
      { text: "🇲🇾 MY ➔ 🇮🇩 ID ➔ 🇸🇬 SG", callback_data: "preset_country:MY,ID,SG" }
    ],
    [
      { text: "🇸🇬 SG ➔ 🇮🇩 ID ➔ 🇲🇾 MY", callback_data: "preset_country:SG,ID,MY" },
      { text: "🌏 ID ➔ MY ➔ SG ➔ TH", callback_data: "preset_country:ID,MY,SG,TH" }
    ],
    [
      { text: "✏️ Ketik Manual (Kustom)", callback_data: "input_country_priority" }
    ],
    [
      { text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }
    ]
  ];

  if (messageId) {
    try {
      await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      return;
    } catch {}
  }
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function renderTargetBotDetail(chatId, messageId, botId) {
  const bot = await getTargetBot(botId);
  if (!bot) {
    await editMessage(chatId, messageId, "❌ Bot target tidak ditemukan.", {
      reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: "admin_bridge" }]] }
    });
    return;
  }

  const workflow = await getRecordedWorkflow(bot.username);
  const wfStatus = workflow?.steps?.length
    ? `✅ Terekam (${workflow.steps.length} langkah) · Direkam: ${fmtDateTime(workflow.recordedAt)}`
    : "⚠️ Menggunakan alur bawaan default";

  const isCookie = bot.type === "cookie";
  const typeLabel = isCookie ? "🍪 Generate Cookies (Cookie Relay)" : "🎬 Ambil Link Login (Netflix Generator)";

  const text = [
    `🤖 <b>Detail Bot Target — @${esc(bot.username)}</b>`,
    "",
    `• Fungsi: <b>${typeLabel}</b>`,
    `• Username: <b>@${esc(bot.username)}</b>`,
    `• Status: <b>${bot.enabled ? "✅ Aktif" : "❌ Nonaktif"}</b>`,
    `• Prioritas Failover: <b>#${bot.priority} ${bot.priority === 1 ? "(⭐ Bot Utama)" : ""}</b>`,
    `• Profil Alur: <b>${wfStatus}</b>`,
    `• Ditambahkan: ${fmtDateTime(bot.createdAt)}`,
    "",
    "Pilih tindakan untuk bot ini:"
  ].join("\n");

  const keyboard = [
    [
      { text: "⭐ Jadikan Bot Utama", callback_data: `bot_set_primary:${bot.id}` },
      { text: bot.enabled ? "🔴 Nonaktifkan" : "🟢 Aktifkan", callback_data: `bot_toggle:${bot.id}` }
    ],
    [
      { text: "🎥 Rekam Alur Bot Ini", callback_data: `bot_rec_start:${bot.id}` },
      { text: "📋 Lihat Alur Bot Ini", callback_data: `bot_wf_view:${bot.id}` }
    ],
    [
      { text: "🗑️ Hapus Bot", callback_data: `bot_del:${bot.id}` },
      { text: "🔙 Kembali", callback_data: `admin_bots:${bot.type || "login"}` }
    ]
  ];

  if (messageId) {
    try {
      await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      return;
    } catch {}
  }
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function renderWorkflowMenu(chatId, messageId = null) {
  const countryPriority = await getSetting("country_priority", ["ID", "MY", "SG"]);
  const photos = await getWorkflowPhotos();

  const countriesStr = countryPriority
    .map((code, index) => `${index + 1}. ${COUNTRY_NAMES[code] || code} (${code})`)
    .join("\n");

  const text = [
    "🌏 <b>Negara & Foto Working</b>",
    "",
    "<b>Prioritas negara saat ini:</b>",
    countriesStr,
    "",
    "Atur urutan prioritas (1 ➔ 2 ➔ 3 dst) dengan tombol di bawah atau perintah:",
    "<code>/setnegara ID,MY,SG</code>",
    "",
    `📸 <b>Foto tersimpan:</b> <b>${photos.length}</b> (tiap hasil Working mengirim tepat satu foto bergiliran)`,
    "",
    "Tambahkan foto dengan tombol di bawah atau langsung kirim gambar di chat pribadi bot."
  ].join("\n");

  const keyboard = [
    [
      { text: "🌏 Atur Prioritas Negara", callback_data: "admin_country_priority" }
    ],
    [
      { text: "📸 Tambah Foto", callback_data: "workflow_add_photo" },
      { text: "🖼️ Daftar Foto", callback_data: "workflow_show_photos" }
    ],
    [{ text: "🔄 Muat Ulang", callback_data: "admin_workflow" }],
    [{ text: "🔙 Kembali", callback_data: "admin_back" }]
  ];

  if (messageId) {
    try {
      await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      return;
    } catch {}
  }
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function renderPackagesMenu(chatId, messageId = null) {
  const packages = await getPackages();

  const pkgList = packages.length > 0
    ? packages
        .map(
          (p, i) =>
            `${i + 1}. ${p.enabled ? "✅" : "❌"} <b>${esc(p.name)}</b>\n   💰 ${fmtRupiah(p.price)} | ⏳ ${fmtDuration(p.duration_days, p.lifetime, p.duration_hours)} | 🔄 ${p.daily_limit}x/hari`
        )
        .join("\n\n")
    : "⚠️ Belum ada paket.";

  const text = `📦 <b>Daftar Paket Garansi (${packages.length})</b>\n\n${pkgList}`;

  const keyboard = [
    [{ text: "➕ Tambah Paket", callback_data: "pkg_add" }],
    ...packages.map((p) => [
      { text: `✏️ ${p.name.slice(0, 20)}`, callback_data: `pkg_toggle:${p.id}` },
      { text: "🗑️ Hapus", callback_data: `pkg_del:${p.id}` }
    ]),
    [{ text: "🔙 Kembali", callback_data: "admin_back" }]
  ];

  if (messageId) {
    try {
      await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      return;
    } catch {}
  }
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
}

// ─── VIP USERS MANAGEMENT & DIRECT ACTIVATION ─────────────────────────────────

async function renderVipUsersMenu(chatId, messageId = null, page = 1, filter = "all", search = "") {
  const p = Math.max(1, Number(page) || 1);
  const data = await listVipUsers({ filter, page: p, limit: 6, search });
  const { users, total, totalPages } = data;

  let filterLabel = "Semua";
  if (filter === "active") filterLabel = "🟢 Aktif";
  if (filter === "lifetime") filterLabel = "♾️ Lifetime";
  if (filter === "expired") filterLabel = "🔴 Expired";

  let listContent = "";
  if (!users.length) {
    listContent = search
      ? `<i>Tidak ditemukan pengguna VIP dengan kata kunci "<b>${esc(search)}</b>".</i>`
      : `<i>Belum ada data pengguna VIP dalam kategori <b>${filterLabel}</b>.</i>`;
  } else {
    listContent = users.map((u, i) => {
      const num = (p - 1) * 6 + i + 1;
      const isLifetime = Boolean(u.warranty_lifetime);
      const expDate = u.warranty_expires_at ? new Date(u.warranty_expires_at) : null;
      const isExpired = !isLifetime && (!expDate || expDate.getTime() <= Date.now());

      let statusBadge = "🟢 Aktif";
      let expStr = "-";
      if (u.is_banned) {
        statusBadge = "⛔ Terblokir";
      } else if (isLifetime) {
        statusBadge = "♾️ Lifetime";
        expStr = "Selamanya";
      } else if (isExpired) {
        statusBadge = "🔴 Expired";
        expStr = expDate ? expDate.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" }) : "-";
      } else {
        statusBadge = "🟢 Aktif";
        expStr = expDate ? expDate.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" }) : "-";
      }

      const userTag = u.username ? `@${esc(u.username)}` : (u.first_name ? esc(u.first_name) : `ID: ${u.telegram_user_id}`);
      return `${num}. <b>${userTag}</b> (<code>${u.telegram_user_id}</code>)\n   🏷️ Status: <b>${statusBadge}</b> | 📦 ${esc(u.warranty_package_name || "VIP")}\n   ⏳ s/d: ${expStr} | 🔄 Limit: ${u.warranty_daily_limit || 5}x/hari`;
    }).join("\n\n");
  }

  const text = [
    `👑 <b>Daftar Pengguna VIP / Lisensi</b>`,
    "",
    `📊 Kategori: <b>${filterLabel}</b> ${search ? `| Cari: "<b>${esc(search)}</b>"` : ""}`,
    `👥 Total: <b>${total} pengguna</b> (Halaman <b>${p}/${totalPages}</b>)`,
    "",
    listContent,
    "",
    "<i>Pilih pengguna di bawah untuk melihat rincian / memperpanjang / mencabut VIP:</i>"
  ].join("\n");

  const keyboard = [];

  // Filter bar
  keyboard.push([
    { text: filter === "all" ? "• 📋 Semua •" : "📋 Semua", callback_data: `admin_vip_users:1:all` },
    { text: filter === "active" ? "• 🟢 Aktif •" : "🟢 Aktif", callback_data: `admin_vip_users:1:active` },
    { text: filter === "lifetime" ? "• ♾️ Lifetime •" : "♾️ Lifetime", callback_data: `admin_vip_users:1:lifetime` },
    { text: filter === "expired" ? "• 🔴 Expired •" : "🔴 Expired", callback_data: `admin_vip_users:1:expired` }
  ]);

  // User detail buttons (2 per row)
  for (let i = 0; i < users.length; i += 2) {
    const row = [];
    const u1 = users[i];
    const label1 = u1.username ? `@${u1.username}` : `${u1.first_name || u1.telegram_user_id}`;
    row.push({ text: `👤 ${label1.slice(0, 16)}`, callback_data: `admin_vip_detail:${u1.telegram_user_id}` });

    if (users[i + 1]) {
      const u2 = users[i + 1];
      const label2 = u2.username ? `@${u2.username}` : `${u2.first_name || u2.telegram_user_id}`;
      row.push({ text: `👤 ${label2.slice(0, 16)}`, callback_data: `admin_vip_detail:${u2.telegram_user_id}` });
    }
    keyboard.push(row);
  }

  // Pagination & Search
  const navRow = [];
  if (p > 1) {
    navRow.push({ text: `◀️ Hal ${p - 1}`, callback_data: `admin_vip_users:${p - 1}:${filter}` });
  }
  navRow.push({ text: "🔍 Cari User", callback_data: "admin_vip_search" });
  if (p < totalPages) {
    navRow.push({ text: `Hal ${p + 1} ▶️`, callback_data: `admin_vip_users:${p + 1}:${filter}` });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  // Actions
  keyboard.push([
    { text: "⚡ Aktifkan VIP User Baru", callback_data: "admin_vip_act_start" }
  ]);
  keyboard.push([
    { text: "🔙 Kembali ke Admin", callback_data: "admin_back" }
  ]);

  if (messageId) {
    try {
      await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      return;
    } catch {}
  }
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function renderVipUserDetail(chatId, messageId = null, targetUserId) {
  const uid = String(targetUserId).trim();
  const user = await getUser(uid);
  if (!user) {
    const errorText = `❌ Data pengguna dengan ID <code>${esc(uid)}</code> tidak ditemukan.`;
    const kb = [[{ text: "🔙 Kembali ke Daftar VIP", callback_data: "admin_vip_users:1:all" }]];
    if (messageId) {
      await editMessage(chatId, messageId, errorText, { reply_markup: { inline_keyboard: kb } });
    } else {
      await sendMessage(chatId, errorText, { reply_markup: { inline_keyboard: kb } });
    }
    return;
  }

  const warranty = await checkUserWarranty(user.telegram_user_id);
  const isLifetime = Boolean(user.warranty_lifetime);
  const expDate = user.warranty_expires_at ? new Date(user.warranty_expires_at) : null;

  let statusText = "🟢 <b>Aktif (Berlisensi VIP)</b>";
  let expText = "-";
  if (user.is_banned) {
    statusText = "⛔ <b>Terblokir / Banned</b>";
  } else if (isLifetime) {
    statusText = "♾️ <b>VIP Lifetime (Selamanya)</b>";
    expText = "Permanen / Tanpa Batas Waktu";
  } else if (warranty.isExpired) {
    statusText = "🔴 <b>Kedaluwarsa (Expired)</b>";
    expText = expDate
      ? `${expDate.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" })} ${expDate.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })} WIB`
      : "Belum aktif";
  } else {
    const diffDays = Math.max(0, Math.ceil((expDate.getTime() - Date.now()) / 86400000));
    expText = `${expDate.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" })} (${diffDays} hari lagi)`;
  }

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || "-";

  const text = [
    `👤 <b>Rincian Pengguna VIP</b>`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `• <b>Telegram ID:</b> <code>${user.telegram_user_id}</code>`,
    `• <b>Username:</b> ${user.username ? `@${esc(user.username)}` : "<i>(tanpa username)</i>"}`,
    `• <b>Nama:</b> <b>${esc(fullName)}</b>`,
    `• <b>Status VIP:</b> ${statusText}`,
    `• <b>Paket:</b> <b>${esc(user.warranty_package_name || "-")}</b>`,
    `• <b>Masa Aktif:</b> <b>${expText}</b>`,
    `• <b>Limit Harian:</b> <b>${warranty.dailyLimit || user.warranty_daily_limit || 5}x per hari</b>`,
    `• <b>Klaim Hari Ini:</b> <b>${warranty.claimsToday || 0}x</b> (Sisa: <b>${warranty.remainingToday || 0}x</b>)`,
    `━━━━━━━━━━━━━━━━━━━━`,
    "",
    "Pilih tindakan untuk pengguna ini:"
  ].join("\n");

  const keyboard = [
    [
      { text: "➕ Tambah +30 Hari", callback_data: `admin_vip_ext:${user.telegram_user_id}:30` },
      { text: "➕ Tambah +7 Hari", callback_data: `admin_vip_ext:${user.telegram_user_id}:7` }
    ],
    [
      { text: "♾️ Set Jadi Lifetime", callback_data: `admin_vip_life:${user.telegram_user_id}` },
      { text: "🔄 Ganti Paket/Durasi", callback_data: `admin_vip_change_pkg:${user.telegram_user_id}` }
    ],
    [
      { text: "❌ Cabut Status VIP", callback_data: `admin_vip_revoke_ask:${user.telegram_user_id}` }
    ],
    [
      { text: "🔙 Kembali ke Daftar VIP", callback_data: "admin_vip_users:1:all" }
    ]
  ];

  if (messageId) {
    try {
      await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      return;
    } catch {}
  }
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function renderVipSelectPackageMenu(chatId, messageId = null, targetUserId) {
  const uid = String(targetUserId).trim();
  const user = await getUser(uid);
  const packages = await getPackages({ onlyEnabled: true });

  const displayName = user?.username ? `@${esc(user.username)}` : (user?.first_name ? esc(user.first_name) : `ID: ${uid}`);

  const text = [
    `⚡ <b>Pilih Paket VIP untuk Pengguna</b>`,
    "",
    `🎯 Target: <b>${displayName}</b> (<code>${uid}</code>)`,
    "",
    "Pilih paket atau durasi di bawah untuk langsung mengaktifkan VIP pengguna ini:"
  ].join("\n");

  const keyboard = [];

  if (packages.length > 0) {
    for (const p of packages) {
      keyboard.push([
        {
          text: `📦 ${p.name} (${fmtDuration(p.duration_days, p.lifetime, p.duration_hours)} - ${p.daily_limit}x/hr)`,
          callback_data: `vip_pick_pkg:${uid}:${p.id}`
        }
      ]);
    }
  }

  keyboard.push([
    { text: "⚡ 7 Hari", callback_data: `vip_pick_quick:${uid}:7d` },
    { text: "⚡ 30 Hari", callback_data: `vip_pick_quick:${uid}:30d` },
    { text: "⚡ 90 Hari", callback_data: `vip_pick_quick:${uid}:90d` }
  ]);
  keyboard.push([
    { text: "♾️ VIP Lifetime (Selamanya)", callback_data: `vip_pick_quick:${uid}:lifetime` }
  ]);

  keyboard.push([
    { text: "✏️ Input Durasi Bebas / Custom", callback_data: `vip_pick_custom:${uid}` }
  ]);

  keyboard.push([
    { text: "🔙 Kembali ke Daftar VIP", callback_data: "admin_vip_users:1:all" }
  ]);

  if (messageId) {
    try {
      await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      return;
    } catch {}
  }
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function renderGenVoucherMenu(chatId, messageId = null) {
  const packages = await getPackages({ onlyEnabled: true });

  const keyboard = [
    [{ text: "✨ Buat Voucher Bebas (Tanpa Paket)", callback_data: "gen_voucher_custom" }]
  ];

  if (packages.length > 0) {
    keyboard.push([{ text: "📦 Gunakan Template dari Daftar Paket ▾", callback_data: "gen_voucher_from_pkgs" }]);
  }

  keyboard.push([{ text: "🔙 Kembali", callback_data: "admin_back" }]);

  const text = [
    "🎟️ <b>Generate Voucher Redeem</b>",
    "",
    "Anda dapat membuat voucher secara bebas (tanpa harus menambahkan paket ke daftar beli pengguna) atau menggunakan template paket yang sudah ada:",
    "",
    "• <b>Voucher Bebas:</b> Tentukan sendiri nama paket, durasi (jam/hari/lifetime), dan limit harian.",
    packages.length > 0 ? "• <b>Dari Template Paket:</b> Menggunakan setelan paket yang sudah tersimpan.\n" : "",
    "Silakan pilih salah satu:"
  ].join("\n");

  if (messageId) {
    try {
      await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      return;
    } catch {}
  }
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function renderStatsMenu(chatId, messageId = null) {
  const stats = await getStats();
  const text = [
    "📊 <b>Statistik Lengkap</b>",
    "",
    `👤 Total users: <b>${stats.users}</b>`,
    `🎟️ Garansi aktif: <b>${stats.activeWarranties}</b>`,
    `🔗 Total URL diambil: <b>${stats.totalUrlsFetched}</b>`,
    "",
    "🎟️ <b>Voucher:</b>",
    `• Total dibuat: <b>${stats.codes.total}</b>`,
    `• Terpakai: <b>${stats.codes.used}</b>`,
    `• Tersisa aktif: <b>${stats.codes.unused}</b>`
  ].join("\n");

  const keyboard = [[{ text: "🔙 Kembali", callback_data: "admin_back" }]];

  if (messageId) {
    try {
      await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      return;
    } catch {}
  }
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function renderBroadcastMenu(chatId, messageId = null) {
  const userIds = await getAllUserIds();
  const text = [
    "📢 <b>Menu Broadcast Pengguna</b>",
    "",
    `Total pengguna terdaftar: <b>${userIds.length} orang</b>`,
    "",
    "Pilih jenis pesan broadcast yang ingin dikirimkan:"
  ].join("\n");

  const keyboard = [
    [{ text: "📝 Broadcast Teks Saja", callback_data: "bcast_type_text" }],
    [{ text: "🖼️ Broadcast Gambar + Teks", callback_data: "bcast_type_photo" }],
    [{ text: "🔙 Kembali", callback_data: "admin_back" }]
  ];

  if (messageId) {
    try {
      await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      return;
    } catch {}
  }
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function renderSettingsMenu(chatId, messageId = null) {
  const targetBot = await getSetting("target_bot", "SSNetflixBot");
  const countries = await getSetting("country_priority", ["ID", "MY", "SG"]);
  const reqW = await getSetting("require_warranty", false);
  const supportUser = await getSetting("support_username", "iLinkinStore");

  const text = [
    "⚙️ <b>Pengaturan Bot</b>",
    "",
    `• Target Bot: <code>@${esc(targetBot)}</code>`,
    `• Prioritas Negara: <code>${countries.join(", ")}</code>`,
    `• Syarat Wajib Garansi: <b>${reqW ? "✅ Aktif (Wajib)" : "❌ Nonaktif (Bebas)"}</b>`,
    `• Username Support: <code>@${esc(supportUser)}</code>`,
    "",
    "Pilih opsi di bawah untuk mengubah setelan:"
  ].join("\n");

  const keyboard = [
    [{ text: reqW ? "🔓 Jadikan Bebas / Publik" : "🔒 Aktifkan Wajib Garansi", callback_data: "toggle_req_warranty" }],
    [{ text: "🤖 Ganti Target Bot", callback_data: "bridge_set_username" }],
    [{ text: "🔙 Kembali", callback_data: "admin_back" }]
  ];

  if (messageId) {
    try {
      await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
      return;
    } catch {}
  }
  await sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
}

// ─── USER MENUS ───────────────────────────────────────────────────────────────

async function sendStartMenu(chatId, from) {
  const firstName = esc(from?.first_name || "User");
  const warranty = await checkUserWarranty(from?.id);
  const isAdminUser = isAdmin(from?.id);

  let statusText = "❌ <b>Belum Berlisensi VIP (Tidak Aktif)</b>";
  let quotaText = "📊 Kuota Hari Ini: <b>0 / 0</b> <i>(Belum Berlisensi VIP)</i>";

  if (isAdminUser) {
    statusText = "👑 <b>Administrator (Akses Penuh ♾️)</b>";
    quotaText = "📊 Kuota Hari Ini: <b>Unlimited (Admin)</b>";
  } else if (warranty.hasActiveWarranty) {
    if (warranty.isLifetime) {
      statusText = `✅ <b>Aktif VIP: ${esc(warranty.packageName || "Lifetime")}</b> (Selamanya ♾️)`;
    } else {
      statusText = `✅ <b>Aktif VIP: ${esc(warranty.packageName || "Garansi")}</b> (s/d ${fmtDate(warranty.expiresAt)})`;
    }
    quotaText = `📊 Kuota Hari Ini: <b>${warranty.remainingToday} / ${warranty.dailyLimit}</b>`;
  }

  const lines = [
    `👋 <b>Halo, ${firstName}!</b>`,
    "",
    `Selamat datang di 🍿 <b>${BOT_NAME}</b>`,
    "",
    "━━━━━━━━━━━━━━━━━━",
    `🛡️ <b>Status Lisensi:</b> ${statusText}`,
    quotaText,
    "━━━━━━━━━━━━━━━━━━",
    "",
    "<b>Supported Devices:</b>",
    "• 🖥️ PC / Laptop",
    "• 📱 HP / Mobile (Android/iOS)",
    "• 📺 Smart TV",
    "",
    "💡 <i>Gunakan menu di bawah atau tukarkan voucher untuk mulai.</i>",
    "",
    "⚡ <i>Powered by iLink.in Store</i>"
  ];

  const inlineKeyboard = [];
  if (isAdminUser || warranty.hasActiveWarranty) {
    inlineKeyboard.push([{ text: "🍿 Ambil Token / Link", callback_data: "ambil" }]);
  } else {
    inlineKeyboard.push([{ text: "👑 Beli Lisensi VIP / Paket", callback_data: "paket" }]);
    inlineKeyboard.push([{ text: "🍿 Ambil Token / Link", callback_data: "ambil" }]);
  }

  inlineKeyboard.push([
    { text: "🔍 Cek Status Lisensi", callback_data: "cek" },
    { text: "🎟️ Redeem Voucher", callback_data: "redeem_info" }
  ]);
  inlineKeyboard.push([
    { text: "📦 Daftar Paket", callback_data: "paket" },
    { text: "🌐 Akses Website", url: "https://link-netflix.vercel.app" }
  ]);
  inlineKeyboard.push([{ text: "📖 Panduan / Bantuan", callback_data: "bantuan" }]);

  await sendMessage(chatId, lines.join("\n"), {
    reply_markup: {
      inline_keyboard: inlineKeyboard
    }
  });
}

async function handleCek(chatId, from) {
  const warranty = await checkUserWarranty(from?.id);
  const firstName = esc(from?.first_name || "User");
  const isAdminUser = isAdmin(from?.id);

  let statusBadge = "❌ Belum Berlisensi VIP (Tidak Aktif)";
  let expiryStr = "-";

  if (isAdminUser) {
    statusBadge = "👑 Administrator (Akses Penuh)";
    expiryStr = "Selamanya (Unlimited ♾️)";
  } else if (warranty.hasActiveWarranty) {
    statusBadge = `✅ Aktif VIP (${esc(warranty.packageName || "Garansi")})`;
    expiryStr = warranty.isLifetime ? "Selamanya (Lifetime ♾️)" : fmtDateTime(warranty.expiresAt);
  }

  const lines = [
    "🔍 <b>Rincian Status Lisensi VIP & Akun Anda</b>",
    "",
    `👤 <b>Nama:</b> ${firstName}`,
    `🆔 <b>Telegram ID:</b> <code>${from?.id}</code>`,
    `⚡ <b>Status:</b> ${statusBadge}`,
    `📦 <b>Paket:</b> ${esc(warranty.packageName || (isAdminUser ? "Admin VIP" : "-"))}`,
    `⏳ <b>Masa Berlaku:</b> ${expiryStr}`,
    `📊 <b>Penggunaan Hari Ini:</b> ${warranty.claimsToday} dari ${isAdminUser ? "∞" : warranty.dailyLimit} klaim`,
    `🎯 <b>Sisa Kuota Hari Ini:</b> ${isAdminUser ? "Unlimited" : (warranty.hasActiveWarranty ? `${warranty.remainingToday} klaim` : "0 klaim (Belum Berlisensi VIP)")}`,
    "",
    "⚡ <i>Powered by iLink.in Store</i>"
  ];

  const inlineKeyboard = [];
  if (isAdminUser || warranty.hasActiveWarranty) {
    inlineKeyboard.push([{ text: "🍿 Ambil Token Sekarang", callback_data: "ambil" }]);
  } else {
    inlineKeyboard.push([{ text: "👑 Beli Lisensi VIP Sekarang", callback_data: "paket" }]);
  }

  inlineKeyboard.push([
    { text: "📦 Daftar Paket", callback_data: "paket" },
    { text: "🎟️ Redeem Voucher", callback_data: "redeem_info" }
  ]);
  inlineKeyboard.push([{ text: "🔙 Kembali ke Menu", callback_data: "start" }]);

  await sendMessage(chatId, lines.join("\n"), {
    reply_markup: {
      inline_keyboard: inlineKeyboard
    }
  });
}

async function handlePaket(chatId) {
  const packages = await getPackages({ onlyEnabled: true });
  const supportUser = await getSetting("support_username", "iLinkinStore");

  const lines = [
    "📦 <b>Daftar Paket Garansi Netflix</b>",
    "",
    "Pilih paket garansi sesuai kebutuhan Anda:",
    ""
  ];

  for (const pkg of packages) {
    const durasi = pkg.lifetime
      ? "Selamanya ♾️"
      : pkg.duration_days > 0
      ? `${pkg.duration_days} Hari`
      : `${pkg.duration_hours} Jam`;

    lines.push(`• <b>${esc(pkg.name)}</b>`);
    lines.push(`  💰 Harga: <b>${fmtRupiah(pkg.price)}</b>`);
    lines.push(`  ⏳ Durasi: ${durasi}`);
    lines.push(`  🎯 Limit: ${pkg.daily_limit}x klaim / hari`);
    lines.push("");
  }

  lines.push("━━━━━━━━━━━━━━━━━━");
  lines.push("🛒 <b>Cara Pembelian:</b>");
  lines.push(`1. Hubungi Admin di @${supportUser}`);
  lines.push("2. Lakukan pembayaran via QRIS/Transfer Bank");
  lines.push("3. Admin akan memberikan Kode Voucher");
  lines.push("4. Ketik <code>/redeem KODE-VOUCHER</code> untuk aktivasi");
  lines.push("");
  lines.push("⚡ <i>Powered by iLink.in Store</i>");

  await sendMessage(chatId, lines.join("\n"), {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💬 Hubungi Admin untuk Beli", url: `https://t.me/${supportUser}` }],
        [{ text: "🎟️ Sudah Punya Voucher? Redeem", callback_data: "redeem_info" }],
        [{ text: "🔙 Kembali ke Menu", callback_data: "start" }]
      ]
    }
  });
}

async function handleRedeemCommand(chatId, from, rawCode) {
  const code = String(rawCode || "").trim();
  if (!code) {
    await sendMessage(
      chatId,
      [
        "🎟️ <b>Cara Redeem Voucher:</b>",
        "",
        "Ketik perintah redeem beserta kodenya, contoh:",
        "<code>/redeem NETFLIX-ABCD-EFGH-1234</code>",
        "",
        "Belum punya voucher? Cek paket di /paket atau hubungi admin."
      ].join("\n"),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📦 Lihat Daftar Paket", callback_data: "paket" }]
          ]
        }
      }
    );
    return;
  }

  try {
    const result = await redeemVoucher(from?.id, code);
    if (!result.ok) {
      await sendMessage(chatId, `❌ <b>Gagal Redeem Voucher:</b>\n${result.message}`);
      return;
    }

    await sendMessage(
      chatId,
      [
        "🎉 <b>VOUCHER BERHASIL DIAKTIFKAN!</b>",
        "",
        result.message,
        "",
        "Sekarang Anda sudah bisa langsung mengambil link login Netflix.",
        "",
        "⚡ <i>Powered by iLink.in Store</i>"
      ].join("\n"),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🍿 Ambil Token Sekarang", callback_data: "ambil" }],
            [{ text: "🔍 Cek Status Garansi", callback_data: "cek" }]
          ]
        }
      }
    );
  } catch (err) {
    await sendMessage(chatId, `❌ Terjadi kesalahan: <code>${esc(err.message)}</code>`);
  }
}

async function handleAmbilToken(chatId, from, mode = null) {
  const isAdminUser = isAdmin(from?.id);
  const requireWarranty = await getSetting("require_warranty", true);
  const warranty = await checkUserWarranty(from?.id);

  if (warranty.isBanned) {
    await sendMessage(chatId, "⛔ Akun Anda telah dinonaktifkan oleh administrator.");
    return;
  }

  if (!isAdminUser && requireWarranty && !warranty.hasActiveWarranty) {
    await sendMessage(
      chatId,
      [
        "👑 <b>Akses Dibatasi — Belum Berlisensi VIP</b>",
        "",
        "Status akun Anda saat ini <b>belum memiliki lisensi VIP aktif</b>.",
        "Untuk dapat mengambil atau generate link Netflix, silakan beli paket lisensi atau tukarkan voucher terlebih dahulu.",
        "",
        "Ketik /paket untuk melihat pilihan lisensi yang tersedia, atau ketik <code>/redeem KODE</code> untuk aktivasi."
      ].join("\n"),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "👑 Beli Lisensi VIP", callback_data: "paket" }],
            [{ text: "🎟️ Redeem Voucher", callback_data: "redeem_info" }],
            [{ text: "🔍 Cek Status Akun", callback_data: "cek" }],
            [{ text: "🔙 Menu Utama", callback_data: "start" }]
          ]
        }
      }
    );
    return;
  }

  if (!isAdminUser && requireWarranty && warranty.remainingToday <= 0) {
    await sendMessage(
      chatId,
      [
        "⚠️ <b>Batas Harian Tercapai</b>",
        "",
        `Kuota klaim harian Anda hari ini sudah habis (Maksimal <b>${warranty.dailyLimit}x</b> per hari).`,
        "Kuota akan direset kembali pada pukul 00:00 WIB.",
        "",
        "Silakan kembali besok atau hubungi admin jika butuh limit tambahan."
      ].join("\n"),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔍 Cek Kuota", callback_data: "cek" }],
            [{ text: "💬 Hubungi Bantuan", callback_data: "bantuan" }]
          ]
        }
      }
    );
    return;
  }

  // Cek apakah ada cookies akun tersimpan untuk user ini
  const lastAccount = await getUserLastAccountCookies(from?.id);

  // Jika mode belum ditentukan, dan user punya cookies tersimpan, tampilkan pilihan singkat & bagus
  if (!mode) {
    if (lastAccount?.cookies) {
      const region = lastAccount.country ? ` (${esc(lastAccount.country)})` : "";
      const text = [
        "🍿 <b>Pilihan Link Login Netflix</b>",
        "",
        `Akun sebelumnya masih tersimpan${region}.`,
        "Pilih link yang ingin Anda generate:"
      ].join("\n");

      const keyboard = [
        [
          { text: "🔄 Akun Sama", callback_data: "ambil_akun_sama" },
          { text: "✨ Akun Baru", callback_data: "ambil_akun_baru" }
        ],
        [{ text: "🔙 Kembali ke Menu", callback_data: "start" }]
      ];

      await sendMessage(chatId, text, {
        reply_markup: { inline_keyboard: keyboard }
      });
      return;
    }
    mode = "baru";
  }

  if (mode === "sama") {
    if (!lastAccount?.cookies) {
      await sendMessage(
        chatId,
        "⚠️ <b>Belum ada akun tersimpan.</b>\nOtomatis mengambil akun Netflix baru..."
      );
      return handleAmbilToken(chatId, from, "baru");
    }

    const progress = await sendMessage(
      chatId,
      "⏳ <b>Memproses Akun Tersimpan...</b>\n\nSedang generate link login baru untuk akun yang sama..."
    );

    const job = await enqueueJob({
      telegramUserId: from?.id,
      chatId,
      inputType: "text",
      payload: lastAccount.cookies,
      progressMessageId: progress.message_id,
      debugMode: false
    });

    waitUntil(
      kickBridgeWorker().catch((error) => {
        console.error("kickBridgeWorker failed:", error);
      })
    );

    console.log(`Queued same-account job ${job.id} for user ${from?.id}`);
    return;
  }

  // mode === "baru"
  const progress = await sendMessage(
    chatId,
    "⏳ <b>Permintaan diterima.</b>\n\nSedang mengambil akun Netflix baru..."
  );

  const job = await enqueueJob({
    telegramUserId: from?.id,
    chatId,
    inputType: "text",
    payload: "generate",
    progressMessageId: progress.message_id,
    debugMode: false
  });

  waitUntil(
    kickBridgeWorker().catch((error) => {
      console.error("kickBridgeWorker failed:", error);
    })
  );

  console.log(`Queued auto-generate job ${job.id} for user ${from?.id}`);
}

async function handleHelp(chatId) {
  const helpLines = [
    "📖 <b>Panduan Penggunaan Bot:</b>",
    "",
    "1️⃣ Klik tombol <b>🍿 Ambil Token / Link</b> atau ketik /ambil.",
    "2️⃣ Tunggu bot memproses akun Netflix dari server.",
    "3️⃣ Anda akan menerima link khusus perangkat:",
    "   • 🖥️ Link PC / Laptop",
    "   • 📱 Link HP / Mobile",
    "   • 📺 Link Smart TV",
    "4️⃣ Buka link tersebut di perangkat yang sesuai.",
    "",
    "🔑 <b>Voucher & Garansi:</b>",
    "• Cek masa berlaku garansi Anda dengan /cek",
    "• Beli paket melalui menu /paket",
    "• Tukarkan kode voucher dengan <code>/redeem KODE</code>",
    "",
    "⚡ <i>Powered by iLink.in Store</i>"
  ];

  await sendMessage(chatId, helpLines.join("\n"), {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🌐 Akses Website", url: "https://link-netflix.vercel.app" }],
        [{ text: "🔙 Menu Utama", callback_data: "start" }]
      ]
    }
  });
}

function buildRecordingKeyboard(rec) {
  const keyboard = [];
  const grid = rec?.keyboardGrid || [];

  if (Array.isArray(grid) && grid.length > 0) {
    for (const row of grid) {
      const rowButtons = [];
      for (const btn of row) {
        if (btn.url) {
          rowButtons.push({
            text: `${btn.text} 🔗`,
            url: btn.url
          });
        } else {
          rowButtons.push({
            text: btn.text || "Tombol",
            callback_data: `rec_c:${btn.row}_${btn.column}`
          });
        }
      }
      if (rowButtons.length) keyboard.push(rowButtons);
    }
  } else if (Array.isArray(rec?.buttons) && rec.buttons.length > 0) {
    for (const btn of rec.buttons) {
      keyboard.push([
        {
          text: btn.text || `Tombol ${btn.index}`,
          callback_data: `rec_c:${btn.row}_${btn.column}`
        }
      ]);
    }
  }

  // Tombol kontrol selalu di baris paling bawah
  keyboard.push([
    { text: "⏹️ Simpan Alur", callback_data: "bridge_record_finish" },
    { text: "❌ Batalkan", callback_data: "bridge_record_cancel" }
  ]);

  return keyboard;
}

async function startRecordingSession(chatId, userId, targetBot, sessionString) {
  await sendMessage(
    chatId,
    `⏳ Menghubungkan ke userbot dan mengirimkan <code>/start</code> ke <b>@${esc(targetBot)}</b>...`
  );

  try {
    const snapshot = await startWorkflowRecording({
      ownerId: userId,
      targetBot,
      sessionString
    });

    await setAdminWizard(userId, {
      action: "record_bridge_flow",
      targetBot,
      sessionString
    });

    const snapshotText = renderFlowSnapshot(snapshot);
    const keyboard = buildRecordingKeyboard(snapshot);

    await sendMessage(chatId, snapshotText, {
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (err) {
    await clearAdminWizard(userId);
    await sendMessage(chatId, `❌ Gagal memulai rekam alur: <code>${esc(err.message)}</code>`, {
      reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]] }
    });
  }
}

// ─── ADMIN TEXT WIZARD HANDLER ────────────────────────────────────────────────

async function handleAdminTextWizard(chatId, from, text) {
  const userId = String(from.id);
  const wizard = await getAdminWizard(userId);
  if (!wizard) return false;

  // 1. Wizard: Batal
  if (text === "/batal") {
    if (wizard.action === "record_bridge_flow") {
      await cancelWorkflowRecording(userId);
    }
    await clearAdminWizard(userId);
    await sendMessage(chatId, "❌ Proses admin dibatalkan.", {
      reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali ke Admin", callback_data: "admin_back" }]] }
    });
    return true;
  }

  // Wizard: Tambah bot target baru
  if (wizard.action === "add_target_bot_username") {
    const clean = text.replace(/^@/, "").trim();
    const botType = wizard.botType || "login";
    const isLogin = botType === "login";
    try {
      const newBot = await addTargetBot({ username: clean, type: botType });
      await clearAdminWizard(userId);
      await sendMessage(
        chatId,
        `✅ <b>${isLogin ? "🎬 Bot Ambil Link Login" : "🍪 Bot Generate Cookies"} @${esc(newBot.username)} berhasil ditambahkan!</b>\n\nPrioritas Failover: <b>#${newBot.priority}</b>\n\nApakah Anda ingin langsung merekam alur interaktif untuk bot ini sekarang?`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🎥 Rekam Alur Bot Ini Sekarang", callback_data: `bot_rec_start:${newBot.id}` }],
              [{ text: `🤖 Kelola Daftar ${isLogin ? "Bot Ambil Link" : "Bot Cookies"}`, callback_data: `admin_bots:${botType}` }],
              [{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]
            ]
          }
        }
      );
    } catch (err) {
      await sendMessage(chatId, `❌ Gagal menambahkan bot: <code>${esc(err.message)}</code>\n\nCoba kirim username lain atau ketik /batal.`);
    }
    return true;
  }

  // Wizard: Masukkan bot target baru untuk rekam alur
  if (wizard.action === "record_target_username") {
    const target = text.replace(/^@/, "").trim();
    if (!/^[A-Za-z0-9_]{4,32}$/.test(target)) {
      await sendMessage(chatId, "❌ Username bot tidak valid. Masukkan username (misal: <code>SSNetflixBot</code>).");
      return true;
    }
    try {
      await addTargetBot({ username: target });
    } catch {}

    const accounts = await getBridgeAccounts();
    const activeAcc = accounts.find((a) => a.enabled !== false && a.sessionString);
    if (!activeAcc) {
      await clearAdminWizard(userId);
      await sendMessage(chatId, "❌ Belum ada akun bridge aktif. Tambahkan akun bridge terlebih dahulu di menu Bridge.");
      return true;
    }
    await startRecordingSession(chatId, userId, target, activeAcc.sessionString);
    return true;
  }

  // Wizard: Interaktif rekam alur bridge
  if (wizard.action === "record_bridge_flow") {
    if (text === "/rekam_selesai") {
      try {
        const wf = await finishWorkflowRecording(userId);
        await clearAdminWizard(userId);
        await sendMessage(
          chatId,
          `✅ <b>Alur berhasil disimpan!</b>\n\n🎯 Target: <b>@${esc(wf.targetBot)}</b>\n📊 Jumlah langkah: <b>${wf.steps.length}</b>\n\nWorker bridge akan otomatis mereplay alur ini saat memproses request cookies.`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "📋 Lihat Detail Alur", callback_data: "bridge_workflow_view" }],
                [{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]
              ]
            }
          }
        );
      } catch (err) {
        await sendMessage(chatId, `❌ Gagal menyimpan alur: <code>${esc(err.message)}</code>`);
      }
      return true;
    }

    const clickMatch = text.match(/^\/rekam_klik\s+(\d+)$/i);
    if (clickMatch) {
      const idx = parseInt(clickMatch[1], 10);
      try {
        await sendMessage(chatId, `⏳ Mengklik tombol nomor ${idx}...`);
        const snapshot = await clickWorkflowRecordingButton({
          ownerId: userId,
          index: idx,
          sessionString: wizard.sessionString
        });
        const snapshotText = renderFlowSnapshot(snapshot);
        const keyboard = buildRecordingKeyboard(snapshot);
        await sendMessage(chatId, snapshotText, { reply_markup: { inline_keyboard: keyboard } });
      } catch (err) {
        await sendMessage(chatId, `❌ Gagal klik tombol: <code>${esc(err.message)}</code>`);
      }
      return true;
    }

    const forwardMatch = text.match(/^\/rekam_kirim\s+([\s\S]+)$/i);
    const textToSend = forwardMatch ? forwardMatch[1].trim() : text;

    if (text.startsWith("/") && !forwardMatch && text !== "/batal") {
      await sendMessage(
        chatId,
        "Untuk mengirim perintah bot ke target (misal /start), gunakan:\n<code>/rekam_kirim /perintah</code>"
      );
      return true;
    }

    try {
      await sendMessage(chatId, `⏳ Mengirim pesan ke @${esc(wizard.targetBot)}...`);
      const snapshot = await sendWorkflowRecordingText({
        ownerId: userId,
        text: textToSend,
        sessionString: wizard.sessionString
      });
      const snapshotText = renderFlowSnapshot(snapshot);
      const keyboard = buildRecordingKeyboard(snapshot);
      await sendMessage(chatId, snapshotText, { reply_markup: { inline_keyboard: keyboard } });
    } catch (err) {
      await sendMessage(chatId, `❌ Gagal kirim teks: <code>${esc(err.message)}</code>`);
    }
    return true;
  }

  // 2. Wizard: Set Bot Target
  if (wizard.action === "set_bridge_username") {
    const username = text.replace(/^@/, "").trim();
    if (!/^[A-Za-z0-9_]{4,32}$/.test(username)) {
      await sendMessage(chatId, "❌ Username bot tidak valid. Masukkan username bot (misal: <code>SSNetflixBot</code>).");
      return true;
    }
    await clearAdminWizard(userId);
    await setSetting("target_bot", username);
    await sendMessage(chatId, `✅ Bot target berhasil disimpan: <b>@${esc(username)}</b>`, {
      reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]] }
    });
    return true;
  }

  // Wizard: Set Prioritas Negara
  if (wizard.action === "set_country_priority") {
    const list = [...new Set(
      text
        .split(/[,;\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    )];

    if (!list.length) {
      await sendMessage(chatId, "❌ Masukkan minimal 1 kode negara (contoh: <code>ID, MY, SG</code>).");
      return true;
    }

    await setSetting("country_priority", list);
    await clearAdminWizard(userId);

    const formattedList = list
      .map((code, idx) => `  <b>${idx + 1}.</b> ${COUNTRY_NAMES[code] || code} (<code>${code}</code>)`)
      .join("\n");

    await sendMessage(
      chatId,
      [
        "✅ <b>Urutan Prioritas Negara Berhasil Disimpan!</b>",
        "",
        "<b>Daftar Prioritas Baru:</b>",
        formattedList,
        "",
        "<i>Sistem bridge akan selalu mencari Prioritas 1 terlebih dahulu di semua halaman bot target. Jika stok kosong atau negara tersebut tidak ada, bot otomatis berpindah ke Prioritas 2, lalu Prioritas 3, dst.</i>"
      ].join("\n"),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🌏 Atur Prioritas Lagi", callback_data: "admin_country_priority" }],
            [{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]
          ]
        }
      }
    );
    return true;
  }

  // 3. Wizard: Tambah Akun Bridge (Nomor HP)
  if (wizard.action === "add_bridge_phone") {
    const phone = text.trim();
    try {
      const res = await startTelegramLogin(phone);
      await setAdminWizard(userId, {
        action: "wait_bridge_otp",
        loginId: res.loginId,
        phone: res.phone
      });
      await sendMessage(
        chatId,
        `📱 Kode login Telegram telah dikirim ke <b>${esc(res.phone)}</b> ${res.isCodeViaApp ? "(via aplikasi Telegram)" : ""}.\n\nSilakan masukkan kode OTP di chat pribadi ini.\n\n/batal untuk membatalkan.`
      );
    } catch (e) {
      await clearAdminWizard(userId);
      await sendMessage(chatId, `❌ Gagal memulai login: <code>${esc(e.message)}</code>`, {
        reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: "admin_bridge" }]] }
      });
    }
    return true;
  }

  // 4. Wizard: Tambah Akun Bridge (Kode OTP)
  if (wizard.action === "wait_bridge_otp") {
    try {
      const res = await submitTelegramCode(wizard.loginId, text);
      if (res.needs2FA) {
        await setAdminWizard(userId, {
          action: "wait_bridge_2fa",
          loginId: wizard.loginId,
          phone: wizard.phone
        });
        await sendMessage(
          chatId,
          "🔐 Akun ini dilindungi verifikasi 2 langkah (2FA).\n\nMasukkan <b>password 2FA</b> Telegram Anda:"
        );
        return true;
      }

      await clearAdminWizard(userId);
      await addBridgeAccount({
        phone: res.phone,
        sessionString: res.sessionString,
        label: res.phone
      });
      await sendMessage(
        chatId,
        `✅ Akun bridge berhasil ditambahkan: <b>${esc(res.phone)}</b>.`,
        { reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]] } }
      );
    } catch (e) {
      await sendMessage(chatId, `❌ Verifikasi kode OTP gagal: <code>${esc(e.message)}</code>\n\nCoba kirim ulang kode atau ketik /batal.`);
    }
    return true;
  }

  // 5. Wizard: Tambah Akun Bridge (Password 2FA)
  if (wizard.action === "wait_bridge_2fa") {
    try {
      const res = await submitTelegram2FA(wizard.loginId, text);
      await clearAdminWizard(userId);
      await addBridgeAccount({
        phone: res.phone,
        sessionString: res.sessionString,
        label: res.phone
      });
      await sendMessage(
        chatId,
        `✅ Akun bridge berhasil ditambahkan dengan 2FA: <b>${esc(res.phone)}</b>.`,
        { reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]] } }
      );
    } catch (e) {
      await sendMessage(chatId, `❌ Password 2FA salah: <code>${esc(e.message)}</code>\n\nCoba ketik ulang password 2FA atau ketik /batal.`);
    }
    return true;
  }

  // 6. Wizard: Tambah Paket Garansi
  if (wizard.action === "add_pkg_name") {
    await setAdminWizard(userId, { action: "add_pkg_price", name: text.trim() });
    await sendMessage(chatId, `✅ Nama: <b>${esc(text)}</b>\n\nLangkah 2/4: Masukkan <b>harga</b> (angka Rupiah saja, contoh: <code>25000</code>):`);
    return true;
  }

  if (wizard.action === "add_pkg_price") {
    const price = parseInt(text.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(price) || price < 0) {
      await sendMessage(chatId, "❌ Harga tidak valid. Masukkan angka Rupiah (contoh: 25000).");
      return true;
    }
    await setAdminWizard(userId, { ...wizard, action: "add_pkg_duration", price });
    await sendMessage(
      chatId,
      `✅ Harga: <b>${fmtRupiah(price)}</b>\n\nLangkah 3/4: Masukkan <b>durasi garansi</b>\n• Contoh: <code>30 hari</code>, <code>7 hari</code>, <code>12 jam</code>, atau <code>lifetime</code>:`
    );
    return true;
  }

  if (wizard.action === "add_pkg_duration") {
    const lower = text.toLowerCase().trim();
    const isLifetime = ["lifetime", "selamanya"].includes(lower);
    let durationDays = 0;
    let durationHours = 0;

    const hourMatch = lower.match(/^(\d+)\s*(?:jam|jm|hour|h)$/i);
    const dayMatch = lower.match(/^(\d+)\s*(?:hari|hr|day|d)?$/i);

    if (isLifetime) {
      // lifetime
    } else if (hourMatch) {
      durationHours = parseInt(hourMatch[1], 10);
    } else if (dayMatch) {
      durationDays = parseInt(dayMatch[1], 10);
    } else {
      await sendMessage(chatId, "❌ Format durasi salah. Contoh: <code>30 hari</code>, <code>12 jam</code>, atau <code>lifetime</code>.");
      return true;
    }

    await setAdminWizard(userId, {
      ...wizard,
      action: "add_pkg_daily_limit",
      durationDays,
      durationHours,
      lifetime: isLifetime
    });
    await sendMessage(chatId, `✅ Durasi: <b>${fmtDuration(durationDays, isLifetime, durationHours)}</b>\n\nLangkah 4/4: Masukkan <b>limit klaim harian</b> (contoh: <code>5</code> atau <code>10</code>):`);
    return true;
  }

  if (wizard.action === "add_pkg_daily_limit") {
    const limit = parseInt(text, 10);
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      await sendMessage(chatId, "❌ Limit tidak valid (masukkan angka 1-100).");
      return true;
    }
    await clearAdminWizard(userId);
    const pkg = await addPackage({
      name: wizard.name,
      price: wizard.price,
      durationDays: wizard.durationDays,
      durationHours: wizard.durationHours,
      lifetime: wizard.lifetime,
      dailyLimit: limit
    });
    await sendMessage(
      chatId,
      `✅ <b>Paket berhasil dibuat!</b>\n\n📦 ${esc(pkg.name)}\n💰 ${fmtRupiah(pkg.price)}\n⏳ ${fmtDuration(pkg.duration_days, pkg.lifetime, pkg.duration_hours)}\n🔄 ${pkg.daily_limit}x/hari`,
      { reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali ke Daftar Paket", callback_data: "admin_packages" }]] } }
    );
    return true;
  }

  // 7. Wizard: Voucher Bebas (Custom Voucher)
  if (wizard.action === "gen_voucher_custom_name") {
    const name = text.trim();
    if (!name) {
      await sendMessage(chatId, "❌ Nama voucher tidak boleh kosong.");
      return true;
    }
    await setAdminWizard(userId, { action: "gen_voucher_custom_duration", name });
    await sendMessage(
      chatId,
      [
        `✅ Nama Voucher: <b>${esc(name)}</b>`,
        "",
        "Langkah 2/4: Masukkan <b>durasi garansi</b>",
        "• Dalam jam: <code>6 jam</code>, <code>12 jam</code>, <code>24 jam</code>",
        "• Dalam hari: <code>7 hari</code>, <code>30 hari</code>, atau angka <code>30</code>",
        "• Atau ketik <code>lifetime</code> untuk seumur hidup",
        "",
        "/batal untuk membatalkan."
      ].join("\n")
    );
    return true;
  }

  if (wizard.action === "gen_voucher_custom_duration") {
    const lower = text.toLowerCase().trim();
    const isLifetime = ["lifetime", "selamanya"].includes(lower);
    let durationDays = 0;
    let durationHours = 0;

    const hourMatch = lower.match(/^(\d+)\s*(?:jam|jm|hour|h)$/i);
    const dayMatch = lower.match(/^(\d+)\s*(?:hari|hr|day|d)?$/i);

    if (isLifetime) {
      // lifetime
    } else if (hourMatch) {
      durationHours = parseInt(hourMatch[1], 10);
    } else if (dayMatch) {
      durationDays = parseInt(dayMatch[1], 10);
    } else {
      await sendMessage(chatId, "❌ Format durasi salah. Contoh: <code>30 hari</code>, <code>12 jam</code>, atau <code>lifetime</code>.");
      return true;
    }

    await setAdminWizard(userId, {
      ...wizard,
      action: "gen_voucher_custom_limit",
      durationDays,
      durationHours,
      lifetime: isLifetime
    });
    await sendMessage(
      chatId,
      `✅ Durasi: <b>${fmtDuration(durationDays, isLifetime, durationHours)}</b>\n\nLangkah 3/4: Masukkan <b>limit klaim per hari</b> (contoh: <code>5</code>):\n\n/batal untuk membatalkan.`
    );
    return true;
  }

  if (wizard.action === "gen_voucher_custom_limit") {
    const limit = parseInt(text, 10);
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      await sendMessage(chatId, "❌ Limit tidak valid (1-100).");
      return true;
    }
    await setAdminWizard(userId, { ...wizard, action: "gen_voucher_custom_count", dailyLimit: limit });
    await sendMessage(
      chatId,
      `✅ Limit harian: <b>${limit}x/hari</b>\n\nLangkah 4/4: Masukkan <b>jumlah voucher</b> yang ingin dibuat (1-50, contoh: <code>5</code>):`
    );
    return true;
  }

  if (wizard.action === "gen_voucher_custom_count") {
    const count = parseInt(text, 10);
    if (!Number.isFinite(count) || count < 1 || count > 50) {
      await sendMessage(chatId, "❌ Masukkan jumlah angka 1 - 50.");
      return true;
    }
    await clearAdminWizard(userId);
    const vouchers = await generateCustomVouchers(count, {
      packageName: wizard.name,
      durationDays: wizard.durationDays,
      durationHours: wizard.durationHours,
      lifetime: wizard.lifetime,
      dailyLimit: wizard.dailyLimit
    });

    const codeList = vouchers.map((v) => `• <code>${v.raw_code}</code>`).join("\n");
    await sendMessage(
      chatId,
      `✅ Berhasil membuat <b>${vouchers.length} voucher bebas</b> (<b>${esc(wizard.name)}</b>):\n\n${codeList}\n\nGunakan <code>/redeem KODE</code> untuk aktivasi.`,
      { reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali ke Admin", callback_data: "admin_back" }]] } }
    );
    return true;
  }

  // 8. Wizard: Template Voucher Count
  if (wizard.action === "gen_voucher_template_count") {
    const count = parseInt(text, 10);
    if (!Number.isFinite(count) || count < 1 || count > 50) {
      await sendMessage(chatId, "❌ Masukkan jumlah angka 1 - 50.");
      return true;
    }
    await clearAdminWizard(userId);
    const vouchers = await createVouchers({ packageId: wizard.pkgId, count });
    const codeList = vouchers.map((v) => `• <code>${v.raw_code}</code>`).join("\n");
    await sendMessage(
      chatId,
      `✅ Berhasil membuat <b>${vouchers.length} voucher template</b> (<b>${esc(wizard.pkgName)}</b>):\n\n${codeList}\n\nGunakan <code>/redeem KODE</code> untuk aktivasi.`,
      { reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali ke Admin", callback_data: "admin_back" }]] } }
    );
    return true;
  }

  // 9. Wizard: Broadcast Teks
  if (wizard.action === "bcast_wait_text") {
    const userIds = await getAllUserIds();
    await setAdminWizard(userId, { action: "bcast_confirm", type: "text", content: text });
    await sendMessage(
      chatId,
      `${text}\n\n━━━━━━━━━━━━━━━━━━\n📢 <b>Pratinjau Broadcast Teks</b>\n🎯 Target penerima: <b>${userIds.length} pengguna</b>\n\nApakah Anda yakin ingin mengirim pesan ini sekarang?`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🚀 Kirim Sekarang", callback_data: "bcast_send_now" }],
            [{ text: "❌ Batal", callback_data: "admin_broadcast" }]
          ]
        }
      }
    );
    return true;
  }

  // 10. Wizard: Cari User VIP
  if (wizard.action === "vip_search_keyword") {
    await clearAdminWizard(userId);
    await renderVipUsersMenu(chatId, null, 1, "all", text);
    return true;
  }

  // 11. Wizard: Input User Target Aktivasi VIP
  if (wizard.action === "vip_act_target") {
    const clean = text.trim();
    const user = await getUserByIdOrUsername(clean);
    const targetUid = user?.telegram_user_id || clean.replace(/[^\d]/g, "");

    if (!targetUid) {
      await sendMessage(
        chatId,
        `❌ Pengguna "<code>${esc(clean)}</code>" belum pernah menekan /start di bot ini.\n\nSilakan masukkan <b>ID Telegram</b> berupa angka (contoh: <code>123456789</code>), atau minta user memulai chat dengan bot terlebih dahulu.\n\n/batal untuk membatalkan.`
      );
      return true;
    }

    await clearAdminWizard(userId);
    await renderVipSelectPackageMenu(chatId, null, targetUid);
    return true;
  }

  // 12. Wizard: Durasi Custom VIP
  if (wizard.action === "vip_act_custom_duration") {
    const targetUid = wizard.targetUid;
    const lower = text.toLowerCase().trim();
    const isLifetime = ["lifetime", "selamanya"].includes(lower);
    let durationDays = 0;
    let durationHours = 0;

    const hourMatch = lower.match(/^(\d+)\s*(?:jam|jm|hour|h)$/i);
    const dayMatch = lower.match(/^(\d+)\s*(?:hari|hr|day|d)?$/i);

    if (isLifetime) {
      // lifetime
    } else if (hourMatch) {
      durationHours = parseInt(hourMatch[1], 10);
    } else if (dayMatch) {
      durationDays = parseInt(dayMatch[1], 10);
    } else {
      await sendMessage(chatId, "❌ Format durasi salah. Contoh: <code>30 hari</code>, <code>12 jam</code>, atau <code>lifetime</code>.\n\n/batal untuk membatalkan.");
      return true;
    }

    if (isLifetime) {
      await clearAdminWizard(userId);
      try {
        const res = await activateUserVip({
          userId: targetUid,
          lifetime: true,
          packageName: "VIP Lifetime (Admin)"
        });
        await sendMessage(chatId, `✅ <b>VIP Lifetime Berhasil Diaktifkan!</b>\n\n• User: <code>${targetUid}</code>\n• Paket: <b>VIP Lifetime</b>\n• Masa Aktif: <b>Selamanya ♾️</b>`);
        try {
          await sendMessage(targetUid, "🎉 <b>Selamat! Akun Anda telah diaktifkan menjadi VIP Lifetime (Selamanya ♾️) oleh Admin.</b>");
        } catch {}
        await renderVipUserDetail(chatId, null, targetUid);
      } catch (e) {
        await sendMessage(chatId, `❌ Gagal aktivasi VIP: ${esc(e.message)}`);
      }
      return true;
    }

    await setAdminWizard(userId, {
      action: "vip_act_custom_limit",
      targetUid,
      durationDays,
      durationHours
    });
    await sendMessage(
      chatId,
      `✅ Durasi: <b>${fmtDuration(durationDays, false, durationHours)}</b>\n\nMasukkan <b>limit klaim per hari</b> (contoh: <code>5</code>):\n\n/batal untuk membatalkan.`
    );
    return true;
  }

  // 13. Wizard: Limit Custom VIP
  if (wizard.action === "vip_act_custom_limit") {
    const limit = parseInt(text, 10);
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      await sendMessage(chatId, "❌ Masukkan angka limit antara 1 - 100.");
      return true;
    }

    const { targetUid, durationDays, durationHours } = wizard;
    await clearAdminWizard(userId);

    try {
      const res = await activateUserVip({
        userId: targetUid,
        durationDays,
        durationHours,
        dailyLimit: limit,
        packageName: `VIP ${fmtDuration(durationDays, false, durationHours)} (Admin)`
      });
      const expStr = res.expiresAt ? new Date(res.expiresAt).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" }) : "-";
      await sendMessage(
        chatId,
        `✅ <b>VIP Custom Berhasil Diaktifkan!</b>\n\n• User: <code>${targetUid}</code>\n• Paket: <b>${esc(res.user.warranty_package_name)}</b>\n• Masa Aktif: <b>${expStr}</b>\n• Limit Harian: <b>${limit}x/hari</b>`
      );
      try {
        await sendMessage(targetUid, `🎉 <b>Selamat! Akun VIP Anda telah diaktifkan oleh Admin.</b>\n\n📦 Paket: <b>${esc(res.user.warranty_package_name)}</b>\n⏳ Masa Aktif: <b>${expStr}</b>\n🔄 Limit Harian: <b>${limit}x/hari</b>`);
      } catch {}
      await renderVipUserDetail(chatId, null, targetUid);
    } catch (e) {
      await sendMessage(chatId, `❌ Gagal aktivasi VIP: ${esc(e.message)}`);
    }
    return true;
  }

  return false;
}

// ─── PHOTO HANDLER (FOR WORKFLOW PHOTO & BROADCAST) ───────────────────────────

async function handlePhotoMessage(message) {
  const chatId = message.chat?.id;
  const from = message.from;
  if (!chatId || !isAdmin(from?.id)) return;

  const userId = String(from.id);
  const wizard = await getAdminWizard(userId);
  const photos = message.photo || [];
  const best = photos[photos.length - 1];
  if (!best?.file_id) return;

  // Broadcast foto preview
  if (wizard && wizard.action === "bcast_wait_photo") {
    const userIds = await getAllUserIds();
    const caption = message.caption || "";
    await setAdminWizard(userId, {
      action: "bcast_confirm",
      type: "photo",
      fileId: best.file_id,
      caption
    });

    const previewCaption = (caption ? `${caption}\n\n` : "") +
      `━━━━━━━━━━━━━━━━━━\n📢 <b>Pratinjau Broadcast Gambar</b>\n🎯 Target penerima: <b>${userIds.length} pengguna</b>\n\nApakah Anda yakin ingin mengirim siaran gambar ini sekarang?`;

    await botApi("sendPhoto", {
      chat_id: chatId,
      photo: best.file_id,
      caption: previewCaption,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 Kirim Sekarang", callback_data: "bcast_send_now" }],
          [{ text: "❌ Batal", callback_data: "admin_broadcast" }]
        ]
      }
    });
    return;
  }

  // Workflow Photo rotator
  try {
    const newCount = await addWorkflowPhoto(`tgfile:${best.file_id}`);
    await clearAdminWizard(userId);
    await sendMessage(
      chatId,
      `✅ Foto tersimpan sebagai urutan <b>${newCount}</b>. Foto ini akan dikirimkan ke bot tujuan setiap kali konfirmasi Working selesai.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🖼️ Lihat Koleksi Foto", callback_data: "workflow_show_photos" }],
            [{ text: "🔙 Kembali ke Admin", callback_data: "admin_back" }]
          ]
        }
      }
    );
  } catch (err) {
    await sendMessage(chatId, `❌ Gagal menyimpan foto: <code>${esc(err.message)}</code>`);
  }
}

// ─── MESSAGE ROUTER ───────────────────────────────────────────────────────────

async function handleMessage(message) {
  const chatId = message.chat?.id;
  const from = message.from;
  if (!chatId) return;

  // Background registration
  waitUntil(
    upsertUser(from).catch((err) => {
      console.error("upsertUser error:", err.message);
    })
  );

  // If photo received
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    await handlePhotoMessage(message);
    return;
  }

  const rawText = typeof message.text === "string" ? message.text.trim() : "";
  if (!rawText) return;

  // 1. Process Admin text wizard first if active
  if (isAdmin(from?.id)) {
    const handled = await handleAdminTextWizard(chatId, from, rawText);
    if (handled) return;
  }

  // 2. Commands
  if (/^\/start(?:@\w+)?$/i.test(rawText)) {
    await sendStartMenu(chatId, from);
    return;
  }

  if (/^\/cek(?:@\w+)?$/i.test(rawText)) {
    await handleCek(chatId, from);
    return;
  }

  if (/^\/paket(?:@\w+)?$/i.test(rawText) || /^\/beli(?:@\w+)?$/i.test(rawText)) {
    await handlePaket(chatId);
    return;
  }

  if (/^\/redeem(?:@\w+)?(?:\s+(.*))?$/i.test(rawText)) {
    const match = rawText.match(/^\/redeem(?:@\w+)?(?:\s+(.*))?$/i);
    await handleRedeemCommand(chatId, from, match?.[1]);
    return;
  }

  if (/^\/(?:ambil|generate)(?:@\w+)?(?:\s+(sama|baru))?$/i.test(rawText)) {
    const match = rawText.match(/^\/(?:ambil|generate)(?:@\w+)?(?:\s+(sama|baru))?$/i);
    await handleAmbilToken(chatId, from, match?.[1]?.toLowerCase() || null);
    return;
  }

  if (/^\/help(?:@\w+)?$/i.test(rawText) || /^\/bantuan(?:@\w+)?$/i.test(rawText)) {
    await handleHelp(chatId);
    return;
  }

  // Admin Direct Commands
  if (isAdmin(from?.id)) {
    if (/^\/admin(?:@\w+)?$/i.test(rawText)) {
      await renderAdminDashboard(chatId);
      return;
    }

    if (/^\/(?:daftartvip|listvip|vip)(?:@\w+)?$/i.test(rawText)) {
      await renderVipUsersMenu(chatId, null, 1, "all");
      return;
    }

    if (/^\/aktifkanvip(?:\s+(.+))?$/i.test(rawText)) {
      const match = rawText.match(/^\/aktifkanvip(?:\s+(.+))?$/i);
      const arg = match?.[1]?.trim();
      if (!arg) {
        await setAdminWizard(from.id, { action: "vip_act_target" });
        await sendMessage(
          chatId,
          "⚡ Masukkan <b>Telegram User ID</b> atau <b>@username</b> pengguna yang ingin diaktifkan VIP:\n\n/batal untuk membatalkan."
        );
        return;
      }

      const parts = arg.split(/\s+/);
      const targetQuery = parts[0];
      const durationQuery = parts.slice(1).join(" ") || "30";

      const user = await getUserByIdOrUsername(targetQuery);
      const targetUid = user?.telegram_user_id || targetQuery.replace(/[^\d]/g, "");

      if (!targetUid) {
        await sendMessage(chatId, `❌ User <code>${esc(targetQuery)}</code> belum terdaftar di sistem. Masukkan Telegram User ID (angka).`);
        return;
      }

      const lowerDur = durationQuery.toLowerCase();
      const isLifetime = ["lifetime", "selamanya"].includes(lowerDur);
      let days = parseInt(durationQuery, 10);
      if (isNaN(days) && !isLifetime) days = 30;

      try {
        const res = await activateUserVip({
          userId: targetUid,
          durationDays: isLifetime ? 0 : days,
          lifetime: isLifetime,
          packageName: isLifetime ? "VIP Lifetime (Admin)" : `VIP ${days} Hari (Admin)`
        });
        const expStr = res.expiresAt ? new Date(res.expiresAt).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" }) : "Selamanya ♾️";
        await sendMessage(
          chatId,
          `✅ <b>VIP Berhasil Diaktifkan!</b>\n\n• User ID: <code>${targetUid}</code>\n• Paket: <b>${esc(res.user.warranty_package_name)}</b>\n• Masa Aktif: <b>${expStr}</b>\n• Limit Harian: <b>${res.user.warranty_daily_limit}x/hari</b>`
        );
        try {
          await sendMessage(targetUid, `🎉 <b>Selamat! Akun VIP Anda telah diaktifkan oleh Admin.</b>\n\n📦 Paket: <b>${esc(res.user.warranty_package_name)}</b>\n⏳ Masa Aktif: <b>${expStr}</b>\n🔄 Limit Harian: <b>${res.user.warranty_daily_limit}x/hari</b>`);
        } catch {}
      } catch (e) {
        await sendMessage(chatId, `❌ Gagal aktivasi VIP: ${esc(e.message)}`);
      }
      return;
    }

    if (/^\/cabutvip\s+(.+)$/i.test(rawText)) {
      const match = rawText.match(/^\/cabutvip\s+(.+)$/i);
      const targetQuery = match[1].trim();
      const user = await getUserByIdOrUsername(targetQuery);
      const targetUid = user?.telegram_user_id || targetQuery.replace(/[^\d]/g, "");

      if (!targetUid) {
        await sendMessage(chatId, `❌ User <code>${esc(targetQuery)}</code> tidak ditemukan.`);
        return;
      }

      try {
        await revokeUserVip(targetUid);
        await sendMessage(chatId, `✅ Status VIP untuk user <code>${targetUid}</code> berhasil dicabut.`);
        try {
          await sendMessage(targetUid, "ℹ️ Status lisensi VIP Anda telah dinonaktifkan oleh Admin.");
        } catch {}
      } catch (e) {
        await sendMessage(chatId, `❌ Gagal: ${esc(e.message)}`);
      }
      return;
    }

    if (/^\/tambahhari\s+(\S+)(?:\s+(\d+))?$/i.test(rawText)) {
      const match = rawText.match(/^\/tambahhari\s+(\S+)(?:\s+(\d+))?$/i);
      const targetQuery = match[1].trim();
      const days = parseInt(match[2] || "30", 10);
      const user = await getUserByIdOrUsername(targetQuery);
      const targetUid = user?.telegram_user_id || targetQuery.replace(/[^\d]/g, "");

      if (!targetUid) {
        await sendMessage(chatId, `❌ User <code>${esc(targetQuery)}</code> tidak ditemukan.`);
        return;
      }

      try {
        const res = await extendUserVip(targetUid, days);
        const expDate = res.expiresAt ? new Date(res.expiresAt).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" }) : "-";
        await sendMessage(chatId, `✅ Berhasil memperpanjang VIP user <code>${targetUid}</code> sebesar <b>+${days} hari</b>!\n⏳ Masa aktif baru: <b>${expDate}</b>`);
        try {
          await sendMessage(targetUid, `🎉 <b>Masa aktif VIP Anda telah diperpanjang oleh Admin!</b>\n\n➕ Tambahan durasi: <b>${days} Hari</b>\n⏳ Masa aktif baru: <b>${expDate}</b>`);
        } catch {}
      } catch (e) {
        await sendMessage(chatId, `❌ Gagal: ${esc(e.message)}`);
      }
      return;
    }

    if (/^\/foto_tambah$/i.test(rawText)) {
      await setAdminWizard(from.id, { action: "wait_workflow_photo" });
      await sendMessage(chatId, "📸 Kirim satu foto sekarang untuk menambahkan ke koleksi Working.");
      return;
    }

    if (/^\/foto$/i.test(rawText)) {
      const photos = await getWorkflowPhotos();
      if (!photos.length) {
        await sendMessage(chatId, "Belum ada foto tersimpan. Ketik /foto_tambah lalu kirim gambar.");
        return;
      }
      const lines = photos.map((p, i) => `${i + 1}. Foto ID: <code>${p}</code>`).join("\n");
      await sendMessage(chatId, `🖼️ <b>Foto Working (${photos.length})</b>\n\n${lines}\n\nHapus dengan perintah <code>/foto_hapus NOMOR</code>.`);
      return;
    }

    if (/^\/foto_hapus\s+(\d+)$/i.test(rawText)) {
      const match = rawText.match(/^\/foto_hapus\s+(\d+)$/i);
      const index = parseInt(match[1], 10) - 1;
      const ok = await removeWorkflowPhoto(index);
      if (ok) {
        await sendMessage(chatId, `✅ Foto nomor ${index + 1} berhasil dihapus.`);
      } else {
        await sendMessage(chatId, "❌ Nomor foto tidak ditemukan.");
      }
      return;
    }

    if (/^\/setnegara(?:\s+(.+))?$/i.test(rawText)) {
      const match = rawText.match(/^\/setnegara(?:\s+(.+))?$/i);
      const arg = match?.[1]?.trim();
      if (!arg) {
        return renderCountryPriorityMenu(chatId);
      }
      const list = [...new Set(arg.split(/[,;\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
      if (list.length > 0) {
        await setSetting("country_priority", list);
        const listStr = list.map((c, i) => `  <b>${i + 1}.</b> ${COUNTRY_NAMES[c] || c} (<code>${c}</code>)`).join("\n");
        await sendMessage(
          chatId,
          `✅ <b>Prioritas negara berhasil disimpan:</b>\n\n${listStr}\n\n<i>Bot akan mencari Prioritas 1 terlebih dahulu di semua halaman bot target. Jika stok habis atau tidak ada, otomatis pindah ke Prioritas 2, 3, dst.</i>`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🌏 Atur Prioritas Lagi", callback_data: "admin_country_priority" }],
                [{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]
              ]
            }
          }
        );
      } else {
        await sendMessage(chatId, "❌ Format salah. Contoh: <code>/setnegara ID,MY,SG</code>");
      }
      return;
    }

    if (/^\/settarget_login\s+(.+)$/i.test(rawText) || /^\/setloginbot\s+(.+)$/i.test(rawText)) {
      const match = rawText.match(/^\/(?:settarget_login|setloginbot)\s+(.+)$/i);
      const target = match[1].trim().replace(/^@/, "");
      await setSetting("target_bot", target);
      await setSetting("target_bot_login", target);
      await addTargetBot({ username: target, type: "login" }).catch(() => {});
      await sendMessage(chatId, `✅ Bot target <b>Ambil Link Login</b> berhasil disimpan: <b>@${esc(target)}</b>`);
      return;
    }

    if (/^\/settarget_cookie\s+(.+)$/i.test(rawText) || /^\/setcookiebot\s+(.+)$/i.test(rawText)) {
      const match = rawText.match(/^\/(?:settarget_cookie|setcookiebot)\s+(.+)$/i);
      const target = match[1].trim().replace(/^@/, "");
      await setSetting("target_bot_cookie", target);
      await addTargetBot({ username: target, type: "cookie" }).catch(() => {});
      await sendMessage(chatId, `✅ Bot target <b>Generate Cookies</b> berhasil disimpan: <b>@${esc(target)}</b>`);
      return;
    }

    if (/^\/settarget\s+(.+)$/i.test(rawText)) {
      const match = rawText.match(/^\/settarget\s+(.+)$/i);
      const target = match[1].trim().replace(/^@/, "");
      await setSetting("target_bot", target);
      await setSetting("target_bot_login", target);
      await addTargetBot({ username: target, type: "login" }).catch(() => {});
      await sendMessage(
        chatId,
        `✅ Bot target <b>Ambil Link Login</b> diset ke: <b>@${esc(target)}</b>\n\n💡 <i>Catatan: Untuk mengatur Bot Generate Cookies, gunakan perintah:</i>\n<code>/settarget_cookie @username</code>`
      );
      return;
    }

    if (/^\/broadcast\s+([\s\S]+)$/i.test(rawText)) {
      const match = rawText.match(/^\/broadcast\s+([\s\S]+)$/i);
      const textBcast = match[1].trim();
      const userIds = await getAllUserIds();
      let sent = 0;
      for (const uid of userIds) {
        try {
          await sendMessage(uid, `📢 <b>PENGUMUMAN</b>\n\n${esc(textBcast)}`);
          sent++;
        } catch {}
      }
      await sendMessage(chatId, `✅ Broadcast berhasil dikirim ke <b>${sent}</b> pengguna.`);
      return;
    }

    if (/^\/target(?:@\w+)?$/i.test(rawText) || /^\/bot(?:@\w+)?$/i.test(rawText)) {
      await renderTargetBotsMenu(chatId, null, "login");
      return;
    }

    if (/^\/tambahbot_login\s+(.+)$/i.test(rawText)) {
      const match = rawText.match(/^\/tambahbot_login\s+(.+)$/i);
      const clean = match[1].replace(/^@/, "").trim();
      try {
        const newBot = await addTargetBot({ username: clean, type: "login" });
        await sendMessage(chatId, `✅ <b>Bot Ambil Link Login @${esc(newBot.username)} berhasil ditambahkan!</b> (Prioritas #${newBot.priority})`);
      } catch (e) {
        await sendMessage(chatId, `❌ Gagal: ${esc(e.message)}`);
      }
      return;
    }

    if (/^\/tambahbot_cookie\s+(.+)$/i.test(rawText)) {
      const match = rawText.match(/^\/tambahbot_cookie\s+(.+)$/i);
      const clean = match[1].replace(/^@/, "").trim();
      try {
        const newBot = await addTargetBot({ username: clean, type: "cookie" });
        await sendMessage(chatId, `✅ <b>Bot Generate Cookies @${esc(newBot.username)} berhasil ditambahkan!</b> (Prioritas #${newBot.priority})`);
      } catch (e) {
        await sendMessage(chatId, `❌ Gagal: ${esc(e.message)}`);
      }
      return;
    }

    if (/^\/tambahbot\s+(.+)$/i.test(rawText)) {
      const match = rawText.match(/^\/tambahbot\s+(.+)$/i);
      const clean = match[1].replace(/^@/, "").trim();
      try {
        const newBot = await addTargetBot({ username: clean, type: "login" });
        await sendMessage(
          chatId,
          `✅ <b>Bot Ambil Link Login @${esc(newBot.username)} berhasil ditambahkan!</b>\n\nPrioritas Failover: <b>#${newBot.priority}</b>\n\n💡 <i>Untuk menambah Bot Generate Cookies, gunakan:</i> <code>/tambahbot_cookie @username</code>`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🎥 Rekam Alur Bot Ini", callback_data: `bot_rec_start:${newBot.id}` }],
                [{ text: "🤖 Kelola Daftar Bot", callback_data: "admin_bots:login" }]
              ]
            }
          }
        );
      } catch (e) {
        await sendMessage(chatId, `❌ Gagal: ${esc(e.message)}`);
      }
      return;
    }

    if (/^\/hapusbot\s+(.+)$/i.test(rawText)) {
      const match = rawText.match(/^\/hapusbot\s+(.+)$/i);
      const clean = match[1].replace(/^@/, "").trim();
      try {
        await deleteTargetBot(clean);
        await sendMessage(chatId, `✅ Bot target @${esc(clean)} berhasil dihapus.`);
      } catch (e) {
        await sendMessage(chatId, `❌ Gagal: ${esc(e.message)}`);
      }
      return;
    }

    if (/^\/rekam(?:@\w+)?$/i.test(rawText)) {
      const accounts = await getBridgeAccounts();
      const activeAcc = accounts.find((a) => a.enabled !== false && a.sessionString);
      if (!activeAcc) {
        await sendMessage(
          chatId,
          "❌ <b>Belum ada akun bridge aktif.</b>\n\nTambahkan akun bridge di menu /admin → Telegram Bridge terlebih dahulu."
        );
        return;
      }
      const targetBots = await getTargetBots();
      const keyboard = targetBots.map((b) => [
        { text: `🎥 Rekam @${b.username} ${b.priority === 1 ? "⭐" : ""}`, callback_data: `bot_rec_start:${b.id}` }
      ]);
      keyboard.push([{ text: "➕ Masukkan & Rekam Bot Baru", callback_data: "rec_target:new" }]);
      keyboard.push([{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]);

      await sendMessage(
        chatId,
        "🎥 <b>Rekam Alur Interaktif Bot Bridge</b>\n\nPilih bot target yang ingin direkam alurnya:",
        { reply_markup: { inline_keyboard: keyboard } }
      );
      return;
    }

    if (/^\/alur(?:@\w+)?$/i.test(rawText)) {
      const targetBots = await getTargetBots();
      const allWorkflows = await getAllRecordedWorkflows();

      const sections = [];
      for (const b of targetBots) {
        const wf = allWorkflows[b.username.toLowerCase()];
        if (wf?.steps?.length) {
          sections.push(
            `• <b>@${esc(b.username)}</b> ${b.priority === 1 ? "⭐" : ""}: ✅ <b>${wf.steps.length} langkah terekam</b>`
          );
        } else {
          sections.push(
            `• <b>@${esc(b.username)}</b> ${b.priority === 1 ? "⭐" : ""}: ⚠️ Alur default`
          );
        }
      }

      const keyboard = targetBots.map((b) => [
        { text: `📋 Rincian Alur @${b.username}`, callback_data: `bot_wf_view:${b.id}` }
      ]);
      keyboard.push([{ text: "🎥 Rekam Alur Baru", callback_data: "bridge_record_start" }]);
      keyboard.push([{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]);

      await sendMessage(
        chatId,
        `📋 <b>Status Profil Alur Bot Target:</b>\n\n${sections.join("\n")}`,
        { reply_markup: { inline_keyboard: keyboard } }
      );
      return;
    }
  }

  // Treat any other raw text as cookies or custom input
  const payload = normalizeRelayText(rawText);
  if (payload.length > maxRelayChars()) {
    await sendMessage(chatId, `❌ Teks terlalu panjang (${payload.length} karakter). Maksimal ${maxRelayChars()} karakter.`);
    return;
  }

  const isAdminUser = isAdmin(from?.id);
  const warranty = await checkUserWarranty(from?.id);
  const requireWarranty = await getSetting("require_warranty", true);

  if (!isAdminUser && requireWarranty && !warranty.hasActiveWarranty) {
    await sendMessage(
      chatId,
      [
        "👑 <b>Akses Dibatasi — Belum Berlisensi VIP</b>",
        "",
        "Status akun Anda saat ini <b>belum memiliki lisensi VIP aktif</b>.",
        "Untuk dapat memproses cookies atau generate link Netflix, silakan beli paket lisensi atau tukarkan voucher terlebih dahulu.",
        "",
        "Ketik /paket untuk melihat pilihan paket lisensi atau <code>/redeem KODE</code> untuk aktivasi."
      ].join("\n"),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "👑 Beli Lisensi VIP", callback_data: "paket" }],
            [{ text: "🎟️ Redeem Voucher", callback_data: "redeem_info" }]
          ]
        }
      }
    );
    return;
  }

  if (!isAdminUser && requireWarranty && warranty.remainingToday <= 0) {
    await sendMessage(
      chatId,
      [
        "⚠️ <b>Batas Harian Tercapai</b>",
        "",
        `Kuota klaim harian Anda hari ini sudah habis (Maksimal <b>${warranty.dailyLimit}x</b> per hari).`,
        "Kuota akan direset kembali pada pukul 00:00 WIB."
      ].join("\n")
    );
    return;
  }

  const progress = await sendMessage(
    chatId,
    "⏳ <b>Cookies diterima.</b>\n\nSedang memproses dan generate NETFLIX Token link untuk Anda..."
  );

  const job = await enqueueJob({
    telegramUserId: from?.id,
    chatId,
    inputType: "text",
    payload,
    progressMessageId: progress.message_id,
    debugMode: false
  });

  waitUntil(
    kickBridgeWorker().catch((error) => {
      console.error("kickBridgeWorker failed:", error);
    })
  );

  console.log(`Queued relay cookie job ${job.id}`);
}

// ─── CALLBACK QUERY ROUTER ────────────────────────────────────────────────────

async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const data = callbackQuery.data;
  const from = callbackQuery.from;

  if (!chatId) return;

  waitUntil(
    botApi("answerCallbackQuery", {
      callback_query_id: callbackQuery.id
    }).catch(() => {})
  );

  // User actions
  if (data === "start") return sendStartMenu(chatId, from);
  if (data === "ambil" || data === "generate_cookie") return handleAmbilToken(chatId, from);
  if (data === "ambil_akun_sama") return handleAmbilToken(chatId, from, "sama");
  if (data === "ambil_akun_baru") return handleAmbilToken(chatId, from, "baru");
  if (data === "cek") return handleCek(chatId, from);
  if (data === "paket") return handlePaket(chatId);
  if (data === "redeem_info") return handleRedeemCommand(chatId, from, "");
  if (data === "bantuan") return handleHelp(chatId);

  // Admin actions
  if (!isAdmin(from?.id)) return;

  if (data === "admin_back") return renderAdminDashboard(chatId, messageId);

  // VIP Management Callbacks
  if (data.startsWith("admin_vip_users:")) {
    const parts = data.split(":");
    const page = parseInt(parts[1], 10) || 1;
    const filter = parts[2] || "all";
    return renderVipUsersMenu(chatId, messageId, page, filter);
  }

  if (data.startsWith("admin_vip_detail:")) {
    const uid = data.split(":")[1];
    return renderVipUserDetail(chatId, messageId, uid);
  }

  if (data === "admin_vip_act_start") {
    await setAdminWizard(from.id, { action: "vip_act_target" });
    await sendMessage(
      chatId,
      [
        "⚡ <b>Aktivasi VIP Pengguna Langsung</b>",
        "",
        "Masukkan <b>Telegram User ID</b> (angka) atau <b>@username</b> pengguna yang ingin diaktifkan VIP:",
        "Contoh: <code>123456789</code> atau <code>@username</code>",
        "",
        "/batal untuk membatalkan."
      ].join("\n")
    );
    return;
  }

  if (data === "admin_vip_search") {
    await setAdminWizard(from.id, { action: "vip_search_keyword" });
    await sendMessage(
      chatId,
      [
        "🔍 <b>Pencarian Pengguna VIP</b>",
        "",
        "Kirimkan <b>User ID</b> atau <b>@username</b> atau nama yang ingin dicari:",
        "",
        "/batal untuk membatalkan."
      ].join("\n")
    );
    return;
  }

  if (data.startsWith("admin_vip_ext:")) {
    const [, uid, daysStr] = data.split(":");
    const days = parseInt(daysStr, 10) || 30;
    try {
      const res = await extendUserVip(uid, days);
      const expDate = res.expiresAt ? new Date(res.expiresAt).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" }) : "-";
      await sendMessage(chatId, `✅ VIP user <code>${uid}</code> berhasil diperpanjang <b>+${days} hari</b>!\n⏳ Aktif s/d: <b>${expDate}</b>`);
      try {
        await sendMessage(uid, `🎉 <b>Masa aktif VIP Anda telah diperpanjang oleh Admin!</b>\n\n➕ Tambahan durasi: <b>${days} Hari</b>\n⏳ Masa aktif baru: <b>${expDate}</b>`);
      } catch {}
      return renderVipUserDetail(chatId, messageId, uid);
    } catch (e) {
      await sendMessage(chatId, `❌ Gagal memperpanjang VIP: ${esc(e.message)}`);
      return;
    }
  }

  if (data.startsWith("admin_vip_life:")) {
    const uid = data.split(":")[1];
    try {
      await activateUserVip({ userId: uid, lifetime: true, packageName: "VIP Lifetime (Admin)" });
      await sendMessage(chatId, `✅ User <code>${uid}</code> sekarang resmi berstatus <b>VIP Lifetime (Selamanya) ♾️</b>!`);
      try {
        await sendMessage(uid, "🎉 <b>Selamat! Akun Anda telah diubah menjadi VIP Lifetime (Selamanya ♾️) oleh Admin.</b>");
      } catch {}
      return renderVipUserDetail(chatId, messageId, uid);
    } catch (e) {
      await sendMessage(chatId, `❌ Gagal mengubah ke lifetime: ${esc(e.message)}`);
      return;
    }
  }

  if (data.startsWith("admin_vip_revoke_ask:")) {
    const uid = data.split(":")[1];
    const textConfirm = `⚠️ <b>Konfirmasi Cabut VIP</b>\n\nApakah Anda yakin ingin mencabut status VIP untuk user <code>${esc(uid)}</code>?`;
    const kb = [
      [{ text: "🔴 Ya, Cabut VIP Sekarang", callback_data: `admin_vip_revoke_yes:${uid}` }],
      [{ text: "🔙 Batal", callback_data: `admin_vip_detail:${uid}` }]
    ];
    await editMessage(chatId, messageId, textConfirm, { reply_markup: { inline_keyboard: kb } });
    return;
  }

  if (data.startsWith("admin_vip_revoke_yes:")) {
    const uid = data.split(":")[1];
    try {
      await revokeUserVip(uid);
      await sendMessage(chatId, `✅ Status VIP untuk user <code>${uid}</code> berhasil dicabut.`);
      try {
        await sendMessage(uid, "ℹ️ Status lisensi VIP Anda telah dinonaktifkan oleh Admin.");
      } catch {}
      return renderVipUsersMenu(chatId, messageId, 1, "all");
    } catch (e) {
      await sendMessage(chatId, `❌ Gagal mencabut VIP: ${esc(e.message)}`);
      return;
    }
  }

  if (data.startsWith("admin_vip_change_pkg:")) {
    const uid = data.split(":")[1];
    return renderVipSelectPackageMenu(chatId, messageId, uid);
  }

  if (data.startsWith("vip_pick_pkg:")) {
    const [, uid, pkgId] = data.split(":");
    try {
      const res = await activateUserVip({ userId: uid, packageId: pkgId });
      const expStr = res.expiresAt ? new Date(res.expiresAt).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" }) : "Selamanya ♾️";
      await sendMessage(
        chatId,
        `✅ <b>VIP Berhasil Diaktifkan!</b>\n\n• User: <code>${uid}</code>\n• Paket: <b>${esc(res.user.warranty_package_name)}</b>\n• Masa Aktif: <b>${expStr}</b>\n• Limit Harian: <b>${res.user.warranty_daily_limit}x/hari</b>`
      );
      try {
        await sendMessage(uid, `🎉 <b>Selamat! Akun Anda telah diaktifkan menjadi VIP oleh Admin.</b>\n\n📦 Paket: <b>${esc(res.user.warranty_package_name)}</b>\n⏳ Masa Aktif: <b>${expStr}</b>\n🔄 Limit Harian: <b>${res.user.warranty_daily_limit}x/hari</b>`);
      } catch {}
      return renderVipUserDetail(chatId, messageId, uid);
    } catch (e) {
      await sendMessage(chatId, `❌ Gagal aktivasi paket: ${esc(e.message)}`);
      return;
    }
  }

  if (data.startsWith("vip_pick_quick:")) {
    const [, uid, qType] = data.split(":");
    let days = 30;
    let lifetime = false;
    let name = "VIP 30 Hari";
    if (qType === "7d") { days = 7; name = "VIP 7 Hari"; }
    else if (qType === "30d") { days = 30; name = "VIP 30 Hari"; }
    else if (qType === "90d") { days = 90; name = "VIP 90 Hari"; }
    else if (qType === "lifetime") { lifetime = true; name = "VIP Lifetime"; }

    try {
      const res = await activateUserVip({ userId: uid, durationDays: days, lifetime, packageName: name });
      const expStr = res.expiresAt ? new Date(res.expiresAt).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" }) : "Selamanya ♾️";
      await sendMessage(
        chatId,
        `✅ <b>VIP Berhasil Diaktifkan!</b>\n\n• User: <code>${uid}</code>\n• Paket: <b>${name}</b>\n• Masa Aktif: <b>${expStr}</b>`
      );
      try {
        await sendMessage(uid, `🎉 <b>Selamat! Akun Anda telah diaktifkan menjadi VIP oleh Admin.</b>\n\n📦 Paket: <b>${name}</b>\n⏳ Masa Aktif: <b>${expStr}</b>`);
      } catch {}
      return renderVipUserDetail(chatId, messageId, uid);
    } catch (e) {
      await sendMessage(chatId, `❌ Gagal aktivasi VIP: ${esc(e.message)}`);
      return;
    }
  }

  if (data.startsWith("vip_pick_custom:")) {
    const uid = data.split(":")[1];
    await setAdminWizard(from.id, { action: "vip_act_custom_duration", targetUid: uid });
    await sendMessage(
      chatId,
      [
        `✏️ <b>Aktivasi VIP Custom untuk User <code>${uid}</code></b>`,
        "",
        "Masukkan durasi VIP:",
        "• Contoh dalam hari: <code>30 hari</code>, <code>14 hari</code>, atau angka <code>60</code>",
        "• Contoh dalam jam: <code>12 jam</code>, <code>24 jam</code>",
        "• Atau ketik <code>lifetime</code> untuk selamanya",
        "",
        "/batal untuk membatalkan."
      ].join("\n")
    );
    return;
  }
  if (data === "admin_bridge") return renderBridgeMenu(chatId, messageId);
  if (data === "admin_workflow") return renderWorkflowMenu(chatId, messageId);
  if (data === "admin_packages") return renderPackagesMenu(chatId, messageId);
  if (data === "admin_gen_voucher") return renderGenVoucherMenu(chatId, messageId);
  if (data === "admin_stats") return renderStatsMenu(chatId, messageId);
  if (data === "admin_broadcast") return renderBroadcastMenu(chatId, messageId);
  if (data === "admin_settings") return renderSettingsMenu(chatId, messageId);

  // Country Priority Sub-actions
  if (data === "admin_country_priority") {
    return renderCountryPriorityMenu(chatId, messageId);
  }

  if (data === "input_country_priority") {
    await setAdminWizard(from.id, { action: "set_country_priority" });
    await sendMessage(
      chatId,
      [
        "✏️ <b>Ketik Urutan Prioritas Negara</b>",
        "",
        "Kirimkan kode negara berurutan dipisahkan koma.",
        "Contoh: <code>ID, MY, SG, TH, VN</code>",
        "",
        "• Negara pertama = <b>Prioritas 1</b> (dicari pertama kali di semua halaman)",
        "• Negara kedua = <b>Prioritas 2</b> (cadangan jika Prioritas 1 kosong)",
        "• Negara ketiga = <b>Prioritas 3</b> (cadangan berikutnya), dst.",
        "",
        "Ketik /batal untuk membatalkan."
      ].join("\n")
    );
    return;
  }

  if (data.startsWith("preset_country:")) {
    const preset = data.replace("preset_country:", "").split(",");
    await setSetting("country_priority", preset);
    return renderCountryPriorityMenu(chatId, messageId);
  }

  // Bridge Sub-actions
  if (data === "bridge_set_username") {
    await setAdminWizard(from.id, { action: "set_bridge_username" });
    await sendMessage(chatId, "Kirim username bot target baru (contoh: <code>SSNetflixBot</code>). Gunakan /batal untuk membatalkan.");
    return;
  }

  if (data === "bridge_add_account") {
    await setAdminWizard(from.id, { action: "add_bridge_phone" });
    await sendMessage(
      chatId,
      "Masukkan nomor akun Telegram yang akan dijadikan bridge dalam format internasional:\nContoh: <code>+628123456789</code>\n\n/batal untuk membatalkan."
    );
    return;
  }

  if (data === "bridge_del_account") {
    const accounts = await getBridgeAccounts();
    if (!accounts.length) {
      await sendMessage(chatId, "Belum ada akun bridge untuk dihapus.");
      return;
    }
    const keyboard = accounts.map((acc) => [
      { text: `🗑️ ${acc.label || acc.phone}`, callback_data: `bridge_delete:${acc.id}` }
    ]);
    keyboard.push([{ text: "🔙 Kembali", callback_data: "admin_bridge" }]);
    await editMessage(chatId, messageId, "Pilih akun bridge yang ingin dihapus:", { reply_markup: { inline_keyboard: keyboard } });
    return;
  }

  if (data.startsWith("bridge_delete:")) {
    const accId = data.replace("bridge_delete:", "");
    await deleteBridgeAccount(accId);
    await editMessage(chatId, messageId, "✅ Akun bridge berhasil dihapus.", {
      reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]] }
    });
    return;
  }

  // Target Bots Management Sub-actions
  if (data === "admin_target_bots" || data === "admin_bots:login") {
    return renderTargetBotsMenu(chatId, messageId, "login");
  }
  if (data === "admin_bots:cookie") {
    return renderTargetBotsMenu(chatId, messageId, "cookie");
  }

  if (data.startsWith("bot_add_start")) {
    const type = data.includes(":") ? data.split(":")[1] : "login";
    await setAdminWizard(from.id, { action: "add_target_bot_username", botType: type });
    const isLogin = type === "login";
    await sendMessage(
      chatId,
      `🤖 Masukkan <b>username ${isLogin ? "Bot Ambil Link Login" : "Bot Generate Cookies"} baru</b> yang ingin ditambahkan (contoh: <code>${isLogin ? "SSNetflixBot" : "cookiesnetflixskystorebot"}</code>):\n\n/batal untuk membatalkan.`
    );
    return;
  }

  if (data.startsWith("bot_detail:")) {
    const botId = data.replace("bot_detail:", "");
    return renderTargetBotDetail(chatId, messageId, botId);
  }

  if (data.startsWith("bot_set_primary:")) {
    const botId = data.replace("bot_set_primary:", "");
    await setPrimaryTargetBot(botId);
    return renderTargetBotDetail(chatId, messageId, botId);
  }

  if (data.startsWith("bot_toggle:")) {
    const botId = data.replace("bot_toggle:", "");
    const bot = await getTargetBot(botId);
    if (bot) {
      await updateTargetBot(botId, { enabled: !bot.enabled });
    }
    return renderTargetBotDetail(chatId, messageId, botId);
  }

  if (data.startsWith("bot_del:")) {
    const botId = data.replace("bot_del:", "");
    const bot = await getTargetBot(botId);
    const botType = bot?.type || "login";
    await deleteTargetBot(botId);
    await editMessage(
      chatId,
      messageId,
      `✅ Bot target <b>@${esc(bot?.username || botId)}</b> berhasil dihapus.`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Kembali ke Daftar Bot", callback_data: `admin_bots:${botType}` }]]
        }
      }
    );
    return;
  }

  if (data.startsWith("bot_rec_start:")) {
    const botId = data.replace("bot_rec_start:", "");
    const bot = await getTargetBot(botId);
    if (!bot) {
      await sendMessage(chatId, "❌ Bot target tidak ditemukan.");
      return;
    }
    const accounts = await getBridgeAccounts();
    const activeAcc = accounts.find((a) => a.enabled !== false && a.sessionString);
    if (!activeAcc) {
      await sendMessage(
        chatId,
        "❌ <b>Belum ada akun bridge aktif.</b>\n\nTambahkan akun bridge di menu Telegram Bridge terlebih dahulu.",
        { reply_markup: { inline_keyboard: [[{ text: "➕ Tambah Akun", callback_data: "bridge_add_account" }]] } }
      );
      return;
    }
    await startRecordingSession(chatId, from.id, bot.username, activeAcc.sessionString);
    return;
  }

  if (data.startsWith("bot_wf_view:")) {
    const botId = data.replace("bot_wf_view:", "");
    const bot = await getTargetBot(botId);
    if (!bot) {
      await editMessage(chatId, messageId, "❌ Bot target tidak ditemukan.", {
        reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: "admin_target_bots" }]] }
      });
      return;
    }

    const recorded = await getRecordedWorkflow(bot.username);
    if (!recorded || !recorded.steps?.length) {
      await editMessage(
        chatId,
        messageId,
        `📋 <b>Status Alur @${esc(bot.username)}: Default</b>\n\nSaat ini belum ada alur kustom yang direkam untuk bot ini.\nBot menggunakan alur bawaan (/start → Generate Now).`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: `🎥 Rekam Alur @${bot.username}`, callback_data: `bot_rec_start:${bot.id}` }],
              [{ text: "🔙 Detail Bot", callback_data: `bot_detail:${bot.id}` }]
            ]
          }
        }
      );
      return;
    }

    const stepList = recorded.steps
      .map((s, i) => {
        if (s.type === "send_text") {
          return `${i + 1}. ✉️ Kirim: <code>${esc(s.text)}</code>`;
        }
        if (s.type === "click_button") {
          return `${i + 1}. 🔘 Klik: <b>${esc(s.buttonText)}</b> (baris ${s.row}, kolom ${s.col})`;
        }
        return `${i + 1}. Langkah: ${esc(JSON.stringify(s))}`;
      })
      .join("\n");

    const text = [
      `📋 <b>Alur Terekam — @${esc(bot.username)}</b>`,
      "",
      `Total langkah: <b>${recorded.steps.length}</b>`,
      `Direkam pada: ${fmtDateTime(recorded.recordedAt)}`,
      "",
      "<b>Daftar Langkah:</b>",
      stepList,
      "",
      "Alur di atas akan di-replay oleh worker bridge sebelum proses penarikan link cookies."
    ].join("\n");

    await editMessage(chatId, messageId, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎥 Rekam Ulang", callback_data: `bot_rec_start:${bot.id}` }],
          [{ text: "🗑️ Hapus Alur Bot Ini", callback_data: `bot_wf_del:${bot.username}` }],
          [{ text: "🔙 Kembali ke Detail Bot", callback_data: `bot_detail:${bot.id}` }]
        ]
      }
    });
    return;
  }

  if (data.startsWith("bot_wf_del:")) {
    const botUser = data.replace("bot_wf_del:", "");
    await deleteRecordedWorkflow(botUser);
    await editMessage(
      chatId,
      messageId,
      `✅ <b>Alur untuk @${esc(botUser)} berhasil dihapus.</b>\n\nBot kembali menggunakan alur bawaan default.`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Kembali ke Kelola Bot", callback_data: "admin_target_bots" }]]
        }
      }
    );
    return;
  }

  // Bridge Recording Sub-actions
  if (data === "bridge_record_start") {
    const accounts = await getBridgeAccounts();
    const activeAcc = accounts.find((a) => a.enabled !== false && a.sessionString);
    if (!activeAcc) {
      await sendMessage(
        chatId,
        "❌ <b>Belum ada akun bridge aktif.</b>\n\nUntuk merekam alur bot, Anda harus menambahkan minimal 1 akun Telegram bridge terlebih dahulu di menu Telegram Bridge.",
        { reply_markup: { inline_keyboard: [[{ text: "➕ Tambah Akun Bridge", callback_data: "bridge_add_account" }], [{ text: "🔙 Kembali", callback_data: "admin_bridge" }]] } }
      );
      return;
    }

    const targetBots = await getTargetBots();
    const keyboard = targetBots.map((b) => [
      { text: `🎥 Rekam @${b.username} ${b.priority === 1 ? "⭐" : ""}`, callback_data: `bot_rec_start:${b.id}` }
    ]);
    keyboard.push([{ text: "➕ Masukkan & Rekam Bot Baru", callback_data: "rec_target:new" }]);
    keyboard.push([{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]);

    const text = [
      "🎥 <b>Rekam Alur Interaktif Bot Bridge</b>",
      "",
      "Pilih bot tujuan yang ingin direkam alurnya:",
      "Anda dapat merekam alur untuk bot yang sudah terdaftar, atau menambahkan bot generator baru."
    ].join("\n");

    await editMessage(chatId, messageId, text, {
      reply_markup: { inline_keyboard: keyboard }
    });
    return;
  }

  if (data === "rec_target:current") {
    const accounts = await getBridgeAccounts();
    const activeAcc = accounts.find((a) => a.enabled !== false && a.sessionString);
    if (!activeAcc) {
      await sendMessage(chatId, "❌ Belum ada akun bridge aktif.");
      return;
    }
    const targetBots = await getTargetBots();
    const primaryBot = targetBots[0]?.username || (await getSetting("target_bot", "SSNetflixBot"));
    await startRecordingSession(chatId, from.id, primaryBot, activeAcc.sessionString);
    return;
  }

  if (data === "rec_target:new") {
    await setAdminWizard(from.id, { action: "record_target_username" });
    await sendMessage(
      chatId,
      "🤖 Masukkan <b>username bot tujuan baru</b> yang ingin direkam (contoh: <code>SSNetflixBot</code>):\n\n/batal untuk membatalkan."
    );
    return;
  }

  if (data === "bridge_record_finish") {
    try {
      const wf = await finishWorkflowRecording(from.id);
      await clearAdminWizard(from.id);
      await sendMessage(
        chatId,
        `✅ <b>Alur berhasil disimpan!</b>\n\n🎯 Target: <b>@${esc(wf.targetBot)}</b>\n📊 Jumlah langkah: <b>${wf.steps.length}</b>\n\nWorker bridge akan otomatis mereplay alur ini saat memproses request cookies ke @${esc(wf.targetBot)}.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📋 Lihat Alur Bot", callback_data: "bridge_workflow_view" }],
              [{ text: "🤖 Kelola Bot Target", callback_data: "admin_target_bots" }],
              [{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]
            ]
          }
        }
      );
    } catch (err) {
      await sendMessage(chatId, `❌ Gagal menyimpan alur: <code>${esc(err.message)}</code>`);
    }
    return;
  }

  if (data === "bridge_record_cancel") {
    await cancelWorkflowRecording(from.id);
    await clearAdminWizard(from.id);
    await sendMessage(chatId, "🛑 <b>Rekaman alur bridge dibatalkan.</b>", {
      reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]] }
    });
    return;
  }

  if (data.startsWith("rec_c:") || data.startsWith("rec_click:")) {
    const wizard = await getAdminWizard(from.id);
    if (!wizard || wizard.action !== "record_bridge_flow") {
      await sendMessage(chatId, "⚠️ Sesi rekam sudah selesai atau tidak aktif.");
      return;
    }

    let row = undefined;
    let col = undefined;
    let index = undefined;

    if (data.startsWith("rec_c:")) {
      const parts = data.replace("rec_c:", "").split("_").map(Number);
      row = parts[0];
      col = parts[1];
    } else {
      index = parseInt(data.replace("rec_click:", ""), 10);
    }

    try {
      const snapshot = await clickWorkflowRecordingButton({
        ownerId: from.id,
        index,
        row,
        col,
        sessionString: wizard.sessionString
      });
      const snapshotText = renderFlowSnapshot(snapshot);
      const keyboard = buildRecordingKeyboard(snapshot);

      if (messageId) {
        try {
          await editMessage(chatId, messageId, snapshotText, { reply_markup: { inline_keyboard: keyboard } });
          return;
        } catch {}
      }
      await sendMessage(chatId, snapshotText, { reply_markup: { inline_keyboard: keyboard } });
    } catch (err) {
      await sendMessage(chatId, `❌ Gagal klik tombol: <code>${esc(err.message)}</code>`);
    }
    return;
  }

  if (data === "bridge_workflow_view") {
    const targetBots = await getTargetBots();
    const allWorkflows = await getAllRecordedWorkflows();

    const sections = [];
    for (const b of targetBots) {
      const wf = allWorkflows[b.username.toLowerCase()];
      if (wf?.steps?.length) {
        sections.push(
          `• <b>@${esc(b.username)}</b> ${b.priority === 1 ? "⭐" : ""}: ✅ <b>${wf.steps.length} langkah terekam</b> (update: ${fmtDate(wf.recordedAt)})`
        );
      } else {
        sections.push(
          `• <b>@${esc(b.username)}</b> ${b.priority === 1 ? "⭐" : ""}: ⚠️ Alur default (/start → Generate Now)`
        );
      }
    }

    const text = [
      "📋 <b>Daftar Profil Alur Bot Target</b>",
      "",
      sections.join("\n\n") || "<i>Belum ada bot target terdaftar.</i>",
      "",
      "Pilih bot di bawah untuk melihat rincian langkah atau menghapus alur rekaman:"
    ].join("\n");

    const keyboard = targetBots.map((b) => [
      { text: `📋 Rincian Alur @${b.username}`, callback_data: `bot_wf_view:${b.id}` }
    ]);
    keyboard.push([{ text: "🎥 Rekam Alur Baru", callback_data: "bridge_record_start" }]);
    keyboard.push([{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]);

    await editMessage(chatId, messageId, text, {
      reply_markup: { inline_keyboard: keyboard }
    });
    return;
  }

  if (data === "bridge_workflow_delete") {
    await deleteRecordedWorkflow();
    await editMessage(
      chatId,
      messageId,
      "✅ <b>Alur kustom bot utama berhasil dihapus.</b>\n\nBot kembali menggunakan alur bawaan default.",
      {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]]
        }
      }
    );
    return;
  }

  // Workflow Sub-actions
  if (data === "workflow_add_photo") {
    await setAdminWizard(from.id, { action: "wait_workflow_photo" });
    await sendMessage(chatId, "📸 Kirim satu foto sekarang. Foto akan disimpan ke koleksi Working rotasi. /batal untuk membatalkan.");
    return;
  }

  if (data === "workflow_show_photos") {
    const photos = await getWorkflowPhotos();
    const lines = photos.length
      ? photos.map((p, i) => `${i + 1}. Foto ID: <code>${p}</code>`).join("\n")
      : "Belum ada foto.";
    const text = `🖼️ <b>Foto Working (${photos.length})</b>\n\n${lines}\n\nHapus foto dengan perintah <code>/foto_hapus NOMOR</code>.`;
    await editMessage(chatId, messageId, text, {
      reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: "admin_workflow" }]] }
    });
    return;
  }

  // Packages Sub-actions
  if (data === "pkg_add") {
    await setAdminWizard(from.id, { action: "add_pkg_name" });
    await sendMessage(chatId, "➕ <b>Tambah Paket Baru</b>\n\nLangkah 1/4: Masukkan <b>nama paket</b> (contoh: <code>Garansi 30 Hari</code>):\n\n/batal untuk membatalkan.");
    return;
  }

  if (data.startsWith("pkg_toggle:")) {
    const pkgId = data.replace("pkg_toggle:", "");
    const pkg = await getPackage(pkgId);
    if (pkg) {
      await updatePackage(pkgId, { enabled: !pkg.enabled });
    }
    return renderPackagesMenu(chatId, messageId);
  }

  if (data.startsWith("pkg_del:")) {
    const pkgId = data.replace("pkg_del:", "");
    await deletePackage(pkgId);
    return renderPackagesMenu(chatId, messageId);
  }

  // Voucher Sub-actions
  if (data === "gen_voucher_custom") {
    await setAdminWizard(from.id, { action: "gen_voucher_custom_name" });
    await sendMessage(
      chatId,
      "🎟️ <b>Buat Voucher Bebas (Langkah 1/4)</b>\n\nMasukkan <b>nama paket / keterangan voucher</b>:\nContoh: <code>Voucher Promo 30 Hari</code>\n\n/batal untuk membatalkan."
    );
    return;
  }

  if (data === "gen_voucher_from_pkgs") {
    const packages = await getPackages({ onlyEnabled: true });
    const keyboard = packages.map((p) => [
      { text: `📦 ${p.name}`, callback_data: `gen_voucher_pick:${p.id}` }
    ]);
    keyboard.push([{ text: "🔙 Kembali", callback_data: "admin_gen_voucher" }]);
    await editMessage(chatId, messageId, "🎟️ <b>Pilih Template Paket untuk Voucher:</b>", {
      reply_markup: { inline_keyboard: keyboard }
    });
    return;
  }

  if (data.startsWith("gen_voucher_pick:")) {
    const pkgId = data.replace("gen_voucher_pick:", "");
    const pkg = await getPackage(pkgId);
    if (!pkg) return;
    await setAdminWizard(from.id, {
      action: "gen_voucher_template_count",
      pkgId: pkg.id,
      pkgName: pkg.name
    });
    await sendMessage(
      chatId,
      `🎟️ <b>Generate Voucher — ${esc(pkg.name)}</b>\n\nMasukkan <b>jumlah voucher</b> yang ingin dibuat (1-50):\nContoh: <code>10</code>\n\n/batal untuk membatalkan.`
    );
    return;
  }

  // Broadcast Sub-actions
  if (data === "bcast_type_text") {
    await setAdminWizard(from.id, { action: "bcast_wait_text" });
    await sendMessage(chatId, "📝 Masukkan <b>pesan teks broadcast</b> yang ingin dikirimkan ke seluruh pengguna:\n\n/batal untuk membatalkan.");
    return;
  }

  if (data === "bcast_type_photo") {
    await setAdminWizard(from.id, { action: "bcast_wait_photo" });
    await sendMessage(chatId, "🖼️ Kirimkan <b>foto beserta caption</b> yang ingin disiarkan ke seluruh pengguna:\n\n/batal untuk membatalkan.");
    return;
  }

  if (data === "bcast_send_now") {
    const wizard = await getAdminWizard(from.id);
    if (wizard && wizard.action === "bcast_confirm") {
      await clearAdminWizard(from.id);
      const userIds = await getAllUserIds();
      let count = 0;
      for (const uid of userIds) {
        try {
          if (wizard.type === "photo" && wizard.fileId) {
            await botApi("sendPhoto", {
              chat_id: uid,
              photo: wizard.fileId,
              caption: wizard.caption || "",
              parse_mode: "HTML"
            });
          } else if (wizard.type === "text" && wizard.content) {
            await sendMessage(uid, `📢 <b>PENGUMUMAN</b>\n\n${esc(wizard.content)}`);
          }
          count++;
        } catch {}
      }
      await sendMessage(chatId, `✅ Siaran broadcast berhasil dikirim ke <b>${count}</b> pengguna.`, {
        reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali ke Admin", callback_data: "admin_back" }]] }
      });
    }
    return;
  }

  // Settings Sub-actions
  if (data === "toggle_req_warranty") {
    const cur = await getSetting("require_warranty", false);
    await setSetting("require_warranty", !cur);
    return renderSettingsMenu(chatId, messageId);
  }
}

async function processUpdate(update) {
  try {
    if (update?.message) await handleMessage(update.message);
    if (update?.callback_query) await handleCallbackQuery(update.callback_query);
  } catch (error) {
    console.error("processUpdate error:", error);
    try {
      const chatId = update?.message?.chat?.id || update?.callback_query?.message?.chat?.id;
      if (chatId) {
        await sendMessage(chatId, `💔 Terjadi error server: <code>${esc(error.message)}</code>`);
      }
    } catch {}
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      service: "telegram-webhook",
      engine: "iLink-Netflix-v5.3-Unified"
    });
  }

  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const actual = req.headers["x-telegram-bot-api-secret-token"];

  if (expected && actual !== expected) {
    return res.status(401).json({ ok: false, error: "invalid webhook secret" });
  }

  waitUntil(processUpdate(req.body || {}));
  return res.status(200).json({ ok: true });
}

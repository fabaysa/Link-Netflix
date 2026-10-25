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
  getRecordedWorkflow,
  deleteRecordedWorkflow,
  getAllRecordedWorkflows,
  getTargetBots,
  getActiveTargetBots,
  getTargetBot,
  addTargetBot,
  updateTargetBot,
  setPrimaryTargetBot,
  deleteTargetBot
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

const BOT_NAME = "iLink Netflix Bot";
const BOT_VERSION = "5.3";

const COUNTRY_NAMES = {
  ID: "Indonesia 🇮🇩",
  MY: "Malaysia 🇲🇾",
  SG: "Singapura 🇸🇬",
  US: "Amerika Serikat 🇺🇸",
  UK: "Inggris 🇬🇧",
  TH: "Thailand 🇹🇭",
  VN: "Vietnam 🇻🇳",
  PH: "Filipina 🇵🇭",
  JP: "Jepang 🇯🇵",
  KR: "Korea Selatan 🇰🇷"
};

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
  const targetBot = await getSetting("target_bot", "SSNetflixBot");
  const countryPriority = await getSetting("country_priority", ["ID", "MY", "SG"]);
  const photos = await getWorkflowPhotos();
  const bridgeAccounts = await getBridgeAccounts();
  const reqWarranty = await getSetting("require_warranty", false);

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
    `🌉 <b>Telegram bridge:</b> ${bridgeAccounts.length} akun terdaftar · @${targetBot}`,
    `🌏 <b>Prioritas negara:</b> ${countriesStr}`,
    `📸 <b>Foto Working:</b> ${photos.length} foto`,
    `🛡️ <b>Wajib Garansi:</b> ${reqWarranty ? "✅ Aktif" : "❌ Nonaktif"}`,
    "",
    "Silakan pilih menu di bawah:"
  ].join("\n");

  const replyMarkup = {
    inline_keyboard: [
      [{ text: "🌉 Telegram Bridge", callback_data: "admin_bridge" }],
      [{ text: "🌏 Negara & Foto Working", callback_data: "admin_workflow" }],
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
  const targetBots = await getTargetBots();
  const activeBots = await getActiveTargetBots();
  const allWorkflows = await getAllRecordedWorkflows();

  const accountLines = accounts.length
    ? accounts
        .map(
          (acc, i) =>
            `${i + 1}. <b>${esc(acc.label || acc.phone)}</b> — ${acc.enabled ? "✅ siap" : "❌ nonaktif"}`
        )
        .join("\n")
    : "Belum ada akun bridge.";

  const botLines = targetBots.length
    ? targetBots
        .map((b, i) => {
          const wf = allWorkflows[b.username.toLowerCase()];
          const wfTag = wf?.steps?.length ? `🎬 ${wf.steps.length} langkah` : "⚡ alur default";
          const star = b.priority === 1 ? "⭐ " : "";
          const status = b.enabled ? "✅" : "❌";
          return `${i + 1}. ${star}<b>@${esc(b.username)}</b> [${status} | ${wfTag}]`;
        })
        .join("\n")
    : "Belum ada bot target terdaftar.";

  const text = [
    `🌉 <b>Telegram Bridge v${BOT_VERSION}</b>`,
    "",
    `🤖 <b>Bot Target Generator (${targetBots.length} terdaftar · ${activeBots.length} aktif):</b>`,
    botLines,
    "",
    `Akun Bridge Siap: <b>${accounts.filter((a) => a.enabled !== false).length}/${accounts.length}</b>`,
    "<b>Daftar Akun Bridge:</b>",
    accountLines,
    "",
    "Sistem mendukung failover otomatis jika bot utama error/down."
  ].join("\n");

  const keyboard = [
    [
      { text: "🤖 Kelola Bot Target", callback_data: "admin_target_bots" },
      { text: "➕ Tambah Akun Bridge", callback_data: "bridge_add_account" }
    ],
    [
      { text: "🎥 Rekam Alur", callback_data: "bridge_record_start" },
      { text: "📋 Lihat Alur", callback_data: "bridge_workflow_view" }
    ],
    [
      { text: "🗑️ Hapus Akun Bridge", callback_data: "bridge_del_account" },
      { text: "🔄 Refresh Status", callback_data: "admin_bridge" }
    ],
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

async function renderTargetBotsMenu(chatId, messageId = null) {
  const targetBots = await getTargetBots();
  const allWorkflows = await getAllRecordedWorkflows();

  const botList = targetBots.map((b, i) => {
    const wf = allWorkflows[b.username.toLowerCase()];
    const wfStatus = wf?.steps?.length ? `✅ Terekam (${wf.steps.length} langkah)` : "⚠️ Default";
    const status = b.enabled ? "✅ Aktif" : "❌ Nonaktif";
    const star = b.priority === 1 ? "⭐ (Utama)" : `#${b.priority}`;
    return `<b>${i + 1}. @${esc(b.username)}</b> ${star}\n   • Status: ${status}\n   • Alur: ${wfStatus}`;
  }).join("\n\n");

  const text = [
    "🤖 <b>Kelola Bot Target Generator Netflix</b>",
    "",
    "Anda dapat menambahkan beberapa bot tujuan. Worker bridge akan menggunakan bot dalam urutan prioritas failover.",
    "",
    botList || "<i>Belum ada bot target.</i>",
    "",
    "Pilih bot di bawah untuk detail/atur atau tambah bot baru:"
  ].join("\n");

  const keyboard = [];
  keyboard.push([{ text: "➕ Tambah Bot Target Baru", callback_data: "bot_add_start" }]);

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

  keyboard.push([{ text: "🔙 Kembali ke Bridge", callback_data: "admin_bridge" }]);

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
      reply_markup: { inline_keyboard: [[{ text: "🔙 Kembali", callback_data: "admin_target_bots" }]] }
    });
    return;
  }

  const workflow = await getRecordedWorkflow(bot.username);
  const wfStatus = workflow?.steps?.length
    ? `✅ Terekam (${workflow.steps.length} langkah) · Direkam: ${fmtDateTime(workflow.recordedAt)}`
    : "⚠️ Menggunakan alur bawaan default";

  const text = [
    `🤖 <b>Detail Bot Target — @${esc(bot.username)}</b>`,
    "",
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
      { text: "🔙 Kembali ke Daftar Bot", callback_data: "admin_target_bots" }
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
    "<b>Prioritas negara:</b>",
    countriesStr,
    "",
    "Atur melalui perintah:",
    "<code>/setnegara ID,MY,SG</code>",
    "",
    `📸 <b>Foto tersimpan:</b> <b>${photos.length}</b> (tiap hasil Working mengirim tepat satu foto bergiliran)`,
    "",
    "Tambahkan foto dengan tombol di bawah atau langsung kirim gambar di chat pribadi bot."
  ].join("\n");

  const keyboard = [
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

  let statusText = "❌ <b>Tidak Ada / Kedaluwarsa</b>";
  let quotaText = `📊 Kuota Hari Ini: <b>${warranty.remainingToday} / ${warranty.dailyLimit}</b>`;

  if (warranty.hasActiveWarranty) {
    if (warranty.isLifetime) {
      statusText = `✅ <b>Aktif: ${esc(warranty.packageName || "Lifetime")}</b> (Selamanya ♾️)`;
    } else {
      statusText = `✅ <b>Aktif: ${esc(warranty.packageName || "Garansi")}</b> (s/d ${fmtDate(warranty.expiresAt)})`;
    }
  }

  const lines = [
    `👋 <b>Halo, ${firstName}!</b>`,
    "",
    `Selamat datang di 🍿 <b>${BOT_NAME}</b>`,
    "",
    "━━━━━━━━━━━━━━━━━━",
    `🛡️ <b>Status Garansi:</b> ${statusText}`,
    quotaText,
    "━━━━━━━━━━━━━━━━━━",
    "",
    "<b>Supported Devices:</b>",
    "• 🖥️ PC / Laptop",
    "• 📱 HP / Mobile (Android/iOS)",
    "• 📺 Smart TV",
    "",
    "💡 <i>Gunakan menu di bawah atau kirim cookies Netflix Anda langsung.</i>",
    "",
    "⚡ <i>Powered by iLink.in Store</i>"
  ];

  await sendMessage(chatId, lines.join("\n"), {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🍿 Ambil Token / Link", callback_data: "ambil" }],
        [
          { text: "🔍 Cek Garansi", callback_data: "cek" },
          { text: "📦 Daftar Paket", callback_data: "paket" }
        ],
        [
          { text: "🎟️ Redeem Voucher", callback_data: "redeem_info" },
          { text: "🌐 Akses Website", url: "https://link-netflix.vercel.app" }
        ],
        [{ text: "📖 Panduan / Bantuan", callback_data: "bantuan" }]
      ]
    }
  });
}

async function handleCek(chatId, from) {
  const warranty = await checkUserWarranty(from?.id);
  const firstName = esc(from?.first_name || "User");

  let statusBadge = "❌ Tidak Aktif / Belum Berlangganan";
  let expiryStr = "-";

  if (warranty.hasActiveWarranty) {
    statusBadge = "✅ Aktif";
    expiryStr = warranty.isLifetime ? "Selamanya (Lifetime ♾️)" : fmtDateTime(warranty.expiresAt);
  }

  const lines = [
    "🔍 <b>Rincian Garansi & Akun Anda</b>",
    "",
    `👤 <b>Nama:</b> ${firstName}`,
    `🆔 <b>Telegram ID:</b> <code>${from?.id}</code>`,
    `⚡ <b>Status:</b> ${statusBadge}`,
    `📦 <b>Paket:</b> ${esc(warranty.packageName || "-")}`,
    `⏳ <b>Masa Berlaku:</b> ${expiryStr}`,
    `📊 <b>Penggunaan Hari Ini:</b> ${warranty.claimsToday} dari ${warranty.dailyLimit} klaim`,
    `🎯 <b>Sisa Kuota Hari Ini:</b> ${warranty.remainingToday} klaim`,
    "",
    "⚡ <i>Powered by iLink.in Store</i>"
  ];

  await sendMessage(chatId, lines.join("\n"), {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🍿 Ambil Token Sekarang", callback_data: "ambil" }],
        [
          { text: "📦 Beli / Perpanjang", callback_data: "paket" },
          { text: "🎟️ Redeem Voucher", callback_data: "redeem_info" }
        ],
        [{ text: "🔙 Kembali ke Menu", callback_data: "start" }]
      ]
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

async function handleAmbilToken(chatId, from) {
  const requireWarranty = await getSetting("require_warranty", false);
  const warranty = await checkUserWarranty(from?.id);

  if (warranty.isBanned) {
    await sendMessage(chatId, "⛔ Akun Anda telah dinonaktifkan oleh administrator.");
    return;
  }

  if (requireWarranty && !warranty.hasActiveWarranty) {
    await sendMessage(
      chatId,
      [
        "⛔ <b>Akses Dibatasi</b>",
        "",
        "Anda belum memiliki paket garansi aktif untuk mengambil link token Netflix.",
        "Silakan beli paket atau tukarkan voucher garansi terlebih dahulu.",
        "",
        "Ketik /paket untuk melihat pilihan paket yang tersedia."
      ].join("\n"),
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📦 Beli Paket Garansi", callback_data: "paket" }],
            [{ text: "🎟️ Redeem Voucher", callback_data: "redeem_info" }]
          ]
        }
      }
    );
    return;
  }

  if (requireWarranty && warranty.remainingToday <= 0) {
    await sendMessage(
      chatId,
      [
        "⚠️ <b>Batas Harian Tercapai</b>",
        "",
        `Kuota klaim harian Anda hari ini sudah habis (Maksimal <b>${warranty.dailyLimit}x</b> per hari).`,
        "Kuota akan direset kembali pada pukul 00:00 WIB.",
        "",
        "Silakan kembali besok atau hubungi admin jika butuh limit tambahan."
      ].join("\n")
    );
    return;
  }

  const progress = await sendMessage(
    chatId,
    "⏳ <b>Permintaan diterima.</b>\n\nSedang memproses dan menghubungkan ke Netflix Generator..."
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
  const btns = rec?.buttons || [];

  for (let i = 0; i < btns.length && i < 16; i += 4) {
    const chunk = btns.slice(i, i + 4).map((b) => ({
      text: `🔘 ${b.index}`,
      callback_data: `rec_click:${b.index}`
    }));
    keyboard.push(chunk);
  }

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
    try {
      const newBot = await addTargetBot({ username: clean });
      await clearAdminWizard(userId);
      await sendMessage(
        chatId,
        `✅ <b>Bot target @${esc(newBot.username)} berhasil ditambahkan!</b>\n\nPrioritas Failover: <b>#${newBot.priority}</b>\n\nApakah Anda ingin langsung merekam alur interaktif untuk bot ini sekarang?`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🎥 Rekam Alur Bot Ini Sekarang", callback_data: `bot_rec_start:${newBot.id}` }],
              [{ text: "🤖 Kelola Daftar Bot", callback_data: "admin_target_bots" }],
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

  if (/^\/ambil(?:@\w+)?$/i.test(rawText)) {
    await handleAmbilToken(chatId, from);
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

    if (/^\/setnegara\s+(.+)$/i.test(rawText)) {
      const match = rawText.match(/^\/setnegara\s+(.+)$/i);
      const list = match[1].split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      await setSetting("country_priority", list);
      await sendMessage(chatId, `✅ Prioritas negara disimpan:\n${list.map((c, i) => `${i + 1}. ${COUNTRY_NAMES[c] || c}`).join("\n")}`);
      return;
    }

    if (/^\/settarget\s+(.+)$/i.test(rawText)) {
      const match = rawText.match(/^\/settarget\s+(.+)$/i);
      const target = match[1].trim().replace(/^@/, "");
      await setSetting("target_bot", target);
      await sendMessage(chatId, `✅ Bot target berhasil disimpan: <b>@${esc(target)}</b>`);
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
      await renderTargetBotsMenu(chatId);
      return;
    }

    if (/^\/tambahbot\s+(.+)$/i.test(rawText)) {
      const match = rawText.match(/^\/tambahbot\s+(.+)$/i);
      const clean = match[1].replace(/^@/, "").trim();
      try {
        const newBot = await addTargetBot({ username: clean });
        await sendMessage(
          chatId,
          `✅ <b>Bot target @${esc(newBot.username)} berhasil ditambahkan!</b>\n\nPrioritas Failover: <b>#${newBot.priority}</b>`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🎥 Rekam Alur Bot Ini", callback_data: `bot_rec_start:${newBot.id}` }],
                [{ text: "🤖 Kelola Daftar Bot", callback_data: "admin_target_bots" }]
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

  const warranty = await checkUserWarranty(from?.id);
  const requireWarranty = await getSetting("require_warranty", false);

  if (requireWarranty && !warranty.hasActiveWarranty) {
    await sendMessage(
      chatId,
      "⛔ Anda belum memiliki garansi aktif untuk memproses cookies. Ketik /paket untuk beli atau /redeem untuk aktivasi."
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
  if (data === "cek") return handleCek(chatId, from);
  if (data === "paket") return handlePaket(chatId);
  if (data === "redeem_info") return handleRedeemCommand(chatId, from, "");
  if (data === "bantuan") return handleHelp(chatId);

  // Admin actions
  if (!isAdmin(from?.id)) return;

  if (data === "admin_back") return renderAdminDashboard(chatId, messageId);
  if (data === "admin_bridge") return renderBridgeMenu(chatId, messageId);
  if (data === "admin_workflow") return renderWorkflowMenu(chatId, messageId);
  if (data === "admin_packages") return renderPackagesMenu(chatId, messageId);
  if (data === "admin_gen_voucher") return renderGenVoucherMenu(chatId, messageId);
  if (data === "admin_stats") return renderStatsMenu(chatId, messageId);
  if (data === "admin_broadcast") return renderBroadcastMenu(chatId, messageId);
  if (data === "admin_settings") return renderSettingsMenu(chatId, messageId);

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
  if (data === "admin_target_bots") {
    return renderTargetBotsMenu(chatId, messageId);
  }

  if (data === "bot_add_start") {
    await setAdminWizard(from.id, { action: "add_target_bot_username" });
    await sendMessage(
      chatId,
      "🤖 Masukkan <b>username bot target baru</b> yang ingin ditambahkan (contoh: <code>SSNetflixBot</code> atau <code>@NetflixGenBot</code>):\n\n/batal untuk membatalkan."
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
    await deleteTargetBot(botId);
    await editMessage(
      chatId,
      messageId,
      `✅ Bot target <b>@${esc(bot?.username || botId)}</b> berhasil dihapus.`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Kembali ke Daftar Bot", callback_data: "admin_target_bots" }]]
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

  if (data.startsWith("rec_click:")) {
    const idx = parseInt(data.replace("rec_click:", ""), 10);
    const wizard = await getAdminWizard(from.id);
    if (!wizard || wizard.action !== "record_bridge_flow") {
      await sendMessage(chatId, "⚠️ Sesi rekam sudah selesai atau tidak aktif.");
      return;
    }
    try {
      await sendMessage(chatId, `⏳ Mengklik tombol nomor ${idx}...`);
      const snapshot = await clickWorkflowRecordingButton({
        ownerId: from.id,
        index: idx,
        sessionString: wizard.sessionString
      });
      const snapshotText = renderFlowSnapshot(snapshot);
      const keyboard = buildRecordingKeyboard(snapshot);
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

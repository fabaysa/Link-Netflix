import { connectAuthorizedUser, getTeleprotoRuntime } from "./userbot.js";
import {
  getSetting,
  setSetting,
  saveRecordedWorkflow,
  getTargetBots,
  addTargetBot
} from "./store.js";
import {
  isCountryChoiceLabel,
  isCountryMenuMessage
} from "./country-button-finder.js";

function esc(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeText(text = "") {
  return String(text || "")
    .replace(/https?:\/\/[^\s]+nftoken[^\s]*/gi, "[TOKEN LOGIN REDACTED]")
    .replace(/\b\d{6}\b/g, "[KODE 6 DIGIT]")
    .trim();
}

export function renderFlowSnapshot(rec) {
  const targetBotName = esc(rec.targetBot || "Bot");
  const stepsCount = rec.steps?.length || 0;

  const recordedStepsList = (rec.steps || []).map((s, idx) => {
    if (s.type === "send_text") return `  ${idx + 1}. ✉️ Kirim: <code>${esc(s.text)}</code>`;
    if (s.type === "select_country_priority" || s.isCountrySelection) return `  ${idx + 1}. 🌏 Pilihan Negara (Prioritas Otomatis): <b>${esc(s.buttonText)}</b>`;
    if (s.type === "click_button") return `  ${idx + 1}. 🔘 Klik: <b>${esc(s.buttonText)}</b>`;
    return `  ${idx + 1}. Langkah: <code>${esc(JSON.stringify(s))}</code>`;
  }).join("\n");

  const targetMsg = sanitizeText(rec.latestMessageText || (rec.recentMessages || []).slice(-1)[0]?.text || "[Belum ada balasan]");

  const buttons = (rec.buttons || []).slice(0, 25);
  const buttonBadges = buttons.length
    ? buttons.map((b) => `• [ <b>${esc(b.text)}</b> ]`).join("\n")
    : "<i>Tidak ada tombol inline.</i>";

  const countryButtonsCount = (rec.buttons || []).filter((b) => isCountryChoiceLabel(b.text)).length;
  const isCountryMenu = countryButtonsCount >= 2 || (rec.recentMessages || []).some((m) => /select\s*a\s*country|pilih\s*negara|choose\s*country|available\s*countries/i.test(m.text));

  const countryNotice = isCountryMenu
    ? [
        "━━━━━━━━━━━━━━━━━━",
        "🌏 <b>TERDETEKSI MENU PILIHAN NEGARA!</b>",
        "<i>Worker bridge mendukung pemilihan cerdas <b>Prioritas Negara (1 ➔ 2 ➔ 3 dst)</b>:</i>",
        "• Negara Prioritas 1 dicari terlebih dahulu di seluruh halaman.",
        "• Jika stok habis atau tidak ada, otomatis berpindah ke Prioritas 2, lalu Prioritas 3, dst.",
        "• Klik tombol negara yang diinginkan atau langsung klik <b>⏹️ Simpan Alur</b>.",
        "━━━━━━━━━━━━━━━━━━",
        ""
      ].join("\n")
    : "";

  return [
    `🎥 <b>REKAM SELURUH ALUR BRIDGE (@${targetBotName})</b>`,
    `Total langkah terekam: <b>${stepsCount} langkah</b> (mulai dari /start)`,
    "",
    "📋 <b>Urutan Alur yang Sudah Terekam:</b>",
    recordedStepsList || "  <i>1. ✉️ Kirim /start</i>",
    "",
    countryNotice,
    "💬 <b>Pesan dari Bot Target:</b>",
    `<blockquote>${esc(targetMsg)}</blockquote>`,
    "",
    "🔘 <b>Tombol Terdeteksi (Klik tombol di bawah sama persis):</b>",
    buttonBadges,
    "",
    "━━━━━━━━━━━━━━━━━━",
    "💡 <b>PANDUAN:</b>",
    "• Klik tombol di bawah <b>sama persis</b> seperti menggunakan bot target secara langsung.",
    "• Atau ketik <code>/rekam_klik NOMOR</code> untuk klik via teks.",
    "• Ketik <code>/rekam_kirim TEKS</code> untuk kirim perintah (contoh: <code>/rekam_kirim /start</code>).",
    "• Klik <b>⏹️ Simpan Alur</b> (atau ketik <code>/rekam_selesai</code>) saat alur selesai.",
    "• Ketik <code>/batal</code> untuk membatalkan rekaman."
  ].filter(Boolean).join("\n");
}

function messageSignature(msg) {
  if (!msg) return "";
  const rows = Array.isArray(msg?.buttons) ? msg.buttons : [];
  const btns = rows
    .flatMap((row) => (Array.isArray(row) ? row : []).map((b) => `${b?.text || ""}|${b?.url || ""}`))
    .join("¦");
  return `${Number(msg?.id || 0)}|${String(msg?.message || msg?.text || "")}|${btns}`;
}

async function readRecentMessages(client, targetEntity, limit = 25) {
  const list = await client.getMessages(targetEntity, { limit });
  return [...(list || [])].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
}

async function waitForBotChange(client, targetEntity, beforeSignatures, beforeMaxId, maxWaitMs = 12000) {
  const stopAt = Date.now() + maxWaitMs;
  let changedAt = 0;
  let latest = await readRecentMessages(client, targetEntity);
  while (Date.now() < stopAt) {
    await sleep(500);
    latest = await readRecentMessages(client, targetEntity);
    const changed = latest.some((msg) => {
      if (msg.out) return false;
      const id = Number(msg.id || 0);
      return id > beforeMaxId || beforeSignatures.get(id) !== messageSignature(msg);
    });
    if (changed) {
      changedAt ||= Date.now();
      if (Date.now() - changedAt >= 800) return latest;
    }
  }
  return latest;
}

function extractButtonsAndMessagesFromList(messages) {
  const sorted = [...(messages || [])].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));

  const recentMessages = [];
  let latestKeyboardMsg = null;

  for (const m of sorted) {
    if (m.out) continue;
    const text = String(m.message || m.text || "").trim();
    recentMessages.push({
      id: Number(m.id || 0),
      text: sanitizeText(text)
    });

    if (Array.isArray(m.buttons) && m.buttons.length > 0) {
      latestKeyboardMsg = m;
    }
  }

  const buttons = [];
  const keyboardGrid = [];

  if (latestKeyboardMsg && Array.isArray(latestKeyboardMsg.buttons)) {
    latestKeyboardMsg.buttons.forEach((row, i) => {
      const rowButtons = [];
      (Array.isArray(row) ? row : []).forEach((btn, j) => {
        const item = {
          index: buttons.length + 1,
          row: i,
          column: j,
          messageId: Number(latestKeyboardMsg.id),
          text: String(btn?.text || `Tombol ${buttons.length + 1}`).trim(),
          url: btn?.url ? String(btn.url) : null
        };
        buttons.push(item);
        rowButtons.push(item);
      });
      if (rowButtons.length) keyboardGrid.push(rowButtons);
    });
  }

  const latestMessageText = latestKeyboardMsg
    ? sanitizeText(String(latestKeyboardMsg.message || latestKeyboardMsg.text || ""))
    : (recentMessages[recentMessages.length - 1]?.text || "");

  return {
    recentMessages,
    buttons,
    keyboardGrid,
    latestMessageText,
    latestKeyboardMsgId: latestKeyboardMsg ? Number(latestKeyboardMsg.id) : null
  };
}

export async function startWorkflowRecording({ ownerId, targetBot, sessionString = "" }) {
  const target = String(targetBot || "").trim().replace(/^@/, "");
  if (!target) throw new Error("Username bot target belum ditentukan.");

  const { client } = await connectAuthorizedUser(sessionString);
  try {
    const targetEntity = await client.getEntity(target);

    // Ambil pesan awal sebelum /start untuk tracking perubahan yang akurat
    const initialMessages = await readRecentMessages(client, targetEntity, 20);
    const before = new Map(initialMessages.map((m) => [Number(m.id || 0), messageSignature(m)]));
    const beforeMax = initialMessages.reduce((max, m) => Math.max(max, Number(m.id || 0)), 0);

    // Kirim /start ke bot target
    const sent = await client.sendMessage(targetEntity, { message: "/start" });

    // Tunggu sampai bot target merespons (pesan baru masuk)
    const messages = await waitForBotChange(
      client,
      targetEntity,
      before,
      Math.max(beforeMax, Number(sent?.id || 0)),
      12000
    );

    const { recentMessages, buttons, keyboardGrid, latestMessageText, latestKeyboardMsgId } =
      extractButtonsAndMessagesFromList(messages);

    const rec = {
      ownerId: String(ownerId),
      targetBot: target,
      startedAt: new Date().toISOString(),
      steps: [
        { type: "send_text", text: "/start", at: new Date().toISOString() }
      ],
      buttons,
      keyboardGrid,
      latestMessageText,
      recentMessages,
      latestKeyboardMsgId
    };

    await setSetting(`rec_session_${ownerId}`, rec);
    return rec;
  } finally {
    try {
      await client.disconnect();
    } catch {}
  }
}

export async function sendWorkflowRecordingText({ ownerId, text, sessionString = "" }) {
  const rec = await getSetting(`rec_session_${ownerId}`, null);
  if (!rec) throw new Error("Tidak ada sesi rekam yang sedang aktif. Mulai dari menu Akun Bridge.");

  const cleanText = String(text || "").trim();
  if (!cleanText) throw new Error("Pesan tidak boleh kosong.");

  const { client } = await connectAuthorizedUser(sessionString);
  try {
    const targetEntity = await client.getEntity(rec.targetBot);

    const initialMessages = await readRecentMessages(client, targetEntity, 20);
    const before = new Map(initialMessages.map((m) => [Number(m.id || 0), messageSignature(m)]));
    const beforeMax = initialMessages.reduce((max, m) => Math.max(max, Number(m.id || 0)), 0);

    const sent = await client.sendMessage(targetEntity, { message: cleanText });

    const messages = await waitForBotChange(
      client,
      targetEntity,
      before,
      Math.max(beforeMax, Number(sent?.id || 0)),
      12000
    );

    const { recentMessages, buttons, keyboardGrid, latestMessageText, latestKeyboardMsgId } =
      extractButtonsAndMessagesFromList(messages);

    rec.steps.push({
      type: "send_text",
      text: cleanText,
      at: new Date().toISOString()
    });
    rec.buttons = buttons;
    rec.keyboardGrid = keyboardGrid;
    rec.latestMessageText = latestMessageText;
    rec.recentMessages = recentMessages;
    rec.latestKeyboardMsgId = latestKeyboardMsgId;

    await setSetting(`rec_session_${ownerId}`, rec);
    return rec;
  } finally {
    try {
      await client.disconnect();
    } catch {}
  }
}

export async function clickWorkflowRecordingButton({ ownerId, index, row, col, sessionString = "" }) {
  const rec = await getSetting(`rec_session_${ownerId}`, null);
  if (!rec) throw new Error("Tidak ada sesi rekam yang sedang aktif. Mulai dari menu Akun Bridge.");

  let btn = null;
  if (row !== undefined && col !== undefined) {
    btn = (rec.buttons || []).find((b) => Number(b.row) === Number(row) && Number(b.column) === Number(col));
  }
  if (!btn && index !== undefined) {
    const btnIndex = Number.parseInt(index, 10);
    btn = (rec.buttons || []).find((b) => b.index === btnIndex);
  }

  if (!btn) {
    throw new Error(`Tombol tidak ditemukan. Periksa kembali tombol pada bot target.`);
  }

  const { client } = await connectAuthorizedUser(sessionString);
  try {
    const targetEntity = await client.getEntity(rec.targetBot);

    // Baca pesan sebelum klik untuk tracking perubahan yang akurat
    const initialMessages = await readRecentMessages(client, targetEntity, 20);
    const before = new Map(initialMessages.map((m) => [Number(m.id || 0), messageSignature(m)]));
    const beforeMax = initialMessages.reduce((max, m) => Math.max(max, Number(m.id || 0)), 0);

    // Cari pesan target yang memiliki tombol yang ingin diklik
    let targetMsg = initialMessages.find((m) => Number(m.id) === btn.messageId && Array.isArray(m.buttons));
    if (!targetMsg) {
      targetMsg = [...initialMessages].reverse().find((m) => !m.out && Array.isArray(m.buttons) && m.buttons.length > 0);
    }

    let clicked = false;
    if (targetMsg && typeof targetMsg.click === "function") {
      try {
        await targetMsg.click({ i: btn.row, j: btn.column });
        clicked = true;
      } catch (err) {
        console.warn(`[recorder] targetMsg.click failed: ${err.message}`);
      }
    }

    if (!clicked && targetMsg) {
      try {
        const { Api } = await getTeleprotoRuntime();
        const rawBtn = targetMsg?.buttons?.[btn.row]?.[btn.column];
        if (rawBtn?.data) {
          await client.invoke(
            new Api.messages.GetBotCallbackAnswer({
              peer: targetEntity,
              msgId: targetMsg.id,
              data: Buffer.from(rawBtn.data),
              timeout: 10
            })
          );
          clicked = true;
        }
      } catch (err) {
        console.warn(`[recorder] GetBotCallbackAnswer error: ${err.message}`);
      }
    }

    // TUNGGU SAMPAI BOT TARGET MERESPONS (baik kirim pesan baru atau edit pesan yang ada)
    const updatedMessages = await waitForBotChange(client, targetEntity, before, beforeMax, 12000);

    const { recentMessages, buttons, keyboardGrid, latestMessageText, latestKeyboardMsgId } =
      extractButtonsAndMessagesFromList(updatedMessages);

    const isCountry = isCountryChoiceLabel(btn.text);
    rec.steps.push({
      type: isCountry ? "select_country_priority" : "click_button",
      buttonText: btn.text,
      row: btn.row,
      col: btn.column,
      isCountrySelection: isCountry,
      at: new Date().toISOString()
    });

    rec.buttons = buttons;
    rec.keyboardGrid = keyboardGrid;
    rec.latestMessageText = latestMessageText;
    rec.recentMessages = recentMessages;
    rec.latestKeyboardMsgId = latestKeyboardMsgId;

    await setSetting(`rec_session_${ownerId}`, rec);
    return rec;
  } finally {
    try {
      await client.disconnect();
    } catch {}
  }
}

export async function finishWorkflowRecording(ownerId) {
  const rec = await getSetting(`rec_session_${ownerId}`, null);
  if (!rec) throw new Error("Tidak ada sesi rekam yang sedang aktif.");

  const workflowRecord = {
    targetBot: rec.targetBot,
    recordedAt: new Date().toISOString(),
    stepsCount: rec.steps?.length || 0,
    steps: rec.steps || []
  };

  // Simpan alur bridge untuk bot ini
  await saveRecordedWorkflow(workflowRecord, rec.targetBot);

  // Daftarkan ke daftar target_bots jika belum ada
  try {
    const bots = await getTargetBots();
    if (!bots.some((b) => b.username.toLowerCase() === rec.targetBot.toLowerCase())) {
      await addTargetBot({
        username: rec.targetBot,
        label: `@${rec.targetBot}`,
        enabled: true
      });
    }
  } catch {}

  // Bersihkan sesi rekam
  await setSetting(`rec_session_${ownerId}`, null);
  return workflowRecord;
}

export async function cancelWorkflowRecording(ownerId) {
  await setSetting(`rec_session_${ownerId}`, null);
  return true;
}

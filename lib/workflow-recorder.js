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
  const recordedStepsList = (rec.steps || []).map((s, idx) => {
    if (s.type === "send_text") return `  ${idx + 1}. ✉️ Kirim: <code>${esc(s.text)}</code>`;
    if (s.type === "select_country_priority" || s.isCountrySelection) return `  ${idx + 1}. 🌏 Pilihan Negara (Prioritas Otomatis): <b>${esc(s.buttonText)}</b>`;
    if (s.type === "click_button") return `  ${idx + 1}. 🔘 Klik: <b>${esc(s.buttonText)}</b>`;
    return `  ${idx + 1}. Langkah: <code>${esc(JSON.stringify(s))}</code>`;
  }).join("\n");

  const steps = (rec.recentMessages || []).slice(-3);
  const messageBlock = steps.length
    ? steps.map((s, i) => `${i + 1}. ${esc(sanitizeText(String(s.text || "[Pesan tanpa teks]")).slice(0, 350))}`).join("\n\n")
    : "<i>Belum ada balasan dari bot target.</i>";

  const buttons = (rec.buttons || []).slice(0, 20);
  const buttonBlock = buttons.length
    ? buttons.map((b) => `<b>${b.index}.</b> ${esc(b.text)}${b.url ? ` <i>(Link: ${esc(b.url.slice(0, 40))}...)</i>` : ""}`).join("\n")
    : "<i>Tidak ada tombol inline yang terdeteksi.</i>";

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
    `🎥 <b>REKAM SELURUH ALUR BRIDGE (@${esc(rec.targetBot)})</b>`,
    `Total langkah terekam: <b>${rec.steps?.length || 0} langkah</b> (mulai dari /start)`,
    "",
    "📋 <b>Urutan Alur yang Sudah Terekam:</b>",
    recordedStepsList || "  <i>1. ✉️ Kirim /start</i>",
    "",
    countryNotice,
    "🗒️ <b>Balasan Terakhir Bot Target:</b>",
    messageBlock,
    "",
    "🔘 <b>Daftar Tombol Tersedia (Klik untuk Lanjut):</b>",
    buttonBlock,
    "",
    "━━━━━━━━━━━━━━━━━━",
    "<b>Perintah Input:</b>",
    "• Ketik <code>/rekam_klik NOMOR</code> atau klik tombol nomor di bawah untuk klik tombol",
    "• Ketik <code>/rekam_kirim TEKS</code> untuk kirim perintah (contoh: <code>/rekam_kirim /start</code>)",
    "• Ketik <code>/rekam_selesai</code> atau klik <b>⏹️ Simpan Alur</b> saat alur selesai",
    "• Ketik <code>/batal</code> untuk membatalkan rekaman"
  ].filter(Boolean).join("\n");
}

async function extractButtonsAndMessages(client, targetEntity) {
  const list = await client.getMessages(targetEntity, { limit: 10 });
  const sorted = [...(list || [])].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));

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
  if (latestKeyboardMsg && Array.isArray(latestKeyboardMsg.buttons)) {
    latestKeyboardMsg.buttons.forEach((row, i) => {
      (Array.isArray(row) ? row : []).forEach((btn, j) => {
        buttons.push({
          index: buttons.length + 1,
          row: i,
          column: j,
          messageId: Number(latestKeyboardMsg.id),
          text: String(btn?.text || `Tombol ${buttons.length + 1}`).trim(),
          url: btn?.url ? String(btn.url) : null
        });
      });
    });
  }

  return { recentMessages, buttons, latestKeyboardMsgId: latestKeyboardMsg ? Number(latestKeyboardMsg.id) : null };
}

export async function startWorkflowRecording({ ownerId, targetBot, sessionString = "" }) {
  const target = String(targetBot || "").trim().replace(/^@/, "");
  if (!target) throw new Error("Username bot target belum ditentukan.");

  const { client } = await connectAuthorizedUser(sessionString);
  try {
    const targetEntity = await client.getEntity(target);

    // Kirim /start ke bot target
    await client.sendMessage(targetEntity, { message: "/start" });
    await sleep(2500);

    const { recentMessages, buttons, latestKeyboardMsgId } = await extractButtonsAndMessages(client, targetEntity);

    const rec = {
      ownerId: String(ownerId),
      targetBot: target,
      startedAt: new Date().toISOString(),
      steps: [
        { type: "send_text", text: "/start", at: new Date().toISOString() }
      ],
      buttons,
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
    await client.sendMessage(targetEntity, { message: cleanText });
    await sleep(2500);

    const { recentMessages, buttons, latestKeyboardMsgId } = await extractButtonsAndMessages(client, targetEntity);

    rec.steps.push({
      type: "send_text",
      text: cleanText,
      at: new Date().toISOString()
    });
    rec.buttons = buttons;
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

export async function clickWorkflowRecordingButton({ ownerId, index, sessionString = "" }) {
  const rec = await getSetting(`rec_session_${ownerId}`, null);
  if (!rec) throw new Error("Tidak ada sesi rekam yang sedang aktif. Mulai dari menu Akun Bridge.");

  const btnIndex = Number.parseInt(index, 10);
  const btn = (rec.buttons || []).find((b) => b.index === btnIndex);
  if (!btn) {
    throw new Error(`Nomor tombol ${index} tidak ditemukan. Periksa daftar tombol yang tersedia.`);
  }

  const { client } = await connectAuthorizedUser(sessionString);
  try {
    const targetEntity = await client.getEntity(rec.targetBot);
    const messages = await client.getMessages(targetEntity, { limit: 15 });
    const targetMsg = (messages || []).find((m) => Number(m.id) === btn.messageId && Array.isArray(m.buttons));

    if (targetMsg && typeof targetMsg.click === "function") {
      await targetMsg.click({ i: btn.row, j: btn.column });
    } else {
      // Fallback via callback answer
      const { Api } = await getTeleprotoRuntime();
      const rawBtn = targetMsg?.buttons?.[btn.row]?.[btn.column];
      if (rawBtn?.data) {
        await client.invoke(
          new Api.messages.GetBotCallbackAnswer({
            peer: targetEntity,
            msgId: btn.messageId,
            data: Buffer.from(rawBtn.data)
          })
        );
      }
    }

    await sleep(3000);

    const { recentMessages, buttons, latestKeyboardMsgId } = await extractButtonsAndMessages(client, targetEntity);

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

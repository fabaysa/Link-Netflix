import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  countryMatchesButton,
  findCountryButtonPosition,
  findNextButtonPosition,
  extractButtonStock
} from "./country-button-finder.js";
import {
  allowedNetflixUrl,
  mediaKind,
  isWorkingLabel,
  NetflixUrlParser
} from "./netflix-code-parser.js";
import { ensureDefaultVerificationPhoto } from "./verification-photo.js";
import { getSetting, getWorkflowPhotos } from "./store.js";

async function getVerificationPhotoFile() {
  try {
    const photos = await getWorkflowPhotos();
    if (Array.isArray(photos) && photos.length > 0) {
      const photoRef = String(photos[Math.floor(Math.random() * photos.length)] || "");
      if (photoRef.startsWith("tgfile:") && process.env.TELEGRAM_BOT_TOKEN) {
        const fileId = photoRef.replace("tgfile:", "");
        const fileRes = await fetch(
          `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
        );
        const fileJson = await fileRes.json();
        if (fileJson.ok && fileJson.result?.file_path) {
          const downloadUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileJson.result.file_path}`;
          const dlRes = await fetch(downloadUrl);
          if (dlRes.ok) {
            const buf = Buffer.from(await dlRes.arrayBuffer());
            const tmpPath = path.join(os.tmpdir(), `workflow-${Date.now()}.jpg`);
            await fs.writeFile(tmpPath, buf);
            return tmpPath;
          }
        }
      } else if (photoRef.startsWith("/") || /^[a-zA-Z]:\\/.test(photoRef)) {
        await fs.access(photoRef);
        return photoRef;
      }
    }
  } catch (err) {
    console.warn("[bridge] Menggunakan foto fallback default verifikasi:", err.message);
  }

  return await ensureDefaultVerificationPhoto();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageSignature(msg) {
  const rows = Array.isArray(msg?.buttons) ? msg.buttons : [];
  const btns = rows
    .flatMap((row) => (Array.isArray(row) ? row : []).map((button) => `${button?.text || ""}|${button?.url || ""}`))
    .join("¦");
  return `${Number(msg?.id || 0)}|${String(msg?.message || msg?.text || "")}|${btns}`;
}

export async function executeNetflixBridgeFlow(
  client,
  {
    targetBot = process.env.TARGET_BOT_USERNAME || process.env.BRIDGE_TARGET_BOT || "SSNetflixBot",
    countryPriorities = ["ID", "MY", "SG"],
    timeoutMs = 90000
  } = {}
) {
  const target = String(targetBot || "").trim().replace(/^@/, "");
  if (!target) throw new Error("Target bot username belum dikonfigurasi.");

  const priorities = [...new Set(
    (Array.isArray(countryPriorities) && countryPriorities.length ? countryPriorities : ["ID", "MY", "SG"])
      .map((c) => String(c || "").toUpperCase().trim())
      .filter(Boolean)
  )];

  const targetEntity = await client.getEntity(target);
  const deadline = Date.now() + Math.max(30000, timeoutMs);

  const readRecent = async () => {
    const list = await client.getMessages(targetEntity, { limit: 50 });
    return [...(list || [])].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  };

  const waitForChange = async (beforeSignatures, beforeMaxId, maxWait = 12000) => {
    const stopAt = Math.min(Date.now() + maxWait, deadline);
    let changedAt = 0;
    let latest = await readRecent();
    while (Date.now() < stopAt) {
      await sleep(600);
      latest = await readRecent();
      const changed = latest.some((msg) => {
        if (msg.out) return false;
        const id = Number(msg.id || 0);
        return id > beforeMaxId || beforeSignatures.get(id) !== messageSignature(msg);
      });
      if (changed) {
        changedAt ||= Date.now();
        if (Date.now() - changedAt >= 1000) return latest;
      }
    }
    return latest;
  };

  let initialMessages = await readRecent();
  let workflowBaseId = initialMessages.reduce((max, m) => Math.max(max, Number(m.id || 0)), 0);

  // Helper collect URLs
  const parser = new NetflixUrlParser();
  const collectUrls = (messages) => {
    const map = { pc: null, mobile: null, tv: null };
    const all = [];
    for (const msg of messages) {
      if (msg.out || Number(msg.id || 0) <= workflowBaseId) continue;
      const text = String(msg.message || msg.text || "");
      const buttons = Array.isArray(msg.buttons) ? msg.buttons.flatMap((r) => Array.isArray(r) ? r : []) : [];
      for (const btn of buttons) {
        const url = allowedNetflixUrl(btn?.url);
        if (url) all.push({ url, label: String(btn?.text || "") });
      }
      const links = parser.parseAll(text);
      for (const raw of links) {
        const url = allowedNetflixUrl(raw);
        if (!url) continue;
        const line = text.split(/\r?\n/).find((p) => p.includes(raw)) || text;
        all.push({ url, label: line });
      }
    }

    const seen = new Set();
    const unique = all.filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });

    for (const item of unique) {
      const kind = mediaKind(item.label);
      if (kind && !map[kind]) map[kind] = item.url;
    }

    const remainingKinds = ["pc", "mobile", "tv"].filter((k) => !map[k]);
    const remainingUrls = unique.map((i) => i.url).filter((u) => !Object.values(map).includes(u));
    for (let i = 0; i < remainingKinds.length && i < remainingUrls.length; i++) {
      map[remainingKinds[i]] = remainingUrls[i];
    }

    return { map, count: unique.length, unique };
  };

  const getLatestKeyboard = (messages) => [...messages].reverse().find((msg) => {
    if (msg.out || Number(msg.id || 0) <= workflowBaseId) return false;
    return (Array.isArray(msg.buttons) ? msg.buttons : []).some((r) => Array.isArray(r) && r.length);
  });

  const clickButtonAndWait = async (msg, i, j, waitMs = 10000) => {
    const currentMessages = await readRecent();
    const before = new Map(currentMessages.map((m) => [Number(m.id || 0), messageSignature(m)]));
    const beforeMax = currentMessages.reduce((max, m) => Math.max(max, Number(m.id || 0)), 0);
    try {
      if (typeof msg.click === "function") {
        await msg.click({ i, j });
      } else {
        const row = msg.buttons[i];
        const btn = row[j];
        if (btn?.data) {
          await client.invoke(new (await import("teleproto")).Api.messages.GetBotCallbackAnswer({
            peer: targetEntity,
            msgId: msg.id,
            data: Buffer.from(btn.data),
            timeout: 10
          }));
        }
      }
    } catch (e) {
      console.log(`[bridge] Button click notification: ${e.message || "ok"}`);
    }
    return waitForChange(before, beforeMax, waitMs);
  };

  // Step 1: Check if custom recorded workflow steps exist for this bot
  const recorded = await getSetting("bridge_workflow_steps", null);
  let messages;

  if (recorded && Array.isArray(recorded.steps) && recorded.steps.length > 0) {
    console.log(`[bridge] Menggunakan ${recorded.steps.length} langkah alur yang terekam untuk @${target}...`);
    for (const step of recorded.steps) {
      if (step.type === "send_text" && step.text) {
        console.log(`[bridge] Replay kirim pesan: "${step.text}"`);
        const before = new Map((await readRecent()).map((m) => [Number(m.id || 0), messageSignature(m)]));
        const sent = await client.sendMessage(targetEntity, { message: step.text });
        messages = await waitForChange(before, Number(sent?.id || 0), 10000);
      } else if (step.type === "click_button") {
        console.log(`[bridge] Replay klik tombol: "${step.buttonText}"`);
        let currentKb = getLatestKeyboard(messages || await readRecent());
        if (currentKb) {
          const rows = Array.isArray(currentKb.buttons) ? currentKb.buttons : [];
          let clicked = false;
          // Match text first
          for (let i = 0; i < rows.length; i++) {
            for (let j = 0; j < rows[i].length; j++) {
              if (rows[i][j]?.text && rows[i][j].text.trim() === String(step.buttonText || "").trim()) {
                messages = await clickButtonAndWait(currentKb, i, j, 8000);
                clicked = true;
                break;
              }
            }
            if (clicked) break;
          }
          // If text didn't match, fallback to row/column
          if (!clicked && step.row !== undefined && step.col !== undefined && rows[step.row]?.[step.col]) {
            messages = await clickButtonAndWait(currentKb, step.row, step.col, 8000);
          }
        }
      }
    }
  } else {
    // Default flow: Send /start, Channel Gate, Generate Now
    console.log(`[bridge] Step 1: Mengirim /start ke @${target}`);
    const startBefore = new Map(initialMessages.map((m) => [Number(m.id || 0), messageSignature(m)]));
    const sentStart = await client.sendMessage(targetEntity, { message: "/start" });
    messages = await waitForChange(startBefore, Math.max(workflowBaseId, Number(sentStart?.id || 0)), 12000);

    // Step 2: Handle channel gate ("Joined Successfully ✅") if present
    let kb = getLatestKeyboard(messages);
    if (kb) {
      const rows = Array.isArray(kb.buttons) ? kb.buttons : [];
      for (let i = 0; i < rows.length; i++) {
        for (let j = 0; j < rows[i].length; j++) {
          const text = String(rows[i][j]?.text || "");
          if (/joined\s*successfully|join\s*channel|joined\s*done|sudah\s*join/i.test(text)) {
            console.log(`[bridge] Menemukan tombol gate keanggotaan: "${text}". Menekan...`);
            messages = await clickButtonAndWait(kb, i, j, 8000);
            break;
          }
        }
      }
    }

    // Step 3: Handle "🎬 Generate Now" or "Generate" button
    kb = getLatestKeyboard(messages);
    if (kb) {
      const rows = Array.isArray(kb.buttons) ? kb.buttons : [];
      let clickedGenerate = false;
      for (let i = 0; i < rows.length; i++) {
        for (let j = 0; j < rows[i].length; j++) {
          const text = String(rows[i][j]?.text || "");
          if (/generate\s*now|generate\s*cookie|generate|ambil\s*token/i.test(text)) {
            console.log(`[bridge] Menemukan tombol generate: "${text}". Menekan...`);
            messages = await clickButtonAndWait(kb, i, j, 8000);
            clickedGenerate = true;
            break;
          }
        }
        if (clickedGenerate) break;
      }
    }
  }

  // Step 4: Country selection loop
  console.log(`[bridge] Step 4: Mencari negara prioritas (${priorities.join(", ")})...`);
  let selectedCountry = priorities[0];
  let countryClicked = false;
  const maxPages = 35;
  const visitedKeyboards = new Set();

  for (let page = 0; page < maxPages && Date.now() < deadline; page++) {
    kb = getLatestKeyboard(messages);
    if (!kb) {
      await sleep(1000);
      messages = await readRecent();
      kb = getLatestKeyboard(messages);
    }
    if (!kb) break;

    const rows = Array.isArray(kb.buttons) ? kb.buttons : [];
    const kbKey = rows.map((r) => r.map((b) => b?.text || "").join("|")).join(";");

    // Check if any priority country is on this page with stock > 0
    let foundPos = null;
    let foundCode = null;
    for (const code of priorities) {
      const pos = findCountryButtonPosition(rows, code, { checkStock: true });
      if (pos) {
        foundPos = pos;
        foundCode = code;
        break;
      }
    }

    if (foundPos) {
      const btn = rows[foundPos.row][foundPos.column];
      console.log(`[bridge] Memilih negara ${foundCode} (“${btn?.text}”) di halaman ${page + 1}`);
      selectedCountry = foundCode;
      messages = await clickButtonAndWait(kb, foundPos.row, foundPos.column, 15000);
      countryClicked = true;
      break;
    }

    // If not found, try Next Page
    const nextPos = findNextButtonPosition(rows);
    if (nextPos && !visitedKeyboards.has(kbKey)) {
      visitedKeyboards.add(kbKey);
      const nextBtn = rows[nextPos.row][nextPos.column];
      console.log(`[bridge] Navigasi ke halaman berikutnya (“${nextBtn?.text}”)...`);
      messages = await clickButtonAndWait(kb, nextPos.row, nextPos.column, 8000);
      continue;
    }

    // No next button or already visited
    break;
  }

  if (!countryClicked) {
    // If country button wasn't explicitly clicked, see if URLs or messages are already generating
    console.log(`[bridge] Peringatan: Tidak menemukan tombol negara spesifik, memeriksa respon langsung...`);
  }

  // Step 5: Wait for PC, Mobile, and TV URLs
  console.log(`[bridge] Step 5: Menunggu link PC, Mobile, dan TV...`);
  const urlWaitDeadline = Date.now() + 30000;
  let urlState = collectUrls(messages);

  while ((!urlState.map.pc || !urlState.map.mobile || !urlState.map.tv) && Date.now() < urlWaitDeadline) {
    await sleep(1500);
    messages = await readRecent();
    urlState = collectUrls(messages);
  }

  const recentTexts = messages
    .filter((m) => Number(m.id || 0) > workflowBaseId && !m.out)
    .map((m) => String(m.message || m.text || ""))
    .join("\n");

  if (!urlState.map.pc && !urlState.map.mobile && !urlState.map.tv) {
    if (/no stock|out of stock|tidak tersedia|stok habis|kosong/i.test(recentTexts)) {
      throw new Error(`Stok akun Netflix pada bot target @${target} sedang kosong untuk negara ini.`);
    }
    throw new Error(`Bot target belum memberikan link hasil login Netflix (PC/Mobile/TV).`);
  }

  // Step 6: Automatically click "Working ✅" button if presented
  console.log(`[bridge] Step 6: Memeriksa dan menekan tombol Working...`);
  let workingClicked = false;
  const workingDeadline = Date.now() + 12000;

  while (!workingClicked && Date.now() < workingDeadline) {
    for (const msg of [...messages].reverse()) {
      if (msg.out || Number(msg.id || 0) <= workflowBaseId) continue;
      const rows = Array.isArray(msg.buttons) ? msg.buttons : [];
      for (let i = 0; i < rows.length; i++) {
        for (let j = 0; j < rows[i].length; j++) {
          const label = String(rows[i][j]?.text || "");
          if (isWorkingLabel(label)) {
            console.log(`[bridge] Menemukan tombol status: "${label}". Menekan tombol...`);
            await clickButtonAndWait(msg, i, j, 5000);
            workingClicked = true;
            break;
          }
        }
        if (workingClicked) break;
      }
      if (workingClicked) break;
    }
    if (workingClicked) break;
    await sleep(1000);
    messages = await readRecent();
  }

  // Step 7: Send proof photo to target bot if it asks for verification photo
  const latestText = messages
    .filter((m) => Number(m.id || 0) > workflowBaseId && !m.out)
    .map((m) => String(m.message || m.text || ""))
    .join("\n");

  if (/upload.*photo|send.*photo|kirim.*foto|upload.*foto/i.test(latestText)) {
    console.log(`[bridge] Bot target meminta foto verifikasi. Mengirimkan foto bukti...`);
    try {
      const proofPhotoPath = await getVerificationPhotoFile();
      await client.sendFile(targetEntity, {
        file: proofPhotoPath,
        caption: ""
      });
      console.log(`[bridge] Foto verifikasi berhasil dikirim ke @${target}`);
    } catch (e) {
      console.warn(`[bridge] Gagal mengirim foto verifikasi ke bot target: ${e.message}`);
    }
  }

  const urlButtons = [];
  if (urlState.map.pc) urlButtons.push([{ text: "🖥️ Login PC / Laptop", url: urlState.map.pc }]);
  if (urlState.map.mobile) urlButtons.push([{ text: "📱 Login HP / Mobile", url: urlState.map.mobile }]);
  if (urlState.map.tv) urlButtons.push([{ text: "📺 Login TV / Smart TV", url: urlState.map.tv }]);
  urlButtons.push([{ text: "🌐 Akses Website", url: "https://link-netflix.vercel.app" }]);

  return {
    ok: true,
    country: selectedCountry,
    pcUrl: urlState.map.pc,
    mobileUrl: urlState.map.mobile,
    tvUrl: urlState.map.tv,
    urlButtons,
    messages
  };
}

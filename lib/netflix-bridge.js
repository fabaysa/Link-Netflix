import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  countryMatchesButton,
  findCountryButtonPosition,
  findNextButtonPosition,
  findPrevButtonPosition,
  extractButtonStock,
  isCountryMenuMessage,
  isCountryAction,
  isCountryChoiceLabel,
  isNextPageButton,
  isPrevPageButton
} from "./country-button-finder.js";
import {
  allowedNetflixUrl,
  mediaKind,
  isWorkingLabel,
  NetflixUrlParser
} from "./netflix-code-parser.js";
import { extractCookiesFromText } from "./bot-parser.js";
import { ensureDefaultVerificationPhoto } from "./verification-photo.js";
import { getSetting, getWorkflowPhotos, getRecordedWorkflow } from "./store.js";

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

  /**
   * Menelusuri menu negara sesuai urutan prioritas (Prioritas 1 -> 2 -> 3 dst):
   * Mencari prioritas pertama terlebih dahulu sambil merekam letak negara prioritas lainnya.
   * Jika prioritas pertama habis/tidak ada di semua halaman, otomatis fallback ke prioritas berikutnya.
   */
  const findAndClickCountry = async (priorityList) => {
    const primaryCountry = priorityList[0];
    const maxPages = 40;
    const visitedPages = new Set();
    const seenPriorities = new Map(); // countryCode -> { pageNumber, i, j, button, stock, btnText }
    let currentPageNum = 1;

    for (let page = 0; page < maxPages && Date.now() < deadline; page++) {
      let currentMessages = await readRecent();
      let current = getLatestKeyboard(currentMessages);
      if (!current) {
        await sleep(600);
        currentMessages = await readRecent();
        current = getLatestKeyboard(currentMessages);
      }
      if (!current) throw new Error("Menu negara tidak ditemukan pada bot target.");

      const rows = Array.isArray(current.buttons) ? current.buttons : [];
      const keyboardKey = `${String(current.message || current.text || "")}|${rows.map((row) => (Array.isArray(row) ? row.map((btn) => String(btn?.text || "")).join("|") : "")).join("¦")}`;

      const pageMatch = String(current.message || current.text || "").match(/Page:\s*(\d+)(?:\s*\/\s*(\d+))?/i);
      if (pageMatch) {
        currentPageNum = parseInt(pageMatch[1], 10);
      } else {
        currentPageNum = page + 1;
      }

      // 1. Rekam semua negara prioritas yang terlihat di halaman saat ini
      for (let r = 0; r < rows.length; r++) {
        const row = Array.isArray(rows[r]) ? rows[r] : [];
        for (let c = 0; c < row.length; c++) {
          const btn = row[c];
          const btnText = String(btn?.text || "");
          if (!btnText) continue;

          for (const code of priorityList) {
            if (countryMatchesButton(btnText, code)) {
              const stock = extractButtonStock(btnText);
              if (stock !== 0) {
                if (!seenPriorities.has(code)) {
                  console.log(`[bridge] Merekam negara prioritas ${code} (“${btnText}”, stok: ${stock ?? "tersedia"}) di halaman ${currentPageNum}`);
                  seenPriorities.set(code, {
                    countryCode: code,
                    pageNumber: currentPageNum,
                    i: r,
                    j: c,
                    button: btn,
                    stock,
                    btnText
                  });
                }
              } else {
                console.log(`[bridge] Negara ${code} (“${btnText}”) stok kosong (0), dilewati.`);
              }
            }
          }
        }
      }

      // 2. Cek apakah Prioritas Pertama ada di halaman saat ini dengan stok > 0
      const primaryPos = findCountryButtonPosition(rows, primaryCountry, { checkStock: true });
      if (primaryPos) {
        const primaryBtn = rows[primaryPos.row][primaryPos.column];
        console.log(`[bridge] Memilih prioritas utama 1 (${primaryCountry} - “${primaryBtn?.text}”) di halaman ${currentPageNum}`);
        const afterClick = await clickButtonAndWait(current, primaryPos.row, primaryPos.column, 15000);
        return { messages: afterClick, selectedCountry: primaryCountry };
      }

      // 3. Jika Prioritas Pertama belum ada di halaman ini, navigasi Next sambil merekam negara lain
      const nextPosition = findNextButtonPosition(rows);
      if (nextPosition && !visitedPages.has(keyboardKey)) {
        visitedPages.add(keyboardKey);
        const nextBtn = rows[nextPosition.row][nextPosition.column];
        console.log(`[bridge] Prioritas 1 (${primaryCountry}) belum ada di hal ${currentPageNum}, navigasi Next (“${nextBtn?.text}”)...`);
        currentMessages = await clickButtonAndWait(current, nextPosition.row, nextPosition.column, 8000);
        continue;
      }

      // Halaman habis atau tidak ada tombol Next
      console.log(`[bridge] Selesai menelusuri halaman menu (${page + 1} halaman). Prioritas utama ${primaryCountry} tidak ditemukan.`);
      break;
    }

    // 4. Prioritas pertama tidak ditemukan di semua halaman.
    // Cari prioritas cadangan berikutnya (Prioritas 2, lalu Prioritas 3, dst) yang stoknya tersedia
    let chosenFallback = null;
    for (let idx = 1; idx < priorityList.length; idx++) {
      const fallbackCode = priorityList[idx];
      if (seenPriorities.has(fallbackCode)) {
        chosenFallback = seenPriorities.get(fallbackCode);
        console.log(`[bridge] Fallback otomatis ke Prioritas #${idx + 1}: ${fallbackCode} (tercatat di hal ${chosenFallback.pageNumber})`);
        break;
      }
    }

    if (!chosenFallback) {
      throw new Error(`Seluruh negara prioritas (${priorityList.join(", ")}) tidak tersedia atau stok habis pada bot target @${target}.`);
    }

    // 5. Navigasi kembali ke halaman tempat negara cadangan berada (menggunakan tombol Prev)
    let currentMessages = await readRecent();
    let current = getLatestKeyboard(currentMessages);
    let currentRows = Array.isArray(current?.buttons) ? current.buttons : [];
    let pos = findCountryButtonPosition(currentRows, chosenFallback.countryCode, { checkStock: true });

    let prevAttempts = 0;
    while (!pos && prevAttempts < 35 && Date.now() < deadline) {
      prevAttempts++;
      const prevPosition = findPrevButtonPosition(currentRows);
      if (!prevPosition) {
        console.warn("[bridge] Tombol Prev tidak ditemukan saat navigasi mundur.");
        break;
      }
      currentMessages = await clickButtonAndWait(current, prevPosition.row, prevPosition.column, 8000);
      current = getLatestKeyboard(currentMessages);
      currentRows = Array.isArray(current?.buttons) ? current.buttons : [];
      pos = findCountryButtonPosition(currentRows, chosenFallback.countryCode, { checkStock: true });
    }

    // Jika navigasi mundur belum menemukan (misal bot reset ke page 1), coba Next
    if (!pos) {
      let nextAttempts = 0;
      while (!pos && nextAttempts < 35 && Date.now() < deadline) {
        nextAttempts++;
        const nextPosition = findNextButtonPosition(currentRows);
        if (!nextPosition) break;
        currentMessages = await clickButtonAndWait(current, nextPosition.row, nextPosition.column, 8000);
        current = getLatestKeyboard(currentMessages);
        currentRows = Array.isArray(current?.buttons) ? current.buttons : [];
        pos = findCountryButtonPosition(currentRows, chosenFallback.countryCode, { checkStock: true });
      }
    }

    if (!pos) {
      throw new Error(`Gagal menemukan tombol negara cadangan ${chosenFallback.countryCode} saat navigasi ulang.`);
    }

    const fallbackBtn = currentRows[pos.row][pos.column];
    console.log(`[bridge] Berhasil klik negara cadangan ${chosenFallback.countryCode} (“${fallbackBtn?.text}”)`);
    const afterClick = await clickButtonAndWait(current, pos.row, pos.column, 15000);
    return { messages: afterClick, selectedCountry: chosenFallback.countryCode };
  };

  // Step 1: Replay alur kustom atau alur default dari /start
  const recorded = await getRecordedWorkflow(target);
  let messages;
  let countrySelectionDone = false;
  let selectedCountry = priorities[0];

  if (recorded && Array.isArray(recorded.steps) && recorded.steps.length > 0) {
    console.log(`[bridge] Menjalankan ${recorded.steps.length} langkah alur lengkap terekam untuk @${target}...`);
    for (const step of recorded.steps) {
      if (Date.now() > deadline) throw new Error("Timeout menjalankan alur profil bridge.");

      // Cek apakah layar saat ini sudah berupa menu pilihan negara
      const currentKb = getLatestKeyboard(messages || await readRecent());
      if (!countrySelectionDone && isCountryMenuMessage(currentKb)) {
        console.log(`[bridge] Menu negara terdeteksi pada layar bot. Menjalankan seleksi prioritas negara (${priorities.join(", ")})...`);
        const outcome = await findAndClickCountry(priorities);
        messages = outcome.messages;
        selectedCountry = outcome.selectedCountry;
        countrySelectionDone = true;
        break;
      }

      if (step.type === "send_text" && step.text) {
        console.log(`[bridge] Replay kirim pesan: "${step.text}"`);
        const before = new Map((await readRecent()).map((m) => [Number(m.id || 0), messageSignature(m)]));
        const sent = await client.sendMessage(targetEntity, { message: step.text });
        messages = await waitForChange(before, Number(sent?.id || 0), 10000);
      } else if (step.type === "select_country_priority" || (!countrySelectionDone && isCountryAction(step, recorded))) {
        // Step ini adalah pemilihan negara: jalankan pemilihan prioritas dinamis
        console.log(`[bridge] Langkah pemilihan negara terdeteksi: menjalankan seleksi prioritas (${priorities.join(", ")})...`);
        const outcome = await findAndClickCountry(priorities);
        messages = outcome.messages;
        selectedCountry = outcome.selectedCountry;
        countrySelectionDone = true;
        break;
      } else if (step.type === "click_button") {
        const label = String(step.buttonText || "").trim();
        if (isWorkingLabel(label)) continue;

        // Jika tombol adalah tombol pemilihan negara atau pagination negara
        if (!countrySelectionDone && (isCountryChoiceLabel(label) || isNextPageButton(label) || isPrevPageButton(label))) {
          console.log(`[bridge] Aksi tombol negara/pagination terdeteksi: "${label}". Menjalankan seleksi prioritas...`);
          const outcome = await findAndClickCountry(priorities);
          messages = outcome.messages;
          selectedCountry = outcome.selectedCountry;
          countrySelectionDone = true;
          break;
        }

        console.log(`[bridge] Replay klik tombol: "${label}"`);
        let kb = getLatestKeyboard(messages || await readRecent());
        if (kb) {
          const rows = Array.isArray(kb.buttons) ? kb.buttons : [];
          let clicked = false;
          // Match text first
          for (let i = 0; i < rows.length; i++) {
            for (let j = 0; j < rows[i].length; j++) {
              if (rows[i][j]?.text && rows[i][j].text.trim().toLowerCase() === label.toLowerCase()) {
                messages = await clickButtonAndWait(kb, i, j, 8000);
                clicked = true;
                break;
              }
            }
            if (clicked) break;
          }
          // If text didn't match, fallback to row/column
          if (!clicked && step.row !== undefined && step.col !== undefined && rows[step.row]?.[step.col]) {
            messages = await clickButtonAndWait(kb, step.row, step.col, 8000);
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

  // Jika alur selesai tetapi pemilihan negara belum dilakukan (karena menu negara muncul di akhir):
  if (!countrySelectionDone) {
    const currentKb = getLatestKeyboard(messages || await readRecent());
    if (isCountryMenuMessage(currentKb)) {
      console.log(`[bridge] Menu negara terdeteksi di akhir alur. Menjalankan seleksi prioritas (${priorities.join(", ")})...`);
      const outcome = await findAndClickCountry(priorities);
      messages = outcome.messages;
      selectedCountry = outcome.selectedCountry;
      countrySelectionDone = true;
    }
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

  // Step 6: Ekstrak cookies dari teks balasan bot target dan lampiran dokumen (jika ada)
  console.log(`[bridge] Memeriksa cookies pada balasan bot target @${target}...`);
  let extractedCookiesFromBridge = null;

  for (const msg of messages) {
    if (msg.out || Number(msg.id || 0) <= workflowBaseId) continue;
    const text = String(msg.message || msg.text || "");
    const c = extractCookiesFromText(text);
    if (c) {
      console.log(`[bridge] Menemukan cookies di teks pesan target bot.`);
      extractedCookiesFromBridge = c;
      break;
    }

    // Jika bot target mengirim dokumen media (file .txt cookies)
    if (msg.media && (msg.media.document || msg.document)) {
      try {
        console.log(`[bridge] Mengunduh lampiran dokumen dari bot target @${target} untuk cek cookies...`);
        const buf = await client.downloadMedia(msg);
        if (buf && buf.length > 0) {
          const docText = buf.toString("utf8");
          const docCookies = extractCookiesFromText(docText);
          if (docCookies) {
            console.log(`[bridge] Berhasil menemukan cookies dalam file dokumen (${buf.length} bytes)`);
            extractedCookiesFromBridge = docCookies;
            break;
          } else if (docText.includes("NetflixId") || docText.startsWith("[") || docText.startsWith("{")) {
            console.log(`[bridge] Menggunakan isi dokumen sebagai cookies Netflix (${buf.length} bytes)`);
            extractedCookiesFromBridge = docText.trim();
            break;
          }
        }
      } catch (docErr) {
        console.warn(`[bridge] Gagal mengunduh dokumen media: ${docErr.message}`);
      }
    }
  }

  // Step 7: Automatically click "Working ✅" button if presented
  console.log(`[bridge] Step 7: Memeriksa dan menekan tombol Working...`);
  let workingClicked = false;
  const workingDeadline = Date.now() + 15000;

  while (!workingClicked && Date.now() < workingDeadline) {
    for (const msg of [...messages].reverse()) {
      if (msg.out || Number(msg.id || 0) <= workflowBaseId) continue;
      const rows = Array.isArray(msg.buttons) ? msg.buttons : [];
      for (let i = 0; i < rows.length; i++) {
        for (let j = 0; j < rows[i].length; j++) {
          const label = String(rows[i][j]?.text || "");
          if (isWorkingLabel(label)) {
            console.log(`[bridge] Menemukan tombol status: "${label}". Menekan tombol...`);
            messages = await clickButtonAndWait(msg, i, j, 5000);
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

  // Step 8: Send proof photo to target bot
  // Di bot target (seperti @SSNetflixBot), setelah tombol Working ditekan bot SELALU meminta/menunggu foto bukti
  const latestTexts = messages
    .filter((m) => Number(m.id || 0) > workflowBaseId && !m.out)
    .map((m) => String(m.message || m.text || ""))
    .join("\n");

  const shouldSendPhoto = workingClicked || /upload.*photo|send.*photo|kirim.*foto|upload.*foto|screenshot|upload.*bukti|kirim.*bukti|verify.*photo/i.test(latestTexts);

  if (shouldSendPhoto) {
    console.log(`[bridge] Mengirim foto verifikasi Working ke bot target @${target}...`);
    const proofPhotoPath = await getVerificationPhotoFile();
    let photoSent = false;
    let lastPhotoErr = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await sleep(attempt === 1 ? 1200 : 2500);
        console.log(`[bridge] Mengirim gambar verifikasi Working ke bot @${target} (percobaan ${attempt}/3): ${proofPhotoPath}`);
        await fs.access(proofPhotoPath);

        await client.sendFile(targetEntity, {
          file: proofPhotoPath,
          forceDocument: false,
          caption: ""
        });

        console.log(`[bridge] Berhasil mengirim gambar verifikasi Working ke bot target @${target}.`);
        photoSent = true;
        await sleep(1500);
        break;
      } catch (photoErr) {
        lastPhotoErr = photoErr;
        console.warn(`[bridge] Percobaan ${attempt}/3 gagal mengirim gambar verifikasi ke bot target: ${photoErr.message}`);
      }
    }

    if (!photoSent && lastPhotoErr) {
      console.error(`[bridge] PERINGATAN: Semua percobaan pengiriman foto verifikasi gagal: ${lastPhotoErr.message}`);
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
    messages,
    cookies: extractedCookiesFromBridge || null
  };
}

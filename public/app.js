const $ = (id) => document.getElementById(id);

const payload = $("payload");
const submitBtn = $("submitBtn");
const charCount = $("charCount");
const jobBadge = $("jobBadge");
const resultEmpty = $("resultEmpty");
const resultLive = $("resultLive");
const outputBox = $("outputBox");
const outputText = $("outputText");
const errorBox = $("errorBox");
const copyBtn = $("copyBtn");
const systemPill = $("systemPill");
const systemText = $("systemText");
const toast = $("toast");

const timelineQueued = $("timelineQueued");
const timelineProcessing = $("timelineProcessing");
const timelineDone = $("timelineDone");

let activePoll = null;
let toastTimer = null;
let pollStartedAt = 0;
let pollFailures = 0;
let systemReady = null;
let healthMessage = "";

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function buttonLabel(text) {
  const label = submitBtn?.querySelector("span");
  if (label) label.textContent = text;
}

function setBadge(status) {
  const normalized = String(status || "idle").toLowerCase();
  jobBadge.className = `status-badge ${normalized}`;
  const label = {
    idle: "Idle",
    queued: "Queued",
    processing: "Processing",
    completed: "Completed",
    failed: "Failed"
  }[normalized] || normalized;
  jobBadge.textContent = label;
}

function setTimeline(status) {
  [timelineQueued, timelineProcessing, timelineDone].forEach(el => {
    el.classList.remove("active", "done");
  });

  if (status === "queued") {
    timelineQueued.classList.add("active");
  } else if (status === "processing") {
    timelineQueued.classList.add("done");
    timelineProcessing.classList.add("active");
  } else if (status === "completed") {
    timelineQueued.classList.add("done");
    timelineProcessing.classList.add("done");
    timelineDone.classList.add("done");
  } else if (status === "failed") {
    timelineQueued.classList.add("done");
    timelineProcessing.classList.add("active");
  }
}

function renderResult(data) {
  setBadge(data.status);
  setTimeline(data.status);
  resultEmpty.classList.add("hidden");
  resultLive.classList.remove("hidden");

  if (data.status === "completed") {
    const messages = Array.isArray(data.result?.messages) ? data.result.messages : [];
    const text = messages
      .map(item => item?.text || "")
      .filter(Boolean)
      .join("\n\n") || "Request selesai tanpa output teks.";

    outputText.textContent = text;
    outputBox.classList.remove("hidden");
    errorBox.classList.add("hidden");
  } else if (data.status === "failed") {
    errorBox.textContent = data.error || "Request gagal diproses.";
    errorBox.classList.remove("hidden");
    outputBox.classList.add("hidden");
  } else {
    outputBox.classList.add("hidden");
    errorBox.classList.add("hidden");
  }
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || `HTTP ${res.status}` };
  }
}

function looksSensitive(text) {
  return /(?:cookie(?:s)?\s*[:=]|password\s*[:=]|session(?:id|_id)?\s*[:=]|(?:access|refresh|auth)_token\s*[:=]|nftoken\s*=)/i.test(text);
}

function finishPolling() {
  clearTimeout(activePoll);
  activePoll = null;
  localStorage.removeItem("linknetflix.webJob");
  submitBtn.disabled = false;
  buttonLabel("Proses Request");
}

function failPolling(message) {
  setBadge("failed");
  setTimeline("failed");
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
  outputBox.classList.add("hidden");
  resultEmpty.classList.add("hidden");
  resultLive.classList.remove("hidden");
  finishPolling();
}

async function pollJob(id, accessToken) {
  clearTimeout(activePoll);

  if (!pollStartedAt) pollStartedAt = Date.now();
  if (Date.now() - pollStartedAt > 7 * 60 * 1000) {
    failPolling("Request melewati batas waktu. Cek Vercel Function Logs dan jalankan ulang supabase.sql jika status terus berhenti di antrean.");
    return;
  }

  try {
    const res = await fetch(`/api/web?id=${encodeURIComponent(id)}&token=${encodeURIComponent(accessToken)}`, {
      cache: "no-store"
    });
    const data = await readJson(res);
    if (!res.ok || !data.ok) throw new Error(data.error || "Gagal membaca status request.");

    pollFailures = 0;
    renderResult(data);

    if (data.status === "completed" || data.status === "failed") {
      finishPolling();
      return;
    }

    activePoll = setTimeout(() => pollJob(id, accessToken), 1500);
  } catch (error) {
    pollFailures += 1;

    // Jangan langsung mematikan request karena satu network hiccup/edge cold start.
    if (pollFailures <= 4) {
      activePoll = setTimeout(() => pollJob(id, accessToken), 1500 * pollFailures);
      return;
    }

    failPolling(error.message || String(error));
  }
}

submitBtn.addEventListener("click", async () => {
  const value = payload.value.trim();

  if (!value) {
    showToast("Masukkan demo request terlebih dahulu.");
    payload.focus();
    return;
  }

  if (!/^DEMO:/i.test(value)) {
    showToast("Input web harus diawali DEMO:.");
    payload.focus();
    return;
  }

  if (looksSensitive(value)) {
    showToast("Jangan masukkan cookie atau session login.");
    payload.focus();
    return;
  }

  if (systemReady === false) {
    showToast(healthMessage || "Backend belum siap. Periksa konfigurasi Vercel dan Supabase.");
    return;
  }

  submitBtn.disabled = true;
  buttonLabel("Mengirim...");
  resultEmpty.classList.add("hidden");
  resultLive.classList.remove("hidden");
  outputBox.classList.add("hidden");
  errorBox.classList.add("hidden");
  setBadge("queued");
  setTimeline("queued");

  pollStartedAt = Date.now();
  pollFailures = 0;

  try {
    const res = await fetch("/api/web", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: value })
    });
    const data = await readJson(res);
    if (!res.ok || !data.ok) throw new Error(data.error || "Request tidak dapat dikirim.");

    localStorage.setItem("linknetflix.webJob", JSON.stringify({
      id: data.id,
      accessToken: data.accessToken,
      startedAt: pollStartedAt
    }));
    buttonLabel("Memproses...");
    pollJob(data.id, data.accessToken);
  } catch (error) {
    failPolling(error.message || String(error));
  }
});

payload.addEventListener("input", () => {
  charCount.textContent = `${payload.value.length} / 1000`;
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(outputText.textContent || "");
    showToast("Output disalin.");
  } catch {
    showToast("Tidak dapat menyalin output.");
  }
});

async function checkHealth() {
  systemPill.classList.remove("online", "offline");
  systemText.textContent = "Checking";

  try {
    const res = await fetch("/api/web?health=1", { cache: "no-store" });
    const data = await readJson(res);
    if (!res.ok || !data.ok) throw new Error(data.error || "Health check gagal.");

    systemReady = Boolean(data.ready);
    healthMessage = data.message || "";
    systemPill.title = healthMessage;

    if (systemReady) {
      systemPill.classList.add("online");
      systemText.textContent = "System ready";
    } else {
      systemPill.classList.add("offline");
      systemText.textContent = "Setup required";
    }
  } catch (error) {
    systemReady = false;
    healthMessage = error.message || "Backend tidak dapat diakses.";
    systemPill.classList.add("offline");
    systemText.textContent = "System offline";
    systemPill.title = healthMessage;
  }
}

function resumeJob() {
  try {
    const saved = JSON.parse(localStorage.getItem("linknetflix.webJob") || "null");
    if (!saved?.id || !saved?.accessToken) return;

    const startedAt = Number(saved.startedAt || Date.now());
    if (Date.now() - startedAt > 60 * 60 * 1000) {
      localStorage.removeItem("linknetflix.webJob");
      return;
    }

    pollStartedAt = startedAt;
    pollFailures = 0;
    submitBtn.disabled = true;
    buttonLabel("Memproses...");
    resultEmpty.classList.add("hidden");
    resultLive.classList.remove("hidden");
    pollJob(saved.id, saved.accessToken);
  } catch {
    localStorage.removeItem("linknetflix.webJob");
  }
}

payload.value = "DEMO: Test Web Access";
charCount.textContent = `${payload.value.length} / 1000`;
checkHealth();
resumeJob();

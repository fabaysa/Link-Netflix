import {
  isOutgoing,
  messageId,
  messageText,
  relaySnapshot,
  serializeIncomingMessage
} from "./relay-response.js";

let runtimePromise;

function pickExport(mod, name) {
  return mod?.[name] ?? mod?.default?.[name] ?? null;
}

export async function getTeleprotoRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      try {
        const [root, sessions] = await Promise.all([
          import("teleproto"),
          import("teleproto/sessions/index.js")
        ]);

        const TelegramClient = pickExport(root, "TelegramClient");
        const Api = pickExport(root, "Api");
        const StringSession = pickExport(sessions, "StringSession");

        if (!TelegramClient) {
          throw new Error("Export TelegramClient tidak ditemukan pada package teleproto.");
        }
        if (!Api) {
          throw new Error("Export Api tidak ditemukan pada package teleproto.");
        }
        if (!StringSession) {
          throw new Error(
            "Export StringSession tidak ditemukan pada package teleproto/sessions."
          );
        }

        return { TelegramClient, Api, StringSession };
      } catch (error) {
        runtimePromise = null;
        throw new Error(
          `Gagal memuat runtime teleproto/ESM: ${error?.message || String(error)}`
        );
      }
    })();
  }

  return runtimePromise;
}

export function apiCredentials() {
  const apiIdRaw = String(process.env.TELEGRAM_API_ID || "").trim();
  const apiHash = String(process.env.TELEGRAM_API_HASH || "").trim();
  const apiId = Number.parseInt(apiIdRaw, 10);

  if (!apiIdRaw || !Number.isFinite(apiId) || apiId <= 0) {
    throw new Error("TELEGRAM_API_ID belum diisi atau bukan angka yang valid.");
  }
  if (!apiHash) {
    throw new Error("TELEGRAM_API_HASH belum diisi.");
  }

  return { apiId, apiHash };
}

export function targetUsername() {
  return String(
    process.env.TARGET_BOT_USERNAME ||
    process.env.GOCHECKER_USERNAME ||
    "cookiesnetflixskystorebot"
  )
    .trim()
    .replace(/^@/, "");
}

export async function makeUserClient(
  sessionString = process.env.TELEGRAM_USER_SESSION || ""
) {
  const { apiId, apiHash } = apiCredentials();
  const { TelegramClient, StringSession } = await getTeleprotoRuntime();

  return new TelegramClient(
    new StringSession(String(sessionString || "")),
    apiId,
    apiHash,
    {
      connectionRetries: 5,
      floodSleepThreshold: 30
    }
  );
}

export async function connectAuthorizedUser() {
  const session = String(process.env.TELEGRAM_USER_SESSION || "").trim();

  if (!session) {
    throw new Error(
      "TELEGRAM_USER_SESSION belum diisi. Buka /setup-userbot.html untuk membuatnya."
    );
  }

  const client = await makeUserClient(session);
  await client.connect();

  const authorized = await client.checkAuthorization();
  if (!authorized) {
    await client.disconnect();
    throw new Error(
      "TELEGRAM_USER_SESSION tidak valid / sudah logout. Buat session baru."
    );
  }

  const me = await client.getMe();
  if (me?.bot) {
    await client.disconnect();
    throw new Error("Session harus akun Telegram biasa, bukan bot.");
  }

  return { client, me };
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function maxRelayChars() {
  const raw = Number.parseInt(process.env.MAX_RELAY_TEXT_CHARS || "4000", 10);
  if (!Number.isFinite(raw)) return 4000;
  return Math.max(1, Math.min(raw, 4096));
}

// ---------------------------------------------------------------------------
// Multi-step relay helpers
// ---------------------------------------------------------------------------

/**
 * Wait for incoming messages from the target bot after a given message ID.
 * Simpler & faster variant of waitForTargetReply for intermediate steps.
 */
async function waitForBotMessages(client, afterId, timeoutMs = 15000) {
  const target = targetUsername();
  const deadline = Date.now() + timeoutMs;
  const pollMs = 800;
  const settleMs = 1500;
  let lastSnapshot = "";
  let lastChangeAt = 0;
  let latestIncoming = [];

  while (Date.now() < deadline) {
    const messages = await client.getMessages(target, {
      limit: 20,
      minId: afterId
    });

    const incoming = (messages || [])
      .filter(msg => msg && !isOutgoing(msg) && messageId(msg) > afterId)
      .sort((a, b) => messageId(a) - messageId(b));

    if (incoming.length) {
      const snapshot = JSON.stringify(
        incoming.map(m => ({ id: messageId(m), t: messageText(m)?.slice(0, 80) }))
      );
      if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot;
        lastChangeAt = Date.now();
        latestIncoming = incoming;
      }
      if (Date.now() - lastChangeAt >= settleMs) {
        return latestIncoming;
      }
    }

    await sleep(pollMs);
  }

  if (latestIncoming.length) return latestIncoming;
  throw new Error(`Timeout menunggu balasan dari @${target} (intermediate step).`);
}

/**
 * Search for a button matching one of the search terms in the reply messages,
 * then press it (inline callback) or send its text (reply keyboard).
 */
async function findAndPressButton(client, replyMessages, searchTerms) {
  const target = targetUsername();

  for (const msg of replyMessages) {
    const markup = msg.replyMarkup;
    if (!markup || !Array.isArray(markup.rows)) continue;

    const markupClass = String(
      markup.className || markup.constructor?.name || ""
    ).toLowerCase();
    const isInline = markupClass.includes("inline");

    for (const row of markup.rows) {
      const buttons = Array.isArray(row.buttons) ? row.buttons : [];
      for (const button of buttons) {
        const btnText = String(button.text || "").toLowerCase();
        const matches = searchTerms.some(t => btnText.includes(t.toLowerCase()));
        if (!matches) continue;

        // --- Inline callback button ---
        if (isInline && button.data) {
          console.log(`[relay] Pressing inline callback button: "${button.text}"`);
          try {
            const { Api } = await getTeleprotoRuntime();
            const peer = await client.getInputEntity(target);
            const data =
              button.data instanceof Buffer
                ? button.data
                : Buffer.from(button.data);
            await client.invoke(
              new Api.messages.GetBotCallbackAnswer({
                peer,
                msgId: messageId(msg),
                data,
                timeout: 10
              })
            );
          } catch (e) {
            // GetBotCallbackAnswer may throw timeout but still register the press
            console.log(`[relay] Callback answer returned: ${e.message || "ok"}`);
          }
          const maxId = Math.max(...replyMessages.map(m => messageId(m)));
          return { type: "callback", waitAfterId: maxId };
        }

        // --- Reply keyboard button: send text ---
        console.log(`[relay] Sending reply-keyboard text: "${button.text}"`);
        const sent = await client.sendMessage(target, { message: button.text });
        return { type: "text", waitAfterId: messageId(sent) };
      }
    }
  }

  // Fallback: send button text directly
  const fallbackText = "🗝️ Generate Cookie";
  console.log(`[relay] Button not found, sending fallback text: "${fallbackText}"`);
  const sent = await client.sendMessage(target, { message: fallbackText });
  return { type: "fallback", waitAfterId: messageId(sent) };
}

// ---------------------------------------------------------------------------
// Main relay function (multi-step: /start → button → cookies)
// ---------------------------------------------------------------------------

export async function sendRelayText(client, payload) {
  const target = targetUsername();
  const text = String(payload ?? "");

  if (!text.trim()) throw new Error("Teks yang akan diteruskan kosong.");
  if (text.length > maxRelayChars()) {
    throw new Error(
      `Teks terlalu panjang (${text.length} karakter). Maksimal ${maxRelayChars()} karakter agar dikirim sebagai satu pesan.`
    );
  }

  // Step 1: Send /start to target bot
  console.log(`[relay] Step 1 — Sending /start to @${target}`);
  const startSent = await client.sendMessage(target, { message: "/start" });
  const startSentId = messageId(startSent);
  if (!startSentId) throw new Error("Gagal mengirim /start ke target bot.");

  // Step 2: Wait for bot's /start reply (with buttons)
  console.log(`[relay] Step 2 — Waiting for /start reply...`);
  const startReplies = await waitForBotMessages(client, startSentId, 20000);
  console.log(`[relay] Got ${startReplies.length} reply message(s) from /start`);

  // Step 3: Find & press "Generate Cookie" button
  console.log(`[relay] Step 3 — Pressing Generate Cookie button...`);
  const btnResult = await findAndPressButton(client, startReplies, [
    "generate cookie",
    "generate"
  ]);
  console.log(`[relay] Button result: type=${btnResult.type}`);

  // Step 4: Wait for bot's response after button press (asking for cookies)
  console.log(`[relay] Step 4 — Waiting for post-button response...`);
  try {
    await waitForBotMessages(client, btnResult.waitAfterId, 15000);
    console.log(`[relay] Got post-button response`);
  } catch {
    // Bot may edit existing message instead of sending a new one — continue.
    console.log(`[relay] No new message after button (bot may have edited), continuing`);
  }

  // Step 5: Send user's cookies
  console.log(`[relay] Step 5 — Sending cookies to @${target}`);
  const sent = await client.sendMessage(target, {
    message: text,
    formattingEntities: [],
    linkPreview: false
  });

  const sentId = messageId(sent);
  if (!sentId) throw new Error("Telegram tidak mengembalikan ID pesan yang dikirim.");

  return {
    sentMessageId: sentId,
    mode: "text"
  };
}

// ---------------------------------------------------------------------------
// Wait for target reply (final step — unchanged logic)
// ---------------------------------------------------------------------------

export async function waitForTargetReply(
  client,
  sentMessageId,
  {
    timeoutMs = Number.parseInt(process.env.RELAY_TIMEOUT_MS || "120000", 10),
    pollMs = Number.parseInt(process.env.RELAY_POLL_MS || "1200", 10),
    settleMs = Number.parseInt(process.env.RELAY_SETTLE_MS || "2200", 10)
  } = {}
) {
  const target = targetUsername();
  const deadline = Date.now() + Math.max(10_000, timeoutMs);
  const safePollMs = Math.max(500, pollMs);
  const safeSettleMs = Math.max(500, settleMs);

  let lastSnapshot = "";
  let lastChangeAt = 0;
  let latestIncoming = [];

  while (Date.now() < deadline) {
    const messages = await client.getMessages(target, {
      limit: 50,
      minId: sentMessageId
    });

    const incoming = (messages || [])
      .filter(msg => msg && !isOutgoing(msg) && messageId(msg) > sentMessageId)
      .sort((a, b) => messageId(a) - messageId(b));

    if (incoming.length) {
      const snapshot = relaySnapshot(incoming);
      if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot;
        lastChangeAt = Date.now();
        latestIncoming = incoming;
      }

      if (Date.now() - lastChangeAt >= safeSettleMs) {
        return {
          messages: latestIncoming.map(serializeIncomingMessage),
          resultMessageId: messageId(latestIncoming.at(-1)),
          sourceText: latestIncoming.map(messageText).filter(Boolean).join("\n\n")
        };
      }
    }

    await sleep(safePollMs);
  }

  if (latestIncoming.length) {
    return {
      messages: latestIncoming.map(serializeIncomingMessage),
      resultMessageId: messageId(latestIncoming.at(-1)),
      sourceText: latestIncoming.map(messageText).filter(Boolean).join("\n\n")
    };
  }

  throw new Error(
    `Timeout menunggu balasan dari @${target} setelah ${Math.round(timeoutMs / 1000)} detik.`
  );
}

// Backward-compatible aliases supaya endpoint/admin lama tidak langsung rusak.
export const sendPayloadToGoChecker = async (client, payload) =>
  sendRelayText(client, payload);

export const waitForGoCheckerResult = async (client, sentMessageId, options) => {
  const result = await waitForTargetReply(client, sentMessageId, options);
  return {
    ...result,
    summary: {
      total: result.messages.length,
      sourceText: result.sourceText
    }
  };
};

export async function testTargetConversation(client, timeoutMs = 30000) {
  const target = targetUsername();
  const sent = await sendRelayText(client, "/start");

  try {
    const reply = await waitForTargetReply(client, sent.sentMessageId, {
      timeoutMs,
      settleMs: 1200
    });

    return {
      ok: true,
      sentMessageId: sent.sentMessageId,
      replyMessageId: reply.resultMessageId,
      replyPreview: reply.sourceText.slice(0, 500),
      urlButtonCount: reply.messages.reduce(
        (sum, item) => sum + item.urlButtons.reduce((n, row) => n + row.length, 0),
        0
      )
    };
  } catch (error) {
    return {
      ok: false,
      sentMessageId: sent.sentMessageId,
      reason: error?.message || String(error)
    };
  }
}

export const testGoCheckerConversation = testTargetConversation;

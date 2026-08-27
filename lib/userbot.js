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
    "GoChecker_Bot"
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

export async function sendRelayText(client, payload) {
  const target = targetUsername();
  const text = String(payload ?? "");

  if (!text.trim()) throw new Error("Teks yang akan diteruskan kosong.");
  if (text.length > maxRelayChars()) {
    throw new Error(
      `Teks terlalu panjang (${text.length} karakter). Maksimal ${maxRelayChars()} karakter agar dikirim sebagai satu pesan.`
    );
  }

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

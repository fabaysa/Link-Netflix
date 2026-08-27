import { botApi } from "../lib/telegram-bot.js";
import {
  apiCredentials,
  connectAuthorizedUser,
  getTeleprotoRuntime,
  targetUsername,
  testTargetConversation
} from "../lib/userbot.js";
import { kickBridgeWorker } from "../lib/kick-worker.js";

function setupKeyOk(req) {
  const expected = String(process.env.WEBHOOK_SETUP_KEY || "");
  const actual = String(req.query?.key || "");
  return Boolean(expected) && actual === expected;
}

function requireKey(req, res) {
  if (!setupKeyOk(req)) {
    res.status(401).json({
      ok: false,
      error: "WEBHOOK_SETUP_KEY salah atau belum diisi."
    });
    return false;
  }
  return true;
}

async function handleHealth(req, res) {
  return res.status(200).json({
    ok: true,
    engine: "5.0-generic-relay-vercel",
    serverlessFunctions: 4,
    userbotSessionConfigured: Boolean(process.env.TELEGRAM_USER_SESSION),
    apiIdConfigured: Boolean(process.env.TELEGRAM_API_ID),
    apiHashConfigured: Boolean(process.env.TELEGRAM_API_HASH),
    target: `@${targetUsername()}`,
    time: new Date().toISOString()
  });
}

async function handleConfig(req, res) {
  if (!requireKey(req, res)) return;

  const apiIdRaw = String(process.env.TELEGRAM_API_ID || "").trim();
  const apiHashRaw = String(process.env.TELEGRAM_API_HASH || "").trim();
  const apiId = Number.parseInt(apiIdRaw, 10);

  const checks = {
    TELEGRAM_API_ID:
      Boolean(apiIdRaw) && Number.isFinite(apiId) && apiId > 0,
    TELEGRAM_API_HASH:
      /^[a-fA-F0-9]{16,128}$/.test(apiHashRaw),
    SUPABASE_URL:
      /^https:\/\/.+\.supabase\.co\/?$/.test(
        String(process.env.SUPABASE_URL || "").trim()
      ),
    SUPABASE_SERVICE_ROLE_KEY:
      Boolean(String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()),
    BASE_URL:
      /^https:\/\//.test(String(process.env.BASE_URL || "").trim()),
    BRIDGE_WORKER_SECRET:
      Boolean(String(process.env.BRIDGE_WORKER_SECRET || "").trim()),
    TARGET_BOT_USERNAME:
      Boolean(String(process.env.TARGET_BOT_USERNAME || process.env.GOCHECKER_USERNAME || "").trim())
  };

  const missingOrInvalid = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  return res.status(missingOrInvalid.length ? 500 : 200).json({
    ok: missingOrInvalid.length === 0,
    engine: "5.0-generic-relay-vercel",
    checks,
    missingOrInvalid,
    note:
      "Nilai secret tidak ditampilkan; endpoint hanya mengecek apakah konfigurasi terbaca."
  });
}

async function handleRuntime(req, res) {
  if (!requireKey(req, res)) return;

  try {
    const { apiId, apiHash } = apiCredentials();
    const runtime = await getTeleprotoRuntime();

    return res.status(200).json({
      ok: true,
      engine: "5.0-generic-relay-vercel",
      apiCredentialsReadable: Boolean(apiId && apiHash),
      teleprotoImport: true,
      exports: {
        TelegramClient: Boolean(runtime.TelegramClient),
        Api: Boolean(runtime.Api),
        StringSession: Boolean(runtime.StringSession)
      },
      reason: "Runtime MTProto berhasil dimuat."
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      engine: "5.0-generic-relay-vercel",
      stage: "teleproto_runtime",
      error: error?.message || String(error)
    });
  }
}

async function handleUserbotTest(req, res) {
  if (!requireKey(req, res)) return;

  let client;
  try {
    const connected = await connectAuthorizedUser();
    client = connected.client;
    const me = connected.me;

    const target = targetUsername();
    const entity = await client.getEntity(target);

    return res.status(200).json({
      ok: true,
      engine: "5.0-generic-relay-vercel",
      account: {
        id: String(me?.id || ""),
        username: me?.username || null,
        firstName: me?.firstName || null
      },
      target: {
        username: `@${target}`,
        resolved: Boolean(entity)
      },
      reason: "Session akun userbot valid dan target dapat di-resolve."
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      engine: "5.0-generic-relay-vercel",
      error: error?.message || String(error)
    });
  } finally {
    try {
      if (client) await client.disconnect();
    } catch {}
  }
}

async function handleTargetTest(req, res) {
  if (!requireKey(req, res)) return;

  let client;
  try {
    const connected = await connectAuthorizedUser();
    client = connected.client;
    const result = await testTargetConversation(client, 30000);

    return res.status(result.ok ? 200 : 504).json({
      ...result,
      target: `@${targetUsername()}`,
      engine: "5.0-generic-relay-vercel"
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      target: `@${targetUsername()}`,
      error: error?.message || String(error)
    });
  } finally {
    try {
      if (client) await client.disconnect();
    } catch {}
  }
}

async function handleSetupWebhook(req, res) {
  if (!requireKey(req, res)) return;

  const base = String(process.env.BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");

  if (!base.startsWith("https://")) {
    return res.status(500).json({
      ok: false,
      error: "BASE_URL harus URL https:// Vercel."
    });
  }

  const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    return res.status(500).json({
      ok: false,
      error: "TELEGRAM_WEBHOOK_SECRET belum diisi."
    });
  }

  try {
    const webhook = `${base}/api/telegram`;
    const result = await botApi("setWebhook", {
      url: webhook,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: false
    });

    return res.status(200).json({
      ok: true,
      webhook,
      telegram: result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error)
    });
  }
}

async function handleKickWorker(req, res) {
  if (!requireKey(req, res)) return;

  try {
    const result = await kickBridgeWorker();
    return res.status(200).json({ ok: true, worker: result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error)
    });
  }
}

export default async function handler(req, res) {
  const action = String(req.query?.action || "health").toLowerCase();

  switch (action) {
    case "health":
      return handleHealth(req, res);
    case "config":
      return handleConfig(req, res);
    case "runtime":
      return handleRuntime(req, res);
    case "userbot-test":
      return handleUserbotTest(req, res);
    case "target-test":
      return handleTargetTest(req, res);
    case "setup-webhook":
      return handleSetupWebhook(req, res);
    case "kick-worker":
      return handleKickWorker(req, res);
    default:
      return res.status(404).json({
        ok: false,
        error: `Admin action tidak dikenal: ${action}`
      });
  }
}

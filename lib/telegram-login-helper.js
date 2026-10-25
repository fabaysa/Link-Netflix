import crypto from "node:crypto";
import { getSupabase } from "./supabase.js";
import { isTableMissingError } from "./store.js";
import { apiCredentials, getTeleprotoRuntime, makeUserClient } from "./userbot.js";

// In-memory session fallback map for resilience against missing database tables
const memoryLoginSessions = new Map();

export async function startTelegramLogin(phone) {
  const cleanPhone = String(phone || "").trim().replace(/[^\d+]/g, "");
  if (!/^\+\d{8,16}$/.test(cleanPhone)) {
    throw new Error("Nomor Telegram harus format internasional, contoh +628123456789.");
  }

  const { apiId, apiHash } = apiCredentials();
  const client = await makeUserClient("");
  await client.connect();

  try {
    const result = await client.sendCode({ apiId, apiHash }, cleanPhone, false);
    const loginId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const sessionData = {
      id: loginId,
      phone: cleanPhone,
      temp_session: client.session.save(),
      phone_code_hash: result.phoneCodeHash,
      is_code_via_app: Boolean(result.isCodeViaApp),
      needs_2fa: false,
      expires_at: expiresAt
    };

    // Store in-memory immediately
    memoryLoginSessions.set(loginId, sessionData);

    // Try storing in Supabase, but don't fail if table is missing in schema cache
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from("gemini_checker_login_sessions").insert(sessionData);
      if (error && !isTableMissingError(error)) {
        console.warn("[login-helper] Supabase session save warning:", error.message);
      }
    } catch (dbErr) {
      console.warn("[login-helper] Fallback to in-memory login session:", dbErr.message);
    }

    return {
      ok: true,
      loginId,
      phone: cleanPhone,
      isCodeViaApp: Boolean(result.isCodeViaApp)
    };
  } finally {
    try {
      await client.disconnect();
    } catch {}
  }
}

export async function submitTelegramCode(loginId, code) {
  const cleanCode = String(code || "").trim().replace(/\s/g, "");

  let row = memoryLoginSessions.get(loginId);
  if (!row) {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("gemini_checker_login_sessions")
        .select("*")
        .eq("id", loginId)
        .maybeSingle();

      if (!error && data) row = data;
    } catch {}
  }

  if (!row) {
    throw new Error("Sesi login Telegram tidak ditemukan atau sudah kedaluwarsa. Mulai ulang.");
  }

  const { Api } = await getTeleprotoRuntime();
  const client = await makeUserClient(row.temp_session);
  await client.connect();

  try {
    try {
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: row.phone,
          phoneCodeHash: row.phone_code_hash,
          phoneCode: cleanCode
        })
      );

      const finalSession = client.session.save();

      // Clean up session
      memoryLoginSessions.delete(loginId);
      try {
        const supabase = getSupabase();
        await supabase.from("gemini_checker_login_sessions").delete().eq("id", loginId);
      } catch {}

      return {
        ok: true,
        sessionString: finalSession,
        phone: row.phone
      };
    } catch (err) {
      const errMsg = String(err?.errorMessage || err?.message || "");
      if (errMsg.includes("SESSION_PASSWORD_NEEDED")) {
        row.temp_session = client.session.save();
        row.needs_2fa = true;
        memoryLoginSessions.set(loginId, row);

        try {
          const supabase = getSupabase();
          await supabase
            .from("gemini_checker_login_sessions")
            .update({
              temp_session: row.temp_session,
              needs_2fa: true
            })
            .eq("id", loginId);
        } catch {}

        return {
          ok: false,
          needs2FA: true
        };
      }
      throw err;
    }
  } finally {
    try {
      await client.disconnect();
    } catch {}
  }
}

export async function submitTelegram2FA(loginId, password) {
  let row = memoryLoginSessions.get(loginId);
  if (!row) {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("gemini_checker_login_sessions")
        .select("*")
        .eq("id", loginId)
        .maybeSingle();

      if (!error && data) row = data;
    } catch {}
  }

  if (!row) {
    throw new Error("Sesi login Telegram tidak ditemukan atau sudah kedaluwarsa. Mulai ulang.");
  }

  const { apiId, apiHash } = apiCredentials();
  const client = await makeUserClient(row.temp_session);
  await client.connect();

  try {
    await client.signInUserWithPassword(
      { apiId, apiHash },
      { password: String(password || "") }
    );

    const finalSession = client.session.save();

    // Clean up session
    memoryLoginSessions.delete(loginId);
    try {
      const supabase = getSupabase();
      await supabase.from("gemini_checker_login_sessions").delete().eq("id", loginId);
    } catch {}

    return {
      ok: true,
      sessionString: finalSession,
      phone: row.phone
    };
  } finally {
    try {
      await client.disconnect();
    } catch {}
  }
}

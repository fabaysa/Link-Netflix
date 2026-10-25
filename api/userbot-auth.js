import { getSupabase } from "../lib/supabase.js";
import {
  apiCredentials,
  getTeleprotoRuntime,
  makeUserClient
} from "../lib/userbot.js";

function checkSetupKey(req) {
  const expected = String(process.env.WEBHOOK_SETUP_KEY || "");
  const actual = String(req.body?.setupKey || "");
  return Boolean(expected) && actual === expected;
}

async function startLogin(req, res) {
  const phone = String(req.body?.phone || "")
    .trim()
    .replace(/[^\d+]/g, "");

  if (!/^\+\d{8,15}$/.test(phone)) {
    return res.status(400).json({
      ok: false,
      error: "Nomor harus format internasional, contoh +628123456789."
    });
  }

  let client;
  try {
    const { apiId, apiHash } = apiCredentials();
    client = await makeUserClient("");
    await client.connect();

    const result = await client.sendCode(
      { apiId, apiHash },
      phone,
      false
    );

    const crypto = await import("node:crypto");
    const loginId = crypto.randomUUID();
    const expiresAt =
      new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const supabase = getSupabase();
    const { error } = await supabase
      .from("gemini_checker_login_sessions")
      .insert({
        id: loginId,
        phone,
        temp_session: client.session.save(),
        phone_code_hash: result.phoneCodeHash,
        is_code_via_app: Boolean(result.isCodeViaApp),
        needs_2fa: false,
        expires_at: expiresAt
      });

    if (error) throw error;

    return res.status(200).json({
      ok: true,
      loginId,
      sentViaApp: Boolean(result.isCodeViaApp),
      expiresAt,
      message: result.isCodeViaApp
        ? "Kode dikirim ke aplikasi Telegram."
        : "Kode login dikirim oleh Telegram."
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      stage: "login_start",
      error:
        error?.errorMessage ||
        error?.message ||
        String(error)
    });
  } finally {
    try {
      if (client) await client.disconnect();
    } catch {}
  }
}

async function verifyLogin(req, res) {
  const loginId = String(req.body?.loginId || "").trim();
  const code = String(req.body?.code || "")
    .trim()
    .replace(/\s/g, "");
  const password = String(req.body?.password || "");

  if (!loginId) {
    return res.status(400).json({
      ok: false,
      error: "loginId kosong."
    });
  }

  const supabase = getSupabase();
  const { data: row, error: readError } = await supabase
    .from("gemini_checker_login_sessions")
    .select("*")
    .eq("id", loginId)
    .maybeSingle();

  if (readError) {
    return res.status(500).json({
      ok: false,
      error: readError.message
    });
  }

  if (!row) {
    return res.status(404).json({
      ok: false,
      error: "Sesi login tidak ditemukan. Mulai ulang."
    });
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await supabase
      .from("gemini_checker_login_sessions")
      .delete()
      .eq("id", loginId);

    return res.status(410).json({
      ok: false,
      error: "Sesi login sudah kedaluwarsa. Mulai ulang."
    });
  }

  let client;
  try {
    const { apiId, apiHash } = apiCredentials();
    client = await makeUserClient(row.temp_session);
    await client.connect();

    if (row.needs_2fa) {
      if (!password) {
        return res.status(200).json({
          ok: false,
          needs2FA: true,
          message:
            "Masukkan password Two-Step Verification Telegram."
        });
      }

      await client.signInWithPassword(
        { apiId, apiHash },
        {
          password: async () => password,
          onError: async () => true
        }
      );
    } else {
      if (!code) {
        return res.status(400).json({
          ok: false,
          error: "Kode Telegram belum diisi."
        });
      }

      try {
        const { Api } = await getTeleprotoRuntime();

        const result = await client.invoke(
          new Api.auth.SignIn({
            phoneNumber: row.phone,
            phoneCodeHash: row.phone_code_hash,
            phoneCode: code
          })
        );

        const className = String(
          result?.className ||
          result?.constructor?.name ||
          ""
        );

        if (/SignUpRequired/i.test(className)) {
          throw new Error(
            "Nomor ini belum mempunyai akun Telegram aktif."
          );
        }
      } catch (error) {
        const msg =
          error?.errorMessage ||
          error?.message ||
          String(error);

        if (msg === "SESSION_PASSWORD_NEEDED") {
          const { error: updateError } = await supabase
            .from("gemini_checker_login_sessions")
            .update({
              temp_session: client.session.save(),
              needs_2fa: true
            })
            .eq("id", loginId);

          if (updateError) throw updateError;

          return res.status(200).json({
            ok: false,
            needs2FA: true,
            message:
              "Akun memakai Two-Step Verification. Masukkan password 2FA."
          });
        }

        throw error;
      }
    }

    const authorized = await client.checkAuthorization();
    if (!authorized) {
      throw new Error(
        "Telegram belum menganggap session terotorisasi."
      );
    }

    const me = await client.getMe();
    const sessionString = client.session.save();

    await supabase
      .from("gemini_checker_login_sessions")
      .delete()
      .eq("id", loginId);

    return res.status(200).json({
      ok: true,
      account: {
        id: String(me?.id || ""),
        username: me?.username || null,
        firstName: me?.firstName || null
      },
      sessionString,
      message:
        "Login berhasil. Copy sessionString ke TELEGRAM_USER_SESSION di Vercel lalu Redeploy."
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      stage: "login_verify",
      error:
        error?.errorMessage ||
        error?.message ||
        String(error)
    });
  } finally {
    try {
      if (client) await client.disconnect();
    } catch {}
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "POST only"
    });
  }

  if (!checkSetupKey(req)) {
    return res.status(401).json({
      ok: false,
      error: "Setup key salah."
    });
  }

  const action = String(req.query?.action || "").toLowerCase();

  if (action === "start") {
    return startLogin(req, res);
  }

  if (action === "verify") {
    return verifyLogin(req, res);
  }

  return res.status(404).json({
    ok: false,
    error: "Action userbot-auth tidak dikenal."
  });
}

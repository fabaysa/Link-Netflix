import test from "node:test";
import assert from "node:assert/strict";
import {
  extractCookiesFromText,
  extractCookiesFromResult,
  parseBotReply
} from "../lib/bot-parser.js";
import {
  saveUserLastAccountCookies,
  getUserLastAccountCookies,
  clearUserLastAccountCookies
} from "../lib/store.js";

test("extractCookiesFromText: should parse various cookie formats correctly", () => {
  // 1. JSON Array of cookies
  const rawJson = JSON.stringify([
    { name: "NetflixId", value: "v%3D3%26ct%3DBQAOAAE..." },
    { name: "SecureNetflixId", value: "v%3D3%26mac%3DAQE..." }
  ]);
  const textWithJson = `Akun berhasil digenerate!\nBerikut cookies Anda:\n${rawJson}\nGunakan dengan bijak.`;
  const extractedJson = extractCookiesFromText(textWithJson);
  assert.ok(extractedJson, "Cookies JSON harus berhasil diekstrak");
  assert.ok(extractedJson.includes("NetflixId"));
  assert.ok(extractedJson.startsWith("[") && extractedJson.endsWith("]"));

  // 2. Markdown code block
  const markdownText = "Berikut cookies:\n```json\n" + rawJson + "\n```\nSelesai.";
  const extractedMarkdown = extractCookiesFromText(markdownText);
  assert.ok(extractedMarkdown, "Cookies dalam markdown block harus berhasil diekstrak");
  assert.ok(extractedMarkdown.includes("NetflixId"));

  // 3. Cookie string format (NetflixId=...; SecureNetflixId=...)
  const stringCookies = "NetflixId=v%3D3%26ct%3D123; SecureNetflixId=v%3D3%26mac%3D456; Path=/; Domain=.netflix.com";
  const extractedString = extractCookiesFromText(`Hasil generate:\n${stringCookies}`);
  assert.ok(extractedString, "String format cookies harus berhasil diekstrak");
  assert.ok(extractedString.includes("NetflixId="));
  assert.ok(extractedString.includes("SecureNetflixId="));

  // 4. Return null if no cookies present
  const plainText = "Ini pesan tanpa cookies sama sekali. Silakan coba lagi.";
  assert.equal(extractCookiesFromText(plainText), null);
});

test("parseBotReply: includes extracted cookies attribute", () => {
  const rawJson = JSON.stringify([
    { name: "NetflixId", value: "test-netflix-id-value" }
  ]);
  const sampleReply = [
    "✅ NETFLIX Token Berhasil Digenerate!",
    "",
    "🖥️ PC / Laptop: https://netflix.com/?nftoken=sample_token_pc",
    "📱 HP / Mobile: https://netflix.com/?nftoken=sample_token_mobile",
    "",
    "Cookies:",
    rawJson
  ].join("\n");

  const parsed = parseBotReply(sampleReply);
  assert.ok(parsed.cookies, "Parsed result harus mengandung field cookies");
  assert.ok(parsed.cookies.includes("test-netflix-id-value"));
  assert.equal(parsed.pcUrl, "https://netflix.com/?nftoken=sample_token_pc");
});

test("store: saveUserLastAccountCookies, getUserLastAccountCookies, and clearUserLastAccountCookies", async () => {
  const testUserId = 88991122;
  const sampleCookies = JSON.stringify([
    { name: "NetflixId", value: "user-session-id-9988" }
  ]);

  // Pastikan bersih di awal
  await clearUserLastAccountCookies(testUserId);
  const initial = await getUserLastAccountCookies(testUserId);
  assert.equal(initial, null);

  // Simpan cookies pertama kali
  const saved = await saveUserLastAccountCookies(testUserId, sampleCookies, {
    country: "ID",
    targetBot: "SSNetflixBot"
  });
  assert.ok(saved, "saveUserLastAccountCookies harus berhasil");

  // Baca kembali
  const retrieved = await getUserLastAccountCookies(testUserId);
  assert.ok(retrieved, "Data akun harus ditemukan");
  assert.equal(retrieved.cookies, sampleCookies);
  assert.equal(retrieved.country, "ID");
  assert.ok(retrieved.savedAt, "Waktu penyimpanan harus tercatat");

  // Update dengan cookies baru (menggantikan cookies lama)
  const newCookies = JSON.stringify([
    { name: "NetflixId", value: "user-session-id-NEW-2026" }
  ]);
  await saveUserLastAccountCookies(testUserId, newCookies, {
    country: "SG",
    targetBot: "SSNetflixBot"
  });

  const updated = await getUserLastAccountCookies(testUserId);
  assert.ok(updated);
  assert.equal(updated.cookies, newCookies);
  assert.equal(updated.country, "SG");

  // Bersihkan kembali
  await clearUserLastAccountCookies(testUserId);
  const afterClear = await getUserLastAccountCookies(testUserId);
  assert.equal(afterClear, null);
});

test("flow logic: same account vs new account payload separation", () => {
  // Simulasi penentuan payload berdasarkan mode
  const testCookies = "NetflixId=existing_session_cookie; SecureNetflixId=sec_cookie;";
  
  function determineJobPayload(mode, storedCookies) {
    if (mode === "sama") {
      if (!storedCookies) {
        return { payload: "generate", isSameAccount: false };
      }
      return { payload: storedCookies, isSameAccount: true };
    }
    // mode === "baru"
    return { payload: "generate", isSameAccount: false };
  }

  // 1. User minta akun sama & punya cookies
  const sameWithCookie = determineJobPayload("sama", testCookies);
  assert.equal(sameWithCookie.payload, testCookies);
  assert.equal(sameWithCookie.isSameAccount, true);

  // 2. User minta akun sama tapi belum ada cookies tersimpan
  const sameWithoutCookie = determineJobPayload("sama", null);
  assert.equal(sameWithoutCookie.payload, "generate");
  assert.equal(sameWithoutCookie.isSameAccount, false);

  // 3. User minta akun baru
  const newAccount = determineJobPayload("baru", testCookies);
  assert.equal(newAccount.payload, "generate");
  assert.equal(newAccount.isSameAccount, false);
});

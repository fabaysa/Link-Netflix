import test from "node:test";
import assert from "node:assert/strict";
import {
  getTargetBots,
  getActiveTargetBots,
  addTargetBot,
  setPrimaryTargetBot,
  deleteTargetBot,
  getSetting
} from "../lib/store.js";
import {
  targetLoginUsername,
  targetCookieUsername
} from "../lib/userbot.js";

test("target bots separation: login link generator vs cookie-to-token bots", async () => {
  // 1. Initial state has both types separated
  const loginBots = await getTargetBots("login");
  const cookieBots = await getTargetBots("cookie");
  const allBots = await getTargetBots("all");

  assert.ok(loginBots.length >= 1, "Harus ada minimal 1 bot login default");
  assert.ok(cookieBots.length >= 1, "Harus ada minimal 1 bot cookie default");
  assert.equal(loginBots.every((b) => b.type === "login"), true);
  assert.equal(cookieBots.every((b) => b.type === "cookie"), true);
  assert.equal(allBots.length, loginBots.length + cookieBots.length);

  // 2. Add new login bot
  const newLogin = await addTargetBot({
    username: "TestLoginBotNew",
    type: "login"
  });
  assert.equal(newLogin.type, "login");

  // 3. Add new cookie bot
  const newCookie = await addTargetBot({
    username: "TestCookieBotNew",
    type: "cookie"
  });
  assert.equal(newCookie.type, "cookie");

  // 4. Verify loginBots only contains login bots
  const updatedLoginBots = await getTargetBots("login");
  assert.ok(updatedLoginBots.some((b) => b.username === "TestLoginBotNew"));
  assert.ok(!updatedLoginBots.some((b) => b.username === "TestCookieBotNew"));

  // 5. Verify cookieBots only contains cookie bots
  const updatedCookieBots = await getTargetBots("cookie");
  assert.ok(updatedCookieBots.some((b) => b.username === "TestCookieBotNew"));
  assert.ok(!updatedCookieBots.some((b) => b.username === "TestLoginBotNew"));

  // 6. Set newCookie as primary cookie bot
  await setPrimaryTargetBot(newCookie.id);
  const activeCookies = await getActiveTargetBots("cookie");
  assert.equal(activeCookies[0].username, "TestCookieBotNew");
  assert.equal(activeCookies[0].priority, 1);

  // Check that setting primary cookie bot did not reset or overwrite target_bot_login
  const activeLogins = await getActiveTargetBots("login");
  assert.notEqual(activeLogins[0].username, "TestCookieBotNew");

  // 7. Verify userbot helper functions return separate targets
  const currentLogin = await targetLoginUsername();
  const currentCookie = await targetCookieUsername();
  assert.ok(currentLogin, "targetLoginUsername harus terdefinisi");
  assert.ok(currentCookie, "targetCookieUsername harus terdefinisi");
  assert.notEqual(currentLogin.toLowerCase(), currentCookie.toLowerCase(), "Target login dan target cookie tidak boleh sama");

  // Clean up test bots
  await deleteTargetBot(newLogin.id);
  await deleteTargetBot(newCookie.id);
});

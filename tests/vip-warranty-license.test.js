import test from "node:test";
import assert from "node:assert/strict";
import {
  checkUserWarranty,
  getSetting,
  setSetting,
  isAdmin
} from "../lib/store.js";

test("checkUserWarranty returns 0 dailyLimit and 0 remainingToday for unlicensed user", async () => {
  const fakeUserId = 999999999999;
  const warranty = await checkUserWarranty(fakeUserId);

  assert.equal(warranty.hasActiveWarranty, false);
  assert.equal(warranty.isExpired, true);
  assert.equal(warranty.dailyLimit, 0, "Unlicensed user must have 0 daily limit");
  assert.equal(warranty.remainingToday, 0, "Unlicensed user must have 0 remaining quota");
  assert.equal(warranty.isBanned, false);
});

test("require_warranty setting defaults to true", async () => {
  const requireWarranty = await getSetting("require_warranty");
  assert.equal(requireWarranty, true, "require_warranty must default to true so VIP license is mandatory");
});

test("isAdmin correctly identifies owner and admin IDs", () => {
  process.env.OWNER_TELEGRAM_ID = "12345678";
  process.env.ADMIN_IDS = "87654321, 999888777";

  assert.equal(isAdmin("12345678"), true);
  assert.equal(isAdmin("87654321"), true);
  assert.equal(isAdmin("999888777"), true);
  assert.equal(isAdmin("111222333"), false);
  assert.equal(isAdmin(null), false);
  assert.equal(isAdmin(""), false);
});

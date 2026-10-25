import test from "node:test";
import assert from "node:assert/strict";
import {
  isTableMissingError,
  getSetting,
  setSetting,
  getPackages
} from "../lib/store.js";

test("isTableMissingError correctly identifies schema cache and missing table errors", () => {
  assert.equal(isTableMissingError(null), false);
  assert.equal(isTableMissingError({ code: "PGRST205", message: "Could not find the table 'public.bot_settings' in the schema cache" }), true);
  assert.equal(isTableMissingError({ message: "relation \"public.bot_settings\" does not exist" }), true);
  assert.equal(isTableMissingError(new Error("Could not find the table in the schema cache")), true);
  assert.equal(isTableMissingError({ code: "23505", message: "duplicate key value" }), false);
});

test("store functions fall back to in-memory defaults when database is unavailable", async () => {
  // Test fallback defaults
  const targetBot = await getSetting("target_bot", "DefaultBot");
  assert.ok(typeof targetBot === "string");

  // Test setSetting saves in-memory without throwing even if DB errors
  await setSetting("test_runtime_key", "test_value_123");
  const retrieved = await getSetting("test_runtime_key");
  assert.equal(retrieved, "test_value_123");

  // Test getPackages fallback
  const packages = await getPackages({ onlyEnabled: true });
  assert.ok(Array.isArray(packages));
  assert.ok(packages.length > 0);
  assert.equal(packages[0].id, "1_hari");
});

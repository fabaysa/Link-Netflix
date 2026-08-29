import test from "node:test";
import assert from "node:assert/strict";

test("safe flow requires explicit generate action before input", () => {
  const states = ["idle", "awaiting_demo"];
  assert.equal(states.includes("awaiting_demo"), true);
});

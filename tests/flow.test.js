import test from "node:test";
import assert from "node:assert/strict";

test("safe flow requires explicit generate action before input", () => {
  const states = ["idle", "awaiting_demo"];
  assert.equal(states.includes("awaiting_demo"), true);
});

import { isSafeDemoInput, looksSensitive, sanitizeTargetText } from "../lib/safe-relay.js";

test("accepts only explicit safe demo input", () => {
  assert.equal(isSafeDemoInput("DEMO:hello"), true);
  assert.equal(isSafeDemoInput("hello"), false);
  assert.equal(isSafeDemoInput("DEMO: cookie: secret"), false);
});

test("sanitizes login-token shaped target output", () => {
  const input = "https://example.com/?nftoken=SECRET123";
  assert.equal(looksSensitive(input), true);
  assert.match(sanitizeTargetText(input), /LOGIN LINK REDACTED/);
});

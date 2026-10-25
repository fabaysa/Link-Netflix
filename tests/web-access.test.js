import test from "node:test";
import assert from "node:assert/strict";
import { isSafeDemoInput, looksSensitive, sanitizeWebOutput } from "../lib/safe-relay.js";

test("web access accepts harmless DEMO payloads", () => {
  assert.equal(isSafeDemoInput("DEMO: Test Web Access"), true);
  assert.equal(looksSensitive("DEMO: Test Web Access"), false);
});

test("web access rejects credential-shaped payloads", () => {
  assert.equal(isSafeDemoInput("DEMO: cookie: NetflixId=secret"), false);
  assert.equal(isSafeDemoInput("DEMO: access_token=secret"), false);
});

test("web output removes token-shaped login links", () => {
  const value = "Ready https://example.test/login?nftoken=SECRET";
  assert.equal(sanitizeWebOutput(value), "Ready [LOGIN LINK REDACTED]");
});

test("web output removes ordinary URLs too", () => {
  assert.equal(sanitizeWebOutput("Open https://example.test/path"), "Open [URL REDACTED]");
});

import test from "node:test";
import assert from "node:assert/strict";
import { safeNetflixUrl, getPublicDeviceLinks } from "../lib/device-links.js";

test("device links accept only public HTTPS Netflix URLs", () => {
  assert.equal(
    safeNetflixUrl("https://www.netflix.com/id/login", "https://www.netflix.com/"),
    "https://www.netflix.com/id/login"
  );
  assert.equal(
    safeNetflixUrl("https://evil.example/login", "https://www.netflix.com/"),
    "https://www.netflix.com/"
  );
  assert.equal(
    safeNetflixUrl("javascript:alert(1)", "https://www.netflix.com/"),
    "https://www.netflix.com/"
  );
});

test("device links reject credential or session shaped URLs", () => {
  assert.equal(
    safeNetflixUrl("https://www.netflix.com/path?nftoken=SECRET", "https://www.netflix.com/"),
    "https://www.netflix.com/"
  );
  assert.equal(
    safeNetflixUrl("https://www.netflix.com/sessionid/SECRET", "https://www.netflix.com/"),
    "https://www.netflix.com/"
  );
});

test("default device links include PC, mobile, and TV", () => {
  const links = getPublicDeviceLinks();
  assert.equal(links.pc.label, "PC / Laptop");
  assert.equal(links.mobile.label, "HP / Mobile");
  assert.equal(links.tv.label, "TV / Smart TV");
  assert.match(links.tv.url, /^https:\/\/www\.netflix\.com\/tv8/);
});

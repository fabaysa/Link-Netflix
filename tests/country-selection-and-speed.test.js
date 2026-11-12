import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCountrySearchOrder,
  formatCountryButtonLabel,
  parseGeneratePayload
} from "../lib/country-button-finder.js";
import { executeNetflixBridgeFlow } from "../lib/netflix-bridge.js";

test("parseGeneratePayload parses standard and country-specific generate commands", () => {
  assert.deepEqual(parseGeneratePayload(""), {
    isAutoGenerate: true,
    requestedCountry: null
  });
  assert.deepEqual(parseGeneratePayload("generate"), {
    isAutoGenerate: true,
    requestedCountry: null
  });
  assert.deepEqual(parseGeneratePayload("generate:MY"), {
    isAutoGenerate: true,
    requestedCountry: "MY"
  });
  assert.deepEqual(parseGeneratePayload("ambil:id"), {
    isAutoGenerate: true,
    requestedCountry: "ID"
  });
  assert.deepEqual(parseGeneratePayload("generate:RANDOM"), {
    isAutoGenerate: true,
    requestedCountry: "RANDOM"
  });
  assert.deepEqual(parseGeneratePayload("NetflixId=v%3D2%26ct%3DBQAO"), {
    isAutoGenerate: false,
    requestedCountry: null
  });
});

test("buildCountrySearchOrder places user requested country first and shuffles remaining admin countries", () => {
  const adminList = ["ID", "MY", "SG", "TH"];
  const order = buildCountrySearchOrder(adminList, "SG");

  assert.equal(order[0], "SG");
  assert.equal(order.length, 4);
  assert.deepEqual([...order].sort(), ["ID", "MY", "SG", "TH"]);
});

test("buildCountrySearchOrder restricts fallback pool strictly to admin's allowed countries", () => {
  const adminList = ["ID", "MY", "SG"];
  // Even if an unexpected code is passed, only admin's allowed countries are used in the pool
  const order = buildCountrySearchOrder(adminList, "BR");
  assert.equal(order.length, 3);
  assert.deepEqual([...order].sort(), ["ID", "MY", "SG"]);
  assert.equal(order.includes("BR"), false);
});

test("formatCountryButtonLabel returns flag and country name", () => {
  assert.equal(formatCountryButtonLabel("ID"), "🇮🇩 Indonesia");
  assert.equal(formatCountryButtonLabel("MY"), "🇲🇾 Malaysia");
  assert.equal(formatCountryButtonLabel("SG"), "🇸🇬 Singapura");
});

test("executeNetflixBridgeFlow selects user's requested country first, and falls back randomly to admin's allowed list when out of stock", async () => {
  let msgIdCounter = 10;
  let earlyDelivered = null;
  let step7CompletedAfterEarly = false;

  const messages = [{ id: 1, out: false, message: "Old message" }];

  const mockClient = {
    getEntity: async (target) => ({ username: target }),
    getMessages: async () => [...messages],
    sendMessage: async (_entity, { message }) => {
      const sentMsg = { id: ++msgIdCounter, out: true, message };
      messages.push(sentMsg);

      if (message === "/start") {
        // Directly show Country Menu where SG is 0 stock, FR is not in Admin list, and MY is in Admin list with stock > 0
        messages.push({
          id: ++msgIdCounter,
          out: false,
          message: "🌍 Select a country (Page: 1/1):",
          buttons: [
            [
              { text: "🇸🇬 Singapore (0)", data: Buffer.from("country_SG") },
              { text: "🇫🇷 France (9)", data: Buffer.from("country_FR") }
            ],
            [
              { text: "🇲🇾 Malaysia (4)", data: Buffer.from("country_MY") }
            ]
          ],
          click: async ({ i, j }) => {
            const clickedBtn = [
              [
                { text: "🇸🇬 Singapore (0)" },
                { text: "🇫🇷 France (9)" }
              ],
              [
                { text: "🇲🇾 Malaysia (4)" }
              ]
            ][i][j];

            messages.push({
              id: ++msgIdCounter,
              out: false,
              message: [
                `✅ Selected: ${clickedBtn.text}`,
                "🖥️ PC: https://netflix.com/?nftoken=TokenPC_MY",
                "📱 Mobile: https://www.netflix.com/unsupported?nftoken=TokenMobile_MY",
                "📺 TV: https://www.netflix.com/tv9?nftoken=TokenTV_MY",
                "Cookies: NetflixId=v%3D2%26ct%3DBQAO_MY; SecureNetflixId=v%3D2"
              ].join("\n"),
              buttons: [
                [{ text: "Working ✅", data: Buffer.from("working_ok") }]
              ],
              click: async () => {
                if (earlyDelivered) {
                  step7CompletedAfterEarly = true;
                }
              }
            });
          }
        });
      }
      return sentMsg;
    },
    sendFile: async () => ({ id: ++msgIdCounter, out: true })
  };

  // User requested "SG", Admin configured ["ID", "MY", "SG"].
  // SG has 0 stock, FR has 9 stock (not in Admin list -> must be ignored!), MY has 4 stock (in Admin list -> must be chosen!).
  const result = await executeNetflixBridgeFlow(mockClient, {
    targetBot: "SSNetflixBot",
    countryPriorities: ["ID", "MY", "SG"],
    requestedCountry: "SG",
    onResultReady: async (earlyRes) => {
      earlyDelivered = earlyRes;
    },
    timeoutMs: 30000
  });

  assert.equal(result.ok, true);
  assert.equal(result.requestedCountry, "SG");
  assert.equal(result.country, "MY");
  assert.equal(result.fallbackUsed, true);
  assert.ok(earlyDelivered, "onResultReady should be called before Step 7/8");
  assert.equal(earlyDelivered.country, "MY");
  assert.equal(step7CompletedAfterEarly, true);
});


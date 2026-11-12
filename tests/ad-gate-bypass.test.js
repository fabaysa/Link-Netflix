import test from "node:test";
import assert from "node:assert/strict";
import {
  extractAdGateInfo,
  findLatestAdGateMessage,
  findWelcomeButton,
  isAdThankYouMessage,
  visitAdGateUrl
} from "../lib/ad-gate-bypass.js";
import { executeNetflixBridgeFlow } from "../lib/netflix-bridge.js";

const SAMPLE_AD_MESSAGE_TEXT = `☕ Hey, wanna buy me a cup of coffee?
🇬🇧 English:
This bot is completely FREE for everyone. If you like it, you can support the owner just by watching a quick ad — that’s like buying him a cup of coffee. ☕
⚠️ Only watch the ad. Don’t fall for any offers or tricks inside it — those could be scammers’ traps.
🇧🇩 বাংলা:
বটটি সবার জন্য সম্পূর্ণ FREE। ভালো লাগলে শুধু একটা এডস দেখেই Owner-কে support করতে পারেন — এড দেখুন তাকে এক কাপ coffee খাওয়ান। ☕
⚠️ শুধু Ads দেখবেন, ভেতরের কোনো প্রলোভন বা অফারে ভুলবেন না — এগুলো scammer-দের ফাঁদও হতে পারে।`;

test("extractAdGateInfo detects @SSNetflixBot ad message with dynamic telebotcreator URLs", () => {
  const msg1 = {
    id: 101,
    out: false,
    message: SAMPLE_AD_MESSAGE_TEXT,
    entities: [
      { url: "https://web.telegram.org/k/assets/img/emoji/2615.png" }
    ],
    buttons: [
      [
        {
          text: "☕ Watch Ad / Support",
          url: "https://api.telebotcreator.com/ads/go/DMQvj04tmI1virelBkQ9RrYCDE1gsbFU"
        }
      ]
    ]
  };

  const info1 = extractAdGateInfo(msg1);
  assert.equal(info1.isAdGate, true);
  assert.equal(info1.adUrl, "https://api.telebotcreator.com/ads/go/DMQvj04tmI1virelBkQ9RrYCDE1gsbFU");
  assert.equal(info1.messageId, 101);

  // Dynamic rotating URL token test
  const msg2 = {
    id: 205,
    out: false,
    message: SAMPLE_AD_MESSAGE_TEXT,
    replyMarkup: {
      rows: [
        {
          buttons: [
            {
              text: "Watch Ad",
              url: "https://api.telebotcreator.com/ads/go/XyZ987654321DynamicTokenAbC"
            }
          ]
        }
      ]
    }
  };

  const info2 = extractAdGateInfo(msg2);
  assert.equal(info2.isAdGate, true);
  assert.equal(info2.adUrl, "https://api.telebotcreator.com/ads/go/XyZ987654321DynamicTokenAbC");
  assert.equal(info2.messageId, 205);
});

test("isAdThankYouMessage and findWelcomeButton detect Thank You confirmation and Welcome button", () => {
  const thankYouMsg = {
    id: 102,
    out: false,
    message: "🎉 Thank You! You Can Use this Bot Now.",
    buttons: [
      [
        {
          text: "Welcome",
          data: Buffer.from("welcome_cb")
        }
      ]
    ]
  };

  assert.equal(isAdThankYouMessage(thankYouMsg), true);
  const welcomeBtn = findWelcomeButton(thankYouMsg);
  assert.ok(welcomeBtn);
  assert.equal(welcomeBtn.text, "Welcome");
  assert.equal(welcomeBtn.row, 0);
  assert.equal(welcomeBtn.col, 0);
});

test("visitAdGateUrl follows redirects and preserves cookies across hops", async () => {
  const hitLog = [];

  const mockFetch = async (url, opts) => {
    hitLog.push({ url, headers: opts.headers });

    if (url === "https://api.telebotcreator.com/ads/go/TOKEN_123") {
      return {
        status: 302,
        headers: {
          get: (k) => (k.toLowerCase() === "location" ? "https://api.telebotcreator.com/ads/verify/TOKEN_123" : null),
          getSetCookie: () => ["tbc_session=abc999; Path=/; HttpOnly"]
        },
        text: async () => ""
      };
    }

    return {
      status: 200,
      headers: {
        get: () => null,
        getSetCookie: () => []
      },
      text: async () => "<html><body>Thank you for watching!</body></html>"
    };
  };

  const res = await visitAdGateUrl("https://api.telebotcreator.com/ads/go/TOKEN_123", {
    fetchImpl: mockFetch
  });

  assert.equal(res.ok, true);
  assert.equal(hitLog.length, 2);
  assert.equal(hitLog[0].url, "https://api.telebotcreator.com/ads/go/TOKEN_123");
  assert.equal(hitLog[1].url, "https://api.telebotcreator.com/ads/verify/TOKEN_123");
  assert.match(hitLog[1].headers.Cookie, /tbc_session=abc999/);
});

test("executeNetflixBridgeFlow automatically bypasses Ad Gate when triggered on Generate Now click", async () => {
  let msgIdCounter = 10;
  let adVisited = false;
  let welcomeClicked = false;
  let generateCount = 0;
  const visitedAdUrls = [];

  const messages = [
    { id: 1, out: false, message: "Old message" }
  ];

  const mockFetch = async (url) => {
    visitedAdUrls.push(url);
    adVisited = true;
    // Simulate @SSNetflixBot sending "🎉 Thank You! You Can Use this Bot Now." with "Welcome" button once URL is opened
    const tyId = ++msgIdCounter;
    const tyMsg = {
      id: tyId,
      out: false,
      message: "🎉 Thank You! You Can Use this Bot Now.",
      buttons: [
        [
          {
            text: "Welcome",
            data: Buffer.from("welcome_action")
          }
        ]
      ],
      click: async () => {
        welcomeClicked = true;
        // Clicking Welcome brings up the main menu with "🎬 Generate Now"
        messages.push({
          id: ++msgIdCounter,
          out: false,
          message: "Welcome to SSNetflixBot! Click below to generate:",
          buttons: [
            [
              {
                text: "🎬 Generate Now",
                data: Buffer.from("gen_now")
              }
            ]
          ],
          click: handleGenerateClick
        });
      }
    };
    messages.push(tyMsg);
    return {
      status: 200,
      headers: { get: () => null, getSetCookie: () => [] },
      text: async () => "OK"
    };
  };

  const handleGenerateClick = async () => {
    generateCount++;
    if (!adVisited) {
      // First time Generate is clicked: @SSNetflixBot shows Ad Gate with dynamic URL
      messages.push({
        id: ++msgIdCounter,
        out: false,
        message: SAMPLE_AD_MESSAGE_TEXT,
        buttons: [
          [
            {
              text: "☕ Support Owner (Watch Ad)",
              url: "https://api.telebotcreator.com/ads/go/DynamicCode778899"
            }
          ]
        ]
      });
      return;
    }

    // Second time Generate is clicked (after Ad Gate is bypassed): @SSNetflixBot shows Country Menu
    messages.push({
      id: ++msgIdCounter,
      out: false,
      message: "🌍 Select a country (Page: 1/1):",
      buttons: [
        [
          {
            text: "🇮🇩 Indonesia (5)",
            data: Buffer.from("country_ID")
          }
        ]
      ],
      click: async () => {
        // Clicking country returns the Netflix Login URLs and Cookies
        messages.push({
          id: ++msgIdCounter,
          out: false,
          message: [
            "✅ NFT Token Berhasil Digenerate!",
            "🖥️ PC: https://netflix.com/?nftoken=TokenPC123",
            "📱 Mobile: https://www.netflix.com/unsupported?nftoken=TokenMobile123",
            "📺 TV: https://www.netflix.com/tv9?nftoken=TokenTV123",
            "Cookies: NetflixId=v%3D2%26ct%3DBQAOAAEBEK_test; SecureNetflixId=v%3D2%26mac%3DAQE"
          ].join("\n"),
          buttons: [
            [
              {
                text: "Working ✅",
                data: Buffer.from("working_ok")
              }
            ]
          ],
          click: async () => {}
        });
      }
    });
  };

  const mockClient = {
    getEntity: async (target) => ({ username: target }),
    getMessages: async () => [...messages],
    sendMessage: async (_entity, { message }) => {
      const sentMsg = { id: ++msgIdCounter, out: true, message };
      messages.push(sentMsg);

      if (message === "/start") {
        messages.push({
          id: ++msgIdCounter,
          out: false,
          message: "Welcome to SSNetflixBot!",
          buttons: [
            [
              {
                text: "🎬 Generate Now",
                data: Buffer.from("gen_now")
              }
            ]
          ],
          click: handleGenerateClick
        });
      }
      return sentMsg;
    },
    sendFile: async () => ({ id: ++msgIdCounter, out: true })
  };

  const result = await executeNetflixBridgeFlow(mockClient, {
    targetBot: "SSNetflixBot",
    countryPriorities: ["ID"],
    timeoutMs: 45000,
    fetchImpl: mockFetch
  });

  assert.equal(result.ok, true);
  assert.equal(adVisited, true);
  assert.equal(welcomeClicked, true);
  assert.equal(visitedAdUrls[0], "https://api.telebotcreator.com/ads/go/DynamicCode778899");
  assert.equal(generateCount, 2);
  assert.equal(result.country, "ID");
  assert.match(result.pcUrl, /TokenPC123/);
  assert.match(result.mobileUrl, /TokenMobile123/);
  assert.match(result.tvUrl, /TokenTV123/);
  assert.match(result.cookies, /NetflixId=/);
});


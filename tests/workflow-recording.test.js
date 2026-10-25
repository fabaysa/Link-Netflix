import test from "node:test";
import assert from "node:assert/strict";
import { renderFlowSnapshot } from "../lib/workflow-recorder.js";
import { getRecordedWorkflow, saveRecordedWorkflow, deleteRecordedWorkflow } from "../lib/store.js";

test("renderFlowSnapshot formats snapshot with numbered buttons and redacted secrets", () => {
  const snapshot = {
    targetBot: "TestNetflixBot",
    steps: [
      { type: "send_text", text: "/start" }
    ],
    recentMessages: [
      { id: 101, text: "Welcome to bot! Click Generate below." },
      { id: 102, text: "Token: https://netflix.com/nftoken=secret123 code 123456" }
    ],
    buttons: [
      { index: 1, text: "🎬 Generate Now", row: 0, column: 0 },
      { index: 2, text: "📢 Join Channel", url: "https://t.me/example", row: 1, column: 0 }
    ]
  };

  const html = renderFlowSnapshot(snapshot);

  assert.match(html, /TestNetflixBot/);
  assert.match(html, /🎬 Generate Now/);
  assert.match(html, /📢 Join Channel/);
  assert.match(html, /\/rekam_klik NOMOR/);
  assert.match(html, /\/rekam_selesai/);
  assert.doesNotMatch(html, /secret123/);
  assert.doesNotMatch(html, /\b123456\b/);
});

test("saveRecordedWorkflow and getRecordedWorkflow persistence fallback", async () => {
  const sample = {
    targetBot: "NewBot",
    recordedAt: new Date().toISOString(),
    stepsCount: 2,
    steps: [
      { type: "send_text", text: "/start" },
      { type: "click_button", buttonText: "🎬 Generate Now", row: 0, col: 0 }
    ]
  };

  await saveRecordedWorkflow(sample);
  const fetched = await getRecordedWorkflow();

  assert.equal(fetched.targetBot, "NewBot");
  assert.equal(fetched.steps.length, 2);
  assert.equal(fetched.steps[1].buttonText, "🎬 Generate Now");

  await deleteRecordedWorkflow();
  const cleared = await getRecordedWorkflow();
  assert.equal(cleared, null);
});

test("multiple target bots management: add, priority, toggle, delete", async () => {
  const {
    getTargetBots,
    getActiveTargetBots,
    getTargetBot,
    addTargetBot,
    updateTargetBot,
    setPrimaryTargetBot,
    deleteTargetBot
  } = await import("../lib/store.js");

  // Initial bots
  const initial = await getTargetBots();
  assert.ok(Array.isArray(initial));
  assert.ok(initial.length >= 1);

  // Add a new bot
  const botA = await addTargetBot({ username: "CheckerBotAlpha", label: "Alpha" });
  assert.equal(botA.username, "CheckerBotAlpha");

  const botB = await addTargetBot({ username: "CheckerBotBeta", label: "Beta" });
  assert.equal(botB.username, "CheckerBotBeta");

  // Get bot by username (case-insensitive)
  const found = await getTargetBot("checkerbotalpha");
  assert.equal(found.id, botA.id);

  // Set Beta as primary
  await setPrimaryTargetBot(botB.id);
  const activeBots = await getActiveTargetBots();
  assert.equal(activeBots[0].username, "CheckerBotBeta");
  assert.equal(activeBots[0].priority, 1);

  // Toggle Alpha disabled
  await updateTargetBot(botA.id, { enabled: false });
  const activeAfterDisable = await getActiveTargetBots();
  assert.equal(activeAfterDisable.some((b) => b.username === "CheckerBotAlpha"), false);

  // Delete Beta
  await deleteTargetBot(botB.id);
  const remaining = await getTargetBots();
  assert.equal(remaining.some((b) => b.username === "CheckerBotBeta"), false);

  // Clean up Alpha
  await deleteTargetBot(botA.id);
});

test("per-bot workflow isolation across multiple targets", async () => {
  const {
    saveRecordedWorkflow,
    getRecordedWorkflow,
    deleteRecordedWorkflow,
    getAllRecordedWorkflows
  } = await import("../lib/store.js");

  const flowBot1 = {
    targetBot: "BotOne",
    recordedAt: new Date().toISOString(),
    stepsCount: 1,
    steps: [{ type: "send_text", text: "/start" }]
  };

  const flowBot2 = {
    targetBot: "BotTwo",
    recordedAt: new Date().toISOString(),
    stepsCount: 2,
    steps: [
      { type: "send_text", text: "/start" },
      { type: "click_button", buttonText: "Generate", row: 0, col: 0 }
    ]
  };

  await saveRecordedWorkflow(flowBot1, "BotOne");
  await saveRecordedWorkflow(flowBot2, "BotTwo");

  const fetched1 = await getRecordedWorkflow("botone");
  const fetched2 = await getRecordedWorkflow("bottwo");

  assert.equal(fetched1.steps.length, 1);
  assert.equal(fetched2.steps.length, 2);

  const all = await getAllRecordedWorkflows();
  assert.ok(all.botone);
  assert.ok(all.bottwo);

  await deleteRecordedWorkflow("botone");
  assert.equal(await getRecordedWorkflow("botone"), null);
  assert.ok(await getRecordedWorkflow("bottwo"));

  await deleteRecordedWorkflow("bottwo");
  assert.equal(await getRecordedWorkflow("bottwo"), null);
});

test("country menu message and country action detection", async () => {
  const {
    isCountryMenuMessage,
    isCountryAction,
    isCountryChoiceLabel,
    findCountryButtonPosition,
    COUNTRY_NAMES
  } = await import("../lib/country-button-finder.js");

  // Country name and emoji mapping
  assert.equal(COUNTRY_NAMES.ID, "Indonesia 🇮🇩");
  assert.equal(COUNTRY_NAMES.MY, "Malaysia 🇲🇾");
  assert.equal(COUNTRY_NAMES.SG, "Singapura 🇸🇬");

  // Detection via text
  const textMsg = { message: "Please select a country to generate cookies:" };
  assert.equal(isCountryMenuMessage(textMsg), true);

  // Detection via 2 or more country buttons
  const buttonMsg = {
    message: "Choose:",
    buttons: [
      [{ text: "🇮🇩 Indonesia (5)" }, { text: "🇲🇾 Malaysia (0)" }],
      [{ text: "▶️ Next Page" }]
    ]
  };
  assert.equal(isCountryMenuMessage(buttonMsg), true);

  // Non-country menu message
  const regularMsg = {
    message: "Welcome! Click generate to continue:",
    buttons: [[{ text: "🎬 Generate Now" }]]
  };
  assert.equal(isCountryMenuMessage(regularMsg), false);

  // Country action detection
  assert.equal(isCountryAction({ type: "select_country_priority" }), true);
  assert.equal(isCountryAction({ type: "click_button", buttonText: "🇮🇩 Indonesia" }), true);
  assert.equal(isCountryAction({ type: "click_button", buttonText: "Join Channel" }), false);

  // Stock check: stock 0 should be skipped if checkStock = true
  const rows = [
    [{ text: "🇮🇩 Indonesia (0)" }, { text: "🇲🇾 Malaysia (12)" }]
  ];
  const idPos = findCountryButtonPosition(rows, "ID", { checkStock: true });
  assert.equal(idPos, null); // out of stock

  const myPos = findCountryButtonPosition(rows, "MY", { checkStock: true });
  assert.deepEqual(myPos, { row: 0, column: 1 }); // available stock
});

test("renderFlowSnapshot highlights multi-country priority when country buttons are present", () => {
  const snapshot = {
    targetBot: "SSNetflixBot",
    steps: [
      { type: "send_text", text: "/start" },
      { type: "click_button", buttonText: "Joined Successfully ✅" },
      { type: "click_button", buttonText: "🎬 Generate Now" }
    ],
    recentMessages: [
      { id: 201, text: "Select a country:" }
    ],
    buttons: [
      { index: 1, text: "🇮🇩 Indonesia (0)", row: 0, column: 0 },
      { index: 2, text: "🇲🇾 Malaysia (8)", row: 0, column: 1 },
      { index: 3, text: "🇸🇬 Singapore (2)", row: 1, column: 0 },
      { index: 4, text: "▶️ Next", row: 1, column: 1 }
    ]
  };

  const html = renderFlowSnapshot(snapshot);

  assert.match(html, /TERDETEKSI MENU PILIHAN NEGARA/);
  assert.match(html, /Prioritas Negara/);
  assert.match(html, /Urutan Alur yang Sudah Terekam/);
  assert.match(html, /Joined Successfully/);
  assert.match(html, /🎬 Generate Now/);
});

test("multi-page country priority search and automatic fallback logic simulation", async () => {
  const {
    findCountryButtonPosition,
    findNextButtonPosition,
    findPrevButtonPosition,
    extractButtonStock,
    countryMatchesButton
  } = await import("../lib/country-button-finder.js");

  // Simulated multi-page target bot messages
  const pages = [
    // Page 1: Malaysia (stock: 5), Singapore (stock: 0), Next
    {
      page: 1,
      buttons: [
        [{ text: "🇲🇾 Malaysia (5)" }, { text: "🇸🇬 Singapore (0)" }],
        [{ text: "▶️ Next" }]
      ]
    },
    // Page 2: Thailand (stock: 10), Indonesia (stock: 0), Prev, Next
    {
      page: 2,
      buttons: [
        [{ text: "🇹🇭 Thailand (10)" }, { text: "🇮🇩 Indonesia (0)" }],
        [{ text: "◀️ Prev" }, { text: "▶️ Next" }]
      ]
    },
    // Page 3: Vietnam (stock: 3), Prev
    {
      page: 3,
      buttons: [
        [{ text: "🇻🇳 Vietnam (3)" }],
        [{ text: "◀️ Prev" }]
      ]
    }
  ];

  const priorities = ["ID", "MY", "SG", "VN"];
  const primaryCountry = priorities[0]; // ID

  const seenPriorities = new Map();

  // Scan through pages looking for primaryCountry
  let selectedPrimary = null;
  for (let p = 0; p < pages.length; p++) {
    const pageObj = pages[p];
    const rows = pageObj.buttons;

    // Record all seen priority countries with stock > 0
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const text = rows[r][c].text;
        for (const code of priorities) {
          if (countryMatchesButton(text, code)) {
            const stock = extractButtonStock(text);
            if (stock !== 0 && !seenPriorities.has(code)) {
              seenPriorities.set(code, {
                countryCode: code,
                pageNumber: pageObj.page,
                stock,
                text
              });
            }
          }
        }
      }
    }

    // Check if primaryCountry has stock on this page
    const pos = findCountryButtonPosition(rows, primaryCountry, { checkStock: true });
    if (pos) {
      selectedPrimary = primaryCountry;
      break;
    }
  }

  // Indonesia (ID) had 0 stock on Page 2, so primary was not selected
  assert.equal(selectedPrimary, null);

  // Fallback to highest available priority:
  let fallback = null;
  for (let i = 1; i < priorities.length; i++) {
    const code = priorities[i];
    if (seenPriorities.has(code)) {
      fallback = seenPriorities.get(code);
      break;
    }
  }

  // Priority 2 is MY (Malaysia) on Page 1 with stock 5
  assert.ok(fallback);
  assert.equal(fallback.countryCode, "MY");
  assert.equal(fallback.pageNumber, 1);
  assert.equal(fallback.stock, 5);
});


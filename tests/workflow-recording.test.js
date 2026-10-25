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

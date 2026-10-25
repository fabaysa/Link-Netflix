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

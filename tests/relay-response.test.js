import test from "node:test";
import assert from "node:assert/strict";
import {
  extractUrlButtons,
  serializeIncomingMessage
} from "../lib/relay-response.js";

test("extracts only URL buttons and preserves rows", () => {
  const message = {
    replyMarkup: {
      rows: [
        {
          buttons: [
            { text: "PC Login", url: "https://example.com/pc" },
            { text: "Callback", data: Buffer.from("x") }
          ]
        },
        {
          buttons: [
            { text: "Mobile", url: "https://example.com/mobile" }
          ]
        }
      ]
    }
  };

  assert.deepEqual(extractUrlButtons(message), [
    [{ text: "PC Login", url: "https://example.com/pc" }],
    [{ text: "Mobile", url: "https://example.com/mobile" }]
  ]);
});

test("serializes text and message id", () => {
  const result = serializeIncomingMessage({
    id: 42,
    message: "hello",
    replyMarkup: null
  });

  assert.equal(result.messageId, 42);
  assert.equal(result.text, "hello");
  assert.deepEqual(result.urlButtons, []);
});

import { renderTelegramHtml } from "../lib/relay-response.js";

test("renders basic Telegram formatting entities as HTML", () => {
  const text = "Hello world";
  const html = renderTelegramHtml(text, [
    { type: "bold", offset: 0, length: 5 },
    { type: "code", offset: 6, length: 5 }
  ]);
  assert.equal(html, "<b>Hello</b> <code>world</code>");
});

test("escapes raw HTML while preserving formatting", () => {
  const html = renderTelegramHtml("<ok>", [
    { type: "bold", offset: 0, length: 4 }
  ]);
  assert.equal(html, "<b>&lt;ok&gt;</b>");
});

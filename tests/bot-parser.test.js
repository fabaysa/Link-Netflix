import test from "node:test";
import assert from "node:assert/strict";
import { parseBotReply } from "../lib/bot-parser.js";

const SAMPLE_SUCCESS = `
✅ NFT Token Berhasil Digenerate!

🔗 NFT Token Links by Device:

🖥️ PC / Laptop:
https://netflix.com/?nftoken=Bgiqv+vcAxLCAdQBf58AzuctSpn1kc2NbYbf2LQ3R+0ffep2xqV9MlUFy05wQ1wwOW3O+WCUXaMVwrdHtmStFY7J/iErl0pd9mtesk+HzodxG11ehLY8kDHta14wlPu3OpwG1OWyqFBcqtDNAGyOIObvGeaC/IT8XYQIIw5ElHG9RNxB9Tv6N8ogT8SJ2WQ8q7S7CSw0v58vbQnSJOkhWE/LKrzQgY0cISKYCNygqvvFr9QTdI90qbTV1Cvnh9iXheATP+GUeLmKv41zGAYiDgoMwp5pcqSV44eQXRCk

📱 HP / Mobile:
https://www.netflix.com/unsupported?nftoken=Bgiqv+vcAxLCAdQBf58AzuctSpn1kc2NbYbf2LQ3R+0ffep2xqV9MlUFy05wQ1wwOW3O+WCUXaMVwrdHtmStFY7J/iErl0pd9mtesk+HzodxG11ehLY8kDHta14wlPu3OpwG1OWyqFBcqtDNAGyOIObvGeaC/IT8XYQIIw5ElHG9RNxB9Tv6N8ogT8SJ2WQ8q7S7CSw0v58vbQnSJOkhWE/LKrzQgY0cISKYCNygqvvFr9QTdI90qbTV1Cvnh9iXheATP+GUeLmKv41zGAYiDgoMwp5pcqSV44eQXRCk

📺 TV / Smart TV:
https://www.netflix.com/tv9?nftoken=Bgiqv+vcAxLCAdQBf58AzuctSpn1kc2NbYbf2LQ3R+0ffep2xqV9MlUFy05wQ1wwOW3O+WCUXaMVwrdHtmStFY7J/iErl0pd9mtesk+HzodxG11ehLY8kDHta14wlPu3OpwG1OWyqFBcqtDNAGyOIObvGeaC/IT8XYQIIw5ElHG9RNxB9Tv6N8ogT8SJ2WQ8q7S7CSw0v58vbQnSJOkhWE/LKrzQgY0cISKYCNygqvvFr9QTdI90qbTV1Cvnh9iXheATP+GUeLmKv41zGAYiDgoMwp5pcqSV44eQXRCk

⏰ Expired: 2026-09-20 21:24:53

⚠️ Penting: Pake link sebelum expired ya!
⚠️ cara pakenya tinggal klik link/copy paste lalu tempel di browser nanti otomatis login
KETIK /start untuk kembali ke menu utama
💡 Kalo udah expired, generate lagi aja.

📢 Grup Skynet: https://t.me/+e1dJOCxF2og3Nzk9
🤖 Bot Auto Order: @skystoreautobot
💬 Minat produk kami? Silakan hubungi melalui bot di atas.
`;

const SAMPLE_EXPIRED = `
⚠️ Cookie expired atau tidak valid. Silakan ambil cookie baru.

Kemungkinan penyebab:
• Cookie sudah expired
• Cookie tidak valid
• Perlu login Netflix lagi

Ambil cookie fresh dan coba lagi.
`;

test("parses success NFT token response into device links", () => {
  const parsed = parseBotReply(SAMPLE_SUCCESS);

  assert.equal(parsed.type, "success");
  assert.equal(parsed.success, true);
  assert.equal(parsed.devices.length, 3);

  const pc = parsed.devices.find(d => d.id === "pc");
  assert.ok(pc);
  assert.equal(pc.label, "PC / Laptop");
  assert.match(pc.url, /https:\/\/netflix\.com\/\?nftoken=/);

  const mobile = parsed.devices.find(d => d.id === "mobile");
  assert.ok(mobile);
  assert.equal(mobile.label, "HP / Mobile");
  assert.match(mobile.url, /https:\/\/www\.netflix\.com\/unsupported\?nftoken=/);

  const tv = parsed.devices.find(d => d.id === "tv");
  assert.ok(tv);
  assert.equal(tv.label, "TV / Smart TV");
  assert.match(tv.url, /https:\/\/www\.netflix\.com\/tv9\?nftoken=/);

  assert.equal(parsed.expired, "2026-09-20 21:24:53");
  assert.ok(parsed.notes.length >= 2);
});

test("parses cookie expired response into structured error causes", () => {
  const parsed = parseBotReply(SAMPLE_EXPIRED);

  assert.equal(parsed.type, "cookie_expired");
  assert.equal(parsed.success, false);
  assert.match(parsed.title, /Cookie expired atau tidak valid/);
  assert.equal(parsed.causes.length, 3);
  assert.ok(parsed.causes.includes("Cookie sudah expired"));
  assert.ok(parsed.causes.includes("Cookie tidak valid"));
  assert.ok(parsed.causes.includes("Perlu login Netflix lagi"));
  assert.match(parsed.suggestion, /coba lagi/);
});

test("parses result object with messages array", () => {
  const parsed = parseBotReply({
    messages: [
      { text: SAMPLE_SUCCESS, urlButtons: [] }
    ]
  });

  assert.equal(parsed.type, "success");
  assert.equal(parsed.devices.length, 3);
});

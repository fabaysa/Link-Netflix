/**
 * Auto-bypass handler for TeleBotCreator Ad Gate (e.g. @SSNetflixBot)
 *
 * Flow handled:
 * 1. Bot sends "☕ Hey, wanna buy me a cup of coffee? ... Only watch the ad..."
 *    with a dynamic button URL: https://api.telebotcreator.com/ads/go/<token>
 * 2. Userbot extracts and opens the dynamic URL automatically.
 * 3. Bot sends "🎉 Thank You! You Can Use this Bot Now." with a "Welcome" button.
 * 4. Userbot clicks the "Welcome" button and continues generating links & cookies.
 */

const AD_TEXT_PATTERN =
  /wanna\s+buy\s+me\s+a\s+cup\s+of\s+coffee|watching\s+a\s+quick\s+ad|only\s+watch\s+the\s+ad|support\s+the\s+owner\s+just\s+by\s+watching|বটটি\s+সবার\s+জন্য\s+সম্পূর্ণ\s+FREE|একটা\s+এডস\s+দেখেই/i;

const AD_URL_PATTERN =
  /https?:\/\/(?:[a-z0-9-]+\.)?telebotcreator\.com\/ads\/go\/[A-Za-z0-9_-]+/i;

const THANK_YOU_TEXT_PATTERN =
  /thank\s*you.*you\s*can\s*use\s*this\s*bot\s*now|you\s*can\s*use\s*this\s*bot\s*now|thank\s*you.*use\s*this\s*bot/i;

const WELCOME_BTN_PATTERN = /^(?:🎉\s*)?welcome(?:\s*🎉|!)*$/i;

const IGNORED_URL_HOSTS = new Set([
  "web.telegram.org",
  "telegram.org",
  "t.me",
  "netflix.com",
  "www.netflix.com"
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize buttons from a Teleproto/GramJS message (supports both msg.buttons and msg.replyMarkup.rows)
 */
export function getNormalizedButtons(msg) {
  const grid = [];

  if (Array.isArray(msg?.buttons) && msg.buttons.length > 0) {
    msg.buttons.forEach((row, rIdx) => {
      if (!Array.isArray(row)) return;
      const normRow = [];
      row.forEach((btn, cIdx) => {
        if (!btn) return;
        const raw = btn.button || btn;
        normRow.push({
          row: rIdx,
          col: cIdx,
          text: String(btn.text ?? raw?.text ?? "").trim(),
          url: String(btn.url ?? raw?.url ?? "").trim() || null,
          data: btn.data ?? raw?.data ?? null,
          raw: btn
        });
      });
      if (normRow.length > 0) grid.push(normRow);
    });
    if (grid.length > 0) return grid;
  }

  if (Array.isArray(msg?.replyMarkup?.rows) && msg.replyMarkup.rows.length > 0) {
    msg.replyMarkup.rows.forEach((rowObj, rIdx) => {
      const buttons = Array.isArray(rowObj?.buttons) ? rowObj.buttons : [];
      const normRow = [];
      buttons.forEach((btn, cIdx) => {
        if (!btn) return;
        normRow.push({
          row: rIdx,
          col: cIdx,
          text: String(btn.text ?? "").trim(),
          url: String(btn.url ?? "").trim() || null,
          data: btn.data ?? null,
          raw: btn
        });
      });
      if (normRow.length > 0) grid.push(normRow);
    });
  }

  return grid;
}

function isAllowedAdCandidateUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (IGNORED_URL_HOSTS.has(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Inspect a single message to determine if it is an Ad Gate prompt and extract its dynamic URL.
 */
export function extractAdGateInfo(msg) {
  if (!msg || msg.out) {
    return { isAdGate: false, adUrl: null, messageId: Number(msg?.id || 0), message: msg };
  }

  const text = String(msg.message ?? msg.text ?? "");
  const grid = getNormalizedButtons(msg);

  const buttonUrls = [];
  for (const row of grid) {
    for (const btn of row) {
      if (btn.url) buttonUrls.push(btn.url);
    }
  }

  const entityUrls = [];
  if (Array.isArray(msg.entities)) {
    for (const ent of msg.entities) {
      if (ent?.url) entityUrls.push(String(ent.url).trim());
    }
  }

  const textUrls = (text.match(/https?:\/\/[^\s"'<>)\]]+/gi) || []).map((u) => u.trim());
  const allUrls = [...buttonUrls, ...entityUrls, ...textUrls];

  // 1. Direct match on TeleBotCreator Ad URL pattern
  for (const candidate of allUrls) {
    const match = candidate.match(AD_URL_PATTERN);
    if (match) {
      return {
        isAdGate: true,
        adUrl: candidate,
        messageId: Number(msg.id || 0),
        message: msg
      };
    }
  }

  // 2. Match on Ad Gate text ("Hey, wanna buy me a cup of coffee?", etc.) + any valid external URL
  if (AD_TEXT_PATTERN.test(text)) {
    const validUrl =
      buttonUrls.find(isAllowedAdCandidateUrl) ||
      entityUrls.find(isAllowedAdCandidateUrl) ||
      textUrls.find(isAllowedAdCandidateUrl) ||
      null;

    if (validUrl) {
      return {
        isAdGate: true,
        adUrl: validUrl,
        messageId: Number(msg.id || 0),
        message: msg
      };
    }
  }

  return { isAdGate: false, adUrl: null, messageId: Number(msg.id || 0), message: msg };
}

/**
 * Find the latest unhandled Ad Gate message from a list of messages.
 */
export function findLatestAdGateMessage(messages, { minId = 0, handledIds = null } = {}) {
  const list = Array.isArray(messages) ? [...messages] : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const msg = list[i];
    if (!msg || msg.out) continue;
    const id = Number(msg.id || 0);
    if (id <= minId) continue;
    if (handledIds && handledIds.has(id)) continue;

    const info = extractAdGateInfo(msg);
    if (info.isAdGate && info.adUrl) {
      return info;
    }
  }
  return null;
}

/**
 * Check if a message is the "🎉 Thank You! You Can Use this Bot Now." confirmation.
 */
export function isAdThankYouMessage(msg) {
  if (!msg || msg.out) return false;
  const text = String(msg.message ?? msg.text ?? "");
  if (THANK_YOU_TEXT_PATTERN.test(text)) return true;

  const grid = getNormalizedButtons(msg);
  for (const row of grid) {
    for (const btn of row) {
      if (WELCOME_BTN_PATTERN.test(btn.text)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Locate the "Welcome" button on a Thank You message.
 */
export function findWelcomeButton(msg) {
  if (!msg) return null;
  const text = String(msg.message ?? msg.text ?? "");
  const grid = getNormalizedButtons(msg);

  // 1. Exact or partial "Welcome" button match
  for (const row of grid) {
    for (const btn of row) {
      if (WELCOME_BTN_PATTERN.test(btn.text) || /\bwelcome\b/i.test(btn.text)) {
        return btn;
      }
    }
  }

  // 2. Common continuation labels on thank-you prompt
  for (const row of grid) {
    for (const btn of row) {
      if (/^(?:start|continue|lanjut|menu|main\s*menu|generate)$/i.test(btn.text)) {
        return btn;
      }
    }
  }

  // 3. If message text explicitly says "Thank You! You Can Use this Bot Now.", fallback to first non-ad button
  if (THANK_YOU_TEXT_PATTERN.test(text) && grid.length > 0 && grid[0].length > 0) {
    const firstBtn = grid[0][0];
    if (!firstBtn.url || !AD_URL_PATTERN.test(firstBtn.url)) {
      return firstBtn;
    }
  }

  return null;
}

/**
 * Extract follow-up URLs from an HTML response (meta refresh, TeleBotCreator verify endpoints, JS redirects).
 */
export function extractFollowUpAdUrls(html, baseUrl) {
  if (!html || typeof html !== "string") return [];
  const found = [];

  // 1. Meta refresh: <meta http-equiv="refresh" content="0;url=...">
  const metaMatch = html.match(
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"'\s>]+)/i
  );
  if (metaMatch?.[1]) {
    try {
      found.push(new URL(metaMatch[1].trim(), baseUrl).toString());
    } catch {}
  }

  // 2. Absolute telebotcreator.com/ads/... URLs in HTML/script
  const absMatches = html.match(
    /https?:\/\/(?:[a-z0-9-]+\.)?telebotcreator\.com\/ads\/[^\s"'<>\\)]+/gi
  );
  if (absMatches) {
    for (const raw of absMatches) {
      try {
        found.push(new URL(raw.replace(/&amp;/g, "&"), baseUrl).toString());
      } catch {}
    }
  }

  // 3. Relative /ads/... paths in HTML/script
  const relMatches = html.match(
    /["'](\/ads\/(?:go|verify|confirm|complete|done|callback|click|view|reward)\/[^"'<>\\\s]+)["']/gi
  );
  if (relMatches) {
    for (const raw of relMatches) {
      const clean = raw.slice(1, -1).replace(/&amp;/g, "&");
      try {
        found.push(new URL(clean, baseUrl).toString());
      } catch {}
    }
  }

  // 4. JS window.location redirects
  const jsLocMatch = html.match(
    /(?:window\.location(?:\.href)?|location\.replace)\s*(?:=|\()\s*["'](https?:\/\/[^"']+)["']/i
  );
  if (jsLocMatch?.[1]) {
    try {
      found.push(new URL(jsLocMatch[1].trim(), baseUrl).toString());
    } catch {}
  }

  return [...new Set(found)];
}

function collectCookiesFromResponse(res, cookieJar) {
  try {
    const setCookies =
      typeof res.headers?.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : res.headers?.get?.("set-cookie")
          ? [res.headers.get("set-cookie")]
          : [];

    for (const sc of setCookies) {
      if (!sc) continue;
      const firstPart = String(sc).split(";")[0]?.trim();
      if (!firstPart) continue;
      const eqIdx = firstPart.indexOf("=");
      if (eqIdx > 0) {
        const name = firstPart.slice(0, eqIdx).trim();
        const val = firstPart.slice(eqIdx + 1).trim();
        cookieJar.set(name, val);
      }
    }
  } catch {}
}

function formatCookieHeader(cookieJar) {
  if (!cookieJar || cookieJar.size === 0) return "";
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * Open/visit the dynamic Ad URL (e.g. https://api.telebotcreator.com/ads/go/<token>)
 * Follows HTTP redirects and any embedded TeleBotCreator verification callbacks.
 */
export async function visitAdGateUrl(
  adUrl,
  { fetchImpl = globalThis.fetch, maxHops = 6, timeoutMs = 10000 } = {}
) {
  if (!adUrl || typeof fetchImpl !== "function") {
    return { ok: false, visitedUrls: [], error: "URL atau fetch tidak tersedia" };
  }

  const cookieJar = new Map();
  const visitedUrls = [];
  let currentUrl = adUrl;
  let referer = "https://web.telegram.org/";
  let lastStatus = 0;
  let lastHtml = "";

  for (let hop = 0; hop < maxHops && currentUrl; hop++) {
    if (visitedUrls.includes(currentUrl)) break;
    visitedUrls.push(currentUrl);

    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: referer
    };

    const cookieHeader = formatCookieHeader(cookieJar);
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    let res;
    try {
      res = await fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (fetchErr) {
      // If hop > 0 (e.g. redirected to external ad network that timed out), the initial ad gate hit already succeeded
      console.warn(
        `[ad-bypass] Fetch hop ${hop + 1} (${currentUrl}) warning: ${fetchErr.message}`
      );
      break;
    }

    lastStatus = Number(res?.status || 0);
    collectCookiesFromResponse(res, cookieJar);

    if (lastStatus >= 300 && lastStatus < 400) {
      const location = res.headers?.get?.("location");
      if (!location) break;
      try {
        referer = currentUrl;
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      } catch {
        break;
      }
    }

    try {
      lastHtml = await res.text();
    } catch {
      lastHtml = "";
    }

    // Check if HTML contains a follow-up TeleBotCreator verification URL or meta-refresh
    const followUps = extractFollowUpAdUrls(lastHtml, currentUrl).filter(
      (u) => !visitedUrls.includes(u)
    );
    if (followUps.length > 0) {
      referer = currentUrl;
      currentUrl = followUps[0];
      await sleep(300);
      continue;
    }

    break;
  }

  return {
    ok: visitedUrls.length > 0,
    visitedUrls,
    status: lastStatus
  };
}


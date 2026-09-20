function asText(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value = "") {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function entityKind(entity) {
  return String(
    entity?.className ||
    entity?.constructor?.name ||
    entity?._ ||
    ""
  ).toLowerCase();
}

function normalizeEntity(entity) {
  const offset = Number(entity?.offset);
  const length = Number(entity?.length);
  if (!Number.isFinite(offset) || !Number.isFinite(length) || length <= 0) {
    return null;
  }

  const kind = entityKind(entity);
  let type = null;

  if (kind.includes("messageentitybold")) type = "bold";
  else if (kind.includes("messageentityitalic")) type = "italic";
  else if (kind.includes("messageentityunderline")) type = "underline";
  else if (kind.includes("messageentitystrike")) type = "strike";
  else if (kind.includes("messageentitycode")) type = "code";
  else if (kind.includes("messageentitypre")) type = "pre";
  else if (kind.includes("messageentitytexturl")) type = "text_url";
  else if (kind.includes("messageentityspoiler")) type = "spoiler";

  if (!type) return null;

  return {
    type,
    offset,
    length,
    url: type === "text_url" ? asText(entity?.url).trim() : null
  };
}

export function messageText(message) {
  return asText(message?.message ?? message?.text).trim();
}

export function messageId(message) {
  const id = Number(message?.id || 0);
  return Number.isFinite(id) ? id : 0;
}

export function isOutgoing(message) {
  return Boolean(message?.out);
}

export function extractFormattingEntities(message) {
  const entities = Array.isArray(message?.entities) ? message.entities : [];
  return entities.map(normalizeEntity).filter(Boolean);
}

function tagsForEntity(entity) {
  switch (entity.type) {
    case "bold": return ["<b>", "</b>"];
    case "italic": return ["<i>", "</i>"];
    case "underline": return ["<u>", "</u>"];
    case "strike": return ["<s>", "</s>"];
    case "code": return ["<code>", "</code>"];
    case "pre": return ["<pre>", "</pre>"];
    case "spoiler": return ["<tg-spoiler>", "</tg-spoiler>"];
    case "text_url": {
      if (!/^https?:\/\//i.test(entity.url || "")) return ["", ""];
      return [`<a href="${escapeAttr(entity.url)}">`, "</a>"];
    }
    default: return ["", ""];
  }
}

export function renderTelegramHtml(text, entities = []) {
  const source = asText(text);
  if (!source) return "";

  const valid = (entities || [])
    .map(item => ({ ...item, end: Number(item.offset) + Number(item.length) }))
    .filter(item =>
      Number.isFinite(item.offset) &&
      Number.isFinite(item.end) &&
      item.offset >= 0 &&
      item.end > item.offset &&
      item.end <= source.length
    );

  const opens = new Map();
  const closes = new Map();

  for (const entity of valid) {
    const [open, close] = tagsForEntity(entity);
    if (!open && !close) continue;

    if (!opens.has(entity.offset)) opens.set(entity.offset, []);
    if (!closes.has(entity.end)) closes.set(entity.end, []);

    opens.get(entity.offset).push({ ...entity, tag: open });
    closes.get(entity.end).push({ ...entity, tag: close });
  }

  for (const list of opens.values()) {
    // Outer entity first when entities start at the same offset.
    list.sort((a, b) => b.length - a.length);
  }
  for (const list of closes.values()) {
    // Inner entity first when entities end at the same offset.
    list.sort((a, b) => b.offset - a.offset || a.length - b.length);
  }

  let output = "";
  for (let i = 0; i <= source.length; i++) {
    const closeList = closes.get(i);
    if (closeList) output += closeList.map(item => item.tag).join("");

    const openList = opens.get(i);
    if (openList) output += openList.map(item => item.tag).join("");

    if (i < source.length) output += escapeHtml(source[i]);
  }

  return output;
}

export function extractUrlButtons(message) {
  const rows = Array.isArray(message?.replyMarkup?.rows)
    ? message.replyMarkup.rows
    : [];

  const output = [];

  for (const row of rows) {
    const buttons = Array.isArray(row?.buttons) ? row.buttons : [];
    const cleanRow = [];

    for (const button of buttons) {
      const text = asText(button?.text).trim();
      const url = asText(button?.url).trim();

      if (!text || !/^https?:\/\//i.test(url)) continue;
      cleanRow.push({ text, url });
    }

    if (cleanRow.length) output.push(cleanRow);
  }

  return output;
}

export function serializeIncomingMessage(message) {
  const text = messageText(message);
  const formattingEntities = extractFormattingEntities(message);

  return {
    messageId: messageId(message),
    text,
    html: renderTelegramHtml(text, formattingEntities),
    formattingEntities,
    urlButtons: extractUrlButtons(message),
    editDate: message?.editDate
      ? new Date(message.editDate).toISOString()
      : null
  };
}

export function relaySnapshot(messages = []) {
  return JSON.stringify(
    messages
      .map(serializeIncomingMessage)
      .sort((a, b) => a.messageId - b.messageId)
  );
}

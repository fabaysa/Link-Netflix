function asText(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
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
  return {
    messageId: messageId(message),
    text: messageText(message),
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

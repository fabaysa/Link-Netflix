const API_BASE = "https://api.telegram.org";

function token() {
  const value = process.env.TELEGRAM_BOT_TOKEN;
  if (!value) throw new Error("TELEGRAM_BOT_TOKEN belum diisi.");
  return value;
}

export async function botApi(method, payload = {}) {
  const response = await fetch(`${API_BASE}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(
      `Telegram ${method} gagal: ${data?.description || `HTTP ${response.status}`}`
    );
  }
  return data.result;
}

export async function sendMessage(chatId, html, extra = {}) {
  return botApi("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...extra
  });
}

export async function editMessage(chatId, messageId, html, extra = {}) {
  return botApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...extra
  });
}

export async function sendPlainMessage(chatId, text, extra = {}) {
  return botApi("sendMessage", {
    chat_id: chatId,
    text: String(text ?? ""),
    link_preview_options: { is_disabled: true },
    ...extra
  });
}

export async function editPlainMessage(chatId, messageId, text, extra = {}) {
  return botApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: String(text ?? ""),
    link_preview_options: { is_disabled: true },
    ...extra
  });
}

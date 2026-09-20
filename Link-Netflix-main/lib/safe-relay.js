const SENSITIVE_PATTERNS = [
  /(?:^|[\s=&?])nftoken(?:=|\b)/i,
  /(?:^|[\s=:])(?:sessionid|session_id|auth_token|access_token|refresh_token|id_token)(?:[\s=:]|$)/i,
  /(?:^|[\s])cookie(?:s)?\s*[:=]/i,
  /(?:^|[\s])(?:password|passwd|passcode)\s*[:=]/i,
  /https?:\/\/[^\s]*(?:nftoken|sessionid|auth_token|access_token|refresh_token)=/i
];

export function looksSensitive(value = "") {
  const text = String(value || "");
  return SENSITIVE_PATTERNS.some(re => re.test(text));
}

export function sanitizeTargetText(value = "") {
  const text = String(value || "");
  if (!text.trim()) return "";

  let out = text;
  out = out.replace(/https?:\/\/[^\s]*nftoken=[^\s`)>]+/gi, "[LOGIN LINK REDACTED]");
  out = out.replace(/(?:sessionid|session_id|auth_token|access_token|refresh_token|id_token)\s*[=:]\s*[^\s`]+/gi, "$1=[REDACTED]");
  out = out.replace(/(?:cookie(?:s)?|password|passwd|passcode)\s*[:=]\s*[^\n]+/gi, "$1=[REDACTED]");
  return out;
}

export function isSafeDemoInput(value = "") {
  const text = String(value || "").trim();
  return /^DEMO:/i.test(text) && text.length <= 1000 && !looksSensitive(text);
}

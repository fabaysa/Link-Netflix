export function normalizeRelayText(text) {
  // Jangan trim payload di sini: sistem relay harus meneruskan teks user
  // semirip mungkin dengan input aslinya. Hanya normalisasi CRLF.
  return String(text ?? "").replace(/\r\n/g, "\n");
}

export function maxRelayChars() {
  const value = Number.parseInt(process.env.MAX_RELAY_TEXT_CHARS || "4000", 10);
  if (!Number.isFinite(value)) return 4000;
  return Math.max(1, Math.min(value, 4096));
}

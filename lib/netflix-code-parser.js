/**
 * netflix-code-parser.js
 * Parser URL Netflix dari teks respons bot pihak ketiga.
 */

const DEFAULT_PATTERNS = [
  'https?://(?:[a-z0-9-]+\\.)*netflix\\.com/[^\\s<>"\']+',
  'https?://nflx\\.it/[^\\s<>"\']+',
];

function cleanUrlMatch(value) {
  return String(value || '').trim().replace(/[),.!?;:]+$/g, '');
}

export function allowedNetflixUrl(raw) {
  if (!raw) return null;
  const match = String(raw).match(/https?:\/\/[^\s<>"']+/);
  if (!match) return null;
  const urlStr = cleanUrlMatch(match[0]);
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (host === 'netflix.com' || host.endsWith('.netflix.com') || host === 'nflx.it') {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function mediaKind(label) {
  const text = String(label || '').toLowerCase();
  if (/not\s*working|not\s*work|tidak\s*berfungsi/i.test(text)) return null;
  if (/\b(pc|desktop|computer|komputer|laptop)\b/i.test(text)) return 'pc';
  if (/\b(mobile|phone|android|ios|hp|handphone)\b/i.test(text)) return 'mobile';
  if (/\b(tv|smart\s*tv|television|televisi)\b/i.test(text)) return 'tv';
  return null;
}

export function isWorkingLabel(label) {
  const text = String(label || '').toLowerCase();
  if (/not\s*work|tidak\s*berfungsi|gagal/i.test(text)) return false;
  return /\b(working|work|berfungsi|berhasil|sukses)\b/i.test(text);
}

export class NetflixUrlParser {
  constructor(patterns = []) {
    this._patterns = patterns.length > 0 ? patterns : DEFAULT_PATTERNS;
    this._compiled = this._compile(this._patterns);
  }

  _compile(patterns) {
    return patterns.map((p) => {
      try {
        return new RegExp(p, 'gi');
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  parse(text) {
    const input = String(text || '');
    for (const regex of this._compiled) {
      regex.lastIndex = 0;
      const match = regex.exec(input);
      if (match) {
        const url = cleanUrlMatch(match[0]);
        try {
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) continue;
        } catch { continue; }
        return { url, matched: true };
      }
    }
    return { url: null, matched: false };
  }

  parseAll(text) {
    const input = String(text || '');
    const found = new Set();
    for (const regex of this._compiled) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(input)) !== null) {
        const url = cleanUrlMatch(match[0]);
        try {
          if (['http:', 'https:'].includes(new URL(url).protocol)) found.add(url);
        } catch { /* skip */ }
      }
    }
    return [...found];
  }
}

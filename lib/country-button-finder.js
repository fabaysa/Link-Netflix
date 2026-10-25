/** Country and pagination button matching that does not depend on button indexes. */

export const COUNTRY_LABELS = Object.freeze({
  ID: ['indonesia', 'indonesian', 'id'],
  MY: ['malaysia', 'malaysian', 'my'],
  SG: ['singapore', 'singapura', 'singaporean', 'sg'],
  US: ['usa', 'united states', 'america', 'us'],
  UK: ['uk', 'united kingdom', 'england', 'britain', 'gb'],
  TH: ['thailand', 'thai', 'th'],
  VN: ['vietnam', 'vietnamese', 'vn'],
  PH: ['philippines', 'filipino', 'ph'],
  JP: ['japan', 'japanese', 'jp'],
  KR: ['south korea', 'korea', 'korean', 'kr'],
  IN: ['india', 'indian', 'in'],
  BR: ['brazil', 'brasil', 'br'],
  FR: ['france', 'french', 'fr'],
  DE: ['germany', 'german', 'de'],
  TR: ['turkey', 'turkish', 'tr'],
  IT: ['italy', 'italian', 'it'],
  ES: ['spain', 'spanish', 'es'],
  AU: ['australia', 'australian', 'au'],
  CA: ['canada', 'canadian', 'ca'],
  HK: ['hong kong', 'hk'],
  TW: ['taiwan', 'tw'],
  EG: ['egypt', 'eg'],
  ZA: ['south africa', 'za'],
  NG: ['nigeria', 'ng'],
  AR: ['argentina', 'ar'],
  CL: ['chile', 'cl'],
  CO: ['colombia', 'co'],
  PE: ['peru', 'pe'],
  PK: ['pakistan', 'pk'],
  SA: ['saudi arabia', 'sa'],
  AE: ['uae', 'united arab emirates', 'ae'],
});

export function normalizeButtonLabel(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function extractButtonStock(label) {
  const text = String(label ?? '');
  const match = text.match(/[\(\[]\s*(\d+)\s*[\)\]]/);
  if (match) return parseInt(match[1], 10);
  return null;
}

export function countryMatchesButton(label, countryCode) {
  const aliases = COUNTRY_LABELS[String(countryCode ?? '').toUpperCase()];
  if (!aliases) return false;
  const normalized = ` ${normalizeButtonLabel(label)} `;
  return aliases.some((alias) => normalized.includes(` ${alias} `));
}

export function isCountryChoiceLabel(label) {
  const text = String(label ?? '');
  if (/[\uD83C][\uDDE6-\uDDFF]{2}/.test(text)) return true;
  return Object.keys(COUNTRY_LABELS).some((code) => countryMatchesButton(text, code));
}

export function isNextPageButton(label) {
  const raw = String(label ?? '').normalize('NFKC').toLocaleLowerCase('en').trim();
  const normalized = normalizeButtonLabel(raw);
  if (/^(next|next page|next country|more|selanjutnya|berikutnya|halaman berikutnya|lanjut|lanjutkan)$/.test(normalized)) return true;
  if (/^(?:[➡➜➞➤▶►⏭»›❯]+|[.·…]+)$/.test(raw.replace(/[\uFE0F\u200D\s]/g, ''))) return true;
  return /^(next|selanjutnya|berikutnya|lanjut)\b/.test(normalized);
}

export function isPrevPageButton(label) {
  const raw = String(label ?? '').normalize('NFKC').toLocaleLowerCase('en').trim();
  const normalized = normalizeButtonLabel(raw);
  if (/^(prev|previous|prev page|back|kembali|sebelumnya|halaman sebelumnya)$/.test(normalized)) return true;
  if (/^(?:[⬅️⬅◄◀⏮«‹❮]+|[.·…]+)$/.test(raw.replace(/[\uFE0F\u200D\s]/g, ''))) return true;
  return /^(prev|previous|sebelumnya|kembali)\b/.test(normalized);
}

export function findCountryButtonPosition(rows, countryCode, { checkStock = false } = {}) {
  for (let rowIndex = 0; rowIndex < (Array.isArray(rows) ? rows.length : 0); rowIndex++) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
      const btn = row[columnIndex];
      const text = btn?.text ?? btn?.label ?? btn;
      if (countryMatchesButton(text, countryCode)) {
        if (checkStock) {
          const stock = extractButtonStock(text);
          if (stock === 0) continue;
        }
        return { row: rowIndex, column: columnIndex };
      }
    }
  }
  return null;
}

export function findNextButtonPosition(rows) {
  for (let rowIndex = 0; rowIndex < (Array.isArray(rows) ? rows.length : 0); rowIndex++) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
      if (isNextPageButton(row[columnIndex]?.text ?? row[columnIndex]?.label ?? row[columnIndex])) {
        return { row: rowIndex, column: columnIndex };
      }
    }
  }
  return null;
}

export function findPrevButtonPosition(rows) {
  for (let rowIndex = 0; rowIndex < (Array.isArray(rows) ? rows.length : 0); rowIndex++) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
      if (isPrevPageButton(row[columnIndex]?.text ?? row[columnIndex]?.label ?? row[columnIndex])) {
        return { row: rowIndex, column: columnIndex };
      }
    }
  }
  return null;
}

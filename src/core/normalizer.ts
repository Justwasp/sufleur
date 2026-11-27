/**
 * English-first text normalization with Russian/multilingual support.
 * Expands English contractions and numbers into canonical spoken units so
 * "don't" <-> "do not", "25%" <-> "twenty five percent", and homophones align cleanly.
 */

const ENGLISH_CONTRACTIONS: Record<string, string[]> = {
  "ain't": ['am', 'not'],
  "aren't": ['are', 'not'],
  "can't": ['can', 'not'],
  cannot: ['can', 'not'],
  "couldn't": ['could', 'not'],
  "didn't": ['did', 'not'],
  "doesn't": ['does', 'not'],
  "don't": ['do', 'not'],
  "hadn't": ['had', 'not'],
  "hasn't": ['has', 'not'],
  "haven't": ['have', 'not'],
  "he'd": ['he', 'would'],
  "he'll": ['he', 'will'],
  "he's": ['he', 'is'],
  "i'd": ['i', 'would'],
  "i'll": ['i', 'will'],
  "i'm": ['i', 'am'],
  "i've": ['i', 'have'],
  "isn't": ['is', 'not'],
  "it'd": ['it', 'would'],
  "it'll": ['it', 'will'],
  "it's": ['it', 'is'],
  "let's": ['let', 'us'],
  "mightn't": ['might', 'not'],
  "mustn't": ['must', 'not'],
  "needn't": ['need', 'not'],
  "shan't": ['shall', 'not'],
  "she'd": ['she', 'would'],
  "she'll": ['she', 'will'],
  "she's": ['she', 'is'],
  "shouldn't": ['should', 'not'],
  "that's": ['that', 'is'],
  "there's": ['there', 'is'],
  "they'd": ['they', 'would'],
  "they'll": ['they', 'will'],
  "they're": ['they', 'are'],
  "they've": ['they', 'have'],
  "wasn't": ['was', 'not'],
  "we'd": ['we', 'would'],
  "we'll": ['we', 'will'],
  "we're": ['we', 'are'],
  "we've": ['we', 'have'],
  "weren't": ['were', 'not'],
  "what's": ['what', 'is'],
  "where's": ['where', 'is'],
  "who's": ['who', 'is'],
  "won't": ['will', 'not'],
  "wouldn't": ['would', 'not'],
  "you'd": ['you', 'would'],
  "you'll": ['you', 'will'],
  "you're": ['you', 'are'],
  "you've": ['you', 'have'],
  gonna: ['going', 'to'],
  wanna: ['want', 'to'],
  gotta: ['got', 'to'],
};

const HOMOPHONE_GROUPS: string[][] = [
  ['to', 'too', 'two'],
  ['there', 'their'],
  ['your', 'youre'],
  ['no', 'know'],
  ['right', 'write', 'rite'],
  ['for', 'four'],
  ['one', 'won'],
  ['by', 'buy', 'bye'],
  ['here', 'hear'],
  ['our', 'hour'],
  ['where', 'wear'],
  ['new', 'knew'],
  ['see', 'sea'],
  ['through', 'threw'],
  ['wait', 'weight'],
  ['week', 'weak'],
  ['meet', 'meat'],
  ['peace', 'piece'],
  ['brake', 'break'],
  ['plain', 'plane'],
  ['son', 'sun'],
  ['its', 'it'],
];

const HOMOPHONE_MAP = new Map<string, string>();
for (const group of HOMOPHONE_GROUPS) {
  const canonical = `__h_${group[0]}`;
  for (const word of group) {
    HOMOPHONE_MAP.set(word, canonical);
  }
}

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

function integerToEnglishWords(n: number): string[] {
  if (!Number.isFinite(n) || n < 0 || n > 999999) {
    return [String(n)];
  }
  if (n < 20) return [ONES[n]];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o === 0 ? [TENS[t]] : [TENS[t], ONES[o]];
  }
  // Years 1900..2099: e.g. 2026 -> "twenty twenty six", 1995 -> "nineteen ninety five"
  if (n >= 1900 && n <= 2099 && n !== 2000) {
    const hi = Math.floor(n / 100);
    const lo = n % 100;
    if (lo === 0) return [...integerToEnglishWords(hi), 'hundred'];
    if (lo < 10) return [...integerToEnglishWords(hi), 'oh', ONES[lo]];
    return [...integerToEnglishWords(hi), ...integerToEnglishWords(lo)];
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const rem = n % 100;
    return rem === 0
      ? [ONES[h], 'hundred']
      : [ONES[h], 'hundred', ...integerToEnglishWords(rem)];
  }
  const th = Math.floor(n / 1000);
  const rem = n % 1000;
  return rem === 0
    ? [...integerToEnglishWords(th), 'thousand']
    : [...integerToEnglishWords(th), 'thousand', ...integerToEnglishWords(rem)];
}

export function getHomophoneKey(normWord: string): string {
  return HOMOPHONE_MAP.get(normWord) ?? normWord;
}

/**
 * Normalize a single raw token into 0..N canonical spoken match units.
 */
export function normalizeTokenToUnits(raw: string): string[] {
  let cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC`]/g, "'")
    .replace(/ё/g, 'е');

  // Handle common symbol suffixes/prefixes before stripping punctuation
  const trailingPercent = cleaned.endsWith('%');
  const leadingDollar = cleaned.startsWith('$');
  const leadingEuro = cleaned.startsWith('€');

  if (cleaned === '&') return ['and'];
  if (cleaned === '%') return ['percent'];

  // Strip surrounding punctuation while preserving internal apostrophes and hyphens
  cleaned = cleaned.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!cleaned) return [];

  // Direct contraction match
  const contraction = ENGLISH_CONTRACTIONS[cleaned];
  if (contraction) {
    return [...contraction];
  }

  // Handle hyphenated words (e.g. "real-time" -> ["real", "time"])
  if (cleaned.includes('-')) {
    const parts = cleaned.split('-').flatMap((part) => normalizeTokenToUnits(part));
    return parts;
  }

  // Numeric token (e.g. "25", "2026", "1,500")
  const numericCandidate = cleaned.replace(/,/g, '');
  if (/^\d+$/.test(numericCandidate)) {
    const num = Number.parseInt(numericCandidate, 10);
    const words = integerToEnglishWords(num);
    if (trailingPercent) words.push('percent');
    if (leadingDollar) words.push(num === 1 ? 'dollar' : 'dollars');
    if (leadingEuro) words.push(num === 1 ? 'euro' : 'euros');
    return words;
  }

  // Strip remaining internal punctuation (e.g. possessive 's -> keep base word + s or strip ')
  if (cleaned.endsWith("'s") && cleaned.length > 2) {
    cleaned = cleaned.slice(0, -2) + 's';
  }
  cleaned = cleaned.replace(/[^\p{L}\p{N}]/gu, '');
  if (!cleaned) return [];

  const result = [cleaned];
  if (trailingPercent) result.push('percent');
  return result;
}

/**
 * Expand an arbitrary spoken ASR string into normalized match units.
 */
export function expandSpokenText(text: string): string[] {
  if (!text.trim()) return [];
  const rawWords = text.trim().split(/\s+/);
  const units: string[] = [];
  for (const w of rawWords) {
    const expanded = normalizeTokenToUnits(w);
    for (const u of expanded) {
      units.push(u);
    }
  }
  return units;
}

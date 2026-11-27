import { getHomophoneKey, normalizeTokenToUnits } from './normalizer';
import type { IndexedScript, MatchUnit, ScriptToken } from './types';

const COMMON_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'of', 'for',
  'is', 'are', 'was', 'were', 'be', 'it', 'this', 'that', 'with', 'as', 'by',
  'i', 'you', 'we', 'they', 'he', 'she', 'my', 'your', 'our', 'do', 'not',
  'и', 'в', 'на', 'с', 'по', 'к', 'не', 'что', 'это', 'как', 'а', 'но', 'я', 'мы', 'вы',
]);

/**
 * Parse raw script text into display tokens + speakable match units + n-gram indices.
 */
export function indexScript(
  rawText: string,
  ignoreStageDirections = true,
): IndexedScript {
  const normalizedText = rawText.replace(/\r\n?/g, '\n');
  const tokens: ScriptToken[] = [];
  const rawUnits: Array<{ tokenIndex: number; norm: string }> = [];

  // Match either [stage direction] or a non-whitespace token, followed by trailing whitespace
  const tokenRegex = /(\[[^\]\n]{1,80}\]|\S+)([ \t\n]*)/g;
  let paragraphIndex = 0;
  let match: RegExpExecArray | null;
  let speakableWordCount = 0;

  while ((match = tokenRegex.exec(normalizedText)) !== null) {
    const raw = match[1];
    const trailingSpace = match[2] ?? '';
    const isStageDirection = raw.startsWith('[') && raw.endsWith(']');
    const expanded =
      ignoreStageDirections && isStageDirection ? [] : normalizeTokenToUnits(raw);
    const isSpeakable = expanded.length > 0;

    const tokenIndex = tokens.length;
    const unitIndices: number[] = [];

    if (isSpeakable) {
      speakableWordCount += 1;
      for (const norm of expanded) {
        unitIndices.push(rawUnits.length);
        rawUnits.push({ tokenIndex, norm });
      }
    }

    tokens.push({
      index: tokenIndex,
      raw,
      trailingSpace,
      paragraphIndex,
      isSpeakable,
      isStageDirection,
      unitIndices,
    });

    if (trailingSpace.includes('\n')) {
      const newlineCount = (trailingSpace.match(/\n/g) ?? []).length;
      paragraphIndex += newlineCount >= 2 ? 1 : 0;
    }
  }

  // Compute smooth IDF weights so distinctive words carry higher alignment weight
  const freq = new Map<string, number>();
  for (const u of rawUnits) {
    freq.set(u.norm, (freq.get(u.norm) ?? 0) + 1);
  }
  const totalUnits = Math.max(1, rawUnits.length);

  const units: MatchUnit[] = rawUnits.map((u, unitIndex) => {
    const count = freq.get(u.norm) ?? 1;
    let idf: number;
    if (COMMON_STOP_WORDS.has(u.norm)) {
      idf = 0.45;
    } else {
      const rawIdf = Math.log((totalUnits + 1) / (count + 1)) / Math.log(totalUnits + 2);
      idf = Math.max(0.55, Math.min(1.0, 0.55 + rawIdf * 0.45));
    }
    return {
      unitIndex,
      tokenIndex: u.tokenIndex,
      norm: u.norm,
      homophoneKey: getHomophoneKey(u.norm),
      idf,
    };
  });

  // Build unigram, bigram, and trigram inverted indices using homophone-canonical keys
  const unigramIndex = new Map<string, number[]>();
  const bigramIndex = new Map<string, number[]>();
  const trigramIndex = new Map<string, number[]>();

  for (let i = 0; i < units.length; i++) {
    const k1 = units[i].homophoneKey;
    let uList = unigramIndex.get(k1);
    if (!uList) {
      uList = [];
      unigramIndex.set(k1, uList);
    }
    uList.push(i);

    if (i + 1 < units.length) {
      const bi = `${k1} ${units[i + 1].homophoneKey}`;
      let bList = bigramIndex.get(bi);
      if (!bList) {
        bList = [];
        bigramIndex.set(bi, bList);
      }
      bList.push(i);
    }

    if (i + 2 < units.length) {
      const tri = `${k1} ${units[i + 1].homophoneKey} ${units[i + 2].homophoneKey}`;
      let tList = trigramIndex.get(tri);
      if (!tList) {
        tList = [];
        trigramIndex.set(tri, tList);
      }
      tList.push(i);
    }
  }

  return {
    tokens,
    units,
    bigramIndex,
    trigramIndex,
    unigramIndex,
    speakableWordCount,
  };
}

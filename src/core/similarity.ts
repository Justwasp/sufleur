import { getHomophoneKey } from './normalizer';

/**
 * Damerau-Levenshtein distance (supports adjacent transpositions common in ASR/typos).
 */
export function damerauLevenshtein(a: string, b: string): number {
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  const d: number[][] = Array.from({ length: lenA + 1 }, () =>
    new Array<number>(lenB + 1).fill(0),
  );

  for (let i = 0; i <= lenA; i++) d[i][0] = i;
  for (let j = 0; j <= lenB; j++) d[0][j] = j;

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, d[i - 2][j - 2] + 1);
      }
      d[i][j] = val;
    }
  }
  return d[lenA][lenB];
}

/**
 * Compute fuzzy similarity [0..1] between a spoken normalized word and a script normalized word.
 */
export function wordSimilarity(
  spoken: string,
  scriptWord: string,
  scriptHomophoneKey?: string,
): number {
  if (spoken === scriptWord) return 1.0;

  // Homophone match (e.g. "two" vs "to", "their" vs "there")
  const sKey = getHomophoneKey(spoken);
  const tKey = scriptHomophoneKey ?? getHomophoneKey(scriptWord);
  if (sKey === tKey) return 0.96;

  const minLen = Math.min(spoken.length, scriptWord.length);
  const maxLen = Math.max(spoken.length, scriptWord.length);

  // Very short words (<= 2 chars) must match exactly or via homophone to avoid false positives
  if (minLen <= 2) {
    return 0;
  }

  // Strong prefix match (handles interim partial words & Russian/English inflections)
  if (minLen >= 4 && (scriptWord.startsWith(spoken) || spoken.startsWith(scriptWord))) {
    const ratio = minLen / maxLen;
    if (ratio >= 0.65) {
      return 0.86;
    }
  }

  // Common English suffix variations (-s, -ed, -ing) and pluralization
  if (minLen >= 3) {
    const dist = damerauLevenshtein(spoken, scriptWord);
    const sim = 1 - dist / maxLen;
    if (maxLen <= 4) {
      return dist <= 1 ? 0.78 : 0;
    }
    return sim >= 0.7 ? sim : 0;
  }

  return 0;
}

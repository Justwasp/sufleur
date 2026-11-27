/**
 * Computes WCAG 2.1 contrast ratio between two hex colors (1..21).
 */
function parseHex(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '');
  if (clean.length === 3) {
    const r = Number.parseInt(clean[0] + clean[0], 16);
    const g = Number.parseInt(clean[1] + clean[1], 16);
    const b = Number.parseInt(clean[2] + clean[2], 16);
    return Number.isNaN(r + g + b) ? null : [r, g, b];
  }
  if (clean.length === 6) {
    const r = Number.parseInt(clean.slice(0, 2), 16);
    const g = Number.parseInt(clean.slice(2, 4), 16);
    const b = Number.parseInt(clean.slice(4, 6), 16);
    return Number.isNaN(r + g + b) ? null : [r, g, b];
  }
  return null;
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function getContrastRatio(hexA: string, hexB: string): number {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  if (!a || !b) return 1;
  const lumA =
    0.2126 * channelLuminance(a[0]) +
    0.7152 * channelLuminance(a[1]) +
    0.0722 * channelLuminance(a[2]);
  const lumB =
    0.2126 * channelLuminance(b[0]) +
    0.7152 * channelLuminance(b[1]) +
    0.0722 * channelLuminance(b[2]);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

export function getContrastRating(ratio: number): {
  label: 'AAA' | 'AA' | 'LOW';
  tone: 'emerald' | 'amber' | 'red';
} {
  if (ratio >= 7) return { label: 'AAA', tone: 'emerald' };
  if (ratio >= 4.5) return { label: 'AA', tone: 'amber' };
  return { label: 'LOW', tone: 'red' };
}

import { describe, expect, it } from 'vitest';
import { indexScript } from './tokenizer';
import { formatElapsedTime } from './timer';
import { buildDemoPhrases } from '../speech/demoTtsPlayer';

describe('formatElapsedTime', () => {
  it('formats zero, seconds, minutes, and hours cleanly', () => {
    expect(formatElapsedTime(0)).toBe('00:00');
    expect(formatElapsedTime(5_400)).toBe('00:05');
    expect(formatElapsedTime(65_000)).toBe('01:05');
    expect(formatElapsedTime(599_999)).toBe('09:59');
    expect(formatElapsedTime(3_661_000)).toBe('1:01:01');
  });

  it('clamps negative values to 00:00', () => {
    expect(formatElapsedTime(-5000)).toBe('00:00');
  });
});

describe('buildDemoPhrases', () => {
  it('splits script into natural spoken phrases and injects a repeat demonstration', () => {
    const script =
      '[Pause] Good evening everyone. Welcome to our live broadcast tonight. We build for clarity.';
    const indexed = indexScript(script);
    const phrases = buildDemoPhrases(indexed.tokens, -1, true);

    expect(phrases.length).toBeGreaterThanOrEqual(4);
    expect(phrases[0].text).toBe('Good evening everyone.');
    expect(phrases[0].isRepeatDemo).toBe(false);
    expect(phrases.some((p) => p.isRepeatDemo)).toBe(true);
    // Stage direction [Pause] must not be spoken aloud
    expect(phrases.every((p) => !p.text.includes('[Pause]'))).toBe(true);
  });
});

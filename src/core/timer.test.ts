import { describe, expect, it } from 'vitest';
import { indexScript } from './tokenizer';
import { CumulativeTimer, formatElapsedTime } from './timer';
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

describe('CumulativeTimer', () => {
  it('accumulates time across stop and resume cycles until explicitly reset', () => {
    const timer = new CumulativeTimer();
    timer.start(1000);
    expect(timer.getElapsedMs(4000)).toBe(3000);

    // Pause at t=4000 -> freezes at 3000ms
    expect(timer.pause(4000)).toBe(3000);
    expect(timer.getElapsedMs(9000)).toBe(3000);

    // Resume at t=9000 -> continues from 3000ms (does NOT reset to 0!)
    timer.start(9000);
    expect(timer.getElapsedMs(11500)).toBe(5500);
    expect(timer.pause(11500)).toBe(5500);

    // Explicit reset returns to 0
    timer.reset();
    expect(timer.getElapsedMs(12000)).toBe(0);
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

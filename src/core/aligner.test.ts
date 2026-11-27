import { describe, expect, it } from 'vitest';
import { VoiceAligner } from './aligner';
import { expandSpokenText, normalizeTokenToUnits } from './normalizer';

describe('normalizer (English-first + multilingual)', () => {
  it('expands English contractions to match expanded spoken words', () => {
    expect(normalizeTokenToUnits("don't")).toEqual(['do', 'not']);
    expect(normalizeTokenToUnits("it's")).toEqual(['it', 'is']);
    expect(normalizeTokenToUnits("we're")).toEqual(['we', 'are']);
    expect(normalizeTokenToUnits("won't")).toEqual(['will', 'not']);
    expect(expandSpokenText("We don't think it's too late")).toEqual([
      'we',
      'do',
      'not',
      'think',
      'it',
      'is',
      'too',
      'late',
    ]);
  });

  it('expands numbers, years, and percentages into English words', () => {
    expect(normalizeTokenToUnits('25%')).toEqual(['twenty', 'five', 'percent']);
    expect(normalizeTokenToUnits('2026')).toEqual(['twenty', 'twenty', 'six']);
    expect(normalizeTokenToUnits('$40')).toEqual(['forty', 'dollars']);
  });

  it('normalizes Russian ё to е', () => {
    expect(normalizeTokenToUnits('Ещё')).toEqual(['еще']);
    expect(normalizeTokenToUnits('вперёд!')).toEqual(['вперед']);
  });
});

describe('VoiceAligner', () => {
  it('tracks sequential English reading smoothly with contractions, homophones, and numbers', () => {
    const script =
      "Welcome everyone. We don't want to wait 25% longer in 2026. It's time to build.";
    const aligner = new VoiceAligner(script);

    const r1 = aligner.processTranscript({
      utteranceId: 1,
      isFinal: false,
      text: 'welcome everyone',
    });
    expect(r1.moved).toBe(true);
    expect(aligner.getScript().tokens[r1.tokenIndex].raw).toBe('everyone.');

    const r2 = aligner.processTranscript({
      utteranceId: 1,
      isFinal: true,
      text: 'welcome everyone we do not want two wait twenty five percent longer in twenty twenty six',
    });
    expect(r2.moved).toBe(true);
    expect(aligner.getScript().tokens[r2.tokenIndex].raw).toBe('2026.');

    const r3 = aligner.processTranscript({
      utteranceId: 2,
      isFinal: true,
      text: 'it is time to build',
    });
    expect(r3.status).toBe('end');
    expect(aligner.getScript().tokens[r3.tokenIndex].raw).toBe('build.');
  });

  it('does NOT break or jump when speaker stumbles and repeats a phrase multiple times', () => {
    const script =
      'Good morning everyone. Today we launch the next generation platform. Later in the show we launch the next generation platform again for live demos.';
    const aligner = new VoiceAligner(script);

    // Read up to "platform."
    const firstPass = aligner.processTranscript({
      utteranceId: 1,
      isFinal: true,
      text: 'good morning everyone today we launch the next generation platform',
    });
    expect(aligner.getScript().tokens[firstPass.tokenIndex].raw).toBe('platform.');
    const lockedToken = firstPass.tokenIndex;

    // Speaker stumbles and repeats "we launch the next generation platform" TWICE!
    const repeat1 = aligner.processTranscript({
      utteranceId: 2,
      isFinal: true,
      text: 'we launch the next generation platform',
    });
    expect(repeat1.status).toBe('repeating');
    expect(repeat1.moved).toBe(false);
    expect(repeat1.tokenIndex).toBe(lockedToken);

    const repeat2 = aligner.processTranscript({
      utteranceId: 3,
      isFinal: true,
      text: 'launch the next generation platform',
    });
    expect(repeat2.status).toBe('repeating');
    expect(repeat2.moved).toBe(false);
    expect(repeat2.tokenIndex).toBe(lockedToken);

    // Now speaker continues normally -> picks up seamlessly right after lockedToken!
    const resume = aligner.processTranscript({
      utteranceId: 4,
      isFinal: true,
      text: 'later in the show we launch',
    });
    expect(resume.moved).toBe(true);
    expect(resume.tokenIndex).toBeGreaterThan(lockedToken);
    expect(aligner.getScript().tokens[resume.tokenIndex].raw).toBe('launch');
  });

  it('tracks a script composed of back-to-back repeated phrases monotonically without double-advancing on interim updates', () => {
    const script =
      'We build the future. We build the future. We build the future. Now ship the product.';
    const aligner = new VoiceAligner(script);

    // Copy 1 with flickering interim ASR updates
    aligner.processTranscript({ utteranceId: 1, isFinal: false, text: 'we' });
    aligner.processTranscript({ utteranceId: 1, isFinal: false, text: 'we build' });
    aligner.processTranscript({ utteranceId: 1, isFinal: false, text: 'we build the future' });
    // Exact duplicate interim flicker MUST NOT jump into copy 2
    const flicker = aligner.processTranscript({
      utteranceId: 1,
      isFinal: false,
      text: 'we build the future',
    });
    expect(flicker.moved).toBe(false);
    expect(flicker.tokenIndex).toBe(3); // end of Copy 1 ("future.")

    aligner.processTranscript({
      utteranceId: 1,
      isFinal: true,
      text: 'we build the future',
    });
    expect(aligner.getCursorTokenIndex()).toBe(3);

    // Copy 2 spoken in next utterance -> advances cleanly to token 7 ("future." #2)
    const copy2 = aligner.processTranscript({
      utteranceId: 2,
      isFinal: true,
      text: 'we build the future',
    });
    expect(copy2.moved).toBe(true);
    expect(copy2.tokenIndex).toBe(7);

    // Copy 3 spoken in next utterance -> advances cleanly to token 11 ("future." #3)
    const copy3 = aligner.processTranscript({
      utteranceId: 3,
      isFinal: true,
      text: 'we build the future',
    });
    expect(copy3.moved).toBe(true);
    expect(copy3.tokenIndex).toBe(11);

    // Final unique sentence
    const finish = aligner.processTranscript({
      utteranceId: 4,
      isFinal: true,
      text: 'now ship the product',
    });
    expect(finish.status).toBe('end');
    expect(finish.tokenIndex).toBe(15);
  });

  it('recovers cleanly when the speaker jumps forward across multiple paragraphs', () => {
    const script = [
      'Chapter one introduces our quarterly financial highlights and early customer momentum across Europe.',
      'Chapter two dives deep into infrastructure reliability, latency reduction, and edge caching benchmarks.',
      'Chapter three covers hardware partnerships, global supply chain resilience, and retail expansion.',
      'Chapter four unveils our autonomous telemetry studio designed for live broadcast directors everywhere.',
    ].join('\n\n');

    const aligner = new VoiceAligner(script);
    aligner.processTranscript({
      utteranceId: 1,
      isFinal: true,
      text: 'chapter one introduces our quarterly financial highlights',
    });
    const startIdx = aligner.getCursorTokenIndex();
    expect(startIdx).toBeLessThan(12);

    // Speaker accidentally skips Chapters 2 & 3 and jumps straight to Chapter 4
    const jump = aligner.processTranscript({
      utteranceId: 2,
      isFinal: true,
      text: 'chapter four unveils our autonomous telemetry studio',
    });
    expect(jump.status).toBe('jumped-forward');
    expect(jump.moved).toBe(true);
    expect(aligner.getScript().tokens[jump.tokenIndex].raw).toBe('studio');
  });

  it('recovers cleanly when the speaker jumps backward to re-read an earlier section', () => {
    const script = [
      'Opening statement: sustainability drives every engineering choice inside our factory floor.',
      'Middle section discusses acoustic calibration, studio lighting ratios, and optical beam splitters.',
      'Closing remarks thank our investors, partners, and engineering volunteers around the globe.',
    ].join('\n\n');

    const aligner = new VoiceAligner(script);
    // Start near the closing remarks
    const closingIdx = aligner
      .getScript()
      .tokens.findIndex((t) => t.raw === 'Closing');
    aligner.seekToToken(closingIdx);
    aligner.processTranscript({
      utteranceId: 1,
      isFinal: true,
      text: 'closing remarks thank our investors partners',
    });
    const nearEnd = aligner.getCursorTokenIndex();
    expect(nearEnd).toBeGreaterThan(closingIdx);

    // Speaker decides to jump back to the opening statement
    const back = aligner.processTranscript({
      utteranceId: 2,
      isFinal: true,
      text: 'sustainability drives every engineering choice inside our factory',
    });
    expect(back.status).toBe('jumped-backward');
    expect(back.moved).toBe(true);
    expect(back.tokenIndex).toBeLessThan(15);
  });

  it('holds on an ambiguous jump into a repeated chorus until context disambiguates which occurrence', () => {
    const script = [
      'Intro paragraph about opening night energy, microphone calibration, stage lighting cues, camera framing, broadcast audio levels, and studio readiness before we begin tonight.',
      'Rise up together now and shine across the stage. Verse one tells the story of morning rain.',
      'Bridge paragraph explaining technical calibration, optical beam splitters, studio monitors, and presenter remote controls.',
      'Rise up together now and shine across the stage. Verse two celebrates the midnight symphony.',
      'Outro paragraph thanking everyone in the studio tonight.',
    ].join('\n\n');

    const aligner = new VoiceAligner(script);
    aligner.processTranscript({
      utteranceId: 1,
      isFinal: true,
      text: 'intro paragraph about opening night',
    });
    const introToken = aligner.getCursorTokenIndex();

    // Jump straight into the repeated chorus (matches BOTH Verse 1 and Verse 2 identically)
    const ambiguous = aligner.processTranscript({
      utteranceId: 2,
      isFinal: false,
      text: 'rise up together now',
    });
    // Should NOT prematurely teleport blindly while completely ambiguous
    expect(ambiguous.status).toBe('ambiguous-hold');
    expect(ambiguous.tokenIndex).toBe(introToken);

    // Next words disambiguate it as the SECOND chorus ("verse two celebrates the midnight")
    const resolved = aligner.processTranscript({
      utteranceId: 2,
      isFinal: true,
      text: 'rise up together now and shine across the stage verse two celebrates the midnight',
    });
    expect(resolved.status).toBe('jumped-forward');
    expect(resolved.moved).toBe(true);
    expect(aligner.getScript().tokens[resolved.tokenIndex].raw).toBe('midnight');
  });

  it('ignores bracketed stage directions and tracks Russian text with ё/е tolerance', () => {
    const script =
      '[Пауза 2 сек] Добрый вечер! Мы идём вперёд [улыбка] и запускаем проект сегодня.';
    const aligner = new VoiceAligner(script);

    const res = aligner.processTranscript({
      utteranceId: 1,
      isFinal: true,
      text: 'добрый вечер мы идем вперед и запускаем проект сегодня',
    });
    expect(res.status).toBe('end');
    expect(aligner.getScript().tokens[res.tokenIndex].raw).toBe('сегодня.');
  });

  it('does NOT teleport back to the beginning of a long script on a short stumble mid-script', () => {
    const script = [
      'We want to build something remarkable for every speaker across the studio tonight.',
      'Paragraph two covers optical glass calibration, camera framing distance, lighting balance, and glare reduction.',
      'Paragraph three explains audio capture latency, noise suppression filters, microphone positioning, and room acoustics.',
      'Paragraph four introduces live rehearsal metrics, cumulative session timing, and presenter remote ergonomics.',
      'Paragraph five concludes with practical staging advice, calm breathing cadence, and natural eye contact.',
    ].join('\n\n');

    const aligner = new VoiceAligner(script);
    const p4Start = aligner
      .getScript()
      .tokens.findIndex((t) => t.raw === 'introduces');
    aligner.seekToToken(p4Start);
    aligner.processTranscript({
      utteranceId: 1,
      isFinal: true,
      text: 'introduces live rehearsal metrics',
    });
    const midCursor = aligner.getCursorTokenIndex();
    expect(midCursor).toBeGreaterThan(45);

    // Speaker stumbles mid-script and utters 3-4 words resembling the opening line
    const stumble = aligner.processTranscript({
      utteranceId: 2,
      isFinal: true,
      text: 'we want to build',
    });
    expect(stumble.moved).toBe(false);
    expect(aligner.getCursorTokenIndex()).toBe(midCursor);

    // Speaker then continues right where they stopped -> tracks smoothly without losing place
    const recover = aligner.processTranscript({
      utteranceId: 3,
      isFinal: true,
      text: 'cumulative session timing and presenter remote',
    });
    expect(recover.moved).toBe(true);
    expect(recover.tokenIndex).toBeGreaterThan(midCursor);
  });

  it('weights phrases closer to the cursor higher than identical phrases far back at the start', () => {
    const script = [
      'Our platform delivers speed and clarity right from the opening keynote slide.',
      'Section two reviews quarterly server uptime, regional failover drills, latency percentiles, and hardware redundancy.',
      'Section three examines customer onboarding surveys, editorial templates, studio checklists, and script imports.',
      'Section four begins with live teleprompter diagnostics and microphone health indicators.',
      'After testing audio levels, our platform delivers speed and clarity for every broadcast anchor.',
    ].join('\n\n');

    const aligner = new VoiceAligner(script);
    const s4Start = aligner.getScript().tokens.findIndex((t) => t.raw === 'diagnostics');
    aligner.seekToToken(s4Start);
    aligner.processTranscript({
      utteranceId: 1,
      isFinal: true,
      text: 'diagnostics and microphone health indicators',
    });
    const stopPoint = aligner.getCursorTokenIndex();

    // Phrase "our platform delivers speed and clarity" appears BOTH at token 0 (far back)
    // AND just ahead in Section 5 -> proximity weighting must pick the nearby occurrence!
    const jump = aligner.processTranscript({
      utteranceId: 2,
      isFinal: true,
      text: 'our platform delivers speed and clarity',
    });
    expect(jump.moved).toBe(true);
    expect(jump.tokenIndex).toBeGreaterThan(stopPoint);
  });
});

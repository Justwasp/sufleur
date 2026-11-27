import { expandSpokenText, getHomophoneKey } from './normalizer';
import { wordSimilarity } from './similarity';
import { indexScript } from './tokenizer';
import {
  DEFAULT_ALIGNER_CONFIG,
  type AlignerConfig,
  type AlignmentResult,
  type IndexedScript,
  type TranscriptUpdate,
} from './types';

interface WindowMatch {
  startUnit: number;
  endUnit: number;
  score: number;
  matchedCount: number;
  weightedMatched: number;
}

interface RankedJumpCandidate extends WindowMatch {
  distance: number;
  isBackward: boolean;
  effectiveScore: number;
}

interface PendingJump {
  targetEndUnit: number;
  score: number;
  confirmations: number;
  isAmbiguous: boolean;
}

/**
 * Stateful 3-zone voice aligner designed for real-time teleprompters.
 *
 * Guarantees:
 * 1. Zone 1 (Local Forward): Tracks normal reading, minor 1-2 word skips, and consecutive
 *    repeated phrases in the script monotonically without double-advancing on interim updates.
 * 2. Zone 2 (Local Repeat Guard): Detects when the speaker stumbles and repeats a recently
 *    spoken phrase, holding steady instead of jumping backward or teleporting to another chorus.
 * 3. Zone 3 (Global Jump Recovery): Relocates smoothly forward or backward anywhere in the
 *    script after sustained divergence, with ambiguity disambiguation for repeated refrains.
 */
export class VoiceAligner {
  private script: IndexedScript;
  private config: AlignerConfig;

  /** Current confirmed match unit index (-1 before any word is spoken) */
  private cursorUnit = -1;

  /** Active utterance tracking to avoid double-advancing on flickering interim hypotheses */
  private activeUtteranceId: number | null = null;
  private activeUtteranceUnits: string[] = [];
  private utteranceConsumedCount = 0;

  /** Unmatched spoken words buffered since last confirmed alignment */
  private unmatchedBuffer: string[] = [];

  /** Recent spoken words (for context in repeat checks & global jumps) */
  private recentSpoken: string[] = [];

  /** Pending global jump hysteresis candidate */
  private pendingJump: PendingJump | null = null;

  constructor(rawScript: string, config?: Partial<AlignerConfig>) {
    this.config = { ...DEFAULT_ALIGNER_CONFIG, ...config };
    this.script = indexScript(rawScript, this.config.ignoreStageDirections);
  }

  public getScript(): IndexedScript {
    return this.script;
  }

  public getCursorTokenIndex(): number {
    if (this.cursorUnit < 0 || this.script.units.length === 0) return -1;
    const clamped = Math.min(this.cursorUnit, this.script.units.length - 1);
    return this.script.units[clamped].tokenIndex;
  }

  public getCursorUnitIndex(): number {
    return this.cursorUnit;
  }

  public setScript(rawScript: string): void {
    this.script = indexScript(rawScript, this.config.ignoreStageDirections);
    this.reset();
  }

  public updateConfig(partial: Partial<AlignerConfig>): void {
    const prevIgnore = this.config.ignoreStageDirections;
    this.config = { ...this.config, ...partial };
    if (prevIgnore !== this.config.ignoreStageDirections) {
      const rebuilt = this.script.tokens
        .map((t) => t.raw + t.trailingSpace)
        .join('');
      this.script = indexScript(rebuilt, this.config.ignoreStageDirections);
      this.reset();
    }
  }

  public reset(): void {
    this.cursorUnit = -1;
    this.activeUtteranceId = null;
    this.activeUtteranceUnits = [];
    this.utteranceConsumedCount = 0;
    this.unmatchedBuffer = [];
    this.recentSpoken = [];
    this.pendingJump = null;
  }

  /**
   * Authoritative manual seek (e.g. clicking a word, presenter remote, or manual scroll).
   */
  public seekToToken(tokenIndex: number): AlignmentResult {
    const tokens = this.script.tokens;
    if (tokens.length === 0) {
      this.reset();
      return this.makeResult('idle', 1, false);
    }

    const clampedToken = Math.max(0, Math.min(tokenIndex, tokens.length - 1));
    // Find the first speakable unit at or after clampedToken (or fallback to nearest before)
    let targetUnit = -1;
    for (let i = clampedToken; i < tokens.length; i++) {
      if (tokens[i].unitIndices.length > 0) {
        targetUnit = tokens[i].unitIndices[0] - 1;
        break;
      }
    }
    if (targetUnit === -1 && this.script.units.length > 0) {
      targetUnit = this.script.units.length - 1;
    }

    this.cursorUnit = targetUnit;
    this.unmatchedBuffer = [];
    this.pendingJump = null;
    this.utteranceConsumedCount = this.activeUtteranceUnits.length;

    return {
      tokenIndex: clampedToken,
      unitIndex: targetUnit,
      status: 'tracking',
      confidence: 1,
      moved: true,
      note: 'Manual seek',
    };
  }

  /**
   * Process a new interim or final ASR transcript update.
   */
  public processTranscript(update: TranscriptUpdate): AlignmentResult {
    if (this.script.units.length === 0) {
      return this.makeResult('idle', 0, false);
    }

    const spokenUnits = expandSpokenText(update.text);

    // Determine unconsumed delta for this utterance
    let delta: string[];
    if (this.activeUtteranceId !== update.utteranceId) {
      this.activeUtteranceId = update.utteranceId;
      this.activeUtteranceUnits = spokenUnits;
      this.utteranceConsumedCount = 0;
      delta = spokenUnits;
    } else {
      const lcp = this.commonPrefixLength(this.activeUtteranceUnits, spokenUnits);
      const effectiveConsumed = Math.min(this.utteranceConsumedCount, lcp);
      delta = spokenUnits.slice(effectiveConsumed);
      this.activeUtteranceUnits = spokenUnits;
      this.utteranceConsumedCount = effectiveConsumed;
    }

    if (delta.length === 0) {
      if (update.isFinal) {
        this.finalizeUtterance();
      }
      return this.makeResult(
        this.isAtEnd() ? 'end' : 'tracking',
        1,
        false,
      );
    }

    // Build evaluation sequence combining a small unmatched carry-over + fresh delta
    const combinedInput = [...this.unmatchedBuffer.slice(-5), ...delta];
    const prevCursor = this.cursorUnit;

    // ── ZONE 1 & ZONE 2: Local Forward vs. Speaker-Repeat Guard ──
    const forwardStart = Math.max(0, this.cursorUnit + 1);
    const forwardEnd = Math.min(
      this.script.units.length - 1,
      forwardStart + this.config.localForwardWindow,
    );

    const localMatch =
      forwardStart <= forwardEnd
        ? this.alignSequenceInWindow(combinedInput, forwardStart, forwardEnd, true)
        : null;

    const repeatProbe = delta.length >= 2 ? delta : combinedInput.slice(-4);
    const repeatMatch =
      this.cursorUnit >= 0
        ? this.alignSequenceInWindow(
            repeatProbe,
            Math.max(0, this.cursorUnit - this.config.localRepeatWindow),
            this.cursorUnit,
            false,
          )
        : null;

    const isStrongRepeat = Boolean(
      repeatMatch &&
        repeatMatch.score >= 0.68 &&
        repeatMatch.matchedCount >= Math.min(2, repeatProbe.length),
    );

    if (localMatch && this.acceptLocalForwardMatch(localMatch, combinedInput.length)) {
      const skipDistance = localMatch.startUnit - forwardStart;
      // If accepting this forward match requires skipping >= 2 unread words AND the spoken
      // phrase strongly matches what the speaker JUST read behind the cursor, treat it as
      // a speaker stumble/repeat rather than skipping ahead to a later identical phrase!
      if (skipDistance >= 2 && isStrongRepeat && repeatMatch && repeatMatch.score >= 0.75) {
        this.consumeDelta(delta);
        this.unmatchedBuffer = [];
        this.pendingJump = null;
        if (update.isFinal) {
          this.finalizeUtterance();
        }
        return {
          tokenIndex: this.getCursorTokenIndex(),
          unitIndex: this.cursorUnit,
          status: 'repeating',
          confidence: repeatMatch.score,
          moved: false,
          note: 'Repeat detected — holding position',
        };
      }

      this.cursorUnit = localMatch.endUnit;
      this.consumeDelta(delta);
      this.unmatchedBuffer = [];
      this.pendingJump = null;

      if (update.isFinal) {
        this.finalizeUtterance();
      }

      return this.makeResult(
        this.isAtEnd() ? 'end' : 'tracking',
        localMatch.score,
        this.cursorUnit !== prevCursor,
      );
    }

    // Pure Zone 2: Speaker repeated what they just said and no valid forward match exists
    if (isStrongRepeat && repeatMatch) {
      this.consumeDelta(delta);
      this.unmatchedBuffer = [];
      this.pendingJump = null;

      if (update.isFinal) {
        this.finalizeUtterance();
      }

      return {
        tokenIndex: this.getCursorTokenIndex(),
        unitIndex: this.cursorUnit,
        status: 'repeating',
        confidence: repeatMatch.score,
        moved: false,
        note: 'Repeat detected — holding position',
      };
    }

    // Neither Zone 1 nor Zone 2 matched: accumulate into unmatched buffer for Zone 3
    for (const w of delta) {
      this.unmatchedBuffer.push(w);
      this.recentSpoken.push(w);
    }
    this.utteranceConsumedCount = this.activeUtteranceUnits.length;
    if (this.unmatchedBuffer.length > 14) {
      this.unmatchedBuffer = this.unmatchedBuffer.slice(-14);
    }
    if (this.recentSpoken.length > 30) {
      this.recentSpoken = this.recentSpoken.slice(-30);
    }

    // ── ZONE 3: Global Jump Recovery (Forward or Backward Anywhere in Script) ──
    if (this.unmatchedBuffer.length >= this.config.jumpTriggerMinUnmatched) {
      const jumpOutcome = this.attemptGlobalJump();
      if (jumpOutcome) {
        if (update.isFinal) {
          this.finalizeUtterance();
        }
        return jumpOutcome;
      }
    }

    if (update.isFinal) {
      this.finalizeUtterance();
    }

    return this.makeResult(
      this.pendingJump?.isAmbiguous ? 'ambiguous-hold' : 'tracking',
      0,
      false,
      this.pendingJump?.isAmbiguous
        ? 'Repeated phrase — waiting for context word'
        : undefined,
    );
  }

  private acceptLocalForwardMatch(match: WindowMatch, inputLen: number): boolean {
    const skipDistance = match.startUnit - (this.cursorUnit + 1);

    // Single-word immediate next step: accept high-confidence match within 2 words ahead
    if (inputLen === 1) {
      return match.matchedCount === 1 && match.score >= 0.85 && skipDistance <= 2;
    }

    // Two-word match: allow moderate skip if both words match strongly
    if (match.matchedCount >= 2) {
      const effectiveThreshold =
        skipDistance <= 3
          ? this.config.localMatchThreshold
          : Math.min(0.82, this.config.localMatchThreshold + 0.015 * skipDistance);
      return match.score >= effectiveThreshold;
    }

    // Single distinctive word match right ahead (e.g. ASR dropped 1 filler/short word)
    if (match.matchedCount === 1 && skipDistance <= 2 && match.score >= 0.86) {
      const matchedUnit = this.script.units[match.endUnit];
      return matchedUnit.idf >= 0.65 && matchedUnit.norm.length >= 4;
    }

    return false;
  }

  /**
   * Align a short spoken sequence against a contiguous window of script units.
   * Uses monotonic greedy-DP anchoring so skipped words and stumbles are tolerated cleanly.
   */
  private alignSequenceInWindow(
    spoken: string[],
    winStart: number,
    winEnd: number,
    preferFront: boolean,
  ): WindowMatch | null {
    if (spoken.length === 0 || winStart > winEnd) return null;

    const units = this.script.units;
    let best: WindowMatch | null = null;
    let bestRankScore = -Infinity;

    // Try anchoring the spoken sequence at each possible starting script unit in the window
    for (let anchor = winStart; anchor <= winEnd; anchor++) {
      // Also allow skipping up to 2 leading filler words from spoken
      const maxSpokenOffset = Math.min(2, spoken.length - 1);

      for (let sOffset = 0; sOffset <= maxSpokenOffset; sOffset++) {
        // Quick reject if anchor word doesn't match spoken[sOffset] at all
        const firstSim = wordSimilarity(
          spoken[sOffset],
          units[anchor].norm,
          units[anchor].homophoneKey,
        );
        if (firstSim < 0.7) continue;

        let curScript = anchor;
        let curSpoken = sOffset;
        let matchedCount = 0;
        let weightedSum = 0;
        let totalWeight = 0;
        let lastMatchedUnit = anchor;

        while (curSpoken < spoken.length && curScript <= winEnd) {
          const sw = spoken[curSpoken];
          let matchedHere = false;

          // Look ahead up to 2 script units for minor skipped words
          let bestLocalSim = 0;
          let bestLocalScriptIdx = -1;
          const maxJump = Math.min(winEnd, curScript + 2);

          for (let j = curScript; j <= maxJump; j++) {
            const sim = wordSimilarity(sw, units[j].norm, units[j].homophoneKey);
            // Slightly prefer zero-skip over skipping script words
            const adj = sim - (j - curScript) * 0.04;
            if (sim >= 0.7 && adj > bestLocalSim) {
              bestLocalSim = sim;
              bestLocalScriptIdx = j;
            }
          }

          if (bestLocalScriptIdx !== -1) {
            const u = units[bestLocalScriptIdx];
            matchedCount += 1;
            weightedSum += bestLocalSim * u.idf;
            totalWeight += u.idf;
            lastMatchedUnit = bestLocalScriptIdx;
            curScript = bestLocalScriptIdx + 1;
            matchedHere = true;
          } else {
            totalWeight += 0.65;
          }

          curSpoken += 1;
          // Stop if we had two misses in a row after matching at least once
          if (!matchedHere && matchedCount > 0 && curSpoken < spoken.length) {
            const nextSim =
              curScript <= winEnd
                ? wordSimilarity(
                    spoken[curSpoken],
                    units[curScript].norm,
                    units[curScript].homophoneKey,
                  )
                : 0;
            if (nextSim < 0.7) {
              // allow 1 spoken insertion word without breaking
              continue;
            }
          }
        }

        if (matchedCount === 0 || totalWeight === 0) continue;

        // Penalize unconsumed trailing spoken words only slightly if we hit window end
        const rawScore = weightedSum / totalWeight;
        const coverage = matchedCount / (spoken.length - sOffset);
        const combinedScore = rawScore * 0.7 + coverage * 0.3;

        // Monotonic proximity prior: in Zone 1, earlier occurrences win over identical later copies
        const distFromStart = anchor - winStart;
        const distancePenalty = preferFront ? distFromStart * 0.028 : 0;
        // Favor matching more words cleanly (but not jumping far ahead for a single word)
        const lengthBonus = Math.min(0.24, (matchedCount - 1) * 0.08);
        const rankScore = combinedScore + lengthBonus - distancePenalty - sOffset * 0.04;

        if (rankScore > bestRankScore) {
          bestRankScore = rankScore;
          best = {
            startUnit: anchor,
            endUnit: lastMatchedUnit,
            score: Math.min(1, combinedScore),
            matchedCount,
            weightedMatched: weightedSum,
          };
        }
      }
    }

    return best;
  }

  /**
   * Zone 3: Search globally via bigram/trigram index for jump forward or backward.
   * Uses ambiguity margin & hysteresis so repeated phrases never cause false teleports.
   */
  private attemptGlobalJump(): AlignmentResult | null {
    const query = this.unmatchedBuffer.slice(-8);
    if (query.length < this.config.jumpTriggerMinUnmatched) return null;

    const candidateSeeds = new Set<number>();

    // Gather candidate anchors from trigrams first, then bigrams
    for (let i = 0; i < query.length - 1; i++) {
      const k1 = getHomophoneKey(query[i]);
      const k2 = getHomophoneKey(query[i + 1]);

      if (i + 2 < query.length) {
        const k3 = getHomophoneKey(query[i + 2]);
        const triHits = this.script.trigramIndex.get(`${k1} ${k2} ${k3}`);
        if (triHits) {
          for (const pos of triHits) {
            candidateSeeds.add(Math.max(0, pos - i));
          }
        }
      }

      const biHits = this.script.bigramIndex.get(`${k1} ${k2}`);
      if (biHits) {
        for (const pos of biHits) {
          candidateSeeds.add(Math.max(0, pos - i));
        }
      }
    }

    if (candidateSeeds.size === 0) return null;

    // Deduplicate overlapping seed regions (cluster within 4 units)
    const sortedSeeds = Array.from(candidateSeeds).sort((a, b) => a - b);
    const regions: number[] = [];
    for (const seed of sortedSeeds) {
      if (regions.length === 0 || seed - regions[regions.length - 1] > 4) {
        regions.push(seed);
      }
    }

    const scored: RankedJumpCandidate[] = [];
    const maxUnit = this.script.units.length - 1;

    for (const regionStart of regions) {
      const winStart = Math.max(0, regionStart - 2);
      const winEnd = Math.min(maxUnit, regionStart + query.length + 5);
      const match = this.alignSequenceInWindow(query, winStart, winEnd, false);
      if (
        match &&
        match.matchedCount >= 3 &&
        match.score >= this.config.globalJumpThreshold
      ) {
        // Ignore hits that are actually inside the current repeat zone
        const insideRepeatZone =
          this.cursorUnit >= 0 &&
          match.endUnit <= this.cursorUnit &&
          match.startUnit >= Math.max(0, this.cursorUnit - this.config.localRepeatWindow);
        if (!insideRepeatZone) {
          const isBackward = match.endUnit <= this.cursorUnit;
          const distance = Math.abs(match.startUnit - Math.max(0, this.cursorUnit));
          const penalty = this.proximityPenalty(distance, isBackward);
          scored.push({
            ...match,
            distance,
            isBackward,
            effectiveScore: match.score - penalty,
          });
        }
      }
    }

    if (scored.length === 0) return null;

    // Rank by proximity-weighted effectiveScore first (closer to where the speaker stopped
    // carries higher weight than a similar phrase far back at the start of the script)
    scored.sort((a, b) => {
      if (Math.abs(b.effectiveScore - a.effectiveScore) > 0.015) {
        return b.effectiveScore - a.effectiveScore;
      }
      if (b.matchedCount !== a.matchedCount) return b.matchedCount - a.matchedCount;
      return this.directionalDistance(a.startUnit) - this.directionalDistance(b.startUnit);
    });

    // Deduplicate overlapping top matches
    const distinct: RankedJumpCandidate[] = [];
    for (const m of scored) {
      const overlaps = distinct.some(
        (d) => Math.abs(d.startUnit - m.startUnit) <= 5 || Math.abs(d.endUnit - m.endUnit) <= 5,
      );
      if (!overlaps) distinct.push(m);
    }

    const best = distinct[0];
    const secondBest = distinct[1];
    const margin = secondBest
      ? best.effectiveScore - secondBest.effectiveScore
      : 1.0;
    const isAmbiguous = Boolean(secondBest && margin < this.config.ambiguityMargin);

    if (isAmbiguous) {
      // Multiple identical occurrences (e.g. repeated chorus): wait for more context words!
      // Only break tie if user has spoken >= 6 matching words inside the repeated block
      if (query.length >= 7 && best.matchedCount >= 6) {
        const forwardBest = distinct.find(
          (c) =>
            c.startUnit > this.cursorUnit &&
            best.effectiveScore - c.effectiveScore < this.config.ambiguityMargin,
        );
        const chosen = forwardBest ?? best;
        return this.commitGlobalJump(chosen);
      }

      this.pendingJump = {
        targetEndUnit: best.endUnit,
        score: best.score,
        confirmations: 1,
        isAmbiguous: true,
      };
      return null;
    }

    // Distance-aware confirmation gate:
    // - Nearby jumps (<= 45 words from stop point) recover rapidly.
    // - Far forward jumps (> 45 words) require >= 4 distinctive words or hysteresis.
    // - Far backward jumps (> 45 words, e.g. back to the beginning of the script) require
    //   strong distinctive evidence (>= 5 words) or sustained confirmation so a brief stumble
    //   never teleports the speaker back to the top!
    const isConsistentWithPending =
      this.pendingJump !== null &&
      Math.abs(this.pendingJump.targetEndUnit - best.endUnit) <= 6;

    const isFar = best.distance > 45;
    let shouldCommit = false;

    if (!isFar) {
      shouldCommit =
        best.matchedCount >= 4 ||
        (best.matchedCount >= 3 &&
          best.score >= 0.8 &&
          best.weightedMatched >= 1.85) ||
        isConsistentWithPending;
    } else if (!best.isBackward) {
      shouldCommit =
        (best.matchedCount >= 4 &&
          best.score >= 0.78 &&
          best.weightedMatched >= 2.2) ||
        (isConsistentWithPending && best.matchedCount >= 3 && best.score >= 0.8);
    } else {
      // Far backward jump guard: prevent accidental jump to start on 3-4 word stumble
      shouldCommit =
        (best.matchedCount >= 5 &&
          best.score >= 0.82 &&
          best.weightedMatched >= 3.0) ||
        (isConsistentWithPending &&
          best.matchedCount >= 4 &&
          best.score >= 0.8 &&
          best.weightedMatched >= 2.4);
    }

    if (shouldCommit) {
      return this.commitGlobalJump(best);
    }

    this.pendingJump = {
      targetEndUnit: best.endUnit,
      score: best.score,
      confirmations: 1,
      isAmbiguous: false,
    };
    return null;
  }

  /**
   * Smooth proximity decay from the current cursor position so phrases closer to where
   * the speaker stopped always outrank similar phrases far away (especially back at the start).
   */
  private proximityPenalty(distance: number, isBackward: boolean): number {
    if (!isBackward) {
      if (distance <= 35) return (distance / 35) * 0.03;
      return Math.min(0.15, 0.03 + 0.04 * Math.log2(1 + (distance - 35) / 25));
    }
    // Backward jumps pay a slightly higher proximity cost the farther behind the cursor they are
    if (distance <= 35) return 0.02 + (distance / 35) * 0.04;
    return Math.min(0.22, 0.06 + 0.06 * Math.log2(1 + (distance - 35) / 20));
  }

  private commitGlobalJump(match: WindowMatch): AlignmentResult {
    const prevCursor = this.cursorUnit;
    const isForward = match.endUnit > prevCursor;
    this.cursorUnit = match.endUnit;
    this.unmatchedBuffer = [];
    this.pendingJump = null;

    const status = isForward ? 'jumped-forward' : 'jumped-backward';
    return {
      tokenIndex: this.getCursorTokenIndex(),
      unitIndex: this.cursorUnit,
      status,
      confidence: match.score,
      moved: true,
      note: isForward ? 'Jumped forward in script' : 'Jumped backward in script',
    };
  }

  private directionalDistance(targetStart: number): number {
    if (targetStart > this.cursorUnit) {
      return targetStart - this.cursorUnit;
    }
    // Slight preference for forward jumps when equidistant
    return (this.cursorUnit - targetStart) * 1.4 + 10;
  }

  private consumeDelta(delta: string[]): void {
    this.utteranceConsumedCount = this.activeUtteranceUnits.length;
    for (const w of delta) {
      this.recentSpoken.push(w);
    }
    if (this.recentSpoken.length > 30) {
      this.recentSpoken = this.recentSpoken.slice(-30);
    }
  }

  private finalizeUtterance(): void {
    this.activeUtteranceId = null;
    this.activeUtteranceUnits = [];
    this.utteranceConsumedCount = 0;
  }

  private commonPrefixLength(a: string[], b: string[]): number {
    const minLen = Math.min(a.length, b.length);
    let i = 0;
    while (i < minLen && a[i] === b[i]) {
      i++;
    }
    return i;
  }

  private isAtEnd(): boolean {
    return (
      this.script.units.length > 0 &&
      this.cursorUnit >= this.script.units.length - 1
    );
  }

  private makeResult(
    status: AlignmentResult['status'],
    confidence: number,
    moved: boolean,
    note?: string,
  ): AlignmentResult {
    return {
      tokenIndex: this.getCursorTokenIndex(),
      unitIndex: this.cursorUnit,
      status,
      confidence,
      moved,
      note,
    };
  }
}

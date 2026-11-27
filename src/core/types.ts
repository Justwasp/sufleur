export interface ScriptToken {
  /** 0-based index in the display token array */
  index: number;
  /** Raw text as written in the script (preserves punctuation & casing) */
  raw: string;
  /** Whitespace following this token (spaces, tabs, newlines) */
  trailingSpace: string;
  /** 0-based paragraph index */
  paragraphIndex: number;
  /** Whether this token is spoken aloud (false for [stage directions] or pure symbols) */
  isSpeakable: boolean;
  /** Whether this token is a stage direction like [pause] */
  isStageDirection: boolean;
  /** Expanded normalized match unit indices belonging to this display token */
  unitIndices: number[];
}

export interface MatchUnit {
  /** 0-based index in the speakable matching stream */
  unitIndex: number;
  /** Back-pointer to the display ScriptToken */
  tokenIndex: number;
  /** Canonical normalized lowercase word */
  norm: string;
  /** Homophone equivalence class key */
  homophoneKey: string;
  /** Smooth inverse-document-frequency weight (0.4..1.0) */
  idf: number;
}

export interface IndexedScript {
  tokens: ScriptToken[];
  units: MatchUnit[];
  /** Inverted index mapping "w1 w2" -> sorted list of starting unitIndex */
  bigramIndex: Map<string, number[]>;
  /** Inverted index mapping "w1 w2 w3" -> sorted list of starting unitIndex */
  trigramIndex: Map<string, number[]>;
  /** Inverted index mapping single normalized word -> sorted list of unitIndex */
  unigramIndex: Map<string, number[]>;
  /** Total speakable display word count */
  speakableWordCount: number;
}

export interface TranscriptUpdate {
  /** Recognized text for the current utterance */
  text: string;
  /** True when the ASR engine finalized this utterance */
  isFinal: boolean;
  /** Monotonic identifier grouping interim updates of the same utterance */
  utteranceId: number;
}

export type AlignmentStatus =
  | 'idle'
  | 'tracking'
  | 'repeating'
  | 'jumped-forward'
  | 'jumped-backward'
  | 'ambiguous-hold'
  | 'end';

export interface AlignmentResult {
  /** Current display token index (-1 before start) */
  tokenIndex: number;
  /** Current match unit index (-1 before start) */
  unitIndex: number;
  /** Current tracker state */
  status: AlignmentStatus;
  /** Match confidence 0..1 */
  confidence: number;
  /** Whether cursor position changed on this update */
  moved: boolean;
  /** Optional human-readable telemetry note (e.g. jump or repeat hold) */
  note?: string;
}

export interface AlignerConfig {
  /** Lookahead window in match units for Zone 1 normal reading */
  localForwardWindow: number;
  /** Lookbehind window in match units for Zone 2 speaker-repeat guard */
  localRepeatWindow: number;
  /** Minimum accumulated unmatched spoken units before Zone 3 global jump triggers */
  jumpTriggerMinUnmatched: number;
  /** Minimum similarity score for a local forward match */
  localMatchThreshold: number;
  /** Minimum similarity score for a global jump candidate */
  globalJumpThreshold: number;
  /** Minimum score margin over 2nd-best candidate for an unambiguous jump */
  ambiguityMargin: number;
  /** Ignore bracketed stage directions like [pause] */
  ignoreStageDirections: boolean;
}

export const DEFAULT_ALIGNER_CONFIG: AlignerConfig = {
  localForwardWindow: 14,
  localRepeatWindow: 12,
  jumpTriggerMinUnmatched: 3,
  localMatchThreshold: 0.62,
  globalJumpThreshold: 0.74,
  ambiguityMargin: 0.12,
  ignoreStageDirections: true,
};

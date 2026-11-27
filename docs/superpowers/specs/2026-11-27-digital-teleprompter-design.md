# Sufleur — Digital Voice-Tracked Teleprompter Design Spec

**Date:** 2026-11-27  
**Workspace:** `/Users/alex/WebProjects/sufleur`  
**Architecture:** Pure Frontend SPA (React + TypeScript + Vite)  
**Primary Language:** English (`en-US` default), with full multilingual support (including `en-GB`, `en-AU`, `ru-RU`, and standard BCP-47 locales)

---

## 1. Product Goal & Core Requirements

Build a production-grade, browser-based digital teleprompter (**Sufleur**) where a speaker uploads or pastes any script (`.txt`, `.md`, `.srt`, `.vtt`, `.html`, `.rtf`, `.pdf`, `.docx`, legacy binary `.doc`, or raw pasted text), displays it in large, customizable typography, and has the screen automatically scroll in real time as they read aloud.

### Must-Have Guarantees
1. **Repeat-Safe & Jump-Capable Voice Alignment:**
   - **Speaker stumbles & repeats:** If the speaker repeats a word or phrase 2+ times, the prompter holds steady without jumping backward wildly or teleporting to another occurrence in the script.
   - **Repetitive scripts:** If the script itself consists of repeated phrases, refrains, choruses, or identical consecutive sentences, the prompter tracks each occurrence monotonically in order without getting stuck or skipping copies.
   - **Slip-ups & jumps:** If the speaker skips ahead (a few words or several paragraphs) or jumps back to re-read an earlier section, the prompter detects the divergence and smoothly relocates to the correct position.
   - **English-first speech tolerance:** Handles English contractions (`don't` ↔ `do not`, `it's` ↔ `it is`), common English ASR homophones (`to`/`too`/`two`, `there`/`their`/`they're`, `your`/`you're`, etc.), spoken numbers (`25` ↔ `twenty five`, `2026` ↔ `twenty twenty six`), partial interim hypotheses, and Russian `ё`/`е` normalization when reading Russian scripts.
2. **Pluggable Speech Recognition Engines (User-Selectable):**
   - **Web Speech API** (default, zero-setup real-time streaming in Chrome/Edge/Safari).
   - **Offline WASM (`vosk-browser`)** — fully offline streaming speech recognition in a Web Worker, loading user-supplied `.tar.gz`/`.zip` models (with presets/links for `vosk-model-small-en-us-0.15` and `vosk-model-small-ru-0.22`) cached locally in IndexedDB.
   - **Cloud Streaming (`Deepgram Live WebSocket`)** — direct browser WebSocket via `Sec-WebSocket-Protocol: ['token', apiKey]` (BYOK stored strictly in user's local browser storage, never bundled or committed).
   - **Custom HTTP STT Endpoint** — user-configured OpenAI-compatible / local `whisper.cpp` server URL + optional API key (chunked audio upload).
   - **Constant-Speed Auto-Scroll Fallback** — smooth WPM / px-per-second auto-scroll when microphone or STT is unavailable.
3. **Multi-Format Client-Side Document Import:**
   - Plain text & markup: `.txt`, `.md`, `.csv`, `.log`, `.srt`, `.vtt` (strips subtitle timestamps/indices), `.html`, `.htm` (smart UTF-8 with Windows-1251 fallback).
   - Rich documents: `.rtf` (pure-TS parser handling `\uN` Unicode and hex codepage escapes), `.pdf` (`pdfjs-dist` with coordinate-ordered paragraph reconstruction), `.docx` (`mammoth`), and legacy binary `.doc` (pure-TS OLE2 CFBF + Word FIB/PieceTable extractor with magic-byte detection for misnamed RTF/HTML `.doc` files).
   - Direct clipboard paste, drag-and-drop file upload anywhere in the studio, and built-in live script editor.
4. **Full Visual Customization & Studio Controls:**
   - Font family (high-legibility sans, serif, mono, OpenDyslexic-friendly stack), font size (`24px–140px`), line height, horizontal margins/padding, text alignment (left / center).
   - Background color, text color, active/spoken highlight color, dimmed read-text opacity, live WCAG contrast ratio indicator.
   - **Mirroring:** Normal, Horizontal (`scaleX(-1)` for beam-splitter teleprompter glass), Vertical (`scaleY(-1)`), and Both (`scale(-1, -1)`).
   - **Reading Guide (Eye-Line):** Adjustable focus bar & side markers (default 32% from top) to keep the speaker's gaze locked near the camera lens.
   - **Local Persistence:** Script library (create, edit, duplicate, delete, search) and visual presets saved in `localStorage`.
   - **Keyboard & Presenter Remote Support:** `Space` (play/pause), `↑`/`↓` and `PageUp`/`PageDown` (step back/forward — compatible with standard wireless presenter remotes), `M` (horizontal mirror), `V` (vertical mirror), `F` (fullscreen), `R` (reset to start), `+`/`-` (font size), `Esc` (exit stage).

---

## 2. System Architecture & Module Boundaries

Each module has a single responsibility, explicit TypeScript interfaces, and zero circular dependencies:

```text
src/
├── core/
│   ├── types.ts             # ScriptToken, AlignmentResult, AlignerConfig, TranscriptUpdate
│   ├── normalizer.ts        # English contractions, numbers, homophone groups, Russian ё→е
│   ├── tokenizer.ts         # Script tokenization, speakable mask, bigram/trigram index, IDF weights
│   ├── similarity.ts        # Exact, contraction/homophone, prefix/stem, Damerau-Levenshtein scoring
│   ├── aligner.ts           # Stateful 3-zone VoiceAligner (local forward, repeat guard, global jump)
│   └── scrollController.ts  # Critically damped rAF smooth scroller + constant-speed WPM fallback
├── speech/
│   ├── types.ts             # SpeechEngine interface, EngineStatus, EngineConfig
│   ├── audioCapture.ts      # getUserMedia, 16kHz PCM resampling (AudioWorklet/ScriptProcessor), VU level
│   ├── webSpeechEngine.ts   # Browser SpeechRecognition wrapper with auto-restart & utterance IDs
│   ├── voskEngine.ts        # vosk-browser WASM engine + IndexedDB model cache
│   ├── deepgramEngine.ts    # Deepgram wss://api.deepgram.com/v1/listen live WebSocket client
│   ├── customHttpEngine.ts  # MediaRecorder chunked upload to OpenAI/whisper.cpp compatible endpoint
│   └── engineFactory.ts     # Instantiates active engine cleanly
├── parsers/
│   ├── types.ts             # ParsedDocument, ParseError
│   ├── textParser.ts        # TXT, MD, SRT, VTT with UTF-8 / Windows-1251 decoding
│   ├── htmlRtfParser.ts     # HTML (DOMParser) and RTF control-word/Unicode/hex decoder
│   ├── pdfParser.ts         # pdfjs-dist page text layout reconstruction
│   ├── docxParser.ts        # mammoth .docx raw text extraction
│   ├── docBinaryParser.ts   # OLE2 Compound File Binary + Word FIB/CLX/PieceTable parser
│   └── index.ts             # Magic-byte sniffing + extension router
├── store/
│   ├── types.ts             # ScriptItem, AppearanceSettings, StylePreset, SpeechSettings
│   ├── defaults.ts          # English-first sample scripts (normal + repeat showcase) & studio presets
│   ├── storage.ts           # Safe localStorage persistence (scripts, presets, settings) + IndexedDB model store
│   └── usePrompterStore.ts  # React state/context store coordinating scripts, settings, and aligner
└── ui/
    ├── StudioView.tsx       # Main workspace: script library sidebar, editor/dropzone, live preview
    ├── PrompterStage.tsx    # Stage/fullscreen teleprompter surface, mirroring, eye-line, click-to-jump
    ├── FloatingHud.tsx      # Auto-hiding HUD: transport, mic VU, live heard words, quick toggles, demo simulator
    ├── SettingsPanel.tsx    # Typography, colors + contrast badge, mirroring, eye-line, presets
    ├── SpeechConfigPanel.tsx# Engine picker, language selector, Vosk model manager, BYOK cloud fields
    └── HotkeysHelpModal.tsx # Keyboard & presenter remote shortcut reference
```

---

## 3. Core Algorithm Specification: `VoiceAligner`

### 3.1 Tokenization & Normalization (`tokenizer.ts`, `normalizer.ts`)
- Every script is split into displayable `ScriptToken[]` preserving exact original whitespace, paragraph boundaries, and punctuation for crisp rendering.
- Each token also stores `matchForms: string[]` (normalized spoken equivalents):
  - Lowercase, strip punctuation, normalize apostrophes (`’` → `'`).
  - **English contraction expansion & canonicalization:** Both contracted (`don't` → `dont`, `do`, `not`) and expanded forms are mapped so `"do not"` in the script matches `"don't"` in speech (and vice versa) via multi-token canonical expansion in the matching stream.
  - **Number normalization:** Integer tokens (`0–9999`, years like `2026`, percentages `%`, currencies `$`) generate spoken English word equivalents so `"25%"` matches `"twenty five percent"`.
  - **English homophone equivalence classes:** `to/too/two`, `there/their/theyre`, `your/youre`, `its/it's`, `no/know`, `right/write`, `by/buy/bye`, `for/four`, `one/won`, `here/hear`, `our/hour`, `where/wear`, `new/knew`, `see/sea`, `through/threw`.
  - **Russian normalization:** `ё → е`, Cyrillic lowercase.
  - **Stage directions:** Tokens inside `[...]` (configurable, on by default) are marked `isSpeakable: false` and skipped transparently during matching while still shown visually in muted style.
- **Indexing:**
  - `idfWeights`: smooth inverse document frequency per normalized token (`0.4` for stop words / very frequent tokens, `1.0` for rare/content words).
  - `ngramIndex`: inverted index of bigrams (`w[i] w[i+1]`) and trigrams (`w[i] w[i+1] w[i+2]`) → sorted `number[]` of starting speakable indices.

### 3.2 Spoken Stream Accounting (Anti-Double-Advance for Interim ASR)
Real-time ASR engines emit flickering `interim` hypotheses for the same utterance before a `final` event arrives:
- Example:
  - Utterance #1 interim: `"we are"`
  - Utterance #1 interim: `"we are going"`
  - Utterance #1 interim: `"we are going to"`
  - Utterance #1 final: `"we are going to build"`
- Naive aligners re-feed the whole interim string as fresh words, causing a repetitive script (`"we are going, we are going"`) to jump ahead multiple times on a single spoken phrase!
- **Solution:** `VoiceAligner` tracks a unified timeline of **committed spoken tokens** (from `final` results) + **active utterance tokens** (replaced atomically per `utteranceId`), paired with a **`committedAnchor`** (`cursorAtUtteranceStart` + `consumedFinalCount`):
  - While an utterance is `interim`, matching evaluates from `utteranceStartCursor` (or the last confirmed advance point inside the utterance) using only the delta of new spoken tokens beyond `consumedTokensInUtterance`.
  - Consequently, re-emitting `"we are going"` three times in interim updates moves the cursor **once** to the end of `"we are going"`, never skipping into the next repeated copy!
  - When the speaker actually says `"we are going"` a *second time*, new spoken tokens appear past `consumedCount`, cleanly advancing into the second copy in a repetitive script.

### 3.3 Three-Zone Alignment State Machine
Maintains `cursor` (index of the current active speakable token), `unmatchedStreak` (count of consecutive new spoken words that failed to match locally), and `pendingJump` (hysteresis state).

1. **Zone 1 — Local Forward Window `[cursor, cursor + 18]`:**
   - Takes the unconsumed spoken tail (up to 8 words) and runs a weighted local sequence alignment against `[cursor, cursor + 18]` (allowing up to 2 skipped script words or 1–2 spoken filler/stumble words).
   - Score combines word similarity × IDF weight minus a small monotonic distance penalty (`0.025 * skipDistance`).
   - **Rule:** If the best local forward alignment has score ≥ `0.62` (or exact match on ≥ 1 distinctive word immediately at `cursor + 1..3`), advance `cursor` to the matched end token, reset `unmatchedStreak = 0`, clear `pendingJump`, and mark those spoken tokens consumed.

2. **Zone 2 — Local Speaker-Repeat Guard `[max(0, cursor - 12), cursor]`:**
   - Evaluated whenever Zone 1 does not find a strong forward continuation.
   - Checks whether the recent spoken tail (2–6 words) strongly matches the tokens immediately *behind* `cursor` (`[cursor - 12 .. cursor]`, score ≥ `0.70`).
   - **Behavior:**
     - **Short stumble/repeat (1–4 words repeated):** Keep `cursor` **locked in place** (status: `repeating`), do NOT increment `unmatchedStreak`, and do NOT trigger a global jump! Once the speaker moves past the repeated phrase, Zone 1 immediately resumes forward progress.
     - **Deliberate local restart (speaker re-reads ≥ 3 consecutive words starting 5–12 tokens back AND continues matching sequentially behind cursor):** Gently step `cursor` back to that position and track forward from there.

3. **Zone 3 — Global Jump Recovery (Forward or Backward Anywhere in Script):**
   - Triggered only when Zone 1 and Zone 2 both fail AND `unmatchedStreak >= 3` new spoken words have accumulated.
   - Extracts all bigrams & trigrams from the last `6–10` spoken tokens and looks up candidate positions across the entire script via `ngramIndex`.
   - Scores each candidate anchor with full local alignment over the 6–10 spoken words.
   - **Ambiguity / Repeat-Safe Disambiguation:**
     - Let `best` and `secondBest` be the top two non-overlapping candidate regions.
     - **Distinctive jump:** If `best.score >= 0.75` and `(best.score - secondBest.score) >= 0.12` (clearly unique match, ≥ 3 matched words), confirm jump after 1–2 consistent frames (`hysteresis`), move `cursor`, and emit `event: 'jump'` (forward or backward).
     - **Ambiguous repeated phrase (e.g., speaker jumped into a chorus that appears 3 times with identical scores):** Hold in `pendingJump` and wait for 1–3 more spoken words until surrounding context breaks the tie; if the user jumps straight into a repeated section and stops near a tie after 6+ words, break tie toward the nearest *forward* occurrence after `cursor`.
   - **Manual Override:** `aligner.seekTo(tokenIndex)` resets `unmatchedStreak`, `pendingJump`, and spoken consumption buffers immediately so clicking a word, scrolling manually, or pressing a remote key is always instantaneous and authoritative.

---

## 4. Document Parsing Strategy (Pure Browser)

| Format | Strategy | Edge Cases Handled |
| --- | --- | --- |
| `.txt`, `.md`, `.csv`, `.log` | `ArrayBuffer` → UTF-8 (`fatal: true`) → fallback `windows-1251` | BOM stripping, CRLF/CR normalization, legacy Cyrillic `.txt` |
| `.srt`, `.vtt` | Text decode + subtitle parser | Strips `WEBVTT`, sequence numbers, `00:00:01,000 --> ...` timestamps, HTML tags |
| `.html`, `.htm` | `DOMParser` | Removes `<script>`, `<style>`, `<noscript>`, preserves block paragraph breaks |
| `.rtf` | Pure-TS RTF state-machine parser | Skips font/color/stylesheet headers (`\fonttbl`, `\colortbl`, `\*`), decodes `\uN` signed 16-bit Unicode and `\'xx` CP1251/CP1252 hex bytes, converts `\par`/`\line` to newlines |
| `.pdf` | `pdfjs-dist` (bundled worker) | Orders text items by Y descending / X ascending per page, detects line breaks and paragraph gaps, clear error on scanned image-only PDFs |
| `.docx` | `mammoth.extractRawText` | Preserves paragraph structure; verifies ZIP magic bytes (`PK\x03\x04`) |
| `.doc` (Word 97–2003) | Pure-TS OLE2 CFBF + Word FIB/PieceTable parser | First sniffs magic bytes (handles `.doc` files that are actually `.rtf`, `.html`, or `.docx`!). For true binary OLE2 `.doc`, parses FAT/MiniFAT directory to read `WordDocument` + `0Table`/`1Table`, extracts `fcClx` piece table (UTF-16LE Unicode and compressed CP1252/CP1251 pieces), strips Word field codes (`\x13..\x14..\x15`), converts `\r` to `\n`. |

---

## 5. UX, Error Handling & Verification Plan

### Error Handling
- **Mic denied / unsupported browser:** Clear inline status banner explaining the issue + 1-click switch to `Auto-Scroll` mode or another STT engine.
- **Vosk model missing / corrupt archive:** Guided inline card with direct link to official small English (`en-US`, ~40MB) / Russian (`ru`, ~45MB) models and drag-and-drop loader; invalid archives show a clean error without crashing.
- **Deepgram / Custom endpoint auth or network error:** Clear status message (e.g., invalid API key / CORS / disconnect), automatic graceful fallback to paused state without losing script or cursor position.
- **Unparseable or scanned PDF / binary file:** Actionable toast explaining why extraction returned empty text (e.g., scanned PDF without text layer) without clearing the current script.
- **Built-in Demo Simulator (Testing & Rehearsal Tool):** A subtle "Simulate Reading" control in the HUD lets users test normal reading, repeats, and jumps directly in the UI without a microphone.

### Success Criteria & Verification Commands
1. **Unit & Edge-Case Test Suite (`npm run test` via Vitest):**
   - `VoiceAligner` tests covering:
     - English normal reading, contractions (`don't` vs `do not`), homophones (`to`/`too`/`two`), spoken numbers (`25` vs `twenty five`).
     - Speaker repeats a phrase 2× and 3× without breaking or teleporting.
     - Script composed entirely of repeated identical phrases/choruses advances sequentially 1st → 2nd → 3rd occurrence.
     - Flickering `interim` ASR updates do not double-advance through repeated phrases.
     - Jump forward across multiple paragraphs & jump backward to earlier paragraph.
     - Ambiguous jump into a repeated chorus waits for disambiguating context word.
     - Manual `seekTo` override resets tracking cleanly.
     - Russian text (`ё/е`, morphology prefixes).
   - Document parser tests covering: TXT (UTF-8 & Windows-1251), MD, SRT/VTT, HTML, RTF (ASCII + Unicode + Cyrillic), DOCX (generated in test), binary OLE2 `.doc` (synthetic valid CFBF+WordDocument fixture + misnamed RTF-as-`.doc`), PDF.
2. **Type Safety, Linting & Production Build:**
   - `npx tsc --noEmit` — 0 errors
   - `npm run lint` — 0 errors
   - `npm run build` — clean Vite production bundle
3. **Interactive Browser Verification:**
   - Verify live rendered UI in browser: upload/edit script, adjust font/colors/size/margins, toggle H/V/H+V mirror modes, toggle eye-line, run Demo Simulator through repeated phrases & jumps, verify smooth scrolling & zero console errors.

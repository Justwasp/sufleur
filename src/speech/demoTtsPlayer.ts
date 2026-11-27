import type { ScriptToken, TranscriptUpdate } from '../core/types';

export interface DemoPhrase {
  text: string;
  isRepeatDemo: boolean;
}

/**
 * Splits speakable tokens into natural spoken sentences/phrases (max ~10 words each)
 * and optionally inserts one short stumble-repeat phrase to demonstrate repeat protection.
 */
export function buildDemoPhrases(
  tokens: ScriptToken[],
  startAfterTokenIndex: number,
  includeRepeatDemo = true,
): DemoPhrase[] {
  const speakable = tokens.filter(
    (t) => t.isSpeakable && t.index > startAfterTokenIndex,
  );
  if (speakable.length === 0) return [];

  const rawPhrases: string[] = [];
  let bucket: string[] = [];

  for (const tok of speakable) {
    bucket.push(tok.raw);
    const endsSentence = /[.!?…]$/.test(tok.raw) || tok.trailingSpace.includes('\n');
    const softBreak = /[,;:—–]$/.test(tok.raw) && bucket.length >= 6;
    if (endsSentence || softBreak || bucket.length >= 10) {
      rawPhrases.push(bucket.join(' '));
      bucket = [];
    }
  }
  if (bucket.length > 0) {
    rawPhrases.push(bucket.join(' '));
  }

  const phrases: DemoPhrase[] = [];
  let insertedRepeat = false;

  for (let i = 0; i < rawPhrases.length; i++) {
    const text = rawPhrases[i];
    phrases.push({ text, isRepeatDemo: false });

    // After the 2nd phrase, repeat its last 3-4 words to showcase live repeat-guard holding
    if (includeRepeatDemo && !insertedRepeat && i === 1) {
      const words = text.split(/\s+/);
      if (words.length >= 3) {
        const tail = words.slice(-Math.min(4, words.length)).join(' ');
        phrases.push({ text: tail, isRepeatDemo: true });
        insertedRepeat = true;
      }
    }
  }

  return phrases;
}

function detectLanguageForText(text: string, fallbackLang: string): string {
  const cyrillicCount = (text.match(/[\u0400-\u04FF]/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cyrillicCount > latinCount && cyrillicCount >= 6) {
    return 'ru-RU';
  }
  if (latinCount > cyrillicCount && latinCount >= 6) {
    return fallbackLang.startsWith('en') ? fallbackLang : 'en-US';
  }
  return fallbackLang || 'en-US';
}

export interface SystemVoiceOption {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
}

/**
 * Returns browser SpeechSynthesis voices sorted with English & Russian voices first.
 */
export function listSortedSystemVoices(): SystemVoiceOption[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const raw = window.speechSynthesis.getVoices();
  if (!raw || raw.length === 0) return [];

  const scoreLang = (lang: string) => {
    const l = lang.toLowerCase();
    if (l.startsWith('en-us')) return 0;
    if (l.startsWith('en-gb')) return 1;
    if (l.startsWith('en')) return 2;
    if (l.startsWith('ru')) return 3;
    return 4;
  };

  return [...raw]
    .sort((a, b) => {
      const diff = scoreLang(a.lang) - scoreLang(b.lang);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name);
    })
    .map((v) => ({
      voiceURI: v.voiceURI,
      name: v.name,
      lang: v.lang,
      localService: v.localService,
    }));
}

function pickBestVoice(
  lang: string,
  preferredVoiceURI?: string,
): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  if (preferredVoiceURI) {
    const exactVoice = voices.find((v) => v.voiceURI === preferredVoiceURI);
    if (exactVoice) return exactVoice;
  }

  const targetLower = lang.toLowerCase();
  const baseLang = targetLower.split('-')[0];

  const exact = voices.filter((v) => v.lang.toLowerCase() === targetLower);
  const family = voices.filter((v) => v.lang.toLowerCase().startsWith(baseLang));
  const pool = exact.length > 0 ? exact : family;
  if (pool.length === 0) return null;

  // Prefer natural/enhanced system or Google voices over robotic novelty voices
  const preferred = pool.find((v) =>
    /samantha|daniel|karen|serena|alex|milena|yuri|google|natural|enhanced|premium/i.test(
      v.name,
    ),
  );
  return preferred ?? pool.find((v) => v.localService) ?? pool[0];
}

/**
 * Plays a short 2-second sample sentence to audition a selected TTS voice.
 */
export function previewTtsVoice(
  voiceURI: string,
  rate: number,
  fallbackLang: string,
): boolean {
  if (
    typeof window === 'undefined' ||
    !('speechSynthesis' in window) ||
    typeof SpeechSynthesisUtterance === 'undefined'
  ) {
    return false;
  }

  window.speechSynthesis.cancel();
  const chosen = pickBestVoice(fallbackLang, voiceURI || undefined);
  const lang = chosen?.lang || fallbackLang || 'en-US';
  const sample = lang.toLowerCase().startsWith('ru')
    ? 'Привет! Это проверка голоса для суфлёра.'
    : 'Hello! This is a quick voice preview for Sufleur.';

  const utter = new SpeechSynthesisUtterance(sample);
  utter.lang = lang;
  utter.rate = Math.max(0.7, Math.min(1.4, rate || 1.0));
  if (chosen) utter.voice = chosen;
  window.speechSynthesis.speak(utter);
  return true;
}

export interface DemoPlayerOptions {
  preferredLang: string;
  voiceURI?: string;
  rate?: number;
}

export interface DemoPlayerCallbacks {
  onTranscript: (update: TranscriptUpdate, isRepeatDemo: boolean) => void;
  onAudioLevel: (level: number) => void;
  onDone: () => void;
}

/**
 * Voiced Demo simulator using browser Web SpeechSynthesis (TTS) synchronized word-by-word
 * via `onboundary` events into VoiceAligner, with clean fallback when TTS is unavailable.
 */
export class DemoTtsPlayer {
  private active = false;
  private phrases: DemoPhrase[] = [];
  private phraseIndex = 0;
  private utteranceId = 100;
  private fallbackTimer: number | null = null;
  private levelTimer: number | null = null;
  private lang = 'en-US';
  private voiceURI = '';
  private rate = 1.0;
  private callbacks: DemoPlayerCallbacks | null = null;

  public start(
    tokens: ScriptToken[],
    startAfterTokenIndex: number,
    options: DemoPlayerOptions,
    callbacks: DemoPlayerCallbacks,
  ): boolean {
    this.stop();
    const phrases = buildDemoPhrases(tokens, startAfterTokenIndex, true);
    if (phrases.length === 0) return false;

    this.phrases = phrases;
    this.phraseIndex = 0;
    this.active = true;
    this.callbacks = callbacks;
    this.voiceURI = options.voiceURI ?? '';
    this.rate = Math.max(0.7, Math.min(1.4, options.rate ?? 1.0));

    const fullPreview = phrases
      .slice(0, 4)
      .map((p) => p.text)
      .join(' ');
    this.lang = detectLanguageForText(fullPreview, options.preferredLang);

    // Subtle simulated audio-level animation while demo voice speaks
    this.levelTimer = window.setInterval(() => {
      if (!this.active) return;
      callbacks.onAudioLevel(0.28 + Math.random() * 0.42);
    }, 110);

    const hasTts =
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      typeof SpeechSynthesisUtterance !== 'undefined';

    if (hasTts) {
      try {
        window.speechSynthesis.cancel();
        this.speakNextPhrase();
        return true;
      } catch {
        // Fall through to silent timer fallback
      }
    }

    this.runSilentFallback();
    return true;
  }

  private speakNextPhrase(): void {
    if (!this.active || !this.callbacks) return;
    if (this.phraseIndex >= this.phrases.length) {
      this.finish();
      return;
    }

    const phrase = this.phrases[this.phraseIndex];
    const currentUtteranceId = this.utteranceId++;
    const utter = new SpeechSynthesisUtterance(phrase.text);
    const voice = pickBestVoice(this.lang, this.voiceURI || undefined);
    utter.lang = voice?.lang || this.lang;
    utter.rate = this.rate;
    utter.pitch = 1.0;
    if (voice) {
      utter.voice = voice;
    }

    let boundarySeen = false;
    let boundaryFallbackTimer: number | null = null;

    const clearPhraseTimers = () => {
      if (boundaryFallbackTimer !== null) {
        clearTimeout(boundaryFallbackTimer);
        boundaryFallbackTimer = null;
      }
    };

    // Word-by-word real-time sync with spoken TTS audio
    utter.onboundary = (event: SpeechSynthesisEvent) => {
      if (!this.active || !this.callbacks) return;
      if (event.name && event.name !== 'word') return;
      boundarySeen = true;
      clearPhraseTimers();

      const charIdx = Math.max(0, event.charIndex ?? 0);
      const wordLen =
        typeof event.charLength === 'number' && event.charLength > 0
          ? event.charLength
          : (phrase.text.slice(charIdx).match(/^\S+/)?.[0].length ?? 1);
      const spokenPrefix = phrase.text.slice(0, charIdx + wordLen).trim();

      if (spokenPrefix) {
        this.callbacks.onTranscript(
          {
            utteranceId: currentUtteranceId,
            isFinal: false,
            text: spokenPrefix,
          },
          phrase.isRepeatDemo,
        );
      }
    };

    // If a browser voice does not emit onboundary events, advance gracefully mid-utterance
    utter.onstart = () => {
      if (!this.active || !this.callbacks) return;
      const words = phrase.text.split(/\s+/);
      let step = 1;
      const stepMs = Math.max(260, Math.min(480, Math.round(350)));
      const tickNoBoundary = () => {
        if (!this.active || !this.callbacks || boundarySeen) return;
        const partial = words.slice(0, Math.min(words.length, step)).join(' ');
        this.callbacks.onTranscript(
          {
            utteranceId: currentUtteranceId,
            isFinal: false,
            text: partial,
          },
          phrase.isRepeatDemo,
        );
        step += 1;
        if (step <= words.length) {
          boundaryFallbackTimer = window.setTimeout(tickNoBoundary, stepMs);
        }
      };
      boundaryFallbackTimer = window.setTimeout(tickNoBoundary, 420);
    };

    utter.onend = () => {
      clearPhraseTimers();
      if (!this.active || !this.callbacks) return;
      this.callbacks.onTranscript(
        {
          utteranceId: currentUtteranceId,
          isFinal: true,
          text: phrase.text,
        },
        phrase.isRepeatDemo,
      );
      this.phraseIndex += 1;
      this.fallbackTimer = window.setTimeout(() => this.speakNextPhrase(), 120);
    };

    utter.onerror = (ev) => {
      clearPhraseTimers();
      if (!this.active) return;
      if (ev.error === 'canceled' || ev.error === 'interrupted') return;
      // Fallback to silent progression if OS TTS fails
      this.runSilentFallback();
    };

    window.speechSynthesis.speak(utter);
  }

  private runSilentFallback(): void {
    if (!this.active || !this.callbacks) return;
    if (this.fallbackTimer !== null) clearInterval(this.fallbackTimer);

    this.fallbackTimer = window.setInterval(() => {
      if (!this.active || !this.callbacks) return;
      if (this.phraseIndex >= this.phrases.length) {
        this.finish();
        return;
      }
      const phrase = this.phrases[this.phraseIndex++];
      this.callbacks.onTranscript(
        {
          utteranceId: this.utteranceId++,
          isFinal: true,
          text: phrase.text,
        },
        phrase.isRepeatDemo,
      );
    }, 1100);
  }

  private finish(): void {
    const cb = this.callbacks;
    this.stop();
    cb?.onDone();
  }

  public stop(): void {
    this.active = false;
    this.callbacks?.onAudioLevel(0);
    this.callbacks = null;
    if (this.fallbackTimer !== null) {
      clearTimeout(this.fallbackTimer);
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.levelTimer !== null) {
      clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }
}

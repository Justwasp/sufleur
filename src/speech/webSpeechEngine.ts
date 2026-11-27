import { startMicrophoneCapture, type MicrophoneSession } from './audioCapture';
import type { SpeechEngine, SpeechEngineCallbacks, SpeechEngineConfig } from './types';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isWebSpeechSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

/**
 * Browser-native Web Speech API engine.
 * Handles continuous streaming interim results and transparently auto-restarts
 * across Chrome's periodic silence timeouts while keeping utterance IDs monotonic.
 */
export class WebSpeechEngine implements SpeechEngine {
  public readonly kind = 'web-speech' as const;
  public readonly label = 'Web Speech API (Browser)';

  private recognition: SpeechRecognitionLike | null = null;
  private micSession: MicrophoneSession | null = null;
  private shouldRun = false;
  private utteranceBase = 0;
  private restartTimer: number | null = null;

  public async start(
    config: SpeechEngineConfig,
    callbacks: SpeechEngineCallbacks,
  ): Promise<void> {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      callbacks.onStateChange(
        'unsupported',
        'Web Speech API is not supported in this browser. Switch to Vosk Offline, Deepgram Cloud, or Auto-Scroll.',
      );
      callbacks.onError('Web Speech API is unavailable in this browser.');
      return;
    }

    await this.stop();
    this.shouldRun = true;
    callbacks.onStateChange('loading', 'Requesting microphone access...');

    // Optional lightweight mic VU meter in parallel (non-fatal if browser locks mic)
    if (callbacks.onAudioLevel) {
      try {
        this.micSession = await startMicrophoneCapture({
          onLevel: callbacks.onAudioLevel,
        });
      } catch {
        // Proceed even if dual mic capture isn't allowed; SpeechRecognition manages its own mic
      }
    }

    const launch = () => {
      if (!this.shouldRun) return;
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.lang = config.language || 'en-US';

      rec.onstart = () => {
        callbacks.onStateChange('listening', `Listening (${rec.lang})`);
      };

      rec.onresult = (event: SpeechRecognitionEventLike) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const alt = res[0];
          if (!alt?.transcript) continue;
          callbacks.onTranscript({
            text: alt.transcript,
            isFinal: Boolean(res.isFinal),
            utteranceId: this.utteranceBase + i + 1,
          });
        }
      };

      rec.onerror = (event: SpeechRecognitionErrorEventLike) => {
        if (event.error === 'no-speech' || event.error === 'aborted') {
          // Benign pause / restart; do not surface as fatal error
          return;
        }
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          this.shouldRun = false;
          callbacks.onStateChange('error', 'Microphone permission denied');
          callbacks.onError('Microphone permission denied. Allow mic access or switch to Auto-Scroll.');
          return;
        }
        callbacks.onError(`Web Speech error: ${event.error}`);
      };

      rec.onend = () => {
        this.utteranceBase += 1000;
        if (this.shouldRun) {
          this.restartTimer = window.setTimeout(() => {
            if (this.shouldRun) launch();
          }, 160);
        } else {
          callbacks.onStateChange('idle');
        }
      };

      this.recognition = rec;
      try {
        rec.start();
      } catch (err) {
        callbacks.onStateChange('error', 'Failed to start Web Speech');
        callbacks.onError(
          `Could not start Web Speech API: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    launch();
  }

  public async stop(): Promise<void> {
    this.shouldRun = false;
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.onerror = null;
      this.recognition.onresult = null;
      try {
        this.recognition.stop();
      } catch {
        // ignore if already stopped
      }
      this.recognition = null;
    }
    if (this.micSession) {
      await this.micSession.stop();
      this.micSession = null;
    }
  }
}

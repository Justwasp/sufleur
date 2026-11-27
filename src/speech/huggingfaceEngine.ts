import { startMicrophoneCapture, type MicrophoneSession } from './audioCapture';
import { hfWorkerClient } from './hfWorkerClient';
import {
  HUGGINGFACE_ASR_MODELS,
  SUPPORTED_LANGUAGES,
  type SpeechEngine,
  type SpeechEngineCallbacks,
  type SpeechEngineConfig,
} from './types';

const SAMPLE_RATE = 16000;
const MAX_WINDOW_SAMPLES = SAMPLE_RATE * 4.5; // 4.5s rolling speech window
const MIN_SPEECH_SAMPLES = SAMPLE_RATE * 0.55; // >= 0.55s before first inference
const SPEECH_RMS_THRESHOLD = 0.014;
const SILENCE_FINALIZE_MS = 1200;
const INFER_INTERVAL_MS = 1100;

const SILENCE_HALLUCINATIONS = new Set([
  'thank you',
  'thank you.',
  'thanks for watching',
  'thanks for watching.',
  'you',
  'bye',
  'bye.',
  '...',
]);

/**
 * Local in-browser Hugging Face Transformers.js ASR engine (Moonshine / Whisper ONNX).
 * Downloads free models directly from Hugging Face Hub, caches them locally for offline use,
 * and runs inference in a dedicated Web Worker (WebGPU with automatic WASM fallback).
 */
export class HuggingFaceLocalEngine implements SpeechEngine {
  public readonly kind = 'huggingface-local' as const;
  public readonly label = 'Hugging Face AI (Offline WebGPU/WASM)';

  private micSession: MicrophoneSession | null = null;
  private inferTimer: number | null = null;
  private running = false;
  private inferInFlight = false;
  private audioChunks: Float32Array[] = [];
  private totalSamples = 0;
  private lastVoiceActivityAt = 0;
  private hasActiveSpeech = false;
  private utteranceCounter = 1;
  private unsubProgress: (() => void) | null = null;

  public async start(
    config: SpeechEngineConfig,
    callbacks: SpeechEngineCallbacks,
  ): Promise<void> {
    await this.stop();

    const modelId =
      config.hfCustomModelId.trim() ||
      config.hfModelId ||
      HUGGINGFACE_ASR_MODELS[0].id;

    const catalogEntry = HUGGINGFACE_ASR_MODELS.find((m) => m.id === modelId);
    const isMultilingual =
      catalogEntry?.isMultilingual ?? !modelId.toLowerCase().includes('.en');
    const langEntry = SUPPORTED_LANGUAGES.find((l) => l.code === config.language);
    const whisperLang = langEntry?.whisperName ?? 'english';

    this.running = true;
    callbacks.onStateChange('loading', `Loading ${modelId}...`);

    this.unsubProgress = hfWorkerClient.subscribe((p) => {
      if (!this.running) return;
      if (p.status === 'downloading' || p.status === 'loading') {
        const pct = p.progress > 0 ? ` ${p.progress}%` : '';
        callbacks.onStateChange(
          'loading',
          `Downloading ${modelId.split('/').pop()}${pct}...`,
        );
      }
    });

    try {
      const deviceUsed = await hfWorkerClient.loadModel(
        modelId,
        config.hfDevice || 'auto',
      );
      if (!this.running) return;

      this.micSession = await startMicrophoneCapture(
        {
          onLevel: callbacks.onAudioLevel,
          onFloat32_16k: (samples) => this.pushAudio(samples),
        },
        SAMPLE_RATE,
      );

      callbacks.onStateChange(
        'listening',
        `HF ${modelId.split('/').pop()} (${deviceUsed.toUpperCase()})`,
      );

      this.inferTimer = window.setInterval(() => {
        void this.tickInference(whisperLang, isMultilingual, callbacks);
      }, INFER_INTERVAL_MS);
    } catch (err) {
      await this.stop();
      const message =
        err instanceof Error ? err.message : 'Hugging Face model failed to start.';
      callbacks.onStateChange('error', 'HF model load failed');
      callbacks.onError(message);
    }
  }

  private pushAudio(samples: Float32Array): void {
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSq += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSq / samples.length);
    if (rms >= SPEECH_RMS_THRESHOLD) {
      this.lastVoiceActivityAt = performance.now();
      this.hasActiveSpeech = true;
    }

    if (!this.hasActiveSpeech) return;

    this.audioChunks.push(new Float32Array(samples));
    this.totalSamples += samples.length;

    // Cap rolling window to MAX_WINDOW_SAMPLES so latency stays bounded
    while (this.totalSamples > MAX_WINDOW_SAMPLES && this.audioChunks.length > 1) {
      const dropped = this.audioChunks.shift()!;
      this.totalSamples -= dropped.length;
    }
  }

  private flattenWindow(): Float32Array {
    const merged = new Float32Array(this.totalSamples);
    let offset = 0;
    for (const chunk of this.audioChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  private async tickInference(
    whisperLang: string,
    isMultilingual: boolean,
    callbacks: SpeechEngineCallbacks,
  ): Promise<void> {
    if (!this.running || this.inferInFlight || !this.hasActiveSpeech) return;
    if (this.totalSamples < MIN_SPEECH_SAMPLES) return;

    const now = performance.now();
    const silenceMs = now - this.lastVoiceActivityAt;
    const isFinal = silenceMs >= SILENCE_FINALIZE_MS;
    const audio = this.flattenWindow();

    if (isFinal) {
      // Reset speech buffer for next utterance cleanly
      this.audioChunks = [];
      this.totalSamples = 0;
      this.hasActiveSpeech = false;
    }

    this.inferInFlight = true;
    const currentUtteranceId = this.utteranceCounter;
    if (isFinal) {
      this.utteranceCounter += 1;
    }

    try {
      const text = await hfWorkerClient.transcribe(
        audio,
        whisperLang,
        isMultilingual,
      );
      if (!this.running || !text) return;

      const lower = text.toLowerCase();
      if (SILENCE_HALLUCINATIONS.has(lower) && silenceMs > 800) {
        return;
      }

      callbacks.onTranscript({
        text,
        isFinal,
        utteranceId: currentUtteranceId,
      });
    } catch {
      // Transient inference error — keep listening smoothly
    } finally {
      this.inferInFlight = false;
    }
  }

  public async stop(): Promise<void> {
    this.running = false;
    if (this.unsubProgress) {
      this.unsubProgress();
      this.unsubProgress = null;
    }
    if (this.inferTimer !== null) {
      clearInterval(this.inferTimer);
      this.inferTimer = null;
    }
    this.audioChunks = [];
    this.totalSamples = 0;
    this.hasActiveSpeech = false;
    this.inferInFlight = false;
    if (this.micSession) {
      await this.micSession.stop();
      this.micSession = null;
    }
  }
}

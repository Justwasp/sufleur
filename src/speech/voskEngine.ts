import { getVoskModelBlob } from '../store/storage';
import { startMicrophoneCapture, type MicrophoneSession } from './audioCapture';
import type { SpeechEngine, SpeechEngineCallbacks, SpeechEngineConfig } from './types';

interface VoskRecognizerLike {
  on: (event: string, listener: (msg: { result?: { partial?: string; text?: string } }) => void) => void;
  acceptWaveform: (buffer: AudioBuffer) => void;
  remove?: () => void;
}

interface VoskModelLike {
  KaldiRecognizer: new (sampleRate: number) => VoskRecognizerLike;
  terminate?: () => void;
}

/**
 * Fully offline streaming speech recognition in the browser via Vosk WebAssembly (vosk-browser).
 * Loads user-uploaded model archives (.tar.gz / .zip) cached in IndexedDB, or a custom CORS-enabled URL.
 */
export class VoskOfflineEngine implements SpeechEngine {
  public readonly kind = 'vosk-offline' as const;
  public readonly label = 'Vosk Offline (WASM)';

  private micSession: MicrophoneSession | null = null;
  private model: VoskModelLike | null = null;
  private recognizer: VoskRecognizerLike | null = null;
  private objectUrl: string | null = null;
  private utteranceCounter = 1;

  public async start(
    config: SpeechEngineConfig,
    callbacks: SpeechEngineCallbacks,
  ): Promise<void> {
    await this.stop();
    callbacks.onStateChange('loading', 'Loading offline Vosk WASM model...');

    let modelUrl = config.voskModelUrl.trim();
    if (config.voskModelId) {
      const stored = await getVoskModelBlob(config.voskModelId);
      if (stored) {
        this.objectUrl = URL.createObjectURL(stored.blob);
        modelUrl = this.objectUrl;
      }
    }

    if (!modelUrl) {
      const msg =
        'No offline Vosk model selected. Upload a Vosk .tar.gz/.zip model (e.g. vosk-model-small-en-us-0.15) in Speech Settings.';
      callbacks.onStateChange('error', 'Offline model required');
      callbacks.onError(msg);
      return;
    }

    try {
      const Vosk = (await import('vosk-browser')) as unknown as {
        createModel: (url: string, logLevel?: number) => Promise<VoskModelLike>;
      };

      const model = await Vosk.createModel(modelUrl, -1);
      this.model = model;

      const recognizer = new model.KaldiRecognizer(16000);
      this.recognizer = recognizer;

      recognizer.on('partialresult', (message) => {
        const partial = message?.result?.partial?.trim();
        if (partial) {
          callbacks.onTranscript({
            text: partial,
            isFinal: false,
            utteranceId: this.utteranceCounter,
          });
        }
      });

      recognizer.on('result', (message) => {
        const text = message?.result?.text?.trim();
        if (text) {
          callbacks.onTranscript({
            text,
            isFinal: true,
            utteranceId: this.utteranceCounter,
          });
          this.utteranceCounter += 1;
        }
      });

      this.micSession = await startMicrophoneCapture(
        {
          onLevel: callbacks.onAudioLevel,
          onAudioBuffer: (buf) => {
            try {
              recognizer.acceptWaveform(buf);
            } catch {
              // ignore transient buffer mismatch on shutdown
            }
          },
        },
        16000,
      );

      callbacks.onStateChange('listening', 'Offline WASM active (100% local)');
    } catch (err) {
      await this.stop();
      const message = `Vosk offline failed: ${err instanceof Error ? err.message : String(err)}`;
      callbacks.onStateChange('error', 'Offline model failed');
      callbacks.onError(message);
    }
  }

  public async stop(): Promise<void> {
    if (this.micSession) {
      await this.micSession.stop();
      this.micSession = null;
    }
    if (this.recognizer) {
      try {
        this.recognizer.remove?.();
      } catch {
        // ignore cleanup error
      }
      this.recognizer = null;
    }
    if (this.model) {
      try {
        this.model.terminate?.();
      } catch {
        // ignore cleanup error
      }
      this.model = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}

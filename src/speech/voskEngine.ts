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
  on: (event: string, listener: (msg: { result?: boolean; error?: string }) => void) => void;
  terminate?: () => void;
}

/**
 * Fully offline streaming speech recognition in the browser via Vosk WebAssembly (vosk-browser).
 * Loads user-uploaded model archives (.tar.gz / .zip) cached in IndexedDB, or a custom CORS-enabled URL.
 * Includes explicit worker error listening & timeout protection so invalid archives never hang silently.
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
        'No offline Vosk model selected. Upload a Vosk model archive or try Hugging Face AI for 1-click download.';
      callbacks.onStateChange('error', 'Offline model required');
      callbacks.onError(msg);
      return;
    }

    try {
      const Vosk = (await import('vosk-browser')) as unknown as {
        Model: new (url: string, logLevel?: number) => VoskModelLike;
      };

      // Use Model directly so we can listen to BOTH 'load' and 'error' events + timeout
      const model = await new Promise<VoskModelLike>((resolve, reject) => {
        const instance = new Vosk.Model(modelUrl, -1);
        const timer = window.setTimeout(() => {
          instance.terminate?.();
          reject(
            new Error(
              'Vosk model load timed out (35s). Open in Chrome/Safari (not an embedded webview) and ensure the archive is a valid Vosk .tar.gz or .zip.',
            ),
          );
        }, 35000);

        instance.on('load', (msg) => {
          clearTimeout(timer);
          if (msg.result) resolve(instance);
          else reject(new Error('Vosk failed to initialize this model archive.'));
        });

        instance.on('error', (msg) => {
          clearTimeout(timer);
          instance.terminate?.();
          reject(
            new Error(
              msg.error ||
                'Vosk could not extract this archive (check CORS or try Hugging Face AI).',
            ),
          );
        });
      });

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

      callbacks.onStateChange('listening', 'Offline Vosk WASM active');
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

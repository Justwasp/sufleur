import { startMicrophoneCapture, type MicrophoneSession } from './audioCapture';
import {
  SUPPORTED_LANGUAGES,
  type SpeechEngine,
  type SpeechEngineCallbacks,
  type SpeechEngineConfig,
} from './types';

interface DeepgramMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: Array<{ transcript?: string }>;
  };
}

/**
 * Direct-from-browser Deepgram Live WebSocket engine (BYOK).
 * Authenticates via Sec-WebSocket-Protocol ['token', apiKey] with zero backend required.
 */
export class DeepgramCloudEngine implements SpeechEngine {
  public readonly kind = 'deepgram-cloud' as const;
  public readonly label = 'Deepgram Live (Cloud BYOK)';

  private socket: WebSocket | null = null;
  private micSession: MicrophoneSession | null = null;
  private utteranceCounter = 1;

  public async start(
    config: SpeechEngineConfig,
    callbacks: SpeechEngineCallbacks,
  ): Promise<void> {
    await this.stop();

    const apiKey = config.deepgramApiKey.trim();
    if (!apiKey) {
      callbacks.onStateChange('error', 'Deepgram API key required');
      callbacks.onError('Enter your Deepgram API key in Speech Settings to use Deepgram Live.');
      return;
    }

    callbacks.onStateChange('loading', 'Connecting to Deepgram Live...');

    const langEntry = SUPPORTED_LANGUAGES.find((l) => l.code === config.language);
    const dgLang = langEntry?.deepgramCode ?? 'en-US';
    const model = config.deepgramModel || 'nova-2';

    const params = new URLSearchParams({
      model,
      language: dgLang,
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
      punctuate: 'false',
      endpointing: '300',
    });

    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    try {
      const ws = new WebSocket(url, ['token', apiKey]);
      this.socket = ws;

      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(new Error('Deepgram WebSocket connection timed out.'));
        }, 10000);

        ws.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Deepgram connection failed (check API key or network).'));
        };
      });

      ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return;
        try {
          const payload = JSON.parse(event.data) as DeepgramMessage;
          const transcript = payload.channel?.alternatives?.[0]?.transcript?.trim();
          if (!transcript) return;
          const isFinal = Boolean(payload.is_final || payload.speech_final);
          callbacks.onTranscript({
            text: transcript,
            isFinal,
            utteranceId: this.utteranceCounter,
          });
          if (isFinal) {
            this.utteranceCounter += 1;
          }
        } catch {
          // ignore malformed keepalive frame
        }
      };

      ws.onclose = (ev) => {
        if (ev.code !== 1000 && this.socket === ws) {
          callbacks.onStateChange('error', `Deepgram disconnected (${ev.code})`);
          callbacks.onError(`Deepgram stream closed unexpectedly (code ${ev.code}).`);
        }
      };

      this.micSession = await startMicrophoneCapture(
        {
          onLevel: callbacks.onAudioLevel,
          onPcm16: (pcm16) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(pcm16.buffer);
            }
          },
        },
        16000,
      );

      callbacks.onStateChange('listening', `Deepgram ${model} (${dgLang})`);
    } catch (err) {
      await this.stop();
      const msg = err instanceof Error ? err.message : String(err);
      callbacks.onStateChange('error', 'Deepgram connection failed');
      callbacks.onError(msg);
    }
  }

  public async stop(): Promise<void> {
    if (this.micSession) {
      await this.micSession.stop();
      this.micSession = null;
    }
    if (this.socket) {
      const ws = this.socket;
      this.socket = null;
      ws.onclose = null;
      ws.onmessage = null;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'CloseStream' }));
        }
        ws.close(1000, 'Stopped by user');
      } catch {
        // ignore close error
      }
    }
  }
}

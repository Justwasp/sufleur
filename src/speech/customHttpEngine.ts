import { startMicrophoneCapture, type MicrophoneSession } from './audioCapture';
import type { SpeechEngine, SpeechEngineCallbacks, SpeechEngineConfig } from './types';

/**
 * Custom HTTP STT engine compatible with OpenAI `/v1/audio/transcriptions` proxies,
 * Groq Whisper, or local `whisper.cpp` / Faster-Whisper servers with CORS enabled.
 * Sends short 1.8s audio chunks continuously.
 */
export class CustomHttpSttEngine implements SpeechEngine {
  public readonly kind = 'custom-http' as const;
  public readonly label = 'Custom Whisper / OpenAI Endpoint';

  private micSession: MicrophoneSession | null = null;
  private recorder: MediaRecorder | null = null;
  private running = false;
  private utteranceCounter = 1;

  public async start(
    config: SpeechEngineConfig,
    callbacks: SpeechEngineCallbacks,
  ): Promise<void> {
    await this.stop();

    const endpoint = config.customEndpointUrl.trim();
    if (!endpoint) {
      callbacks.onStateChange('error', 'Endpoint URL required');
      callbacks.onError('Enter a CORS-enabled Whisper / OpenAI-compatible transcription URL in Speech Settings.');
      return;
    }

    callbacks.onStateChange('loading', 'Initializing audio recorder...');

    try {
      this.micSession = await startMicrophoneCapture({
        onLevel: callbacks.onAudioLevel,
      });
      this.running = true;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';

      const recordCycle = () => {
        if (!this.running || !this.micSession) return;
        const rec = mimeType
          ? new MediaRecorder(this.micSession.stream, { mimeType })
          : new MediaRecorder(this.micSession.stream);
        this.recorder = rec;
        const chunks: Blob[] = [];

        rec.ondataavailable = (ev) => {
          if (ev.data.size > 0) chunks.push(ev.data);
        };

        rec.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
          if (blob.size > 800 && this.running) {
            void this.uploadChunk(blob, config, callbacks);
          }
          if (this.running) {
            recordCycle();
          }
        };

        rec.start();
        window.setTimeout(() => {
          if (rec.state === 'recording') {
            rec.stop();
          }
        }, 1800);
      };

      callbacks.onStateChange('listening', 'Streaming chunks to custom STT');
      recordCycle();
    } catch (err) {
      await this.stop();
      const msg = err instanceof Error ? err.message : String(err);
      callbacks.onStateChange('error', 'Custom STT failed');
      callbacks.onError(msg);
    }
  }

  private async uploadChunk(
    blob: Blob,
    config: SpeechEngineConfig,
    callbacks: SpeechEngineCallbacks,
  ): Promise<void> {
    const formData = new FormData();
    formData.append('file', blob, 'chunk.webm');
    if (config.customModel.trim()) {
      formData.append('model', config.customModel.trim());
    }
    const langPrefix = (config.language || 'en-US').split('-')[0];
    formData.append('language', langPrefix);

    const headers: Record<string, string> = {};
    if (config.customApiKey.trim()) {
      headers.Authorization = `Bearer ${config.customApiKey.trim()}`;
    }

    try {
      const response = await fetch(config.customEndpointUrl.trim(), {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!response.ok) {
        callbacks.onError(`Custom STT HTTP ${response.status}: ${response.statusText}`);
        return;
      }

      const data = (await response.json()) as { text?: string };
      const text = data.text?.trim();
      if (text) {
        callbacks.onTranscript({
          text,
          isFinal: true,
          utteranceId: this.utteranceCounter++,
        });
      }
    } catch (err) {
      callbacks.onError(
        `Custom STT request failed (check CORS & URL): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  public async stop(): Promise<void> {
    this.running = false;
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        // ignore
      }
    }
    this.recorder = null;
    if (this.micSession) {
      await this.micSession.stop();
      this.micSession = null;
    }
  }
}

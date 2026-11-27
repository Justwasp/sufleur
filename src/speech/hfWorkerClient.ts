import type { HfDevicePreference, HfDownloadProgress } from './types';

type ProgressListener = (progress: HfDownloadProgress) => void;

interface WorkerOutbound {
  type: 'progress' | 'ready' | 'error' | 'result' | 'transcribe-error';
  id?: number;
  modelId?: string;
  status?: 'downloading' | 'loading';
  file?: string;
  progress?: number;
  loadedBytes?: number;
  totalBytes?: number;
  deviceUsed?: string;
  message?: string;
  text?: string;
  error?: string;
}

/**
 * Shared singleton controller for the Hugging Face Transformers.js ASR Web Worker.
 * Allows pre-downloading models in Settings with a live progress bar and reusing
 * the already-warm pipeline instantly when starting the teleprompter.
 */
class HfWorkerClient {
  private worker: Worker | null = null;
  private listeners = new Set<ProgressListener>();
  private state: HfDownloadProgress = { status: 'idle', progress: 0 };
  private loadedModelId: string | null = null;
  private loadedDevice: string | null = null;

  private pendingLoad: {
    resolve: (deviceUsed: string) => void;
    reject: (err: Error) => void;
  } | null = null;

  private pendingTranscriptions = new Map<
    number,
    { resolve: (text: string) => void; reject: (err: Error) => void }
  >();
  private nextRequestId = 1;

  public getState(): HfDownloadProgress {
    return this.state;
  }

  public isModelLoaded(modelId: string): boolean {
    return this.state.status === 'ready' && this.loadedModelId === modelId;
  }

  public subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(next: HfDownloadProgress): void {
    this.state = next;
    for (const fn of this.listeners) {
      fn(next);
    }
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./hfWorker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
        this.handleMessage(event.data);
      };
      this.worker.onerror = (ev) => {
        const err = new Error(ev.message || 'Hugging Face Web Worker crashed.');
        this.emit({
          status: 'error',
          modelId: this.state.modelId,
          progress: 0,
          message: err.message,
        });
        this.pendingLoad?.reject(err);
        this.pendingLoad = null;
      };
    }
    return this.worker;
  }

  private handleMessage(msg: WorkerOutbound): void {
    if (msg.type === 'progress') {
      this.emit({
        status: msg.status ?? 'downloading',
        modelId: msg.modelId,
        file: msg.file,
        progress: msg.progress ?? this.state.progress,
        loadedBytes: msg.loadedBytes,
        totalBytes: msg.totalBytes,
        deviceUsed: msg.deviceUsed,
        message: msg.message,
      });
      return;
    }

    if (msg.type === 'ready') {
      this.loadedModelId = msg.modelId ?? null;
      this.loadedDevice = msg.deviceUsed ?? 'wasm';
      this.emit({
        status: 'ready',
        modelId: msg.modelId,
        progress: 100,
        deviceUsed: this.loadedDevice,
        message: `Ready (${this.loadedDevice.toUpperCase()}, cached offline)`,
      });
      this.pendingLoad?.resolve(this.loadedDevice);
      this.pendingLoad = null;
      return;
    }

    if (msg.type === 'error') {
      const err = new Error(msg.error || 'Failed to load Hugging Face model.');
      this.emit({
        status: 'error',
        modelId: msg.modelId,
        progress: 0,
        message: err.message,
      });
      this.pendingLoad?.reject(err);
      this.pendingLoad = null;
      return;
    }

    if (msg.type === 'result' && typeof msg.id === 'number') {
      const entry = this.pendingTranscriptions.get(msg.id);
      if (entry) {
        this.pendingTranscriptions.delete(msg.id);
        entry.resolve(msg.text ?? '');
      }
      return;
    }

    if (msg.type === 'transcribe-error' && typeof msg.id === 'number') {
      const entry = this.pendingTranscriptions.get(msg.id);
      if (entry) {
        this.pendingTranscriptions.delete(msg.id);
        entry.reject(new Error(msg.error || 'Transcription error'));
      }
    }
  }

  public async loadModel(
    modelId: string,
    device: HfDevicePreference = 'auto',
  ): Promise<string> {
    const cleanId = modelId.trim();
    if (!cleanId) {
      throw new Error('Select or enter a Hugging Face model ID first.');
    }

    if (
      this.state.status === 'ready' &&
      this.loadedModelId === cleanId &&
      (device === 'auto' || this.loadedDevice === device)
    ) {
      return this.loadedDevice ?? 'wasm';
    }

    const worker = this.ensureWorker();
    if (this.pendingLoad) {
      this.pendingLoad.reject(new Error('Superseded by a new model load request.'));
      this.pendingLoad = null;
    }

    return new Promise<string>((resolve, reject) => {
      this.pendingLoad = { resolve, reject };
      worker.postMessage({ type: 'load', modelId: cleanId, device });
    });
  }

  public async transcribe(
    audio: Float32Array,
    language: string | undefined,
    isMultilingual: boolean,
  ): Promise<string> {
    const worker = this.ensureWorker();
    const id = this.nextRequestId++;
    // Transfer a copy so the audio buffer stays zero-copy fast
    const copy = new Float32Array(audio);
    return new Promise<string>((resolve, reject) => {
      this.pendingTranscriptions.set(id, { resolve, reject });
      worker.postMessage(
        {
          type: 'transcribe',
          id,
          audio: copy,
          language,
          isMultilingual,
        },
        [copy.buffer],
      );
    });
  }
}

export const hfWorkerClient = new HfWorkerClient();

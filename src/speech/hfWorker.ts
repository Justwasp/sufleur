import { env, pipeline } from '@huggingface/transformers';

// Load models directly from Hugging Face Hub and cache them in Browser Cache Storage for offline use
env.allowLocalModels = false;
env.useBrowserCache = true;

type AsrPipeline = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text?: string } | Array<{ text?: string }>>;

interface LoadMsg {
  type: 'load';
  modelId: string;
  device: 'auto' | 'webgpu' | 'wasm';
}

interface TranscribeMsg {
  type: 'transcribe';
  id: number;
  audio: Float32Array;
  language?: string;
  isMultilingual: boolean;
}

type WorkerInbound = LoadMsg | TranscribeMsg;

let activeModelId: string | null = null;
let activeDeviceUsed: string | null = null;
let transcriber: AsrPipeline | null = null;

async function hasWebGpu(): Promise<boolean> {
  try {
    const nav = self.navigator as Navigator & {
      gpu?: { requestAdapter: () => Promise<unknown | null> };
    };
    if (!nav?.gpu) return false;
    const adapter = await nav.gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

function cleanTranscriptArtifacts(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:music|applause|laughter|silence|inaudible|blank_audio)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function createAsrPipeline(
  modelId: string,
  targetDevice: 'webgpu' | 'wasm',
): Promise<AsrPipeline> {
  const fileProgress = new Map<string, { loaded: number; total: number }>();

  const result = await pipeline('automatic-speech-recognition', modelId, {
    device: targetDevice,
    dtype: 'q8',
    progress_callback: (info: {
      status?: string;
      file?: string;
      progress?: number;
      loaded?: number;
      total?: number;
    }) => {
      if (info.file && typeof info.total === 'number' && info.total > 0) {
        fileProgress.set(info.file, {
          loaded: info.loaded ?? 0,
          total: info.total,
        });
      }

      let sumLoaded = 0;
      let sumTotal = 0;
      for (const entry of fileProgress.values()) {
        sumLoaded += entry.loaded;
        sumTotal += entry.total;
      }

      const overallPct =
        sumTotal > 0
          ? Math.min(99, Math.round((sumLoaded / sumTotal) * 100))
          : typeof info.progress === 'number'
            ? Math.min(99, Math.round(info.progress))
            : 0;

      self.postMessage({
        type: 'progress',
        modelId,
        status: info.status === 'ready' ? 'loading' : 'downloading',
        file: info.file,
        progress: overallPct,
        loadedBytes: sumLoaded || undefined,
        totalBytes: sumTotal || undefined,
        deviceUsed: targetDevice,
      });
    },
  });

  return result as unknown as AsrPipeline;
}

self.addEventListener('message', async (event: MessageEvent<WorkerInbound>) => {
  const msg = event.data;

  if (msg.type === 'load') {
    const requestedDevice = msg.device;
    if (
      transcriber &&
      activeModelId === msg.modelId &&
      (requestedDevice === 'auto' || activeDeviceUsed === requestedDevice)
    ) {
      self.postMessage({
        type: 'ready',
        modelId: msg.modelId,
        deviceUsed: activeDeviceUsed,
      });
      return;
    }

    transcriber = null;
    activeModelId = null;

    const tryOrder: Array<'webgpu' | 'wasm'> =
      requestedDevice === 'wasm'
        ? ['wasm']
        : requestedDevice === 'webgpu'
          ? ['webgpu', 'wasm']
          : (await hasWebGpu())
            ? ['webgpu', 'wasm']
            : ['wasm'];

    let lastError: unknown = null;
    for (const dev of tryOrder) {
      try {
        self.postMessage({
          type: 'progress',
          modelId: msg.modelId,
          status: 'downloading',
          progress: 2,
          deviceUsed: dev,
          message: `Loading ${msg.modelId} (${dev.toUpperCase()})...`,
        });

        transcriber = await createAsrPipeline(msg.modelId, dev);
        activeModelId = msg.modelId;
        activeDeviceUsed = dev;

        self.postMessage({
          type: 'ready',
          modelId: msg.modelId,
          deviceUsed: dev,
        });
        return;
      } catch (err) {
        lastError = err;
        // If WebGPU failed, loop automatically retries with WASM
      }
    }

    self.postMessage({
      type: 'error',
      modelId: msg.modelId,
      error:
        lastError instanceof Error
          ? lastError.message
          : 'Failed to load Hugging Face model.',
    });
    return;
  }

  if (msg.type === 'transcribe') {
    if (!transcriber) {
      self.postMessage({
        type: 'result',
        id: msg.id,
        text: '',
      });
      return;
    }

    try {
      const options: Record<string, unknown> = {
        return_timestamps: false,
      };
      if (msg.isMultilingual && msg.language) {
        options.language = msg.language;
        options.task = 'transcribe';
      }

      const output = await transcriber(msg.audio, options);
      const rawText = Array.isArray(output)
        ? output.map((o) => o.text ?? '').join(' ')
        : (output?.text ?? '');

      self.postMessage({
        type: 'result',
        id: msg.id,
        text: cleanTranscriptArtifacts(rawText),
      });
    } catch (err) {
      self.postMessage({
        type: 'transcribe-error',
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
});

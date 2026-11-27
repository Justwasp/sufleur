import type { TranscriptUpdate } from '../core/types';

export type SpeechEngineKind =
  | 'web-speech'
  | 'huggingface-local'
  | 'vosk-offline'
  | 'deepgram-cloud'
  | 'custom-http'
  | 'auto-scroll';

export type EngineConnectionState =
  | 'idle'
  | 'loading'
  | 'listening'
  | 'error'
  | 'unsupported';

export type HfDevicePreference = 'auto' | 'webgpu' | 'wasm';

export interface HfModelOption {
  id: string;
  label: string;
  languages: string;
  sizeLabel: string;
  description: string;
  isMultilingual: boolean;
  recommended?: boolean;
}

export const HUGGINGFACE_ASR_MODELS: HfModelOption[] = [
  {
    id: 'onnx-community/moonshine-tiny-ONNX',
    label: 'Moonshine Tiny (English)',
    languages: 'EN',
    sizeLabel: '~50 MB',
    description: 'Ultra-fast English model built for real-time edge speech tracking.',
    isMultilingual: false,
    recommended: true,
  },
  {
    id: 'onnx-community/moonshine-base-ONNX',
    label: 'Moonshine Base (English)',
    languages: 'EN',
    sizeLabel: '~110 MB',
    description: 'Higher-accuracy English real-time speech model.',
    isMultilingual: false,
  },
  {
    id: 'onnx-community/whisper-tiny.en',
    label: 'Whisper Tiny.en (English)',
    languages: 'EN',
    sizeLabel: '~65 MB',
    description: 'Classic OpenAI Whisper English-only model (ONNX quantized).',
    isMultilingual: false,
  },
  {
    id: 'onnx-community/whisper-tiny',
    label: 'Whisper Tiny (Multilingual)',
    languages: 'EN / RU / 90+',
    sizeLabel: '~75 MB',
    description: 'Supports English, Russian, and 90+ languages offline in browser.',
    isMultilingual: true,
  },
  {
    id: 'onnx-community/whisper-base',
    label: 'Whisper Base (Multilingual)',
    languages: 'EN / RU / 90+',
    sizeLabel: '~120 MB',
    description: 'Stronger multilingual accuracy for Russian & accented English.',
    isMultilingual: true,
  },
];

export interface HfDownloadProgress {
  status: 'idle' | 'downloading' | 'loading' | 'ready' | 'error';
  modelId?: string;
  file?: string;
  progress: number; // 0..100
  loadedBytes?: number;
  totalBytes?: number;
  deviceUsed?: string;
  message?: string;
}

export interface SpeechEngineConfig {
  kind: SpeechEngineKind;
  language: string;
  /** Hugging Face local browser model (Transformers.js) */
  hfModelId: string;
  hfCustomModelId: string;
  hfDevice: HfDevicePreference;
  /** Deepgram user-supplied BYOK API key (stored locally in browser only) */
  deepgramApiKey: string;
  deepgramModel: string;
  /** Custom OpenAI-compatible / whisper.cpp endpoint */
  customEndpointUrl: string;
  customApiKey: string;
  customModel: string;
  /** Vosk offline model source (IndexedDB model ID or direct URL) */
  voskModelId: string;
  voskModelUrl: string;
  /** Demo TTS voiceURI (empty string = Auto best voice for script language) */
  demoVoiceURI: string;
  /** Demo TTS speaking rate (0.7..1.4) */
  demoRate: number;
}

export interface SpeechEngineCallbacks {
  onTranscript: (update: TranscriptUpdate) => void;
  onStateChange: (state: EngineConnectionState, message?: string) => void;
  onAudioLevel?: (level: number) => void;
  onError: (errorMessage: string) => void;
}

export interface SpeechEngine {
  readonly kind: SpeechEngineKind;
  readonly label: string;
  start(config: SpeechEngineConfig, callbacks: SpeechEngineCallbacks): Promise<void>;
  stop(): Promise<void>;
}

export interface LanguageOption {
  code: string;
  label: string;
  deepgramCode: string;
  whisperName: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en-US', label: 'English (US) — Primary', deepgramCode: 'en-US', whisperName: 'english' },
  { code: 'en-GB', label: 'English (UK)', deepgramCode: 'en-GB', whisperName: 'english' },
  { code: 'en-AU', label: 'English (Australia)', deepgramCode: 'en-AU', whisperName: 'english' },
  { code: 'ru-RU', label: 'Russian (Русский)', deepgramCode: 'ru', whisperName: 'russian' },
  { code: 'de-DE', label: 'German (Deutsch)', deepgramCode: 'de', whisperName: 'german' },
  { code: 'fr-FR', label: 'French (Français)', deepgramCode: 'fr', whisperName: 'french' },
  { code: 'es-ES', label: 'Spanish (Español)', deepgramCode: 'es', whisperName: 'spanish' },
  { code: 'it-IT', label: 'Italian (Italiano)', deepgramCode: 'it', whisperName: 'italian' },
  { code: 'pt-BR', label: 'Portuguese (BR)', deepgramCode: 'pt-BR', whisperName: 'portuguese' },
  { code: 'uk-UA', label: 'Ukrainian (Українська)', deepgramCode: 'uk', whisperName: 'ukrainian' },
  { code: 'pl-PL', label: 'Polish (Polski)', deepgramCode: 'pl', whisperName: 'polish' },
  { code: 'ja-JP', label: 'Japanese (日本語)', deepgramCode: 'ja', whisperName: 'japanese' },
];

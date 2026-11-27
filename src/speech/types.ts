import type { TranscriptUpdate } from '../core/types';

export type SpeechEngineKind =
  | 'web-speech'
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

export interface SpeechEngineConfig {
  kind: SpeechEngineKind;
  language: string;
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
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en-US', label: 'English (US) — Primary', deepgramCode: 'en-US' },
  { code: 'en-GB', label: 'English (UK)', deepgramCode: 'en-GB' },
  { code: 'en-AU', label: 'English (Australia)', deepgramCode: 'en-AU' },
  { code: 'ru-RU', label: 'Russian (Русский)', deepgramCode: 'ru' },
  { code: 'de-DE', label: 'German (Deutsch)', deepgramCode: 'de' },
  { code: 'fr-FR', label: 'French (Français)', deepgramCode: 'fr' },
  { code: 'es-ES', label: 'Spanish (Español)', deepgramCode: 'es' },
  { code: 'it-IT', label: 'Italian (Italiano)', deepgramCode: 'it' },
  { code: 'pt-BR', label: 'Portuguese (BR)', deepgramCode: 'pt-BR' },
  { code: 'uk-UA', label: 'Ukrainian (Українська)', deepgramCode: 'uk' },
  { code: 'pl-PL', label: 'Polish (Polski)', deepgramCode: 'pl' },
  { code: 'ja-JP', label: 'Japanese (日本語)', deepgramCode: 'ja' },
];

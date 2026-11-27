import type { SpeechEngineConfig } from '../speech/types';

export type MirrorMode = 'none' | 'horizontal' | 'vertical' | 'both';
export type TextAlignMode = 'left' | 'center';

export interface ScriptItem {
  id: string;
  title: string;
  content: string;
  sourceFormat: string;
  updatedAt: number;
}

export interface AppearanceSettings {
  fontFamily: string;
  fontSize: number; // 24..140 px
  lineHeight: number; // 1.15..2.0
  letterSpacing: number; // -0.02..0.1 em
  horizontalPadding: number; // 4..28 %
  textAlign: TextAlignMode;
  backgroundColor: string;
  textColor: string;
  activeColor: string;
  spokenOpacity: number; // 0.25..0.9
  mirrorMode: MirrorMode;
  showReadingGuide: boolean;
  readingGuidePosition: number; // 15..60 % from top
  ignoreStageDirections: boolean;
  autoScrollWpm: number; // 60..240 WPM fallback
}

export interface StylePreset {
  id: string;
  name: string;
  settings: Partial<AppearanceSettings>;
  builtIn?: boolean;
}

export interface StoredVoskModelMeta {
  id: string;
  name: string;
  sizeBytes: number;
  savedAt: number;
}

export interface PersistedState {
  scripts: ScriptItem[];
  activeScriptId: string;
  appearance: AppearanceSettings;
  presets: StylePreset[];
  speech: SpeechEngineConfig;
}

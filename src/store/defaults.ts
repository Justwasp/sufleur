import type { SpeechEngineConfig } from '../speech/types';
import type { AppearanceSettings, ScriptItem, StylePreset } from './types';

export interface FontChoice {
  label: string;
  value: string;
  category: string;
}

export const FONT_CHOICES: FontChoice[] = [
  {
    label: 'Atkinson Hyperlegible',
    value: "'Atkinson Hyperlegible Next', system-ui, sans-serif",
    category: 'High-Legibility Sans',
  },
  {
    label: 'Plus Jakarta Sans',
    value: "'Plus Jakarta Sans', system-ui, sans-serif",
    category: 'Broadcast Sans',
  },
  {
    label: 'IBM Plex Sans',
    value: "'IBM Plex Sans', system-ui, sans-serif",
    category: 'Technical Sans',
  },
  {
    label: 'Newsreader',
    value: "'Newsreader', Georgia, serif",
    category: 'Editorial Serif',
  },
  {
    label: 'PT Serif',
    value: "'PT Serif', Georgia, serif",
    category: 'Cyrillic Serif',
  },
  {
    label: 'JetBrains Mono',
    value: "'JetBrains Mono', monospace",
    category: 'Monospace',
  },
  {
    label: 'Georgia',
    value: 'Georgia, serif',
    category: 'Classic System Serif',
  },
  {
    label: 'Verdana',
    value: 'Verdana, Geneva, sans-serif',
    category: 'Wide System Sans',
  },
];

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  fontFamily: FONT_CHOICES[0].value,
  fontSize: 64,
  lineHeight: 1.42,
  letterSpacing: 0.0,
  horizontalPadding: 12,
  textAlign: 'left',
  backgroundColor: '#050608',
  textColor: '#F7F8FA',
  activeColor: '#F59E0B',
  spokenOpacity: 0.42,
  mirrorMode: 'none',
  showReadingGuide: true,
  readingGuidePosition: 32,
  ignoreStageDirections: true,
  autoScrollWpm: 140,
};

export const BUILTIN_PRESETS: StylePreset[] = [
  {
    id: 'studio-carbon',
    name: 'Studio Carbon',
    builtIn: true,
    settings: {
      backgroundColor: '#050608',
      textColor: '#F7F8FA',
      activeColor: '#F59E0B',
      spokenOpacity: 0.42,
      fontSize: 64,
    },
  },
  {
    id: 'glass-beam-mirror',
    name: 'Beam-Splitter Glass (Mirrored)',
    builtIn: true,
    settings: {
      backgroundColor: '#000000',
      textColor: '#FFFFFF',
      activeColor: '#38BDF8',
      spokenOpacity: 0.35,
      mirrorMode: 'horizontal',
      fontSize: 76,
    },
  },
  {
    id: 'amber-cinema',
    name: 'Amber Night Stage',
    builtIn: true,
    settings: {
      backgroundColor: '#0C0906',
      textColor: '#FDE68A',
      activeColor: '#34D399',
      spokenOpacity: 0.38,
      fontSize: 66,
    },
  },
  {
    id: 'daylight-paper',
    name: 'Daylight High-Contrast',
    builtIn: true,
    settings: {
      backgroundColor: '#FAF8F5',
      textColor: '#111318',
      activeColor: '#D97706',
      spokenOpacity: 0.45,
      fontSize: 60,
    },
  },
];

export const DEFAULT_SPEECH_CONFIG: SpeechEngineConfig = {
  kind: 'web-speech',
  language: 'en-US',
  hfModelId: 'onnx-community/moonshine-tiny-ONNX',
  hfCustomModelId: '',
  hfDevice: 'auto',
  deepgramApiKey: '',
  deepgramModel: 'nova-2',
  customEndpointUrl: '',
  customApiKey: '',
  customModel: 'whisper-1',
  voskModelId: '',
  voskModelUrl: '',
};

export const DEFAULT_SCRIPTS: ScriptItem[] = [
  {
    id: 'sample-en-keynote',
    title: 'Keynote Demo (Repeats & Jumps)',
    sourceFormat: 'DEMO',
    updatedAt: Date.now(),
    content: `[Pause 1 sec — smile at lens]
Good evening everyone, and welcome to our 2026 live broadcast. We don't believe great speaking should feel stiff or robotic. It's all about natural pace, eye contact, and confidence.

Notice how Sufleur handles intentional repetition effortlessly:
We build for clarity. We build for clarity. We build for clarity. Every single pass moves forward in exact order without getting stuck.

[Take a breath]
What happens if you stumble and repeat a phrase twice? Try repeating the previous sentence out loud right now — the prompter holds steady until you continue to the next thought.

And if you decide to skip straight ahead or jump back 25% earlier in the script, just keep speaking naturally. Within three words, the tracker locks onto your new line and glides smoothly to your eye-line.

Thank you for joining us tonight. Let's make something unforgettable.`,
  },
  {
    id: 'sample-ru-demo',
    title: 'Пример на русском (Повторы)',
    sourceFormat: 'DEMO',
    updatedAt: Date.now() - 1000,
    content: `[Пауза 1 сек]
Добрый вечер, друзья! Добро пожаловать в студию цифрового суфлёра.

Попробуйте прочитать повторяющуюся фразу подряд:
Мы идём вперёд. Мы идём вперёд. Мы идём вперёд. Суфлёр точно понимает каждое повторение и плавно ведёт текст за вашим голосом.

Если вы оговоритесь или перескочите на следующий абзац, система мгновенно найдёт нужное место и продолжит работу без сбоев.`,
  },
];

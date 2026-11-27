import { CustomHttpSttEngine } from './customHttpEngine';
import { DeepgramCloudEngine } from './deepgramEngine';
import { HuggingFaceLocalEngine } from './huggingfaceEngine';
import type { SpeechEngine, SpeechEngineKind } from './types';
import { VoskOfflineEngine } from './voskEngine';
import { WebSpeechEngine } from './webSpeechEngine';

export function createSpeechEngine(kind: SpeechEngineKind): SpeechEngine | null {
  switch (kind) {
    case 'web-speech':
      return new WebSpeechEngine();
    case 'huggingface-local':
      return new HuggingFaceLocalEngine();
    case 'vosk-offline':
      return new VoskOfflineEngine();
    case 'deepgram-cloud':
      return new DeepgramCloudEngine();
    case 'custom-http':
      return new CustomHttpSttEngine();
    case 'auto-scroll':
      return null;
  }
}

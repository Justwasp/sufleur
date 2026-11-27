import {
  AlignCenter,
  AlignLeft,
  BookmarkPlus,
  ExternalLink,
  FlipHorizontal2,
  FlipVertical2,
  Mic,
  Palette,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  SUPPORTED_LANGUAGES,
  type SpeechEngineConfig,
  type SpeechEngineKind,
} from '../speech/types';
import { isWebSpeechSupported } from '../speech/webSpeechEngine';
import { getContrastRating, getContrastRatio } from '../store/contrast';
import { FONT_CHOICES } from '../store/defaults';
import { deleteVoskModel, listVoskModels, saveVoskModelFile } from '../store/storage';
import type {
  AppearanceSettings,
  MirrorMode,
  StoredVoskModelMeta,
  StylePreset,
} from '../store/types';

interface SettingsPanelProps {
  appearance: AppearanceSettings;
  presets: StylePreset[];
  speech: SpeechEngineConfig;
  onUpdateAppearance: (patch: Partial<AppearanceSettings>) => void;
  onApplyPreset: (preset: StylePreset) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (id: string) => void;
  onUpdateSpeech: (patch: Partial<SpeechEngineConfig>) => void;
  onNotify: (msg: string, tone?: 'info' | 'success' | 'error') => void;
}

const ENGINE_OPTIONS: Array<{
  kind: SpeechEngineKind;
  title: string;
  badge: string;
  desc: string;
}> = [
  {
    kind: 'web-speech',
    title: 'Web Speech API',
    badge: 'DEFAULT',
    desc: 'Built into Chrome/Edge/Safari. Instant word streaming, zero setup, no API key.',
  },
  {
    kind: 'vosk-offline',
    title: 'Vosk Offline (WASM)',
    badge: '100% LOCAL',
    desc: 'Runs completely offline in WebAssembly. Upload a small English or Russian model archive.',
  },
  {
    kind: 'deepgram-cloud',
    title: 'Deepgram Live (BYOK)',
    badge: 'CLOUD WS',
    desc: 'Ultra-low latency Nova-2/Nova-3 streaming via your own Deepgram API key.',
  },
  {
    kind: 'custom-http',
    title: 'Custom Whisper / OpenAI',
    badge: 'CUSTOM URL',
    desc: 'Connect any CORS-enabled OpenAI-compatible or local whisper.cpp transcription server.',
  },
  {
    kind: 'auto-scroll',
    title: 'Constant-Speed Auto-Scroll',
    badge: 'NO MIC',
    desc: 'Smooth WPM prompter scroll fallback when microphone is muted or unavailable.',
  },
];

const COLOR_SWATCHES = [
  { label: 'Carbon', bg: '#050608', text: '#F7F8FA', active: '#F59E0B' },
  { label: 'Pure OLED', bg: '#000000', text: '#FFFFFF', active: '#38BDF8' },
  { label: 'Cinema Navy', bg: '#09111E', text: '#F1F5F9', active: '#F59E0B' },
  { label: 'Warm Paper', bg: '#FAF8F5', text: '#111318', active: '#D97706' },
];

export function SettingsPanel({
  appearance,
  presets,
  speech,
  onUpdateAppearance,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
  onUpdateSpeech,
  onNotify,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<'display' | 'speech'>('display');
  const [presetName, setPresetName] = useState('');
  const [voskModels, setVoskModels] = useState<StoredVoskModelMeta[]>([]);
  const voskInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void listVoskModels().then(setVoskModels);
  }, []);

  const contrastRatio = getContrastRatio(appearance.backgroundColor, appearance.textColor);
  const contrastRating = getContrastRating(contrastRatio);
  const webSpeechOk = isWebSpeechSupported();

  const handleVoskUpload = async (file: File) => {
    try {
      const meta = await saveVoskModelFile(file);
      setVoskModels((prev) => [meta, ...prev]);
      onUpdateSpeech({ voskModelId: meta.id });
      onNotify(`Saved offline Vosk model "${meta.name}" locally in browser.`, 'success');
    } catch (err) {
      onNotify(
        `Could not save Vosk model: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    }
  };

  const handleDeleteVoskModel = async (id: string) => {
    await deleteVoskModel(id);
    setVoskModels((prev) => prev.filter((m) => m.id !== id));
    if (speech.voskModelId === id) {
      onUpdateSpeech({ voskModelId: '' });
    }
  };

  return (
    <aside className="settings-panel" aria-label="Prompter Settings">
      <div className="settings-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'display'}
          className={tab === 'display' ? 'active' : ''}
          onClick={() => setTab('display')}
        >
          <Palette size={14} />
          Display &amp; Mirror
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'speech'}
          className={tab === 'speech' ? 'active' : ''}
          onClick={() => setTab('speech')}
        >
          <Mic size={14} />
          Voice Engine
        </button>
      </div>

      <div className="settings-scroll">
        {tab === 'display' ? (
          <>
            {/* Presets */}
            <div className="control-group">
              <span className="group-label">Style Presets</span>
              <div className="preset-chips">
                {presets.map((p) => (
                  <span key={p.id} className="preset-chip">
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', padding: 0, fontSize: 'inherit' }}
                      onClick={() => onApplyPreset(p)}
                    >
                      {p.name}
                    </button>
                    {!p.builtIn && (
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', padding: 0, display: 'grid' }}
                        onClick={() => onDeletePreset(p.id)}
                        aria-label={`Delete preset ${p.name}`}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              <form
                style={{ display: 'flex', gap: 6 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const clean = presetName.trim();
                  if (!clean) return;
                  onSavePreset(clean);
                  setPresetName('');
                }}
              >
                <input
                  type="text"
                  className="text-input"
                  placeholder="Save current look as preset..."
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                />
                <button type="submit" className="btn btn-sm" title="Save Preset">
                  <BookmarkPlus size={14} />
                </button>
              </form>
            </div>

            {/* Typography */}
            <div className="control-group">
              <span className="group-label">Typography</span>
              <div className="field-row">
                <label className="field-row-header" htmlFor="font-select">
                  Font Family
                </label>
                <select
                  id="font-select"
                  className="select-input"
                  value={appearance.fontFamily}
                  onChange={(e) => onUpdateAppearance({ fontFamily: e.target.value })}
                >
                  {FONT_CHOICES.map((f) => (
                    <option key={f.label} value={f.value}>
                      {f.label} — {f.category}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-row">
                <label className="field-row-header" htmlFor="font-size-range">
                  <span>Text Size</span>
                  <span className="field-value">{appearance.fontSize}px</span>
                </label>
                <input
                  id="font-size-range"
                  type="range"
                  min={24}
                  max={140}
                  step={2}
                  value={appearance.fontSize}
                  onChange={(e) => onUpdateAppearance({ fontSize: Number(e.target.value) })}
                />
              </div>

              <div className="field-row">
                <label className="field-row-header" htmlFor="line-height-range">
                  <span>Line Height</span>
                  <span className="field-value">{appearance.lineHeight.toFixed(2)}</span>
                </label>
                <input
                  id="line-height-range"
                  type="range"
                  min={1.15}
                  max={2.0}
                  step={0.05}
                  value={appearance.lineHeight}
                  onChange={(e) => onUpdateAppearance({ lineHeight: Number(e.target.value) })}
                />
              </div>

              <div className="field-row">
                <label className="field-row-header" htmlFor="margin-range">
                  <span>Side Margins</span>
                  <span className="field-value">{appearance.horizontalPadding}%</span>
                </label>
                <input
                  id="margin-range"
                  type="range"
                  min={4}
                  max={28}
                  step={1}
                  value={appearance.horizontalPadding}
                  onChange={(e) =>
                    onUpdateAppearance({ horizontalPadding: Number(e.target.value) })
                  }
                />
              </div>

              <div className="field-row">
                <span className="field-row-header">Alignment</span>
                <div className="mirror-grid">
                  <button
                    type="button"
                    className={`mirror-btn ${appearance.textAlign === 'left' ? 'active' : ''}`}
                    onClick={() => onUpdateAppearance({ textAlign: 'left' })}
                  >
                    <AlignLeft size={14} /> Left
                  </button>
                  <button
                    type="button"
                    className={`mirror-btn ${appearance.textAlign === 'center' ? 'active' : ''}`}
                    onClick={() => onUpdateAppearance({ textAlign: 'center' })}
                  >
                    <AlignCenter size={14} /> Center
                  </button>
                </div>
              </div>
            </div>

            {/* Colors & WCAG Contrast */}
            <div className="control-group">
              <div className="group-label">
                <span>Colors</span>
                <span className={`contrast-badge ${contrastRating.tone}`}>
                  {contrastRatio.toFixed(1)}:1 {contrastRating.label}
                </span>
              </div>

              <div className="color-grid">
                <label className="color-box">
                  Background
                  <span className="color-input-wrap">
                    <input
                      type="color"
                      value={appearance.backgroundColor}
                      onChange={(e) => onUpdateAppearance({ backgroundColor: e.target.value })}
                    />
                    <span>{appearance.backgroundColor.toUpperCase()}</span>
                  </span>
                </label>
                <label className="color-box">
                  Text
                  <span className="color-input-wrap">
                    <input
                      type="color"
                      value={appearance.textColor}
                      onChange={(e) => onUpdateAppearance({ textColor: e.target.value })}
                    />
                    <span>{appearance.textColor.toUpperCase()}</span>
                  </span>
                </label>
                <label className="color-box">
                  Active Word
                  <span className="color-input-wrap">
                    <input
                      type="color"
                      value={appearance.activeColor}
                      onChange={(e) => onUpdateAppearance({ activeColor: e.target.value })}
                    />
                    <span>{appearance.activeColor.toUpperCase()}</span>
                  </span>
                </label>
              </div>

              <div className="preset-chips">
                {COLOR_SWATCHES.map((sw) => (
                  <button
                    key={sw.label}
                    type="button"
                    className="preset-chip"
                    onClick={() =>
                      onUpdateAppearance({
                        backgroundColor: sw.bg,
                        textColor: sw.text,
                        activeColor: sw.active,
                      })
                    }
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: sw.bg,
                        border: `2px solid ${sw.text}`,
                      }}
                    />
                    {sw.label}
                  </button>
                ))}
              </div>

              <div className="field-row">
                <label className="field-row-header" htmlFor="spoken-opacity">
                  <span>Read Text Opacity</span>
                  <span className="field-value">{Math.round(appearance.spokenOpacity * 100)}%</span>
                </label>
                <input
                  id="spoken-opacity"
                  type="range"
                  min={0.2}
                  max={0.95}
                  step={0.05}
                  value={appearance.spokenOpacity}
                  onChange={(e) => onUpdateAppearance({ spokenOpacity: Number(e.target.value) })}
                />
              </div>
            </div>

            {/* Mirroring & Eye-Line */}
            <div className="control-group">
              <span className="group-label">Mirroring (Teleprompter Rig)</span>
              <div className="mirror-grid">
                {(
                  [
                    { mode: 'none', label: 'Normal' },
                    { mode: 'horizontal', label: 'Mirror H (Glass)' },
                    { mode: 'vertical', label: 'Mirror V' },
                    { mode: 'both', label: 'Mirror H + V' },
                  ] as Array<{ mode: MirrorMode; label: string }>
                ).map((item) => (
                  <button
                    key={item.mode}
                    type="button"
                    className={`mirror-btn ${appearance.mirrorMode === item.mode ? 'active' : ''}`}
                    onClick={() => onUpdateAppearance({ mirrorMode: item.mode })}
                  >
                    {item.mode === 'vertical' ? (
                      <FlipVertical2 size={13} />
                    ) : (
                      <FlipHorizontal2 size={13} />
                    )}
                    {item.label}
                  </button>
                ))}
              </div>

              <label className="toggle-label">
                <span>Show Eye-Line Reading Guide</span>
                <input
                  type="checkbox"
                  checked={appearance.showReadingGuide}
                  onChange={(e) => onUpdateAppearance({ showReadingGuide: e.target.checked })}
                />
              </label>

              {appearance.showReadingGuide && (
                <div className="field-row">
                  <label className="field-row-header" htmlFor="guide-pos">
                    <span>Eye-Line Vertical Position</span>
                    <span className="field-value">{appearance.readingGuidePosition}%</span>
                  </label>
                  <input
                    id="guide-pos"
                    type="range"
                    min={15}
                    max={60}
                    step={1}
                    value={appearance.readingGuidePosition}
                    onChange={(e) =>
                      onUpdateAppearance({ readingGuidePosition: Number(e.target.value) })
                    }
                  />
                </div>
              )}

              <label className="toggle-label">
                <span>Skip [stage directions] while tracking</span>
                <input
                  type="checkbox"
                  checked={appearance.ignoreStageDirections}
                  onChange={(e) =>
                    onUpdateAppearance({ ignoreStageDirections: e.target.checked })
                  }
                />
              </label>
            </div>
          </>
        ) : (
          <>
            {/* Language */}
            <div className="control-group">
              <span className="group-label">Recognition Language</span>
              <select
                className="select-input"
                aria-label="Recognition Language"
                value={speech.language}
                onChange={(e) => onUpdateSpeech({ language: e.target.value })}
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Engine Picker */}
            <div className="control-group">
              <span className="group-label">Speech Recognition Engine</span>
              {ENGINE_OPTIONS.map((opt) => (
                <button
                  key={opt.kind}
                  type="button"
                  className={`engine-card ${speech.kind === opt.kind ? 'active' : ''}`}
                  onClick={() => onUpdateSpeech({ kind: opt.kind })}
                >
                  <div className="engine-card-head">
                    <span>{opt.title}</span>
                    <span className="format-pill">{opt.badge}</span>
                  </div>
                  <span className="engine-card-desc">{opt.desc}</span>
                </button>
              ))}
            </div>

            {/* Engine-Specific Settings */}
            {speech.kind === 'web-speech' && !webSpeechOk && (
              <div className="info-box" style={{ borderColor: 'rgba(239,68,68,0.5)' }}>
                <strong>Browser Note:</strong> Web Speech API was not detected in this browser.
                Use Chrome/Edge/Safari, or choose Vosk Offline, Deepgram Cloud, or Auto-Scroll.
              </div>
            )}

            {speech.kind === 'vosk-offline' && (
              <div className="control-group">
                <span className="group-label">Offline Vosk WASM Model</span>
                <div className="info-box">
                  <span>
                    Download a small Vosk model archive (recommended for English:{' '}
                    <code>vosk-model-small-en-us-0.15</code>, ~40MB) and load it below. It is cached
                    locally in IndexedDB for 100% offline use.
                  </span>
                  <a
                    href="https://alphacephei.com/vosk/models"
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  >
                    Browse Official Vosk Models <ExternalLink size={12} />
                  </a>
                </div>

                <input
                  ref={voskInputRef}
                  type="file"
                  accept=".tar.gz,.tgz,.zip"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleVoskUpload(file);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => voskInputRef.current?.click()}
                >
                  <Upload size={14} /> Upload Local Vosk Archive (.tar.gz / .zip)
                </button>

                {voskModels.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {voskModels.map((m) => (
                      <div
                        key={m.id}
                        className="script-card"
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderColor: speech.voskModelId === m.id ? 'var(--accent)' : 'var(--border)',
                        }}
                      >
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="vosk-model"
                            checked={speech.voskModelId === m.id}
                            onChange={() => onUpdateSpeech({ voskModelId: m.id })}
                          />
                          <span style={{ fontSize: 12 }}>
                            {m.name} ({(m.sizeBytes / (1024 * 1024)).toFixed(1)} MB)
                          </span>
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          onClick={() => void handleDeleteVoskModel(m.id)}
                          aria-label={`Delete model ${m.name}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="field-row">
                  <label className="field-row-header" htmlFor="vosk-url">
                    Or direct CORS-enabled model URL
                  </label>
                  <input
                    id="vosk-url"
                    type="url"
                    className="text-input"
                    placeholder="https://.../vosk-model-small-en-us-0.15.tar.gz"
                    value={speech.voskModelUrl}
                    onChange={(e) => onUpdateSpeech({ voskModelUrl: e.target.value })}
                  />
                </div>
              </div>
            )}

            {speech.kind === 'deepgram-cloud' && (
              <div className="control-group">
                <span className="group-label">Deepgram Live (BYOK)</span>
                <div className="field-row">
                  <label className="field-row-header" htmlFor="dg-key">
                    Deepgram API Key (stored locally only)
                  </label>
                  <input
                    id="dg-key"
                    type="password"
                    className="text-input"
                    placeholder="Enter your Deepgram API key..."
                    value={speech.deepgramApiKey}
                    onChange={(e) => onUpdateSpeech({ deepgramApiKey: e.target.value })}
                  />
                </div>
                <div className="field-row">
                  <label className="field-row-header" htmlFor="dg-model">
                    Model
                  </label>
                  <select
                    id="dg-model"
                    className="select-input"
                    value={speech.deepgramModel}
                    onChange={(e) => onUpdateSpeech({ deepgramModel: e.target.value })}
                  >
                    <option value="nova-3">Nova-3 (Latest)</option>
                    <option value="nova-2">Nova-2 (Balanced)</option>
                    <option value="enhanced">Enhanced</option>
                  </select>
                </div>
                {speech.deepgramApiKey && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onUpdateSpeech({ deepgramApiKey: '' })}
                  >
                    Clear Stored API Key
                  </button>
                )}
              </div>
            )}

            {speech.kind === 'custom-http' && (
              <div className="control-group">
                <span className="group-label">Custom Whisper / OpenAI Endpoint</span>
                <div className="field-row">
                  <label className="field-row-header" htmlFor="custom-url">
                    Transcription URL (must allow browser CORS)
                  </label>
                  <input
                    id="custom-url"
                    type="url"
                    className="text-input"
                    placeholder="http://localhost:8080/inference"
                    value={speech.customEndpointUrl}
                    onChange={(e) => onUpdateSpeech({ customEndpointUrl: e.target.value })}
                  />
                </div>
                <div className="field-row">
                  <label className="field-row-header" htmlFor="custom-key">
                    Bearer API Key (optional)
                  </label>
                  <input
                    id="custom-key"
                    type="password"
                    className="text-input"
                    placeholder="sk-..."
                    value={speech.customApiKey}
                    onChange={(e) => onUpdateSpeech({ customApiKey: e.target.value })}
                  />
                </div>
                <div className="field-row">
                  <label className="field-row-header" htmlFor="custom-model">
                    Model field
                  </label>
                  <input
                    id="custom-model"
                    type="text"
                    className="text-input"
                    placeholder="whisper-1"
                    value={speech.customModel}
                    onChange={(e) => onUpdateSpeech({ customModel: e.target.value })}
                  />
                </div>
              </div>
            )}

            {speech.kind === 'auto-scroll' && (
              <div className="control-group">
                <span className="group-label">Auto-Scroll Pace</span>
                <div className="field-row">
                  <label className="field-row-header" htmlFor="wpm-range">
                    <span>Reading Speed</span>
                    <span className="field-value">{appearance.autoScrollWpm} WPM</span>
                  </label>
                  <input
                    id="wpm-range"
                    type="range"
                    min={60}
                    max={240}
                    step={5}
                    value={appearance.autoScrollWpm}
                    onChange={(e) =>
                      onUpdateAppearance({ autoScrollWpm: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

import {
  Columns2,
  Download,
  Edit3,
  Eye,
  FileText,
  HelpCircle,
  Maximize2,
  RefreshCw,
  SlidersHorizontal,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VoiceAligner } from './core/aligner';
import { formatElapsedTime } from './core/timer';
import type { AlignmentStatus } from './core/types';
import { usePwa } from './hooks/usePwa';
import { parseDocumentFile } from './parsers';
import { DemoTtsPlayer } from './speech/demoTtsPlayer';
import { createSpeechEngine } from './speech/engineFactory';
import type { EngineConnectionState, SpeechEngine } from './speech/types';
import { loadPersistedState, savePersistedState } from './store/storage';
import type {
  AppearanceSettings,
  MirrorMode,
  PersistedState,
  StylePreset,
} from './store/types';
import { FloatingHud } from './ui/FloatingHud';
import { HotkeysDialog } from './ui/HotkeysDialog';
import { PrompterStage } from './ui/PrompterStage';
import { SettingsPanel } from './ui/SettingsPanel';
import { StudioSidebar } from './ui/StudioSidebar';

type CenterViewMode = 'split' | 'edit' | 'preview';
type MobileTab = 'scripts' | 'editor' | 'prompter' | 'settings';

interface ToastMessage {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
}

const MIRROR_CYCLE: MirrorMode[] = ['none', 'horizontal', 'vertical', 'both'];

export function App() {
  const [state, setState] = useState<PersistedState>(() => loadPersistedState());
  const [viewMode, setViewMode] = useState<CenterViewMode>('split');
  const [mobileTab, setMobileTab] = useState<MobileTab>('prompter');
  const [isStageMode, setIsStageMode] = useState(false);
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const pwa = usePwa();

  // Live prompter runtime state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [activeTokenIndex, setActiveTokenIndex] = useState(-1);
  const [engineState, setEngineState] = useState<EngineConnectionState>('idle');
  const [alignmentStatus, setAlignmentStatus] = useState<AlignmentStatus>('idle');
  const [statusNote, setStatusNote] = useState('');
  const [heardText, setHeardText] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  const alignerRef = useRef<VoiceAligner | null>(null);
  const engineRef = useRef<SpeechEngine | null>(null);
  const demoPlayerRef = useRef<DemoTtsPlayer | null>(null);
  const timerStartRef = useRef<number | null>(null);

  // Pre-warm system TTS voices (Chrome populates getVoices asynchronously)
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  // Live session speaking timer: starts at 00:00 on mic/demo start, freezes on stop
  const isSessionActive = isPlaying || isSimulating;
  useEffect(() => {
    if (!isSessionActive) {
      if (timerStartRef.current !== null) {
        setElapsedMs(performance.now() - timerStartRef.current);
        timerStartRef.current = null;
      }
      return;
    }

    const startAt = performance.now();
    timerStartRef.current = startAt;
    setElapsedMs(0);

    const id = window.setInterval(() => {
      if (timerStartRef.current !== null) {
        setElapsedMs(performance.now() - timerStartRef.current);
      }
    }, 250);

    return () => clearInterval(id);
  }, [isSessionActive]);

  // Persist state changes cleanly to localStorage
  useEffect(() => {
    savePersistedState(state);
  }, [state]);

  const activeScript = useMemo(
    () =>
      state.scripts.find((s) => s.id === state.activeScriptId) ?? state.scripts[0],
    [state.scripts, state.activeScriptId],
  );

  // Rebuild aligner index whenever active script content or stage-direction setting changes
  const indexedScript = useMemo(() => {
    const aligner = new VoiceAligner(activeScript?.content ?? '', {
      ignoreStageDirections: state.appearance.ignoreStageDirections,
    });
    alignerRef.current = aligner;
    return aligner.getScript();
  }, [activeScript?.content, state.appearance.ignoreStageDirections]);

  // Reset cursor and session timer when switching to a different script ID
  useEffect(() => {
    setActiveTokenIndex(-1);
    setAlignmentStatus('idle');
    setHeardText('');
    setStatusNote('');
    setElapsedMs(0);
    timerStartRef.current = null;
  }, [activeScript?.id]);

  const notify = useCallback(
    (text: string, tone: 'info' | 'success' | 'error' = 'info') => {
      const id = Date.now();
      setToast({ id, text, tone });
      window.setTimeout(() => {
        setToast((cur) => (cur?.id === id ? null : cur));
      }, 4800);
    },
    [],
  );

  const stopSimulator = useCallback(() => {
    demoPlayerRef.current?.stop();
    setIsSimulating(false);
    setAudioLevel(0);
  }, []);

  const stopPlayback = useCallback(async () => {
    stopSimulator();
    if (engineRef.current) {
      await engineRef.current.stop();
      engineRef.current = null;
    }
    setIsPlaying(false);
    setEngineState('idle');
    setAudioLevel(0);
  }, [stopSimulator]);

  const startPlayback = useCallback(async () => {
    stopSimulator();
    if (state.speech.kind === 'auto-scroll') {
      setIsPlaying(true);
      setEngineState('listening');
      setStatusNote(`Auto-scrolling at ${state.appearance.autoScrollWpm} WPM`);
      return;
    }

    const engine = createSpeechEngine(state.speech.kind);
    if (!engine) return;

    engineRef.current = engine;
    setIsPlaying(true);
    setStatusNote('');

    await engine.start(state.speech, {
      onTranscript: (update) => {
        setHeardText(update.text);
        const aligner = alignerRef.current;
        if (!aligner) return;
        const result = aligner.processTranscript(update);
        setAlignmentStatus(result.status);
        if (result.note) setStatusNote(result.note);
        if (result.moved) {
          setActiveTokenIndex(result.tokenIndex);
        }
      },
      onStateChange: (nextState, msg) => {
        setEngineState(nextState);
        if (msg) setStatusNote(msg);
        if (nextState === 'error' || nextState === 'unsupported') {
          setIsPlaying(false);
        }
      },
      onAudioLevel: (lvl) => setAudioLevel(lvl),
      onError: (msg) => notify(msg, 'error'),
    });
  }, [state.speech, state.appearance.autoScrollWpm, notify, stopSimulator]);

  const handleTogglePlay = useCallback(() => {
    if (isPlaying) {
      void stopPlayback();
    } else {
      void startPlayback();
    }
  }, [isPlaying, startPlayback, stopPlayback]);

  // Cleanup active mic / engine / voiced demo player on unmount
  useEffect(() => {
    return () => {
      demoPlayerRef.current?.stop();
      if (engineRef.current) void engineRef.current.stop();
    };
  }, []);

  // Voiced Demo Simulator (speaks script aloud via Web SpeechSynthesis + feeds VoiceAligner word-by-word)
  const handleToggleSimulate = useCallback(() => {
    if (isSimulating) {
      stopSimulator();
      return;
    }
    void stopPlayback();

    const aligner = alignerRef.current;
    if (!aligner || indexedScript.tokens.length === 0) return;

    // If already at the very end, restart Demo cleanly from the beginning
    const startAfter =
      activeTokenIndex >= indexedScript.tokens.length - 2 ? -1 : activeTokenIndex;
    if (startAfter === -1 && activeTokenIndex >= 0) {
      aligner.reset();
      setActiveTokenIndex(-1);
    }

    if (!demoPlayerRef.current) {
      demoPlayerRef.current = new DemoTtsPlayer();
    }

    const started = demoPlayerRef.current.start(
      indexedScript.tokens,
      startAfter,
      state.speech.language,
      {
        onTranscript: (update, isRepeatDemo) => {
          setHeardText(
            isRepeatDemo ? `[Repeat test] ${update.text}` : update.text,
          );
          const curAligner = alignerRef.current;
          if (!curAligner) return;
          const res = curAligner.processTranscript(update);
          setAlignmentStatus(res.status);
          if (res.note) setStatusNote(res.note);
          if (res.moved) {
            setActiveTokenIndex(res.tokenIndex);
          }
        },
        onAudioLevel: (lvl) => setAudioLevel(lvl),
        onDone: () => {
          setIsSimulating(false);
          setAudioLevel(0);
        },
      },
    );

    if (started) {
      setIsSimulating(true);
      setAlignmentStatus('tracking');
      setStatusNote('Speaking demo aloud...');
    }
  }, [
    isSimulating,
    stopSimulator,
    stopPlayback,
    indexedScript.tokens,
    activeTokenIndex,
    state.speech.language,
  ]);

  const handleSeekToken = useCallback((tokenIndex: number) => {
    const res = alignerRef.current?.seekToToken(tokenIndex);
    setActiveTokenIndex(res ? res.tokenIndex : tokenIndex);
    setAlignmentStatus('tracking');
    setStatusNote('Manual jump');
  }, []);

  const handleReset = useCallback(() => {
    stopSimulator();
    alignerRef.current?.reset();
    setActiveTokenIndex(-1);
    setAlignmentStatus('idle');
    setHeardText('');
    setStatusNote('Reset to start');
    setElapsedMs(0);
    if (isPlaying) {
      timerStartRef.current = performance.now();
    } else {
      timerStartRef.current = null;
    }
  }, [stopSimulator, isPlaying]);

  const handleStep = useCallback(
    (deltaTokens: number) => {
      const total = indexedScript.tokens.length;
      if (total === 0) return;
      const base = activeTokenIndex < 0 ? 0 : activeTokenIndex;
      const next = Math.max(0, Math.min(total - 1, base + deltaTokens));
      handleSeekToken(next);
    },
    [indexedScript.tokens.length, activeTokenIndex, handleSeekToken],
  );

  const updateAppearance = useCallback((patch: Partial<AppearanceSettings>) => {
    setState((prev) => ({
      ...prev,
      appearance: { ...prev.appearance, ...patch },
    }));
  }, []);

  const handleCycleMirror = useCallback(() => {
    setState((prev) => {
      const idx = MIRROR_CYCLE.indexOf(prev.appearance.mirrorMode);
      const next = MIRROR_CYCLE[(idx + 1) % MIRROR_CYCLE.length];
      return {
        ...prev,
        appearance: { ...prev.appearance, mirrorMode: next },
      };
    });
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (!isStageMode) {
      setIsStageMode(true);
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => undefined);
      }
    } else {
      setIsStageMode(false);
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => undefined);
      }
    }
  }, [isStageMode]);

  // Sync stage mode if user exits native browser fullscreen via Esc
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && isStageMode) {
        setIsStageMode(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [isStageMode]);

  // Global keyboard & wireless presenter remote shortcuts (ignored when editing text)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditing =
        target &&
        (target.tagName === 'TEXTAREA' ||
          target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === 'Escape' && isStageMode) {
        e.preventDefault();
        setIsStageMode(false);
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => undefined);
        }
        return;
      }

      if (isEditing || hotkeysOpen) return;

      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        handleStep(12);
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        handleStep(-12);
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setState((prev) => ({
          ...prev,
          appearance: {
            ...prev.appearance,
            mirrorMode:
              prev.appearance.mirrorMode === 'horizontal' ? 'none' : 'horizontal',
          },
        }));
      } else if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        setState((prev) => ({
          ...prev,
          appearance: {
            ...prev.appearance,
            mirrorMode: prev.appearance.mirrorMode === 'vertical' ? 'none' : 'vertical',
          },
        }));
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        handleToggleFullscreen();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleReset();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        updateAppearance({
          fontSize: Math.min(140, state.appearance.fontSize + 4),
        });
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        updateAppearance({
          fontSize: Math.max(24, state.appearance.fontSize - 4),
        });
      } else if (e.key === '?') {
        e.preventDefault();
        setHotkeysOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isStageMode,
    hotkeysOpen,
    handleTogglePlay,
    handleStep,
    handleToggleFullscreen,
    handleReset,
    updateAppearance,
    state.appearance.fontSize,
  ]);

  // Multi-format file import handler
  const handleImportFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      for (const file of list) {
        try {
          const parsed = await parseDocumentFile(file);
          const newId = `script-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          setState((prev) => ({
            ...prev,
            scripts: [
              {
                id: newId,
                title: parsed.title,
                content: parsed.content,
                sourceFormat: parsed.format,
                updatedAt: Date.now(),
              },
              ...prev.scripts,
            ],
            activeScriptId: newId,
          }));
          const warnSuffix =
            parsed.warnings.length > 0 ? ` (${parsed.warnings[0]})` : '';
          notify(
            `Imported "${parsed.title}" [${parsed.format}]${warnSuffix}`,
            'success',
          );
        } catch (err) {
          notify(
            err instanceof Error ? err.message : `Failed to import ${file.name}`,
            'error',
          );
        }
      }
    },
    [notify],
  );

  // Global drag-and-drop file import anywhere in window
  useEffect(() => {
    let dragCounter = 0;
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        dragCounter++;
        setIsDraggingFile(true);
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
      }
    };
    const onDragLeave = () => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) setIsDraggingFile(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter = 0;
      setIsDraggingFile(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        void handleImportFiles(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleImportFiles]);

  const wordCount = indexedScript.speakableWordCount;
  const estMinutes = Math.max(
    0.1,
    wordCount / Math.max(60, state.appearance.autoScrollWpm),
  );
  const formattedDuration =
    estMinutes < 1
      ? `${Math.round(estMinutes * 60)}s`
      : `${Math.floor(estMinutes)}m ${Math.round((estMinutes % 1) * 60)}s`;

  const hudElement = (
    <FloatingHud
      isPlaying={isPlaying}
      isSimulating={isSimulating}
      engineKind={state.speech.kind}
      engineState={engineState}
      alignmentStatus={alignmentStatus}
      statusNote={statusNote}
      heardText={heardText}
      audioLevel={audioLevel}
      elapsedMs={elapsedMs}
      mirrorMode={state.appearance.mirrorMode}
      fontSize={state.appearance.fontSize}
      autoScrollWpm={state.appearance.autoScrollWpm}
      isFullscreenStage={isStageMode}
      onTogglePlay={handleTogglePlay}
      onToggleSimulate={handleToggleSimulate}
      onReset={handleReset}
      onStepBack={() => handleStep(-12)}
      onStepForward={() => handleStep(12)}
      onCycleMirror={handleCycleMirror}
      onAdjustFont={(delta) =>
        updateAppearance({
          fontSize: Math.max(24, Math.min(140, state.appearance.fontSize + delta)),
        })
      }
      onAdjustWpm={(delta) =>
        updateAppearance({
          autoScrollWpm: Math.max(
            60,
            Math.min(240, state.appearance.autoScrollWpm + delta),
          ),
        })
      }
      onToggleFullscreen={handleToggleFullscreen}
      onOpenHotkeys={() => setHotkeysOpen(true)}
      onExitStage={() => {
        setIsStageMode(false);
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => undefined);
        }
      }}
    />
  );

  return (
    <div className="studio-shell">
      <header className="studio-topbar">
        <div className="brand-mark">
          <div className="brand-badge">S</div>
          <span className="brand-title">Sufleur</span>
          <span className="brand-sub">VOICE TELEPROMPTER STUDIO</span>
          {pwa.isOffline && (
            <span className="offline-pill" title="Working offline (cached PWA)">
              <WifiOff size={12} aria-hidden="true" /> Offline
            </span>
          )}
        </div>

        <div className="topbar-actions">
          {pwa.needRefresh && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void pwa.applyUpdate()}
              title="Update Sufleur to the newest version"
            >
              <RefreshCw size={14} aria-hidden="true" />
              <span className="hide-xs">Update</span>
            </button>
          )}

          {!pwa.isStandalone && (pwa.canInstallNative || pwa.isIosBrowser) && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                const outcome = await pwa.triggerInstall();
                if (outcome === 'ios-hint') {
                  notify(
                    'To install on iPhone/iPad: tap Share (↑) in Safari, then choose "Add to Home Screen".',
                    'info',
                  );
                } else if (outcome === 'accepted') {
                  notify('Sufleur installed as a standalone app!', 'success');
                }
              }}
              title="Install Sufleur as an offline PWA app"
            >
              <Download size={14} aria-hidden="true" />
              <span className="hide-xs">Install</span>
            </button>
          )}

          <button
            type="button"
            className="btn btn-ghost btn-sm hide-mobile"
            onClick={() => setHotkeysOpen(true)}
            title="Keyboard & Presenter Shortcuts (?)"
          >
            <HelpCircle size={15} aria-hidden="true" />
            <span>Shortcuts</span>
          </button>

          <button
            type="button"
            className="btn btn-primary topbar-launch-btn"
            onClick={handleToggleFullscreen}
          >
            <Maximize2 size={15} aria-hidden="true" />
            <span className="hide-xs">Launch Stage</span>
            <span className="show-xs">Stage</span>
          </button>
        </div>
      </header>

      <main className={`studio-workspace mobile-tab-${mobileTab}`}>
        <StudioSidebar
          scripts={state.scripts}
          activeScriptId={activeScript.id}
          onSelectScript={(id) => {
            setState((prev) => ({ ...prev, activeScriptId: id }));
            setMobileTab('prompter');
          }}
          onCreateScript={() => {
            const id = `script-${Date.now()}`;
            setState((prev) => ({
              ...prev,
              scripts: [
                {
                  id,
                  title: 'New Script',
                  content: '',
                  sourceFormat: 'TEXT',
                  updatedAt: Date.now(),
                },
                ...prev.scripts,
              ],
              activeScriptId: id,
            }));
            setMobileTab('editor');
          }}
          onDuplicateScript={(id) => {
            const src = state.scripts.find((s) => s.id === id);
            if (!src) return;
            const copyId = `script-${Date.now()}`;
            setState((prev) => ({
              ...prev,
              scripts: [
                {
                  ...src,
                  id: copyId,
                  title: `${src.title} (Copy)`,
                  updatedAt: Date.now(),
                },
                ...prev.scripts,
              ],
              activeScriptId: copyId,
            }));
          }}
          onDeleteScript={(id) => {
            setState((prev) => {
              const remaining = prev.scripts.filter((s) => s.id !== id);
              if (remaining.length === 0) return prev;
              const nextActive =
                prev.activeScriptId === id ? remaining[0].id : prev.activeScriptId;
              return { ...prev, scripts: remaining, activeScriptId: nextActive };
            });
          }}
          onImportFiles={(files) => {
            void handleImportFiles(files);
            setMobileTab('prompter');
          }}
        />

        <section className="center-pane" aria-label="Script Editor and Live Prompter">
          <div className="center-tabs">
            <div className="segmented hide-mobile" role="group" aria-label="Workspace View">
              <button
                type="button"
                className={viewMode === 'split' ? 'active' : ''}
                onClick={() => setViewMode('split')}
              >
                <Columns2 size={13} aria-hidden="true" /> Split
              </button>
              <button
                type="button"
                className={viewMode === 'edit' ? 'active' : ''}
                onClick={() => setViewMode('edit')}
              >
                <Edit3 size={13} aria-hidden="true" /> Editor
              </button>
              <button
                type="button"
                className={viewMode === 'preview' ? 'active' : ''}
                onClick={() => setViewMode('preview')}
              >
                <Eye size={13} aria-hidden="true" /> Prompter
              </button>
            </div>

            <div className="telemetry-strip">
              <span>
                <strong>{wordCount}</strong> words
              </span>
              <span>
                Est. <strong>{formattedDuration}</strong>
              </span>
              {(isSessionActive || elapsedMs > 0) && (
                <span className={`session-timer-inline ${isSessionActive ? 'live' : ''}`}>
                  Time <strong>{formatElapsedTime(elapsedMs)}</strong>
                </span>
              )}
              <span>
                Lang <strong>{state.speech.language}</strong>
              </span>
            </div>
          </div>

          <div
            className={`center-body ${
              viewMode === 'split'
                ? 'mode-split'
                : viewMode === 'edit'
                  ? 'mode-edit'
                  : 'mode-preview'
            }`}
          >
            <div className="editor-pane-wrap">
              <div className="editor-shell">
                <input
                  type="text"
                  className="script-title-input"
                  aria-label="Script title"
                  value={activeScript.title}
                  onChange={(e) => {
                    const title = e.target.value;
                    setState((prev) => ({
                      ...prev,
                      scripts: prev.scripts.map((s) =>
                        s.id === activeScript.id
                          ? { ...s, title, updatedAt: Date.now() }
                          : s,
                      ),
                    }));
                  }}
                />
                <textarea
                  className="script-textarea"
                  aria-label="Script text"
                  placeholder="Paste your script here, or drop any PDF, DOCX, DOC, RTF, TXT, MD, HTML, or SRT file..."
                  value={activeScript.content}
                  onChange={(e) => {
                    const content = e.target.value;
                    setState((prev) => ({
                      ...prev,
                      scripts: prev.scripts.map((s) =>
                        s.id === activeScript.id
                          ? { ...s, content, updatedAt: Date.now() }
                          : s,
                      ),
                    }));
                  }}
                />
              </div>
            </div>

            <div className="preview-pane-wrap">
              <div className="split-preview-header">
                <span>LIVE PROMPTER — TAP ANY WORD TO SEEK</span>
                <span>
                  {state.speech.kind.toUpperCase()} · {state.appearance.mirrorMode.toUpperCase()}
                </span>
              </div>
              <div className="preview-stage-host">
                {!isStageMode && (
                  <PrompterStage
                    tokens={indexedScript.tokens}
                    activeTokenIndex={activeTokenIndex}
                    appearance={state.appearance}
                    isPlaying={isPlaying}
                    isAutoScroll={state.speech.kind === 'auto-scroll'}
                    isFullscreenStage={false}
                    onSeekToken={handleSeekToken}
                  >
                    {hudElement}
                  </PrompterStage>
                )}
              </div>
            </div>
          </div>
        </section>

        <SettingsPanel
          appearance={state.appearance}
          presets={state.presets}
          speech={state.speech}
          onUpdateAppearance={updateAppearance}
          onApplyPreset={(preset: StylePreset) => {
            updateAppearance(preset.settings);
            notify(`Applied preset "${preset.name}"`, 'info');
          }}
          onSavePreset={(name: string) => {
            const preset: StylePreset = {
              id: `preset-${Date.now()}`,
              name,
              settings: { ...state.appearance },
            };
            setState((prev) => ({
              ...prev,
              presets: [...prev.presets, preset],
            }));
            notify(`Saved preset "${name}"`, 'success');
          }}
          onDeletePreset={(id: string) => {
            setState((prev) => ({
              ...prev,
              presets: prev.presets.filter((p) => p.id !== id),
            }));
          }}
          onUpdateSpeech={(patch) => {
            setState((prev) => ({
              ...prev,
              speech: { ...prev.speech, ...patch },
            }));
          }}
          onNotify={notify}
        />
      </main>

      {/* Mobile Bottom Tab Bar (<= 900px) */}
      <nav className="mobile-tabbar" aria-label="Primary mobile navigation">
        <button
          type="button"
          className={mobileTab === 'scripts' ? 'active' : ''}
          onClick={() => setMobileTab('scripts')}
        >
          <FileText size={18} aria-hidden="true" />
          <span>Scripts</span>
        </button>
        <button
          type="button"
          className={mobileTab === 'editor' ? 'active' : ''}
          onClick={() => setMobileTab('editor')}
        >
          <Edit3 size={18} aria-hidden="true" />
          <span>Editor</span>
        </button>
        <button
          type="button"
          className={mobileTab === 'prompter' ? 'active' : ''}
          onClick={() => setMobileTab('prompter')}
        >
          <Eye size={18} aria-hidden="true" />
          <span>Prompter</span>
        </button>
        <button
          type="button"
          className={mobileTab === 'settings' ? 'active' : ''}
          onClick={() => setMobileTab('settings')}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
          <span>Settings</span>
        </button>
      </nav>

      {/* Fullscreen Stage Overlay */}
      {isStageMode && (
        <PrompterStage
          tokens={indexedScript.tokens}
          activeTokenIndex={activeTokenIndex}
          appearance={state.appearance}
          isPlaying={isPlaying}
          isAutoScroll={state.speech.kind === 'auto-scroll'}
          isFullscreenStage={true}
          onSeekToken={handleSeekToken}
        >
          {hudElement}
        </PrompterStage>
      )}

      {/* Drag & Drop File Overlay */}
      {isDraggingFile && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">
            <Upload size={36} color="#f59e0b" />
            <strong style={{ fontFamily: 'var(--font-display)', fontSize: 20 }}>
              Drop Script to Import
            </strong>
            <span style={{ color: 'var(--text-1)', fontSize: 13 }}>
              Supports PDF, DOCX, legacy DOC, RTF, TXT, Markdown, HTML, SRT &amp; VTT
            </span>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`toast-banner ${toast.tone}`} role="status">
          <span>{toast.text}</span>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            style={{ width: 22, height: 22, padding: 2 }}
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            <X size={13} />
          </button>
        </div>
      )}

      <HotkeysDialog open={hotkeysOpen} onClose={() => setHotkeysOpen(false)} />
    </div>
  );
}

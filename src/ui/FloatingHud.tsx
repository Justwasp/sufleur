import {
  ChevronDown,
  ChevronUp,
  FlipHorizontal2,
  HelpCircle,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Timer,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatElapsedTime } from '../core/timer';
import type { AlignmentStatus } from '../core/types';
import type { EngineConnectionState, SpeechEngineKind } from '../speech/types';
import type { MirrorMode } from '../store/types';

interface FloatingHudProps {
  isPlaying: boolean;
  isSimulating: boolean;
  engineKind: SpeechEngineKind;
  engineState: EngineConnectionState;
  alignmentStatus: AlignmentStatus;
  statusNote: string;
  heardText: string;
  audioLevel: number;
  elapsedMs: number;
  mirrorMode: MirrorMode;
  fontSize: number;
  autoScrollWpm: number;
  isFullscreenStage: boolean;
  onTogglePlay: () => void;
  onToggleSimulate: () => void;
  onReset: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onCycleMirror: () => void;
  onAdjustFont: (delta: number) => void;
  onAdjustWpm: (delta: number) => void;
  onToggleFullscreen: () => void;
  onOpenHotkeys: () => void;
  onExitStage?: () => void;
}

function getStatusBadge(
  engineKind: SpeechEngineKind,
  engineState: EngineConnectionState,
  alignmentStatus: AlignmentStatus,
): { label: string; dotClass: string } {
  if (engineKind === 'auto-scroll') {
    return { label: 'AUTO-SCROLL', dotClass: 'amber' };
  }
  if (engineState === 'loading') return { label: 'CONNECTING', dotClass: 'amber' };
  if (engineState === 'error' || engineState === 'unsupported') {
    return { label: 'ERROR', dotClass: 'live' };
  }
  if (alignmentStatus === 'repeating') return { label: 'REPEAT HOLD', dotClass: 'amber' };
  if (alignmentStatus === 'ambiguous-hold') return { label: 'WAIT CONTEXT', dotClass: 'amber' };
  if (alignmentStatus === 'jumped-forward') return { label: 'JUMPED FWD ↻', dotClass: 'signal' };
  if (alignmentStatus === 'jumped-backward') return { label: 'JUMPED BACK ↺', dotClass: 'signal' };
  if (alignmentStatus === 'end') return { label: 'END OF SCRIPT', dotClass: 'signal' };
  if (engineState === 'listening') return { label: 'VOICE LOCKED', dotClass: 'live' };
  return { label: 'STANDBY', dotClass: 'idle' };
}

export function FloatingHud({
  isPlaying,
  isSimulating,
  engineKind,
  engineState,
  alignmentStatus,
  statusNote,
  heardText,
  audioLevel,
  elapsedMs,
  mirrorMode,
  fontSize,
  autoScrollWpm,
  isFullscreenStage,
  onTogglePlay,
  onToggleSimulate,
  onReset,
  onStepBack,
  onStepForward,
  onCycleMirror,
  onAdjustFont,
  onAdjustWpm,
  onToggleFullscreen,
  onOpenHotkeys,
  onExitStage,
}: FloatingHudProps) {
  const [idleDim, setIdleDim] = useState(false);

  useEffect(() => {
    if (!isFullscreenStage || !isPlaying) {
      setIdleDim(false);
      return;
    }

    let timer = window.setTimeout(() => setIdleDim(true), 3200);
    const wake = () => {
      setIdleDim(false);
      clearTimeout(timer);
      timer = window.setTimeout(() => setIdleDim(true), 3200);
    };

    window.addEventListener('mousemove', wake, { passive: true });
    window.addEventListener('keydown', wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [isFullscreenStage, isPlaying]);

  const badge = getStatusBadge(engineKind, engineState, alignmentStatus);

  const isActiveRun = isPlaying || isSimulating;
  const showTelemetry =
    isActiveRun || elapsedMs > 0 || Boolean(heardText) || Boolean(statusNote);

  return (
    <div
      className={`floating-hud ${idleDim ? 'dimmed' : ''} ${isFullscreenStage ? '' : 'embedded'}`}
    >
      {showTelemetry && (
        <div className="hud-telemetry-pill" role="status" aria-live="polite">
          <span className={`status-dot ${isSimulating ? 'signal' : badge.dotClass}`} />
          <strong>{isSimulating ? 'DEMO VOICE' : badge.label}</strong>
          <span
            className={`hud-timer ${isActiveRun ? 'live' : ''}`}
            title="Cumulative speaking time (continues across Stop/Start; resets on Reset)"
          >
            <Timer size={12} aria-hidden="true" />
            {formatElapsedTime(elapsedMs)}
          </span>
          {(engineKind !== 'auto-scroll' || isSimulating) && (
            <div className="vu-meter" title="Audio level">
              <div
                className="vu-meter-fill"
                style={{ width: `${Math.round(Math.min(1, audioLevel) * 100)}%` }}
              />
            </div>
          )}
          <span className="hud-heard-text">
            {heardText || statusNote || 'Speak naturally — tracker follows your voice'}
          </span>
        </div>
      )}

      <div className="hud-bar">
        <button
          type="button"
          className={`btn ${isPlaying ? 'btn-tally' : 'btn-primary'}`}
          onClick={onTogglePlay}
          title="Start / Pause (Space)"
        >
          {isPlaying ? <Pause size={15} /> : <Play size={15} />}
          {isPlaying
            ? 'Stop'
            : engineKind === 'auto-scroll'
              ? 'Scroll'
              : isFullscreenStage
                ? 'Start Mic'
                : 'Mic'}
        </button>

        <button
          type="button"
          className={`btn btn-sm ${isSimulating ? 'btn-primary' : ''}`}
          onClick={onToggleSimulate}
          title="Play voiced demo (speaks script aloud & demonstrates repeat protection)"
        >
          {isSimulating ? (
            <VolumeX size={14} aria-hidden="true" />
          ) : (
            <Volume2 size={14} aria-hidden="true" />
          )}
          {isSimulating
            ? 'Stop'
            : isFullscreenStage
              ? 'Demo Voice'
              : 'Demo'}
        </button>

        <div className="hud-divider" />

        <button
          type="button"
          className="btn btn-icon"
          onClick={onReset}
          title="Reset to start (R)"
          aria-label="Reset to start"
        >
          <RotateCcw size={15} />
        </button>
        <button
          type="button"
          className="btn btn-icon"
          onClick={onStepBack}
          title="Step back (Up / PageUp)"
          aria-label="Step back"
        >
          <ChevronUp size={16} />
        </button>
        <button
          type="button"
          className="btn btn-icon"
          onClick={onStepForward}
          title="Step forward (Down / PageDown)"
          aria-label="Step forward"
        >
          <ChevronDown size={16} />
        </button>

        <div className="hud-divider" />

        <button
          type="button"
          className="btn btn-icon"
          onClick={() => onAdjustFont(-4)}
          title="Smaller text (-)"
          aria-label="Decrease font size"
        >
          <Minus size={14} />
        </button>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, minWidth: 38, textAlign: 'center' }}>
          {fontSize}px
        </span>
        <button
          type="button"
          className="btn btn-icon"
          onClick={() => onAdjustFont(4)}
          title="Larger text (+)"
          aria-label="Increase font size"
        >
          <Plus size={14} />
        </button>

        {engineKind === 'auto-scroll' && (
          <>
            <div className="hud-divider" />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onAdjustWpm(-15)}
              title="Slower auto-scroll"
            >
              -WPM
            </button>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
              {autoScrollWpm}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onAdjustWpm(15)}
              title="Faster auto-scroll"
            >
              +WPM
            </button>
          </>
        )}

        <div className="hud-divider" />

        <button
          type="button"
          className={`btn btn-sm ${mirrorMode !== 'none' ? 'btn-primary' : ''}`}
          onClick={onCycleMirror}
          title="Cycle Mirror Mode (M)"
        >
          <FlipHorizontal2 size={14} />
          {mirrorMode === 'none'
            ? 'Mirror'
            : mirrorMode === 'horizontal'
              ? 'Mirror H'
              : mirrorMode === 'vertical'
                ? 'Mirror V'
                : 'Mirror H+V'}
        </button>

        {isFullscreenStage && (
          <button
            type="button"
            className="btn btn-icon"
            onClick={onOpenHotkeys}
            title="Keyboard & Presenter Shortcuts"
            aria-label="Keyboard shortcuts"
          >
            <HelpCircle size={15} />
          </button>
        )}

        <button
          type="button"
          className="btn btn-icon"
          onClick={onToggleFullscreen}
          title="Toggle Fullscreen (F)"
          aria-label="Toggle fullscreen"
        >
          {isFullscreenStage ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>

        {isFullscreenStage && onExitStage && (
          <button
            type="button"
            className="btn btn-icon"
            onClick={onExitStage}
            title="Exit Stage (Esc)"
            aria-label="Exit stage"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

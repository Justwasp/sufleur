import { useEffect, useRef } from 'react';
import { SmoothScrollController } from '../core/scrollController';
import type { ScriptToken } from '../core/types';
import type { AppearanceSettings } from '../store/types';

interface PrompterStageProps {
  tokens: ScriptToken[];
  activeTokenIndex: number;
  appearance: AppearanceSettings;
  isPlaying: boolean;
  isAutoScroll: boolean;
  isFullscreenStage: boolean;
  onSeekToken: (tokenIndex: number) => void;
  children?: React.ReactNode;
}

export function PrompterStage({
  tokens,
  activeTokenIndex,
  appearance,
  isPlaying,
  isAutoScroll,
  isFullscreenStage,
  onSeekToken,
  children,
}: PrompterStageProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const tokenRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const scrollCtrlRef = useRef<SmoothScrollController | null>(null);

  if (!scrollCtrlRef.current) {
    scrollCtrlRef.current = new SmoothScrollController();
  }

  useEffect(() => {
    const ctrl = scrollCtrlRef.current!;
    ctrl.attach(scrollerRef.current);
    return () => ctrl.stop();
  }, []);

  // Constant-speed auto-scroll fallback when auto-scroll engine is active
  useEffect(() => {
    const ctrl = scrollCtrlRef.current!;
    // Estimate pixels/sec from WPM, fontSize, and lineHeight
    const pxPerSec =
      (appearance.autoScrollWpm / 60) * (appearance.fontSize * appearance.lineHeight * 0.19);
    ctrl.setAutoScroll(isPlaying && isAutoScroll, pxPerSec);
  }, [
    isPlaying,
    isAutoScroll,
    appearance.autoScrollWpm,
    appearance.fontSize,
    appearance.lineHeight,
  ]);

  // Smoothly keep the active spoken word locked onto the configured reading guide line,
  // and immediately re-center on container resize or Stage Mode transitions.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const ctrl = scrollCtrlRef.current;
    if (!scroller || !ctrl) return;

    const alignToGuide = (immediate: boolean) => {
      if (activeTokenIndex < 0) {
        if (immediate) ctrl.jumpImmediately(0);
        else ctrl.setTargetScrollTop(0);
        return;
      }

      const tokenEl = tokenRefs.current.get(activeTokenIndex);
      if (!tokenEl) return;

      const guideOffsetPx =
        (appearance.readingGuidePosition / 100) * scroller.clientHeight;
      const desiredScrollTop =
        tokenEl.offsetTop - guideOffsetPx + tokenEl.offsetHeight * 0.5;

      if (immediate) {
        ctrl.jumpImmediately(desiredScrollTop);
      } else {
        ctrl.setTargetScrollTop(desiredScrollTop);
      }
    };

    alignToGuide(false);

    if (typeof ResizeObserver === 'undefined') return;
    let firstResize = true;
    const ro = new ResizeObserver(() => {
      // Snap cleanly on resize / fullscreen switch so active word stays locked on eye-line
      requestAnimationFrame(() => alignToGuide(firstResize || !isPlaying));
      firstResize = false;
    });
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [
    activeTokenIndex,
    appearance.readingGuidePosition,
    appearance.fontSize,
    isFullscreenStage,
    isPlaying,
  ]);

  const mirrorClass =
    appearance.mirrorMode === 'none'
      ? ''
      : `mirror-${appearance.mirrorMode}`;

  const effectiveFontSize = isFullscreenStage
    ? appearance.fontSize
    : Math.max(22, Math.round(appearance.fontSize * 0.56));

  return (
    <div
      className={`stage-shell ${isFullscreenStage ? 'fullscreen-mode' : ''}`}
      style={{ backgroundColor: appearance.backgroundColor }}
    >
      <div className={`stage-mirror-layer ${mirrorClass}`}>
        {appearance.showReadingGuide && (
          <div
            className="reading-guide"
            style={{
              top: `${appearance.readingGuidePosition}%`,
              fontSize: `${effectiveFontSize}px`,
            }}
            aria-hidden="true"
          >
            <span className="reading-chevron">▸</span>
            <div className="reading-guide-band" />
            <span className="reading-chevron">◂</span>
          </div>
        )}

        <div
          ref={scrollerRef}
          className="stage-scroller"
          onWheel={() => scrollCtrlRef.current?.notifyManualScroll(1500)}
          onTouchStart={() => scrollCtrlRef.current?.notifyManualScroll(1800)}
        >
          <div
            className={`stage-content ${isFullscreenStage ? '' : 'embedded'}`}
            style={{
              fontFamily: appearance.fontFamily,
              fontSize: `${effectiveFontSize}px`,
              lineHeight: appearance.lineHeight,
              letterSpacing: `${appearance.letterSpacing}em`,
              paddingLeft: `${appearance.horizontalPadding}%`,
              paddingRight: `${appearance.horizontalPadding}%`,
              textAlign: appearance.textAlign,
              color: appearance.textColor,
            }}
          >
            {tokens.length === 0 ? (
              <p style={{ opacity: 0.45, fontSize: '0.5em' }}>
                Paste, type, or drop a script file to start prompting...
              </p>
            ) : (
              tokens.map((token) => {
                const isActive = token.index === activeTokenIndex;
                const isSpoken = activeTokenIndex >= 0 && token.index < activeTokenIndex;

                return (
                  <span key={token.index}>
                    <span
                      ref={(el) => {
                        if (el) tokenRefs.current.set(token.index, el);
                        else tokenRefs.current.delete(token.index);
                      }}
                      className={[
                        'prompter-token',
                        isActive ? 'active' : '',
                        token.isStageDirection ? 'stage-direction' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{
                        color: isActive ? appearance.activeColor : undefined,
                        opacity: isSpoken ? appearance.spokenOpacity : undefined,
                      }}
                      onClick={() => onSeekToken(token.index)}
                      title="Click to jump prompter here"
                    >
                      {token.raw}
                    </span>
                    {token.trailingSpace.includes('\n') ? (
                      <>
                        {token.trailingSpace
                          .split('\n')
                          .slice(1)
                          .map((_, lineIdx) => (
                            <br key={lineIdx} />
                          ))}
                      </>
                    ) : (
                      token.trailingSpace
                    )}
                  </span>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Floating HUD rendered outside mirror layer so controls stay readable */}
      {children}
    </div>
  );
}

/**
 * Smooth 60fps scroll controller for the teleprompter stage.
 * Supports:
 * 1. Voice-tracked spring/exponential interpolation to keep the active word locked on the eye-line.
 * 2. Constant-speed WPM / px-per-second auto-scroll fallback when microphone is off.
 * 3. Instant manual override suppression so user wheel/touch scrolling never fights the controller.
 */
export class SmoothScrollController {
  private container: HTMLElement | null = null;
  private targetScrollTop: number | null = null;
  private rafId: number | null = null;
  private lastFrameTime = 0;
  private autoScrollEnabled = false;
  private autoScrollPxPerSec = 55;
  private manualOverrideUntil = 0;

  public attach(container: HTMLElement | null): void {
    this.container = container;
    if (!container) {
      this.stop();
    }
  }

  public setTargetScrollTop(scrollTop: number): void {
    if (!this.container) return;
    if (performance.now() < this.manualOverrideUntil) return;

    const maxScroll = Math.max(
      0,
      this.container.scrollHeight - this.container.clientHeight,
    );
    this.targetScrollTop = Math.max(0, Math.min(scrollTop, maxScroll));
    this.ensureRunning();
  }

  public jumpImmediately(scrollTop: number): void {
    if (!this.container) return;
    const maxScroll = Math.max(
      0,
      this.container.scrollHeight - this.container.clientHeight,
    );
    const clamped = Math.max(0, Math.min(scrollTop, maxScroll));
    this.targetScrollTop = clamped;
    this.container.scrollTop = clamped;
  }

  public notifyManualScroll(pauseMs = 1400): void {
    this.manualOverrideUntil = performance.now() + pauseMs;
    if (this.container) {
      this.targetScrollTop = this.container.scrollTop;
    }
  }

  public setAutoScroll(enabled: boolean, pxPerSec = 55): void {
    this.autoScrollEnabled = enabled;
    this.autoScrollPxPerSec = pxPerSec;
    if (enabled) {
      this.targetScrollTop = null;
      this.ensureRunning();
    } else if (this.targetScrollTop === null) {
      this.stop();
    }
  }

  public setAutoScrollSpeed(pxPerSec: number): void {
    this.autoScrollPxPerSec = Math.max(8, Math.min(400, pxPerSec));
  }

  public stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastFrameTime = 0;
  }

  private ensureRunning(): void {
    if (this.rafId === null) {
      this.lastFrameTime = performance.now();
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number): void => {
    if (!this.container) {
      this.stop();
      return;
    }

    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;

    const isManualPaused = now < this.manualOverrideUntil;

    if (this.autoScrollEnabled && !isManualPaused) {
      const maxScroll = Math.max(
        0,
        this.container.scrollHeight - this.container.clientHeight,
      );
      if (this.container.scrollTop < maxScroll) {
        this.container.scrollTop = Math.min(
          maxScroll,
          this.container.scrollTop + this.autoScrollPxPerSec * dt,
        );
      }
      this.rafId = requestAnimationFrame(this.tick);
      return;
    }

    if (this.targetScrollTop !== null && !isManualPaused) {
      const current = this.container.scrollTop;
      const diff = this.targetScrollTop - current;
      if (Math.abs(diff) < 0.75) {
        this.container.scrollTop = this.targetScrollTop;
        this.targetScrollTop = null;
        this.rafId = null;
        return;
      }

      // Exponential smoothing: responsive for fast speech & large jumps, silky for gentle reads
      const smoothing = 1 - Math.exp(-8.5 * dt);
      this.container.scrollTop = current + diff * smoothing;
      this.rafId = requestAnimationFrame(this.tick);
      return;
    }

    this.rafId = null;
  };
}

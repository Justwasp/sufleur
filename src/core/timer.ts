/**
 * Formats elapsed speaking time in milliseconds as MM:SS (or H:MM:SS once >= 1 hour).
 */
export function formatElapsedTime(elapsedMs: number): string {
  const safeMs = Math.max(0, Math.floor(elapsedMs));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Cumulative stopwatch that pauses cleanly and resumes from the accumulated time
 * across stop/start cycles until explicitly reset.
 */
export class CumulativeTimer {
  private accumulatedMs = 0;
  private startedAt: number | null = null;

  public start(now = performance.now()): void {
    if (this.startedAt !== null) return;
    this.startedAt = now;
  }

  public pause(now = performance.now()): number {
    if (this.startedAt !== null) {
      this.accumulatedMs += Math.max(0, now - this.startedAt);
      this.startedAt = null;
    }
    return this.accumulatedMs;
  }

  public getElapsedMs(now = performance.now()): number {
    if (this.startedAt === null) return this.accumulatedMs;
    return this.accumulatedMs + Math.max(0, now - this.startedAt);
  }

  public reset(keepRunning = false, now = performance.now()): void {
    this.accumulatedMs = 0;
    this.startedAt = keepRunning ? now : null;
  }
}

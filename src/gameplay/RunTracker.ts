// src/gameplay/RunTracker.ts
export type RunState = 'READY' | 'RUNNING' | 'FINISHED';

export class RunTracker {
  private readonly storageKey: string;
  public state: RunState = 'READY';
  public startTick = 0;
  public elapsedSec = 0;
  public lastFinishDelta: number | null = null;
  public topRuns: number[] = [];

  constructor(storageKey = 'cs16_surf_sandbox_01_runs_v1') {
    this.storageKey = storageKey;
    this.loadTopRuns();
  }

  private loadTopRuns(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
      if (Array.isArray(saved)) {
        this.topRuns = saved.filter((n): n is number => typeof n === 'number' && n > 0).slice(0, 3);
      }
    } catch {
      this.topRuns = [];
    }
  }

  public reset(): void {
    this.state = 'READY';
    this.elapsedSec = 0;
    this.lastFinishDelta = null;
  }

  public start(currentTick: number): void {
    if (this.state !== 'RUNNING') {
      this.state = 'RUNNING';
      this.startTick = currentTick;
      this.elapsedSec = 0;
      this.lastFinishDelta = null;
    }
  }

  public tick(currentTick: number): void {
    if (this.state === 'RUNNING') {
      this.elapsedSec = (currentTick - this.startTick) * 0.01;
    }
  }

  public finish(currentTick: number): { finishSec: number; isNewPb: boolean } | null {
    if (this.state !== 'RUNNING') return null;
    this.state = 'FINISHED';
    const finishSec = (currentTick - this.startTick) * 0.01;
    this.elapsedSec = finishSec;

    const oldPb = this.topRuns.length > 0 ? this.topRuns[0] : null;
    this.lastFinishDelta = oldPb !== null ? finishSec - oldPb : null;
    const isNewPb = oldPb === null || finishSec < oldPb;

    this.topRuns.push(finishSec);
    this.topRuns.sort((a, b) => a - b);
    this.topRuns = this.topRuns.slice(0, 3);

    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.topRuns));
    } catch {
      // Ignore storage quota or privacy mode errors
    }

    return { finishSec, isNewPb };
  }

  public static formatTime(sec: number): string {
    const clamped = Math.max(0, sec);
    const mins = Math.floor(clamped / 60);
    const secs = Math.floor(clamped % 60);
    const cs = Math.floor((clamped * 100) % 100);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }
}

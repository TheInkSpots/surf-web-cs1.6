import { FIXED_DT } from '../core/constants';

export type RunState = 'IDLE' | 'RUNNING' | 'FINISHED';

export interface StoredCheckpointSplit {
  index: number;
  label: string;
  elapsedSec: number;
  segmentSec: number;
}

export interface CheckpointSplitResult {
  index: number;
  label: string;
  elapsedSec: number;
  segmentSec: number;
  pbSplitSec: number | null;
  deltaSec: number | null;
  bestSegmentSec: number | null;
  isNewBestSegment: boolean;
  isRanked: boolean;
}

export interface RunFinishResult {
  finishSec: number;
  isNewPb: boolean;
  deltaSec: number | null;
  topTimes: number[];
  isRanked: boolean;
}

interface PersistedRunData {
  topTimes: number[];
  pbSplits: Record<number, StoredCheckpointSplit>;
  bestSegments: Record<number, number>;
}

const STORAGE_KEY = 'surf_sandbox_01_records_v2';

export class RunTracker {
  public state: RunState = 'IDLE';
  public lastDeltaSec: number | null = null;
  public lastFinishDelta: number | null = null;

  private startTick = 0;
  private lastSplitTick = 0;
  private currentTick = 0;
  private finishSec = 0;
  private isRankedRun = true;

  private topTimes: number[] = [];
  private pbSplits: Record<number, StoredCheckpointSplit> = {};
  private bestSegments: Record<number, number> = {};

  private readonly currentSplits = new Map<number, CheckpointSplitResult>();

  constructor() {
    this.loadFromStorage();
  }

  public get pbSec(): number | null {
    return this.topTimes.length > 0 ? this.topTimes[0] : null;
  }

  public get topRuns(): readonly number[] {
    return this.topTimes;
  }

  public get elapsedSec(): number {
    return this.getElapsedSec(this.currentTick);
  }

  public get isRanked(): boolean {
    return this.isRankedRun;
  }

  public getTopTimes(): readonly number[] {
    return this.topTimes;
  }

  public getPbSplits(): Readonly<Record<number, StoredCheckpointSplit>> {
    return this.pbSplits;
  }

  public getBestSegments(): Readonly<Record<number, number>> {
    return this.bestSegments;
  }

  public getCurrentSplits(): ReadonlyMap<number, CheckpointSplitResult> {
    return this.currentSplits;
  }

  public getElapsedSec(nowTick = this.currentTick): number {
    if (this.state === 'IDLE') return 0;
    if (this.state === 'FINISHED') return this.finishSec;
    return Math.max(0, (nowTick - this.startTick) * FIXED_DT);
  }

  public getCurrentElapsedSec(): number {
    return this.getElapsedSec(this.currentTick);
  }

  public start(tick: number): void {
    this.state = 'RUNNING';
    this.startTick = tick;
    this.lastSplitTick = tick;
    this.currentTick = tick;
    this.finishSec = 0;
    this.lastDeltaSec = null;
    this.lastFinishDelta = null;
    this.isRankedRun = true;
    this.currentSplits.clear();
  }

  public tick(currentTick: number): void {
    this.currentTick = currentTick;
  }

  /** Marks the current run unranked (e.g., checkpoint respawn or stage warp) while keeping live split deltas active */
  public invalidateRankedRun(): void {
    this.isRankedRun = false;
  }

  public recordCheckpoint(index: number, label: string, tick: number): CheckpointSplitResult {
    this.currentTick = tick;

    if (this.state === 'IDLE') {
      this.state = 'RUNNING';
      this.startTick = tick;
      this.lastSplitTick = tick;
      this.isRankedRun = false;
    }

    const existing = this.currentSplits.get(index);
    if (existing) return existing;

    const elapsedSec = Math.max(0, (tick - this.startTick) * FIXED_DT);
    const segmentSec = Math.max(0, (tick - this.lastSplitTick) * FIXED_DT);
    this.lastSplitTick = tick;

    const pbRecord = this.pbSplits[index];
    const pbSplitSec = pbRecord ? pbRecord.elapsedSec : null;
    const deltaSec = pbSplitSec !== null ? elapsedSec - pbSplitSec : null;
    this.lastDeltaSec = deltaSec;

    const priorBestSeg = this.bestSegments[index] ?? null;
    const isNewBestSegment =
      this.isRankedRun && segmentSec > 0 && (priorBestSeg === null || segmentSec < priorBestSeg - 1e-4);

    if (isNewBestSegment) {
      this.bestSegments[index] = segmentSec;
      this.saveToStorage();
    }

    const result: CheckpointSplitResult = {
      index,
      label,
      elapsedSec,
      segmentSec,
      pbSplitSec,
      deltaSec,
      bestSegmentSec: this.bestSegments[index] ?? priorBestSeg,
      isNewBestSegment,
      isRanked: this.isRankedRun,
    };

    this.currentSplits.set(index, result);
    return result;
  }

  public finish(tick: number): RunFinishResult | null {
    if (this.state !== 'RUNNING') return null;

    this.currentTick = tick;
    this.state = 'FINISHED';
    this.finishSec = Math.max(0, (tick - this.startTick) * FIXED_DT);

    const finalSegSec = Math.max(0, (tick - this.lastSplitTick) * FIXED_DT);
    const priorFinalBest = this.bestSegments[99] ?? null;
    if (
      this.isRankedRun &&
      finalSegSec > 0 &&
      (priorFinalBest === null || finalSegSec < priorFinalBest - 1e-4)
    ) {
      this.bestSegments[99] = finalSegSec;
    }

    const prevPb = this.pbSec;
    const deltaSec = prevPb !== null ? this.finishSec - prevPb : null;
    this.lastDeltaSec = deltaSec;
    this.lastFinishDelta = deltaSec;

    if (!this.isRankedRun) {
      return {
        finishSec: this.finishSec,
        isNewPb: false,
        deltaSec,
        topTimes: [...this.topTimes],
        isRanked: false,
      };
    }

    const isNewPb = prevPb === null || this.finishSec < prevPb - 1e-4;

    this.topTimes.push(this.finishSec);
    this.topTimes.sort((a, b) => a - b);
    if (this.topTimes.length > 3) {
      this.topTimes.length = 3;
    }

    if (isNewPb || Object.keys(this.pbSplits).length === 0) {
      const nextPbSplits: Record<number, StoredCheckpointSplit> = {};
      for (const [idx, split] of this.currentSplits.entries()) {
        nextPbSplits[idx] = {
          index: split.index,
          label: split.label,
          elapsedSec: split.elapsedSec,
          segmentSec: split.segmentSec,
        };
      }
      nextPbSplits[99] = {
        index: 99,
        label: 'CITADEL FINISH',
        elapsedSec: this.finishSec,
        segmentSec: finalSegSec,
      };
      this.pbSplits = nextPbSplits;
    }

    this.saveToStorage();

    return {
      finishSec: this.finishSec,
      isNewPb,
      deltaSec,
      topTimes: [...this.topTimes],
      isRanked: true,
    };
  }

  public reset(): void {
    this.state = 'IDLE';
    this.startTick = 0;
    this.lastSplitTick = 0;
    this.finishSec = 0;
    this.lastDeltaSec = null;
    this.lastFinishDelta = null;
    this.isRankedRun = true;
    this.currentSplits.clear();
  }

  public clearAllRecords(): void {
    this.topTimes = [];
    this.pbSplits = {};
    this.bestSegments = {};
    this.currentSplits.clear();
    this.lastDeltaSec = null;
    this.lastFinishDelta = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage access errors
    }
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedRunData>;
      if (Array.isArray(parsed.topTimes)) {
        this.topTimes = parsed.topTimes.filter((n): n is number => typeof n === 'number' && n > 0).slice(0, 3);
      }
      if (parsed.pbSplits && typeof parsed.pbSplits === 'object') {
        this.pbSplits = parsed.pbSplits;
      }
      if (parsed.bestSegments && typeof parsed.bestSegments === 'object') {
        this.bestSegments = parsed.bestSegments;
      }
    } catch {
      // Ignore malformed storage entries
    }
  }

  private saveToStorage(): void {
    try {
      const payload: PersistedRunData = {
        topTimes: this.topTimes,
        pbSplits: this.pbSplits,
        bestSegments: this.bestSegments,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota / privacy mode errors
    }
  }

  public static formatTime(sec: number): string {
    const clamped = Math.max(0, sec);
    const mins = Math.floor(clamped / 60);
    const rem = clamped - mins * 60;
    const wholeSecs = Math.floor(rem);
    const hundredths = Math.floor((rem - wholeSecs) * 100 + 1e-6);

    const ss = String(wholeSecs).padStart(2, '0');
    const cc = String(hundredths).padStart(2, '0');
    return mins > 0 ? `${mins}:${ss}.${cc}` : `${ss}.${cc}s`;
  }

  public static formatDelta(deltaSec: number): string {
    const sign = deltaSec <= 0 ? '-' : '+';
    const abs = Math.abs(deltaSec);
    return `${sign}${abs.toFixed(2)}s`;
  }
}

import { MoveState } from '../core/constants';
import { KeyState } from '../gameplay/InputController';
import { RunTracker } from '../gameplay/RunTracker';

export interface HudSnapshot {
  now: number;
  spdXY: number;
  spd3D: number;
  velZ: number;
  simMsAvg: number;
  syncPct: number;
  smoothYawVisual: number;
  moveState: number;
  ducking: boolean;
  keys: KeyState;
  cvarLabel: string;
}

export class HudController {
  private readonly runTracker: RunTracker;

  private readonly elSpeedXY = document.getElementById('speed-xy')!;
  private readonly elSpeed3D = document.getElementById('speed-3d')!;
  private readonly elSpeedPeak = document.getElementById('speed-peak')!;
  private readonly elSpeedZ = document.getElementById('speed-z')!;
  private readonly elSpeedGain = document.getElementById('speed-gain')!;
  private readonly elRunTime = document.getElementById('run-time')!;
  private readonly elRunDelta = document.getElementById('run-delta')!;
  private readonly elTimerState = document.getElementById('timer-state')!;
  private readonly elPbDisplay = document.getElementById('pb-display')!;
  private readonly elTop3Display = document.getElementById('top3-display')!;
  private readonly elSyncPct = document.getElementById('sync-pct')!;
  private readonly elSyncBar = document.getElementById('sync-bar')!;
  private readonly elYawPip = document.getElementById('yaw-pip')!;
  private readonly elNgFps = document.getElementById('ng-fps')!;
  private readonly elNgSim = document.getElementById('ng-sim')!;
  private readonly elNgState = document.getElementById('ng-state')!;
  private readonly elNgHull = document.getElementById('ng-hull')!;
  private readonly elNgSync = document.getElementById('ng-sync')!;
  private readonly elNgCvars = document.getElementById('ng-cvars')!;
  private readonly elToast = document.getElementById('event-toast')!;
  private readonly elFlash = document.getElementById('screen-flash')!;
  private readonly elStrafeOverlay = document.getElementById('strafe-overlay')!;
  private readonly elSpdSlot1 = document.getElementById('spd-slot-1')!;

  private readonly elKeys: Record<keyof KeyState, HTMLElement> = {
    w: document.getElementById('key-w')!,
    a: document.getElementById('key-a')!,
    s: document.getElementById('key-s')!,
    d: document.getElementById('key-d')!,
    jump: document.getElementById('key-jump')!,
    duck: document.getElementById('key-duck')!,
  };

  private toastTimer: number | null = null;
  private sessionPeakSpeed = 0;
  private prevHorizSpeed = 0;
  private fpsCounter = 0;
  private fpsTimer = performance.now();
  private lastTopRunsCount = -1;
  private lastBestRun = -1;

  constructor(runTracker: RunTracker) {
    this.runTracker = runTracker;
    this.refreshPbDisplay();
  }

  public showToast(msg: string, borderColor = 'rgba(34,211,238,0.5)'): void {
    this.elToast.textContent = msg;
    this.elToast.style.borderColor = borderColor;
    this.elToast.classList.add('visible');
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastTimer = window.setTimeout(() => {
      this.elToast.classList.remove('visible');
    }, 2200);
  }

  public flashScreen(colorRgba: string): void {
    this.elFlash.style.background = `radial-gradient(circle, transparent 35%, ${colorRgba} 100%)`;
    this.elFlash.style.opacity = '1';
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        this.elFlash.style.opacity = '0';
      }, 60);
    });
  }

  public setScoutSpeedLabel(legacy260: boolean): void {
    this.elSpdSlot1.textContent = legacy260 ? '260 u/s ★' : '250 u/s';
  }

  public setStrafeHudVisible(visible: boolean): void {
    this.elStrafeOverlay.classList.toggle('hidden', !visible);
  }

  public setActiveWeaponSlot(slot: number): void {
    document.querySelectorAll<HTMLElement>('.weapon-slot').forEach((el) => {
      el.classList.toggle('active', Number(el.dataset.slot) === slot);
    });
  }

  public update(snap: HudSnapshot): void {
    // FPS counter
    this.fpsCounter++;
    if (snap.now - this.fpsTimer >= 400) {
      const fps = Math.round((this.fpsCounter * 1000) / (snap.now - this.fpsTimer));
      this.fpsCounter = 0;
      this.fpsTimer = snap.now;
      this.elNgFps.textContent = String(fps);
    }

    if (snap.spdXY > this.sessionPeakSpeed) {
      this.sessionPeakSpeed = snap.spdXY;
    }

    this.elSpeedXY.textContent = String(Math.round(snap.spdXY));
    this.elSpeed3D.textContent = String(Math.round(snap.spd3D));
    this.elSpeedPeak.textContent = String(Math.round(this.sessionPeakSpeed));
    this.elSpeedZ.textContent = String(Math.round(snap.velZ));
    this.updateSpeedColor(snap.spdXY);

    const dSpd = snap.spdXY - this.prevHorizSpeed;
    this.prevHorizSpeed = snap.spdXY;
    if (dSpd > 2.5) {
      this.elSpeedGain.textContent = '▲';
      this.elSpeedGain.style.color = '#34d399';
    } else if (dSpd < -2.5) {
      this.elSpeedGain.textContent = '▼';
      this.elSpeedGain.style.color = '#fb7185';
    } else {
      this.elSpeedGain.textContent = '';
    }

    // Live keycaps
    this.elKeys.w.classList.toggle('active', snap.keys.w);
    this.elKeys.a.classList.toggle('active', snap.keys.a);
    this.elKeys.s.classList.toggle('active', snap.keys.s);
    this.elKeys.d.classList.toggle('active', snap.keys.d);
    this.elKeys.jump.classList.toggle('active', snap.keys.jump);
    this.elKeys.duck.classList.toggle('active', snap.keys.duck);

    // Strafe sync bar & yaw indicator
    this.elSyncPct.textContent = `${snap.syncPct}%`;
    this.elSyncBar.style.width = `${snap.syncPct}%`;
    this.elNgSync.textContent = `${snap.syncPct}%`;
    this.elYawPip.style.left = `${50 - snap.smoothYawVisual * 45}%`;

    // Run timer & PB delta
    this.refreshPbDisplay();
    this.elRunTime.textContent = RunTracker.formatTime(this.runTracker.elapsedSec);
    this.elTimerState.textContent = this.runTracker.state;
    this.elTimerState.className =
      'timer-badge' +
      (this.runTracker.state === 'RUNNING'
        ? ' running'
        : this.runTracker.state === 'FINISHED'
          ? ' finished'
          : '');

    if (this.runTracker.state === 'FINISHED' && this.runTracker.lastFinishDelta !== null) {
      const d = this.runTracker.lastFinishDelta;
      this.elRunDelta.textContent = `${d <= 0 ? '' : '+'}${d.toFixed(2)}s`;
      this.elRunDelta.className = d <= 0 ? 'delta-ahead' : 'delta-behind';
    } else if (this.runTracker.state === 'RUNNING' && this.runTracker.topRuns.length > 0) {
      const diff = this.runTracker.elapsedSec - this.runTracker.topRuns[0];
      this.elRunDelta.textContent = `${diff <= 0 ? '' : '+'}${diff.toFixed(2)}s`;
      this.elRunDelta.className = diff <= 0 ? 'delta-ahead' : 'delta-behind';
    } else {
      this.elRunDelta.textContent = '--.--';
      this.elRunDelta.className = 'delta-neutral';
    }

    // net_graph telemetry
    this.elNgSim.textContent = snap.simMsAvg.toFixed(2);
    this.elNgCvars.textContent = snap.cvarLabel;

    if (snap.moveState === MoveState.SURF) {
      this.elNgState.textContent = 'SURF';
      this.elNgState.className = 'ng-surf';
    } else if (snap.moveState === MoveState.AIR) {
      this.elNgState.textContent = 'AIR';
      this.elNgState.className = 'ng-air';
    } else {
      this.elNgState.textContent = 'GROUND';
      this.elNgState.className = 'ng-gnd';
    }

    this.elNgHull.textContent = snap.ducking ? '36u (DUCK)' : '72u (STAND)';
  }

  private refreshPbDisplay(): void {
    const runs = this.runTracker.topRuns;
    const best = runs.length > 0 ? runs[0] : -1;
    if (runs.length === this.lastTopRunsCount && best === this.lastBestRun) return;

    this.lastTopRunsCount = runs.length;
    this.lastBestRun = best;

    if (runs.length === 0) {
      this.elPbDisplay.textContent = '--:--.--';
      this.elTop3Display.textContent = 'TOP 3: --';
    } else {
      this.elPbDisplay.textContent = RunTracker.formatTime(runs[0]);
      this.elTop3Display.textContent =
        'TOP 3: ' + runs.map((t, i) => `#${i + 1} ${RunTracker.formatTime(t)}`).join('  •  ');
    }
  }

  private updateSpeedColor(speed: number): void {
    if (speed >= 3000) {
      this.elSpeedXY.style.color = '#e879f9';
      this.elSpeedXY.style.textShadow = '0 0 18px rgba(232, 121, 249, 0.72)';
    } else if (speed >= 2000) {
      this.elSpeedXY.style.color = '#fbbf24';
      this.elSpeedXY.style.textShadow = '0 0 14px rgba(251, 191, 36, 0.55)';
    } else if (speed >= 1000) {
      this.elSpeedXY.style.color = '#22d3ee';
      this.elSpeedXY.style.textShadow = '0 0 12px rgba(34, 211, 238, 0.45)';
    } else {
      this.elSpeedXY.style.color = '#f8fafc';
      this.elSpeedXY.style.textShadow = '0 2px 10px rgba(0, 0, 0, 0.5)';
    }
  }
}

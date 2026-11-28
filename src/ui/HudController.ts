// src/ui/HudController.ts
import { MoveState } from '../core/constants';
import { KeyState } from '../gameplay/InputController';
import { RunTracker } from '../gameplay/RunTracker';
import { PlayerVitalState, SourceVehicle } from '../physics/GoldSrcPhysicsEngine';

export interface HeldPropTelemetry {
  id: string;
  mass: number;
  holdDistance: number;
}

export interface LadderTelemetry {
  id: string;
  progressPct: number; // 0..100
  posZ: number;
  velZ: number;
}

export interface InteractPrompt {
  key: string;
  label: string;
}

export interface SubsystemTelemetry {
  activeBodies: number;
  totalBodies: number;
  intactJoints: number;
  totalJoints: number;
  waterSubmersion: number; // 0..1
  heldProp: HeldPropTelemetry | null;
  ladder: LadderTelemetry | null;
  drivingVehicle: {
    vehicle: SourceVehicle;
    speedUnits: number;
  } | null;
  interactPrompt: InteractPrompt | null;
  vitals: Readonly<PlayerVitalState>;
}

export interface HudGrenadeBadge {
  count: number;
  maxCount: number;
}

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
  subsystems?: SubsystemTelemetry;
  grenade?: HudGrenadeBadge;
}

type MovementKey = 'w' | 'a' | 's' | 'd' | 'jump' | 'duck';

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
  private readonly elCrosshair = document.getElementById('crosshair');

  // Slot 5 (HE Grenade) badge in the main HUD weapon bar
  private elSlot5Badge: HTMLElement | null = null;
  private elSlot5Container: HTMLElement | null = null;

  // Subsystem HUD nodes (optional lookup keeps backwards compatibility)
  private readonly elInteractPrompt = document.getElementById('interact-prompt');
  private readonly elInteractKey = document.getElementById('interact-key');
  private readonly elInteractLabel = document.getElementById('interact-label');

  private readonly elPhysHeld = document.getElementById('phys-held-panel');
  private readonly elHeldName = document.getElementById('held-body-name');
  private readonly elHeldMass = document.getElementById('held-body-mass');
  private readonly elHeldDist = document.getElementById('held-body-dist');

  private readonly elLadderHud = document.getElementById('ladder-hud');
  private readonly elLadderId = document.getElementById('ladder-id');
  private readonly elLadderZ = document.getElementById('ladder-z');
  private readonly elLadderVz = document.getElementById('ladder-vz');
  private readonly elLadderBar = document.getElementById('ladder-bar');

  private readonly elVehHud = document.getElementById('vehicle-hud');
  private readonly elVehKmh = document.getElementById('veh-kmh');
  private readonly elVehHb = document.getElementById('veh-hb-badge');
  private readonly elVehThrottle = document.getElementById('veh-throttle-fill');
  private readonly elVehSteerPip = document.getElementById('veh-steer-pip');
  private readonly elWheelCells = [0, 1, 2, 3].map((i) => document.getElementById(`whl-${i}`));
  private readonly elWheelBars = [0, 1, 2, 3].map((i) => document.getElementById(`whl-bar-${i}`));

  private readonly elVitalHp = document.getElementById('vital-hp');
  private readonly elVitalBlood = document.getElementById('vital-blood');

  private readonly elNgBodies = document.getElementById('ng-bodies');
  private readonly elNgJoints = document.getElementById('ng-joints');
  private readonly elNgWater = document.getElementById('ng-water');
  private readonly elNgSubsys = document.getElementById('ng-subsys');

  private readonly elKeys: Record<MovementKey, HTMLElement> = {
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
  private lastGrenadeText = '';

  constructor(runTracker: RunTracker) {
    this.runTracker = runTracker;
    this.ensureSlot5Element();
    this.refreshPbDisplay();
  }

  /** Locate existing Slot 5 weapon card or inject one next to the existing .weapon-slot cards */
  private ensureSlot5Element(): void {
    const existing = document.querySelector<HTMLElement>('.weapon-slot[data-slot="5"]');
    if (existing) {
      this.elSlot5Container = existing;
      this.elSlot5Badge =
        existing.querySelector<HTMLElement>('#ammo-slot-5') ??
        existing.querySelector<HTMLElement>('.slot-spd');
      return;
    }

    const firstSlot = document.querySelector<HTMLElement>('.weapon-slot');
    const bar = firstSlot?.parentElement;
    if (!bar) return;

    const slot5 = document.createElement('div');
    slot5.className = 'weapon-slot';
    slot5.dataset.slot = '5';
    slot5.innerHTML = `
      <span class="slot-num">5</span>
      <span class="slot-name">HE GRENADE</span>
      <span class="slot-spd" id="ammo-slot-5">5/5 HE</span>
    `;
    bar.appendChild(slot5);

    this.elSlot5Container = slot5;
    this.elSlot5Badge = slot5.querySelector<HTMLElement>('#ammo-slot-5');
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

  public setGrenadeAmmo(count: number, maxCount: number): void {
    const label = count > 0 ? `${count}/${maxCount} HE` : 'EMPTY [R]';
    if (label === this.lastGrenadeText) return;
    this.lastGrenadeText = label;

    if (this.elSlot5Badge) {
      this.elSlot5Badge.textContent = label;
      this.elSlot5Badge.style.color = count > 0 ? '#fdba74' : '#fb7185';
    }
    if (this.elSlot5Container) {
      this.elSlot5Container.style.opacity = count > 0 ? '1' : '0.55';
    }
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

    // net_graph state & CVars
    this.elNgSim.textContent = snap.simMsAvg.toFixed(2);
    this.elNgCvars.textContent = snap.cvarLabel;

    if (snap.moveState === MoveState.LADDER) {
      this.elNgState.textContent = 'LADDER';
      this.elNgState.className = 'ng-ladder';
    } else if (snap.moveState === MoveState.WATER) {
      this.elNgState.textContent = 'WATER';
      this.elNgState.className = 'ng-water';
    } else if (snap.moveState === MoveState.SURF) {
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

    // Slot 5 grenade badge
    if (snap.grenade) {
      this.setGrenadeAmmo(snap.grenade.count, snap.grenade.maxCount);
    }

    // Subsystem overlays
    if (snap.subsystems) {
      this.updateSubsystems(snap.subsystems);
    }
  }

  private updateSubsystems(sub: SubsystemTelemetry): void {
    // 1. Contextual interact prompt
    if (this.elInteractPrompt && this.elInteractKey && this.elInteractLabel) {
      if (sub.interactPrompt) {
        this.elInteractKey.textContent = sub.interactPrompt.key;
        this.elInteractLabel.textContent = sub.interactPrompt.label;
        this.elInteractPrompt.classList.add('visible');
      } else {
        this.elInteractPrompt.classList.remove('visible');
      }
    }

    // Crosshair feedback
    if (this.elCrosshair) {
      this.elCrosshair.classList.toggle('grav-holding', sub.heldProp !== null);
      this.elCrosshair.classList.toggle('can-interact', sub.interactPrompt !== null);
    }

    // 2. Gravity Gun held prop PID panel
    if (this.elPhysHeld) {
      const held = sub.heldProp;
      this.elPhysHeld.classList.toggle('visible', held !== null);
      if (held && this.elHeldName && this.elHeldMass && this.elHeldDist) {
        this.elHeldName.textContent = held.id.toUpperCase();
        this.elHeldMass.textContent = `${Math.round(held.mass)} kg`;
        this.elHeldDist.textContent = `${Math.round(held.holdDistance)}u`;
      }
    }

    // 3. Ladder climb panel
    if (this.elLadderHud) {
      const lad = sub.ladder;
      this.elLadderHud.classList.toggle('visible', lad !== null);
      if (lad && this.elLadderId && this.elLadderZ && this.elLadderVz && this.elLadderBar) {
        this.elLadderId.textContent = lad.id.toUpperCase();
        this.elLadderZ.textContent = `${Math.round(lad.posZ)}u`;
        this.elLadderVz.textContent = `${Math.round(lad.velZ)} u/s`;
        this.elLadderBar.style.width = `${Math.max(0, Math.min(100, lad.progressPct))}%`;
      }
    }

    // 4. Raycast Vehicle panel
    if (this.elVehHud) {
      const drv = sub.drivingVehicle;
      this.elVehHud.classList.toggle('visible', drv !== null);
      if (drv) {
        const { vehicle, speedUnits } = drv;
        // 1 Hammer unit ~= 0.01905m -> u/s * 0.06858 ~= km/h
        if (this.elVehKmh) this.elVehKmh.textContent = String(Math.round(speedUnits * 0.06858));
        if (this.elVehHb) this.elVehHb.classList.toggle('active', vehicle.handbrake > 0.5);
        if (this.elVehThrottle) {
          this.elVehThrottle.style.width = `${Math.round(Math.abs(vehicle.throttle) * 100)}%`;
          this.elVehThrottle.style.background = vehicle.throttle >= 0 ? '#34d399' : '#fb7185';
        }
        if (this.elVehSteerPip) {
          this.elVehSteerPip.style.left = `${50 - vehicle.steer * 42}%`;
        }
        for (let i = 0; i < 4; i++) {
          const w = vehicle.wheels[i];
          const cell = this.elWheelCells[i];
          const bar = this.elWheelBars[i];
          if (!w || !cell || !bar) continue;
          cell.classList.toggle('contact', w.inContact);
          const pct = Math.max(0, Math.min(100, (w.compression / Math.max(1, w.restLength)) * 100));
          bar.style.width = `${Math.round(pct)}%`;
        }
      }
    }

    // 5. Vitals
    if (this.elVitalHp) {
      this.elVitalHp.textContent = String(sub.vitals.hp);
      this.elVitalHp.classList.toggle('low', sub.vitals.hp <= 30);
    }
    if (this.elVitalBlood) {
      this.elVitalBlood.textContent = `${sub.vitals.bloodMl} mL`;
      this.elVitalBlood.classList.toggle('low', sub.vitals.bloodMl <= 1800);
    }

    // 6. net_graph subsystem counters
    if (this.elNgBodies) this.elNgBodies.textContent = `${sub.activeBodies}/${sub.totalBodies}`;
    if (this.elNgJoints) this.elNgJoints.textContent = `${sub.intactJoints}/${sub.totalJoints}`;
    if (this.elNgWater) this.elNgWater.textContent = `${Math.round(sub.waterSubmersion * 100)}%`;
    if (this.elNgSubsys) {
      this.elNgSubsys.textContent = sub.drivingVehicle
        ? 'SUBSYS: VEHICLE'
        : sub.heldProp
          ? 'SUBSYS: GRAV-PID'
          : sub.ladder
            ? 'SUBSYS: LADDER'
            : sub.waterSubmersion > 0.05
              ? 'SUBSYS: BUOYANCY'
              : 'SUBSYS: IDLE';
    }
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

<FollowUp label="Want me to add a first-person grenade viewmodel and HUD slot 5 badge?" query="Add a first-person HE grenade viewmodel with pin-pull/throw animations to ViewmodelRig.ts and wire up the Slot 5 ammo badge in HudController.ts and CombatHudOverlay.ts."/>

//ViewmodelRig.ts
// src/render/ViewmodelRig.ts
import * as THREE from 'three';

export class ViewmodelRig {
  public readonly root = new THREE.Group();

  private readonly scoutGroup = new THREE.Group();
  private readonly uspGroup = new THREE.Group();
  private readonly knifeGroup = new THREE.Group();

  private readonly uspSuppressor: THREE.Mesh;
  private readonly scoutBoltHandle: THREE.Mesh;
  private readonly scoutFlash: THREE.Mesh;
  private readonly uspFlash: THREE.Mesh;

  private activeSlot = 1;
  private scoped = false;
  private bobPhase = 0;
  private deployTimer = 0;
  private recoilKick = 0;
  private recoilPitch = 0;
  private flashTimer = 0;
  private boltCycleTimer = 0;

  private knifeAnimTimer = 0;
  private knifeAnimDuration = 0.24;
  private knifeHeavy = false;

  private reloadTimer = 0;
  private reloadDuration = 1.1;

  constructor() {
    const gunmetal = new THREE.MeshStandardMaterial({
      color: 0x262f3d,
      roughness: 0.38,
      metalness: 0.72,
    });
    const darkPolymer = new THREE.MeshStandardMaterial({
      color: 0x181e28,
      roughness: 0.78,
      metalness: 0.14,
    });
    const oliveStock = new THREE.MeshStandardMaterial({
      color: 0x3b4838,
      roughness: 0.68,
      metalness: 0.12,
    });
    const chromeSteel = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.22,
      metalness: 0.92,
    });
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0369a1,
      emissiveIntensity: 0.45,
      roughness: 0.1,
      metalness: 0.8,
    });
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });

    // --- Slot 1: Steyr Scout .308 ---
    const scoutStock = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.085, 0.62), oliveStock);
    scoutStock.position.set(0, -0.02, 0.06);
    this.scoutGroup.add(scoutStock);

    const scoutReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.052, 0.34), gunmetal);
    scoutReceiver.position.set(0, 0.032, -0.02);
    this.scoutGroup.add(scoutReceiver);

    const scoutBarrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.018, 0.66, 12),
      gunmetal,
    );
    scoutBarrel.rotation.x = Math.PI * 0.5;
    scoutBarrel.position.set(0, 0.036, -0.45);
    this.scoutGroup.add(scoutBarrel);

    const scopeTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.32, 14),
      darkPolymer,
    );
    scopeTube.rotation.x = Math.PI * 0.5;
    scopeTube.position.set(0, 0.095, -0.04);
    this.scoutGroup.add(scopeTube);

    const scopeBell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.029, 0.023, 0.08, 14),
      darkPolymer,
    );
    scopeBell.rotation.x = Math.PI * 0.5;
    scopeBell.position.set(0, 0.095, -0.22);
    this.scoutGroup.add(scopeBell);

    const scopeLens = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.008, 14), lensMat);
    scopeLens.rotation.x = Math.PI * 0.5;
    scopeLens.position.set(0, 0.095, 0.12);
    this.scoutGroup.add(scopeLens);

    this.scoutBoltHandle = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.014, 0.016), chromeSteel);
    this.scoutBoltHandle.position.set(0.042, 0.04, 0.07);
    this.scoutGroup.add(this.scoutBoltHandle);

    this.scoutFlash = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), flashMat);
    this.scoutFlash.position.set(0, 0.036, -0.82);
    this.scoutFlash.visible = false;
    this.scoutGroup.add(this.scoutFlash);

    this.scoutGroup.position.set(0.24, -0.22, -0.42);
    this.root.add(this.scoutGroup);

    // --- Slot 2: USP .45 Tactical ---
    const uspSlide = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.046, 0.25), gunmetal);
    uspSlide.position.set(0, 0.032, -0.05);
    this.uspGroup.add(uspSlide);

    const uspFrame = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.034, 0.23), darkPolymer);
    uspFrame.position.set(0, 0.0, -0.04);
    this.uspGroup.add(uspFrame);

    const uspGrip = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.125, 0.068), darkPolymer);
    uspGrip.position.set(0, -0.068, 0.045);
    uspGrip.rotation.x = 0.22;
    this.uspGroup.add(uspGrip);

    this.uspSuppressor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.019, 0.019, 0.22, 12),
      darkPolymer,
    );
    this.uspSuppressor.rotation.x = Math.PI * 0.5;
    this.uspSuppressor.position.set(0, 0.032, -0.28);
    this.uspGroup.add(this.uspSuppressor);

    this.uspFlash = new THREE.Mesh(new THREE.OctahedronGeometry(0.052, 0), flashMat);
    this.uspFlash.position.set(0, 0.032, -0.41);
    this.uspFlash.visible = false;
    this.uspGroup.add(this.uspFlash);

    this.uspGroup.position.set(0.21, -0.19, -0.36);
    this.uspGroup.visible = false;
    this.root.add(this.uspGroup);

    // --- Slot 3: Combat Knife ---
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.15, 10), darkPolymer);
    handle.rotation.x = Math.PI * 0.35;
    handle.position.set(0, -0.04, 0.04);
    this.knifeGroup.add(handle);

    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.018, 0.022), gunmetal);
    guard.position.set(0, 0.01, -0.01);
    this.knifeGroup.add(guard);

    const bladeGeo = new THREE.BoxGeometry(0.008, 0.036, 0.25);
    const blade = new THREE.Mesh(bladeGeo, chromeSteel);
    blade.position.set(0, 0.035, -0.14);
    blade.rotation.x = -0.14;
    this.knifeGroup.add(blade);

    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 4), chromeSteel);
    tip.rotation.x = -Math.PI * 0.5 - 0.14;
    tip.rotation.z = Math.PI * 0.25;
    tip.scale.set(0.32, 1, 1);
    tip.position.set(0, 0.056, -0.29);
    this.knifeGroup.add(tip);

    this.knifeGroup.position.set(0.23, -0.2, -0.34);
    this.knifeGroup.rotation.set(0.14, 0.24, -0.18);
    this.knifeGroup.visible = false;
    this.root.add(this.knifeGroup);

    this.setActiveSlot(1);
  }

  public setActiveSlot(slot: number): void {
    this.activeSlot = slot;
    this.syncVisibility();
  }

  public setUspSilenced(silenced: boolean): void {
    this.uspSuppressor.visible = silenced;
    this.uspFlash.position.z = silenced ? -0.41 : -0.2;
  }

  public setScoped(scoped: boolean): void {
    this.scoped = scoped;
    this.syncVisibility();
  }

  private syncVisibility(): void {
    this.scoutGroup.visible = this.activeSlot === 1 && !this.scoped;
    this.uspGroup.visible = this.activeSlot === 2;
    this.knifeGroup.visible = this.activeSlot === 3;
  }

  public triggerDeploy(): void {
    this.deployTimer = 0.24;
    this.reloadTimer = 0;
  }

  public triggerFire(slot: 1 | 2, silenced = false): void {
    this.recoilKick = slot === 1 ? 0.11 : 0.048;
    this.recoilPitch = slot === 1 ? 0.22 : 0.095;
    this.flashTimer = silenced ? 0.022 : 0.048;
    if (slot === 1) {
      this.boltCycleTimer = 0.72;
    }
  }

  public triggerKnifeAttack(heavy: boolean): void {
    this.knifeHeavy = heavy;
    this.knifeAnimDuration = heavy ? 0.34 : 0.2;
    this.knifeAnimTimer = this.knifeAnimDuration;
  }

  public triggerReload(durationSec = 1.15): void {
    this.reloadDuration = durationSec;
    this.reloadTimer = durationSec;
  }

  public update(
    dt: number,
    spdXY: number,
    grounded: boolean,
    strafeA: boolean,
    strafeD: boolean,
    swayX: number,
    swayY: number,
  ): void {
    // Walk bobbing & air drift
    const moveFactor = grounded ? Math.min(1, spdXY / 260) : 0.14;
    this.bobPhase += dt * (grounded ? 8.5 : 2.6);

    const bobX = Math.cos(this.bobPhase) * 0.011 * moveFactor;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * -0.014 * moveFactor;
    const strafeRoll = (strafeA ? 0.055 : 0) + (strafeD ? -0.055 : 0);

    // Decay deploy, recoil, flash, bolt cycle, reload, and knife timers
    if (this.deployTimer > 0) this.deployTimer = Math.max(0, this.deployTimer - dt);
    this.recoilKick *= Math.pow(0.00025, dt);
    this.recoilPitch *= Math.pow(0.0004, dt);

    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      const showFlash = this.flashTimer > 0 && !this.scoped;
      this.scoutFlash.visible = showFlash && this.activeSlot === 1;
      this.uspFlash.visible = showFlash && this.activeSlot === 2;
      const s = 0.75 + Math.random() * 0.55;
      this.scoutFlash.scale.setScalar(s);
      this.uspFlash.scale.setScalar(s);
      this.scoutFlash.rotation.z = Math.random() * Math.PI;
      this.uspFlash.rotation.z = Math.random() * Math.PI;
    } else {
      this.scoutFlash.visible = false;
      this.uspFlash.visible = false;
    }

    // Scout bolt-action handle motion
    if (this.boltCycleTimer > 0) {
      this.boltCycleTimer = Math.max(0, this.boltCycleTimer - dt);
      const phase = 1 - this.boltCycleTimer / 0.72;
      const pull = phase > 0.35 && phase < 0.85 ? Math.sin(((phase - 0.35) / 0.5) * Math.PI) : 0;
      this.scoutBoltHandle.position.set(0.042 + pull * 0.018, 0.04 + pull * 0.025, 0.07 + pull * 0.08);
    } else {
      this.scoutBoltHandle.position.set(0.042, 0.04, 0.07);
    }

    // Reload dip & tilt
    let reloadDipY = 0;
    let reloadRoll = 0;
    if (this.reloadTimer > 0) {
      this.reloadTimer = Math.max(0, this.reloadTimer - dt);
      const p = 1 - this.reloadTimer / Math.max(0.01, this.reloadDuration);
      const arc = Math.sin(p * Math.PI);
      reloadDipY = -0.14 * arc;
      reloadRoll = 0.48 * arc;
    }

    // Knife slash / heavy stab swing kinematics
    let knifeOffX = 0;
    let knifeOffY = 0;
    let knifeOffZ = 0;
    let knifeRotX = 0;
    let knifeRotY = 0;
    let knifeRotZ = 0;
    if (this.knifeAnimTimer > 0 && this.activeSlot === 3) {
      this.knifeAnimTimer = Math.max(0, this.knifeAnimTimer - dt);
      const p = 1 - this.knifeAnimTimer / Math.max(0.01, this.knifeAnimDuration);
      const swing = Math.sin(p * Math.PI);
      if (this.knifeHeavy) {
        knifeOffX = -0.12 * swing;
        knifeOffY = 0.04 * swing;
        knifeOffZ = -0.26 * swing;
        knifeRotX = -0.58 * swing;
        knifeRotY = 0.25 * swing;
      } else {
        knifeOffX = -0.24 * swing;
        knifeOffY = -0.05 * swing;
        knifeOffZ = -0.11 * swing;
        knifeRotY = 0.85 * swing;
        knifeRotZ = 0.62 * swing;
      }
    }

    const deployNorm = this.deployTimer / 0.24;
    const deployDrop = deployNorm * deployNorm * -0.24;

    this.root.position.set(
      bobX + swayX + knifeOffX,
      bobY + swayY + deployDrop + reloadDipY + knifeOffY,
      this.recoilKick + knifeOffZ,
    );
    this.root.rotation.set(
      this.recoilPitch - deployNorm * 0.45 + knifeRotX,
      swayX * 1.4 + knifeRotY,
      strafeRoll + reloadRoll + knifeRotZ,
    );
  }
}

//HudController.ts
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

//CombatHudOverlay.ts
// src/ui/CombatHudOverlay.ts
import { PlayerVitalState } from '../physics/GoldSrcPhysicsEngine';
import { WeaponHudSnapshot } from '../gameplay/WeaponSystem';

export class CombatHudOverlay {
  private readonly root: HTMLDivElement;
  private readonly scopeEl: HTMLDivElement;
  private readonly hitmarkerEl: HTMLDivElement;
  private readonly pickupEl: HTMLDivElement;
  private readonly deathEl: HTMLDivElement;
  private readonly hpValueEl: HTMLSpanElement;
  private readonly hpFillEl: HTMLDivElement;
  private readonly bloodValueEl: HTMLSpanElement;
  private readonly bloodCountEl: HTMLSpanElement;
  private readonly ammoClipEl: HTMLSpanElement;
  private readonly ammoReserveEl: HTMLSpanElement;
  private readonly reloadBarWrapEl: HTMLDivElement;
  private readonly reloadBarFillEl: HTMLDivElement;
  private readonly slotEls: [HTMLDivElement, HTMLDivElement, HTMLDivElement];

  private hitmarkerTimer = 0;

  constructor() {
    this.injectStyles();

    this.root = document.createElement('div');
    this.root.id = 'combat-hud-root';
    this.root.innerHTML = `
      <div class="chud-scope hidden" id="chud-scope">
        <div class="chud-scope-h"></div>
        <div class="chud-scope-v"></div>
        <div class="chud-scope-ring"></div>
      </div>

      <div class="chud-hitmarker" id="chud-hitmarker"></div>

      <div class="chud-pickup hidden" id="chud-pickup"></div>

      <div class="chud-death hidden" id="chud-death">
        <div class="chud-death-title">YOU DIED</div>
        <div class="chud-death-sub">Press <b>R</b> or <b>Backspace</b> to Respawn</div>
      </div>

      <div class="chud-vitals">
        <div class="chud-vitals-row">
          <span class="chud-label">HP</span>
          <span class="chud-hp-val" id="chud-hp-val">100</span>
          <div class="chud-hp-bar"><div class="chud-hp-fill" id="chud-hp-fill"></div></div>
        </div>
        <div class="chud-vitals-row chud-blood-row">
          <span class="chud-label">BLOOD</span>
          <span class="chud-blood-val" id="chud-blood-val">5000 mL</span>
          <span class="chud-blood-hits" id="chud-blood-hits">LOSSES: 0</span>
        </div>
      </div>

      <div class="chud-weapons">
        <div class="chud-slots">
          <div class="chud-slot" id="chud-slot-1">1 SCOUT</div>
          <div class="chud-slot" id="chud-slot-2">2 USP .45</div>
          <div class="chud-slot" id="chud-slot-3">3 KNIFE</div>
        </div>
        <div class="chud-ammo-box">
          <span class="chud-ammo-clip" id="chud-ammo-clip">10</span>
          <span class="chud-ammo-sep">/</span>
          <span class="chud-ammo-res" id="chud-ammo-res">90</span>
        </div>
        <div class="chud-reload-wrap hidden" id="chud-reload-wrap">
          <div class="chud-reload-fill" id="chud-reload-fill"></div>
        </div>
        <div class="chud-controls-hint">LMB Fire/Slash • RMB Scope/Silencer/Stab • G Drop • E Take • R Reload</div>
      </div>
    `;

    document.body.appendChild(this.root);

    this.scopeEl = this.root.querySelector('#chud-scope')!;
    this.hitmarkerEl = this.root.querySelector('#chud-hitmarker')!;
    this.pickupEl = this.root.querySelector('#chud-pickup')!;
    this.deathEl = this.root.querySelector('#chud-death')!;
    this.hpValueEl = this.root.querySelector('#chud-hp-val')!;
    this.hpFillEl = this.root.querySelector('#chud-hp-fill')!;
    this.bloodValueEl = this.root.querySelector('#chud-blood-val')!;
    this.bloodCountEl = this.root.querySelector('#chud-blood-hits')!;
    this.ammoClipEl = this.root.querySelector('#chud-ammo-clip')!;
    this.ammoReserveEl = this.root.querySelector('#chud-ammo-res')!;
    this.reloadBarWrapEl = this.root.querySelector('#chud-reload-wrap')!;
    this.reloadBarFillEl = this.root.querySelector('#chud-reload-fill')!;
    this.slotEls = [
      this.root.querySelector('#chud-slot-1')!,
      this.root.querySelector('#chud-slot-2')!,
      this.root.querySelector('#chud-slot-3')!,
    ];
  }

  public triggerHitMarker(isBlood: boolean, isKill: boolean): void {
    this.hitmarkerTimer = isKill ? 0.28 : 0.16;
    this.hitmarkerEl.style.setProperty(
      '--hm-color',
      isKill ? '#ef4444' : isBlood ? '#fb7185' : '#fef08a',
    );
    this.hitmarkerEl.classList.add('active');
  }

  public update(dt: number, vitals: Readonly<PlayerVitalState>, weapon: WeaponHudSnapshot): void {
    // Scope overlay
    this.scopeEl.classList.toggle('hidden', weapon.scopeZoom === 0 || vitals.dead);

    // Hitmarker decay
    if (this.hitmarkerTimer > 0) {
      this.hitmarkerTimer = Math.max(0, this.hitmarkerTimer - dt);
      if (this.hitmarkerTimer === 0) {
        this.hitmarkerEl.classList.remove('active');
      }
    }

    // Pickup prompt
    if (weapon.nearbyPickupLabel && !vitals.dead) {
      this.pickupEl.textContent = weapon.nearbyPickupLabel;
      this.pickupEl.classList.remove('hidden');
    } else {
      this.pickupEl.classList.add('hidden');
    }

    // Death overlay
    this.deathEl.classList.toggle('hidden', !vitals.dead);

    // HP & Blood
    const hpPct = Math.max(0, Math.min(100, (vitals.hp / Math.max(1, vitals.maxHp)) * 100));
    this.hpValueEl.textContent = String(vitals.hp);
    this.hpFillEl.style.width = `${hpPct}%`;
    this.hpFillEl.style.background =
      hpPct > 55 ? '#22c55e' : hpPct > 25 ? '#f59e0b' : '#ef4444';

    this.bloodValueEl.textContent = `${vitals.bloodMl} mL`;
    this.bloodCountEl.textContent = `BLEED HITS: ${vitals.bloodLossCount}`;

    // Weapon slots
    const owned = [weapon.scout.owned, weapon.usp.owned, weapon.knifeOwned];
    const labels = [
      weapon.scout.owned ? '1 SCOUT' : '1 [EMPTY]',
      weapon.usp.owned ? (weapon.usp.silenced ? '2 USP-S' : '2 USP .45') : '2 [EMPTY]',
      '3 KNIFE',
    ];
    for (let i = 0; i < 3; i++) {
      const el = this.slotEls[i];
      el.textContent = labels[i];
      el.classList.toggle('active', weapon.activeSlot === i + 1);
      el.classList.toggle('missing', !owned[i]);
    }

    // Ammo readout
    if (weapon.activeSlot === 1) {
      this.ammoClipEl.textContent = String(weapon.scout.clip);
      this.ammoReserveEl.textContent = String(weapon.scout.reserve);
    } else if (weapon.activeSlot === 2) {
      this.ammoClipEl.textContent = String(weapon.usp.clip);
      this.ammoReserveEl.textContent = String(weapon.usp.reserve);
    } else {
      this.ammoClipEl.textContent = '∞';
      this.ammoReserveEl.textContent = 'MELEE';
    }

    // Reload bar
    this.reloadBarWrapEl.classList.toggle('hidden', !weapon.reloading);
    if (weapon.reloading) {
      this.reloadBarFillEl.style.width = `${Math.round(weapon.reloadProgress * 100)}%`;
    }
  }

  private injectStyles(): void {
    if (document.getElementById('combat-hud-styles')) return;
    const style = document.createElement('style');
    style.id = 'combat-hud-styles';
    style.textContent = `
      #combat-hud-root {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 25;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        color: #f8fafc;
      }
      #combat-hud-root .hidden { display: none !important; }

      .chud-scope {
        position: fixed;
        inset: 0;
        background: radial-gradient(circle at center, transparent 34%, rgba(2,6,23,0.96) 36%);
      }
      .chud-scope-h {
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        height: 1.5px;
        background: rgba(15, 23, 42, 0.92);
      }
      .chud-scope-v {
        position: absolute;
        left: 50%;
        top: 0;
        bottom: 0;
        width: 1.5px;
        background: rgba(15, 23, 42, 0.92);
      }
      .chud-scope-ring {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 10px;
        height: 10px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        border: 1.5px solid #ef4444;
      }

      .chud-hitmarker {
        position: fixed;
        left: 50%;
        top: 50%;
        width: 22px;
        height: 22px;
        transform: translate(-50%, -50%) rotate(45deg);
        opacity: 0;
        transition: opacity 0.08s ease;
        --hm-color: #fef08a;
      }
      .chud-hitmarker.active { opacity: 1; }
      .chud-hitmarker::before,
      .chud-hitmarker::after {
        content: '';
        position: absolute;
        background: var(--hm-color);
      }
      .chud-hitmarker::before { left: 10px; top: 0; width: 2px; height: 22px; }
      .chud-hitmarker::after { top: 10px; left: 0; height: 2px; width: 22px; }

      .chud-pickup {
        position: fixed;
        left: 50%;
        bottom: 148px;
        transform: translateX(-50%);
        padding: 6px 14px;
        border-radius: 6px;
        background: rgba(15, 23, 42, 0.85);
        border: 1px solid rgba(56, 189, 248, 0.65);
        color: #e0f2fe;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
      }

      .chud-death {
        position: fixed;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(127, 29, 29, 0.42);
        backdrop-filter: blur(2px);
      }
      .chud-death-title {
        font-size: 44px;
        font-weight: 900;
        letter-spacing: 0.18em;
        color: #fecaca;
        text-shadow: 0 2px 18px rgba(0, 0, 0, 0.85);
      }
      .chud-death-sub {
        margin-top: 10px;
        font-size: 14px;
        color: #fef2f2;
      }

      .chud-vitals {
        position: fixed;
        left: 20px;
        bottom: 20px;
        background: rgba(9, 13, 21, 0.78);
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 8px;
        padding: 10px 14px;
        min-width: 240px;
      }
      .chud-vitals-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .chud-blood-row {
        margin-top: 6px;
        font-size: 11px;
        color: #fca5a5;
      }
      .chud-label {
        font-size: 11px;
        font-weight: 800;
        color: #94a3b8;
        width: 44px;
      }
      .chud-hp-val {
        font-size: 20px;
        font-weight: 900;
        min-width: 38px;
        color: #f8fafc;
      }
      .chud-hp-bar {
        flex: 1;
        height: 8px;
        background: rgba(30, 41, 59, 0.9);
        border-radius: 4px;
        overflow: hidden;
      }
      .chud-hp-fill {
        height: 100%;
        width: 100%;
        background: #22c55e;
        transition: width 0.12s ease;
      }
      .chud-blood-val { font-weight: 800; color: #f87171; }
      .chud-blood-hits { margin-left: auto; color: #fda4af; }

      .chud-weapons {
        position: fixed;
        right: 20px;
        bottom: 20px;
        background: rgba(9, 13, 21, 0.78);
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 8px;
        padding: 10px 14px;
        text-align: right;
      }
      .chud-slots {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
        margin-bottom: 6px;
      }
      .chud-slot {
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 4px;
        background: rgba(30, 41, 59, 0.75);
        color: #94a3b8;
        border: 1px solid transparent;
      }
      .chud-slot.active {
        background: rgba(249, 115, 22, 0.22);
        color: #fdba74;
        border-color: rgba(249, 115, 22, 0.75);
      }
      .chud-slot.missing { opacity: 0.35; }

      .chud-ammo-box {
        display: flex;
        align-items: baseline;
        justify-content: flex-end;
        gap: 6px;
      }
      .chud-ammo-clip { font-size: 26px; font-weight: 900; color: #f8fafc; }
      .chud-ammo-sep { font-size: 16px; color: #64748b; }
      .chud-ammo-res { font-size: 15px; font-weight: 700; color: #cbd5e1; }

      .chud-reload-wrap {
        margin-top: 6px;
        height: 4px;
        background: rgba(30, 41, 59, 0.9);
        border-radius: 2px;
        overflow: hidden;
      }
      .chud-reload-fill {
        height: 100%;
        width: 0%;
        background: #38bdf8;
      }
      .chud-controls-hint {
        margin-top: 6px;
        font-size: 10px;
        color: #94a3b8;
      }
    `;
    document.head.appendChild(style);
  }
}

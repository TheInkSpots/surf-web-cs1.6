Support Shooting & Knife Attacks ; and Weapon system - players can press G drop the guns / take guns from the ground ; and life health blood count ; and shoot / attack with object collision ; 
output completed files of code; 

// In previous AI LLM you have already wrote these files:
SurfAudioEngine.ts  , InputController.ts , GoldSrcPhysicsEngine.ts , ViewModelRig.ts , WorldRenderer.ts

// you only need to give me the following file ... or other missing files ... etc..
SurfApp.ts
surfSandbox02.ts

client:
surf-sandbox/
├── index.html
├── package.json
├── tsconfig.json
└── src/
    ├── main.ts
    ├── styles/
    │   └── sandbox.css
    ├── core/
    │   ├── constants.ts          # 100Hz tickrate, hulls, flags, buttons, state enums
    │   ├── memoryAbi.ts          # Float32/Int32 views over WebAssembly.Memory & CVars
    │   └── coordinates.ts        # GoldSrc (Z-up) <-> Three.js (Y-up) conversions
    ├── physics/
    │   ├── BrushBuilder.ts       # Convex brush plane generation, boxes & surf ramps
    │   └── GoldSrcPhysicsEngine.ts # Swept AABB trace, PM_FlyMove, PM_AirAccelerate, triggers
    ├── maps/
    │   └── surfSandbox01.ts      # Ramps, boosters, 30°–60° calibration wedges, 48u tunnel
    ├── audio/
    │   └── SurfAudioEngine.ts    # Web Audio velocity wind, surf hum, jump/land/boost SFX
    ├── render/
    │   ├── textures.ts           # Procedural CanvasTexture dev-grid & hazard textures
    │   ├── ViewmodelRig.ts       # Scout, USP .45, and Knife viewmodels with sway & bob
    │   └── WorldRenderer.ts      # Two-pass Three.js renderer, sky dome, debug wireframes
    ├── gameplay/
    │   ├── InputController.ts    # Pointer lock, raw mouse look, WASD, scroll jump, hotkeys
    │   ├── RunTracker.ts         # Timer state machine, delta tracking, localStorage Top 3
    │   └── StrafeSyncTracker.ts  # Ring-buffer strafe sync & yaw efficiency calculator
    ├── ui/
    │   ├── HudController.ts      # Speedometer, timer, keycaps, strafe bar, net_graph
    │   └── MenuController.ts     # Presets, CVar sliders, toggles, restart/play actions
    └── app/
        └── SurfApp.ts            # Fixed 100Hz accumulator loop & subsystem wiring
        
---

code:

//SurfApp.ts , 

// src/app/SurfApp.ts
import {
  f32,
  FIXED_DT,
  FL_DUCKING,
  FL_ONGROUND,
  IN_DUCK,
  IN_JUMP,
  MoveState,
} from '../core/constants';
import { F32, I32, PhysicsMemoryAbi } from '../core/memoryAbi';
import {
  CheckpointState,
  createBoxRigidBody,
  GoldSrcPhysicsEngine,
  SourceRigidBody,
} from '../physics/GoldSrcPhysicsEngine';
import { buildSurfSandbox01 } from '../maps/surfSandbox01';
import { SurfAudioEngine } from '../audio/SurfAudioEngine';
import { WorldRenderer } from '../render/WorldRenderer';
import { ViewmodelRig } from '../render/ViewmodelRig';
import { InputController } from '../gameplay/InputController';
import { RunTracker } from '../gameplay/RunTracker';
import { StrafeSyncTracker } from '../gameplay/StrafeSyncTracker';
import { HudController } from '../ui/HudController';
import { MenuController } from '../ui/MenuController';

export class SurfApp {
  private readonly abi = new PhysicsMemoryAbi(2);
  private readonly audio = new SurfAudioEngine();
  private readonly runTracker = new RunTracker();
  private readonly strafeSync = new StrafeSyncTracker(140);
  private readonly createInitialRigidBodies: () => SourceRigidBody[];
  private readonly physics: GoldSrcPhysicsEngine;
  private readonly renderer: WorldRenderer;
  private readonly viewmodel: ViewmodelRig;
  private readonly input: InputController;
  private readonly hud: HudController;
  private readonly menu: MenuController;

  private activeCheckpoint: CheckpointState | null = null;
  private customCheckpoint: CheckpointState | null = null;
  private readonly visitedCheckpoints = new Set<number>();

  private spawnedPropCount = 0;
  private lastFrameTime = performance.now();
  private accumulator = 0;
  private simMsAvg = 0.08;
  private idleClock = 0;

  constructor(canvas: HTMLCanvasElement) {
    const mapData = buildSurfSandbox01();
    this.createInitialRigidBodies = mapData.createRigidBodies;

    this.hud = new HudController(this.runTracker);
    this.viewmodel = new ViewmodelRig();
    this.renderer = new WorldRenderer(
      canvas,
      mapData.brushes,
      mapData.triggers,
      mapData.signs,
      this.viewmodel.root,
    );

    this.physics = new GoldSrcPhysicsEngine(
      this.abi,
      mapData.brushes,
      mapData.triggers,
      mapData.spawn,
      {
        onLand: (impact) => this.audio.playLand(impact),
        onJump: () => this.audio.playJump(),
        onBoost: () => {
          this.audio.playBoost();
          this.hud.flashScreen('rgba(34, 211, 238, 0.35)');
        },
        onExplosion: (_triggerId, origin, radius) => {
          this.audio.playBoost();
          this.audio.playLand(620);
          this.renderer.spawnExplosionEffect(origin, radius);
          this.hud.flashScreen('rgba(249, 115, 22, 0.42)');
        },
        onRigidBodyHit: (_bodyId, impulseMag) => {
          if (impulseMag > 2400) {
            this.audio.playLand(Math.min(500, impulseMag * 0.06));
          }
        },
        onCheckpoint: (cp) => {
          if (this.visitedCheckpoints.has(cp.index)) return;
          this.visitedCheckpoints.add(cp.index);
          this.activeCheckpoint = cp;

          const split = this.runTracker.recordCheckpoint(cp.index, cp.label, this.abi.i32[I32.TICK]);

          const deltaStr =
            split.deltaSec !== null ? `  [${RunTracker.formatDelta(split.deltaSec)}]` : '';
          const goldStr = split.isNewBestSegment ? ' ★ GOLD SEG!' : '';
          const toastColor =
            split.deltaSec !== null && split.deltaSec <= 0
              ? 'rgba(52, 211, 153, 0.8)'
              : 'rgba(168, 85, 247, 0.8)';

          this.audio.playStartBeep();
          this.hud.flashScreen('rgba(168, 85, 247, 0.25)');
          this.hud.showToast(
            `${cp.label}  •  ${RunTracker.formatTime(split.elapsedSec)}${deltaStr}${goldStr}  (Checkpoint Saved)`,
            toastColor,
          );
        },
        onTeleport: (isFail) => {
          if (isFail) {
            this.audio.playTeleport();
            this.hud.flashScreen('rgba(251, 113, 133, 0.42)');

            // Automatically respawn at the last reached stage checkpoint if available
            if (this.activeCheckpoint) {
              this.runTracker.invalidateRankedRun();
              this.physics.teleportToCheckpoint(this.activeCheckpoint);
              this.input.resetView(this.activeCheckpoint.yaw, this.activeCheckpoint.pitch);
              this.hud.showToast(
                `FAIL ZONE — RESPAWNED AT ${this.activeCheckpoint.label}  (R: Full Reset)`,
                'rgba(168, 85, 247, 0.8)',
              );
              return;
            }

            this.runTracker.reset();
            this.input.resetView(mapData.spawn.yaw, mapData.spawn.pitch);
            this.hud.showToast('FAIL ZONE — TELEPORTED TO SPAWN', 'rgba(251,113,133,0.65)');
          } else {
            this.runTracker.reset();
          }
        },
        onStartRun: () => {
          if (this.runTracker.state !== 'RUNNING') {
            this.visitedCheckpoints.clear();
            this.activeCheckpoint = null;
            this.runTracker.start(this.abi.i32[I32.TICK]);
            this.audio.playStartBeep();
            this.hud.showToast('RUN STARTED — GO!', 'rgba(52,211,153,0.6)');
          }
        },
        onFinishRun: () => {
          const result = this.runTracker.finish(this.abi.i32[I32.TICK]);
          if (!result) return;
          this.audio.playFinishChime();
          this.hud.flashScreen('rgba(16, 185, 129, 0.42)');

          const deltaStr =
            result.deltaSec !== null ? `  [${RunTracker.formatDelta(result.deltaSec)}]` : '';
          const pbNote = result.isNewPb
            ? ' ★ NEW PERSONAL BEST!'
            : !result.isRanked
              ? ' (CHECKPOINT RUN)'
              : '';
          this.hud.showToast(
            `FINISHED IN ${RunTracker.formatTime(result.finishSec)}${deltaStr}${pbNote}  (Press R for Full Run)`,
            'rgba(16,185,129,0.75)',
          );
        },
      },
      this.createInitialRigidBodies(),
    );

    this.input = new InputController(canvas, mapData.spawn, {
      onUnlockRequest: () => this.audio.unlock(),
      onSelectWeapon: (slot) => this.selectWeapon(slot),
      onResetRun: () => {
        this.activeCheckpoint = null;
        this.visitedCheckpoints.clear();
        this.physics.teleportToSpawn(false);
        this.input.resetView(mapData.spawn.yaw, mapData.spawn.pitch);
        this.hud.showToast('FULL RUN RESET', 'rgba(245,158,11,0.6)');
      },
      onToggleDebug: () => {
        const next = !this.renderer.debugGroup.visible;
        this.renderer.setDebugVisible(next);
        this.menu.setDebugChecked(next);
        this.hud.showToast(
          next ? 'MAPPER DEBUG WIREFRAMES: ON' : 'MAPPER DEBUG WIREFRAMES: OFF',
          'rgba(245,158,11,0.65)',
        );
      },
    });

    this.menu = new MenuController(this.abi, {
      onPlay: () => this.input.requestLock(),
      onRestart: () => {
        this.activeCheckpoint = null;
        this.visitedCheckpoints.clear();
        this.physics.teleportToSpawn(false);
        this.input.resetView(mapData.spawn.yaw, mapData.spawn.pitch);
        this.input.requestLock();
      },
      onSensitivityChange: (sens) => { this.input.sensitivity = sens; },
      onBaseFovChange: (fov) => { this.renderer.baseFov = fov; },
      onScout260Change: (enabled) => this.hud.setScoutSpeedLabel(enabled),
      onStrafeHudChange: (visible) => this.hud.setStrafeHudVisible(visible),
      onDebugChange: (enabled) => {
        this.renderer.setDebugVisible(enabled);
        this.hud.showToast(
          enabled ? 'MAPPER DEBUG WIREFRAMES: ON' : 'MAPPER DEBUG WIREFRAMES: OFF',
          'rgba(245,158,11,0.65)',
        );
      },
      onMuteChange: (muted) => this.audio.setMuted(muted),
    });

    window.addEventListener('keydown', this.handleSandboxHotkey);

    this.physics.teleportToSpawn(false);
    this.menu.syncAll();
  }

  /**
   * Live Sandbox Hotkeys (while pointer-locked):
   *   B = Manual respawn at active stage checkpoint (Stages 2–4)
   *   C = Save custom practice checkpoint
   *   V = Load custom practice checkpoint (preserves velocity)
   *   G = Spawn VPhysics crate ahead
   *   F = Detonate radial blast ahead
   *   X = Reset VPhysics props
   */
  private handleSandboxHotkey = (e: KeyboardEvent): void => {
    if (!this.input.isPointerLocked || e.repeat) return;

    if (e.code === 'KeyB') {
      if (!this.activeCheckpoint) {
        this.hud.showToast('NO STAGE CHECKPOINT REACHED YET', 'rgba(148,163,184,0.6)');
        return;
      }
      this.runTracker.invalidateRankedRun();
      this.physics.teleportToCheckpoint(this.activeCheckpoint);
      this.input.resetView(this.activeCheckpoint.yaw, this.activeCheckpoint.pitch);
      this.audio.playTeleport();
      this.hud.flashScreen('rgba(168, 85, 247, 0.32)');
      this.hud.showToast(`RESPAWNED AT ${this.activeCheckpoint.label} (Unranked)`, 'rgba(168,85,247,0.75)');
    } else if (e.code === 'KeyC') {
      this.customCheckpoint = this.physics.captureCheckpointState(99, 'PRACTICE SAVE');
      this.audio.playStartBeep();
      this.hud.showToast('PRACTICE CHECKPOINT SAVED (Press V to Load)', 'rgba(56,189,248,0.7)');
    } else if (e.code === 'KeyV') {
      if (!this.customCheckpoint) {
        this.hud.showToast('NO PRACTICE SAVE (Press C First)', 'rgba(148,163,184,0.6)');
        return;
      }
      this.runTracker.invalidateRankedRun();
      this.physics.teleportToCheckpoint(this.customCheckpoint);
      this.input.resetView(this.customCheckpoint.yaw, this.customCheckpoint.pitch);
      this.audio.playTeleport();
      this.hud.showToast('LOADED PRACTICE CHECKPOINT (Unranked)', 'rgba(56,189,248,0.7)');
    } else if (e.code === 'KeyG') {
      this.spawnCrateAhead();
    } else if (e.code === 'KeyF') {
      this.detonateBlastAhead();
    } else if (e.code === 'KeyX') {
      this.physics.setRigidBodies(this.createInitialRigidBodies());
      this.hud.showToast('VPHYSICS PROPS RESET', 'rgba(251,191,36,0.65)');
    }
  };

  private spawnCrateAhead(): void {
    const vf = this.abi.f32;
    const yaw = this.input.viewYaw;
    const pitch = this.input.viewPitch;
    const cosP = Math.cos(pitch);
    const dirX = cosP * Math.cos(yaw);
    const dirY = cosP * Math.sin(yaw);
    const dirZ = Math.sin(pitch);

    const spawnPos = {
      x: vf[F32.POS_X] + dirX * 96,
      y: vf[F32.POS_Y] + dirY * 96,
      z: vf[F32.POS_Z] + vf[F32.VIEW_OFS_Z] + dirZ * 96,
    };

    const throwSpeed = 420;
    const crate = createBoxRigidBody(
      `spawned_crate_${++this.spawnedPropCount}`,
      spawnPos,
      { x: 22, y: 22, z: 22 },
      34,
      {
        vel: {
          x: vf[F32.VEL_X] + dirX * throwSpeed,
          y: vf[F32.VEL_Y] + dirY * throwSpeed,
          z: vf[F32.VEL_Z] + dirZ * throwSpeed + 90,
        },
        restitution: 0.42,
      },
    );

    this.physics.addRigidBody(crate);
    this.audio.playWeaponSwitch();
  }

  private detonateBlastAhead(): void {
    const vf = this.abi.f32;
    const yaw = this.input.viewYaw;
    const pitch = this.input.viewPitch;
    const cosP = Math.cos(pitch);
    const dirX = cosP * Math.cos(yaw);
    const dirY = cosP * Math.sin(yaw);
    const dirZ = Math.sin(pitch);

    const origin = {
      x: vf[F32.POS_X] + dirX * 120,
      y: vf[F32.POS_Y] + dirY * 120,
      z: vf[F32.POS_Z] + vf[F32.VIEW_OFS_Z] + dirZ * 120,
    };

    this.physics.applyExplosionImpulse(origin, 72000, 620, 1.25, 'hotkey_blast');
  }

  private getActiveWeaponSpeed(): number {
    const { i32: vi } = this.abi;
    if (vi[I32.WEAPON] === 1 && vi[I32.LEGACY_SCOUT] === 1) return f32(260.0);
    return f32(250.0);
  }

  private selectWeapon(slot: number): void {
    const { i32: vi } = this.abi;
    if (slot < 1 || slot > 3 || vi[I32.WEAPON] === slot) return;
    vi[I32.WEAPON] = slot;
    this.viewmodel.triggerDeploy();
    this.viewmodel.setActiveSlot(slot);
    this.hud.setActiveWeaponSlot(slot);
    this.audio.playWeaponSwitch();
  }

  private stepPhysicsTick(): void {
    const { f32: vf, i32: vi } = this.abi;
    const keys = this.input.keys;
    const maxSpd = this.getActiveWeaponSpeed();

    let fmove = 0;
    let smove = 0;
    if (keys.w) fmove += maxSpd;
    if (keys.s) fmove -= maxSpd;
    if (keys.d) smove += maxSpd;
    if (keys.a) smove -= maxSpd;

    let buttons = 0;
    if (keys.jump || this.input.consumeScrollJump()) buttons |= IN_JUMP;
    if (keys.duck) buttons |= IN_DUCK;

    vf[F32.CMD_FMOVE] = f32(fmove);
    vf[F32.CMD_SMOVE] = f32(smove);
    vf[F32.CMD_YAW] = f32(this.input.viewYaw);
    vf[F32.CMD_PITCH] = f32(this.input.viewPitch);
    vf[F32.CMD_MAXSPEED] = maxSpd;
    vi[I32.BUTTONS] = buttons;

    const preXY = Math.hypot(vf[F32.VEL_X], vf[F32.VEL_Y]);
    const t0 = performance.now();
    this.physics.simulateTick();
    const dtSim = performance.now() - t0;
    this.simMsAvg = this.simMsAvg * 0.92 + dtSim * 0.08;

    const postXY = Math.hypot(vf[F32.VEL_X], vf[F32.VEL_Y]);
    const airborne = (vi[I32.FLAGS] & FL_ONGROUND) === 0;
    const yawDelta = this.input.consumeTickYawDelta();
    this.strafeSync.recordTick(airborne, keys.a, keys.d, yawDelta, preXY, postXY);
    this.runTracker.tick(vi[I32.TICK]);
  }

  public start(): void {
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);

    const frameDt = Math.min(0.05, (now - this.lastFrameTime) * 0.001);
    this.lastFrameTime = now;
    this.idleClock += frameDt;

    const locked = this.input.isPointerLocked;
    if (locked) {
      this.accumulator += frameDt;
      let substeps = 0;
      while (this.accumulator >= FIXED_DT && substeps < 6) {
        this.stepPhysicsTick();
        this.accumulator -= FIXED_DT;
        substeps++;
      }
      if (substeps === 6) this.accumulator = 0;
    } else {
      this.accumulator = 0;
    }

    const alpha = locked ? this.accumulator / FIXED_DT : 1.0;
    const { f32: vf, i32: vi } = this.abi;

    const rx = vf[F32.PREV_X] + (vf[F32.POS_X] - vf[F32.PREV_X]) * alpha;
    const ry = vf[F32.PREV_Y] + (vf[F32.POS_Y] - vf[F32.PREV_Y]) * alpha;
    const rz = vf[F32.PREV_Z] + (vf[F32.POS_Z] - vf[F32.PREV_Z]) * alpha;
    const rEye = vf[F32.PREV_VIEW_OFS_Z] + (vf[F32.VIEW_OFS_Z] - vf[F32.PREV_VIEW_OFS_Z]) * alpha;

    const renderYaw = locked ? this.input.viewYaw : this.input.viewYaw + Math.sin(this.idleClock * 0.45) * 0.08;
    const renderPitch = locked ? this.input.viewPitch : this.input.viewPitch + Math.cos(this.idleClock * 0.35) * 0.025;

    const spdXY = Math.hypot(vf[F32.VEL_X], vf[F32.VEL_Y]);
    const spd3D = Math.hypot(vf[F32.VEL_X], vf[F32.VEL_Y], vf[F32.VEL_Z]);
    const grounded = (vi[I32.FLAGS] & FL_ONGROUND) !== 0;
    const ducking = (vi[I32.FLAGS] & FL_DUCKING) !== 0;

    this.input.decayVisuals(frameDt);
    this.viewmodel.update(
      frameDt,
      spdXY,
      grounded,
      this.input.keys.a,
      this.input.keys.d,
      this.input.vmSwayX,
      this.input.vmSwayY,
    );
    this.renderer.update(frameDt, rx, ry, rz + rEye, renderYaw, renderPitch, spdXY);
    this.audio.updateContinuous(spd3D, vi[I32.MOVESTATE] === MoveState.SURF, !locked);

    this.hud.update({
      now,
      spdXY,
      spd3D,
      velZ: vf[F32.VEL_Z],
      simMsAvg: this.simMsAvg,
      syncPct: this.strafeSync.getSyncPercent(),
      smoothYawVisual: this.input.smoothYawVisual,
      moveState: vi[I32.MOVESTATE],
      ducking,
      keys: this.input.keys,
      cvarLabel: `aa:${Math.round(vf[F32.CVAR_AIRACCEL])} mv:${Math.round(vf[F32.CVAR_MAXVEL])}`,
    });

    this.renderer.syncRigidBodies(this.physics.getRigidBodies());
    this.renderer.render();
  };
}


//SurfAudioEngine.ts  , 

// src/audio/SurfAudioEngine.ts
import { computeAngleVectors, RigidBodyKind, Vec3 } from '../physics/GoldSrcPhysicsEngine';

/** 1 Hammer unit = 0.01905 meters -> Speed of sound 343 m/s ≈ 18005.25 Hammer u/s */
const HAMMER_TO_METERS = 0.01905;
const SPEED_OF_SOUND_HU = 343 / HAMMER_TO_METERS;

export interface ListenerKinematics {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  /** Camera pitch (+up); converted internally to Source pitch (+down) */
  pitch: number;
}

interface SpatialCue {
  gain: number;
  pan: number;
  dopplerRatio: number;
  lowpassHz: number;
}

export class SurfAudioEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private ready = false;
  private noiseBuf: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private slideGain: GainNode | null = null;
  private slideFilter: BiquadFilterNode | null = null;

  private listener: ListenerKinematics = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
  };

  public unlock(): void {
    if (this.ready) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();

      const len = this.ctx.sampleRate * 2;
      const noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuf = noiseBuf;

      // Velocity-reactive aerodynamic wind rush
      const windSrc = this.ctx.createBufferSource();
      windSrc.buffer = noiseBuf;
      windSrc.loop = true;
      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 320;
      this.windFilter.Q.value = 1.3;
      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0;
      windSrc.connect(this.windFilter).connect(this.windGain).connect(this.ctx.destination);
      windSrc.start();

      // Continuous surf-ramp slide hum (active during MoveState.SURF, n_z < 0.7)
      const slideSrc = this.ctx.createBufferSource();
      slideSrc.buffer = noiseBuf;
      slideSrc.loop = true;
      this.slideFilter = this.ctx.createBiquadFilter();
      this.slideFilter.type = 'bandpass';
      this.slideFilter.frequency.value = 220;
      this.slideFilter.Q.value = 4.5;
      this.slideGain = this.ctx.createGain();
      this.slideGain.gain.value = 0;
      slideSrc.connect(this.slideFilter).connect(this.slideGain).connect(this.ctx.destination);
      slideSrc.start();

      this.ready = true;
    } catch (err) {
      console.warn('Web Audio initialization skipped:', err);
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted && this.ready && this.ctx && this.windGain && this.slideGain) {
      const t = this.ctx.currentTime;
      this.windGain.gain.setTargetAtTime(0, t, 0.04);
      this.slideGain.gain.setTargetAtTime(0, t, 0.04);
    }
  }

  public updateListener(kinematics: ListenerKinematics): void {
    this.listener = kinematics;
  }

  private computeSpatialCue(
    sourcePos?: Vec3,
    sourceVel: Vec3 = { x: 0, y: 0, z: 0 },
    refDistHu = 240,
  ): SpatialCue {
    if (!sourcePos) {
      return { gain: 1, pan: 0, dopplerRatio: 1, lowpassHz: 18000 };
    }

    const dx = sourcePos.x - this.listener.pos.x;
    const dy = sourcePos.y - this.listener.pos.y;
    const dz = sourcePos.z - this.listener.pos.z;
    const distHu = Math.hypot(dx, dy, dz);
    if (distHu < 8) {
      return { gain: 1, pan: 0, dopplerRatio: 1, lowpassHz: 18000 };
    }

    const dirX = dx / distHu;
    const dirY = dy / distHu;
    const dirZ = dz / distHu;

    const { right } = computeAngleVectors(-this.listener.pitch, this.listener.yaw, 0);
    const pan = Math.max(-1, Math.min(1, dirX * right.x + dirY * right.y + dirZ * right.z));

    const distM = distHu * HAMMER_TO_METERS;
    const refM = Math.max(1.5, refDistHu * HAMMER_TO_METERS);
    const gain = Math.max(0.03, Math.min(1, 1 / (1 + Math.pow(distM / refM, 1.35))));

    const vListenerAlong =
      this.listener.vel.x * dirX + this.listener.vel.y * dirY + this.listener.vel.z * dirZ;
    const vSourceAlong = sourceVel.x * dirX + sourceVel.y * dirY + sourceVel.z * dirZ;
    const rawDoppler =
      (SPEED_OF_SOUND_HU + vListenerAlong) / Math.max(2000, SPEED_OF_SOUND_HU + vSourceAlong);
    const dopplerRatio = Math.max(0.72, Math.min(1.38, rawDoppler));
    const lowpassHz = Math.max(1400, 18000 * Math.exp(-distM * 0.022));

    return { gain, pan, dopplerRatio, lowpassHz };
  }

  private createSpatialOut(cue: SpatialCue): AudioNode {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cue.lowpassHz;

    const gain = ctx.createGain();
    gain.gain.value = cue.gain;

    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = cue.pan;
      lp.connect(gain).connect(panner).connect(ctx.destination);
    } else {
      lp.connect(gain).connect(ctx.destination);
    }
    return lp;
  }

  public updateContinuous(
    speed3D: number,
    isSurfing: boolean,
    isPaused: boolean,
    surfNormalZ = 0,
  ): void {
    if (
      !this.ready ||
      !this.ctx ||
      !this.windGain ||
      !this.windFilter ||
      !this.slideGain ||
      !this.slideFilter
    ) {
      return;
    }

    const t = this.ctx.currentTime;
    if (this.muted || isPaused) {
      this.windGain.gain.setTargetAtTime(0, t, 0.05);
      this.slideGain.gain.setTargetAtTime(0, t, 0.05);
      return;
    }

    const windNorm = Math.max(0, Math.min(1, (speed3D - 450) / 3050));
    this.windGain.gain.setTargetAtTime(windNorm * windNorm * 0.2, t, 0.06);
    this.windFilter.frequency.setTargetAtTime(260 + windNorm * 1550, t, 0.06);

    const slopeFactor = isSurfing ? Math.max(0.4, 1.15 - surfNormalZ) : 0;
    const slideTarget = isSurfing ? Math.min(0.13, (0.025 + windNorm * 0.095) * slopeFactor) : 0;
    this.slideGain.gain.setTargetAtTime(slideTarget, t, 0.04);
    this.slideFilter.frequency.setTargetAtTime(160 + windNorm * 460 * slopeFactor, t, 0.05);
  }

  public playLand(impactSpeed: number): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const intensity = Math.min(1, Math.max(0.18, impactSpeed / 650));

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(105 + intensity * 25, t);
    osc.frequency.exponentialRampToValueAtTime(36, t + 0.095);
    gain.gain.setValueAtTime(0.24 * intensity, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.115);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.125);
  }

  public playJump(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(215, t + 0.055);
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.07);
  }

  public playBoost(): void {
    if (!this.ready || this.muted || !this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.2;
    filter.frequency.setValueAtTime(280, t);
    filter.frequency.exponentialRampToValueAtTime(2400, t + 0.28);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + 0.36);

    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(760, t + 0.24);
    og.gain.setValueAtTime(0.11, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(og).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  public playExplosion(origin: Vec3, radius: number): void {
    if (!this.ready || this.muted || !this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const cue = this.computeSpatialCue(origin, { x: 0, y: 0, z: 0 }, Math.max(360, radius * 0.65));
    const out = this.createSpatialOut(cue);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(950 * cue.dopplerRatio, t);
    lp.frequency.exponentialRampToValueAtTime(95, t + 0.55);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.45, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.62);
    src.connect(lp).connect(ng).connect(out);
    src.start(t);
    src.stop(t + 0.65);

    const sub = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(118 * cue.dopplerRatio, t);
    sub.frequency.exponentialRampToValueAtTime(26, t + 0.42);
    sg.gain.setValueAtTime(0.42, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
    sub.connect(sg).connect(out);
    sub.start(t);
    sub.stop(t + 0.5);
  }

  public playScoutShot(): void {
    if (!this.ready || this.muted || !this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1450, t);
    bp.frequency.exponentialRampToValueAtTime(260, t + 0.24);
    bp.Q.value = 0.85;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.42, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    noise.connect(bp).connect(ng).connect(this.ctx.destination);
    noise.start(t);
    noise.stop(t + 0.3);

    const body = this.ctx.createOscillator();
    const bg = this.ctx.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(195, t);
    body.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    bg.gain.setValueAtTime(0.32, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    body.connect(bg).connect(this.ctx.destination);
    body.start(t);
    body.stop(t + 0.17);

    const boltTimes = [0.34, 0.46, 0.58];
    const boltFreqs = [920, 640, 1180];
    boltTimes.forEach((offset, idx) => {
      if (!this.ctx) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(boltFreqs[idx], t + offset);
      o.frequency.exponentialRampToValueAtTime(boltFreqs[idx] * 0.55, t + offset + 0.035);
      g.gain.setValueAtTime(0.038, t + offset);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.04);
      o.connect(g).connect(this.ctx.destination);
      o.start(t + offset);
      o.stop(t + offset + 0.045);
    });
  }

  public playUspShot(silenced: boolean): void {
    if (!this.ready || this.muted || !this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = silenced ? 'bandpass' : 'lowpass';
    filter.frequency.setValueAtTime(silenced ? 2600 : 3400, t);
    filter.frequency.exponentialRampToValueAtTime(silenced ? 750 : 420, t + (silenced ? 0.065 : 0.13));
    filter.Q.value = silenced ? 2.4 : 0.9;

    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(silenced ? 0.19 : 0.34, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + (silenced ? 0.075 : 0.15));
    noise.connect(filter).connect(ng).connect(this.ctx.destination);
    noise.start(t);
    noise.stop(t + (silenced ? 0.085 : 0.16));

    const slide = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    slide.type = silenced ? 'sine' : 'sawtooth';
    slide.frequency.setValueAtTime(silenced ? 360 : 250, t);
    slide.frequency.exponentialRampToValueAtTime(silenced ? 115 : 58, t + 0.055);
    sg.gain.setValueAtTime(silenced ? 0.11 : 0.22, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
    slide.connect(sg).connect(this.ctx.destination);
    slide.start(t);
    slide.stop(t + 0.07);
  }

  public playSilencerToggle(attaching: boolean): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const steps = attaching ? [320, 480, 680] : [680, 480, 320];
    steps.forEach((f, idx) => {
      if (!this.ctx) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      const st = t + idx * 0.08;
      o.frequency.setValueAtTime(f, st);
      o.frequency.exponentialRampToValueAtTime(f * 0.82, st + 0.055);
      g.gain.setValueAtTime(0.06, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.065);
      o.connect(g).connect(this.ctx.destination);
      o.start(st);
      o.stop(st + 0.07);
    });
  }

  public playKnifeSwing(heavy: boolean): void {
    if (!this.ready || this.muted || !this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const dur = heavy ? 0.19 : 0.12;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3.2;
    bp.frequency.setValueAtTime(heavy ? 620 : 1200, t);
    bp.frequency.exponentialRampToValueAtTime(heavy ? 2100 : 2800, t + dur * 0.45);
    bp.frequency.exponentialRampToValueAtTime(380, t + dur);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(heavy ? 0.21 : 0.14, t + dur * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noise.connect(bp).connect(gain).connect(this.ctx.destination);
    noise.start(t);
    noise.stop(t + dur + 0.02);
  }

  public playImpact(
    pos: Vec3,
    material: 'world' | 'prop' | 'blood' | 'weapon',
    impulseMag = 1200,
    sourceVel: Vec3 = { x: 0, y: 0, z: 0 },
  ): void {
    if (!this.ready || this.muted || !this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const cue = this.computeSpatialCue(pos, sourceVel, 320);
    const out = this.createSpatialOut(cue);
    const strength = Math.min(1, Math.max(0.22, impulseMag / 3400));

    if (material === 'blood') {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(920 * cue.dopplerRatio, t);
      bp.frequency.exponentialRampToValueAtTime(240, t + 0.09);
      bp.Q.value = 1.6;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.28 * strength, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      noise.connect(bp).connect(ng).connect(out);
      noise.start(t);
      noise.stop(t + 0.12);

      const thud = this.ctx.createOscillator();
      const tg = this.ctx.createGain();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(165 * cue.dopplerRatio, t);
      thud.frequency.exponentialRampToValueAtTime(52, t + 0.08);
      tg.gain.setValueAtTime(0.22 * strength, t);
      tg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      thud.connect(tg).connect(out);
      thud.start(t);
      thud.stop(t + 0.1);
      return;
    }

    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    osc.type = material === 'prop' ? 'triangle' : 'square';
    const baseFreq = material === 'weapon' ? 880 : material === 'world' ? 1420 : 230;
    osc.frequency.setValueAtTime(baseFreq * cue.dopplerRatio, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.38, t + 0.075);
    og.gain.setValueAtTime(0.14 * strength, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.095);
  }

  public playRigidBodyClatter(pos: Vec3, impulseMag: number, kind: RigidBodyKind): void {
    const mat = kind === 'weapon' ? 'weapon' : kind === 'target' ? 'blood' : 'prop';
    this.playImpact(pos, mat, impulseMag);
  }

  public playDryFire(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1650, t);
    osc.frequency.exponentialRampToValueAtTime(720, t + 0.02);
    g.gain.setValueAtTime(0.055, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.03);
  }

  public playReload(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const cues = [
      { delay: 0.0, freq: 420, dur: 0.05 },
      { delay: 0.42, freq: 620, dur: 0.05 },
      { delay: 0.82, freq: 980, dur: 0.06 },
    ];
    for (const c of cues) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(c.freq, t + c.delay);
      osc.frequency.exponentialRampToValueAtTime(c.freq * 0.6, t + c.delay + c.dur);
      g.gain.setValueAtTime(0.08, t + c.delay);
      g.gain.exponentialRampToValueAtTime(0.001, t + c.delay + c.dur + 0.01);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(t + c.delay);
      osc.stop(t + c.delay + c.dur + 0.02);
    }
  }

  public playWeaponDrop(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(340, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.09);
    g.gain.setValueAtTime(0.11, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.11);
  }

  public playWeaponPickup(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = [440, 740];
    notes.forEach((f, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'square';
      const st = t + idx * 0.045;
      osc.frequency.setValueAtTime(f, st);
      g.gain.setValueAtTime(0.065, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.06);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(st);
      osc.stop(st + 0.065);
    });
  }

  public playScopeZoom(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1120, t);
    osc.frequency.exponentialRampToValueAtTime(540, t + 0.04);
    g.gain.setValueAtTime(0.055, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  public playPlayerHurt(damage: number): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const intensity = Math.min(1, Math.max(0.25, damage / 45));

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(145, t);
    osc.frequency.exponentialRampToValueAtTime(58, t + 0.14);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    g.gain.setValueAtTime(0.22 * intensity, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(lp).connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  }

  public playPlayerDeath(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.55);
    g.gain.setValueAtTime(0.26, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.65);
  }

  public playTeleport(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(780, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.14);
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.26);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 1600;
    gain.gain.setValueAtTime(0.11, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(filt).connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  public playWeaponSwitch(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.045);
    gain.gain.setValueAtTime(0.045, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.055);
  }

  public playStartBeep(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.setValueAtTime(880, t + 0.06);
    gain.gain.setValueAtTime(0.09, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  public playFinishChime(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const start = t + idx * 0.065;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.11, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.42);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + 0.45);
    });
  }
}


//InputController.ts , 

// src/gameplay/InputController.ts
import * as THREE from 'three';
import { SpawnPoint } from '../physics/GoldSrcPhysicsEngine';

export interface KeyState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  jump: boolean;
  duck: boolean;
  attack1: boolean;
  attack2: boolean;
  use: boolean;
  reload: boolean;
}

export interface InputCallbacks {
  onUnlockRequest?: () => void;
  onSelectWeapon?: (slot: number) => void;
  onQuickSwitch?: () => void;
  onDropWeapon?: () => void;
  onPickupWeapon?: () => void;
  onReloadOrReset?: () => void;
  onResetRun?: () => void;
  onToggleDebug?: () => void;
  onAttack1Press?: () => void;
  onAttack2Press?: () => void;
}

export class InputController {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: InputCallbacks;
  private readonly menuOverlay: HTMLElement | null;
  private readonly lockHint: HTMLElement | null;

  public readonly keys: KeyState = {
    w: false,
    a: false,
    s: false,
    d: false,
    jump: false,
    duck: false,
    attack1: false,
    attack2: false,
    use: false,
    reload: false,
  };

  public isPointerLocked = false;
  public sensitivity = 1.8;
  public sensitivityScale = 1.0;
  public viewYaw: number;
  public viewPitch: number;
  public smoothYawVisual = 0;
  public vmSwayX = 0;
  public vmSwayY = 0;

  private scrollJumpQueued = false;
  private accumYawDeltaTick = 0;

  constructor(canvas: HTMLCanvasElement, spawn: SpawnPoint, callbacks: InputCallbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.viewYaw = spawn.yaw;
    this.viewPitch = spawn.pitch;
    this.menuOverlay = document.getElementById('menu-overlay');
    this.lockHint = document.getElementById('lock-hint');

    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('pointerlockerror', this.handlePointerLockError);
    this.canvas.addEventListener('click', this.handleCanvasClick);
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('wheel', this.handleWheel, { passive: true });
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.releaseAllKeys);
  }

  public resetView(yaw: number, pitch: number): void {
    this.viewYaw = yaw;
    this.viewPitch = pitch;
  }

  /** Apply recoil view punch in radians (+pitch kicks upward) */
  public applyRecoilKick(pitchRad: number, yawRad: number): void {
    this.viewPitch = Math.max(-1.535, Math.min(1.535, this.viewPitch + pitchRad));
    this.viewYaw += yawRad;
  }

  public consumeScrollJump(): boolean {
    const queued = this.scrollJumpQueued;
    this.scrollJumpQueued = false;
    return queued;
  }

  public consumeTickYawDelta(): number {
    const delta = this.accumYawDeltaTick;
    this.accumYawDeltaTick = 0;
    return delta;
  }

  public decayVisuals(dtSec: number): void {
    this.smoothYawVisual *= Math.pow(0.0005, dtSec);
    this.vmSwayX *= Math.pow(0.001, dtSec);
    this.vmSwayY *= Math.pow(0.001, dtSec);
  }

  public requestLock(): void {
    this.callbacks.onUnlockRequest?.();
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          if (this.lockHint) {
            this.lockHint.textContent = 'Browser cooldown active — click again to lock mouse.';
          }
        });
      }
    } catch {
      if (this.lockHint) {
        this.lockHint.textContent = 'Click the orange button again to engage Pointer Lock.';
      }
    }
  }

  private openMenu(): void {
    this.menuOverlay?.classList.remove('hidden');
    this.releaseAllKeys();
  }

  private closeMenu(): void {
    this.menuOverlay?.classList.add('hidden');
    if (this.lockHint) this.lockHint.textContent = '';
  }

  private releaseAllKeys = (): void => {
    this.keys.w = false;
    this.keys.a = false;
    this.keys.s = false;
    this.keys.d = false;
    this.keys.jump = false;
    this.keys.duck = false;
    this.keys.attack1 = false;
    this.keys.attack2 = false;
    this.keys.use = false;
    this.keys.reload = false;
    this.scrollJumpQueued = false;
  };

  private handlePointerLockChange = (): void => {
    this.isPointerLocked = document.pointerLockElement === this.canvas;
    if (this.isPointerLocked) {
      this.closeMenu();
    } else {
      this.openMenu();
    }
  };

  private handlePointerLockError = (): void => {
    if (this.lockHint) {
      this.lockHint.textContent = 'Pointer lock paused briefly by browser — click button again.';
    }
  };

  private handleCanvasClick = (): void => {
    if (!this.isPointerLocked && this.menuOverlay?.classList.contains('hidden')) {
      this.requestLock();
    }
  };

  private handleContextMenu = (e: MouseEvent): void => {
    if (this.isPointerLocked) {
      e.preventDefault();
    }
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (!this.isPointerLocked) return;
    if (e.button === 0) {
      this.keys.attack1 = true;
      this.callbacks.onAttack1Press?.();
    } else if (e.button === 2) {
      this.keys.attack2 = true;
      this.callbacks.onAttack2Press?.();
    }
  };

  private handleMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.keys.attack1 = false;
    } else if (e.button === 2) {
      this.keys.attack2 = false;
    }
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.isPointerLocked) return;

    // CS 1.6 m_yaw = 0.022 deg per count (scaled when scoped)
    const radPerCount = (0.022 * Math.PI) / 180;
    const effSens = this.sensitivity * this.sensitivityScale;
    const dYaw = -e.movementX * effSens * radPerCount;
    const dPitch = -e.movementY * effSens * radPerCount;

    this.viewYaw += dYaw;
    this.viewPitch = Math.max(-1.535, Math.min(1.535, this.viewPitch + dPitch));

    this.accumYawDeltaTick += dYaw;
    this.smoothYawVisual = THREE.MathUtils.clamp(this.smoothYawVisual + dYaw * 14, -1, 1);

    this.vmSwayX = THREE.MathUtils.clamp(this.vmSwayX - e.movementX * 0.00028, -0.055, 0.055);
    this.vmSwayY = THREE.MathUtils.clamp(this.vmSwayY + e.movementY * 0.00022, -0.04, 0.04);
  };

  private handleWheel = (): void => {
    if (!this.isPointerLocked) return;
    this.scrollJumpQueued = true;
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Tab') {
      e.preventDefault();
      if (this.isPointerLocked) {
        document.exitPointerLock();
      } else {
        this.requestLock();
      }
      return;
    }

    if (e.code === 'F2') {
      e.preventDefault();
      this.callbacks.onToggleDebug?.();
      return;
    }

    if (!this.isPointerLocked) return;

    switch (e.code) {
      case 'KeyW':
        this.keys.w = true;
        break;
      case 'KeyS':
        this.keys.s = true;
        break;
      case 'KeyA':
        this.keys.a = true;
        break;
      case 'KeyD':
        this.keys.d = true;
        break;
      case 'Space':
        this.keys.jump = true;
        e.preventDefault();
        break;
      case 'ControlLeft':
      case 'ControlRight':
        this.keys.duck = true;
        break;
      case 'Digit1':
        if (!e.repeat) this.callbacks.onSelectWeapon?.(1);
        break;
      case 'Digit2':
        if (!e.repeat) this.callbacks.onSelectWeapon?.(2);
        break;
      case 'Digit3':
        if (!e.repeat) this.callbacks.onSelectWeapon?.(3);
        break;
      case 'KeyQ':
        if (!e.repeat) this.callbacks.onQuickSwitch?.();
        break;
      case 'KeyG':
        if (!e.repeat) this.callbacks.onDropWeapon?.();
        break;
      case 'KeyE':
        this.keys.use = true;
        if (!e.repeat) this.callbacks.onPickupWeapon?.();
        break;
      case 'KeyR':
        this.keys.reload = true;
        if (!e.repeat) {
          if (e.shiftKey) {
            this.callbacks.onResetRun?.();
          } else {
            this.callbacks.onReloadOrReset?.();
          }
        }
        break;
      case 'Backspace':
        if (!e.repeat) this.callbacks.onResetRun?.();
        break;
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'KeyW':
        this.keys.w = false;
        break;
      case 'KeyS':
        this.keys.s = false;
        break;
      case 'KeyA':
        this.keys.a = false;
        break;
      case 'KeyD':
        this.keys.d = false;
        break;
      case 'Space':
        this.keys.jump = false;
        break;
      case 'ControlLeft':
      case 'ControlRight':
        this.keys.duck = false;
        break;
      case 'KeyE':
        this.keys.use = false;
        break;
      case 'KeyR':
        this.keys.reload = false;
        break;
    }
  };
}


//GoldSrcPhysicsEngine.ts , 

// src/physics/GoldSrcPhysicsEngine.ts
import {
  AIR_WISH_CAP,
  DIST_EPSILON,
  f32,
  FIXED_DT,
  FL_DUCKING,
  FL_ONGROUND,
  HULL_DUCK,
  HULL_STAND,
  IN_DUCK,
  IN_JUMP,
  MAX_CLIP_PLANES,
  MoveState,
  STEPSIZE,
  STOP_EPSILON,
  SURF_NORMAL_Z,
} from '../core/constants';
import { F32, I32, PhysicsMemoryAbi } from '../core/memoryAbi';
import { ConvexBrush, TriggerVolume } from './BrushBuilder';

export const IN_ATTACK = 1 << 10;
export const IN_ATTACK2 = 1 << 11;
export const IN_RELOAD = 1 << 12;
export const IN_USE = 1 << 13;

export type WeaponSlot = 1 | 2 | 3;
export type RigidBodyKind = 'prop' | 'weapon' | 'target';

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface CheckpointState {
  index: number;
  label: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  velX?: number;
  velY?: number;
  velZ?: number;
}

export interface SourcePhysicsConfig {
  sourceMaxVelocity?: number;
  svBounce?: number;
  playerMass?: number;
  surfaceFriction?: number;
  linearDamping?: number;
  angularDamping?: number;
  physPushScale?: number;
  fallDamageThreshold?: number;
  fallDamageScale?: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  w: number;
  x: number;
  y: number;
  z: number;
}

/** 3x3 row-major matrix */
export type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

export interface DroppedWeaponData {
  slot: 1 | 2;
  clipAmmo: number;
  reserveAmmo: number;
  silenced?: boolean;
  /** World tick before which auto-pickup ignores the player who dropped it */
  pickupCooldownTick: number;
}

export interface SourceRigidBody {
  id: string;
  kind?: RigidBodyKind;
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  angVel: Vec3;
  /** Diagonal principal moments of inertia in local body frame */
  inertiaLocal: Vec3;
  hx: number;
  hy: number;
  hz: number;
  mass: number;
  restitution: number;
  gravityScale: number;
  surfaceFriction?: number;
  /** Combat & damage state */
  hp?: number;
  maxHp?: number;
  bleeds?: boolean;
  bloodLostMl?: number;
  weaponData?: DroppedWeaponData;
}

export interface PlayerVitalState {
  hp: number;
  maxHp: number;
  bloodMl: number;
  maxBloodMl: number;
  bloodLossCount: number;
  dead: boolean;
}

export interface RayHitResult {
  hit: boolean;
  kind: 'none' | 'world' | 'rigidBody';
  fraction: number;
  distance: number;
  point: Vec3;
  normal: Vec3;
  brushId?: string;
  body?: SourceRigidBody;
}

export interface PhysicsCallbacks {
  onLand?: (impactSpeed: number) => void;
  onJump?: () => void;
  onStartRun?: () => void;
  onFinishRun?: () => void;
  onBoost?: (triggerId: string) => void;
  onTeleport?: (isFail: boolean) => void;
  onRigidBodyHit?: (bodyId: string, impulseMag: number, pos: Vec3, kind: RigidBodyKind) => void;
  onRigidBodyDestroyed?: (body: SourceRigidBody, hitPoint: Vec3) => void;
  onExplosion?: (triggerId: string, origin: Vec3, radius: number) => void;
  onCheckpoint?: (cp: CheckpointState) => void;
  onPlayerDamage?: (amount: number, source: 'fall' | 'explosion' | 'hazard', bloodLostMl: number) => void;
  onPlayerDeath?: (source: 'fall' | 'explosion' | 'hazard') => void;
}

interface TraceResult {
  fraction: number;
  endX: number;
  endY: number;
  endZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  startSolid: boolean;
  allSolid: boolean;
  brushId: string;
}

/**
 * Source AngleVectors:
 * Given Euler view angles — pitch theta (positive looks downward), yaw psi, roll phi —
 * computes orthonormal forward, right, and up basis vectors in Z-up Hammer space.
 */
export function computeAngleVectors(
  sourcePitch: number,
  yaw: number,
  roll = 0,
): { forward: Vec3; right: Vec3; up: Vec3 } {
  const sp = Math.sin(sourcePitch);
  const cp = Math.cos(sourcePitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);

  return {
    forward: {
      x: f32(cp * cy),
      y: f32(cp * sy),
      z: f32(-sp),
    },
    right: {
      x: f32(-sr * sp * cy + cr * sy),
      y: f32(-sr * sp * sy - cr * cy),
      z: f32(-sr * cp),
    },
    up: {
      x: f32(cr * sp * cy + sr * sy),
      y: f32(cr * sp * sy - sr * cy),
      z: f32(cr * cp),
    },
  };
}

/** Create a box rigid body with exact cuboid principal inertia tensor I = (m/12) * (w^2 + h^2) */
export function createBoxRigidBody(
  id: string,
  pos: Vec3,
  halfExtents: Vec3,
  mass: number,
  opts: {
    kind?: RigidBodyKind;
    vel?: Vec3;
    angVel?: Vec3;
    quat?: Quat;
    restitution?: number;
    gravityScale?: number;
    surfaceFriction?: number;
    hp?: number;
    maxHp?: number;
    bleeds?: boolean;
    weaponData?: DroppedWeaponData;
  } = {},
): SourceRigidBody {
  const sx = halfExtents.x * 2;
  const sy = halfExtents.y * 2;
  const sz = halfExtents.z * 2;
  const inv12 = mass / 12;

  return {
    id,
    kind: opts.kind ?? 'prop',
    pos: { x: f32(pos.x), y: f32(pos.y), z: f32(pos.z) },
    vel: {
      x: f32(opts.vel?.x ?? 0),
      y: f32(opts.vel?.y ?? 0),
      z: f32(opts.vel?.z ?? 0),
    },
    quat: opts.quat
      ? normalizeQuat(opts.quat)
      : { w: f32(1), x: f32(0), y: f32(0), z: f32(0) },
    angVel: {
      x: f32(opts.angVel?.x ?? 0),
      y: f32(opts.angVel?.y ?? 0),
      z: f32(opts.angVel?.z ?? 0),
    },
    inertiaLocal: {
      x: f32(inv12 * (sy * sy + sz * sz)),
      y: f32(inv12 * (sx * sx + sz * sz)),
      z: f32(inv12 * (sx * sx + sy * sy)),
    },
    hx: f32(halfExtents.x),
    hy: f32(halfExtents.y),
    hz: f32(halfExtents.z),
    mass: f32(mass),
    restitution: f32(opts.restitution ?? 0.35),
    gravityScale: f32(opts.gravityScale ?? 1.0),
    surfaceFriction: opts.surfaceFriction,
    hp: opts.hp,
    maxHp: opts.maxHp ?? opts.hp,
    bleeds: opts.bleeds ?? false,
    bloodLostMl: 0,
    weaponData: opts.weaponData,
  };
}

/** Create a droppable VPhysics weapon rigid body (Scout or USP .45) */
export function createWeaponRigidBody(
  id: string,
  pos: Vec3,
  weaponData: DroppedWeaponData,
  vel: Vec3 = { x: 0, y: 0, z: 0 },
  angVel: Vec3 = { x: 0, y: 0, z: 0 },
): SourceRigidBody {
  const isScout = weaponData.slot === 1;
  return createBoxRigidBody(
    id,
    pos,
    isScout ? { x: 22, y: 5, z: 6 } : { x: 11, y: 3.5, z: 5.5 },
    isScout ? 5.2 : 2.1,
    {
      kind: 'weapon',
      vel,
      angVel,
      restitution: 0.28,
      surfaceFriction: 1.45,
      weaponData,
    },
  );
}

/** Create a bleeding combat dummy rigid body (reacts to bullet/knife impulses + loses HP & blood) */
export function createTargetRigidBody(
  id: string,
  pos: Vec3,
  hp = 100,
): SourceRigidBody {
  return createBoxRigidBody(
    id,
    pos,
    { x: 15, y: 15, z: 34 },
    68,
    {
      kind: 'target',
      hp,
      maxHp: hp,
      bleeds: true,
      restitution: 0.22,
      surfaceFriction: 1.35,
    },
  );
}

function normalizeQuat(q: Quat): Quat {
  const len = Math.hypot(q.w, q.x, q.y, q.z);
  if (len < 1e-8) return { w: 1, x: 0, y: 0, z: 0 };
  return {
    w: f32(q.w / len),
    x: f32(q.x / len),
    y: f32(q.y / len),
    z: f32(q.z / len),
  };
}

function quatToMat3(q: Quat): Mat3 {
  const n = normalizeQuat(q);
  const { w, x, y, z } = n;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;

  return [
    f32(1 - 2 * (yy + zz)), f32(2 * (xy - wz)),     f32(2 * (xz + wy)),
    f32(2 * (xy + wz)),     f32(1 - 2 * (xx + zz)), f32(2 * (yz - wx)),
    f32(2 * (xz - wy)),     f32(2 * (yz + wx)),     f32(1 - 2 * (xx + yy)),
  ];
}

function mulMat3Vec3(m: Mat3, v: Vec3): Vec3 {
  return {
    x: f32(m[0] * v.x + m[1] * v.y + m[2] * v.z),
    y: f32(m[3] * v.x + m[4] * v.y + m[5] * v.z),
    z: f32(m[6] * v.x + m[7] * v.y + m[8] * v.z),
  };
}

function mulMat3TransposeVec3(m: Mat3, v: Vec3): Vec3 {
  return {
    x: f32(m[0] * v.x + m[3] * v.y + m[6] * v.z),
    y: f32(m[1] * v.x + m[4] * v.y + m[7] * v.z),
    z: f32(m[2] * v.x + m[5] * v.y + m[8] * v.z),
  };
}

function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: f32(a.y * b.z - a.z * b.y),
    y: f32(a.z * b.x - a.x * b.z),
    z: f32(a.x * b.y - a.y * b.x),
  };
}

function dotVec3(a: Vec3, b: Vec3): number {
  return f32(a.x * b.x + a.y * b.y + a.z * b.z);
}

/** World-space inertia tensor I = R * I_local * R^T and its inverse I^-1 */
function computeWorldInertia(rot: Mat3, inertiaLocal: Vec3): { inertia: Mat3; invInertia: Mat3 } {
  const s0x = rot[0] * inertiaLocal.x;
  const s0y = rot[3] * inertiaLocal.x;
  const s0z = rot[6] * inertiaLocal.x;

  const s1x = rot[1] * inertiaLocal.y;
  const s1y = rot[4] * inertiaLocal.y;
  const s1z = rot[7] * inertiaLocal.y;

  const s2x = rot[2] * inertiaLocal.z;
  const s2y = rot[5] * inertiaLocal.z;
  const s2z = rot[8] * inertiaLocal.z;

  const i00 = f32(s0x * rot[0] + s1x * rot[1] + s2x * rot[2]);
  const i01 = f32(s0x * rot[3] + s1x * rot[4] + s2x * rot[5]);
  const i02 = f32(s0x * rot[6] + s1x * rot[7] + s2x * rot[8]);

  const i10 = f32(s0y * rot[0] + s1y * rot[1] + s2y * rot[2]);
  const i11 = f32(s0y * rot[3] + s1y * rot[4] + s2y * rot[5]);
  const i12 = f32(s0y * rot[6] + s1y * rot[7] + s2y * rot[8]);

  const i20 = f32(s0z * rot[0] + s1z * rot[1] + s2z * rot[2]);
  const i21 = f32(s0z * rot[3] + s1z * rot[4] + s2z * rot[5]);
  const i22 = f32(s0z * rot[6] + s1z * rot[7] + s2z * rot[8]);

  const inertia: Mat3 = [i00, i01, i02, i10, i11, i12, i20, i21, i22];

  const c00 = i11 * i22 - i12 * i21;
  const c01 = -(i10 * i22 - i12 * i20);
  const c02 = i10 * i21 - i11 * i20;
  const c10 = -(i01 * i22 - i02 * i21);
  const c11 = i00 * i22 - i02 * i20;
  const c12 = -(i00 * i21 - i01 * i20);
  const c20 = i01 * i12 - i02 * i11;
  const c21 = -(i00 * i12 - i02 * i10);
  const c22 = i00 * i11 - i01 * i10;

  const det = i00 * c00 + i01 * c01 + i02 * c02;
  if (Math.abs(det) < 1e-8) {
    return { inertia, invInertia: [0, 0, 0, 0, 0, 0, 0, 0, 0] };
  }
  const invDet = 1 / det;

  const invInertia: Mat3 = [
    f32(c00 * invDet), f32(c10 * invDet), f32(c20 * invDet),
    f32(c01 * invDet), f32(c11 * invDet), f32(c21 * invDet),
    f32(c02 * invDet), f32(c12 * invDet), f32(c22 * invDet),
  ];

  return { inertia, invInertia };
}

export class GoldSrcPhysicsEngine {
  private readonly abi: PhysicsMemoryAbi;
  private readonly brushes: ConvexBrush[];
  private readonly triggers: TriggerVolume[];
  private rigidBodies: SourceRigidBody[];
  private readonly spawn: SpawnPoint;
  private readonly callbacks: PhysicsCallbacks;
  private readonly sourceConfig: Required<SourcePhysicsConfig>;

  private readonly triggerCooldowns = new Map<string, number>();
  private readonly clipOut = new Float32Array(3);
  private readonly planesX = new Float32Array(MAX_CLIP_PLANES);
  private readonly planesY = new Float32Array(MAX_CLIP_PLANES);
  private readonly planesZ = new Float32Array(MAX_CLIP_PLANES);

  // Source CGameMovement basevelocity (conveyors / moving platforms)
  private baseVelX = f32(0);
  private baseVelY = f32(0);
  private baseVelZ = f32(0);

  // Player life / health / blood state
  private readonly vitals: PlayerVitalState = {
    hp: 100,
    maxHp: 100,
    bloodMl: 5000,
    maxBloodMl: 5000,
    bloodLossCount: 0,
    dead: false,
  };

  private readonly traceScratch: TraceResult = {
    fraction: f32(1.0),
    endX: f32(0),
    endY: f32(0),
    endZ: f32(0),
    normalX: f32(0),
    normalY: f32(0),
    normalZ: f32(0),
    startSolid: false,
    allSolid: false,
    brushId: '',
  };

  constructor(
    abi: PhysicsMemoryAbi,
    brushes: ConvexBrush[],
    triggers: TriggerVolume[],
    spawn: SpawnPoint,
    callbacks: PhysicsCallbacks = {},
    rigidBodies: SourceRigidBody[] = [],
    sourceConfig: SourcePhysicsConfig = {},
  ) {
    this.abi = abi;
    this.brushes = brushes;
    this.triggers = triggers;
    this.rigidBodies = rigidBodies;
    this.spawn = spawn;
    this.callbacks = callbacks;
    this.sourceConfig = {
      sourceMaxVelocity: sourceConfig.sourceMaxVelocity ?? 3500,
      svBounce: sourceConfig.svBounce ?? 0,
      playerMass: sourceConfig.playerMass ?? 85,
      surfaceFriction: sourceConfig.surfaceFriction ?? 1.0,
      linearDamping: sourceConfig.linearDamping ?? 0.02,
      angularDamping: sourceConfig.angularDamping ?? 0.05,
      physPushScale: sourceConfig.physPushScale ?? 1.0,
      fallDamageThreshold: sourceConfig.fallDamageThreshold ?? 580,
      fallDamageScale: sourceConfig.fallDamageScale ?? 0.16,
    };
  }

  public getVitals(): Readonly<PlayerVitalState> {
    return this.vitals;
  }

  public restoreVitals(): void {
    this.vitals.hp = this.vitals.maxHp;
    this.vitals.bloodMl = this.vitals.maxBloodMl;
    this.vitals.bloodLossCount = 0;
    this.vitals.dead = false;
  }

  public damagePlayer(amount: number, source: 'fall' | 'explosion' | 'hazard'): void {
    if (this.vitals.dead || amount <= 0) return;
    const dmg = Math.max(1, Math.round(amount));
    this.vitals.hp = Math.max(0, this.vitals.hp - dmg);
    const bloodLostMl = Math.min(this.vitals.bloodMl, Math.round(dmg * 36));
    this.vitals.bloodMl = Math.max(0, this.vitals.bloodMl - bloodLostMl);
    this.vitals.bloodLossCount += 1;

    this.callbacks.onPlayerDamage?.(dmg, source, bloodLostMl);

    if (this.vitals.hp <= 0) {
      this.vitals.dead = true;
      this.callbacks.onPlayerDeath?.(source);
    }
  }

  public getRigidBodies(): readonly SourceRigidBody[] {
    return this.rigidBodies;
  }

  public addRigidBody(body: SourceRigidBody): void {
    this.rigidBodies.push(body);
  }

  public removeRigidBody(id: string): SourceRigidBody | null {
    const idx = this.rigidBodies.findIndex((b) => b.id === id);
    if (idx === -1) return null;
    const [removed] = this.rigidBodies.splice(idx, 1);
    return removed;
  }

  public setRigidBodies(bodies: SourceRigidBody[]): void {
    this.rigidBodies = bodies;
  }

  public getPlayerEyePosition(): Vec3 {
    const vf = this.abi.f32;
    return {
      x: vf[F32.POS_X],
      y: vf[F32.POS_Y],
      z: f32(vf[F32.POS_Z] + vf[F32.VIEW_OFS_Z]),
    };
  }

  /** Find nearest pickupable dropped weapon within range (and optionally aligned with aim ray) */
  public findNearbyWeapon(
    maxRange: number,
    aimOrigin?: Vec3,
    aimDir?: Vec3,
    minAimDot = 0.72,
    respectAutoCooldown = false,
  ): SourceRigidBody | null {
    const vf = this.abi.f32;
    const tick = this.abi.i32[I32.TICK];
    const px = aimOrigin?.x ?? vf[F32.POS_X];
    const py = aimOrigin?.y ?? vf[F32.POS_Y];
    const pz = aimOrigin?.z ?? vf[F32.POS_Z];

    let best: SourceRigidBody | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < this.rigidBodies.length; i++) {
      const b = this.rigidBodies[i];
      if (b.kind !== 'weapon' || !b.weaponData) continue;
      if (respectAutoCooldown && tick < b.weaponData.pickupCooldownTick) continue;

      const dx = b.pos.x - px;
      const dy = b.pos.y - py;
      const dz = b.pos.z - pz;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > maxRange) continue;

      if (aimDir && dist > 1e-4) {
        const dot = (dx * aimDir.x + dy * aimDir.y + dz * aimDir.z) / dist;
        if (dot < minAimDot && dist > 52) continue;
        const score = dist * (1.25 - Math.max(0, dot));
        if (score < bestScore) {
          bestScore = score;
          best = b;
        }
      } else if (dist < bestScore) {
        bestScore = dist;
        best = b;
      }
    }

    return best;
  }

  /**
   * Hitscan raycast against BOTH static BSP convex brushes and oriented VPhysics rigid bodies (OBBs).
   */
  public traceRay(
    origin: Vec3,
    dir: Vec3,
    maxDistance: number,
    ignoreBodyIds?: ReadonlySet<string>,
  ): RayHitResult {
    const dLen = Math.hypot(dir.x, dir.y, dir.z);
    if (dLen < 1e-6 || maxDistance <= 0) {
      return {
        hit: false,
        kind: 'none',
        fraction: 1,
        distance: maxDistance,
        point: { ...origin },
        normal: { x: 0, y: 0, z: 1 },
      };
    }

    const nx = dir.x / dLen;
    const ny = dir.y / dLen;
    const nz = dir.z / dLen;

    const endX = f32(origin.x + nx * maxDistance);
    const endY = f32(origin.y + ny * maxDistance);
    const endZ = f32(origin.z + nz * maxDistance);

    // 1. Static BSP brush trace (point ray with DIST_EPSILON)
    const worldTr: TraceResult = {
      fraction: f32(1.0),
      endX,
      endY,
      endZ,
      normalX: f32(0),
      normalY: f32(0),
      normalZ: f32(1),
      startSolid: false,
      allSolid: false,
      brushId: '',
    };
    this.traceWorld(origin.x, origin.y, origin.z, endX, endY, endZ, 0, 0, 0, worldTr);

    let bestFrac = worldTr.fraction;
    let bestKind: 'none' | 'world' | 'rigidBody' = worldTr.fraction < 1.0 ? 'world' : 'none';
    let bestNormal: Vec3 = {
      x: worldTr.normalX,
      y: worldTr.normalY,
      z: worldTr.normalZ,
    };
    let bestBrushId: string | undefined = worldTr.fraction < 1.0 ? worldTr.brushId : undefined;
    let bestBody: SourceRigidBody | undefined;

    // 2. Oriented bounding box (OBB) slab ray intersection against every VPhysics rigid body
    const rayDir: Vec3 = { x: nx, y: ny, z: nz };
    for (let i = 0; i < this.rigidBodies.length; i++) {
      const b = this.rigidBodies[i];
      if (ignoreBodyIds?.has(b.id)) continue;

      const rot = quatToMat3(b.quat);
      const relOrigin: Vec3 = {
        x: origin.x - b.pos.x,
        y: origin.y - b.pos.y,
        z: origin.z - b.pos.z,
      };
      const localOrigin = mulMat3TransposeVec3(rot, relOrigin);
      const localDir = mulMat3TransposeVec3(rot, rayDir);

      const obbHit = this.intersectRayLocalBox(
        localOrigin,
        localDir,
        b.hx,
        b.hy,
        b.hz,
        maxDistance * bestFrac,
      );

      if (obbHit) {
        const frac = obbHit.t / maxDistance;
        if (frac >= 0 && frac < bestFrac) {
          bestFrac = frac;
          bestKind = 'rigidBody';
          bestBody = b;
          bestBrushId = undefined;
          const worldNorm = mulMat3Vec3(rot, obbHit.localNormal);
          const nLen = Math.hypot(worldNorm.x, worldNorm.y, worldNorm.z) || 1;
          bestNormal = {
            x: f32(worldNorm.x / nLen),
            y: f32(worldNorm.y / nLen),
            z: f32(worldNorm.z / nLen),
          };
        }
      }
    }

    const hitDist = bestFrac * maxDistance;
    return {
      hit: bestKind !== 'none',
      kind: bestKind,
      fraction: bestFrac,
      distance: hitDist,
      point: {
        x: f32(origin.x + nx * hitDist),
        y: f32(origin.y + ny * hitDist),
        z: f32(origin.z + nz * hitDist),
      },
      normal: bestNormal,
      brushId: bestBrushId,
      body: bestBody,
    };
  }

  /**
   * CS 1.6-style knife melee trace: tries center ray first, then falls back to an expanded
   * melee hull (half-extent 10u) so close-quarters slashes connect cleanly with targets & props.
   */
  public traceMelee(origin: Vec3, dir: Vec3, maxDistance: number): RayHitResult {
    const exact = this.traceRay(origin, dir, maxDistance);
    if (exact.hit && exact.kind === 'rigidBody') return exact;

    const dLen = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const nx = dir.x / dLen;
    const ny = dir.y / dLen;
    const nz = dir.z / dLen;
    const rayDir: Vec3 = { x: nx, y: ny, z: nz };

    // Expanded OBB check for forgiving melee hits on props/targets
    let bestFrac = exact.fraction;
    let bestBody: SourceRigidBody | undefined;
    let bestNormal: Vec3 = exact.normal;
    const meleePad = 10;

    for (let i = 0; i < this.rigidBodies.length; i++) {
      const b = this.rigidBodies[i];
      const rot = quatToMat3(b.quat);
      const localOrigin = mulMat3TransposeVec3(rot, {
        x: origin.x - b.pos.x,
        y: origin.y - b.pos.y,
        z: origin.z - b.pos.z,
      });
      const localDir = mulMat3TransposeVec3(rot, rayDir);

      const hit = this.intersectRayLocalBox(
        localOrigin,
        localDir,
        b.hx + meleePad,
        b.hy + meleePad,
        b.hz + meleePad,
        maxDistance * bestFrac,
      );
      if (hit) {
        const frac = hit.t / maxDistance;
        if (frac >= 0 && frac < bestFrac) {
          bestFrac = frac;
          bestBody = b;
          const wn = mulMat3Vec3(rot, hit.localNormal);
          const wl = Math.hypot(wn.x, wn.y, wn.z) || 1;
          bestNormal = { x: f32(wn.x / wl), y: f32(wn.y / wl), z: f32(wn.z / wl) };
        }
      }
    }

    if (bestBody) {
      const dist = bestFrac * maxDistance;
      return {
        hit: true,
        kind: 'rigidBody',
        fraction: bestFrac,
        distance: dist,
        point: {
          x: f32(origin.x + nx * dist),
          y: f32(origin.y + ny * dist),
          z: f32(origin.z + nz * dist),
        },
        normal: bestNormal,
        body: bestBody,
      };
    }

    return exact;
  }

  /** Local-space AABB slab test for exact OBB ray intersection */
  private intersectRayLocalBox(
    o: Vec3,
    d: Vec3,
    hx: number,
    hy: number,
    hz: number,
    maxDist: number,
  ): { t: number; localNormal: Vec3 } | null {
    let tMin = 0;
    let tMax = maxDist;
    let hitNormal: Vec3 = { x: 0, y: 0, z: 1 };

    const axes: Array<{ o: number; d: number; h: number; axis: 0 | 1 | 2 }> = [
      { o: o.x, d: d.x, h: hx, axis: 0 },
      { o: o.y, d: d.y, h: hy, axis: 1 },
      { o: o.z, d: d.z, h: hz, axis: 2 },
    ];

    for (const a of axes) {
      if (Math.abs(a.d) < 1e-7) {
        if (a.o < -a.h || a.o > a.h) return null;
      } else {
        const invD = 1 / a.d;
        let t1 = (-a.h - a.o) * invD;
        let t2 = (a.h - a.o) * invD;
        let sign = -1;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
          sign = 1;
        }
        if (t1 > tMin) {
          tMin = t1;
          hitNormal =
            a.axis === 0
              ? { x: sign, y: 0, z: 0 }
              : a.axis === 1
                ? { x: 0, y: sign, z: 0 }
                : { x: 0, y: 0, z: sign };
        }
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) return null;
      }
    }

    if (tMin < 0 || tMin > maxDist) return null;
    return { t: tMin, localNormal: hitNormal };
  }

  /**
   * Apply a Source VPhysics point impact impulse (gunshot or knife strike) at world hit point p:
   *   r = p - x_B
   *   delta_v = (j / m_B) * dir
   *   delta_omega = I_B^-1 * (r x (j * dir))
   */
  public applyPointImpulse(
    body: SourceRigidBody,
    hitPoint: Vec3,
    direction: Vec3,
    impulseMag: number,
    damage = 0,
  ): { destroyed: boolean; remainingHp?: number; bled: boolean; bloodLostMl: number } {
    if (body.mass > 0 && impulseMag > 0) {
      const dLen = Math.hypot(direction.x, direction.y, direction.z) || 1;
      const nx = direction.x / dLen;
      const ny = direction.y / dLen;
      const nz = direction.z / dLen;

      const scaledJ = f32(impulseMag * this.sourceConfig.physPushScale);
      const jVec: Vec3 = {
        x: f32(nx * scaledJ),
        y: f32(ny * scaledJ),
        z: f32(nz * scaledJ),
      };

      const invM = 1 / body.mass;
      body.vel.x = f32(body.vel.x + jVec.x * invM);
      body.vel.y = f32(body.vel.y + jVec.y * invM);
      body.vel.z = f32(body.vel.z + jVec.z * invM + Math.min(85, scaledJ * invM * 0.12));

      const r: Vec3 = {
        x: f32(hitPoint.x - body.pos.x),
        y: f32(hitPoint.y - body.pos.y),
        z: f32(hitPoint.z - body.pos.z),
      };
      const rot = quatToMat3(body.quat);
      const { invInertia } = computeWorldInertia(rot, body.inertiaLocal);
      const dOmega = mulMat3Vec3(invInertia, crossVec3(r, jVec));

      body.angVel.x = f32(body.angVel.x + dOmega.x);
      body.angVel.y = f32(body.angVel.y + dOmega.y);
      body.angVel.z = f32(body.angVel.z + dOmega.z);

      this.callbacks.onRigidBodyHit?.(body.id, scaledJ, hitPoint, body.kind ?? 'prop');
    }

    const bled = Boolean(body.bleeds && damage > 0);
    const bloodLostMl = bled ? Math.round(damage * 24) : 0;
    if (bled) {
      body.bloodLostMl = (body.bloodLostMl ?? 0) + bloodLostMl;
    }

    let destroyed = false;
    if (damage > 0 && typeof body.hp === 'number') {
      body.hp = Math.max(0, body.hp - damage);
      if (body.hp <= 0) {
        destroyed = true;
        this.removeRigidBody(body.id);
        this.callbacks.onRigidBodyDestroyed?.(body, hitPoint);
      }
    }

    return { destroyed, remainingHp: body.hp, bled, bloodLostMl };
  }

  public captureCheckpointState(index = 0, label = 'CUSTOM SAVE-STATE'): CheckpointState {
    const vf = this.abi.f32;
    return {
      index,
      label,
      x: vf[F32.POS_X],
      y: vf[F32.POS_Y],
      z: vf[F32.POS_Z],
      yaw: vf[F32.CMD_YAW],
      pitch: vf[F32.CMD_PITCH],
      velX: vf[F32.VEL_X],
      velY: vf[F32.VEL_Y],
      velZ: vf[F32.VEL_Z],
    };
  }

  public teleportToCheckpoint(cp: CheckpointState): void {
    const { f32: vf, i32: vi } = this.abi;
    vf[F32.POS_X] = f32(cp.x);
    vf[F32.POS_Y] = f32(cp.y);
    vf[F32.POS_Z] = f32(cp.z);
    vf[F32.PREV_X] = f32(cp.x);
    vf[F32.PREV_Y] = f32(cp.y);
    vf[F32.PREV_Z] = f32(cp.z);
    vf[F32.VEL_X] = f32(cp.velX ?? 0);
    vf[F32.VEL_Y] = f32(cp.velY ?? 0);
    vf[F32.VEL_Z] = f32(cp.velZ ?? 0);
    this.baseVelX = f32(0);
    this.baseVelY = f32(0);
    this.baseVelZ = f32(0);
    vf[F32.YAW] = f32(cp.yaw);
    vf[F32.PITCH] = f32(cp.pitch);
    vi[I32.FLAGS] &= ~FL_ONGROUND;
    vi[I32.MOVESTATE] = MoveState.AIR;
    this.triggerCooldowns.clear();
    this.checkVelocity();
  }

  /**
   * Radial explosion impulse:
   *   I_mag = D_max * max(0, 1 - ||x_obj - x_exp|| / R) * k_push
   *   delta_v = (I_mag / m) * (x_obj - x_exp) / ||x_obj - x_exp||
   */
  public applyExplosionImpulse(
    origin: Vec3,
    maxDamage: number,
    radius: number,
    pushScaleOverride?: number,
    sourceId = 'manual_blast',
    applyPlayerHpDamage = true,
  ): void {
    if (radius <= 0) return;
    const kPush = pushScaleOverride ?? this.sourceConfig.physPushScale;
    const vf = this.abi.f32;

    const pDx = vf[F32.POS_X] - origin.x;
    const pDy = vf[F32.POS_Y] - origin.y;
    const pDz = vf[F32.POS_Z] - origin.z;
    const pDist = Math.hypot(pDx, pDy, pDz);
    if (pDist > 1e-5 && pDist < radius) {
      const falloff = Math.max(0, 1 - pDist / radius);
      const mag = maxDamage * falloff * kPush;
      const pMass = Math.max(1, this.sourceConfig.playerMass);
      const dv = mag / pMass;
      vf[F32.VEL_X] = f32(vf[F32.VEL_X] + dv * (pDx / pDist));
      vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] + dv * (pDy / pDist));
      vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] + dv * (pDz / pDist));
      this.abi.i32[I32.FLAGS] &= ~FL_ONGROUND;

      if (applyPlayerHpDamage && falloff > 0.25) {
        const hpDmg = Math.round(falloff * 42);
        if (hpDmg > 0) this.damagePlayer(hpDmg, 'explosion');
      }
    }

    for (let i = this.rigidBodies.length - 1; i >= 0; i--) {
      const b = this.rigidBodies[i];
      if (b.mass <= 0) continue;
      const dx = b.pos.x - origin.x;
      const dy = b.pos.y - origin.y;
      const dz = b.pos.z - origin.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 1e-5 && dist < radius) {
        const falloff = Math.max(0, 1 - dist / radius);
        const mag = maxDamage * falloff * kPush;
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        const dv = mag / b.mass;

        b.vel.x = f32(b.vel.x + dv * nx);
        b.vel.y = f32(b.vel.y + dv * ny);
        b.vel.z = f32(b.vel.z + dv * nz);

        const rot = quatToMat3(b.quat);
        const { invInertia } = computeWorldInertia(rot, b.inertiaLocal);
        const lever: Vec3 = {
          x: f32(-nx * b.hx * 0.4),
          y: f32(-ny * b.hy * 0.4),
          z: f32(-b.hz * 0.5),
        };
        const impulseVec: Vec3 = {
          x: f32(nx * mag * 0.35),
          y: f32(ny * mag * 0.35),
          z: f32(nz * mag * 0.35),
        };
        const dOmega = mulMat3Vec3(invInertia, crossVec3(lever, impulseVec));
        b.angVel.x = f32(b.angVel.x + dOmega.x);
        b.angVel.y = f32(b.angVel.y + dOmega.y);
        b.angVel.z = f32(b.angVel.z + dOmega.z);

        if (typeof b.hp === 'number') {
          b.hp = Math.max(0, b.hp - Math.round(falloff * 110));
          if (b.hp <= 0) {
            this.rigidBodies.splice(i, 1);
            this.callbacks.onRigidBodyDestroyed?.(b, b.pos);
          }
        }
      }
    }

    this.checkVelocity();
    this.callbacks.onExplosion?.(sourceId, origin, radius);
  }

  public getHullHalfZ(): number {
    return (this.abi.i32[I32.FLAGS] & FL_DUCKING) !== 0 ? HULL_DUCK.hz : HULL_STAND.hz;
  }

  public teleportToSpawn(isFail = false): void {
    const { f32: vf, i32: vi } = this.abi;
    vf[F32.POS_X] = f32(this.spawn.x);
    vf[F32.POS_Y] = f32(this.spawn.y);
    vf[F32.POS_Z] = f32(this.spawn.z);
    vf[F32.PREV_X] = f32(this.spawn.x);
    vf[F32.PREV_Y] = f32(this.spawn.y);
    vf[F32.PREV_Z] = f32(this.spawn.z);
    vf[F32.VEL_X] = f32(0);
    vf[F32.VEL_Y] = f32(0);
    vf[F32.VEL_Z] = f32(0);
    this.baseVelX = f32(0);
    this.baseVelY = f32(0);
    this.baseVelZ = f32(0);
    vf[F32.YAW] = f32(this.spawn.yaw);
    vf[F32.PITCH] = f32(this.spawn.pitch);
    vf[F32.VIEW_OFS_Z] = HULL_STAND.eyeZ;
    vf[F32.PREV_VIEW_OFS_Z] = HULL_STAND.eyeZ;
    vi[I32.FLAGS] = FL_ONGROUND;
    vi[I32.MOVESTATE] = MoveState.GROUND;
    this.triggerCooldowns.clear();
    if (!isFail) {
      this.restoreVitals();
    }
    this.callbacks.onTeleport?.(isFail);
  }

  /** Half-step Velocity-Verlet gravity: v_z <- v_z - 0.5 * g_ent * g * dt */
  private applyHalfGravity(gravity: number, gravityScale = 1.0): void {
    const vf = this.abi.f32;
    vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] - 0.5 * gravityScale * gravity * FIXED_DT);
  }

  public simulateTick(): void {
    const { f32: vf, i32: vi } = this.abi;

    vf[F32.PREV_X] = vf[F32.POS_X];
    vf[F32.PREV_Y] = vf[F32.POS_Y];
    vf[F32.PREV_Z] = vf[F32.POS_Z];
    vf[F32.PREV_VIEW_OFS_Z] = vf[F32.VIEW_OFS_Z];

    vi[I32.TICK] += 1;
    vf[F32.SURF_NZ] = f32(0);

    // If dead, keep stepping VPhysics props/dropped guns while player movement is frozen
    if (this.vitals.dead) {
      if (this.rigidBodies.length > 0) {
        this.stepRigidBodies();
        this.resolveRigidBodyPairCollisions();
      }
      vi[I32.PREV_BUTTONS] = vi[I32.BUTTONS];
      return;
    }

    const wasOnGround = (vi[I32.FLAGS] & FL_ONGROUND) !== 0;
    const preVelZ = vf[F32.VEL_Z];
    const gravity = vf[F32.CVAR_GRAVITY];

    // 1. Duck / uncrouch hull update
    this.duck();

    // 2. Categorize ground/air state (walkable n_z >= 0.7)
    this.categorizePosition();

    // 3. CheckJumpButton: v_z = sqrt(2 * g * h_jump), h_jump = 45u (CS:S / GoldSrc)
    const buttons = vi[I32.BUTTONS];
    const prevButtons = vi[I32.PREV_BUTTONS];
    const autoBhop = vi[I32.AUTOBHOP] === 1;
    const jumpPressed = (buttons & IN_JUMP) !== 0;
    const freshJump = jumpPressed && (autoBhop || (prevButtons & IN_JUMP) === 0);

    if (freshJump && (vi[I32.FLAGS] & FL_ONGROUND)) {
      vi[I32.FLAGS] &= ~FL_ONGROUND;
      vf[F32.VEL_Z] = f32(Math.sqrt(2.0 * gravity * 45.0));
      this.callbacks.onJump?.();
    }

    // 4. StartGravity (first half-step)
    const isGroundedNow = (vi[I32.FLAGS] & FL_ONGROUND) !== 0;
    if (!isGroundedNow) {
      this.applyHalfGravity(gravity, 1.0);
    }

    if (this.baseVelX !== 0 || this.baseVelY !== 0 || this.baseVelZ !== 0) {
      vf[F32.VEL_X] = f32(vf[F32.VEL_X] + this.baseVelX);
      vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] + this.baseVelY);
      vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] + this.baseVelZ);
    }

    // 5. AngleVectors -> horizontal projection (f_xy, r_xy) -> wish velocity & unit wish direction
    const { forward, right } = computeAngleVectors(-vf[F32.CMD_PITCH], vf[F32.CMD_YAW], 0);
    const fLenXY = Math.hypot(forward.x, forward.y);
    const rLenXY = Math.hypot(right.x, right.y);
    const fxyX = fLenXY > 1e-6 ? forward.x / fLenXY : 0;
    const fxyY = fLenXY > 1e-6 ? forward.y / fLenXY : 0;
    const rxyX = rLenXY > 1e-6 ? right.x / rLenXY : 0;
    const rxyY = rLenXY > 1e-6 ? right.y / rLenXY : 0;

    const fmove = vf[F32.CMD_FMOVE];
    const smove = vf[F32.CMD_SMOVE];
    const maxSpeed =
      (vi[I32.FLAGS] & FL_DUCKING) && isGroundedNow
        ? f32(vf[F32.CMD_MAXSPEED] * 0.34)
        : vf[F32.CMD_MAXSPEED];

    const rawWishX = f32(fmove * fxyX + smove * rxyX);
    const rawWishY = f32(fmove * fxyY + smove * rxyY);
    const wishMag = f32(Math.hypot(rawWishX, rawWishY));
    const wishspeed = f32(Math.min(wishMag, maxSpeed));
    const wishDirX = wishMag > 1e-5 ? f32(rawWishX / wishMag) : f32(0);
    const wishDirY = wishMag > 1e-5 ? f32(rawWishY / wishMag) : f32(0);

    // 6. Ground vs Air/Surf movement branch
    let flyBlocked = 0;
    if (isGroundedNow) {
      this.friction(this.sourceConfig.surfaceFriction);
      this.walkMove(wishDirX, wishDirY, wishspeed, this.sourceConfig.surfaceFriction);
    } else {
      flyBlocked = this.airMove(wishDirX, wishDirY, wishspeed, this.sourceConfig.surfaceFriction);
    }

    if (this.baseVelX !== 0 || this.baseVelY !== 0 || this.baseVelZ !== 0) {
      vf[F32.VEL_X] = f32(vf[F32.VEL_X] - this.baseVelX);
      vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] - this.baseVelY);
      vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] - this.baseVelZ);
      this.baseVelX = f32(0);
      this.baseVelY = f32(0);
      this.baseVelZ = f32(0);
    }

    // 7. FinishGravity (second half-step) + fall damage check
    this.categorizePosition();
    const landedNow = (vi[I32.FLAGS] & FL_ONGROUND) !== 0;
    if (!landedNow) {
      this.applyHalfGravity(gravity, 1.0);
    } else {
      vf[F32.VEL_Z] = f32(0);
      if (!wasOnGround && preVelZ < -140) {
        const impact = Math.abs(preVelZ);
        this.callbacks.onLand?.(impact);
        if (impact > this.sourceConfig.fallDamageThreshold) {
          const fallDmg =
            (impact - this.sourceConfig.fallDamageThreshold) * this.sourceConfig.fallDamageScale;
          this.damagePlayer(fallDmg, 'fall');
        }
      }
    }

    // 8. VPhysics rigid bodies: semi-implicit Euler, prop-prop & player-prop impulses
    if (this.rigidBodies.length > 0) {
      this.stepRigidBodies();
      this.resolveRigidBodyPairCollisions();
      this.resolvePlayerRigidBodyCollisions();
    }

    this.checkVelocity();

    // 9. Determine telemetry state (GROUND / SURF / AIR)
    if (landedNow) {
      vi[I32.MOVESTATE] = MoveState.GROUND;
    } else if (
      (flyBlocked & 4) !== 0 ||
      (vf[F32.SURF_NZ] > 0.05 && vf[F32.SURF_NZ] < SURF_NORMAL_Z)
    ) {
      vi[I32.MOVESTATE] = MoveState.SURF;
    } else {
      vi[I32.MOVESTATE] = MoveState.AIR;
    }

    // 10. Trigger volumes
    this.checkTriggers();

    vi[I32.PREV_BUTTONS] = buttons;
  }

  /** VPhysics semi-implicit Euler integration for linear, angular, and quaternion kinematics */
  private stepRigidBodies(): void {
    const gravity = this.abi.f32[F32.CVAR_GRAVITY];
    const linKeep = f32(Math.max(0, 1.0 - this.sourceConfig.linearDamping * FIXED_DT));
    const angKeep = f32(Math.max(0, 1.0 - this.sourceConfig.angularDamping * FIXED_DT));

    const traceOut: TraceResult = {
      fraction: f32(1.0),
      endX: f32(0),
      endY: f32(0),
      endZ: f32(0),
      normalX: f32(0),
      normalY: f32(0),
      normalZ: f32(0),
      startSolid: false,
      allSolid: false,
      brushId: '',
    };

    for (let i = 0; i < this.rigidBodies.length; i++) {
      const b = this.rigidBodies[i];
      if (b.mass <= 0) continue;

      b.vel.x = f32(b.vel.x * linKeep);
      b.vel.y = f32(b.vel.y * linKeep);
      b.vel.z = f32(b.vel.z * linKeep - gravity * b.gravityScale * FIXED_DT);

      const targetX = f32(b.pos.x + b.vel.x * FIXED_DT);
      const targetY = f32(b.pos.y + b.vel.y * FIXED_DT);
      const targetZ = f32(b.pos.z + b.vel.z * FIXED_DT);

      const rot = quatToMat3(b.quat);
      const { inertia, invInertia } = computeWorldInertia(rot, b.inertiaLocal);
      const iOmega = mulMat3Vec3(inertia, b.angVel);
      const gyro = crossVec3(b.angVel, iOmega);
      const angAccel = mulMat3Vec3(invInertia, {
        x: f32(-gyro.x),
        y: f32(-gyro.y),
        z: f32(-gyro.z),
      });

      b.angVel.x = f32(b.angVel.x * angKeep + angAccel.x * FIXED_DT);
      b.angVel.y = f32(b.angVel.y * angKeep + angAccel.y * FIXED_DT);
      b.angVel.z = f32(b.angVel.z * angKeep + angAccel.z * FIXED_DT);

      const qw = b.quat.w;
      const qx = b.quat.x;
      const qy = b.quat.y;
      const qz = b.quat.z;
      const wx = b.angVel.x;
      const wy = b.angVel.y;
      const wz = b.angVel.z;

      const dw = f32(-0.5 * (wx * qx + wy * qy + wz * qz) * FIXED_DT);
      const dx = f32(0.5 * (wx * qw + wy * qz - wz * qy) * FIXED_DT);
      const dy = f32(0.5 * (-wx * qz + wy * qw + wz * qx) * FIXED_DT);
      const dz = f32(0.5 * (wx * qy - wy * qx + wz * qw) * FIXED_DT);

      b.quat = normalizeQuat({
        w: f32(qw + dw),
        x: f32(qx + dx),
        y: f32(qy + dy),
        z: f32(qz + dz),
      });

      this.traceWorld(b.pos.x, b.pos.y, b.pos.z, targetX, targetY, targetZ, b.hx, b.hy, b.hz, traceOut);

      b.pos.x = traceOut.endX;
      b.pos.y = traceOut.endY;
      b.pos.z = traceOut.endZ;

      if (traceOut.fraction < 1.0) {
        const n: Vec3 = { x: traceOut.normalX, y: traceOut.normalY, z: traceOut.normalZ };
        const vn = dotVec3(b.vel, n);
        if (vn < 0) {
          const bounce = f32(1.0 + Math.max(b.restitution, this.sourceConfig.svBounce));
          const impactJ = Math.abs(vn) * b.mass;
          b.vel.x = f32(b.vel.x - n.x * vn * bounce);
          b.vel.y = f32(b.vel.y - n.y * vn * bounce);
          b.vel.z = f32(b.vel.z - n.z * vn * bounce);

          const mu = b.surfaceFriction ?? this.sourceConfig.surfaceFriction;
          const damp = f32(Math.max(0, 1.0 - 0.14 * mu));
          b.vel.x = f32(b.vel.x * damp);
          b.vel.y = f32(b.vel.y * damp);
          b.angVel.x = f32(b.angVel.x * 0.84);
          b.angVel.y = f32(b.angVel.y * 0.84);
          b.angVel.z = f32(b.angVel.z * 0.84);

          if (impactJ > 260) {
            this.callbacks.onRigidBodyHit?.(b.id, impactJ, b.pos, b.kind ?? 'prop');
          }

          if (n.z >= SURF_NORMAL_Z && Math.abs(b.vel.z) < 16) {
            b.vel.z = f32(0);
          }
        }
      }
    }
  }

  /** Full 2-body rigid-body collision impulse solver */
  private resolveRigidBodyPairCollisions(): void {
    const count = this.rigidBodies.length;
    for (let i = 0; i < count; i++) {
      const a = this.rigidBodies[i];
      if (a.mass <= 0) continue;
      const invMassA = 1 / a.mass;

      for (let j = i + 1; j < count; j++) {
        const b = this.rigidBodies[j];
        if (b.mass <= 0) continue;

        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const dz = b.pos.z - a.pos.z;

        const overlapX = a.hx + b.hx - Math.abs(dx);
        const overlapY = a.hy + b.hy - Math.abs(dy);
        const overlapZ = a.hz + b.hz - Math.abs(dz);

        if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue;

        let nx = 0;
        let ny = 0;
        let nz = 0;
        let pen = 0;

        if (overlapX < overlapY && overlapX < overlapZ) {
          pen = overlapX;
          nx = dx >= 0 ? 1 : -1;
        } else if (overlapY < overlapZ) {
          pen = overlapY;
          ny = dy >= 0 ? 1 : -1;
        } else {
          pen = overlapZ;
          nz = dz >= 0 ? 1 : -1;
        }

        const n: Vec3 = { x: f32(nx), y: f32(ny), z: f32(nz) };
        const invMassB = 1 / b.mass;
        const totalInvMass = invMassA + invMassB;
        const aShare = invMassA / totalInvMass;
        const bShare = invMassB / totalInvMass;

        a.pos.x = f32(a.pos.x - n.x * pen * aShare);
        a.pos.y = f32(a.pos.y - n.y * pen * aShare);
        a.pos.z = f32(a.pos.z - n.z * pen * aShare);

        b.pos.x = f32(b.pos.x + n.x * pen * bShare);
        b.pos.y = f32(b.pos.y + n.y * pen * bShare);
        b.pos.z = f32(b.pos.z + n.z * pen * bShare);

        const contact: Vec3 = {
          x: f32((Math.max(a.pos.x - a.hx, b.pos.x - b.hx) + Math.min(a.pos.x + a.hx, b.pos.x + b.hx)) * 0.5),
          y: f32((Math.max(a.pos.y - a.hy, b.pos.y - b.hy) + Math.min(a.pos.y + a.hy, b.pos.y + b.hy)) * 0.5),
          z: f32((Math.max(a.pos.z - a.hz, b.pos.z - b.hz) + Math.min(a.pos.z + a.hz, b.pos.z + b.hz)) * 0.5),
        };
        const rA: Vec3 = { x: f32(contact.x - a.pos.x), y: f32(contact.y - a.pos.y), z: f32(contact.z - a.pos.z) };
        const rB: Vec3 = { x: f32(contact.x - b.pos.x), y: f32(contact.y - b.pos.y), z: f32(contact.z - b.pos.z) };

        const { invInertia: invIA } = computeWorldInertia(quatToMat3(a.quat), a.inertiaLocal);
        const { invInertia: invIB } = computeWorldInertia(quatToMat3(b.quat), b.inertiaLocal);

        const wA = crossVec3(a.angVel, rA);
        const wB = crossVec3(b.angVel, rB);
        const vRel: Vec3 = {
          x: f32((b.vel.x + wB.x) - (a.vel.x + wA.x)),
          y: f32((b.vel.y + wB.y) - (a.vel.y + wA.y)),
          z: f32((b.vel.z + wB.z) - (a.vel.z + wA.z)),
        };

        const vRelDotN = dotVec3(vRel, n);
        if (vRelDotN >= 0) continue;

        const angTermA = dotVec3(crossVec3(mulMat3Vec3(invIA, crossVec3(rA, n)), rA), n);
        const angTermB = dotVec3(crossVec3(mulMat3Vec3(invIB, crossVec3(rB, n)), rB), n);

        const e = Math.min(a.restitution, b.restitution);
        const denom = invMassA + invMassB + angTermA + angTermB;
        if (denom <= 1e-8) continue;

        const imp = f32((-(1 + e) * vRelDotN) / denom);
        const jn: Vec3 = { x: f32(imp * n.x), y: f32(imp * n.y), z: f32(imp * n.z) };

        a.vel.x = f32(a.vel.x - jn.x * invMassA);
        a.vel.y = f32(a.vel.y - jn.y * invMassA);
        a.vel.z = f32(a.vel.z - jn.z * invMassA);

        b.vel.x = f32(b.vel.x + jn.x * invMassB);
        b.vel.y = f32(b.vel.y + jn.y * invMassB);
        b.vel.z = f32(b.vel.z + jn.z * invMassB);

        const dOmegaA = mulMat3Vec3(invIA, crossVec3(rA, jn));
        a.angVel.x = f32(a.angVel.x - dOmegaA.x);
        a.angVel.y = f32(a.angVel.y - dOmegaA.y);
        a.angVel.z = f32(a.angVel.z - dOmegaA.z);

        const dOmegaB = mulMat3Vec3(invIB, crossVec3(rB, jn));
        b.angVel.x = f32(b.angVel.x + dOmegaB.x);
        b.angVel.y = f32(b.angVel.y + dOmegaB.y);
        b.angVel.z = f32(b.angVel.z + dOmegaB.z);
      }
    }
  }

  /** Player hull vs non-weapon VPhysics rigid-body collision impulse */
  private resolvePlayerRigidBodyCollisions(): void {
    const vf = this.abi.f32;
    const phx = HULL_STAND.hx;
    const phy = HULL_STAND.hy;
    const phz = this.getHullHalfZ();

    const pPos: Vec3 = { x: vf[F32.POS_X], y: vf[F32.POS_Y], z: vf[F32.POS_Z] };
    const pVel: Vec3 = { x: vf[F32.VEL_X], y: vf[F32.VEL_Y], z: vf[F32.VEL_Z] };
    const pMass = Math.max(1, this.sourceConfig.playerMass);
    const pInvMass = 1 / pMass;

    for (let i = 0; i < this.rigidBodies.length; i++) {
      const b = this.rigidBodies[i];
      if (b.mass <= 0 || b.kind === 'weapon') continue;

      const dx = b.pos.x - pPos.x;
      const dy = b.pos.y - pPos.y;
      const dz = b.pos.z - pPos.z;

      const overlapX = phx + b.hx - Math.abs(dx);
      const overlapY = phy + b.hy - Math.abs(dy);
      const overlapZ = phz + b.hz - Math.abs(dz);

      if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue;

      let nx = 0;
      let ny = 0;
      let nz = 0;
      let pen = 0;

      if (overlapX < overlapY && overlapX < overlapZ) {
        pen = overlapX;
        nx = dx >= 0 ? 1 : -1;
      } else if (overlapY < overlapZ) {
        pen = overlapY;
        ny = dy >= 0 ? 1 : -1;
      } else {
        pen = overlapZ;
        nz = dz >= 0 ? 1 : -1;
      }

      const n: Vec3 = { x: f32(nx), y: f32(ny), z: f32(nz) };
      const bInvMass = 1 / b.mass;
      const totalInvMass = pInvMass + bInvMass;
      const pShare = pInvMass / totalInvMass;
      const bShare = bInvMass / totalInvMass;

      pPos.x = f32(pPos.x - n.x * pen * pShare);
      pPos.y = f32(pPos.y - n.y * pen * pShare);
      pPos.z = f32(pPos.z - n.z * pen * pShare);

      b.pos.x = f32(b.pos.x + n.x * pen * bShare);
      b.pos.y = f32(b.pos.y + n.y * pen * bShare);
      b.pos.z = f32(b.pos.z + n.z * pen * bShare);

      const contact: Vec3 = {
        x: f32((Math.max(pPos.x - phx, b.pos.x - b.hx) + Math.min(pPos.x + phx, b.pos.x + b.hx)) * 0.5),
        y: f32((Math.max(pPos.y - phy, b.pos.y - b.hy) + Math.min(pPos.y + phy, b.pos.y + b.hy)) * 0.5),
        z: f32((Math.max(pPos.z - phz, b.pos.z - b.hz) + Math.min(pPos.z + phz, b.pos.z + b.hz)) * 0.5),
      };
      const rB: Vec3 = {
        x: f32(contact.x - b.pos.x),
        y: f32(contact.y - b.pos.y),
        z: f32(contact.z - b.pos.z),
      };

      const { invInertia: invIB } = computeWorldInertia(quatToMat3(b.quat), b.inertiaLocal);

      const omegaCrossRB = crossVec3(b.angVel, rB);
      const vRel: Vec3 = {
        x: f32((b.vel.x + omegaCrossRB.x) - pVel.x),
        y: f32((b.vel.y + omegaCrossRB.y) - pVel.y),
        z: f32((b.vel.z + omegaCrossRB.z) - pVel.z),
      };

      const vRelDotN = dotVec3(vRel, n);
      if (vRelDotN >= 0) continue;

      const angTermB = dotVec3(crossVec3(mulMat3Vec3(invIB, crossVec3(rB, n)), rB), n);
      const e = Math.max(b.restitution, this.sourceConfig.svBounce);
      const denom = pInvMass + bInvMass + angTermB;
      if (denom <= 1e-8) continue;

      const j = f32((-(1 + e) * vRelDotN) / denom);
      const jn: Vec3 = { x: f32(j * n.x), y: f32(j * n.y), z: f32(j * n.z) };

      pVel.x = f32(pVel.x - jn.x * pInvMass);
      pVel.y = f32(pVel.y - jn.y * pInvMass);
      pVel.z = f32(pVel.z - jn.z * pInvMass);

      b.vel.x = f32(b.vel.x + jn.x * bInvMass);
      b.vel.y = f32(b.vel.y + jn.y * bInvMass);
      b.vel.z = f32(b.vel.z + jn.z * bInvMass);

      const dOmegaB = mulMat3Vec3(invIB, crossVec3(rB, jn));
      b.angVel.x = f32(b.angVel.x + dOmegaB.x);
      b.angVel.y = f32(b.angVel.y + dOmegaB.y);
      b.angVel.z = f32(b.angVel.z + dOmegaB.z);

      this.callbacks.onRigidBodyHit?.(b.id, Math.abs(j), contact, b.kind ?? 'prop');
    }

    vf[F32.POS_X] = pPos.x;
    vf[F32.POS_Y] = pPos.y;
    vf[F32.POS_Z] = pPos.z;
    vf[F32.VEL_X] = pVel.x;
    vf[F32.VEL_Y] = pVel.y;
    vf[F32.VEL_Z] = pVel.z;
  }

  /** BSP Minkowski plane expansion + swept point ray test with DIST_EPSILON (1/32u) */
  private clipBoxToBrush(
    brush: ConvexBrush,
    sX: number,
    sY: number,
    sZ: number,
    eX: number,
    eY: number,
    eZ: number,
    hx: number,
    hy: number,
    hz: number,
    trace: TraceResult,
  ): void {
    let enterFrac = f32(-1.0);
    let leaveFrac = f32(1.0);
    let clipPlane: { nx: number; ny: number; nz: number } | null = null;
    let startsOut = false;
    let getsOut = false;

    const planes = brush.planes;
    for (let i = 0; i < planes.length; i++) {
      const p = planes[i];
      const offset = f32(Math.abs(p.nx) * hx + Math.abs(p.ny) * hy + Math.abs(p.nz) * hz);
      const dShifted = f32(p.d + offset);
      const s1 = f32(p.nx * sX + p.ny * sY + p.nz * sZ - dShifted);
      const s2 = f32(p.nx * eX + p.ny * eY + p.nz * eZ - dShifted);

      if (s1 > 0) startsOut = true;
      if (s2 > 0) getsOut = true;

      if (s1 > 0 && (s2 >= DIST_EPSILON || s2 >= s1)) return;
      if (s1 <= 0 && s2 <= 0) continue;

      if (s1 > s2) {
        let f = f32((s1 - DIST_EPSILON) / (s1 - s2));
        if (f < 0) f = f32(0);
        if (f > enterFrac) {
          enterFrac = f;
          clipPlane = p;
        }
      } else {
        let f = f32((s1 + DIST_EPSILON) / (s1 - s2));
        if (f > 1) f = f32(1);
        if (f < leaveFrac) {
          leaveFrac = f;
        }
      }
    }

    if (!startsOut) {
      trace.startSolid = true;
      if (!getsOut) trace.allSolid = true;
      return;
    }

    if (enterFrac < leaveFrac && enterFrac > -1 && enterFrac < trace.fraction && clipPlane) {
      if (enterFrac < 0) enterFrac = f32(0);
      trace.fraction = enterFrac;
      trace.normalX = clipPlane.nx;
      trace.normalY = clipPlane.ny;
      trace.normalZ = clipPlane.nz;
      trace.brushId = brush.id;
    }
  }

  private traceWorld(
    sX: number,
    sY: number,
    sZ: number,
    eX: number,
    eY: number,
    eZ: number,
    hx: number,
    hy: number,
    hz: number,
    out: TraceResult = this.traceScratch,
  ): TraceResult {
    out.fraction = f32(1.0);
    out.startSolid = false;
    out.allSolid = false;
    out.normalX = f32(0);
    out.normalY = f32(0);
    out.normalZ = f32(0);
    out.brushId = '';

    const pad = f32(2.0);
    const bMinX = Math.min(sX, eX) - hx - pad;
    const bMinY = Math.min(sY, eY) - hy - pad;
    const bMinZ = Math.min(sZ, eZ) - hz - pad;
    const bMaxX = Math.max(sX, eX) + hx + pad;
    const bMaxY = Math.max(sY, eY) + hy + pad;
    const bMaxZ = Math.max(sZ, eZ) + hz + pad;

    for (let i = 0; i < this.brushes.length; i++) {
      const br = this.brushes[i];
      if (
        bMaxX < br.minX ||
        bMinX > br.maxX ||
        bMaxY < br.minY ||
        bMinY > br.maxY ||
        bMaxZ < br.minZ ||
        bMinZ > br.maxZ
      ) {
        continue;
      }
      this.clipBoxToBrush(br, sX, sY, sZ, eX, eY, eZ, hx, hy, hz, out);
    }

    out.endX = f32(sX + (eX - sX) * out.fraction);
    out.endY = f32(sY + (eY - sY) * out.fraction);
    out.endZ = f32(sZ + (eZ - sZ) * out.fraction);
    return out;
  }

  /** ClipVelocity: v' = v - (v . n) * beta * n */
  private clipVelocity(
    inX: number,
    inY: number,
    inZ: number,
    nx: number,
    ny: number,
    nz: number,
    overbounce: number,
  ): void {
    const backoff = f32((inX * nx + inY * ny + inZ * nz) * overbounce);
    let ox = f32(inX - nx * backoff);
    let oy = f32(inY - ny * backoff);
    let oz = f32(inZ - nz * backoff);

    const adjust = f32(ox * nx + oy * ny + oz * nz);
    if (adjust < 0) {
      ox = f32(ox - nx * adjust);
      oy = f32(oy - ny * adjust);
      oz = f32(oz - nz * adjust);
    }

    if (ox > -STOP_EPSILON && ox < STOP_EPSILON) ox = f32(0);
    if (oy > -STOP_EPSILON && oy < STOP_EPSILON) oy = f32(0);
    if (oz > -STOP_EPSILON && oz < STOP_EPSILON) oz = f32(0);

    this.clipOut[0] = ox;
    this.clipOut[1] = oy;
    this.clipOut[2] = oz;
  }

  private checkVelocity(): void {
    const vf = this.abi.f32;
    const maxv = Math.max(vf[F32.CVAR_MAXVEL], this.sourceConfig.sourceMaxVelocity);

    for (let i = 0; i < 3; i++) {
      let v = vf[F32.VEL_X + i];
      if (!Number.isFinite(v)) v = f32(0);
      if (v > maxv) v = f32(maxv);
      else if (v < -maxv) v = f32(-maxv);
      vf[F32.VEL_X + i] = f32(v);
    }

    const total = Math.hypot(vf[F32.VEL_X], vf[F32.VEL_Y], vf[F32.VEL_Z]);
    if (total > maxv && total > 0) {
      const s = f32(maxv / total);
      vf[F32.VEL_X] = f32(vf[F32.VEL_X] * s);
      vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] * s);
      vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] * s);
    }
  }

  /** AirAccelerate: v_cap = min(v_wish, 30), v_add = v_cap - (v . w_hat) */
  private airAccelerate(
    wishDirX: number,
    wishDirY: number,
    wishDirZ: number,
    wishspeed: number,
    accel: number,
    surfaceFriction: number,
  ): void {
    const vf = this.abi.f32;
    const wishCap = wishspeed > AIR_WISH_CAP ? AIR_WISH_CAP : wishspeed;
    const vDotWish = f32(
      vf[F32.VEL_X] * wishDirX + vf[F32.VEL_Y] * wishDirY + vf[F32.VEL_Z] * wishDirZ,
    );
    const addspeed = f32(wishCap - vDotWish);
    if (addspeed <= 0) return;

    let accelspeed = f32(accel * FIXED_DT * wishspeed * surfaceFriction);
    if (accelspeed > addspeed) accelspeed = addspeed;

    vf[F32.VEL_X] = f32(vf[F32.VEL_X] + accelspeed * wishDirX);
    vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] + accelspeed * wishDirY);
    vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] + accelspeed * wishDirZ);
  }

  /** Ground Accelerate: v_add = v_wish - (v . w_hat) */
  private accelerate(
    wishDirX: number,
    wishDirY: number,
    wishDirZ: number,
    wishspeed: number,
    accel: number,
    surfaceFriction: number,
  ): void {
    const vf = this.abi.f32;
    const vDotWish = f32(
      vf[F32.VEL_X] * wishDirX + vf[F32.VEL_Y] * wishDirY + vf[F32.VEL_Z] * wishDirZ,
    );
    const addspeed = f32(wishspeed - vDotWish);
    if (addspeed <= 0) return;

    let accelspeed = f32(accel * FIXED_DT * wishspeed * surfaceFriction);
    if (accelspeed > addspeed) accelspeed = addspeed;

    vf[F32.VEL_X] = f32(vf[F32.VEL_X] + accelspeed * wishDirX);
    vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] + accelspeed * wishDirY);
    vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] + accelspeed * wishDirZ);
  }

  /** Ground Friction with sv_stopspeed, sv_friction, mu_surface, and leading-edge drop-off */
  private friction(surfaceFriction: number): void {
    const vf = this.abi.f32;
    const vx = vf[F32.VEL_X];
    const vy = vf[F32.VEL_Y];
    const vz = vf[F32.VEL_Z];
    const vHoriz = f32(Math.hypot(vx, vy));
    if (vHoriz < 0.1) return;

    let kFriction = vf[F32.CVAR_FRICTION];
    const hz = this.getHullHalfZ();

    const leadX = f32(vf[F32.POS_X] + (vx / vHoriz) * 16.0);
    const leadY = f32(vf[F32.POS_Y] + (vy / vHoriz) * 16.0);
    const leadZ = f32(vf[F32.POS_Z] - hz + 1.0);
    const edgeTrace = this.traceWorld(
      leadX,
      leadY,
      leadZ,
      leadX,
      leadY,
      f32(leadZ - 34.0),
      f32(1),
      f32(1),
      f32(1),
    );
    if (edgeTrace.fraction === 1.0) {
      kFriction = f32(kFriction * vf[F32.CVAR_EDGEFRIC]);
    }

    const stopspeed = vf[F32.CVAR_STOPSPEED];
    const control = vHoriz < stopspeed ? stopspeed : vHoriz;
    const drop = f32(control * kFriction * surfaceFriction * FIXED_DT);
    const scale = f32(Math.max(vHoriz - drop, 0) / vHoriz);

    vf[F32.VEL_X] = f32(vx * scale);
    vf[F32.VEL_Y] = f32(vy * scale);
    vf[F32.VEL_Z] = f32(vz);
  }

  /** TryPlayerMove / PM_FlyMove: multi-plane iterative sliding with crease cross-product */
  private flyMove(): number {
    const vf = this.abi.f32;
    const hz = this.getHullHalfZ();

    const origX = vf[F32.VEL_X];
    const origY = vf[F32.VEL_Y];
    const origZ = vf[F32.VEL_Z];
    const primalX = origX;
    const primalY = origY;
    const primalZ = origZ;
    let curOrigX = origX;
    let curOrigY = origY;
    let curOrigZ = origZ;

    let timeLeft = FIXED_DT;
    let numPlanes = 0;
    let blocked = 0;
    let surfHitNz = f32(0);

    for (let bump = 0; bump < 4; bump++) {
      if (vf[F32.VEL_X] === 0 && vf[F32.VEL_Y] === 0 && vf[F32.VEL_Z] === 0) break;

      const pX = vf[F32.POS_X];
      const pY = vf[F32.POS_Y];
      const pZ = vf[F32.POS_Z];
      const eX = f32(pX + vf[F32.VEL_X] * timeLeft);
      const eY = f32(pY + vf[F32.VEL_Y] * timeLeft);
      const eZ = f32(pZ + vf[F32.VEL_Z] * timeLeft);

      const tr = this.traceWorld(pX, pY, pZ, eX, eY, eZ, HULL_STAND.hx, HULL_STAND.hy, hz);

      if (tr.allSolid) {
        vf[F32.VEL_X] = f32(0);
        vf[F32.VEL_Y] = f32(0);
        vf[F32.VEL_Z] = f32(0);
        return 4;
      }

      if (tr.fraction > 0) {
        vf[F32.POS_X] = tr.endX;
        vf[F32.POS_Y] = tr.endY;
        vf[F32.POS_Z] = tr.endZ;
        curOrigX = vf[F32.VEL_X];
        curOrigY = vf[F32.VEL_Y];
        curOrigZ = vf[F32.VEL_Z];
        numPlanes = 0;
      }

      if (tr.fraction === 1.0) break;

      if (tr.normalZ >= SURF_NORMAL_Z) {
        blocked |= 1;
      } else if (tr.normalZ > 0.05) {
        blocked |= 4;
        surfHitNz = tr.normalZ;
      } else {
        blocked |= 2;
      }

      timeLeft = f32(timeLeft - timeLeft * tr.fraction);

      if (numPlanes >= MAX_CLIP_PLANES) {
        vf[F32.VEL_X] = f32(0);
        vf[F32.VEL_Y] = f32(0);
        vf[F32.VEL_Z] = f32(0);
        break;
      }

      let duplicate = false;
      for (let i = 0; i < numPlanes; i++) {
        if (
          this.planesX[i] * tr.normalX +
            this.planesY[i] * tr.normalY +
            this.planesZ[i] * tr.normalZ >
          0.99
        ) {
          vf[F32.VEL_X] = f32(vf[F32.VEL_X] + tr.normalX * 0.5);
          vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] + tr.normalY * 0.5);
          vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] + tr.normalZ * 0.5);
          duplicate = true;
          break;
        }
      }
      if (duplicate) continue;

      this.planesX[numPlanes] = tr.normalX;
      this.planesY[numPlanes] = tr.normalY;
      this.planesZ[numPlanes] = tr.normalZ;
      numPlanes++;

      const overbounce =
        this.sourceConfig.svBounce > 0 && tr.normalZ < SURF_NORMAL_Z
          ? f32(1.0 + this.sourceConfig.svBounce)
          : f32(1.0);

      let i = 0;
      for (; i < numPlanes; i++) {
        this.clipVelocity(
          curOrigX,
          curOrigY,
          curOrigZ,
          this.planesX[i],
          this.planesY[i],
          this.planesZ[i],
          overbounce,
        );
        let j = 0;
        for (; j < numPlanes; j++) {
          if (j === i) continue;
          if (
            this.clipOut[0] * this.planesX[j] +
              this.clipOut[1] * this.planesY[j] +
              this.clipOut[2] * this.planesZ[j] <
            0
          ) {
            break;
          }
        }
        if (j === numPlanes) break;
      }

      if (i !== numPlanes) {
        vf[F32.VEL_X] = this.clipOut[0];
        vf[F32.VEL_Y] = this.clipOut[1];
        vf[F32.VEL_Z] = this.clipOut[2];
      } else {
        if (numPlanes !== 2) {
          vf[F32.VEL_X] = f32(0);
          vf[F32.VEL_Y] = f32(0);
          vf[F32.VEL_Z] = f32(0);
          break;
        }
        let dirX = this.planesY[0] * this.planesZ[1] - this.planesZ[0] * this.planesY[1];
        let dirY = this.planesZ[0] * this.planesX[1] - this.planesX[0] * this.planesZ[1];
        let dirZ = this.planesX[0] * this.planesY[1] - this.planesY[0] * this.planesX[1];
        const dLen = Math.hypot(dirX, dirY, dirZ);
        if (dLen > 1e-5) {
          dirX /= dLen;
          dirY /= dLen;
          dirZ /= dLen;
          const d = f32(dirX * vf[F32.VEL_X] + dirY * vf[F32.VEL_Y] + dirZ * vf[F32.VEL_Z]);
          vf[F32.VEL_X] = f32(dirX * d);
          vf[F32.VEL_Y] = f32(dirY * d);
          vf[F32.VEL_Z] = f32(dirZ * d);
        } else {
          vf[F32.VEL_X] = f32(0);
          vf[F32.VEL_Y] = f32(0);
          vf[F32.VEL_Z] = f32(0);
          break;
        }
      }

      if (vf[F32.VEL_X] * primalX + vf[F32.VEL_Y] * primalY + vf[F32.VEL_Z] * primalZ <= 0) {
        vf[F32.VEL_X] = f32(0);
        vf[F32.VEL_Y] = f32(0);
        vf[F32.VEL_Z] = f32(0);
        break;
      }
    }

    if (surfHitNz > 0) vf[F32.SURF_NZ] = surfHitNz;
    return blocked;
  }

  private categorizePosition(): void {
    const { f32: vf, i32: vi } = this.abi;
    const hz = this.getHullHalfZ();
    const pX = vf[F32.POS_X];
    const pY = vf[F32.POS_Y];
    const pZ = vf[F32.POS_Z];

    if (vf[F32.VEL_Z] > 180.0) {
      vi[I32.FLAGS] &= ~FL_ONGROUND;
      return;
    }

    const tr = this.traceWorld(pX, pY, pZ, pX, pY, f32(pZ - 2.0), HULL_STAND.hx, HULL_STAND.hy, hz);
    if (tr.fraction === 1.0 || tr.normalZ < SURF_NORMAL_Z) {
      vi[I32.FLAGS] &= ~FL_ONGROUND;
      if (tr.fraction < 1.0 && tr.normalZ > 0.05 && tr.normalZ < SURF_NORMAL_Z) {
        vf[F32.SURF_NZ] = tr.normalZ;
      }
    } else {
      vi[I32.FLAGS] |= FL_ONGROUND;
      if (!tr.startSolid && !tr.allSolid && vf[F32.VEL_Z] <= 0) {
        vf[F32.POS_X] = tr.endX;
        vf[F32.POS_Y] = tr.endY;
        vf[F32.POS_Z] = tr.endZ;
      }
    }
  }

  private duck(): void {
    const { f32: vf, i32: vi } = this.abi;
    const wantDuck = (vi[I32.BUTTONS] & IN_DUCK) !== 0;
    const isDucking = (vi[I32.FLAGS] & FL_DUCKING) !== 0;
    const onGround = (vi[I32.FLAGS] & FL_ONGROUND) !== 0;

    if (wantDuck && !isDucking) {
      vi[I32.FLAGS] |= FL_DUCKING;
      if (onGround) {
        vf[F32.POS_Z] = f32(vf[F32.POS_Z] - 18.0);
      }
    } else if (!wantDuck && isDucking) {
      const pX = vf[F32.POS_X];
      const pY = vf[F32.POS_Y];
      const pZ = vf[F32.POS_Z];
      const testZ = onGround ? f32(pZ + 18.0) : pZ;
      const tr = this.traceWorld(
        pX,
        pY,
        testZ,
        pX,
        pY,
        testZ,
        HULL_STAND.hx,
        HULL_STAND.hy,
        HULL_STAND.hz,
      );
      if (!tr.startSolid && !tr.allSolid) {
        vi[I32.FLAGS] &= ~FL_DUCKING;
        vf[F32.POS_Z] = testZ;
      } else if (!onGround) {
        const trAlt = this.traceWorld(
          pX,
          pY,
          f32(pZ - 18.0),
          pX,
          pY,
          f32(pZ - 18.0),
          HULL_STAND.hx,
          HULL_STAND.hy,
          HULL_STAND.hz,
        );
        if (!trAlt.startSolid && !trAlt.allSolid) {
          vi[I32.FLAGS] &= ~FL_DUCKING;
          vf[F32.POS_Z] = f32(pZ - 18.0);
        }
      }
    }

    const targetEye = (vi[I32.FLAGS] & FL_DUCKING) !== 0 ? HULL_DUCK.eyeZ : HULL_STAND.eyeZ;
    vf[F32.VIEW_OFS_Z] = f32(vf[F32.VIEW_OFS_Z] + (targetEye - vf[F32.VIEW_OFS_Z]) * 0.28);
  }

  /** StepMove / WalkMove: compares Path A (slide) vs Path B (step up 18u, move, drop down) */
  private walkMove(
    wishDirX: number,
    wishDirY: number,
    wishspeed: number,
    surfaceFriction: number,
  ): void {
    const vf = this.abi.f32;
    vf[F32.VEL_Z] = f32(0);
    this.accelerate(wishDirX, wishDirY, f32(0), wishspeed, vf[F32.CVAR_ACCEL], surfaceFriction);
    this.checkVelocity();

    const vx = vf[F32.VEL_X];
    const vy = vf[F32.VEL_Y];
    if (Math.hypot(vx, vy) < 0.01) return;

    const hz = this.getHullHalfZ();
    const startX = vf[F32.POS_X];
    const startY = vf[F32.POS_Y];
    const startZ = vf[F32.POS_Z];
    const destX = f32(startX + vx * FIXED_DT);
    const destY = f32(startY + vy * FIXED_DT);

    const tr = this.traceWorld(
      startX,
      startY,
      startZ,
      destX,
      destY,
      startZ,
      HULL_STAND.hx,
      HULL_STAND.hy,
      hz,
    );
    if (tr.fraction === 1.0) {
      vf[F32.POS_X] = tr.endX;
      vf[F32.POS_Y] = tr.endY;
      vf[F32.POS_Z] = tr.endZ;
      return;
    }

    const origVX = vf[F32.VEL_X];
    const origVY = vf[F32.VEL_Y];
    const origVZ = vf[F32.VEL_Z];
    this.flyMove();
    const downX = vf[F32.POS_X];
    const downY = vf[F32.POS_Y];
    const downZ = vf[F32.POS_Z];
    const downVX = vf[F32.VEL_X];
    const downVY = vf[F32.VEL_Y];
    const downVZ = vf[F32.VEL_Z];
    const downDistSq = (downX - startX) ** 2 + (downY - startY) ** 2;

    vf[F32.POS_X] = startX;
    vf[F32.POS_Y] = startY;
    vf[F32.POS_Z] = startZ;
    vf[F32.VEL_X] = origVX;
    vf[F32.VEL_Y] = origVY;
    vf[F32.VEL_Z] = origVZ;

    const upTr = this.traceWorld(
      startX,
      startY,
      startZ,
      startX,
      startY,
      f32(startZ + STEPSIZE),
      HULL_STAND.hx,
      HULL_STAND.hy,
      hz,
    );
    if (!upTr.startSolid && !upTr.allSolid) {
      vf[F32.POS_X] = upTr.endX;
      vf[F32.POS_Y] = upTr.endY;
      vf[F32.POS_Z] = upTr.endZ;
      this.flyMove();

      const dropTr = this.traceWorld(
        vf[F32.POS_X],
        vf[F32.POS_Y],
        vf[F32.POS_Z],
        vf[F32.POS_X],
        vf[F32.POS_Y],
        f32(vf[F32.POS_Z] - STEPSIZE - 2.0),
        HULL_STAND.hx,
        HULL_STAND.hy,
        hz,
      );
      if (!dropTr.allSolid && dropTr.normalZ >= SURF_NORMAL_Z) {
        vf[F32.POS_X] = dropTr.endX;
        vf[F32.POS_Y] = dropTr.endY;
        vf[F32.POS_Z] = dropTr.endZ;
      }
      const upDistSq = (vf[F32.POS_X] - startX) ** 2 + (vf[F32.POS_Y] - startY) ** 2;
      if (upDistSq > downDistSq + 0.01 && dropTr.normalZ >= SURF_NORMAL_Z) {
        return;
      }
    }

    vf[F32.POS_X] = downX;
    vf[F32.POS_Y] = downY;
    vf[F32.POS_Z] = downZ;
    vf[F32.VEL_X] = downVX;
    vf[F32.VEL_Y] = downVY;
    vf[F32.VEL_Z] = downVZ;
  }

  private airMove(
    wishDirX: number,
    wishDirY: number,
    wishspeed: number,
    surfaceFriction: number,
  ): number {
    this.airAccelerate(
      wishDirX,
      wishDirY,
      f32(0),
      wishspeed,
      this.abi.f32[F32.CVAR_AIRACCEL],
      surfaceFriction,
    );
    this.checkVelocity();
    return this.flyMove();
  }

  private checkTriggers(): void {
    const { f32: vf, i32: vi } = this.abi;
    const hz = this.getHullHalfZ();
    const pMinX = vf[F32.POS_X] - HULL_STAND.hx;
    const pMaxX = vf[F32.POS_X] + HULL_STAND.hx;
    const pMinY = vf[F32.POS_Y] - HULL_STAND.hy;
    const pMaxY = vf[F32.POS_Y] + HULL_STAND.hy;
    const pMinZ = vf[F32.POS_Z] - hz;
    const pMaxZ = vf[F32.POS_Z] + hz;
    const tick = vi[I32.TICK];

    for (let i = 0; i < this.triggers.length; i++) {
      const t = this.triggers[i];
      if (
        pMaxX < t.minX ||
        pMinX > t.maxX ||
        pMaxY < t.minY ||
        pMinY > t.maxY ||
        pMaxZ < t.minZ ||
        pMinZ > t.maxZ
      ) {
        continue;
      }

      if (t.type === 'start') {
        this.callbacks.onStartRun?.();
      } else if (t.type === 'checkpoint') {
        const index = (t.meta?.index as number | undefined) ?? 1;
        this.callbacks.onCheckpoint?.({
          index,
          label: (t.meta?.label as string | undefined) ?? `STAGE ${index}`,
          x: (t.meta?.respawnX as number | undefined) ?? (t.minX + t.maxX) * 0.5,
          y: (t.meta?.respawnY as number | undefined) ?? (t.minY + t.maxY) * 0.5,
          z: (t.meta?.respawnZ as number | undefined) ?? t.minZ + 38,
          yaw: (t.meta?.respawnYaw as number | undefined) ?? vf[F32.CMD_YAW],
          pitch: (t.meta?.respawnPitch as number | undefined) ?? 0,
          velX: (t.meta?.respawnVelX as number | undefined) ?? 0,
          velY: (t.meta?.respawnVelY as number | undefined) ?? 0,
          velZ: (t.meta?.respawnVelZ as number | undefined) ?? 0,
        });
      } else if (t.type === 'end') {
        this.callbacks.onFinishRun?.();
      } else if (t.type === 'teleport') {
        this.damagePlayer(18, 'hazard');
        if (!this.vitals.dead) {
          this.teleportToSpawn(true);
        }
        return;
      } else if (t.type === 'explosion') {
        const cooldown = (t.meta?.cooldownTicks as number | undefined) ?? 40;
        const lastTick = this.triggerCooldowns.get(t.id) ?? -999;
        if (tick - lastTick >= cooldown) {
          this.triggerCooldowns.set(t.id, tick);
          const origin: Vec3 = {
            x: f32((t.meta?.originX as number | undefined) ?? (t.minX + t.maxX) * 0.5),
            y: f32((t.meta?.originY as number | undefined) ?? (t.minY + t.maxY) * 0.5),
            z: f32((t.meta?.originZ as number | undefined) ?? (t.minZ + t.maxZ) * 0.5),
          };
          const maxDamage = (t.meta?.maxDamage as number | undefined) ?? 80000;
          const radius = (t.meta?.radius as number | undefined) ?? 900;
          const pushScale = (t.meta?.pushScale as number | undefined) ?? this.sourceConfig.physPushScale;
          this.applyExplosionImpulse(origin, maxDamage, radius, pushScale, t.id);
        }
      } else if (t.type === 'push') {
        const cooldown = (t.meta?.cooldownTicks as number | undefined) ?? 22;
        const lastTick = this.triggerCooldowns.get(t.id) ?? -999;
        if (tick - lastTick >= cooldown) {
          this.triggerCooldowns.set(t.id, tick);
          const dirX = t.meta.dirX ?? 1;
          const dirY = t.meta.dirY ?? 0;
          const dirZ = t.meta.dirZ ?? 0.36;
          const addSpeed = t.meta.addSpeed ?? 400;
          const minSpeedXY = t.meta.minSpeedXY ?? 1450;
          const minVelZ = t.meta.minVelZ ?? 560;

          vf[F32.VEL_X] = f32(vf[F32.VEL_X] + dirX * addSpeed);
          vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] + dirY * addSpeed);

          const dirLen = Math.hypot(dirX, dirY);
          if (dirLen > 1e-4 && minSpeedXY > 0) {
            const curXY = Math.hypot(vf[F32.VEL_X], vf[F32.VEL_Y]);
            if (curXY < minSpeedXY) {
              vf[F32.VEL_X] = f32((dirX / dirLen) * minSpeedXY);
              vf[F32.VEL_Y] = f32((dirY / dirLen) * minSpeedXY);
            }
          }

          const nextZ = Math.max(vf[F32.VEL_Z] + dirZ * addSpeed, minVelZ);
          vf[F32.VEL_Z] = f32(nextZ);
          vi[I32.FLAGS] &= ~FL_ONGROUND;
          this.checkVelocity();
          this.callbacks.onBoost?.(t.id);
        }
      }
    }
  }
}

//ViewModelRig.ts , 

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

//WorldRenderer.ts

// src/render/WorldRenderer.ts
import * as THREE from 'three';
import { SURF_NORMAL_Z } from '../core/constants';
import { gsToThree } from '../core/coordinates';
import { ConvexBrush, TriggerVolume } from '../physics/BrushBuilder';
import { SourceRigidBody, Vec3 } from '../physics/GoldSrcPhysicsEngine';
import { WorldSign } from '../maps/surfSandbox01';
import { makeDevGridTexture, makeHazardTexture } from './textures';

interface ExplosionFx {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  duration: number;
  maxRadius: number;
}

interface TracerFx {
  line: THREE.Line;
  mat: THREE.LineBasicMaterial;
  age: number;
  duration: number;
}

interface ParticleFx {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  age: number;
  duration: number;
  gravity: number;
}

interface DecalFx {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  duration: number;
}

export class WorldRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly vmScene = new THREE.Scene();
  private readonly vmCamera: THREE.PerspectiveCamera;
  private readonly boosterTex: THREE.CanvasTexture;
  private readonly rigidBodyMat: THREE.MeshStandardMaterial;
  private readonly rigidBodyEdgeMat: THREE.LineBasicMaterial;
  private readonly rigidBodyMeshes = new Map<string, THREE.Object3D>();
  private readonly seenRigidBodyIds = new Set<string>();

  private readonly explosionGeo = new THREE.SphereGeometry(1, 20, 14);
  private readonly particleGeo = new THREE.BoxGeometry(2.8, 2.8, 2.8);
  private readonly decalGeo = new THREE.CircleGeometry(5.5, 10);

  private readonly explosionEffects: ExplosionFx[] = [];
  private readonly tracerEffects: TracerFx[] = [];
  private readonly particleEffects: ParticleFx[] = [];
  private readonly decals: DecalFx[] = [];

  public readonly debugGroup = new THREE.Group();
  public baseFov = 90;

  private scopeZoomLevel: 0 | 1 | 2 = 0;
  private currentFov = 90;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();

  constructor(
    canvas: HTMLCanvasElement,
    brushes: ConvexBrush[],
    triggers: TriggerVolume[],
    signs: WorldSign[],
    vmRoot: THREE.Group,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene.fog = new THREE.FogExp2(0x0c1322, 0.000085);

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 2, 32000);
    this.camera.up.set(0, 1, 0);

    this.vmCamera = new THREE.PerspectiveCamera(62, aspect, 0.05, 20);
    this.vmScene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.25));
    const vmKeyLight = new THREE.DirectionalLight(0xfff7ed, 1.4);
    vmKeyLight.position.set(2, 4, 3);
    this.vmScene.add(vmKeyLight);
    this.vmScene.add(vmRoot);

    this.scene.add(new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.85));
    const sunLight = new THREE.DirectionalLight(0xfffbeb, 1.35);
    sunLight.position.set(2800, 4600, 1900);
    this.scene.add(sunLight);
    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.42);
    fillLight.position.set(-2200, 1400, -2600);
    this.scene.add(fillLight);

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.boosterTex = makeDevGridTexture(
      '#083344',
      '#22d3ee',
      'rgba(34,211,238,0.25)',
      'rgba(103,232,249,0.9)',
      maxAniso,
      '',
      true,
    );

    this.rigidBodyMat = new THREE.MeshStandardMaterial({
      map: makeDevGridTexture(
        '#3b2f1e',
        '#f59e0b',
        'rgba(251,191,36,0.22)',
        '#fbbf24',
        maxAniso,
        'PHYS',
      ),
      roughness: 0.5,
      metalness: 0.22,
    });
    this.rigidBodyEdgeMat = new THREE.LineBasicMaterial({
      color: 0xfcd34d,
      transparent: true,
      opacity: 0.65,
    });

    const mats: Record<string, THREE.MeshStandardMaterial> = {
      slate: new THREE.MeshStandardMaterial({
        map: makeDevGridTexture('#1e2634', '#475569', 'rgba(148,163,184,0.12)', '#64748b', maxAniso, '64'),
        roughness: 0.72,
        metalness: 0.12,
      }),
      rampFace: new THREE.MeshStandardMaterial({
        map: makeDevGridTexture('#c2590c', '#fed7aa', 'rgba(255,237,213,0.18)', '#fbbf24', maxAniso, 'SURF'),
        roughness: 0.42,
        metalness: 0.14,
      }),
      steepFace: new THREE.MeshStandardMaterial({
        map: makeDevGridTexture('#b91c1c', '#fecaca', 'rgba(254,202,202,0.18)', '#fb923c', maxAniso, '60°'),
        roughness: 0.38,
        metalness: 0.16,
      }),
      walkable: new THREE.MeshStandardMaterial({
        map: makeDevGridTexture('#0f766e', '#99f6e4', 'rgba(153,246,228,0.18)', '#2dd4bf', maxAniso, '30°'),
        roughness: 0.55,
        metalness: 0.1,
      }),
      booster: new THREE.MeshStandardMaterial({
        map: this.boosterTex,
        emissive: 0x0891b2,
        emissiveIntensity: 0.65,
        roughness: 0.25,
        metalness: 0.2,
      }),
      finish: new THREE.MeshStandardMaterial({
        map: makeDevGridTexture('#065f46', '#6ee7b7', 'rgba(110,231,183,0.2)', '#34d399', maxAniso, 'FIN'),
        emissive: 0x059669,
        emissiveIntensity: 0.35,
        roughness: 0.45,
        metalness: 0.15,
      }),
    };

    this.debugGroup.visible = false;
    this.scene.add(this.debugGroup);

    this.buildSkyDome();
    this.buildVisualWorld(brushes, triggers, mats);
    this.buildWorldSigns(signs);

    window.addEventListener('resize', this.handleResize);
  }

  public setDebugVisible(visible: boolean): void {
    this.debugGroup.visible = visible;
  }

  public setScopeZoom(level: 0 | 1 | 2): void {
    this.scopeZoomLevel = level;
  }

  public spawnExplosionEffect(origin: Vec3, radius: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.48,
      wireframe: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.explosionGeo, mat);
    gsToThree(origin.x, origin.y, origin.z, mesh.position);
    mesh.scale.setScalar(12);
    this.scene.add(mesh);

    this.explosionEffects.push({
      mesh,
      mat,
      age: 0,
      duration: 0.36,
      maxRadius: Math.max(120, radius * 0.55),
    });
  }

  public spawnBulletTracer(start: Vec3, end: Vec3, color = 0xfef08a): void {
    const p1 = gsToThree(start.x, start.y, start.z);
    const p2 = gsToThree(end.x, end.y, end.z);
    const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracerEffects.push({ line, mat, age: 0, duration: 0.09 });
  }

  public spawnImpactEffect(
    point: Vec3,
    normal: Vec3,
    material: 'world' | 'prop' | 'blood' | 'weapon',
  ): void {
    const hitPos = gsToThree(point.x, point.y, point.z);
    const hitNorm = new THREE.Vector3(normal.x, normal.z, -normal.y).normalize();

    // 1. Sparks or blood splatter particles
    const isBlood = material === 'blood';
    const count = isBlood ? 14 : 8;
    const baseColor = isBlood ? 0xdc2626 : material === 'prop' ? 0xfbbf24 : 0xfef08a;

    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: isBlood && i % 3 === 0 ? 0x7f1d1d : baseColor,
        transparent: true,
        opacity: 0.95,
      });
      const mesh = new THREE.Mesh(this.particleGeo, mat);
      mesh.position.copy(hitPos).addScaledVector(hitNorm, 2);
      mesh.scale.setScalar(isBlood ? 1.1 + Math.random() * 1.1 : 0.65 + Math.random() * 0.6);

      const speed = isBlood ? 110 + Math.random() * 210 : 140 + Math.random() * 260;
      const spread = new THREE.Vector3(
        (Math.random() - 0.5) * 1.4,
        (Math.random() - 0.5) * 1.4,
        (Math.random() - 0.5) * 1.4,
      );
      const vel = hitNorm.clone().add(spread).normalize().multiplyScalar(speed);
      vel.y += isBlood ? 45 : 70;

      this.scene.add(mesh);
      this.particleEffects.push({
        mesh,
        mat,
        vel,
        age: 0,
        duration: isBlood ? 0.55 + Math.random() * 0.35 : 0.24 + Math.random() * 0.16,
        gravity: isBlood ? 620 : 780,
      });
    }

    // 2. Surface decal on world brushes or blood mark
    if (material === 'world' || isBlood) {
      const decalMat = new THREE.MeshBasicMaterial({
        color: isBlood ? 0x991b1b : 0x0f172a,
        transparent: true,
        opacity: isBlood ? 0.82 : 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const decal = new THREE.Mesh(this.decalGeo, decalMat);
      decal.position.copy(hitPos).addScaledVector(hitNorm, 0.8);
      decal.lookAt(hitPos.clone().add(hitNorm));
      decal.scale.setScalar(isBlood ? 1.8 + Math.random() * 0.9 : 0.65 + Math.random() * 0.35);
      this.scene.add(decal);
      this.decals.push({ mesh: decal, mat: decalMat, age: 0, duration: 16 });

      // Cap active decals
      if (this.decals.length > 64) {
        const old = this.decals.shift()!;
        this.scene.remove(old.mesh);
        old.mat.dispose();
      }
    }
  }

  private createRigidBodyVisual(b: SourceRigidBody): THREE.Object3D {
    if (b.kind === 'weapon' && b.weaponData) {
      const group = new THREE.Group();
      const isScout = b.weaponData.slot === 1;
      const metal = new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.35,
        metalness: 0.75,
        emissive: 0x0f172a,
      });
      const accent = new THREE.MeshStandardMaterial({
        color: isScout ? 0x4d5f47 : 0x1e293b,
        roughness: 0.6,
        metalness: 0.2,
      });

      if (isScout) {
        const stock = new THREE.Mesh(new THREE.BoxGeometry(34, 7, 6), accent);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 36, 10), metal);
        barrel.rotation.z = Math.PI * 0.5;
        barrel.position.set(16, 2.5, 0);
        const scope = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 16, 10), metal);
        scope.rotation.z = Math.PI * 0.5;
        scope.position.set(2, 6.2, 0);
        group.add(stock, barrel, scope);
      } else {
        const slide = new THREE.Mesh(new THREE.BoxGeometry(16, 4.5, 3.6), metal);
        slide.position.set(0, 2, 0);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(4.5, 8.5, 3.2), accent);
        grip.position.set(-4.5, -3, 0);
        group.add(slide, grip);
        if (b.weaponData.silenced) {
          const sup = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 11, 10), accent);
          sup.rotation.z = Math.PI * 0.5;
          sup.position.set(13, 2, 0);
          group.add(sup);
        }
      }

      // Subtle glowing ring to spot dropped weapons easily
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(isScout ? 16 : 11, isScout ? 18 : 13, 20),
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.45,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI * 0.5;
      ring.position.y = -b.hz + 1;
      group.add(ring);
      return group;
    }

    if (b.kind === 'target') {
      const group = new THREE.Group();
      const torsoMat = new THREE.MeshStandardMaterial({
        color: 0x991b1b,
        roughness: 0.55,
        metalness: 0.1,
      });
      const headMat = new THREE.MeshStandardMaterial({
        color: 0xfca5a5,
        roughness: 0.5,
        metalness: 0.08,
      });
      const torso = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 1.85, b.hz * 1.4, b.hy * 1.25), torsoMat);
      torso.name = 'targetTorso';
      torso.position.y = -b.hz * 0.15;

      const head = new THREE.Mesh(new THREE.BoxGeometry(14, 15, 14), headMat);
      head.position.y = b.hz * 0.72;

      const bullseye = new THREE.Mesh(
        new THREE.RingGeometry(4, 9, 16),
        new THREE.MeshBasicMaterial({ color: 0xfef08a, side: THREE.DoubleSide }),
      );
      bullseye.position.set(0, 4, b.hy * 0.64);
      const bullseyeBack = bullseye.clone();
      bullseyeBack.position.z = -b.hy * 0.64;

      group.add(torso, head, bullseye, bullseyeBack);
      return group;
    }

    const geo = new THREE.BoxGeometry(b.hx * 2, b.hz * 2, b.hy * 2);
    const mesh = new THREE.Mesh(geo, this.rigidBodyMat);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.rigidBodyEdgeMat);
    mesh.add(edges);
    return mesh;
  }

  public syncRigidBodies(bodies: readonly SourceRigidBody[]): void {
    this.seenRigidBodyIds.clear();

    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      this.seenRigidBodyIds.add(b.id);

      let obj = this.rigidBodyMeshes.get(b.id);
      if (!obj) {
        obj = this.createRigidBodyVisual(b);
        this.scene.add(obj);
        this.rigidBodyMeshes.set(b.id, obj);
      }

      gsToThree(b.pos.x, b.pos.y, b.pos.z, obj.position);
      obj.quaternion.set(b.quat.x, b.quat.z, -b.quat.y, b.quat.w);

      // Tint bleeding target dummies darker red as HP drops
      if (b.kind === 'target' && typeof b.hp === 'number' && typeof b.maxHp === 'number') {
        const torso = obj.getObjectByName('targetTorso') as THREE.Mesh | undefined;
        if (torso && torso.material instanceof THREE.MeshStandardMaterial) {
          const ratio = Math.max(0, b.hp / Math.max(1, b.maxHp));
          torso.material.color.setRGB(0.45 + 0.45 * ratio, 0.08 * ratio, 0.08 * ratio);
        }
      }
    }

    for (const [id, obj] of this.rigidBodyMeshes.entries()) {
      if (!this.seenRigidBodyIds.has(id)) {
        this.scene.remove(obj);
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
            child.geometry.dispose();
            if (child.material !== this.rigidBodyMat && child.material !== this.rigidBodyEdgeMat) {
              if (Array.isArray(child.material)) {
                child.material.forEach((m) => m.dispose());
              } else {
                child.material.dispose();
              }
            }
          }
        });
        this.rigidBodyMeshes.delete(id);
      }
    }
  }

  public update(
    frameDt: number,
    rx: number,
    ry: number,
    eyeZ: number,
    renderYaw: number,
    renderPitch: number,
    spdXY: number,
  ): void {
    this.boosterTex.offset.y -= frameDt * 1.45;

    for (let i = this.explosionEffects.length - 1; i >= 0; i--) {
      const fx = this.explosionEffects[i];
      fx.age += frameDt;
      const t = fx.age / fx.duration;
      if (t >= 1) {
        this.scene.remove(fx.mesh);
        fx.mat.dispose();
        this.explosionEffects.splice(i, 1);
      } else {
        const eased = 1 - (1 - t) * (1 - t);
        fx.mesh.scale.setScalar(12 + eased * fx.maxRadius);
        fx.mat.opacity = (1 - t) * 0.48;
      }
    }

    for (let i = this.tracerEffects.length - 1; i >= 0; i--) {
      const tr = this.tracerEffects[i];
      tr.age += frameDt;
      const t = tr.age / tr.duration;
      if (t >= 1) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        tr.mat.dispose();
        this.tracerEffects.splice(i, 1);
      } else {
        tr.mat.opacity = (1 - t) * 0.85;
      }
    }

    for (let i = this.particleEffects.length - 1; i >= 0; i--) {
      const p = this.particleEffects[i];
      p.age += frameDt;
      const t = p.age / p.duration;
      if (t >= 1) {
        this.scene.remove(p.mesh);
        p.mat.dispose();
        this.particleEffects.splice(i, 1);
      } else {
        p.vel.y -= p.gravity * frameDt;
        p.mesh.position.addScaledVector(p.vel, frameDt);
        p.mat.opacity = 1 - t;
      }
    }

    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.age += frameDt;
      if (d.age >= d.duration) {
        this.scene.remove(d.mesh);
        d.mat.dispose();
        this.decals.splice(i, 1);
      } else if (d.age > d.duration - 2) {
        d.mat.opacity = Math.max(0, ((d.duration - d.age) / 2) * 0.8);
      }
    }

    const cosP = Math.cos(renderPitch);
    const fwdX = cosP * Math.cos(renderYaw);
    const fwdY = cosP * Math.sin(renderYaw);
    const fwdZ = Math.sin(renderPitch);

    gsToThree(rx, ry, eyeZ, this.camPos);
    gsToThree(rx + fwdX * 100, ry + fwdY * 100, eyeZ + fwdZ * 100, this.camLook);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    let targetFov: number;
    if (this.scopeZoomLevel === 1) {
      targetFov = 38;
    } else if (this.scopeZoomLevel === 2) {
      targetFov = 16;
    } else {
      const fovBoost = THREE.MathUtils.clamp((spdXY - 450) / 2550, 0, 1) * 22.0;
      targetFov = this.baseFov + fovBoost;
    }

    if (Math.abs(this.currentFov - targetFov) > 0.02) {
      const rate = this.scopeZoomLevel > 0 ? 22 : 7.5;
      this.currentFov = THREE.MathUtils.lerp(this.currentFov, targetFov, Math.min(1, frameDt * rate));
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }
  }

  public render(): void {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
  }

  private handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  private buildSkyDome(): void {
    const skyGeo = new THREE.SphereGeometry(24000, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x070b14) },
        midColor: { value: new THREE.Color(0x162944) },
        horizonColor: { value: new THREE.Color(0x2d3a4b) },
        bottomColor: { value: new THREE.Color(0x080a10) },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 horizonColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPos;
        void main() {
          float h = normalize(vWorldPos).y;
          vec3 col = h >= 0.0
            ? mix(horizonColor, mix(midColor, topColor, smoothstep(0.08, 0.65, h)), smoothstep(0.0, 0.25, h))
            : mix(horizonColor, bottomColor, smoothstep(0.0, -0.35, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));
  }

  private buildVisualWorld(
    brushes: ConvexBrush[],
    triggers: TriggerVolume[],
    mats: Record<string, THREE.MeshStandardMaterial>,
  ): void {
    const tileScale = 1 / 128;

    for (const brush of brushes) {
      const buckets = new Map<string, { pos: number[]; norm: number[]; uv: number[] }>();

      for (const face of brush.renderFaces) {
        const isSurfSlope = face.nz > 0.05 && face.nz < SURF_NORMAL_Z;
        let matKey = 'slate';
        if (brush.style === 'booster') matKey = 'booster';
        else if (brush.style === 'finish') matKey = 'finish';
        else if (brush.style === 'walkable' && face.nz > 0.4 && face.nz < 0.98) matKey = 'walkable';
        else if (brush.style === 'steep' && isSurfSlope) matKey = 'steepFace';
        else if (brush.style === 'ramp' && isSurfSlope) matKey = 'rampFace';

        if (!buckets.has(matKey)) {
          buckets.set(matKey, { pos: [], norm: [], uv: [] });
        }
        const b = buckets.get(matKey)!;

        const n3 = new THREE.Vector3(face.nx, face.nz, -face.ny).normalize();
        const upRef = Math.abs(n3.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const uAxis = new THREE.Vector3().crossVectors(upRef, n3).normalize();
        const vAxis = new THREE.Vector3().crossVectors(n3, uAxis).normalize();

        const vs = face.verts;
        for (let i = 1; i < vs.length - 1; i++) {
          const tri = [vs[0], vs[i], vs[i + 1]];
          for (const v of tri) {
            const tx = v[0];
            const ty = v[2];
            const tz = -v[1];
            b.pos.push(tx, ty, tz);
            b.norm.push(n3.x, n3.y, n3.z);
            b.uv.push(
              (tx * uAxis.x + ty * uAxis.y + tz * uAxis.z) * tileScale,
              (tx * vAxis.x + ty * vAxis.y + tz * vAxis.z) * tileScale,
            );
          }
        }
      }

      for (const [matKey, data] of buckets.entries()) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.norm, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
        this.scene.add(new THREE.Mesh(geo, mats[matKey]));

        const edges = new THREE.EdgesGeometry(geo, 24);
        const edgeColor =
          matKey === 'rampFace' ? 0xfdba74 : matKey === 'booster' ? 0x67e8f9 : 0x475569;
        this.scene.add(
          new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.35 }),
          ),
        );

        this.debugGroup.add(
          new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.9 }),
          ),
        );
      }
    }

    const failGeo = new THREE.PlaneGeometry(24000, 18000);
    failGeo.rotateX(-Math.PI / 2);
    const failMat = new THREE.MeshBasicMaterial({
      map: makeHazardTexture(),
      transparent: true,
      opacity: 0.72,
    });
    const failMesh = new THREE.Mesh(failGeo, failMat);
    failMesh.position.set(6500, -200, 250);
    this.scene.add(failMesh);

    for (const trig of triggers) {
      const sx = trig.maxX - trig.minX;
      const sy = trig.maxY - trig.minY;
      const sz = trig.maxZ - trig.minZ;
      const cx = (trig.minX + trig.maxX) * 0.5;
      const cy = (trig.minY + trig.maxY) * 0.5;
      const cz = (trig.minZ + trig.maxZ) * 0.5;

      const boxGeo = new THREE.BoxGeometry(sx, sz, sy);
      const posThree = gsToThree(cx, cy, cz);

      if (trig.type === 'start') {
        const gate = new THREE.Mesh(
          boxGeo,
          new THREE.MeshBasicMaterial({
            color: 0x10b981,
            transparent: true,
            opacity: 0.14,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        gate.position.copy(posThree);
        this.scene.add(gate);
      } else if (trig.type === 'checkpoint') {
        const cpField = new THREE.Mesh(
          boxGeo,
          new THREE.MeshBasicMaterial({
            color: 0xa855f7,
            transparent: true,
            opacity: 0.08,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        cpField.position.copy(posThree);
        this.scene.add(cpField);

        const wire = new THREE.LineSegments(
          new THREE.EdgesGeometry(boxGeo),
          new THREE.LineBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.4 }),
        );
        wire.position.copy(posThree);
        this.scene.add(wire);
      } else if (trig.type === 'push') {
        const boostField = new THREE.Mesh(
          boxGeo,
          new THREE.MeshBasicMaterial({
            color: 0x22d3ee,
            transparent: true,
            opacity: 0.12,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        boostField.position.copy(posThree);
        this.scene.add(boostField);

        const wire = new THREE.LineSegments(
          new THREE.EdgesGeometry(boxGeo),
          new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55 }),
        );
        wire.position.copy(posThree);
        this.scene.add(wire);
      } else if (trig.type === 'explosion') {
        const blastField = new THREE.Mesh(
          boxGeo,
          new THREE.MeshBasicMaterial({
            color: 0xf97316,
            transparent: true,
            opacity: 0.14,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        blastField.position.copy(posThree);
        this.scene.add(blastField);

        const wire = new THREE.LineSegments(
          new THREE.EdgesGeometry(boxGeo),
          new THREE.LineBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.7 }),
        );
        wire.position.copy(posThree);
        this.scene.add(wire);
      } else if (trig.type === 'end') {
        const endField = new THREE.Mesh(
          boxGeo,
          new THREE.MeshBasicMaterial({
            color: 0x34d399,
            transparent: true,
            opacity: 0.12,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        endField.position.copy(posThree);
        this.scene.add(endField);
      }

      const dbgColors: Record<string, number> = {
        start: 0x10b981,
        checkpoint: 0xa855f7,
        end: 0x4ade80,
        push: 0x22d3ee,
        explosion: 0xf97316,
        teleport: 0xf43f5e,
      };
      const col = dbgColors[trig.type] ?? 0xffffff;
      const dbgMesh = new THREE.Mesh(
        boxGeo,
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: trig.type === 'teleport' ? 0.12 : 0.28,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      dbgMesh.position.copy(posThree);
      this.debugGroup.add(dbgMesh);

      const dbgEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(boxGeo),
        new THREE.LineBasicMaterial({ color: col }),
      );
      dbgEdges.position.copy(posThree);
      this.debugGroup.add(dbgEdges);
    }

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x131c2e, roughness: 0.9, metalness: 0.1 });
    const pillarCoords: Array<[number, number]> = [
      [900, 1200],
      [2300, -1450],
      [3700, 900],
      [4900, -1650],
      [6600, -900],
      [5600, 1750],
      [8200, 500],
      [7400, 3200],
      [10400, 5100],
      [13600, 3200],
      [13900, -200],
      [10800, -1400],
      [13400, -3400],
      [8200, -5600],
    ];
    for (const [px, py] of pillarCoords) {
      const pMesh = new THREE.Mesh(new THREE.BoxGeometry(220, 3000, 220), pillarMat);
      pMesh.position.copy(gsToThree(px, py, 500));
      this.scene.add(pMesh);
    }
  }

  private buildWorldSigns(signs: WorldSign[]): void {
    for (const s of signs) {
      const c = document.createElement('canvas');
      c.width = 760;
      c.height = 112;
      const g = c.getContext('2d')!;
      g.fillStyle = 'rgba(9, 13, 21, 0.84)';
      g.fillRect(6, 6, 748, 100);
      g.strokeStyle = s.color;
      g.lineWidth = 5;
      g.strokeRect(6, 6, 748, 100);
      g.fillStyle = s.color;
      g.font = '800 28px JetBrains Mono, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(s.text, 380, 58);

      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
      const geo = new THREE.PlaneGeometry(320 * s.scale, 49 * s.scale);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(gsToThree(s.x, s.y, s.z));
      mesh.rotation.y = s.yaw - Math.PI * 0.5;
      this.scene.add(mesh);
    }
  }
}

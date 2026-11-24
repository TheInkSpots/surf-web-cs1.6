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

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
import {
  ACTOR_I32_BASE_INDEX,
  ACTOR_I32_STRIDE,
  ActorI32,
  F32,
  HitGroup,
  I32,
  MAX_ACTORS,
  PhysicsMemoryAbi,
  TeamId,
} from '../core/memoryAbi';
import {
  CheckpointState,
  computeAngleVectors,
  createBoxRigidBody,
  GoldSrcPhysicsEngine,
  IN_ATTACK,
  IN_ATTACK2,
  IN_RELOAD,
  IN_USE,
  LadderVolume,
  Quat,
  SourceJoint,
  SourceRigidBody,
  SourceRope,
  SourceVehicle,
  SpawnPoint,
  WaterVolume,
} from '../physics/GoldSrcPhysicsEngine';
import { MapBuildResult } from '../maps/surfSandbox01';
import { DEFAULT_MAP_ID, getMapById, MapId } from '../maps/mapRegistry';
import { SurfAudioEngine } from '../audio/SurfAudioEngine';
import { WorldRenderer } from '../render/WorldRenderer';
import { TeammateNameplates } from '../render/TeammateNameplates';
import { ViewmodelRig } from '../render/ViewmodelRig';
import { InputController } from '../gameplay/InputController';
import { RunTracker } from '../gameplay/RunTracker';
import { StrafeSyncTracker } from '../gameplay/StrafeSyncTracker';
import { WeaponSystem } from '../gameplay/WeaponSystem';
import { BotController, MapNavGraph, NavWaypoint } from '../gameplay/BotController';
import { TeamMatchManager } from '../gameplay/TeamMatchManager';
import {
  HudController,
  InteractPrompt,
  MatchHudState,
  ScoreboardRow,
  SubsystemTelemetry,
} from '../ui/HudController';
import { CombatHudOverlay } from '../ui/CombatHudOverlay';
import { MenuController } from '../ui/MenuController';

/** Optional subsystem & combat/nav hooks provided by extended maps */
interface SubsystemMapExtensions {
  createJoints?: () => SourceJoint[];
  createRopes?: () => SourceRope[];
  createWaterVolumes?: () => WaterVolume[];
  createVehicles?: () => SourceVehicle[];
  ladders?: LadderVolume[];
  navGraph?: MapNavGraph;
  tSpawns?: SpawnPoint[];
  ctSpawns?: SpawnPoint[];
}

type ExtendedMapBuildResult = MapBuildResult & SubsystemMapExtensions;

function wrapAngleRad(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/** Extract horizontal heading yaw from a Hammer Z-up chassis quaternion */
function getChassisYaw(q: Quat, fallbackYaw: number): number {
  const fwdX = 1 - 2 * (q.y * q.y + q.z * q.z);
  const fwdY = 2 * (q.x * q.y + q.w * q.z);
  if (Math.hypot(fwdX, fwdY) < 0.2) return fallbackYaw;
  return Math.atan2(fwdY, fwdX);
}

export class SurfApp {
  private readonly canvas: HTMLCanvasElement;
  private readonly abi = new PhysicsMemoryAbi(2);
  private readonly audio = new SurfAudioEngine();
  private readonly runTracker = new RunTracker();
  private readonly strafeSync = new StrafeSyncTracker(140);
  private readonly viewmodel = new ViewmodelRig();
  private readonly hud: HudController;
  private readonly combatHud = new CombatHudOverlay();
  private readonly input: InputController;
  private readonly menu: MenuController;

  private currentMapId: MapId = DEFAULT_MAP_ID;
  private currentMapData!: ExtendedMapBuildResult;
  private createInitialRigidBodies!: () => SourceRigidBody[];
  private physics!: GoldSrcPhysicsEngine;
  private renderer!: WorldRenderer;
  private nameplates: TeammateNameplates | null = null;
  private weapons!: WeaponSystem;
  private bots!: BotController;
  private matchManager!: TeamMatchManager;

  // T vs. CT match state & HUD telemetry
  private playerTeam: TeamId = TeamId.CT;
  private botsPerTeam = 3;
  private roundRestartAtTick = 0;
  private readonly actorNames: string[] = [
    'YOU',
    'BOT Maverick',
    'BOT Viper',
    'BOT Goose',
    'BOT Phoenix',
    'BOT Crusher',
    'BOT Nomad',
    'BOT Razor',
    'BOT Wolf',
    'BOT Hawk',
    'BOT Echo',
    'BOT Shade',
    'BOT Frost',
    'BOT Blaze',
    'BOT Rook',
    'BOT Ghost',
  ];
  private readonly actorKills = new Int32Array(MAX_ACTORS);
  private readonly actorDeaths = new Int32Array(MAX_ACTORS);
  private matchActive = true;
  private tScore = 0;
  private ctScore = 0;
  private roundNumber = 1;
  private roundTimerSec = 115;
  private roundPhase: 'FREEZETIME' | 'LIVE' | 'ROUND_END' = 'LIVE';

  private activeCheckpoint: CheckpointState | null = null;
  private customCheckpoint: CheckpointState | null = null;
  private readonly visitedCheckpoints = new Set<number>();

  // Subsystem interaction states
  private gravityGunActive = false;
  private drivingVehicleId: string | null = null;
  private vehicleCameraMode: 'first' | 'chase' = 'chase';
  private prevChassisYaw: number | null = null;
  private lastAppliedViewYaw = 0;
  private lastAppliedViewPitch = 0;
  private vehicleFreeLookUntil = 0;
  private readonly chaseRayIgnore = new Set<string>();

  private currentBaseFov = 95;
  private currentDebugVisible = false;
  private spawnedPropCount = 0;
  private lastFrameTime = performance.now();
  private accumulator = 0;
  private simMsAvg = 0.08;
  private idleClock = 0;

  constructor(canvas: HTMLCanvasElement, initialMapId: MapId = DEFAULT_MAP_ID) {
    this.canvas = canvas;
    this.currentMapId = initialMapId;
    this.hud = new HudController(this.runTracker);

    const initialMap = getMapById(initialMapId).build() as ExtendedMapBuildResult;

    this.input = new InputController(canvas, initialMap.spawn, {
      onUnlockRequest: () => this.audio.unlock(),
      onSelectWeapon: (slot) => {
        if (this.drivingVehicleId) return;
        this.setGravityGunMode(false);
        if (slot === 5 && this.weapons.getActiveSlot() === 5) {
          this.weapons.handlePrimaryPress(performance.now() * 0.001);
          return;
        }
        this.weapons.selectSlot(slot);
      },
      onQuickSwitch: () => {
        if (this.drivingVehicleId) return;
        if (this.gravityGunActive) {
          this.setGravityGunMode(false);
          this.hud.setActiveWeaponSlot(this.weapons.getActiveSlot());
          return;
        }
        this.weapons.quickSwitch();
      },
      onDropWeapon: () => {
        if (this.drivingVehicleId) return;
        if (this.physics.getGravityGunState().heldBodyId) {
          this.physics.releaseHeldBody(0);
          return;
        }
        this.weapons.dropActiveWeapon();
      },
      onPickupWeapon: () => this.handleUseAction(),
      onAttack1Press: () => this.handlePrimaryAction(),
      onAttack2Press: () => this.handleSecondaryAction(),
      onReloadOrReset: () => {
        if (this.physics.getVitals().dead) {
          this.fullReset();
          return;
        }
        if (this.drivingVehicleId) {
          this.exitVehicle(true);
          return;
        }
        if (this.gravityGunActive) {
          this.physics.releaseHeldBody(0);
          return;
        }
        const startedReload = this.weapons.tryReload(performance.now() * 0.001);
        if (!startedReload && this.weapons.getActiveSlot() === 3) {
          this.fullReset();
        }
      },
      onResetRun: () => this.fullReset(),
      onToggleDebug: () => {
        const next = !this.renderer.debugGroup.visible;
        this.currentDebugVisible = next;
        this.renderer.setDebugVisible(next);
        this.menu.setDebugChecked(next);
        this.hud.showToast(
          next ? 'MAPPER DEBUG WIREFRAMES: ON' : 'MAPPER DEBUG WIREFRAMES: OFF',
          'rgba(245,158,11,0.65)',
        );
      },
    });

    this.menu = new MenuController(
      this.abi,
      {
        onPlay: () => this.input.requestLock(),
        onRestart: () => {
          this.fullReset();
          this.input.requestLock();
        },
        onMapSelect: (mapId) => this.loadMap(mapId),
        onSensitivityChange: (sens) => {
          this.input.sensitivity = sens;
        },
        onBaseFovChange: (fov) => {
          this.currentBaseFov = fov;
          this.renderer.baseFov = fov;
        },
        onScout260Change: (enabled) => this.hud.setScoutSpeedLabel(enabled),
        onStrafeHudChange: (visible) => this.hud.setStrafeHudVisible(visible),
        onDebugChange: (enabled) => {
          this.currentDebugVisible = enabled;
          this.renderer.setDebugVisible(enabled);
          this.hud.showToast(
            enabled ? 'MAPPER DEBUG WIREFRAMES: ON' : 'MAPPER DEBUG WIREFRAMES: OFF',
            'rgba(245,158,11,0.65)',
          );
        },
        onMuteChange: (muted) => this.audio.setMuted(muted),
      },
      initialMapId,
    );

    this.loadMap(initialMapId, initialMap, false);

    window.addEventListener('keydown', this.handleSandboxHotkey);
    window.addEventListener('keyup', this.handleSandboxKeyup);
    this.menu.syncAll();
  }

  public loadMap(mapId: MapId, prebuilt?: MapBuildResult, announce = true): void {
    const def = getMapById(mapId);
    const mapData = (prebuilt ?? def.build()) as ExtendedMapBuildResult;

    this.currentMapId = mapId;
    this.currentMapData = mapData;
    this.createInitialRigidBodies = mapData.createRigidBodies;

    this.activeCheckpoint = null;
    this.customCheckpoint = null;
    this.visitedCheckpoints.clear();
    this.spawnedPropCount = 0;
    this.drivingVehicleId = null;
    this.prevChassisYaw = null;
    this.gravityGunActive = false;
    this.roundRestartAtTick = 0;
    this.tScore = 0;
    this.ctScore = 0;
    this.roundNumber = 1;
    this.roundTimerSec = 115;
    this.roundPhase = 'LIVE';
    this.actorKills.fill(0);
    this.actorDeaths.fill(0);
    this.runTracker.reset();

    this.nameplates?.dispose();
    this.nameplates = null;
    this.renderer?.dispose();

    this.renderer = new WorldRenderer(
      this.canvas,
      mapData.brushes,
      mapData.triggers,
      mapData.signs,
      this.viewmodel.root,
    );
    this.renderer.baseFov = this.currentBaseFov;
    this.renderer.setDebugVisible(this.currentDebugVisible);
    this.renderer.resetVehicleChaseCamera();
    this.nameplates = new TeammateNameplates(this.renderer.scene);

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
          this.audio.playExplosion(origin, radius);
          this.renderer.spawnExplosionEffect(origin, radius);
          this.hud.flashScreen('rgba(249, 115, 22, 0.42)');
        },
        onRigidBodyHit: (_bodyId, impulseMag, pos, kind) => {
          if (kind === 'grenade') {
            if (impulseMag > 140) {
              this.audio.playRigidBodyClatter(pos, impulseMag * 2.2, 'weapon');
            }
            return;
          }
          if (impulseMag > 650) {
            this.audio.playRigidBodyClatter(pos, impulseMag, kind);
          }
        },
        onRigidBodyDestroyed: (body, hitPoint) => {
          const isTarget = body.kind === 'target';
          this.renderer.spawnImpactEffect(hitPoint, { x: 0, y: 0, z: 1 }, isTarget ? 'blood' : 'prop');
          this.audio.playImpact(hitPoint, isTarget ? 'blood' : 'prop', 3200);
          if (isTarget) {
            this.hud.showToast(
              `TARGET ELIMINATED (${body.bloodLostMl ?? 0} mL BLOOD LOST)`,
              'rgba(239, 68, 68, 0.85)',
            );
          } else {
            this.hud.showToast('CRATE DESTROYED', 'rgba(251, 191, 36, 0.8)');
          }
        },
        onJointBroken: (jointId, pos) => {
          this.renderer.spawnImpactEffect(pos, { x: 0, y: 0, z: 1 }, 'prop');
          this.audio.playImpact(pos, 'prop', 2400);
          this.hud.showToast(`JOINT SEVERED: ${jointId.toUpperCase()}`, 'rgba(248, 113, 113, 0.8)');
        },
        onGravityGunGrab: (bodyId) => {
          this.audio.playWeaponSwitch();
          this.hud.showToast(`PID LOCK: ${bodyId.toUpperCase()}`, 'rgba(34, 211, 238, 0.72)');
        },
        onGravityGunRelease: (bodyId, punted) => {
          if (punted) {
            this.audio.playBoost();
            this.hud.showToast(`PUNTED: ${bodyId.toUpperCase()}`, 'rgba(251, 191, 36, 0.75)');
          }
        },
        onPlayerDamage: (amount, source, bloodLostMl) => {
          this.audio.playPlayerHurt(amount);
          this.hud.flashScreen('rgba(220, 38, 38, 0.48)');
          this.hud.showToast(
            `-${amount} HP  •  -${bloodLostMl} mL BLOOD (${source.toUpperCase()})`,
            'rgba(239, 68, 68, 0.85)',
          );
        },
        onPlayerDeath: (source) => {
          if (this.drivingVehicleId) {
            this.exitVehicle(false);
          } else {
            this.physics.setDrivenVehicle(null);
          }
          this.audio.playPlayerDeath();
          this.hud.flashScreen('rgba(153, 27, 27, 0.72)');
          this.hud.showToast(
            `KILLED BY ${source.toUpperCase()} — PRESS R TO RESPAWN`,
            'rgba(220, 38, 38, 0.92)',
          );
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
            if (this.drivingVehicleId) {
              this.exitVehicle(false);
            } else {
              this.physics.setDrivenVehicle(null);
            }
            this.audio.playTeleport();
            this.hud.flashScreen('rgba(251, 113, 133, 0.42)');

            if (this.activeCheckpoint) {
              this.runTracker.invalidateRankedRun();
              this.physics.teleportToCheckpoint(this.activeCheckpoint);
              this.input.resetView(this.activeCheckpoint.yaw, this.activeCheckpoint.pitch);
              this.hud.showToast(
                `FAIL ZONE — RESPAWNED AT ${this.activeCheckpoint.label}  (Shift+R: Full Reset)`,
                'rgba(168, 85, 247, 0.8)',
              );
              return;
            }

            this.runTracker.reset();
            this.input.resetView(this.currentMapData.spawn.yaw, this.currentMapData.spawn.pitch);
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
            `FINISHED IN ${RunTracker.formatTime(result.finishSec)}${deltaStr}${pbNote}  (Backspace for Full Reset)`,
            'rgba(16,185,129,0.75)',
          );
        },
      },
      this.createInitialRigidBodies(),
    );

    this.registerMapSubsystems(mapData);

    // Initialize PODBot / ZBot AI controller
    this.bots = new BotController(this.abi, this.physics, {
      onBotFired: (ev) => {
        const tracerColor = ev.slot === 1 ? 0xfef08a : 0xfde047;
        this.renderer.spawnBulletTracer(ev.origin, ev.hitPoint, tracerColor);

        const impactMat = ev.hitActorId !== undefined ? 'blood' : 'world';
        this.renderer.spawnImpactEffect(ev.hitPoint, { x: 0, y: 0, z: 1 }, impactMat);
        this.audio.playImpact(ev.hitPoint, impactMat, ev.slot === 1 ? 2600 : 1100);

        if (ev.killed) {
          this.matchManager.awardFrag(ev.shooterId);
          if (ev.hitActorId !== undefined) {
            const wpnName = ev.slot === 1 ? 'SCOUT' : ev.slot === 3 ? 'KNIFE' : 'USP .45';
            this.recordKill(ev.shooterId, ev.hitActorId, wpnName, ev.hitGroup === HitGroup.HEAD);
          }
          if (ev.hitActorId === 0) {
            this.hud.showToast(
              ev.hitGroup === HitGroup.HEAD
                ? `ELIMINATED BY ${this.getActorName(ev.shooterId)} [HEADSHOT]`
                : `ELIMINATED BY ${this.getActorName(ev.shooterId)}`,
              'rgba(220, 38, 38, 0.92)',
            );
          }
        }
      },
      onObjectiveComplete: (actorId, team) => {
        const label = team === TeamId.T ? 'C4 PLANTED BY TERRORISTS' : 'BOMB DEFUSED BY CT';
        this.audio.playStartBeep();
        this.hud.showToast(`${label} (${this.getActorName(actorId)})`, 'rgba(251, 191, 36, 0.9)');
      },
    });
    this.bots.setNavGraph(mapData.navGraph ?? this.buildFallbackNavGraph(mapData.spawn));

    // Initialize T vs. CT round & team match manager
    this.matchManager = new TeamMatchManager(this.abi, this.physics, this.bots, {
      tSpawns: mapData.tSpawns,
      ctSpawns: mapData.ctSpawns,
      fallbackSpawn: mapData.spawn,
    });

    this.weapons = new WeaponSystem(
      this.abi,
      this.physics,
      this.audio,
      this.viewmodel,
      this.renderer,
      this.input,
      {
        onToast: (msg, color) => this.hud.showToast(msg, color),
        onHitMarker: (isBlood, isKill) => this.combatHud.triggerHitMarker(isBlood, isKill),
        onActiveSlotChanged: (slot) => {
          this.viewmodel.root.visible = !this.gravityGunActive && !this.drivingVehicleId;
          if (!this.gravityGunActive) {
            this.hud.setActiveWeaponSlot(slot);
          }
        },
        onPlayerFired: (origin, soundRadiusHu) => {
          this.bots.notifySoundEvent(0, origin, soundRadiusHu, this.abi.i32[I32.TICK]);
        },
        onActorKilled: (victimId, hitGroup) => {
          this.matchManager.awardFrag(0);
          const slot = this.weapons.getActiveSlot();
          const wpnName =
            slot === 1 ? 'SCOUT' : slot === 2 ? 'USP .45' : slot === 5 ? 'HE GRENADE' : 'KNIFE';
          this.recordKill(0, victimId, wpnName, hitGroup === HitGroup.HEAD);
          const hsTag = hitGroup === HitGroup.HEAD ? ' ★ HEADSHOT' : '';
          this.hud.showToast(
            `ELIMINATED ${this.getActorName(victimId)}${hsTag}  (+$300)`,
            hitGroup === HitGroup.HEAD ? 'rgba(239, 68, 68, 0.95)' : 'rgba(52, 211, 153, 0.85)',
          );
        },
      },
    );

    this.physics.teleportToSpawn(false);
    this.matchManager.configure(
      {
        tSpawns: mapData.tSpawns,
        ctSpawns: mapData.ctSpawns,
        fallbackSpawn: mapData.spawn,
      },
      this.playerTeam,
      this.botsPerTeam,
    );
    this.weapons.resetLoadout();
    this.input.resetView(mapData.spawn.yaw, mapData.spawn.pitch);
    this.menu.setSelectedMap(mapId);

    if (announce) {
      const teamLabel = this.playerTeam === TeamId.CT ? 'CT' : 'T';
      this.hud.showToast(
        `LOADED ${def.name.toUpperCase()}  •  TEAM ${teamLabel} (${this.botsPerTeam}v${this.botsPerTeam})  •  [M] SWAP TEAM  •  [F3] SCOREBOARD`,
        'rgba(56,189,248,0.85)',
      );
    }
  }

  private getActorName(actorId: number): string {
    return this.actorNames[actorId] ?? `BOT #${actorId}`;
  }

  private recordKill(
    killerId: number,
    victimId: number,
    weapon: string,
    headshot: boolean,
  ): void {
    const i32 = this.abi.i32;
    if (killerId >= 0 && killerId < MAX_ACTORS && killerId !== victimId) {
      this.actorKills[killerId] += 1;
    }
    if (victimId >= 0 && victimId < MAX_ACTORS) {
      this.actorDeaths[victimId] += 1;
    }

    const killerTeam =
      killerId >= 0 && killerId < MAX_ACTORS
        ? (i32[ACTOR_I32_BASE_INDEX + killerId * ACTOR_I32_STRIDE + ActorI32.TEAM] as TeamId)
        : TeamId.SPEC;
    const victimTeam =
      victimId >= 0 && victimId < MAX_ACTORS
        ? (i32[ACTOR_I32_BASE_INDEX + victimId * ACTOR_I32_STRIDE + ActorI32.TEAM] as TeamId)
        : TeamId.SPEC;

    this.hud.pushKillFeed({
      killerName: this.getActorName(killerId),
      killerTeam,
      victimName: this.getActorName(victimId),
      victimTeam,
      weapon,
      headshot,
      isLocalInvolved: killerId === 0 || victimId === 0,
    });
  }

  private buildMatchHudState(): MatchHudState {
    const i32 = this.abi.i32;
    let tAlive = 0;
    let ctAlive = 0;
    const rows: ScoreboardRow[] = [];

    for (let id = 0; id < MAX_ACTORS; id++) {
      const idx = ACTOR_I32_BASE_INDEX + id * ACTOR_I32_STRIDE;
      if (i32[idx + ActorI32.ACTIVE] !== 1) continue;

      const team = i32[idx + ActorI32.TEAM] as TeamId;
      const alive = i32[idx + ActorI32.ALIVE] === 1;
      if (alive && team === TeamId.T) tAlive++;
      else if (alive && team === TeamId.CT) ctAlive++;

      rows.push({
        actorId: id,
        name: this.getActorName(id),
        team,
        alive,
        hp: i32[idx + ActorI32.HP],
        kills: this.actorKills[id],
        deaths: this.actorDeaths[id],
        cash: i32[idx + ActorI32.CASH],
        isLocal: id === 0,
      });
    }

    return {
      active: this.matchActive,
      tScore: this.tScore,
      ctScore: this.ctScore,
      tAlive,
      ctAlive,
      roundNumber: this.roundNumber,
      roundTimerSec: this.roundTimerSec,
      phase: this.roundPhase,
      rows,
    };
  }

  /**
   * Generates a lightweight 4-node perimeter patrol graph around the spawn deck
   * when a surf map does not define an explicit MapNavGraph.
   */
  private buildFallbackNavGraph(spawn: SpawnPoint): MapNavGraph {
    const waypoints: NavWaypoint[] = [
      {
        id: 0,
        x: spawn.x - 60,
        y: spawn.y - 80,
        z: spawn.z,
        radius: 44,
        flags: ['ct_spawn'],
        edges: [{ to: 1 }, { to: 3 }],
      },
      {
        id: 1,
        x: spawn.x + 180,
        y: spawn.y - 80,
        z: spawn.z,
        radius: 44,
        flags: ['t_spawn'],
        edges: [{ to: 0 }, { to: 2 }],
      },
      {
        id: 2,
        x: spawn.x + 180,
        y: spawn.y + 80,
        z: spawn.z,
        radius: 44,
        flags: ['t_spawn'],
        edges: [{ to: 1 }, { to: 3 }],
      },
      {
        id: 3,
        x: spawn.x - 60,
        y: spawn.y + 80,
        z: spawn.z,
        radius: 44,
        flags: ['ct_spawn'],
        edges: [{ to: 2 }, { to: 0 }],
      },
    ];
    return { waypoints };
  }

  private registerMapSubsystems(mapData: ExtendedMapBuildResult): void {
    const joints = mapData.createJoints?.() ?? [];
    for (let i = 0; i < joints.length; i++) this.physics.addJoint(joints[i]);

    const ropes = mapData.createRopes?.() ?? [];
    for (let i = 0; i < ropes.length; i++) this.physics.addRope(ropes[i]);

    const waters = mapData.createWaterVolumes?.() ?? [];
    for (let i = 0; i < waters.length; i++) this.physics.addWaterVolume(waters[i]);
    this.renderer.setWaterVolumes(this.physics.getWaterVolumes());

    const vehicles = mapData.createVehicles?.() ?? [];
    for (let i = 0; i < vehicles.length; i++) this.physics.addVehicle(vehicles[i]);

    const ladders = mapData.ladders ?? [];
    for (let i = 0; i < ladders.length; i++) this.physics.addLadder(ladders[i]);
    this.renderer.setLadders(ladders);
  }

  private resetSubsystemsAndProps(): void {
    if (this.drivingVehicleId) {
      this.exitVehicle(false);
    } else {
      this.physics.setDrivenVehicle(null);
    }
    this.physics.releaseHeldBody(0);

    // Clear existing joints, ropes, vehicles before repopulating
    const oldJointIds = this.physics.getJoints().map((j) => j.id);
    for (let i = 0; i < oldJointIds.length; i++) this.physics.removeJoint(oldJointIds[i]);

    const oldRopeIds = this.physics.getRopes().map((r) => r.id);
    for (let i = 0; i < oldRopeIds.length; i++) this.physics.removeRope(oldRopeIds[i]);

    const oldVehicleIds = this.physics.getVehicles().map((v) => v.id);
    for (let i = 0; i < oldVehicleIds.length; i++) this.physics.removeVehicle(oldVehicleIds[i]);

    this.physics.setRigidBodies(this.createInitialRigidBodies());

    const joints = this.currentMapData.createJoints?.() ?? [];
    for (let i = 0; i < joints.length; i++) this.physics.addJoint(joints[i]);

    const ropes = this.currentMapData.createRopes?.() ?? [];
    for (let i = 0; i < ropes.length; i++) this.physics.addRope(ropes[i]);

    const vehicles = this.currentMapData.createVehicles?.() ?? [];
    for (let i = 0; i < vehicles.length; i++) this.physics.addVehicle(vehicles[i]);
  }

  private fullReset(): void {
    this.activeCheckpoint = null;
    this.visitedCheckpoints.clear();
    this.roundRestartAtTick = 0;
    this.roundTimerSec = 115;
    this.roundPhase = 'LIVE';
    this.setGravityGunMode(false);
    this.physics.restoreVitals();
    this.resetSubsystemsAndProps();
    this.physics.teleportToSpawn(false);
    this.matchManager.startNewRound(this.abi.i32[I32.TICK]);
    this.weapons.resetLoadout();
    this.input.resetView(this.currentMapData.spawn.yaw, this.currentMapData.spawn.pitch);
    this.hud.showToast('FULL RUN, BOTS, PROPS & SUBSYSTEMS RESET', 'rgba(245,158,11,0.65)');
  }

  // ---------------------------------------------------------------------------
  // Gravity Gun, Tactile Pickup & Vehicle Driving Actions
  // ---------------------------------------------------------------------------

  private setGravityGunMode(enabled: boolean): void {
    if (this.gravityGunActive === enabled) return;
    this.gravityGunActive = enabled;
    if (!enabled && this.physics.getGravityGunState().heldBodyId) {
      this.physics.releaseHeldBody(0);
    }
    this.viewmodel.root.visible = !enabled && !this.drivingVehicleId;
    if (enabled) {
      this.renderer.setScopeZoom(0);
      this.hud.setActiveWeaponSlot(4);
      this.audio.playWeaponSwitch();
      this.hud.showToast('PHYS GUN (PID)  •  [RMB] GRAB/DROP  •  [LMB] PUNT', 'rgba(34,211,238,0.75)');
    } else {
      this.hud.setActiveWeaponSlot(this.weapons.getActiveSlot());
    }
  }

  private handlePrimaryAction(): void {
    if (this.drivingVehicleId) return;

    const heldId = this.physics.getGravityGunState().heldBodyId;
    if (heldId) {
      const eye = this.physics.getPlayerEyePosition();
      const { forward } = computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0);
      const heldBody = this.physics.getRigidBodies().find((b) => b.id === heldId);
      const puntJ = Math.min(95000, Math.max(18000, (heldBody?.mass ?? 30) * 1150));
      this.physics.releaseHeldBody(puntJ, forward);
      this.renderer.spawnBulletTracer(
        eye,
        {
          x: eye.x + forward.x * 160,
          y: eye.y + forward.y * 160,
          z: eye.z + forward.z * 160,
        },
        0x22d3ee,
      );
      return;
    }

    if (this.gravityGunActive) {
      const eye = this.physics.getPlayerEyePosition();
      const { forward } = computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0);
      const hit = this.physics.traceRay(eye, forward, 420);
      if (hit.hit && hit.kind === 'rigidBody' && hit.body) {
        const puntJ = Math.min(85000, Math.max(16000, hit.body.mass * 950));
        this.physics.applyPointImpulse(hit.body, hit.point, forward, puntJ, 0);
        this.renderer.spawnBulletTracer(eye, hit.point, 0xfbbf24);
        this.renderer.spawnImpactEffect(hit.point, hit.normal, 'prop');
        this.audio.playBoost();
      }
      return;
    }

    this.weapons.handlePrimaryPress(performance.now() * 0.001);
  }

  private handleSecondaryAction(): void {
    if (this.drivingVehicleId) return;

    if (this.physics.getGravityGunState().heldBodyId) {
      this.physics.releaseHeldBody(0);
      return;
    }

    if (this.gravityGunActive) {
      const eye = this.physics.getPlayerEyePosition();
      const { forward } = computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0);
      const grabbed = this.physics.tryGrabRigidBody(eye, forward, 380, 260, 124);
      if (!grabbed) {
        this.hud.showToast('NO GRABBABLE PROP (MAX 260 kg)', 'rgba(148,163,184,0.65)');
      }
      return;
    }

    this.weapons.handleSecondaryPress(performance.now() * 0.001);
  }

  private handleUseAction(): void {
    // 1. Exit vehicle if currently driving
    if (this.drivingVehicleId) {
      this.exitVehicle(true);
      return;
    }

    // 2. Drop held prop if carrying one
    if (this.physics.getGravityGunState().heldBodyId) {
      this.physics.releaseHeldBody(0);
      return;
    }

    // 3. Enter nearby vehicle
    const nearVehicle = this.findNearbyVehicle(165);
    if (nearVehicle) {
      this.enterVehicle(nearVehicle.id);
      return;
    }

    // 4. Pick up looked-at weapon
    if (this.weapons.tryPickupLookedWeapon()) {
      return;
    }

    // 5. Tactile quick-pickup for nearby physics prop via Gravity Gun PID
    const eye = this.physics.getPlayerEyePosition();
    const { forward } = computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0);
    const grabbed = this.physics.tryGrabRigidBody(eye, forward, 240, 260, 112);
    if (grabbed) return;

    this.hud.showToast('AIM AT A WEAPON, PROP, OR VEHICLE', 'rgba(148,163,184,0.65)');
  }

  private findNearbyVehicle(maxRange: number): SourceVehicle | null {
    const vehicles = this.physics.getVehicles();
    if (vehicles.length === 0) return null;

    const eye = this.physics.getPlayerEyePosition();
    const bodies = this.physics.getRigidBodies();
    let best: SourceVehicle | null = null;
    let bestDist = maxRange;

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const chassis = bodies.find((b) => b.id === v.chassisId);
      if (!chassis) continue;
      const dist = Math.hypot(chassis.pos.x - eye.x, chassis.pos.y - eye.y, chassis.pos.z - eye.z);
      if (dist < bestDist) {
        bestDist = dist;
        best = v;
      }
    }
    return best;
  }

  private enterVehicle(vehicleId: string): void {
    const veh = this.physics.getVehicles().find((v) => v.id === vehicleId);
    const chassis = veh
      ? this.physics.getRigidBodies().find((b) => b.id === veh.chassisId)
      : undefined;
    if (!veh || !chassis) return;

    this.physics.releaseHeldBody(0);
    this.renderer.setScopeZoom(0);
    this.renderer.resetVehicleChaseCamera();
    this.drivingVehicleId = vehicleId;
    this.physics.setDrivenVehicle(vehicleId);
    this.physics.setVehicleControls(vehicleId, 0, 0, 0);
    this.viewmodel.root.visible = false;

    const chassisYaw = getChassisYaw(chassis.quat, this.input.viewYaw);
    const initPitch = this.vehicleCameraMode === 'chase' ? -0.22 : -0.05;
    this.prevChassisYaw = chassisYaw;
    this.lastAppliedViewYaw = chassisYaw;
    this.lastAppliedViewPitch = initPitch;
    this.vehicleFreeLookUntil = 0;
    this.input.resetView(chassisYaw, initPitch);

    const vf = this.abi.f32;
    vf[F32.POS_X] = vf[F32.PREV_X] = f32(chassis.pos.x);
    vf[F32.POS_Y] = vf[F32.PREV_Y] = f32(chassis.pos.y);
    vf[F32.POS_Z] = vf[F32.PREV_Z] = f32(chassis.pos.z + 36);

    this.audio.playWeaponSwitch();
    this.hud.showToast(
      `DRIVING 4WD BUGGY (${this.vehicleCameraMode === 'chase' ? 'CHASE' : 'COCKPIT'})  •  [WASD] DRIVE  •  [C] CAM  •  [E] EXIT`,
      'rgba(251, 191, 36, 0.85)',
    );
  }

  private exitVehicle(announce = true): void {
    const vehicleId = this.drivingVehicleId ?? this.physics.getDrivenVehicleId();
    this.physics.setDrivenVehicle(null);
    this.drivingVehicleId = null;
    this.prevChassisYaw = null;
    this.renderer.resetVehicleChaseCamera();
    this.viewmodel.root.visible = !this.gravityGunActive;

    if (!vehicleId) return;

    const veh = this.physics.getVehicles().find((v) => v.id === vehicleId);
    const chassis = veh
      ? this.physics.getRigidBodies().find((b) => b.id === veh.chassisId)
      : undefined;

    this.physics.setVehicleControls(vehicleId, 0, 0, 1);

    if (chassis) {
      const vf = this.abi.f32;
      vf[F32.POS_X] = f32(chassis.pos.x);
      vf[F32.POS_Y] = f32(chassis.pos.y + chassis.hy + 38);
      vf[F32.POS_Z] = f32(chassis.pos.z + 36);
      vf[F32.PREV_X] = vf[F32.POS_X];
      vf[F32.PREV_Y] = vf[F32.POS_Y];
      vf[F32.PREV_Z] = vf[F32.POS_Z];
      vf[F32.VEL_X] = f32(chassis.vel.x * 0.35);
      vf[F32.VEL_Y] = f32(chassis.vel.y * 0.35);
      vf[F32.VEL_Z] = f32(120);
    }

    if (announce) {
      this.audio.playWeaponSwitch();
      this.hud.showToast('EXITED VEHICLE', 'rgba(148,163,184,0.7)');
    }
  }

  private handleSandboxKeyup = (e: KeyboardEvent): void => {
    if (e.code === 'F3') {
      this.hud.setScoreboardVisible(false);
    }
  };

  private handleSandboxHotkey = (e: KeyboardEvent): void => {
    if (e.repeat) return;

    // Hold [F3] to display T vs. CT match scoreboard
    if (e.code === 'F3') {
      e.preventDefault();
      this.hud.setScoreboardVisible(true);
      return;
    }

    if (!this.input.isPointerLocked) return;

    if (this.drivingVehicleId && e.code === 'KeyC') {
      this.vehicleCameraMode = this.vehicleCameraMode === 'chase' ? 'first' : 'chase';
      this.renderer.resetVehicleChaseCamera();
      this.vehicleFreeLookUntil = 0;
      const targetPitch = this.vehicleCameraMode === 'chase' ? -0.22 : -0.05;
      this.input.resetView(this.input.viewYaw, targetPitch);
      this.lastAppliedViewYaw = this.input.viewYaw;
      this.lastAppliedViewPitch = targetPitch;
      this.audio.playWeaponSwitch();
      this.hud.showToast(
        this.vehicleCameraMode === 'chase'
          ? 'VEHICLE CAMERA: 3RD PERSON CHASE [C]'
          : 'VEHICLE CAMERA: COCKPIT [C]',
        'rgba(56, 189, 248, 0.82)',
      );
      return;
    }

    if (e.code === 'Digit4') {
      if (!this.drivingVehicleId) {
        this.setGravityGunMode(!this.gravityGunActive);
      }
      return;
    }

    // Classic CS 1.6 team-switch hotkey [M]
    if (e.code === 'KeyM') {
      this.playerTeam = this.playerTeam === TeamId.CT ? TeamId.T : TeamId.CT;
      this.roundRestartAtTick = 0;
      this.roundTimerSec = 115;
      this.roundPhase = 'LIVE';
      this.physics.restoreVitals();
      this.matchManager.configure(
        {
          tSpawns: this.currentMapData.tSpawns,
          ctSpawns: this.currentMapData.ctSpawns,
          fallbackSpawn: this.currentMapData.spawn,
        },
        this.playerTeam,
        this.botsPerTeam,
      );
      this.weapons.resetLoadout();
      this.audio.playWeaponSwitch();
      this.hud.showToast(
        this.playerTeam === TeamId.CT
          ? 'JOINED COUNTER-TERRORISTS (SAS / GIGN)'
          : 'JOINED TERRORISTS (PHOENIX / LEET)',
        this.playerTeam === TeamId.CT ? 'rgba(56, 189, 248, 0.9)' : 'rgba(239, 68, 68, 0.9)',
      );
      return;
    }

    // Toggle mp_solid_teammates [N] (Boosting vs. Semiclip)
    if (e.code === 'KeyN') {
      this.physics.solidTeammates = !this.physics.solidTeammates;
      this.hud.showToast(
        this.physics.solidTeammates
          ? 'mp_solid_teammates 1 (BOOSTING ENABLED)'
          : 'mp_solid_teammates 0 (SEMICLIP ENABLED)',
        'rgba(251, 191, 36, 0.85)',
      );
      return;
    }

    if (e.code === 'KeyB') {
      if (!this.activeCheckpoint) {
        this.hud.showToast('NO STAGE CHECKPOINT REACHED YET', 'rgba(148,163,184,0.6)');
        return;
      }
      if (this.drivingVehicleId) this.exitVehicle(false);
      this.runTracker.invalidateRankedRun();
      this.physics.restoreVitals();
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
      if (this.drivingVehicleId) this.exitVehicle(false);
      this.runTracker.invalidateRankedRun();
      this.physics.restoreVitals();
      this.physics.teleportToCheckpoint(this.customCheckpoint);
      this.input.resetView(this.customCheckpoint.yaw, this.customCheckpoint.pitch);
      this.audio.playTeleport();
      this.hud.showToast('LOADED PRACTICE CHECKPOINT (Unranked)', 'rgba(56,189,248,0.7)');
    } else if (e.code === 'KeyT') {
      this.spawnCrateAhead();
    } else if (e.code === 'KeyF') {
      this.detonateBlastAhead();
    } else if (e.code === 'KeyX') {
      this.resetSubsystemsAndProps();
      this.hud.showToast('PROPS, RAGDOLLS, JOINTS & VEHICLES RESET', 'rgba(251,191,36,0.65)');
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
        hp: 80,
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
      x: vf[F32.POS_X] + dirX * 140,
      y: vf[F32.POS_Y] + dirY * 140,
      z: vf[F32.POS_Z] + vf[F32.VIEW_OFS_Z] + dirZ * 140,
    };

    this.physics.applyExplosionImpulse(origin, 72000, 620, 1.25, 'hotkey_blast');
  }

  private computeInteractPrompt(): InteractPrompt | null {
    if (this.drivingVehicleId) {
      return {
        key: 'E / C',
        label: this.vehicleCameraMode === 'chase' ? 'EXIT BUGGY • COCKPIT CAM' : 'EXIT BUGGY • CHASE CAM',
      };
    }

    if (this.physics.getGravityGunState().heldBodyId) {
      return null;
    }

    if (this.physics.getActiveLadder()) {
      return { key: 'SPACE', label: 'JUMP OFF LADDER' };
    }

    const nearVeh = this.findNearbyVehicle(165);
    if (nearVeh) {
      return { key: 'E', label: 'ENTER 4WD BUGGY' };
    }

    const eye = this.physics.getPlayerEyePosition();
    const { forward } = computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0);

    const nearWeapon = this.physics.findNearbyWeapon(135, eye, forward, 0.78, false);
    if (nearWeapon?.weaponData) {
      const name = nearWeapon.weaponData.slot === 1 ? 'SCOUT' : 'USP .45';
      return { key: 'E', label: `PICK UP ${name}` };
    }

    const hit = this.physics.traceRay(eye, forward, this.gravityGunActive ? 380 : 240);
    if (hit.hit && hit.kind === 'rigidBody' && hit.body && hit.body.mass > 0 && hit.body.mass <= 260) {
      return {
        key: this.gravityGunActive ? 'RMB' : 'E',
        label: `GRAB ${hit.body.id.toUpperCase()} (${Math.round(hit.body.mass)} kg)`,
      };
    }

    return null;
  }

  private buildSubsystemTelemetry(): SubsystemTelemetry {
    const bodies = this.physics.getRigidBodies();
    const joints = this.physics.getJoints();
    const grav = this.physics.getGravityGunState();
    const heldBody = grav.heldBodyId ? bodies.find((b) => b.id === grav.heldBodyId) ?? null : null;
    const activeLad = this.physics.getActiveLadder();
    const activeVeh = this.drivingVehicleId
      ? this.physics.getVehicles().find((v) => v.id === this.drivingVehicleId) ?? null
      : null;
    const vehChassis = activeVeh ? bodies.find((b) => b.id === activeVeh.chassisId) ?? null : null;

    let activeBodies = 0;
    for (let i = 0; i < bodies.length; i++) {
      if (!bodies[i].sleeping) activeBodies++;
    }
    let intactJoints = 0;
    for (let i = 0; i < joints.length; i++) {
      if (!joints[i].broken) intactJoints++;
    }

    const vf = this.abi.f32;
    return {
      activeBodies,
      totalBodies: bodies.length,
      intactJoints,
      totalJoints: joints.length,
      waterSubmersion: this.physics.getPlayerWaterSubmersion(),
      heldProp: heldBody
        ? { id: heldBody.id, mass: heldBody.mass, holdDistance: grav.holdDistance }
        : null,
      ladder: activeLad
        ? {
            id: activeLad.id,
            posZ: vf[F32.POS_Z],
            velZ: vf[F32.VEL_Z],
            progressPct:
              ((vf[F32.POS_Z] - activeLad.minZ) / Math.max(1, activeLad.maxZ - activeLad.minZ)) *
              100,
          }
        : null,
      drivingVehicle:
        activeVeh && vehChassis
          ? {
              vehicle: activeVeh,
              speedUnits: Math.hypot(vehChassis.vel.x, vehChassis.vel.y, vehChassis.vel.z),
            }
          : null,
      interactPrompt: this.computeInteractPrompt(),
      vitals: this.physics.getVitals(),
    };
  }

  private stepPhysicsTick(): void {
    const { f32: vf, i32: vi } = this.abi;
    const keys = this.input.keys;
    const maxSpd = this.weapons.getMoveSpeed();

    let fmove = 0;
    let smove = 0;
    let buttons = 0;

    if (this.drivingVehicleId) {
      // Route WASD + Space into 4-wheel raycast vehicle controller
      const throttle = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
      const steer = (keys.a ? 1 : 0) - (keys.d ? 1 : 0);
      const handbrake = keys.jump ? 1 : 0;
      this.physics.setVehicleControls(this.drivingVehicleId, throttle, steer, handbrake);
      this.input.consumeScrollJump();
    } else {
      if (keys.w) fmove += maxSpd;
      if (keys.s) fmove -= maxSpd;
      if (keys.d) smove += maxSpd;
      if (keys.a) smove -= maxSpd;

      if (keys.jump || this.input.consumeScrollJump()) buttons |= IN_JUMP;
      if (keys.duck) buttons |= IN_DUCK;
      if (keys.attack1) buttons |= IN_ATTACK;
      if (keys.attack2) buttons |= IN_ATTACK2;
      if (keys.reload) buttons |= IN_RELOAD;
      if (keys.use) buttons |= IN_USE;
    }

    vf[F32.CMD_FMOVE] = f32(fmove);
    vf[F32.CMD_SMOVE] = f32(smove);
    vf[F32.CMD_YAW] = f32(this.input.viewYaw);
    vf[F32.CMD_PITCH] = f32(this.input.viewPitch);
    vf[F32.CMD_MAXSPEED] = maxSpd;
    vi[I32.BUTTONS] = buttons;

    const preXY = Math.hypot(vf[F32.VEL_X], vf[F32.VEL_Y]);
    const tick = vi[I32.TICK];

    const t0 = performance.now();
    // 1. Write bot ActorInputCmds before stepping simulation
    this.bots.stepTick(tick);
    // 2. Step Actor 0 + VPhysics subsystems
    this.physics.simulateTick();
    // 3. Step bot actors through GoldSrc CGameMovement + resolve solid PvP hulls / boosting
    this.physics.simulateAllBotsAndPvp();
    const dtSim = performance.now() - t0;
    this.simMsAvg = this.simMsAvg * 0.92 + dtSim * 0.08;

    // 4. Evaluate T vs. CT round status & delayed round restart
    const nextTick = vi[I32.TICK];
    if (this.matchActive && this.roundPhase === 'LIVE') {
      this.roundTimerSec = Math.max(0, this.roundTimerSec - FIXED_DT);
    }

    if (this.roundRestartAtTick > 0) {
      if (nextTick >= this.roundRestartAtTick) {
        this.roundRestartAtTick = 0;
        this.roundNumber += 1;
        this.roundTimerSec = 115;
        this.roundPhase = 'LIVE';
        this.physics.restoreVitals();
        this.resetSubsystemsAndProps();
        this.matchManager.startNewRound(nextTick);
        this.weapons.resetLoadout();
        this.hud.showToast('NEW ROUND — LIVE!', 'rgba(52, 211, 153, 0.85)');
      }
    } else {
      const { winner, snapshot } = this.matchManager.evaluateRound(nextTick);
      this.tScore = snapshot.tScore;
      this.ctScore = snapshot.ctScore;
      if (winner !== null) {
        this.roundPhase = 'ROUND_END';
        const winText = winner === TeamId.CT ? 'COUNTER-TERRORISTS WIN' : 'TERRORISTS WIN';
        this.audio.playFinishChime();
        this.hud.showToast(
          `${winText}  •  CT ${snapshot.ctScore} : ${snapshot.tScore} T`,
          winner === TeamId.CT ? 'rgba(56, 189, 248, 0.92)' : 'rgba(239, 68, 68, 0.92)',
        );
        this.roundRestartAtTick = nextTick + 300; // 3.0 s round-end cooldown at 100 Hz
      }
    }

    // Sync driving state if chassis was removed/destroyed during simulateTick()
    if (this.drivingVehicleId && !this.physics.getDrivenVehicleId()) {
      this.drivingVehicleId = null;
      this.prevChassisYaw = null;
      this.renderer.resetVehicleChaseCamera();
      this.viewmodel.root.visible = !this.gravityGunActive;
    }

    const postXY = Math.hypot(vf[F32.VEL_X], vf[F32.VEL_Y]);
    const airborne = (vi[I32.FLAGS] & FL_ONGROUND) === 0;
    const yawDelta = this.input.consumeTickYawDelta();
    this.strafeSync.recordTick(airborne, keys.a, keys.d, yawDelta, preXY, postXY);
    this.runTracker.tick(nextTick);
  }

  /**
   * Smoothly rotates view yaw with the buggy chassis + subtle apex look-in,
   * while yielding immediately whenever the player free-looks with the mouse.
   */
  private updateVehicleSteeringCamera(frameDt: number, nowSec: number): void {
    if (!this.drivingVehicleId) return;

    const veh = this.physics.getVehicles().find((v) => v.id === this.drivingVehicleId);
    const chassis = veh
      ? this.physics.getRigidBodies().find((b) => b.id === veh.chassisId)
      : undefined;
    if (!veh || !chassis) return;

    let yaw = this.input.viewYaw;
    let pitch = this.input.viewPitch;

    const mouseMoved =
      Math.abs(wrapAngleRad(yaw - this.lastAppliedViewYaw)) > 1e-4 ||
      Math.abs(pitch - this.lastAppliedViewPitch) > 1e-4;
    if (mouseMoved) {
      this.vehicleFreeLookUntil = nowSec + 1.15;
    }

    const chassisYaw = getChassisYaw(chassis.quat, this.prevChassisYaw ?? yaw);
    if (this.prevChassisYaw === null) {
      this.prevChassisYaw = chassisYaw;
    }

    // 1. Inherit chassis turn delta so turning naturally carries the view
    const dChassisYaw = wrapAngleRad(chassisYaw - this.prevChassisYaw);
    this.prevChassisYaw = chassisYaw;
    const inheritScale = this.vehicleCameraMode === 'first' ? 1.0 : 0.85;
    yaw = wrapAngleRad(yaw + dChassisYaw * inheritScale);

    // 2. Smoothly re-center behind the chassis after free-look timeout
    if (nowSec >= this.vehicleFreeLookUntil) {
      const fwdX = Math.cos(chassisYaw);
      const fwdY = Math.sin(chassisYaw);
      const fwdSpeed = chassis.vel.x * fwdX + chassis.vel.y * fwdY;
      const horizSpeed = Math.hypot(chassis.vel.x, chassis.vel.y);
      const activelyDriving =
        Math.abs(veh.throttle) > 0.05 || Math.abs(veh.steer) > 0.05 || horizSpeed > 25;

      if (activelyDriving) {
        const apexOffset = fwdSpeed >= -15 ? veh.steer * 0.14 : 0;
        const targetYaw = wrapAngleRad(chassisYaw + apexOffset);
        const speedFactor = Math.min(1.6, 0.55 + horizSpeed / 450);
        const baseRate = this.vehicleCameraMode === 'chase' ? 5.2 : 3.8;
        const alignRate = (fwdSpeed < -30 ? baseRate * 0.35 : baseRate) * speedFactor;
        const yawAlpha = 1 - Math.exp(-alignRate * frameDt);
        yaw = wrapAngleRad(yaw + wrapAngleRad(targetYaw - yaw) * yawAlpha);

        const targetPitch = this.vehicleCameraMode === 'chase' ? -0.22 : -0.05;
        const pitchAlpha = 1 - Math.exp(-3.2 * frameDt);
        pitch = pitch + (targetPitch - pitch) * pitchAlpha;
      }
    }

    const minPitch = this.vehicleCameraMode === 'chase' ? -0.68 : -1.45;
    const maxPitch = this.vehicleCameraMode === 'chase' ? 0.35 : 1.45;
    pitch = Math.max(minPitch, Math.min(maxPitch, pitch));

    this.input.resetView(yaw, pitch);
    this.lastAppliedViewYaw = yaw;
    this.lastAppliedViewPitch = pitch;
  }

  public start(): void {
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);

    const frameDt = Math.min(0.05, (now - this.lastFrameTime) * 0.001);
    const nowSec = now * 0.001;
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
      if (!this.drivingVehicleId && !this.gravityGunActive) {
        this.weapons.update(nowSec);
      }
    } else {
      this.accumulator = 0;
    }

    if (locked && this.drivingVehicleId) {
      this.updateVehicleSteeringCamera(frameDt, nowSec);
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

    let camX = rx;
    let camY = ry;
    let camZ = rz + rEye;

    if (this.drivingVehicleId && this.vehicleCameraMode === 'chase') {
      const veh = this.physics.getVehicles().find((v) => v.id === this.drivingVehicleId);
      const pivot = { x: rx, y: ry, z: rz + 14 };
      const { forward } = computeAngleVectors(-renderPitch, renderYaw, 0);
      const desiredDist = 210 + Math.min(45, spdXY * 0.045);

      this.chaseRayIgnore.clear();
      if (veh) this.chaseRayIgnore.add(veh.chassisId);

      const wallHit = this.physics.traceRay(
        pivot,
        { x: -forward.x, y: -forward.y, z: -forward.z },
        desiredDist,
        this.chaseRayIgnore,
      );
      const clampedDist = wallHit.hit ? Math.max(54, wallHit.distance - 16) : desiredDist;

      const chasePos = this.renderer.resolveVehicleChaseCamera(frameDt, {
        pivotX: pivot.x,
        pivotY: pivot.y,
        pivotZ: pivot.z,
        forwardX: forward.x,
        forwardY: forward.y,
        forwardZ: forward.z,
        clampedDist,
        speedXY: spdXY,
      });
      camX = chasePos.x;
      camY = chasePos.y;
      camZ = chasePos.z;
    } else {
      this.renderer.resetVehicleChaseCamera();
    }

    const eyePos = { x: camX, y: camY, z: camZ };

    this.audio.updateListener({
      pos: eyePos,
      vel: { x: vf[F32.VEL_X], y: vf[F32.VEL_Y], z: vf[F32.VEL_Z] },
      yaw: renderYaw,
      pitch: renderPitch,
    });
    this.audio.updateContinuous(spd3D, vi[I32.MOVESTATE] === MoveState.SURF, !locked, vf[F32.SURF_NZ]);

    this.renderer.update(frameDt, camX, camY, camZ, renderYaw, renderPitch, spdXY);

    const subsystems = this.buildSubsystemTelemetry();
    const weaponSnap = this.weapons.getHudSnapshot(nowSec);
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
      cvarLabel: `${this.currentMapId} | aa:${Math.round(vf[F32.CVAR_AIRACCEL])} mv:${Math.round(vf[F32.CVAR_MAXVEL])}`,
      subsystems,
      grenade: weaponSnap.grenade,
      match: this.buildMatchHudState(),
    });

    this.combatHud.update(frameDt, this.physics.getVitals(), weaponSnap);

    const bodies = this.physics.getRigidBodies();
    const heldId = this.physics.getGravityGunState().heldBodyId;
    const heldBody = heldId ? bodies.find((b) => b.id === heldId) ?? null : null;

    this.renderer.syncSubsystems(
      bodies,
      this.physics.getRopes(),
      this.physics.getVehicles(),
      this.physics.getJoints(),
      heldBody ? eyePos : null,
      heldBody,
    );
    this.renderer.syncActors(this.abi, frameDt, this.physics.solidTeammates);
    this.nameplates?.sync(this.abi, this.actorNames, 0);
    this.renderer.render();
  };
}

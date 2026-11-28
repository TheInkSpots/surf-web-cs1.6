// src/gameplay/BotController.ts
import { FIXED_DT, FL_DUCKING, FL_ONGROUND, IN_DUCK, IN_JUMP } from '../core/constants';
import {
  ACTOR_F32_BASE_INDEX,
  ACTOR_F32_STRIDE,
  ACTOR_I32_BASE_INDEX,
  ACTOR_I32_STRIDE,
  ActorF32,
  ActorI32,
  HitGroup,
  MAX_ACTORS,
  PhysicsMemoryAbi,
  TeamId,
} from '../core/memoryAbi';
import {
  ActorInputCmd,
  computeAngleVectors,
  GoldSrcPhysicsEngine,
  IN_ATTACK,
  IN_RELOAD,
  Vec3,
  WeaponSlot,
} from '../physics/GoldSrcPhysicsEngine';

export type NavFlag =
  | 'jump'
  | 'duck'
  | 'ladder'
  | 'surf_ramp'
  | 'camp'
  | 'bombsite'
  | 't_spawn'
  | 'ct_spawn';

export interface NavEdge {
  to: number;
  flags?: NavFlag[];
  costScale?: number;
}

export interface NavWaypoint {
  id: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  flags?: NavFlag[];
  edges: NavEdge[];
}

export interface MapNavGraph {
  waypoints: NavWaypoint[];
}

export type BotState =
  | 'BUY'
  | 'ROUTE_TO_OBJECTIVE'
  | 'ENGAGE'
  | 'PLANT_OR_DEFUSE'
  | 'RETREAT_RELOAD';

export interface BotProfile {
  name: string;
  /** Reaction delay before first shot after spotting an enemy (150–450 ms) */
  reactionDelayMs: number;
  /** Angular aim-error half-cone in radians (e.g. 0.015–0.055 rad) */
  aimErrorConeRad: number;
  /** Maximum angular turn rate in rad/s */
  turnRateRadPerSec: number;
  /** Aggression [0..1] controlling push vs. camp tendencies */
  aggression: number;
}

export interface BotShotEvent {
  shooterId: number;
  origin: Vec3;
  dir: Vec3;
  slot: WeaponSlot;
  hitActorId?: number;
  hitGroup?: HitGroup;
  hitPoint: Vec3;
  killed: boolean;
}

interface BotRuntime {
  actorId: number;
  profile: BotProfile;
  state: BotState;
  path: number[];
  pathCursor: number;
  targetActorId: number;
  spottedAtTick: number;
  lastSeenPos: Vec3 | null;
  alertPos: Vec3 | null;
  alertExpireTick: number;
  nextFireTick: number;
  burstShotsFired: number;
  burstResetTick: number;
  clipAmmo: number;
  reloadFinishTick: number;
  objectiveProgressTicks: number;
  strafeSign: number;
  strafeFlipTick: number;
  aimErrYaw: number;
  aimErrPitch: number;
  stuckTicks: number;
  lastCheckX: number;
  lastCheckY: number;
}

export interface BotControllerCallbacks {
  onBotFired?: (ev: BotShotEvent) => void;
  onObjectiveComplete?: (actorId: number, team: TeamId) => void;
}

function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

function dist3(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const DEFAULT_BOT_NAMES = [
  'POD_Gabe', 'POD_Minh', 'POD_Jess', 'ZBot_Cliffe',
  'ZBot_Reed', 'ZBot_Waldo', 'POD_Kovacs', 'ZBot_Vance',
];

export class BotController {
  private readonly abi: PhysicsMemoryAbi;
  private readonly physics: GoldSrcPhysicsEngine;
  private readonly callbacks: BotControllerCallbacks;
  private nav: MapNavGraph = { waypoints: [] };
  private bots = new Map<number, BotRuntime>();

  constructor(
    abi: PhysicsMemoryAbi,
    physics: GoldSrcPhysicsEngine,
    callbacks: BotControllerCallbacks = {},
  ) {
    this.abi = abi;
    this.physics = physics;
    this.callbacks = callbacks;
  }

  public setNavGraph(nav: MapNavGraph): void {
    this.nav = nav;
    for (const bot of this.bots.values()) {
      bot.path = [];
      bot.pathCursor = 0;
    }
  }

  public registerBot(actorId: number, profile?: Partial<BotProfile>): void {
    const idx = Math.max(0, actorId - 1) % DEFAULT_BOT_NAMES.length;
    const fullProfile: BotProfile = {
      name: profile?.name ?? DEFAULT_BOT_NAMES[idx],
      reactionDelayMs: profile?.reactionDelayMs ?? (150 + Math.random() * 300),
      aimErrorConeRad: profile?.aimErrorConeRad ?? (0.018 + Math.random() * 0.032),
      turnRateRadPerSec: profile?.turnRateRadPerSec ?? (5.5 + Math.random() * 3.5),
      aggression: profile?.aggression ?? (0.35 + Math.random() * 0.55),
    };

    const f = ACTOR_F32_BASE_INDEX + actorId * ACTOR_F32_STRIDE;
    this.bots.set(actorId, {
      actorId,
      profile: fullProfile,
      state: 'BUY',
      path: [],
      pathCursor: 0,
      targetActorId: -1,
      spottedAtTick: -1,
      lastSeenPos: null,
      alertPos: null,
      alertExpireTick: 0,
      nextFireTick: 0,
      burstShotsFired: 0,
      burstResetTick: 0,
      clipAmmo: 12,
      reloadFinishTick: 0,
      objectiveProgressTicks: 0,
      strafeSign: actorId % 2 === 0 ? 1 : -1,
      strafeFlipTick: 0,
      aimErrYaw: 0,
      aimErrPitch: 0,
      stuckTicks: 0,
      lastCheckX: this.abi.f32[f + ActorF32.POS_X],
      lastCheckY: this.abi.f32[f + ActorF32.POS_Y],
    });
  }

  public clearBots(): void {
    this.bots.clear();
  }

  /** Sound-triggered alertness: footsteps (running without ducking) or gunfire */
  public notifySoundEvent(sourceActorId: number, pos: Vec3, radiusHu: number, tick: number): void {
    const srcTeam =
      this.abi.i32[ACTOR_I32_BASE_INDEX + sourceActorId * ACTOR_I32_STRIDE + ActorI32.TEAM];

    for (const bot of this.bots.values()) {
      const ib = ACTOR_I32_BASE_INDEX + bot.actorId * ACTOR_I32_STRIDE;
      if (this.abi.i32[ib + ActorI32.ALIVE] === 0) continue;
      if (this.abi.i32[ib + ActorI32.TEAM] === srcTeam) continue;

      const fb = ACTOR_F32_BASE_INDEX + bot.actorId * ACTOR_F32_STRIDE;
      const d = dist3(
        this.abi.f32[fb + ActorF32.POS_X],
        this.abi.f32[fb + ActorF32.POS_Y],
        this.abi.f32[fb + ActorF32.POS_Z],
        pos.x,
        pos.y,
        pos.z,
      );
      if (d <= radiusHu) {
        bot.alertPos = { x: pos.x, y: pos.y, z: pos.z };
        bot.alertExpireTick = tick + 350; // Stay alert for 3.5 s
      }
    }
  }

  /** Called once per 100 Hz physics tick BEFORE physics.simulateAllBotsAndPvp() */
  public stepTick(tick: number): void {
    // Emit running footstep sound cues every 25 ticks for any loud actor
    if (tick % 25 === 0) {
      this.emitFootstepCues(tick);
    }

    for (const bot of this.bots.values()) {
      const i = ACTOR_I32_BASE_INDEX + bot.actorId * ACTOR_I32_STRIDE;
      if (this.abi.i32[i + ActorI32.ACTIVE] === 0 || this.abi.i32[i + ActorI32.ALIVE] === 0) {
        continue;
      }
      const cmd = this.thinkBot(bot, tick);
      this.physics.setActorInput(bot.actorId, cmd);
    }
  }

  private emitFootstepCues(tick: number): void {
    for (let id = 0; id < MAX_ACTORS; id++) {
      const i = ACTOR_I32_BASE_INDEX + id * ACTOR_I32_STRIDE;
      if (this.abi.i32[i + ActorI32.ACTIVE] === 0 || this.abi.i32[i + ActorI32.ALIVE] === 0) {
        continue;
      }
      const flags = this.abi.i32[i + ActorI32.FLAGS];
      if ((flags & FL_ONGROUND) === 0 || (flags & FL_DUCKING) !== 0) continue;

      const f = ACTOR_F32_BASE_INDEX + id * ACTOR_F32_STRIDE;
      const vx = this.abi.f32[f + ActorF32.VEL_X];
      const vy = this.abi.f32[f + ActorF32.VEL_Y];
      if (Math.hypot(vx, vy) > 135) {
        this.notifySoundEvent(
          id,
          { x: this.abi.f32[f + ActorF32.POS_X], y: this.abi.f32[f + ActorF32.POS_Y], z: this.abi.f32[f + ActorF32.POS_Z] },
          650,
          tick,
        );
      }
    }
  }

  private thinkBot(bot: BotRuntime, tick: number): ActorInputCmd {
    const f = ACTOR_F32_BASE_INDEX + bot.actorId * ACTOR_F32_STRIDE;
    const i = ACTOR_I32_BASE_INDEX + bot.actorId * ACTOR_I32_STRIDE;
    const f32Arr = this.abi.f32;
    const i32Arr = this.abi.i32;

    const pos: Vec3 = {
      x: f32Arr[f + ActorF32.POS_X],
      y: f32Arr[f + ActorF32.POS_Y],
      z: f32Arr[f + ActorF32.POS_Z],
    };
    const eyePos: Vec3 = { x: pos.x, y: pos.y, z: pos.z + f32Arr[f + ActorF32.VIEW_OFS_Z] };
    const curYaw = f32Arr[f + ActorF32.YAW];
    const curPitch = f32Arr[f + ActorF32.PITCH];
    const team = i32Arr[i + ActorI32.TEAM] as TeamId;

    // 1. Complete reload if active
    if (bot.reloadFinishTick > 0 && tick >= bot.reloadFinishTick) {
      bot.reloadFinishTick = 0;
      const activeSlot = i32Arr[i + ActorI32.ACTIVE_SLOT];
      bot.clipAmmo = activeSlot === 1 ? 10 : 12;
      if (bot.state === 'RETREAT_RELOAD') {
        bot.state = 'ROUTE_TO_OBJECTIVE';
      }
    }

    // 2. BUY phase (instant CS 1.6 bot purchase at round start)
    if (bot.state === 'BUY') {
      this.performBotBuy(bot);
      bot.state = 'ROUTE_TO_OBJECTIVE';
    }

    // 3. Vision scan (every 5 ticks = 20 Hz to save raycasts)
    if (tick % 5 === bot.actorId % 5) {
      const visibleEnemy = this.scanForEnemy(bot, eyePos, curYaw, team);
      if (visibleEnemy !== -1) {
        if (bot.targetActorId !== visibleEnemy) {
          bot.targetActorId = visibleEnemy;
          bot.spottedAtTick = tick;
          bot.aimErrYaw = (Math.random() * 2 - 1) * bot.profile.aimErrorConeRad;
          bot.aimErrPitch = (Math.random() * 2 - 1) * bot.profile.aimErrorConeRad * 0.6;
        }
        const ef = ACTOR_F32_BASE_INDEX + visibleEnemy * ACTOR_F32_STRIDE;
        bot.lastSeenPos = {
          x: f32Arr[ef + ActorF32.POS_X],
          y: f32Arr[ef + ActorF32.POS_Y],
          z: f32Arr[ef + ActorF32.POS_Z] + 18,
        };
        if (bot.reloadFinishTick === 0) {
          bot.state = 'ENGAGE';
        }
      } else if (bot.state === 'ENGAGE') {
        bot.targetActorId = -1;
        bot.state = 'ROUTE_TO_OBJECTIVE';
      }
    }

    // 4. FSM Execution
    let fmove = 0;
    let smove = 0;
    let buttons = 0;
    let desiredYaw = curYaw;
    let desiredPitch = 0;

    if (bot.state === 'ENGAGE' && bot.targetActorId >= 0) {
      const ef = ACTOR_F32_BASE_INDEX + bot.targetActorId * ACTOR_F32_STRIDE;
      const ei = ACTOR_I32_BASE_INDEX + bot.targetActorId * ACTOR_I32_STRIDE;
      if (i32Arr[ei + ActorI32.ALIVE] === 0) {
        bot.targetActorId = -1;
        bot.state = 'ROUTE_TO_OBJECTIVE';
      } else {
        // Aim at enemy chest/head with humanized error cone
        const aimZ =
          f32Arr[ef + ActorF32.POS_Z] + (bot.profile.aggression > 0.65 ? 24 : 12);
        const dx = f32Arr[ef + ActorF32.POS_X] - eyePos.x;
        const dy = f32Arr[ef + ActorF32.POS_Y] - eyePos.y;
        const dz = aimZ - eyePos.z;
        const horiz = Math.max(1, Math.hypot(dx, dy));

        desiredYaw = Math.atan2(dy, dx) + bot.aimErrYaw;
        desiredPitch = -Math.atan2(dz, horiz) + bot.aimErrPitch; // Source pitch: +down

        // Strafe-stopping for accurate burst fire
        const spdXY = Math.hypot(f32Arr[f + ActorF32.VEL_X], f32Arr[f + ActorF32.VEL_Y]);
        const reactionTicks = Math.round(bot.profile.reactionDelayMs / (FIXED_DT * 1000));
        const readyToFire = tick - bot.spottedAtTick >= reactionTicks;

        if (readyToFire && tick >= bot.nextFireTick && bot.clipAmmo > 0) {
          // Counter-strafe to stop before firing
          if (spdXY > 38) {
            fmove = 0;
            smove = 0;
          } else {
            buttons |= IN_ATTACK;
            this.fireBotWeapon(bot, eyePos, curYaw, curPitch, tick);
          }
        } else {
          // Micro-strafe between bursts
          if (tick >= bot.strafeFlipTick) {
            bot.strafeSign *= -1;
            bot.strafeFlipTick = tick + 35 + Math.floor(Math.random() * 45);
          }
          smove = bot.strafeSign * 250;
          if (horiz > 650) fmove = 180;
        }

        // Low clip or low HP -> Retreat / Reload
        if (bot.clipAmmo <= 0) {
          bot.state = 'RETREAT_RELOAD';
          bot.reloadFinishTick = tick + 125;
          buttons |= IN_RELOAD;
        }
      }
    } else if (bot.state === 'RETREAT_RELOAD') {
      // Back away while reloading
      if (bot.lastSeenPos) {
        desiredYaw = Math.atan2(bot.lastSeenPos.y - pos.y, bot.lastSeenPos.x - pos.x);
      }
      fmove = -250;
      smove = bot.strafeSign * 140;
    } else if (bot.state === 'PLANT_OR_DEFUSE') {
      // Hold duck at bombsite for 3.0s (300 ticks)
      buttons |= IN_DUCK;
      bot.objectiveProgressTicks++;
      if (bot.objectiveProgressTicks >= 300) {
        bot.objectiveProgressTicks = 0;
        bot.state = 'ROUTE_TO_OBJECTIVE';
        this.callbacks.onObjectiveComplete?.(bot.actorId, team);
      }
    } else {
      // ROUTE_TO_OBJECTIVE
      const navResult = this.followNavPath(bot, pos, team, tick);
      desiredYaw = navResult.yaw;
      desiredPitch = navResult.pitch;
      fmove = navResult.fmove;
      smove = navResult.smove;
      buttons |= navResult.buttons;

      // Sound-triggered alertness: glance toward heard enemy footsteps/gunfire
      if (bot.alertPos && tick < bot.alertExpireTick) {
        desiredYaw = Math.atan2(bot.alertPos.y - pos.y, bot.alertPos.x - pos.x);
      }
    }

    // 5. Smooth angular slew so bot aim moves at human speed
    const maxStep = bot.profile.turnRateRadPerSec * FIXED_DT;
    const yawDiff = wrapAngle(desiredYaw - curYaw);
    const nextYaw = curYaw + Math.max(-maxStep, Math.min(maxStep, yawDiff));
    const pitchDiff = desiredPitch - curPitch;
    const nextPitch = Math.max(
      -1.45,
      Math.min(1.45, curPitch + Math.max(-maxStep, Math.min(maxStep, pitchDiff))),
    );

    return { fmove, smove, yaw: nextYaw, pitch: nextPitch, buttons };
  }

  private performBotBuy(bot: BotRuntime): void {
    const i = ACTOR_I32_BASE_INDEX + bot.actorId * ACTOR_I32_STRIDE;
    const i32Arr = this.abi.i32;
    let cash = i32Arr[i + ActorI32.CASH];

    if (cash >= 1000) {
      cash -= 1000;
      i32Arr[i + ActorI32.ARMOR] = 100;
      i32Arr[i + ActorI32.HAS_HELMET] = 1;
    } else if (cash >= 650) {
      cash -= 650;
      i32Arr[i + ActorI32.ARMOR] = 100;
    }

    // Buy Scout ($2750) if affordable, otherwise keep USP .45
    if (cash >= 2750) {
      cash -= 2750;
      i32Arr[i + ActorI32.WEAPON_MASK] |= 1 << 1;
      i32Arr[i + ActorI32.ACTIVE_SLOT] = 1;
      bot.clipAmmo = 10;
    } else {
      i32Arr[i + ActorI32.ACTIVE_SLOT] = 2;
      bot.clipAmmo = 12;
    }
    i32Arr[i + ActorI32.CASH] = cash;
  }

  private scanForEnemy(bot: BotRuntime, eyePos: Vec3, yaw: number, myTeam: TeamId): number {
    const f32Arr = this.abi.f32;
    const i32Arr = this.abi.i32;
    const fwdX = Math.cos(yaw);
    const fwdY = Math.sin(yaw);

    let bestId = -1;
    let bestDist = 2600;

    for (let id = 0; id < MAX_ACTORS; id++) {
      if (id === bot.actorId) continue;
      const oi = ACTOR_I32_BASE_INDEX + id * ACTOR_I32_STRIDE;
      if (i32Arr[oi + ActorI32.ACTIVE] === 0 || i32Arr[oi + ActorI32.ALIVE] === 0) continue;
      const otherTeam = i32Arr[oi + ActorI32.TEAM] as TeamId;
      if (otherTeam === TeamId.SPEC || otherTeam === myTeam) continue;

      const of = ACTOR_F32_BASE_INDEX + id * ACTOR_F32_STRIDE;
      const tx = f32Arr[of + ActorF32.POS_X];
      const ty = f32Arr[of + ActorF32.POS_Y];
      const tz = f32Arr[of + ActorF32.POS_Z] + 18;
      const dx = tx - eyePos.x;
      const dy = ty - eyePos.y;
      const dz = tz - eyePos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d >= bestDist || d < 1) continue;

      // 110° FOV cone (cos 55° ≈ 0.57), widened if sound-alerted
      const dot = (dx * fwdX + dy * fwdY) / Math.max(1, Math.hypot(dx, dy));
      if (dot < 0.45 && d > 220) continue;

      const hit = this.physics.traceRayWithActors(
        eyePos,
        { x: dx / d, y: dy / d, z: dz / d },
        d + 16,
        bot.actorId,
      );
      if (hit.hit && hit.actorId === id) {
        bestDist = d;
        bestId = id;
      }
    }
    return bestId;
  }

  private fireBotWeapon(
    bot: BotRuntime,
    eyePos: Vec3,
    yaw: number,
    pitch: number,
    tick: number,
  ): void {
    const i = ACTOR_I32_BASE_INDEX + bot.actorId * ACTOR_I32_STRIDE;
    const slot = (this.abi.i32[i + ActorI32.ACTIVE_SLOT] || 2) as WeaponSlot;
    const isScout = slot === 1;

    const { forward, right, up } = computeAngleVectors(pitch, yaw, 0);
    const spread = (isScout ? 0.012 : 0.025) + bot.burstShotsFired * 0.008;
    const rx = (Math.random() * 2 - 1) * spread;
    const ry = (Math.random() * 2 - 1) * spread;
    const dx = forward.x + right.x * rx + up.x * ry;
    const dy = forward.y + right.y * rx + up.y * ry;
    const dz = forward.z + right.z * rx + up.z * ry;
    const invLen = 1 / Math.hypot(dx, dy, dz);
    const dir: Vec3 = { x: dx * invLen, y: dy * invLen, z: dz * invLen };

    const hit = this.physics.traceRayWithActors(eyePos, dir, 4096, bot.actorId);
    let killed = false;
    if (hit.hit && hit.actorId !== undefined && hit.hitGroup !== undefined) {
      const dmgRes = this.physics.applyActorDamage(
        hit.actorId,
        isScout ? 75 : 32,
        hit.hitGroup,
        isScout ? 0.85 : 0.5,
        hit.point,
        dir,
        isScout ? 3600 : 1200,
      );
      killed = dmgRes.killed;
    }

    bot.clipAmmo = Math.max(0, bot.clipAmmo - 1);
    bot.burstShotsFired++;
    if (isScout) {
      bot.nextFireTick = tick + 125; // 1.25 s bolt cycle
      bot.burstShotsFired = 0;
    } else if (bot.burstShotsFired >= 3) {
      bot.nextFireTick = tick + 42; // Burst recoil cooldown
      bot.burstShotsFired = 0;
    } else {
      bot.nextFireTick = tick + 18;
    }

    // Gunfire alerts nearby enemy bots
    this.notifySoundEvent(bot.actorId, eyePos, 1800, tick);

    this.callbacks.onBotFired?.({
      shooterId: bot.actorId,
      origin: eyePos,
      dir,
      slot,
      hitActorId: hit.actorId,
      hitGroup: hit.hitGroup,
      hitPoint: hit.hit
        ? hit.point
        : { x: eyePos.x + dir.x * 2048, y: eyePos.y + dir.y * 2048, z: eyePos.z + dir.z * 2048 },
      killed,
    });
  }

  private followNavPath(
    bot: BotRuntime,
    pos: Vec3,
    team: TeamId,
    tick: number,
  ): { yaw: number; pitch: number; fmove: number; smove: number; buttons: number } {
    if (this.nav.waypoints.length === 0) {
      return { yaw: this.abi.f32[ACTOR_F32_BASE_INDEX + bot.actorId * ACTOR_F32_STRIDE + ActorF32.YAW], pitch: 0, fmove: 0, smove: 0, buttons: 0 };
    }

    // Compute new A* path if empty or finished
    if (bot.path.length === 0 || bot.pathCursor >= bot.path.length) {
      const startWp = this.findNearestWaypoint(pos);
      const goalWp = this.pickObjectiveWaypoint(team);
      bot.path = this.computeAStar(startWp, goalWp);
      bot.pathCursor = 0;
    }

    const wp = this.nav.waypoints[bot.path[bot.pathCursor]];
    if (!wp) {
      bot.path = [];
      return { yaw: 0, pitch: 0, fmove: 0, smove: 0, buttons: 0 };
    }

    const dx = wp.x - pos.x;
    const dy = wp.y - pos.y;
    const horizDist = Math.hypot(dx, dy);

    if (horizDist <= Math.max(wp.radius, 36) && Math.abs(wp.z - pos.z) < 72) {
      if (wp.flags?.includes('bombsite') && bot.pathCursor === bot.path.length - 1) {
        bot.state = 'PLANT_OR_DEFUSE';
        return { yaw: Math.atan2(dy, dx), pitch: 0, fmove: 0, smove: 0, buttons: IN_DUCK };
      }
      bot.pathCursor++;
    }

    // Edge-flag actions (jump, duck, ladder, surf_ramp)
    let buttons = 0;
    let fmove = 250;
    let smove = 0;
    let pitch = 0;

    const prevWp = bot.pathCursor > 0 ? this.nav.waypoints[bot.path[bot.pathCursor - 1]] : null;
    const edge = prevWp?.edges.find((e) => e.to === wp.id);
    if (edge?.flags?.includes('jump') && horizDist < 120) buttons |= IN_JUMP;
    if (edge?.flags?.includes('duck')) buttons |= IN_DUCK;
    if (edge?.flags?.includes('ladder')) pitch = wp.z > pos.z ? -0.9 : 0.9;
    if (edge?.flags?.includes('surf_ramp')) {
      // Release W on surf ramps and hold A/D into ramp side
      fmove = 0;
      smove = bot.strafeSign * 250;
    }

    // Basic stuck recovery every 50 ticks (0.5 s)
    if (tick % 50 === 0) {
      const moved = Math.hypot(pos.x - bot.lastCheckX, pos.y - bot.lastCheckY);
      bot.lastCheckX = pos.x;
      bot.lastCheckY = pos.y;
      if (moved < 18) {
        bot.stuckTicks++;
        buttons |= IN_JUMP;
        if (bot.stuckTicks >= 3) {
          bot.path = [];
          bot.stuckTicks = 0;
        }
      } else {
        bot.stuckTicks = 0;
      }
    }

    return { yaw: Math.atan2(dy, dx), pitch, fmove, smove, buttons };
  }

  private findNearestWaypoint(pos: Vec3): number {
    let bestId = 0;
    let bestD = Infinity;
    for (const wp of this.nav.waypoints) {
      const d = dist3(pos.x, pos.y, pos.z, wp.x, wp.y, wp.z);
      if (d < bestD) {
        bestD = d;
        bestId = wp.id;
      }
    }
    return bestId;
  }

  private pickObjectiveWaypoint(team: TeamId): number {
    const sites = this.nav.waypoints.filter((w) => w.flags?.includes('bombsite'));
    if (sites.length > 0) {
      return sites[Math.floor(Math.random() * sites.length)].id;
    }
    // Fallback: patrol opposite team spawn or random waypoint
    const targetFlag: NavFlag = team === TeamId.T ? 'ct_spawn' : 't_spawn';
    const spawnNodes = this.nav.waypoints.filter((w) => w.flags?.includes(targetFlag));
    if (spawnNodes.length > 0) {
      return spawnNodes[Math.floor(Math.random() * spawnNodes.length)].id;
    }
    return this.nav.waypoints[Math.floor(Math.random() * this.nav.waypoints.length)].id;
  }

  private computeAStar(startId: number, goalId: number): number[] {
    if (startId === goalId) return [goalId];
    const wps = this.nav.waypoints;
    const goal = wps[goalId];
    if (!goal) return [];

    const open = new Set<number>([startId]);
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>([[startId, 0]]);
    const fScore = new Map<number, number>([
      [startId, dist3(wps[startId].x, wps[startId].y, wps[startId].z, goal.x, goal.y, goal.z)],
    ]);

    while (open.size > 0) {
      let current = -1;
      let bestF = Infinity;
      for (const id of open) {
        const score = fScore.get(id) ?? Infinity;
        if (score < bestF) {
          bestF = score;
          current = id;
        }
      }
      if (current === goalId) {
        const path: number[] = [current];
        while (cameFrom.has(current)) {
          current = cameFrom.get(current)!;
          path.push(current);
        }
        return path.reverse();
      }
      open.delete(current);
      const curWp = wps[current];
      for (const edge of curWp.edges) {
        const nb = wps[edge.to];
        if (!nb) continue;
        const stepCost =
          dist3(curWp.x, curWp.y, curWp.z, nb.x, nb.y, nb.z) * (edge.costScale ?? 1.0);
        const tentativeG = (gScore.get(current) ?? Infinity) + stepCost;
        if (tentativeG < (gScore.get(edge.to) ?? Infinity)) {
          cameFrom.set(edge.to, current);
          gScore.set(edge.to, tentativeG);
          fScore.set(
            edge.to,
            tentativeG + dist3(nb.x, nb.y, nb.z, goal.x, goal.y, goal.z),
          );
          open.add(edge.to);
        }
      }
    }
    return [goalId];
  }
}

// src/gameplay/BotAI.ts
import { FIXED_DT, FL_DUCKING, HULL_DUCK, HULL_STAND, IN_JUMP } from '../core/constants';
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
  GoldSrcPhysicsEngine,
  IN_ATTACK,
  Vec3,
} from '../physics/GoldSrcPhysicsEngine';

export interface BotKillEvent {
  killerId: number;
  victimId: number;
  weapon: string;
  headshot: boolean;
  hitPoint: Vec3;
}

interface BotBrain {
  fireCooldown: number;
  strafeSign: number;
  strafeTimer: number;
  wanderYaw: number;
  wanderTimer: number;
}

export class BotAI {
  private readonly brains: BotBrain[] = Array.from({ length: MAX_ACTORS }, () => ({
    fireCooldown: 0.5,
    strafeSign: 1,
    strafeTimer: 1.0,
    wanderYaw: 0,
    wanderTimer: 1.5,
  }));

  public reset(): void {
    for (let i = 0; i < MAX_ACTORS; i++) {
      this.brains[i] = {
        fireCooldown: 0.4 + Math.random() * 0.5,
        strafeSign: Math.random() < 0.5 ? -1 : 1,
        strafeTimer: 0.8 + Math.random() * 1.2,
        wanderYaw: Math.random() * Math.PI * 2,
        wanderTimer: 1.0 + Math.random() * 2.0,
      };
    }
  }

  /** Called every 100 Hz tick right BEFORE physics.simulateAllBotsAndPvp() */
  public tick(
    abi: PhysicsMemoryAbi,
    physics: GoldSrcPhysicsEngine,
    canFight: boolean,
  ): BotKillEvent[] {
    const kills: BotKillEvent[] = [];
    const f32Arr = abi.f32;
    const i32Arr = abi.i32;

    for (let id = 1; id < MAX_ACTORS; id++) {
      const idxI = ACTOR_I32_BASE_INDEX + id * ACTOR_I32_STRIDE;
      if (
        i32Arr[idxI + ActorI32.ACTIVE] !== 1 ||
        i32Arr[idxI + ActorI32.ALIVE] !== 1 ||
        i32Arr[idxI + ActorI32.IS_BOT] !== 1
      ) {
        continue;
      }

      const brain = this.brains[id];
      brain.fireCooldown = Math.max(0, brain.fireCooldown - FIXED_DT);
      brain.strafeTimer -= FIXED_DT;
      if (brain.strafeTimer <= 0) {
        brain.strafeSign *= -1;
        brain.strafeTimer = 0.65 + Math.random() * 1.1;
      }

      const idxF = ACTOR_F32_BASE_INDEX + id * ACTOR_F32_STRIDE;
      const myTeam = i32Arr[idxI + ActorI32.TEAM] as TeamId;
      const myPos: Vec3 = {
        x: f32Arr[idxF + ActorF32.POS_X],
        y: f32Arr[idxF + ActorF32.POS_Y],
        z: f32Arr[idxF + ActorF32.POS_Z],
      };
      const myEye: Vec3 = { x: myPos.x, y: myPos.y, z: myPos.z + f32Arr[idxF + ActorF32.VIEW_OFS_Z] };
      const curYaw = f32Arr[idxF + ActorF32.YAW];

      // Freeze-time: hold position
      if (!canFight) {
        physics.setActorInput(id, { fmove: 0, smove: 0, yaw: curYaw, pitch: 0, buttons: 0 });
        continue;
      }

      // Find nearest alive enemy
      let targetId = -1;
      let targetDist = Infinity;
      let targetEye: Vec3 | null = null;
      let hasLos = false;

      for (let other = 0; other < MAX_ACTORS; other++) {
        if (other === id) continue;
        const oI = ACTOR_I32_BASE_INDEX + other * ACTOR_I32_STRIDE;
        if (i32Arr[oI + ActorI32.ACTIVE] !== 1 || i32Arr[oI + ActorI32.ALIVE] !== 1) continue;
        const oTeam = i32Arr[oI + ActorI32.TEAM] as TeamId;
        if (oTeam === TeamId.SPEC || oTeam === myTeam) continue;

        const oF = ACTOR_F32_BASE_INDEX + other * ACTOR_F32_STRIDE;
        const duck = (i32Arr[oI + ActorI32.FLAGS] & FL_DUCKING) !== 0;
        const halfZ = duck ? HULL_DUCK.hz : HULL_STAND.hz;
        const eye: Vec3 = {
          x: f32Arr[oF + ActorF32.POS_X],
          y: f32Arr[oF + ActorF32.POS_Y],
          z: f32Arr[oF + ActorF32.POS_Z] + halfZ * 0.55,
        };
        const d = Math.hypot(eye.x - myEye.x, eye.y - myEye.y, eye.z - myEye.z);
        if (d < targetDist) {
          const dir = { x: (eye.x - myEye.x) / d, y: (eye.y - myEye.y) / d, z: (eye.z - myEye.z) / d };
          const worldRay = physics.traceRay(myEye, dir, d);
          const visible = !worldRay.hit || worldRay.distance >= d - 28;
          if (visible || !hasLos) {
            targetId = other;
            targetDist = d;
            targetEye = eye;
            hasLos = visible;
          }
        }
      }

      const cmd: ActorInputCmd = { fmove: 0, smove: 0, yaw: curYaw, pitch: 0, buttons: 0 };

      if (targetId !== -1 && targetEye) {
        const dx = targetEye.x - myEye.x;
        const dy = targetEye.y - myEye.y;
        const dz = targetEye.z - myEye.z;
        const horiz = Math.max(1, Math.hypot(dx, dy));
        const aimYaw = Math.atan2(dy, dx);
        const aimPitch = -Math.atan2(dz, horiz); // Source pitch (+down)

        cmd.yaw = aimYaw;
        cmd.pitch = aimPitch;
        cmd.fmove = targetDist > 340 ? 250 : targetDist < 170 ? -180 : 0;
        cmd.smove = hasLos ? brain.strafeSign * 210 : 0;

        if (hasLos && brain.fireCooldown <= 0 && targetDist < 2200) {
          cmd.buttons |= IN_ATTACK;
          brain.fireCooldown = 0.38 + Math.random() * 0.35;

          // Slight bot inaccuracy spread
          const spread = 0.032;
          const sx = (Math.random() - 0.5) * spread;
          const sy = (Math.random() - 0.5) * spread;
          const sz = (Math.random() - 0.5) * spread;
          const invD = 1 / Math.max(1, targetDist);
          const shotDir: Vec3 = {
            x: dx * invD + sx,
            y: dy * invD + sy,
            z: dz * invD + sz,
          };
          const shotHit = physics.traceRayWithActors(myEye, shotDir, 2400, id);
          if (shotHit.hit && shotHit.actorId !== undefined && shotHit.hitGroup !== undefined) {
            const slot = i32Arr[idxI + ActorI32.ACTIVE_SLOT];
            const isScout = slot === 1;
            const dmgRes = physics.applyActorDamage(
              shotHit.actorId,
              isScout ? 75 : 30,
              shotHit.hitGroup,
              isScout ? 0.85 : 0.5,
              shotHit.point,
              shotDir,
              isScout ? 2400 : 1100,
            );
            if (dmgRes.killed) {
              kills.push({
                killerId: id,
                victimId: shotHit.actorId,
                weapon: isScout ? 'SCOUT' : 'USP .45',
                headshot: shotHit.hitGroup === HitGroup.HEAD,
                hitPoint: shotHit.point,
              });
            }
          }
        }
      } else {
        // Patrol when no target exists
        brain.wanderTimer -= FIXED_DT;
        if (brain.wanderTimer <= 0) {
          brain.wanderYaw = curYaw + (Math.random() - 0.5) * 2.2;
          brain.wanderTimer = 1.4 + Math.random() * 2.0;
        }
        cmd.yaw = brain.wanderYaw;
        cmd.fmove = 220;
      }

      // Hop over small ledges if stuck while trying to move forward
      const speedXY = Math.hypot(f32Arr[idxF + ActorF32.VEL_X], f32Arr[idxF + ActorF32.VEL_Y]);
      if (Math.abs(cmd.fmove) > 100 && speedXY < 18 && Math.random() < 0.04) {
        cmd.buttons |= IN_JUMP;
      }

      physics.setActorInput(id, cmd);
    }

    return kills;
  }
}

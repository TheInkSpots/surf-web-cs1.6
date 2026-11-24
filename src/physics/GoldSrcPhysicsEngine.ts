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

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface SourcePhysicsConfig {
  sourceMaxVelocity?: number;
  svBounce?: number;
  playerMass?: number;
  surfaceFriction?: number;
  linearDamping?: number;
  angularDamping?: number;
  physPushScale?: number;
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

export interface SourceRigidBody {
  id: string;
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
}

export interface PhysicsCallbacks {
  onLand?: (impactSpeed: number) => void;
  onJump?: () => void;
  onStartRun?: () => void;
  onFinishRun?: () => void;
  onBoost?: (triggerId: string) => void;
  onTeleport?: (isFail: boolean) => void;
  onRigidBodyHit?: (bodyId: string, impulseMag: number) => void;
  onExplosion?: (triggerId: string, origin: Vec3, radius: number) => void;
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

/** Create a box rigid body with exact cuboid principal inertia tensor I = (m/12) * (w^2 + h^2) */
export function createBoxRigidBody(
  id: string,
  pos: Vec3,
  halfExtents: Vec3,
  mass: number,
  opts: {
    vel?: Vec3;
    restitution?: number;
    gravityScale?: number;
    surfaceFriction?: number;
  } = {},
): SourceRigidBody {
  const sx = halfExtents.x * 2;
  const sy = halfExtents.y * 2;
  const sz = halfExtents.z * 2;
  const inv12 = mass / 12;

  return {
    id,
    pos: { x: f32(pos.x), y: f32(pos.y), z: f32(pos.z) },
    vel: {
      x: f32(opts.vel?.x ?? 0),
      y: f32(opts.vel?.y ?? 0),
      z: f32(opts.vel?.z ?? 0),
    },
    quat: { w: f32(1), x: f32(0), y: f32(0), z: f32(0) },
    angVel: { x: f32(0), y: f32(0), z: f32(0) },
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
  };
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

/** Compute world inertia tensor I = R * I_local * R^T and its inverse I^-1 */
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

  // Source CGameMovement basevelocity (conveyors / pushers)
  private baseVelX = f32(0);
  private baseVelY = f32(0);
  private baseVelZ = f32(0);

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
    };
  }

  public getRigidBodies(): readonly SourceRigidBody[] {
    return this.rigidBodies;
  }

  public addRigidBody(body: SourceRigidBody): void {
    this.rigidBodies.push(body);
  }

  public setRigidBodies(bodies: SourceRigidBody[]): void {
    this.rigidBodies = bodies;
  }

  /** Radial explosion impulse scaled by blast radius R and phys_pushscale */
  public applyExplosionImpulse(
    origin: Vec3,
    maxDamage: number,
    radius: number,
    pushScaleOverride?: number,
    sourceId = 'manual_blast',
  ): void {
    if (radius <= 0) return;
    const kPush = pushScaleOverride ?? this.sourceConfig.physPushScale;
    const vf = this.abi.f32;

    // Player impulse
    const pDx = vf[F32.POS_X] - origin.x;
    const pDy = vf[F32.POS_Y] - origin.y;
    const pDz = vf[F32.POS_Z] - origin.z;
    const pDist = Math.hypot(pDx, pDy, pDz);
    if (pDist > 1e-5 && pDist < radius) {
      const mag = maxDamage * Math.max(0, 1 - pDist / radius) * kPush;
      const pMass = Math.max(1, this.sourceConfig.playerMass);
      const dv = mag / pMass;
      vf[F32.VEL_X] = f32(vf[F32.VEL_X] + dv * (pDx / pDist));
      vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] + dv * (pDy / pDist));
      vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] + dv * (pDz / pDist));
      this.abi.i32[I32.FLAGS] &= ~FL_ONGROUND;
    }

    // Rigid-body linear + slight eccentric tumble impulses
    for (let i = 0; i < this.rigidBodies.length; i++) {
      const b = this.rigidBodies[i];
      if (b.mass <= 0) continue;
      const dx = b.pos.x - origin.x;
      const dy = b.pos.y - origin.y;
      const dz = b.pos.z - origin.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 1e-5 && dist < radius) {
        const mag = maxDamage * Math.max(0, 1 - dist / radius) * kPush;
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        const dv = mag / b.mass;

        b.vel.x = f32(b.vel.x + dv * nx);
        b.vel.y = f32(b.vel.y + dv * ny);
        b.vel.z = f32(b.vel.z + dv * nz);

        // Apply slight off-center torque from blast shockwave hitting lower edge
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
    this.callbacks.onTeleport?.(isFail);
  }

  /** Source AngleVectors: pitch theta (+down), yaw psi, roll phi -> forward & right */
  private angleVectors(pitch: number, yaw: number, roll = 0): { forward: Vec3; right: Vec3 } {
    const sp = Math.sin(pitch);
    const cp = Math.cos(pitch);
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
    };
  }

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

    const wasOnGround = (vi[I32.FLAGS] & FL_ONGROUND) !== 0;
    const preVelZ = vf[F32.VEL_Z];
    const gravity = vf[F32.CVAR_GRAVITY];

    // 1. Update duck state & hull
    this.duck();

    // 2. Categorize ground/air position
    this.categorizePosition();

    // 3. Jump check: v_z = sqrt(2 * g * h_jump)
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

    // 4. First half of gravity step (while airborne)
    const isGroundedNow = (vi[I32.FLAGS] & FL_ONGROUND) !== 0;
    if (!isGroundedNow) {
      this.applyHalfGravity(gravity, 1.0);
    }

    // Apply Source basevelocity before movement sweep
    if (this.baseVelX !== 0 || this.baseVelY !== 0 || this.baseVelZ !== 0) {
      vf[F32.VEL_X] = f32(vf[F32.VEL_X] + this.baseVelX);
      vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] + this.baseVelY);
      vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] + this.baseVelZ);
    }

    // 5. AngleVectors -> horizontal wish velocity w & normalized wish direction w_hat
    const { forward, right } = this.angleVectors(vf[F32.CMD_PITCH], vf[F32.CMD_YAW], 0);
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

    // Strip transient basevelocity after movement step
    if (this.baseVelX !== 0 || this.baseVelY !== 0 || this.baseVelZ !== 0) {
      vf[F32.VEL_X] = f32(vf[F32.VEL_X] - this.baseVelX);
      vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] - this.baseVelY);
      vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] - this.baseVelZ);
      this.baseVelX = f32(0);
      this.baseVelY = f32(0);
      this.baseVelZ = f32(0);
    }

    // 7. Second half of gravity step
    this.categorizePosition();
    const landedNow = (vi[I32.FLAGS] & FL_ONGROUND) !== 0;
    if (!landedNow) {
      this.applyHalfGravity(gravity, 1.0);
    } else {
      vf[F32.VEL_Z] = f32(0);
      if (!wasOnGround && preVelZ < -140) {
        this.callbacks.onLand?.(Math.abs(preVelZ));
      }
    }

    // 8. VPhysics rigid bodies: world traces, prop-prop stacking & player-prop impulses
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

    // 10. Check triggers (start, end, push, explosion, teleport)
    this.checkTriggers();

    vi[I32.PREV_BUTTONS] = buttons;
  }

  /** Step VPhysics rigid bodies with semi-implicit Euler integration & world trace */
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

      // Semi-implicit Euler linear velocity
      b.vel.x = f32(b.vel.x * linKeep);
      b.vel.y = f32(b.vel.y * linKeep);
      b.vel.z = f32(b.vel.z * linKeep - gravity * b.gravityScale * FIXED_DT);

      const targetX = f32(b.pos.x + b.vel.x * FIXED_DT);
      const targetY = f32(b.pos.y + b.vel.y * FIXED_DT);
      const targetZ = f32(b.pos.z + b.vel.z * FIXED_DT);

      // Semi-implicit Euler angular velocity & quaternion integration
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
          b.vel.x = f32(b.vel.x - n.x * vn * bounce);
          b.vel.y = f32(b.vel.y - n.y * vn * bounce);
          b.vel.z = f32(b.vel.z - n.z * vn * bounce);

          const mu = b.surfaceFriction ?? this.sourceConfig.surfaceFriction;
          const damp = f32(Math.max(0, 1.0 - 0.14 * mu));
          b.vel.x = f32(b.vel.x * damp);
          b.vel.y = f32(b.vel.y * damp);
          b.angVel.x = f32(b.angVel.x * 0.86);
          b.angVel.y = f32(b.angVel.y * 0.86);
          b.angVel.z = f32(b.angVel.z * 0.86);

          if (n.z >= SURF_NORMAL_Z && Math.abs(b.vel.z) < 16) {
            b.vel.z = f32(0);
          }
        }
      }
    }
  }

  /** Resolve rigid-body vs rigid-body stacking & collision impulses with full 2-body inertia */
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

        // Normal n points from A to B
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

        // Overlap volume center as contact point p
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

  /** Resolve AABB overlap and impulse transfer between player hull (A) and rigid body (B) */
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
      if (b.mass <= 0) continue;

      // Vector from Player (A) to Body (B)
      const dx = b.pos.x - pPos.x;
      const dy = b.pos.y - pPos.y;
      const dz = b.pos.z - pPos.z;

      const overlapX = phx + b.hx - Math.abs(dx);
      const overlapY = phy + b.hy - Math.abs(dy);
      const overlapZ = phz + b.hz - Math.abs(dz);

      if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue;

      // Normal n points from A (player) to B (body)
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

      // Positional separation: A moves along -n, B moves along +n
      pPos.x = f32(pPos.x - n.x * pen * pShare);
      pPos.y = f32(pPos.y - n.y * pen * pShare);
      pPos.z = f32(pPos.z - n.z * pen * pShare);

      b.pos.x = f32(b.pos.x + n.x * pen * bShare);
      b.pos.y = f32(b.pos.y + n.y * pen * bShare);
      b.pos.z = f32(b.pos.z + n.z * pen * bShare);

      // Overlap box center as contact point p
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

      // v_rel = (v_B + omega_B x r_B) - v_A
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

      // Player A: v_A' = v_A - (j / m_A) * n
      pVel.x = f32(pVel.x - jn.x * pInvMass);
      pVel.y = f32(pVel.y - jn.y * pInvMass);
      pVel.z = f32(pVel.z - jn.z * pInvMass);

      // Rigid body B: v_B' = v_B + (j / m_B) * n, omega_B' = omega_B + I_B^-1 * (r_B x j*n)
      b.vel.x = f32(b.vel.x + jn.x * bInvMass);
      b.vel.y = f32(b.vel.y + jn.y * bInvMass);
      b.vel.z = f32(b.vel.z + jn.z * bInvMass);

      const dOmegaB = mulMat3Vec3(invIB, crossVec3(rB, jn));
      b.angVel.x = f32(b.angVel.x + dOmegaB.x);
      b.angVel.y = f32(b.angVel.y + dOmegaB.y);
      b.angVel.z = f32(b.angVel.z + dOmegaB.z);

      this.callbacks.onRigidBodyHit?.(b.id, Math.abs(j));
    }

    vf[F32.POS_X] = pPos.x;
    vf[F32.POS_Y] = pPos.y;
    vf[F32.POS_Z] = pPos.z;
    vf[F32.VEL_X] = pVel.x;
    vf[F32.VEL_Y] = pVel.y;
    vf[F32.VEL_Z] = pVel.z;
  }

  /**
   * Minkowski plane expansion:
   *   offset = |nx|*hx + |ny|*hy + |nz|*hz
   *   d_shifted = d + offset
   */
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

  /** Trace swept AABB against all world convex brushes */
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

  /** CheckVelocity: clamp each component and total speed to maxvelocity */
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

  /** AirAccelerate: v_cap = min(v_wish, 30), v_add = v_cap - (v . w_hat), v_accel = min(a_air * dt * v_wish * mu, v_add) */
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

  /** Accelerate: v_add = v_wish - (v . w_hat), v_accel = min(a * dt * v_wish * mu, v_add) */
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

  /** Friction with sv_stopspeed, sv_friction, mu_surface, and leading-edge drop-off */
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

  /** Multi-plane iterative sliding (up to 4 bumps) with crease cross-product resolution */
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

  /** CategorizePosition: walkable when n_z >= 0.7; surf ramp when 0.05 < n_z < 0.7 */
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

  /** Duck / Uncrouch with standing headroom check & mid-air crouch-jump */
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

  /** StepMove / WalkMove: compares Path A (slide) vs Path B (step up by STEPSIZE, move, drop down) */
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

  /** AirMove: runs airAccelerate + flyMove */
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

  /** Evaluate AABB trigger volumes against current player hull */
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
      } else if (t.type === 'end') {
        this.callbacks.onFinishRun?.();
      } else if (t.type === 'teleport') {
        this.teleportToSpawn(true);
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
        const lastTick = this.triggerCooldowns.get(t.id) ?? -999;
        if (tick - lastTick >= 22) {
          this.triggerCooldowns.set(t.id, tick);
          const dirX = t.meta.dirX ?? 1;
          const dirY = t.meta.dirY ?? 0;
          const dirZ = t.meta.dirZ ?? 0.5;
          const addSpeed = t.meta.addSpeed ?? 500;
          const minSpeedXY = t.meta.minSpeedXY ?? 1500;
          const minVelZ = t.meta.minVelZ ?? 600;

          this.baseVelX = f32(this.baseVelX + dirX * addSpeed);
          this.baseVelY = f32(this.baseVelY + dirY * addSpeed);

          const projectedXY = Math.hypot(vf[F32.VEL_X] + this.baseVelX, vf[F32.VEL_Y] + this.baseVelY);
          if (projectedXY < minSpeedXY) {
            const dirLen = Math.hypot(dirX, dirY) || 1;
            const targetX = f32((dirX / dirLen) * minSpeedXY);
            const targetY = f32((dirY / dirLen) * minSpeedXY);
            this.baseVelX = f32(targetX - vf[F32.VEL_X]);
            this.baseVelY = f32(targetY - vf[F32.VEL_Y]);
          }

          const nextZ = Math.max(vf[F32.VEL_Z] + this.baseVelZ + dirZ * addSpeed, minVelZ);
          this.baseVelZ = f32(nextZ - vf[F32.VEL_Z]);

          vi[I32.FLAGS] &= ~FL_ONGROUND;
          this.callbacks.onBoost?.(t.id);
        }
      }
    }
  }
}

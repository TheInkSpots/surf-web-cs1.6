the Engine is updated, now it supports subsystems; make a new map to test them; and update the related UI HUD;

1. pickup object, tactile props
2. ragdolls
2. vehicles
3. Ladder


Source engine supported subsystems:

| Source Subsystem | Legacy Source Approach | Optimized Hybrid / Rapier Implementation | Key Gain |
| --- | --- | --- | --- |
| **Player Shadow** (`IPhysicsPlayerController`) | Kinematic Havok hull + capped linear push force | Velocity-driven shadow body coupled via clamped **Velocity-Level PID**; one-way authority on surf ramps | Props react realistically without corrupting player air-strafe or surf velocity |
| **Gravity Gun** (`CWeaponPhysCannon`) | Raw force-level PD spring $\mathbf{F}_{\text{hold}}$ | Rapier **`PidController`** driving $\mathbf{v}_{\text{cmd}}$ and quaternion log-error $\mathbf{e}_q = \log(\mathbf{q}_{\text{target}} \otimes \mathbf{q}^{-1})$ | Mass-independent stability with zero spring overshoot |
| **Ragdolls & Joints** (`phys_constraintsystem`) | Maximal-coordinate PGS + Baumgarte | **Featherstone ABA** (`MultibodyJointSet`) for skeletons; impulse constraints with $\Vert{}\lambda\Vert{} \gt \lambda_{\max}$ break checks | Zero limb separation during explosions in $O(n)$ time |
| **Ropes & Cables** (`CRopeKeyframe`) | Separate Verlet particle chain | Keep lightweight **Verlet / XPBD** distance relaxation outside the main solver; pin endpoints to rigid bodies | Low CPU cost without polluting TGS contact islands |
| **Vehicles** (`CFourWheelVehiclePhysics`) | Custom raycast suspension + slip tables | Rapier **`DynamicRayCastVehicleController`** with Hookean spring-damper rays and surface-keyed slip curves | Native QBVH raycasts and stable chassis-to-world contact |
| **Buoyancy** (`CPhysicsFluidController`) | AABB submersion fraction $f_{\text{sub}}$ + upward impulse | Keep AABB/multi-sample $f_{\text{sub}}$, but apply upward force at the submerged centroid rather than body center of mass | Generates self-righting torque so floating props do not tumble endlessly |

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


//GoldSrcPhysicsEngine.ts
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
export type RigidBodyKind = 'prop' | 'weapon' | 'target' | 'vehicle';
export type JointKind = 'ball' | 'distance' | 'hinge' | 'fixed';

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

/** Compact deterministic snapshot for client-side prediction / server lag compensation */
export interface PlayerSnapshot {
  tick: number;
  posX: number;
  posY: number;
  posZ: number;
  velX: number;
  velY: number;
  velZ: number;
  baseVelX: number;
  baseVelY: number;
  baseVelZ: number;
  yaw: number;
  prevYaw: number;
  pitch: number;
  viewOfsZ: number;
  flags: number;
  moveState: number;
  prevButtons: number;
  surfNz: number;
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
  /** Rapier-style TGS Soft / NGS solver tuning */
  tgsSubsteps?: number;
  tgsIterations?: number;
  ngsIterations?: number;
  contactFrequencyHz?: number;
  contactDampingRatio?: number;
  sleepLinearThreshold?: number;
  sleepAngularThreshold?: number;
  sleepTimeThreshold?: number;
  /** Player-to-VPhysics shadow controller force cap (Hammer units * mass / s) */
  playerMaxPushForce?: number;
  /** Enable midpoint yaw evaluation for smoother fixed-tick air-strafing */
  subTickYaw?: boolean;
  /** Enable ramp-seam dead-stop recovery on steep surf ramps */
  enableRampSeamFix?: boolean;
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
  /** Solver & buoyancy extensions */
  sleeping?: boolean;
  sleepTimer?: number;
  buoyancyRatio?: number;
  linearDrag?: number;
  angularDrag?: number;
  enableCcd?: boolean;
}

export interface SourceJoint {
  id: string;
  kind: JointKind;
  bodyAId: string;
  /** Null or omitted pins the joint to a static world anchor */
  bodyBId?: string | null;
  /** Anchor in body A local coordinates */
  localAnchorA: Vec3;
  /** Anchor in body B local coordinates (or world coordinates when bodyBId is null) */
  localAnchorB: Vec3;
  /** Local hinge axis (unit vector) used by 'hinge' joints */
  localAxisA?: Vec3;
  localAxisB?: Vec3;
  /** Rest length for 'distance' joints */
  restLength?: number;
  /** Harmonic soft compliance frequency (Hz) and damping ratio */
  frequencyHz?: number;
  dampingRatio?: number;
  /** Joint severs if accumulated impulse exceeds breakForce (<= 0 = unbreakable) */
  breakForce?: number;
  broken?: boolean;
  /** Warm-start cached constraint impulse */
  lambdaX?: number;
  lambdaY?: number;
  lambdaZ?: number;
}

export interface RopePin {
  /** Static world anchor if bodyId is omitted */
  bodyId?: string | null;
  anchor: Vec3;
}

export interface SourceRope {
  id: string;
  nodes: Vec3[];
  prevNodes: Vec3[];
  segmentLength: number;
  damping: number;
  gravityScale: number;
  iterations: number;
  startPin?: RopePin;
  endPin?: RopePin;
  collideWorld?: boolean;
}

export interface WaterVolume {
  id: string;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  surfaceZ: number;
  density?: number;
  linearDrag?: number;
  angularDrag?: number;
  currentVel?: Vec3;
}

export interface WheelConfig {
  /** Wheel hardpoint in chassis local space */
  localHardpoint: Vec3;
  restLength: number;
  radius: number;
  stiffness: number;
  damping: number;
  grip: number;
  steerable: boolean;
  driven: boolean;
  /** Runtime state populated each tick */
  compression: number;
  prevCompression: number;
  inContact: boolean;
  contactPoint: Vec3;
  contactNormal: Vec3;
  spinAngle: number;
}

export interface SourceVehicle {
  id: string;
  chassisId: string;
  wheels: WheelConfig[];
  maxSteerRad: number;
  engineForce: number;
  brakeForce: number;
  /** Runtime inputs: throttle [-1, 1], steer [-1, 1], handbrake [0, 1] */
  throttle: number;
  steer: number;
  handbrake: number;
}

export interface GravityGunState {
  heldBodyId: string | null;
  holdDistance: number;
  targetOffsetQuat: Quat;
  integralErr: Vec3;
  prevErr: Vec3;
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
  onJointBroken?: (jointId: string, pos: Vec3) => void;
  onGravityGunGrab?: (bodyId: string) => void;
  onGravityGunRelease?: (bodyId: string, punted: boolean) => void;
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

interface ContactManifold {
  key: string;
  idxA: number;
  idxB: number;
  nx: number;
  ny: number;
  nz: number;
  t1x: number;
  t1y: number;
  t1z: number;
  t2x: number;
  t2y: number;
  t2z: number;
  cx: number;
  cy: number;
  cz: number;
  penetration: number;
  restitution: number;
  friction: number;
  patchRadius: number;
  lambdaN: number;
  lambdaT1: number;
  lambdaT2: number;
  lambdaTwist: number;
  relVelNInitial: number;
}

interface CachedImpulse {
  lambdaN: number;
  lambdaT1: number;
  lambdaT2: number;
  lambdaTwist: number;
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
    buoyancyRatio?: number;
    enableCcd?: boolean;
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
    sleeping: false,
    sleepTimer: 0,
    buoyancyRatio: opts.buoyancyRatio ?? 1.25,
    enableCcd: opts.enableCcd ?? true,
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
      buoyancyRatio: 0.45,
      enableCcd: true,
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
      buoyancyRatio: 1.05,
    },
  );
}

/** Create a Verlet cable/rope chain between two world points */
export function createVerletRope(
  id: string,
  start: Vec3,
  end: Vec3,
  segments = 10,
  opts: {
    damping?: number;
    gravityScale?: number;
    iterations?: number;
    startPin?: RopePin;
    endPin?: RopePin;
    collideWorld?: boolean;
  } = {},
): SourceRope {
  const count = Math.max(2, segments + 1);
  const nodes: Vec3[] = new Array(count);
  const prevNodes: Vec3[] = new Array(count);
  const totalDist = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const segLen = f32(Math.max(1, totalDist / (count - 1)));

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = f32(start.x + (end.x - start.x) * t);
    const y = f32(start.y + (end.y - start.y) * t);
    const z = f32(start.z + (end.z - start.z) * t);
    nodes[i] = { x, y, z };
    prevNodes[i] = { x, y, z };
  }

  return {
    id,
    nodes,
    prevNodes,
    segmentLength: segLen,
    damping: f32(opts.damping ?? 0.025),
    gravityScale: f32(opts.gravityScale ?? 1.0),
    iterations: opts.iterations ?? 6,
    startPin: opts.startPin ?? { anchor: { ...start } },
    endPin: opts.endPin,
    collideWorld: opts.collideWorld ?? true,
  };
}

/** Create a standard 4-wheel Source-style raycast vehicle bound to a chassis rigid body */
export function createFourWheelVehicle(
  id: string,
  chassisId: string,
  opts: {
    halfTrackY?: number;
    frontAxleX?: number;
    rearAxleX?: number;
    hubZ?: number;
    restLength?: number;
    wheelRadius?: number;
    stiffness?: number;
    damping?: number;
    grip?: number;
    maxSteerRad?: number;
    engineForce?: number;
    brakeForce?: number;
  } = {},
): SourceVehicle {
  const hy = opts.halfTrackY ?? 34;
  const fx = opts.frontAxleX ?? 56;
  const rx = opts.rearAxleX ?? -54;
  const hz = opts.hubZ ?? -12;
  const restLength = opts.restLength ?? 28;
  const radius = opts.wheelRadius ?? 16;
  const stiffness = opts.stiffness ?? 4200;
  const damping = opts.damping ?? 380;
  const grip = opts.grip ?? 1.35;

  const makeWheel = (x: number, y: number, steerable: boolean, driven: boolean): WheelConfig => ({
    localHardpoint: { x: f32(x), y: f32(y), z: f32(hz) },
    restLength: f32(restLength),
    radius: f32(radius),
    stiffness: f32(stiffness),
    damping: f32(damping),
    grip: f32(grip),
    steerable,
    driven,
    compression: 0,
    prevCompression: 0,
    inContact: false,
    contactPoint: { x: 0, y: 0, z: 0 },
    contactNormal: { x: 0, y: 0, z: 1 },
    spinAngle: 0,
  });

  return {
    id,
    chassisId,
    wheels: [
      makeWheel(fx, hy, true, true),
      makeWheel(fx, -hy, true, true),
      makeWheel(rx, hy, false, true),
      makeWheel(rx, -hy, false, true),
    ],
    maxSteerRad: f32(opts.maxSteerRad ?? 0.52),
    engineForce: f32(opts.engineForce ?? 220000),
    brakeForce: f32(opts.brakeForce ?? 260000),
    throttle: 0,
    steer: 0,
    handbrake: 0,
  };
}

function normalizeQuat(q: Quat): Quat {
  const len = Math.hypot(q.w, q.x, q.y, q.z);
  if (len < 1e-8) return { w: 1, x: 0, y: 0, z: 0 };
  const inv = 1 / len;
  return {
    w: f32(q.w * inv),
    x: f32(q.x * inv),
    y: f32(q.y * inv),
    z: f32(q.z * inv),
  };
}

function mulQuat(a: Quat, b: Quat): Quat {
  return {
    w: f32(a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z),
    x: f32(a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y),
    y: f32(a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x),
    z: f32(a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w),
  };
}

function conjQuat(q: Quat): Quat {
  return { w: q.w, x: f32(-q.x), y: f32(-q.y), z: f32(-q.z) };
}

/** Shortest-arc axis-angle orientation error e_q = log(qTarget * qCurrent^-1) */
function computeQuatLogError(qTarget: Quat, qCurrent: Quat): Vec3 {
  let err = mulQuat(qTarget, conjQuat(qCurrent));
  if (err.w < 0) {
    err = { w: f32(-err.w), x: f32(-err.x), y: f32(-err.y), z: f32(-err.z) };
  }
  const vLen = Math.hypot(err.x, err.y, err.z);
  if (vLen < 1e-6) return { x: 0, y: 0, z: 0 };
  const angle = 2 * Math.atan2(vLen, Math.min(1, Math.max(-1, err.w)));
  const scale = angle / vLen;
  return {
    x: f32(err.x * scale),
    y: f32(err.y * scale),
    z: f32(err.z * scale),
  };
}

function quatFromYawPitch(yaw: number, pitch: number): Quat {
  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  return normalizeQuat({
    w: f32(cy * cp),
    x: f32(-sy * sp),
    y: f32(cy * sp),
    z: f32(sy * cp),
  });
}

function wrapAngleRad(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
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

/**
 * Exact world-space inertia I = R * diag(I_local) * R^T and its inverse
 * I^-1 = R * diag(I_local^-1) * R^T (avoids cofactor inversion drift).
 */
function computeWorldInertia(rot: Mat3, inertiaLocal: Vec3): { inertia: Mat3; invInertia: Mat3 } {
  const ix = inertiaLocal.x;
  const iy = inertiaLocal.y;
  const iz = inertiaLocal.z;

  const invIx = ix > 1e-8 ? 1 / ix : 0;
  const invIy = iy > 1e-8 ? 1 / iy : 0;
  const invIz = iz > 1e-8 ? 1 / iz : 0;

  const r0 = rot[0], r1 = rot[1], r2 = rot[2];
  const r3 = rot[3], r4 = rot[4], r5 = rot[5];
  const r6 = rot[6], r7 = rot[7], r8 = rot[8];

  const inertia: Mat3 = [
    f32(r0 * r0 * ix + r1 * r1 * iy + r2 * r2 * iz),
    f32(r0 * r3 * ix + r1 * r4 * iy + r2 * r5 * iz),
    f32(r0 * r6 * ix + r1 * r7 * iy + r2 * r8 * iz),
    f32(r3 * r0 * ix + r4 * r1 * iy + r5 * r2 * iz),
    f32(r3 * r3 * ix + r4 * r4 * iy + r5 * r5 * iz),
    f32(r3 * r6 * ix + r4 * r7 * iy + r5 * r8 * iz),
    f32(r6 * r0 * ix + r7 * r1 * iy + r8 * r2 * iz),
    f32(r6 * r3 * ix + r7 * r4 * iy + r8 * r5 * iz),
    f32(r6 * r6 * ix + r7 * r7 * iy + r8 * r8 * iz),
  ];

  const invInertia: Mat3 = [
    f32(r0 * r0 * invIx + r1 * r1 * invIy + r2 * r2 * invIz),
    f32(r0 * r3 * invIx + r1 * r4 * invIy + r2 * r5 * invIz),
    f32(r0 * r6 * invIx + r1 * r7 * invIy + r2 * r8 * invIz),
    f32(r3 * r0 * invIx + r4 * r1 * invIy + r5 * r2 * invIz),
    f32(r3 * r3 * invIx + r4 * r4 * invIy + r5 * r5 * invIz),
    f32(r3 * r6 * invIx + r4 * r7 * invIy + r5 * r8 * invIz),
    f32(r6 * r0 * invIx + r7 * r1 * invIy + r8 * r2 * invIz),
    f32(r6 * r3 * invIx + r7 * r4 * invIy + r8 * r5 * invIz),
    f32(r6 * r6 * invIx + r7 * r7 * invIy + r8 * r8 * invIz),
  ];

  return { inertia, invInertia };
}

/** Build two orthonormal tangent vectors spanning the contact plane perpendicular to n */
function buildContactBasis(nx: number, ny: number, nz: number): {
  t1x: number; t1y: number; t1z: number;
  t2x: number; t2y: number; t2z: number;
} {
  let t1x: number;
  let t1y: number;
  let t1z: number;
  if (Math.abs(nx) < 0.57735) {
    const inv = 1 / Math.hypot(nz, -ny);
    t1x = 0;
    t1y = f32(-nz * inv);
    t1z = f32(ny * inv);
  } else {
    const inv = 1 / Math.hypot(-ny, nx);
    t1x = f32(-ny * inv);
    t1y = f32(nx * inv);
    t1z = 0;
  }
  const t2x = f32(ny * t1z - nz * t1y);
  const t2y = f32(nz * t1x - nx * t1z);
  const t2z = f32(nx * t1y - ny * t1x);
  return { t1x, t1y, t1z, t2x, t2y, t2z };
}

/**
 * Flat TypedArray BVH over static ConvexBrushes for O(log N) broad-phase sweeps
 * with zero per-query heap allocations.
 */
class StaticBrushBvh {
  private readonly brushes: ConvexBrush[];
  private order: Int32Array;
  private minX: Float32Array;
  private minY: Float32Array;
  private minZ: Float32Array;
  private maxX: Float32Array;
  private maxY: Float32Array;
  private maxZ: Float32Array;
  private leftOrStart: Int32Array;
  private rightChild: Int32Array;
  private leafCount: Int32Array;
  private nodeCount = 0;
  private readonly stack = new Int32Array(64);

  constructor(brushes: ConvexBrush[]) {
    this.brushes = brushes;
    const n = brushes.length;
    const maxNodes = Math.max(1, n * 2);
    this.order = new Int32Array(n);
    this.minX = new Float32Array(maxNodes);
    this.minY = new Float32Array(maxNodes);
    this.minZ = new Float32Array(maxNodes);
    this.maxX = new Float32Array(maxNodes);
    this.maxY = new Float32Array(maxNodes);
    this.maxZ = new Float32Array(maxNodes);
    this.leftOrStart = new Int32Array(maxNodes);
    this.rightChild = new Int32Array(maxNodes);
    this.leafCount = new Int32Array(maxNodes);

    this.rebuild();
  }

  public rebuild(): void {
    const n = this.brushes.length;
    if (this.order.length !== n) {
      const maxNodes = Math.max(1, n * 2);
      this.order = new Int32Array(n);
      this.minX = new Float32Array(maxNodes);
      this.minY = new Float32Array(maxNodes);
      this.minZ = new Float32Array(maxNodes);
      this.maxX = new Float32Array(maxNodes);
      this.maxY = new Float32Array(maxNodes);
      this.maxZ = new Float32Array(maxNodes);
      this.leftOrStart = new Int32Array(maxNodes);
      this.rightChild = new Int32Array(maxNodes);
      this.leafCount = new Int32Array(maxNodes);
    }

    for (let i = 0; i < n; i++) this.order[i] = i;
    this.nodeCount = 0;
    if (n > 0) {
      this.buildNode(0, n);
    }
  }

  private buildNode(start: number, count: number): number {
    const nodeIdx = this.nodeCount++;
    let bMinX = Infinity, bMinY = Infinity, bMinZ = Infinity;
    let bMaxX = -Infinity, bMaxY = -Infinity, bMaxZ = -Infinity;
    let cMinX = Infinity, cMinY = Infinity, cMinZ = Infinity;
    let cMaxX = -Infinity, cMaxY = -Infinity, cMaxZ = -Infinity;

    for (let i = start; i < start + count; i++) {
      const br = this.brushes[this.order[i]];
      if (br.minX < bMinX) bMinX = br.minX;
      if (br.minY < bMinY) bMinY = br.minY;
      if (br.minZ < bMinZ) bMinZ = br.minZ;
      if (br.maxX > bMaxX) bMaxX = br.maxX;
      if (br.maxY > bMaxY) bMaxY = br.maxY;
      if (br.maxZ > bMaxZ) bMaxZ = br.maxZ;

      const cx = (br.minX + br.maxX) * 0.5;
      const cy = (br.minY + br.maxY) * 0.5;
      const cz = (br.minZ + br.maxZ) * 0.5;
      if (cx < cMinX) cMinX = cx;
      if (cy < cMinY) cMinY = cy;
      if (cz < cMinZ) cMinZ = cz;
      if (cx > cMaxX) cMaxX = cx;
      if (cy > cMaxY) cMaxY = cy;
      if (cz > cMaxZ) cMaxZ = cz;
    }

    this.minX[nodeIdx] = bMinX;
    this.minY[nodeIdx] = bMinY;
    this.minZ[nodeIdx] = bMinZ;
    this.maxX[nodeIdx] = bMaxX;
    this.maxY[nodeIdx] = bMaxY;
    this.maxZ[nodeIdx] = bMaxZ;

    if (count <= 4) {
      this.leftOrStart[nodeIdx] = start;
      this.rightChild[nodeIdx] = -1;
      this.leafCount[nodeIdx] = count;
      return nodeIdx;
    }

    const ex = cMaxX - cMinX;
    const ey = cMaxY - cMinY;
    const ez = cMaxZ - cMinZ;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const splitVal =
      axis === 0 ? (cMinX + cMaxX) * 0.5 : axis === 1 ? (cMinY + cMaxY) * 0.5 : (cMinZ + cMaxZ) * 0.5;

    let mid = start;
    const end = start + count;
    for (let i = start; i < end; i++) {
      const br = this.brushes[this.order[i]];
      const c =
        axis === 0
          ? (br.minX + br.maxX) * 0.5
          : axis === 1
            ? (br.minY + br.maxY) * 0.5
            : (br.minZ + br.maxZ) * 0.5;
      if (c < splitVal) {
        const tmp = this.order[i];
        this.order[i] = this.order[mid];
        this.order[mid] = tmp;
        mid++;
      }
    }

    let leftCount = mid - start;
    if (leftCount === 0 || leftCount === count) {
      leftCount = count >> 1;
    }

    this.leafCount[nodeIdx] = 0;
    this.leftOrStart[nodeIdx] = this.buildNode(start, leftCount);
    this.rightChild[nodeIdx] = this.buildNode(start + leftCount, count - leftCount);
    return nodeIdx;
  }

  /** Collect overlapping brush indices into outBuf without allocating */
  public queryAabb(
    qMinX: number,
    qMinY: number,
    qMinZ: number,
    qMaxX: number,
    qMaxY: number,
    qMaxZ: number,
    outBuf: Int32Array,
  ): number {
    if (this.nodeCount === 0) return 0;

    let sp = 0;
    let hitCount = 0;
    const maxOut = outBuf.length;
    this.stack[sp++] = 0;

    while (sp > 0) {
      const idx = this.stack[--sp];
      if (
        qMaxX < this.minX[idx] ||
        qMinX > this.maxX[idx] ||
        qMaxY < this.minY[idx] ||
        qMinY > this.maxY[idx] ||
        qMaxZ < this.minZ[idx] ||
        qMinZ > this.maxZ[idx]
      ) {
        continue;
      }

      const lc = this.leafCount[idx];
      if (lc > 0) {
        const start = this.leftOrStart[idx];
        const end = start + lc;
        for (let i = start; i < end; i++) {
          const brushIdx = this.order[i];
          const br = this.brushes[brushIdx];
          if (
            qMaxX < br.minX ||
            qMinX > br.maxX ||
            qMaxY < br.minY ||
            qMinY > br.maxY ||
            qMaxZ < br.minZ ||
            qMinZ > br.maxZ
          ) {
            continue;
          }
          if (hitCount < maxOut) {
            outBuf[hitCount++] = brushIdx;
          }
        }
      } else {
        if (sp + 2 <= this.stack.length) {
          this.stack[sp++] = this.rightChild[idx];
          this.stack[sp++] = this.leftOrStart[idx];
        }
      }
    }

    return hitCount;
  }
}

export class GoldSrcPhysicsEngine {
  private readonly abi: PhysicsMemoryAbi;
  private readonly brushes: ConvexBrush[];
  private readonly brushBvh: StaticBrushBvh;
  private readonly triggers: TriggerVolume[];
  private rigidBodies: SourceRigidBody[];
  private readonly joints: SourceJoint[] = [];
  private readonly ropes: SourceRope[] = [];
  private readonly waterVolumes: WaterVolume[] = [];
  private readonly vehicles: SourceVehicle[] = [];
  private readonly spawn: SpawnPoint;
  private readonly callbacks: PhysicsCallbacks;
  private readonly sourceConfig: Required<SourcePhysicsConfig>;

  private readonly triggerCooldowns = new Map<string, number>();
  private readonly contactCache = new Map<string, CachedImpulse>();
  private readonly activeManifolds: ContactManifold[] = [];

  private readonly clipOut = new Float32Array(3);
  private readonly planesX = new Float32Array(MAX_CLIP_PLANES);
  private readonly planesY = new Float32Array(MAX_CLIP_PLANES);
  private readonly planesZ = new Float32Array(MAX_CLIP_PLANES);
  private queryScratch: Int32Array;
  private stepQueryScratch: Int32Array;
  private stepCandidateCount = -1;

  // Source CGameMovement basevelocity (conveyors / moving platforms)
  private baseVelX = f32(0);
  private baseVelY = f32(0);
  private baseVelZ = f32(0);
  private prevCmdYaw = f32(0);
  private hasPrevYaw = false;
  private playerWaterSubmersion = f32(0);

  // Gravity Gun (Velocity-Level PID Controller)
  private readonly gravityGun: GravityGunState = {
    heldBodyId: null,
    holdDistance: 120,
    targetOffsetQuat: { w: 1, x: 0, y: 0, z: 0 },
    integralErr: { x: 0, y: 0, z: 0 },
    prevErr: { x: 0, y: 0, z: 0 },
  };

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

  private readonly bodyTraceScratch: TraceResult = {
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

  private readonly auxTraceScratch: TraceResult = {
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
    this.brushBvh = new StaticBrushBvh(brushes);
    this.triggers = triggers;
    this.rigidBodies = rigidBodies;
    this.spawn = spawn;
    this.callbacks = callbacks;

    const scratchCap = Math.max(64, brushes.length);
    this.queryScratch = new Int32Array(scratchCap);
    this.stepQueryScratch = new Int32Array(scratchCap);

    this.sourceConfig = {
      sourceMaxVelocity: sourceConfig.sourceMaxVelocity ?? 3500,
      svBounce: sourceConfig.svBounce ?? 0,
      playerMass: sourceConfig.playerMass ?? 85,
      surfaceFriction: sourceConfig.surfaceFriction ?? 1.0,
      linearDamping: sourceConfig.linearDamping ?? 0.04,
      angularDamping: sourceConfig.angularDamping ?? 0.08,
      physPushScale: sourceConfig.physPushScale ?? 1.0,
      fallDamageThreshold: sourceConfig.fallDamageThreshold ?? 580,
      fallDamageScale: sourceConfig.fallDamageScale ?? 0.16,
      tgsSubsteps: Math.max(1, sourceConfig.tgsSubsteps ?? 2),
      tgsIterations: Math.max(1, sourceConfig.tgsIterations ?? 4),
      ngsIterations: Math.max(0, sourceConfig.ngsIterations ?? 2),
      contactFrequencyHz: sourceConfig.contactFrequencyHz ?? 30,
      contactDampingRatio: sourceConfig.contactDampingRatio ?? 1.0,
      sleepLinearThreshold: sourceConfig.sleepLinearThreshold ?? 6.0,
      sleepAngularThreshold: sourceConfig.sleepAngularThreshold ?? 0.12,
      sleepTimeThreshold: sourceConfig.sleepTimeThreshold ?? 0.6,
      playerMaxPushForce: sourceConfig.playerMaxPushForce ?? 6500,
      subTickYaw: sourceConfig.subTickYaw ?? true,
      enableRampSeamFix: sourceConfig.enableRampSeamFix ?? true,
    };

    // Auto-register any trigger volumes tagged as water
    for (let i = 0; i < triggers.length; i++) {
      const t = triggers[i];
      if ((t.type as string) === 'water' || t.meta?.water === true) {
        this.waterVolumes.push({
          id: t.id,
          minX: t.minX,
          minY: t.minY,
          minZ: t.minZ,
          maxX: t.maxX,
          maxY: t.maxY,
          maxZ: t.maxZ,
          surfaceZ: (t.meta?.surfaceZ as number | undefined) ?? t.maxZ,
          density: (t.meta?.density as number | undefined) ?? 1.0,
          linearDrag: (t.meta?.linearDrag as number | undefined) ?? 2.2,
          angularDrag: (t.meta?.angularDrag as number | undefined) ?? 2.6,
        });
      }
    }
  }

  /** Rebuild static brush BVH if map brushes were mutated externally */
  public rebuildBroadPhase(): void {
    this.brushBvh.rebuild();
    if (this.queryScratch.length < this.brushes.length) {
      this.queryScratch = new Int32Array(this.brushes.length);
      this.stepQueryScratch = new Int32Array(this.brushes.length);
    }
  }

  // ---------------------------------------------------------------------------
  // Support System Management APIs (Joints, Ropes, Water, Vehicles, Gravity Gun)
  // ---------------------------------------------------------------------------

  public addJoint(joint: SourceJoint): void {
    this.joints.push(joint);
    this.wakeBodyById(joint.bodyAId);
    if (joint.bodyBId) this.wakeBodyById(joint.bodyBId);
  }

  public removeJoint(id: string): SourceJoint | null {
    const idx = this.joints.findIndex((j) => j.id === id);
    if (idx === -1) return null;
    const [removed] = this.joints.splice(idx, 1);
    return removed;
  }

  public getJoints(): readonly SourceJoint[] {
    return this.joints;
  }

  public addRope(rope: SourceRope): void {
    this.ropes.push(rope);
  }

  public removeRope(id: string): SourceRope | null {
    const idx = this.ropes.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const [removed] = this.ropes.splice(idx, 1);
    return removed;
  }

  public getRopes(): readonly SourceRope[] {
    return this.ropes;
  }

  public addWaterVolume(vol: WaterVolume): void {
    this.waterVolumes.push(vol);
  }

  public removeWaterVolume(id: string): WaterVolume | null {
    const idx = this.waterVolumes.findIndex((w) => w.id === id);
    if (idx === -1) return null;
    const [removed] = this.waterVolumes.splice(idx, 1);
    return removed;
  }

  public getWaterVolumes(): readonly WaterVolume[] {
    return this.waterVolumes;
  }

  public addVehicle(vehicle: SourceVehicle): void {
    this.vehicles.push(vehicle);
    this.wakeBodyById(vehicle.chassisId);
  }

  public removeVehicle(id: string): SourceVehicle | null {
    const idx = this.vehicles.findIndex((v) => v.id === id);
    if (idx === -1) return null;
    const [removed] = this.vehicles.splice(idx, 1);
    return removed;
  }

  public getVehicles(): readonly SourceVehicle[] {
    return this.vehicles;
  }

  public setVehicleControls(
    vehicleId: string,
    throttle: number,
    steer: number,
    handbrake = 0,
  ): void {
    const v = this.vehicles.find((veh) => veh.id === vehicleId);
    if (!v) return;
    v.throttle = f32(Math.max(-1, Math.min(1, throttle)));
    v.steer = f32(Math.max(-1, Math.min(1, steer)));
    v.handbrake = f32(Math.max(0, Math.min(1, handbrake)));
    if (Math.abs(throttle) > 0.01 || Math.abs(steer) > 0.01) {
      this.wakeBodyById(v.chassisId);
    }
  }

  public getGravityGunState(): Readonly<GravityGunState> {
    return this.gravityGun;
  }

  /** Grab a rigid body in view with the Velocity-Level PID Gravity Gun */
  public tryGrabRigidBody(
    origin: Vec3,
    dir: Vec3,
    maxRange = 360,
    maxMass = 260,
    holdDistance = 120,
  ): SourceRigidBody | null {
    const hit = this.traceRay(origin, dir, maxRange);
    if (!hit.hit || hit.kind !== 'rigidBody' || !hit.body) return null;
    if (hit.body.mass <= 0 || hit.body.mass > maxMass) return null;

    const vf = this.abi.f32;
    const viewQuat = quatFromYawPitch(vf[F32.CMD_YAW], -vf[F32.CMD_PITCH]);
    this.gravityGun.heldBodyId = hit.body.id;
    this.gravityGun.holdDistance = f32(Math.max(64, Math.min(maxRange * 0.75, holdDistance)));
    this.gravityGun.targetOffsetQuat = mulQuat(conjQuat(viewQuat), hit.body.quat);
    this.gravityGun.integralErr = { x: 0, y: 0, z: 0 };
    this.gravityGun.prevErr = { x: 0, y: 0, z: 0 };
    this.wakeBody(hit.body);
    this.callbacks.onGravityGunGrab?.(hit.body.id);
    return hit.body;
  }

  /** Drop or punt the currently held Gravity Gun rigid body */
  public releaseHeldBody(puntImpulse = 0, puntDir?: Vec3): SourceRigidBody | null {
    if (!this.gravityGun.heldBodyId) return null;
    const body = this.findBodyById(this.gravityGun.heldBodyId);
    const id = this.gravityGun.heldBodyId;
    this.gravityGun.heldBodyId = null;
    this.gravityGun.integralErr = { x: 0, y: 0, z: 0 };
    this.gravityGun.prevErr = { x: 0, y: 0, z: 0 };

    if (body && puntImpulse > 0) {
      const vf = this.abi.f32;
      const dir = puntDir ?? computeAngleVectors(-vf[F32.CMD_PITCH], vf[F32.CMD_YAW], 0).forward;
      this.applyPointImpulse(body, body.pos, dir, puntImpulse, 0);
      this.callbacks.onGravityGunRelease?.(id, true);
    } else {
      this.callbacks.onGravityGunRelease?.(id, false);
    }
    return body;
  }

  // ---------------------------------------------------------------------------
  // Deterministic Rollback Snapshot (Player Layer Only)
  // ---------------------------------------------------------------------------

  public capturePlayerSnapshot(): PlayerSnapshot {
    const { f32: vf, i32: vi } = this.abi;
    return {
      tick: vi[I32.TICK],
      posX: vf[F32.POS_X],
      posY: vf[F32.POS_Y],
      posZ: vf[F32.POS_Z],
      velX: vf[F32.VEL_X],
      velY: vf[F32.VEL_Y],
      velZ: vf[F32.VEL_Z],
      baseVelX: this.baseVelX,
      baseVelY: this.baseVelY,
      baseVelZ: this.baseVelZ,
      yaw: vf[F32.YAW],
      prevYaw: this.prevCmdYaw,
      pitch: vf[F32.PITCH],
      viewOfsZ: vf[F32.VIEW_OFS_Z],
      flags: vi[I32.FLAGS],
      moveState: vi[I32.MOVESTATE],
      prevButtons: vi[I32.PREV_BUTTONS],
      surfNz: vf[F32.SURF_NZ],
    };
  }

  public restorePlayerSnapshot(snap: PlayerSnapshot): void {
    const { f32: vf, i32: vi } = this.abi;
    vi[I32.TICK] = snap.tick;
    vf[F32.POS_X] = f32(snap.posX);
    vf[F32.POS_Y] = f32(snap.posY);
    vf[F32.POS_Z] = f32(snap.posZ);
    vf[F32.PREV_X] = f32(snap.posX);
    vf[F32.PREV_Y] = f32(snap.posY);
    vf[F32.PREV_Z] = f32(snap.posZ);
    vf[F32.VEL_X] = f32(snap.velX);
    vf[F32.VEL_Y] = f32(snap.velY);
    vf[F32.VEL_Z] = f32(snap.velZ);
    this.baseVelX = f32(snap.baseVelX);
    this.baseVelY = f32(snap.baseVelY);
    this.baseVelZ = f32(snap.baseVelZ);
    vf[F32.YAW] = f32(snap.yaw);
    this.prevCmdYaw = f32(snap.prevYaw);
    this.hasPrevYaw = true;
    vf[F32.PITCH] = f32(snap.pitch);
    vf[F32.VIEW_OFS_Z] = f32(snap.viewOfsZ);
    vf[F32.PREV_VIEW_OFS_Z] = f32(snap.viewOfsZ);
    vi[I32.FLAGS] = snap.flags;
    vi[I32.MOVESTATE] = snap.moveState;
    vi[I32.PREV_BUTTONS] = snap.prevButtons;
    vf[F32.SURF_NZ] = f32(snap.surfNz);
  }

  public setBaseVelocity(vx: number, vy: number, vz: number): void {
    this.baseVelX = f32(vx);
    this.baseVelY = f32(vy);
    this.baseVelZ = f32(vz);
  }

  // ---------------------------------------------------------------------------
  // Player Vitals & Rigid Body Collection APIs
  // ---------------------------------------------------------------------------

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
      if (this.gravityGun.heldBodyId) {
        this.releaseHeldBody(0);
      }
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
    if (this.gravityGun.heldBodyId === id) {
      this.gravityGun.heldBodyId = null;
    }
    const [removed] = this.rigidBodies.splice(idx, 1);
    return removed;
  }

  public setRigidBodies(bodies: SourceRigidBody[]): void {
    this.rigidBodies = bodies;
    this.contactCache.clear();
    if (this.gravityGun.heldBodyId && !this.findBodyById(this.gravityGun.heldBodyId)) {
      this.gravityGun.heldBodyId = null;
    }
  }

  private findBodyById(id: string): SourceRigidBody | null {
    for (let i = 0; i < this.rigidBodies.length; i++) {
      if (this.rigidBodies[i].id === id) return this.rigidBodies[i];
    }
    return null;
  }

  private wakeBody(body: SourceRigidBody): void {
    body.sleeping = false;
    body.sleepTimer = 0;
  }

  private wakeBodyById(id: string): void {
    const b = this.findBodyById(id);
    if (b) this.wakeBody(b);
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
   * Hitscan raycast against BOTH static BSP convex brushes (BVH-accelerated)
   * and oriented VPhysics rigid bodies (OBBs).
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

    const worldTr = this.auxTraceScratch;
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

    const rayDir: Vec3 = { x: nx, y: ny, z: nz };
    for (let i = 0; i < this.rigidBodies.length; i++) {
      const b = this.rigidBodies[i];
      if (ignoreBodyIds?.has(b.id)) continue;

      const rot = quatToMat3(b.quat);
      const localOrigin = mulMat3TransposeVec3(rot, {
        x: origin.x - b.pos.x,
        y: origin.y - b.pos.y,
        z: origin.z - b.pos.z,
      });
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
    let hitAxis: 0 | 1 | 2 = 2;
    let hitSign = 1;

    // X slab
    if (Math.abs(d.x) < 1e-7) {
      if (o.x < -hx || o.x > hx) return null;
    } else {
      const invD = 1 / d.x;
      let t1 = (-hx - o.x) * invD;
      let t2 = (hx - o.x) * invD;
      let sign = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        sign = 1;
      }
      if (t1 > tMin) {
        tMin = t1;
        hitAxis = 0;
        hitSign = sign;
      }
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return null;
    }

    // Y slab
    if (Math.abs(d.y) < 1e-7) {
      if (o.y < -hy || o.y > hy) return null;
    } else {
      const invD = 1 / d.y;
      let t1 = (-hy - o.y) * invD;
      let t2 = (hy - o.y) * invD;
      let sign = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        sign = 1;
      }
      if (t1 > tMin) {
        tMin = t1;
        hitAxis = 1;
        hitSign = sign;
      }
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return null;
    }

    // Z slab
    if (Math.abs(d.z) < 1e-7) {
      if (o.z < -hz || o.z > hz) return null;
    } else {
      const invD = 1 / d.z;
      let t1 = (-hz - o.z) * invD;
      let t2 = (hz - o.z) * invD;
      let sign = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        sign = 1;
      }
      if (t1 > tMin) {
        tMin = t1;
        hitAxis = 2;
        hitSign = sign;
      }
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return null;
    }

    if (tMin < 0 || tMin > maxDist) return null;
    const localNormal: Vec3 =
      hitAxis === 0
        ? { x: hitSign, y: 0, z: 0 }
        : hitAxis === 1
          ? { x: 0, y: hitSign, z: 0 }
          : { x: 0, y: 0, z: hitSign };
    return { t: tMin, localNormal };
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
      this.wakeBody(body);
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
    this.prevCmdYaw = f32(cp.yaw);
    this.hasPrevYaw = true;
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
        this.wakeBody(b);
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
            if (this.gravityGun.heldBodyId === b.id) {
              this.gravityGun.heldBodyId = null;
            }
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
    this.prevCmdYaw = f32(this.spawn.yaw);
    this.hasPrevYaw = true;
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

    // If dead, keep stepping VPhysics props/ropes/vehicles while player movement is frozen
    if (this.vitals.dead) {
      this.stepSecondaryPhysics(false);
      vi[I32.PREV_BUTTONS] = vi[I32.BUTTONS];
      return;
    }

    const wasOnGround = (vi[I32.FLAGS] & FL_ONGROUND) !== 0;
    const preVelZ = vf[F32.VEL_Z];
    const gravity = vf[F32.CVAR_GRAVITY];

    // 1. Duck / uncrouch hull update
    this.duck();

    // 2. Categorize ground/air & water submersion state
    this.categorizePosition();
    this.playerWaterSubmersion = this.computePlayerWaterSubmersion();
    const inWater = this.playerWaterSubmersion > 0.35;

    // 3. CheckJumpButton: v_z = sqrt(2 * g * h_jump), h_jump = 45u (CS:S / GoldSrc)
    const buttons = vi[I32.BUTTONS];
    const prevButtons = vi[I32.PREV_BUTTONS];
    const autoBhop = vi[I32.AUTOBHOP] === 1;
    const jumpPressed = (buttons & IN_JUMP) !== 0;
    const freshJump = jumpPressed && (autoBhop || (prevButtons & IN_JUMP) === 0);

    if (inWater && jumpPressed) {
      vi[I32.FLAGS] &= ~FL_ONGROUND;
      vf[F32.VEL_Z] = f32(Math.max(vf[F32.VEL_Z], 145.0));
    } else if (freshJump && (vi[I32.FLAGS] & FL_ONGROUND)) {
      vi[I32.FLAGS] &= ~FL_ONGROUND;
      vf[F32.VEL_Z] = f32(Math.sqrt(2.0 * gravity * 45.0));
      this.callbacks.onJump?.();
    }

    // 4. StartGravity (first half-step, attenuated in water)
    const isGroundedNow = (vi[I32.FLAGS] & FL_ONGROUND) !== 0;
    const gravScale = inWater ? f32(0.18) : f32(1.0);
    if (!isGroundedNow) {
      this.applyHalfGravity(gravity, gravScale);
    }

    if (this.baseVelX !== 0 || this.baseVelY !== 0 || this.baseVelZ !== 0) {
      vf[F32.VEL_X] = f32(vf[F32.VEL_X] + this.baseVelX);
      vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] + this.baseVelY);
      vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] + this.baseVelZ);
    }

    // 5. AngleVectors with optional midpoint sub-tick yaw -> wish velocity & unit wish direction
    const cmdYaw = vf[F32.CMD_YAW];
    const effYaw =
      this.sourceConfig.subTickYaw && this.hasPrevYaw
        ? f32(this.prevCmdYaw + wrapAngleRad(cmdYaw - this.prevCmdYaw) * 0.5)
        : cmdYaw;
    this.prevCmdYaw = cmdYaw;
    this.hasPrevYaw = true;

    const { forward, right } = computeAngleVectors(-vf[F32.CMD_PITCH], effYaw, 0);
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

    // 6. Ground vs Water vs Air/Surf movement branch
    let flyBlocked = 0;
    if (inWater) {
      flyBlocked = this.waterMove(forward, right, fmove, smove, maxSpeed);
    } else if (isGroundedNow) {
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
      this.applyHalfGravity(gravity, gravScale);
    } else {
      vf[F32.VEL_Z] = f32(0);
      if (!wasOnGround && !inWater && preVelZ < -140) {
        const impact = Math.abs(preVelZ);
        this.callbacks.onLand?.(impact);
        if (impact > this.sourceConfig.fallDamageThreshold) {
          const fallDmg =
            (impact - this.sourceConfig.fallDamageThreshold) * this.sourceConfig.fallDamageScale;
          this.damagePlayer(fallDmg, 'fall');
        }
      }
    }

    // 8. Determine telemetry state (GROUND / SURF / AIR) before player-shadow push check
    const isSurfing =
      !landedNow &&
      ((flyBlocked & 4) !== 0 || (vf[F32.SURF_NZ] > 0.05 && vf[F32.SURF_NZ] < SURF_NORMAL_Z));

    if (landedNow) {
      vi[I32.MOVESTATE] = MoveState.GROUND;
    } else if (isSurfing) {
      vi[I32.MOVESTATE] = MoveState.SURF;
    } else {
      vi[I32.MOVESTATE] = MoveState.AIR;
    }

    // 9. VPhysics (TGS Soft + NGS), Gravity Gun PID, Vehicles, Buoyancy, Joints, Ropes & Player Shadow
    this.stepSecondaryPhysics(true, isSurfing);

    this.checkVelocity();

    // 10. Trigger volumes
    this.checkTriggers();

    vi[I32.PREV_BUTTONS] = buttons;
  }

  // ---------------------------------------------------------------------------
  // Rapier-Style Rigid-Body Pipeline (TGS Soft + NGS + Support Subsystems)
  // ---------------------------------------------------------------------------

  private stepSecondaryPhysics(playerAlive: boolean, playerIsSurfing = false): void {
    const hasBodies = this.rigidBodies.length > 0;

    if (hasBodies) {
      if (playerAlive && this.gravityGun.heldBodyId) {
        this.stepGravityGunPid();
      }
      if (this.vehicles.length > 0) {
        this.stepVehicles();
      }
      if (this.waterVolumes.length > 0) {
        this.stepRigidBodyBuoyancy();
      }

      this.stepRigidBodiesTgsSoft();

      if (playerAlive) {
        this.resolvePlayerShadowCollisions(playerIsSurfing);
      }
    }

    if (this.ropes.length > 0) {
      this.stepRopes();
    }
  }

  /**
   * Substepped TGS Soft velocity solver + unbiased relaxation + NGS position projection,
   * implicit damping, Coulomb + torsional patch friction, selective CCD, and sleeping.
   */
  private stepRigidBodiesTgsSoft(): void {
    const count = this.rigidBodies.length;
    if (count === 0) return;

    const gravity = this.abi.f32[F32.CVAR_GRAVITY];
    const substeps = this.sourceConfig.tgsSubsteps;
    const subDt = f32(FIXED_DT / substeps);
    const tgsIters = this.sourceConfig.tgsIterations;
    const ngsIters = this.sourceConfig.ngsIterations;
    const omega = 2 * Math.PI * this.sourceConfig.contactFrequencyHz;
    const zeta = this.sourceConfig.contactDampingRatio;
    const linDampDenom = f32(1.0 + this.sourceConfig.linearDamping * subDt);
    const angDampDenom = f32(1.0 + this.sourceConfig.angularDamping * subDt);

    // 1. Collect rigid-body contact manifolds & fetch warm-start impulses
    this.collectContactManifolds();

    // 2. Run TGS Soft substeps
    for (let s = 0; s < substeps; s++) {
      // 2a. Forces, gyroscopic torque, and unconditionally stable implicit damping
      for (let i = 0; i < count; i++) {
        const b = this.rigidBodies[i];
        if (b.mass <= 0 || b.sleeping) continue;

        b.vel.x = f32(b.vel.x / linDampDenom);
        b.vel.y = f32(b.vel.y / linDampDenom);
        b.vel.z = f32((b.vel.z - gravity * b.gravityScale * subDt) / linDampDenom);

        const rot = quatToMat3(b.quat);
        const { inertia, invInertia } = computeWorldInertia(rot, b.inertiaLocal);
        const iOmega = mulMat3Vec3(inertia, b.angVel);
        const gyro = crossVec3(b.angVel, iOmega);
        const angAccel = mulMat3Vec3(invInertia, {
          x: f32(-gyro.x),
          y: f32(-gyro.y),
          z: f32(-gyro.z),
        });

        b.angVel.x = f32((b.angVel.x + angAccel.x * subDt) / angDampDenom);
        b.angVel.y = f32((b.angVel.y + angAccel.y * subDt) / angDampDenom);
        b.angVel.z = f32((b.angVel.z + angAccel.z * subDt) / angDampDenom);
      }

      // 2b. Warm-start contact & joint impulses on first substep
      if (s === 0) {
        this.warmStartContacts(0.85);
        this.warmStartJoints(0.85);
      }

      // 2c. Iterative TGS Soft velocity solver for contacts & joints
      for (let iter = 0; iter < tgsIters; iter++) {
        this.solveContactManifoldsVelocity(subDt, omega, zeta, true);
        if (this.joints.length > 0) {
          this.solveJointsVelocity(subDt);
        }
      }

      // 2d. Integrate positions (with selective CCD world sweep) and orientations
      for (let i = 0; i < count; i++) {
        const b = this.rigidBodies[i];
        if (b.mass <= 0 || b.sleeping) continue;

        this.integrateRigidBodyWorldPose(b, subDt);
      }

      // 2e. Unbiased velocity relaxation pass (beta_soft = 0, restitution = 0)
      this.solveContactManifoldsVelocity(subDt, omega, zeta, false);
    }

    // 3. Persist contact warm-start cache for next tick
    this.contactCache.clear();
    for (let i = 0; i < this.activeManifolds.length; i++) {
      const m = this.activeManifolds[i];
      this.contactCache.set(m.key, {
        lambdaN: m.lambdaN,
        lambdaT1: m.lambdaT1,
        lambdaT2: m.lambdaT2,
        lambdaTwist: m.lambdaTwist,
      });
    }

    // 4. NGS (Non-Linear Gauss-Seidel) position projection (zero velocity kick)
    for (let iter = 0; iter < ngsIters; iter++) {
      this.solveContactsNgsPosition();
      if (this.joints.length > 0) {
        this.solveJointsNgsPosition();
      }
    }

    // 5. Update body sleeping state
    const linSqThresh = this.sourceConfig.sleepLinearThreshold ** 2;
    const angSqThresh = this.sourceConfig.sleepAngularThreshold ** 2;
    const sleepTimeThresh = this.sourceConfig.sleepTimeThreshold;

    for (let i = 0; i < count; i++) {
      const b = this.rigidBodies[i];
      if (b.mass <= 0) continue;
      if (this.gravityGun.heldBodyId === b.id) {
        this.wakeBody(b);
        continue;
      }

      const vSq = b.vel.x * b.vel.x + b.vel.y * b.vel.y + b.vel.z * b.vel.z;
      const wSq = b.angVel.x * b.angVel.x + b.angVel.y * b.angVel.y + b.angVel.z * b.angVel.z;

      if (vSq < linSqThresh && wSq < angSqThresh) {
        b.sleepTimer = (b.sleepTimer ?? 0) + FIXED_DT;
        if (b.sleepTimer >= sleepTimeThresh) {
          b.sleeping = true;
          b.vel.x = f32(0);
          b.vel.y = f32(0);
          b.vel.z = f32(0);
          b.angVel.x = f32(0);
          b.angVel.y = f32(0);
          b.angVel.z = f32(0);
        }
      } else {
        b.sleeping = false;
        b.sleepTimer = 0;
      }
    }
  }

  /** Integrate a single body over subDt with selective CCD sweep against static BSP world */
  private integrateRigidBodyWorldPose(b: SourceRigidBody, subDt: number): void {
    const tr = this.bodyTraceScratch;
    const minExtent = Math.min(b.hx, b.hy, b.hz);
    const maxRadius = Math.hypot(b.hx, b.hy, b.hz);
    const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
    const angSpeed = Math.hypot(b.angVel.x, b.angVel.y, b.angVel.z);
    const maxDisp = speed * subDt + maxRadius * angSpeed * subDt;

    // Selective CCD: subdivide high-speed bodies to prevent tunneling through thin brushes
    const ccdSteps =
      b.enableCcd !== false && minExtent > 0.5 && maxDisp > minExtent * 0.5
        ? Math.min(4, Math.ceil(maxDisp / (minExtent * 0.5)))
        : 1;
    const stepDt = f32(subDt / ccdSteps);

    for (let k = 0; k < ccdSteps; k++) {
      const targetX = f32(b.pos.x + b.vel.x * stepDt);
      const targetY = f32(b.pos.y + b.vel.y * stepDt);
      const targetZ = f32(b.pos.z + b.vel.z * stepDt);

      // Quaternion integration: q <- normalize(q + 0.5 * [0, w] * q * dt)
      const qw = b.quat.w;
      const qx = b.quat.x;
      const qy = b.quat.y;
      const qz = b.quat.z;
      const wx = b.angVel.x;
      const wy = b.angVel.y;
      const wz = b.angVel.z;

      b.quat = normalizeQuat({
        w: f32(qw - 0.5 * (wx * qx + wy * qy + wz * qz) * stepDt),
        x: f32(qx + 0.5 * (wx * qw + wy * qz - wz * qy) * stepDt),
        y: f32(qy + 0.5 * (-wx * qz + wy * qw + wz * qx) * stepDt),
        z: f32(qz + 0.5 * (wx * qy - wy * qx + wz * qw) * stepDt),
      });

      this.traceWorld(b.pos.x, b.pos.y, b.pos.z, targetX, targetY, targetZ, b.hx, b.hy, b.hz, tr);

      b.pos.x = tr.endX;
      b.pos.y = tr.endY;
      b.pos.z = tr.endZ;

      if (tr.fraction < 1.0) {
        const nx = tr.normalX;
        const ny = tr.normalY;
        const nz = tr.normalZ;
        const vn = f32(b.vel.x * nx + b.vel.y * ny + b.vel.z * nz);

        if (vn < 0) {
          const rest = Math.abs(vn) > 24 ? Math.max(b.restitution, this.sourceConfig.svBounce) : 0;
          const bounce = f32(1.0 + rest);
          const jn = f32(-vn * bounce * b.mass);

          b.vel.x = f32(b.vel.x - nx * vn * bounce);
          b.vel.y = f32(b.vel.y - ny * vn * bounce);
          b.vel.z = f32(b.vel.z - nz * vn * bounce);

          // Coulomb tangential friction + rotational rolling/torsional damping against world brush
          const mu = b.surfaceFriction ?? this.sourceConfig.surfaceFriction;
          const vtX = f32(b.vel.x - nx * (b.vel.x * nx + b.vel.y * ny + b.vel.z * nz));
          const vtY = f32(b.vel.y - ny * (b.vel.x * nx + b.vel.y * ny + b.vel.z * nz));
          const vtZ = f32(b.vel.z - nz * (b.vel.x * nx + b.vel.y * ny + b.vel.z * nz));
          const vtLen = Math.hypot(vtX, vtY, vtZ);
          if (vtLen > 1e-4) {
            const maxFrictionDv = f32((mu * Math.abs(jn)) / b.mass);
            const drop = Math.min(vtLen, maxFrictionDv);
            const scale = f32((vtLen - drop) / vtLen);
            b.vel.x = f32(b.vel.x - vtX * (1 - scale));
            b.vel.y = f32(b.vel.y - vtY * (1 - scale));
            b.vel.z = f32(b.vel.z - vtZ * (1 - scale));

            // Induce realistic tumbling torque when sliding across floor/walls
            const rot = quatToMat3(b.quat);
            const { invInertia } = computeWorldInertia(rot, b.inertiaLocal);
            const lever: Vec3 = {
              x: f32(-nx * b.hx * 0.5),
              y: f32(-ny * b.hy * 0.5),
              z: f32(-nz * b.hz * 0.5),
            };
            const jtVec: Vec3 = {
              x: f32((-vtX / vtLen) * drop * b.mass * 0.25),
              y: f32((-vtY / vtLen) * drop * b.mass * 0.25),
              z: f32((-vtZ / vtLen) * drop * b.mass * 0.25),
            };
            const dOmega = mulMat3Vec3(invInertia, crossVec3(lever, jtVec));
            b.angVel.x = f32(b.angVel.x + dOmega.x);
            b.angVel.y = f32(b.angVel.y + dOmega.y);
            b.angVel.z = f32(b.angVel.z + dOmega.z);
          }

          // Torsional spin friction around contact normal
          const wTwist = f32(b.angVel.x * nx + b.angVel.y * ny + b.angVel.z * nz);
          const twistDamp = f32(Math.max(0, 1 - 0.16 * mu));
          b.angVel.x = f32(b.angVel.x * 0.92 - nx * wTwist * (1 - twistDamp));
          b.angVel.y = f32(b.angVel.y * 0.92 - ny * wTwist * (1 - twistDamp));
          b.angVel.z = f32(b.angVel.z * 0.92 - nz * wTwist * (1 - twistDamp));

          const impactJ = Math.abs(vn) * b.mass;
          if (impactJ > 260) {
            this.callbacks.onRigidBodyHit?.(b.id, impactJ, b.pos, b.kind ?? 'prop');
          }
          if (nz >= SURF_NORMAL_Z && Math.abs(b.vel.z) < 16) {
            b.vel.z = f32(0);
          }
        }
      }
    }
  }

  private collectContactManifolds(): void {
    this.activeManifolds.length = 0;
    const count = this.rigidBodies.length;

    for (let i = 0; i < count; i++) {
      const a = this.rigidBodies[i];
      if (a.mass <= 0) continue;

      for (let j = i + 1; j < count; j++) {
        const b = this.rigidBodies[j];
        if (b.mass <= 0) continue;
        if (a.sleeping && b.sleeping) continue;

        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const dz = b.pos.z - a.pos.z;

        const overlapX = a.hx + b.hx - Math.abs(dx);
        const overlapY = a.hy + b.hy - Math.abs(dy);
        const overlapZ = a.hz + b.hz - Math.abs(dz);
        if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue;

        // Wake sleeping partner when hit by an active body
        if (a.sleeping) this.wakeBody(a);
        if (b.sleeping) this.wakeBody(b);

        let nx = 0, ny = 0, nz = 0, pen = 0;
        let patchRadius = 4;
        if (overlapX < overlapY && overlapX < overlapZ) {
          pen = overlapX;
          nx = dx >= 0 ? 1 : -1;
          patchRadius = Math.min(a.hy, b.hy, a.hz, b.hz) * 0.5;
        } else if (overlapY < overlapZ) {
          pen = overlapY;
          ny = dy >= 0 ? 1 : -1;
          patchRadius = Math.min(a.hx, b.hx, a.hz, b.hz) * 0.5;
        } else {
          pen = overlapZ;
          nz = dz >= 0 ? 1 : -1;
          patchRadius = Math.min(a.hx, b.hx, a.hy, b.hy) * 0.5;
        }

        const cx = f32((Math.max(a.pos.x - a.hx, b.pos.x - b.hx) + Math.min(a.pos.x + a.hx, b.pos.x + b.hx)) * 0.5);
        const cy = f32((Math.max(a.pos.y - a.hy, b.pos.y - b.hy) + Math.min(a.pos.y + a.hy, b.pos.y + b.hy)) * 0.5);
        const cz = f32((Math.max(a.pos.z - a.hz, b.pos.z - b.hz) + Math.min(a.pos.z + a.hz, b.pos.z + b.hz)) * 0.5);

        const basis = buildContactBasis(nx, ny, nz);
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        const prev = this.contactCache.get(key);

        const rA: Vec3 = { x: f32(cx - a.pos.x), y: f32(cy - a.pos.y), z: f32(cz - a.pos.z) };
        const rB: Vec3 = { x: f32(cx - b.pos.x), y: f32(cy - b.pos.y), z: f32(cz - b.pos.z) };
        const wA = crossVec3(a.angVel, rA);
        const wB = crossVec3(b.angVel, rB);
        const relVelNInitial = f32(
          (b.vel.x + wB.x - a.vel.x - wA.x) * nx +
            (b.vel.y + wB.y - a.vel.y - wA.y) * ny +
            (b.vel.z + wB.z - a.vel.z - wA.z) * nz,
        );

        const muA = a.surfaceFriction ?? this.sourceConfig.surfaceFriction;
        const muB = b.surfaceFriction ?? this.sourceConfig.surfaceFriction;

        this.activeManifolds.push({
          key,
          idxA: i,
          idxB: j,
          nx: f32(nx),
          ny: f32(ny),
          nz: f32(nz),
          ...basis,
          cx,
          cy,
          cz,
          penetration: f32(pen),
          restitution: f32(Math.min(a.restitution, b.restitution)),
          friction: f32(Math.sqrt(Math.max(0, muA * muB))),
          patchRadius: f32(Math.max(1, patchRadius)),
          lambdaN: prev ? f32(prev.lambdaN) : 0,
          lambdaT1: prev ? f32(prev.lambdaT1) : 0,
          lambdaT2: prev ? f32(prev.lambdaT2) : 0,
          lambdaTwist: prev ? f32(prev.lambdaTwist) : 0,
          relVelNInitial,
        });
      }
    }
  }

  private warmStartContacts(scale: number): void {
    for (let i = 0; i < this.activeManifolds.length; i++) {
      const m = this.activeManifolds[i];
      m.lambdaN = f32(m.lambdaN * scale);
      m.lambdaT1 = f32(m.lambdaT1 * scale);
      m.lambdaT2 = f32(m.lambdaT2 * scale);
      m.lambdaTwist = f32(m.lambdaTwist * scale);

      const a = this.rigidBodies[m.idxA];
      const b = this.rigidBodies[m.idxB];
      const { invInertia: invIA } = computeWorldInertia(quatToMat3(a.quat), a.inertiaLocal);
      const { invInertia: invIB } = computeWorldInertia(quatToMat3(b.quat), b.inertiaLocal);

      const rA: Vec3 = { x: f32(m.cx - a.pos.x), y: f32(m.cy - a.pos.y), z: f32(m.cz - a.pos.z) };
      const rB: Vec3 = { x: f32(m.cx - b.pos.x), y: f32(m.cy - b.pos.y), z: f32(m.cz - b.pos.z) };
      const pVec: Vec3 = {
        x: f32(m.nx * m.lambdaN + m.t1x * m.lambdaT1 + m.t2x * m.lambdaT2),
        y: f32(m.ny * m.lambdaN + m.t1y * m.lambdaT1 + m.t2y * m.lambdaT2),
        z: f32(m.nz * m.lambdaN + m.t1z * m.lambdaT1 + m.t2z * m.lambdaT2),
      };

      this.applyPairImpulse(a, b, invIA, invIB, rA, rB, pVec);

      if (Math.abs(m.lambdaTwist) > 1e-6) {
        const tw: Vec3 = {
          x: f32(m.nx * m.lambdaTwist),
          y: f32(m.ny * m.lambdaTwist),
          z: f32(m.nz * m.lambdaTwist),
        };
        const dwA = mulMat3Vec3(invIA, tw);
        const dwB = mulMat3Vec3(invIB, tw);
        a.angVel.x = f32(a.angVel.x - dwA.x);
        a.angVel.y = f32(a.angVel.y - dwA.y);
        a.angVel.z = f32(a.angVel.z - dwA.z);
        b.angVel.x = f32(b.angVel.x + dwB.x);
        b.angVel.y = f32(b.angVel.y + dwB.y);
        b.angVel.z = f32(b.angVel.z + dwB.z);
      }
    }
  }

  private solveContactManifoldsVelocity(
    subDt: number,
    omega: number,
    zeta: number,
    useBiasAndRestitution: boolean,
  ): void {
    const slop = 0.08;

    for (let i = 0; i < this.activeManifolds.length; i++) {
      const m = this.activeManifolds[i];
      const a = this.rigidBodies[m.idxA];
      const b = this.rigidBodies[m.idxB];
      const invMassA = 1 / a.mass;
      const invMassB = 1 / b.mass;

      const { invInertia: invIA } = computeWorldInertia(quatToMat3(a.quat), a.inertiaLocal);
      const { invInertia: invIB } = computeWorldInertia(quatToMat3(b.quat), b.inertiaLocal);

      const rA: Vec3 = { x: f32(m.cx - a.pos.x), y: f32(m.cy - a.pos.y), z: f32(m.cz - a.pos.z) };
      const rB: Vec3 = { x: f32(m.cx - b.pos.x), y: f32(m.cy - b.pos.y), z: f32(m.cz - b.pos.z) };
      const n: Vec3 = { x: m.nx, y: m.ny, z: m.nz };

      // 1. Normal impulse (TGS Soft harmonic oscillator parameters)
      const wA = crossVec3(a.angVel, rA);
      const wB = crossVec3(b.angVel, rB);
      const vRel: Vec3 = {
        x: f32(b.vel.x + wB.x - a.vel.x - wA.x),
        y: f32(b.vel.y + wB.y - a.vel.y - wA.y),
        z: f32(b.vel.z + wB.z - a.vel.z - wA.z),
      };

      const jvN = dotVec3(vRel, n);
      const angN =
        dotVec3(crossVec3(mulMat3Vec3(invIA, crossVec3(rA, n)), rA), n) +
        dotVec3(crossVec3(mulMat3Vec3(invIB, crossVec3(rB, n)), rB), n);
      const kN = invMassA + invMassB + angN;
      if (kN <= 1e-8) continue;

      const mEff = 1 / kN;
      const kSpring = mEff * omega * omega;
      const cDamp = 2 * mEff * zeta * omega;
      const denomSoft = cDamp + subDt * kSpring;
      const gamma = useBiasAndRestitution ? 1 / (subDt * denomSoft) : 0;
      const betaSoft = useBiasAndRestitution ? (subDt * kSpring) / denomSoft : 0;

      const cErr = -Math.max(0, m.penetration - slop);
      const vRest =
        useBiasAndRestitution && m.relVelNInitial < -24 ? -m.restitution * m.relVelNInitial : 0;
      const rhsBias = useBiasAndRestitution ? Math.max((betaSoft / subDt) * cErr, vRest) : 0;

      const dLambdaN = f32(-(jvN + rhsBias + gamma * m.lambdaN) / (kN + gamma));
      const nextLambdaN = f32(Math.max(0, m.lambdaN + dLambdaN));
      const appliedN = f32(nextLambdaN - m.lambdaN);
      m.lambdaN = nextLambdaN;

      if (Math.abs(appliedN) > 1e-6) {
        this.applyPairImpulse(a, b, invIA, invIB, rA, rB, {
          x: f32(n.x * appliedN),
          y: f32(n.y * appliedN),
          z: f32(n.z * appliedN),
        });
      }

      // 2. Circular Coulomb friction cone across orthonormal tangents t1, t2
      const t1: Vec3 = { x: m.t1x, y: m.t1y, z: m.t1z };
      const t2: Vec3 = { x: m.t2x, y: m.t2y, z: m.t2z };

      const wA2 = crossVec3(a.angVel, rA);
      const wB2 = crossVec3(b.angVel, rB);
      const vRelT: Vec3 = {
        x: f32(b.vel.x + wB2.x - a.vel.x - wA2.x),
        y: f32(b.vel.y + wB2.y - a.vel.y - wA2.y),
        z: f32(b.vel.z + wB2.z - a.vel.z - wA2.z),
      };

      const kT1 =
        invMassA +
        invMassB +
        dotVec3(crossVec3(mulMat3Vec3(invIA, crossVec3(rA, t1)), rA), t1) +
        dotVec3(crossVec3(mulMat3Vec3(invIB, crossVec3(rB, t1)), rB), t1);
      const kT2 =
        invMassA +
        invMassB +
        dotVec3(crossVec3(mulMat3Vec3(invIA, crossVec3(rA, t2)), rA), t2) +
        dotVec3(crossVec3(mulMat3Vec3(invIB, crossVec3(rB, t2)), rB), t2);

      let nextT1 = kT1 > 1e-8 ? f32(m.lambdaT1 - dotVec3(vRelT, t1) / kT1) : m.lambdaT1;
      let nextT2 = kT2 > 1e-8 ? f32(m.lambdaT2 - dotVec3(vRelT, t2) / kT2) : m.lambdaT2;

      const maxFriction = f32(m.friction * m.lambdaN);
      const tMag = Math.hypot(nextT1, nextT2);
      if (tMag > maxFriction && tMag > 1e-6) {
        const s = maxFriction / tMag;
        nextT1 = f32(nextT1 * s);
        nextT2 = f32(nextT2 * s);
      }

      const dT1 = f32(nextT1 - m.lambdaT1);
      const dT2 = f32(nextT2 - m.lambdaT2);
      m.lambdaT1 = nextT1;
      m.lambdaT2 = nextT2;

      if (Math.abs(dT1) > 1e-6 || Math.abs(dT2) > 1e-6) {
        this.applyPairImpulse(a, b, invIA, invIB, rA, rB, {
          x: f32(t1.x * dT1 + t2.x * dT2),
          y: f32(t1.y * dT1 + t2.y * dT2),
          z: f32(t1.z * dT1 + t2.z * dT2),
        });
      }

      // 3. Torsional patch friction around contact normal n
      const relTwist = f32(
        (b.angVel.x - a.angVel.x) * n.x +
          (b.angVel.y - a.angVel.y) * n.y +
          (b.angVel.z - a.angVel.z) * n.z,
      );
      const kTwist = dotVec3(mulMat3Vec3(invIA, n), n) + dotVec3(mulMat3Vec3(invIB, n), n);
      if (kTwist > 1e-8) {
        const maxTwist = f32(m.friction * m.patchRadius * m.lambdaN);
        const rawTwist = f32(m.lambdaTwist - relTwist / kTwist);
        const clampedTwist = f32(Math.max(-maxTwist, Math.min(maxTwist, rawTwist)));
        const dTwist = f32(clampedTwist - m.lambdaTwist);
        m.lambdaTwist = clampedTwist;

        if (Math.abs(dTwist) > 1e-6) {
          const twVec: Vec3 = { x: f32(n.x * dTwist), y: f32(n.y * dTwist), z: f32(n.z * dTwist) };
          const dwA = mulMat3Vec3(invIA, twVec);
          const dwB = mulMat3Vec3(invIB, twVec);
          a.angVel.x = f32(a.angVel.x - dwA.x);
          a.angVel.y = f32(a.angVel.y - dwA.y);
          a.angVel.z = f32(a.angVel.z - dwA.z);
          b.angVel.x = f32(b.angVel.x + dwB.x);
          b.angVel.y = f32(b.angVel.y + dwB.y);
          b.angVel.z = f32(b.angVel.z + dwB.z);
        }
      }
    }
  }

  /** NGS (Non-Linear Gauss-Seidel) position projection: resolves residual overlap without velocity bounce */
  private solveContactsNgsPosition(): void {
    const slop = 0.04;
    const correctionFactor = 0.4;

    for (let i = 0; i < this.activeManifolds.length; i++) {
      const m = this.activeManifolds[i];
      const a = this.rigidBodies[m.idxA];
      const b = this.rigidBodies[m.idxB];

      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const dz = b.pos.z - a.pos.z;
      const pen =
        Math.abs(m.nx) > 0.5
          ? a.hx + b.hx - Math.abs(dx)
          : Math.abs(m.ny) > 0.5
            ? a.hy + b.hy - Math.abs(dy)
            : a.hz + b.hz - Math.abs(dz);
      if (pen <= slop) continue;

      const invA = 1 / a.mass;
      const invB = 1 / b.mass;
      const total = invA + invB;
      const corr = f32((pen - slop) * correctionFactor);
      const aShare = f32(corr * (invA / total));
      const bShare = f32(corr * (invB / total));

      a.pos.x = f32(a.pos.x - m.nx * aShare);
      a.pos.y = f32(a.pos.y - m.ny * aShare);
      a.pos.z = f32(a.pos.z - m.nz * aShare);
      b.pos.x = f32(b.pos.x + m.nx * bShare);
      b.pos.y = f32(b.pos.y + m.ny * bShare);
      b.pos.z = f32(b.pos.z + m.nz * bShare);
    }
  }

  private applyPairImpulse(
    a: SourceRigidBody,
    b: SourceRigidBody,
    invIA: Mat3,
    invIB: Mat3,
    rA: Vec3,
    rB: Vec3,
    impulse: Vec3,
  ): void {
    const invMassA = 1 / a.mass;
    const invMassB = 1 / b.mass;

    a.vel.x = f32(a.vel.x - impulse.x * invMassA);
    a.vel.y = f32(a.vel.y - impulse.y * invMassA);
    a.vel.z = f32(a.vel.z - impulse.z * invMassA);

    b.vel.x = f32(b.vel.x + impulse.x * invMassB);
    b.vel.y = f32(b.vel.y + impulse.y * invMassB);
    b.vel.z = f32(b.vel.z + impulse.z * invMassB);

    const dOmegaA = mulMat3Vec3(invIA, crossVec3(rA, impulse));
    a.angVel.x = f32(a.angVel.x - dOmegaA.x);
    a.angVel.y = f32(a.angVel.y - dOmegaA.y);
    a.angVel.z = f32(a.angVel.z - dOmegaA.z);

    const dOmegaB = mulMat3Vec3(invIB, crossVec3(rB, impulse));
    b.angVel.x = f32(b.angVel.x + dOmegaB.x);
    b.angVel.y = f32(b.angVel.y + dOmegaB.y);
    b.angVel.z = f32(b.angVel.z + dOmegaB.z);
  }

  // ---------------------------------------------------------------------------
  // Support System A: Constraint & Joint Solver (phys_constraintsystem)
  // ---------------------------------------------------------------------------

  private warmStartJoints(scale: number): void {
    for (let i = 0; i < this.joints.length; i++) {
      const jt = this.joints[i];
      if (jt.broken) continue;
      jt.lambdaX = f32((jt.lambdaX ?? 0) * scale);
      jt.lambdaY = f32((jt.lambdaY ?? 0) * scale);
      jt.lambdaZ = f32((jt.lambdaZ ?? 0) * scale);

      const a = this.findBodyById(jt.bodyAId);
      if (!a || a.mass <= 0) continue;
      const b = jt.bodyBId ? this.findBodyById(jt.bodyBId) : null;

      const rotA = quatToMat3(a.quat);
      const rA = mulMat3Vec3(rotA, jt.localAnchorA);
      const { invInertia: invIA } = computeWorldInertia(rotA, a.inertiaLocal);
      const pVec: Vec3 = { x: jt.lambdaX, y: jt.lambdaY, z: jt.lambdaZ };

      if (b && b.mass > 0) {
        const rotB = quatToMat3(b.quat);
        const rB = mulMat3Vec3(rotB, jt.localAnchorB);
        const { invInertia: invIB } = computeWorldInertia(rotB, b.inertiaLocal);
        this.applyPairImpulse(a, b, invIA, invIB, rA, rB, pVec);
      } else {
        const invMA = 1 / a.mass;
        a.vel.x = f32(a.vel.x - pVec.x * invMA);
        a.vel.y = f32(a.vel.y - pVec.y * invMA);
        a.vel.z = f32(a.vel.z - pVec.z * invMA);
        const dOmegaA = mulMat3Vec3(invIA, crossVec3(rA, pVec));
        a.angVel.x = f32(a.angVel.x - dOmegaA.x);
        a.angVel.y = f32(a.angVel.y - dOmegaA.y);
        a.angVel.z = f32(a.angVel.z - dOmegaA.z);
      }
    }
  }

  private solveJointsVelocity(subDt: number): void {
    for (let i = 0; i < this.joints.length; i++) {
      const jt = this.joints[i];
      if (jt.broken) continue;

      const a = this.findBodyById(jt.bodyAId);
      if (!a || a.mass <= 0) continue;
      const b = jt.bodyBId ? this.findBodyById(jt.bodyBId) : null;
      if (a.sleeping && (!b || b.sleeping)) continue;
      if (b && b.sleeping) this.wakeBody(b);
      if (a.sleeping) this.wakeBody(a);

      const rotA = quatToMat3(a.quat);
      const rA = mulMat3Vec3(rotA, jt.localAnchorA);
      const pA: Vec3 = { x: f32(a.pos.x + rA.x), y: f32(a.pos.y + rA.y), z: f32(a.pos.z + rA.z) };
      const { invInertia: invIA } = computeWorldInertia(rotA, a.inertiaLocal);

      let pB: Vec3;
      let rB: Vec3 = { x: 0, y: 0, z: 0 };
      let invIB: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      let invMB = 0;
      let rotB: Mat3 | null = null;
      let vB: Vec3 = { x: 0, y: 0, z: 0 };

      if (b && b.mass > 0) {
        rotB = quatToMat3(b.quat);
        rB = mulMat3Vec3(rotB, jt.localAnchorB);
        pB = { x: f32(b.pos.x + rB.x), y: f32(b.pos.y + rB.y), z: f32(b.pos.z + rB.z) };
        invIB = computeWorldInertia(rotB, b.inertiaLocal).invInertia;
        invMB = 1 / b.mass;
        const wB = crossVec3(b.angVel, rB);
        vB = { x: f32(b.vel.x + wB.x), y: f32(b.vel.y + wB.y), z: f32(b.vel.z + wB.z) };
      } else {
        pB = jt.localAnchorB;
      }

      const wA = crossVec3(a.angVel, rA);
      const vA: Vec3 = { x: f32(a.vel.x + wA.x), y: f32(a.vel.y + wA.y), z: f32(a.vel.z + wA.z) };
      const invMA = 1 / a.mass;
      const omega = 2 * Math.PI * (jt.frequencyHz ?? 18);
      const zeta = jt.dampingRatio ?? 1.0;

      let impX = 0, impY = 0, impZ = 0;

      if (jt.kind === 'distance') {
        const dx = pB.x - pA.x;
        const dy = pB.y - pA.y;
        const dz = pB.z - pA.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > 1e-5) {
          const axis: Vec3 = { x: f32(dx / dist), y: f32(dy / dist), z: f32(dz / dist) };
          const cErr = dist - (jt.restLength ?? 0);
          const jv = dotVec3({ x: vB.x - vA.x, y: vB.y - vA.y, z: vB.z - vA.z }, axis);
          const k =
            invMA +
            invMB +
            dotVec3(crossVec3(mulMat3Vec3(invIA, crossVec3(rA, axis)), rA), axis) +
            dotVec3(crossVec3(mulMat3Vec3(invIB, crossVec3(rB, axis)), rB), axis);
          if (k > 1e-8) {
            const mEff = 1 / k;
            const kS = mEff * omega * omega;
            const cD = 2 * mEff * zeta * omega;
            const gamma = 1 / (subDt * (cD + subDt * kS));
            const beta = (subDt * kS) / (cD + subDt * kS);
            const prevL = dotVec3({ x: jt.lambdaX ?? 0, y: jt.lambdaY ?? 0, z: jt.lambdaZ ?? 0 }, axis);
            const dL = f32(-(jv + (beta / subDt) * cErr + gamma * prevL) / (k + gamma));
            impX = f32(axis.x * dL);
            impY = f32(axis.y * dL);
            impZ = f32(axis.z * dL);
          }
        }
      } else {
        // Ball-socket, hinge, and fixed joints all enforce 3D anchor coincidence pA == pB
        const axes: Vec3[] = [
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
          { x: 0, y: 0, z: 1 },
        ];
        const errs = [pB.x - pA.x, pB.y - pA.y, pB.z - pA.z];
        const jvs = [vB.x - vA.x, vB.y - vA.y, vB.z - vA.z];
        const prevs = [jt.lambdaX ?? 0, jt.lambdaY ?? 0, jt.lambdaZ ?? 0];
        const out = [0, 0, 0];

        for (let kIdx = 0; kIdx < 3; kIdx++) {
          const ax = axes[kIdx];
          const k =
            invMA +
            invMB +
            dotVec3(crossVec3(mulMat3Vec3(invIA, crossVec3(rA, ax)), rA), ax) +
            dotVec3(crossVec3(mulMat3Vec3(invIB, crossVec3(rB, ax)), rB), ax);
          if (k <= 1e-8) continue;
          const mEff = 1 / k;
          const kS = mEff * omega * omega;
          const cD = 2 * mEff * zeta * omega;
          const gamma = 1 / (subDt * (cD + subDt * kS));
          const beta = (subDt * kS) / (cD + subDt * kS);
          out[kIdx] = f32(-(jvs[kIdx] + (beta / subDt) * errs[kIdx] + gamma * prevs[kIdx]) / (k + gamma));
        }
        impX = out[0];
        impY = out[1];
        impZ = out[2];
      }

      jt.lambdaX = f32((jt.lambdaX ?? 0) + impX);
      jt.lambdaY = f32((jt.lambdaY ?? 0) + impY);
      jt.lambdaZ = f32((jt.lambdaZ ?? 0) + impZ);

      const impVec: Vec3 = { x: impX, y: impY, z: impZ };
      if (b && b.mass > 0) {
        this.applyPairImpulse(a, b, invIA, invIB, rA, rB, impVec);
      } else {
        a.vel.x = f32(a.vel.x - impX * invMA);
        a.vel.y = f32(a.vel.y - impY * invMA);
        a.vel.z = f32(a.vel.z - impZ * invMA);
        const dOmegaA = mulMat3Vec3(invIA, crossVec3(rA, impVec));
        a.angVel.x = f32(a.angVel.x - dOmegaA.x);
        a.angVel.y = f32(a.angVel.y - dOmegaA.y);
        a.angVel.z = f32(a.angVel.z - dOmegaA.z);
      }

      // Angular constraint for hinge (axis alignment) or fixed (full orientation lock)
      if (jt.kind === 'hinge' && jt.localAxisA) {
        const axisA = mulMat3Vec3(rotA, jt.localAxisA);
        const axisB =
          b && rotB && jt.localAxisB ? mulMat3Vec3(rotB, jt.localAxisB) : (jt.localAxisB ?? axisA);
        const alignErr = crossVec3(axisA, axisB);
        const relAngVel: Vec3 = {
          x: f32((b ? b.angVel.x : 0) - a.angVel.x),
          y: f32((b ? b.angVel.y : 0) - a.angVel.y),
          z: f32((b ? b.angVel.z : 0) - a.angVel.z),
        };
        const proj = dotVec3(relAngVel, axisA);
        const perpVel: Vec3 = {
          x: f32(relAngVel.x - axisA.x * proj - alignErr.x * 6.0),
          y: f32(relAngVel.y - axisA.y * proj - alignErr.y * 6.0),
          z: f32(relAngVel.z - axisA.z * proj - alignErr.z * 6.0),
        };
        const damp = f32(0.35);
        a.angVel.x = f32(a.angVel.x + perpVel.x * damp);
        a.angVel.y = f32(a.angVel.y + perpVel.y * damp);
        a.angVel.z = f32(a.angVel.z + perpVel.z * damp);
        if (b && b.mass > 0) {
          b.angVel.x = f32(b.angVel.x - perpVel.x * damp);
          b.angVel.y = f32(b.angVel.y - perpVel.y * damp);
          b.angVel.z = f32(b.angVel.z - perpVel.z * damp);
        }
      } else if (jt.kind === 'fixed') {
        const targetQ = b ? b.quat : { w: 1, x: 0, y: 0, z: 0 };
        const errQ = computeQuatLogError(targetQ, a.quat);
        const relW: Vec3 = {
          x: f32((b ? b.angVel.x : 0) - a.angVel.x + errQ.x * 8.0),
          y: f32((b ? b.angVel.y : 0) - a.angVel.y + errQ.y * 8.0),
          z: f32((b ? b.angVel.z : 0) - a.angVel.z + errQ.z * 8.0),
        };
        a.angVel.x = f32(a.angVel.x + relW.x * 0.45);
        a.angVel.y = f32(a.angVel.y + relW.y * 0.45);
        a.angVel.z = f32(a.angVel.z + relW.z * 0.45);
        if (b && b.mass > 0) {
          b.angVel.x = f32(b.angVel.x - relW.x * 0.45);
          b.angVel.y = f32(b.angVel.y - relW.y * 0.45);
          b.angVel.z = f32(b.angVel.z - relW.z * 0.45);
        }
      }

      // Breakable threshold check
      if (jt.breakForce && jt.breakForce > 0) {
        const totalImp = Math.hypot(jt.lambdaX, jt.lambdaY, jt.lambdaZ);
        if (totalImp > jt.breakForce) {
          jt.broken = true;
          this.callbacks.onJointBroken?.(jt.id, pA);
        }
      }
    }
  }

  private solveJointsNgsPosition(): void {
    for (let i = 0; i < this.joints.length; i++) {
      const jt = this.joints[i];
      if (jt.broken) continue;
      const a = this.findBodyById(jt.bodyAId);
      if (!a || a.mass <= 0) continue;
      const b = jt.bodyBId ? this.findBodyById(jt.bodyBId) : null;

      const rA = mulMat3Vec3(quatToMat3(a.quat), jt.localAnchorA);
      const pA = { x: a.pos.x + rA.x, y: a.pos.y + rA.y, z: a.pos.z + rA.z };
      const pB =
        b && b.mass > 0
          ? (() => {
              const rB = mulMat3Vec3(quatToMat3(b.quat), jt.localAnchorB);
              return { x: b.pos.x + rB.x, y: b.pos.y + rB.y, z: b.pos.z + rB.z };
            })()
          : jt.localAnchorB;

      let errX = pB.x - pA.x;
      let errY = pB.y - pA.y;
      let errZ = pB.z - pA.z;

      if (jt.kind === 'distance') {
        const dist = Math.hypot(errX, errY, errZ);
        if (dist < 1e-5) continue;
        const diff = dist - (jt.restLength ?? 0);
        errX = (errX / dist) * diff;
        errY = (errY / dist) * diff;
        errZ = (errZ / dist) * diff;
      }

      const invA = 1 / a.mass;
      const invB = b && b.mass > 0 ? 1 / b.mass : 0;
      const total = invA + invB;
      const shareA = (invA / total) * 0.35;
      const shareB = (invB / total) * 0.35;

      a.pos.x = f32(a.pos.x + errX * shareA);
      a.pos.y = f32(a.pos.y + errY * shareA);
      a.pos.z = f32(a.pos.z + errZ * shareA);
      if (b && b.mass > 0) {
        b.pos.x = f32(b.pos.x - errX * shareB);
        b.pos.y = f32(b.pos.y - errY * shareB);
        b.pos.z = f32(b.pos.z - errZ * shareB);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Support System B: Verlet Rope & Cable Dynamics (CRopeKeyframe)
  // ---------------------------------------------------------------------------

  private stepRopes(): void {
    const gravity = this.abi.f32[F32.CVAR_GRAVITY];
    const dtSq = f32(FIXED_DT * FIXED_DT);

    for (let rIdx = 0; rIdx < this.ropes.length; rIdx++) {
      const rope = this.ropes[rIdx];
      const n = rope.nodes.length;
      if (n < 2) continue;
      const keep = f32(Math.max(0, 1.0 - rope.damping));
      const gTerm = f32(-gravity * rope.gravityScale * dtSq);

      // 1. Verlet integration
      for (let i = 0; i < n; i++) {
        const isPinned = (i === 0 && rope.startPin) || (i === n - 1 && rope.endPin);
        if (isPinned) continue;

        const cur = rope.nodes[i];
        const prev = rope.prevNodes[i];
        const vx = f32((cur.x - prev.x) * keep);
        const vy = f32((cur.y - prev.y) * keep);
        const vz = f32((cur.z - prev.z) * keep);

        prev.x = cur.x;
        prev.y = cur.y;
        prev.z = cur.z;

        cur.x = f32(cur.x + vx);
        cur.y = f32(cur.y + vy);
        cur.z = f32(cur.z + vz + gTerm);
      }

      // 2. Pin endpoints & iterative distance relaxation
      const startPos = rope.startPin ? this.resolveRopePinWorldPos(rope.startPin) : null;
      const endPos = rope.endPin ? this.resolveRopePinWorldPos(rope.endPin) : null;

      for (let iter = 0; iter < rope.iterations; iter++) {
        if (startPos) {
          rope.nodes[0].x = startPos.x;
          rope.nodes[0].y = startPos.y;
          rope.nodes[0].z = startPos.z;
        }
        if (endPos) {
          rope.nodes[n - 1].x = endPos.x;
          rope.nodes[n - 1].y = endPos.y;
          rope.nodes[n - 1].z = endPos.z;
        }

        for (let i = 0; i < n - 1; i++) {
          const p0 = rope.nodes[i];
          const p1 = rope.nodes[i + 1];
          const dx = p1.x - p0.x;
          const dy = p1.y - p0.y;
          const dz = p1.z - p0.z;
          const dist = Math.hypot(dx, dy, dz);
          if (dist < 1e-5) continue;

          const diff = (dist - rope.segmentLength) / dist;
          const pin0 = i === 0 && startPos !== null;
          const pin1 = i + 1 === n - 1 && endPos !== null;

          if (!pin0 && !pin1) {
            const hx = f32(dx * diff * 0.5);
            const hy = f32(dy * diff * 0.5);
            const hz = f32(dz * diff * 0.5);
            p0.x = f32(p0.x + hx);
            p0.y = f32(p0.y + hy);
            p0.z = f32(p0.z + hz);
            p1.x = f32(p1.x - hx);
            p1.y = f32(p1.y - hy);
            p1.z = f32(p1.z - hz);
          } else if (!pin0 && pin1) {
            p0.x = f32(p0.x + dx * diff);
            p0.y = f32(p0.y + dy * diff);
            p0.z = f32(p0.z + dz * diff);
          } else if (pin0 && !pin1) {
            p1.x = f32(p1.x - dx * diff);
            p1.y = f32(p1.y - dy * diff);
            p1.z = f32(p1.z - dz * diff);
          }
        }
      }

      // 3. Optional world collision projection for interior nodes
      if (rope.collideWorld) {
        const tr = this.auxTraceScratch;
        for (let i = 1; i < n - 1; i++) {
          const prev = rope.prevNodes[i];
          const cur = rope.nodes[i];
          this.traceWorld(prev.x, prev.y, prev.z, cur.x, cur.y, cur.z, 1, 1, 1, tr);
          if (tr.fraction < 1.0) {
            cur.x = tr.endX;
            cur.y = tr.endY;
            cur.z = tr.endZ;
          }
        }
      }
    }
  }

  private resolveRopePinWorldPos(pin: RopePin): Vec3 {
    if (!pin.bodyId) return pin.anchor;
    const body = this.findBodyById(pin.bodyId);
    if (!body) return pin.anchor;
    const offset = mulMat3Vec3(quatToMat3(body.quat), pin.anchor);
    return {
      x: f32(body.pos.x + offset.x),
      y: f32(body.pos.y + offset.y),
      z: f32(body.pos.z + offset.z),
    };
  }

  // ---------------------------------------------------------------------------
  // Support System C: Gravity Gun (Velocity-Level PID Controller)
  // ---------------------------------------------------------------------------

  private stepGravityGunPid(): void {
    const id = this.gravityGun.heldBodyId;
    if (!id) return;
    const body = this.findBodyById(id);
    if (!body || body.mass <= 0) {
      this.gravityGun.heldBodyId = null;
      return;
    }

    this.wakeBody(body);
    const vf = this.abi.f32;
    const eye = this.getPlayerEyePosition();
    const { forward } = computeAngleVectors(-vf[F32.CMD_PITCH], vf[F32.CMD_YAW], 0);
    const targetDist = this.gravityGun.holdDistance;

    // Prevent pushing held prop into static walls
    const wallTr = this.auxTraceScratch;
    this.traceWorld(
      eye.x,
      eye.y,
      eye.z,
      f32(eye.x + forward.x * targetDist),
      f32(eye.y + forward.y * targetDist),
      f32(eye.z + forward.z * targetDist),
      body.hx * 0.5,
      body.hy * 0.5,
      body.hz * 0.5,
      wallTr,
    );

    const safeDist = Math.max(48, targetDist * wallTr.fraction);
    const targetX = f32(eye.x + forward.x * safeDist);
    const targetY = f32(eye.y + forward.y * safeDist);
    const targetZ = f32(eye.z + forward.z * safeDist);

    const errX = f32(targetX - body.pos.x);
    const errY = f32(targetY - body.pos.y);
    const errZ = f32(targetZ - body.pos.z);

    // Auto-drop if prop gets snagged too far away
    if (Math.hypot(errX, errY, errZ) > 360) {
      this.releaseHeldBody(0);
      return;
    }

    // Velocity-level PID: v_cmd = Kp * e + Ki * integral(e) + Kd * de/dt
    const kp = 16.0;
    const ki = 2.0;
    const kd = 0.35;

    const iErr = this.gravityGun.integralErr;
    iErr.x = f32(Math.max(-60, Math.min(60, iErr.x + errX * FIXED_DT)));
    iErr.y = f32(Math.max(-60, Math.min(60, iErr.y + errY * FIXED_DT)));
    iErr.z = f32(Math.max(-60, Math.min(60, iErr.z + errZ * FIXED_DT)));

    const dErrX = (errX - this.gravityGun.prevErr.x) / FIXED_DT;
    const dErrY = (errY - this.gravityGun.prevErr.y) / FIXED_DT;
    const dErrZ = (errZ - this.gravityGun.prevErr.z) / FIXED_DT;
    this.gravityGun.prevErr.x = errX;
    this.gravityGun.prevErr.y = errY;
    this.gravityGun.prevErr.z = errZ;

    let cmdVx = kp * errX + ki * iErr.x + kd * dErrX;
    let cmdVy = kp * errY + ki * iErr.y + kd * dErrY;
    let cmdVz = kp * errZ + ki * iErr.z + kd * dErrZ;

    const maxCmdSpeed = 1200;
    const cmdSpeed = Math.hypot(cmdVx, cmdVy, cmdVz);
    if (cmdSpeed > maxCmdSpeed) {
      const s = maxCmdSpeed / cmdSpeed;
      cmdVx *= s;
      cmdVy *= s;
      cmdVz *= s;
    }

    body.vel.x = f32(body.vel.x + (cmdVx - body.vel.x) * 0.45);
    body.vel.y = f32(body.vel.y + (cmdVy - body.vel.y) * 0.45);
    body.vel.z = f32(body.vel.z + (cmdVz - body.vel.z) * 0.45);

    // Orientation PID via quaternion log-error
    const viewQuat = quatFromYawPitch(vf[F32.CMD_YAW], -vf[F32.CMD_PITCH]);
    const targetQuat = mulQuat(viewQuat, this.gravityGun.targetOffsetQuat);
    const eQ = computeQuatLogError(targetQuat, body.quat);
    body.angVel.x = f32(body.angVel.x * 0.65 + eQ.x * 6.0);
    body.angVel.y = f32(body.angVel.y * 0.65 + eQ.y * 6.0);
    body.angVel.z = f32(body.angVel.z * 0.65 + eQ.z * 6.0);
  }

  // ---------------------------------------------------------------------------
  // Support System D: Player-to-VPhysics Shadow Controller (IPhysicsPlayerController)
  // ---------------------------------------------------------------------------

  /**
   * Bridges QPhysics player AABB and VPhysics rigid bodies:
   * - One-way authority on surf ramps so props never corrupt player surf momentum.
   * - Bounded push force (playerMaxPushForce) so barrels push cleanly without launching dumpsters.
   */
  private resolvePlayerShadowCollisions(playerIsSurfing: boolean): void {
    const vf = this.abi.f32;
    const phx = HULL_STAND.hx;
    const phy = HULL_STAND.hy;
    const phz = this.getHullHalfZ();

    const pPos: Vec3 = { x: vf[F32.POS_X], y: vf[F32.POS_Y], z: vf[F32.POS_Z] };
    const pVel: Vec3 = { x: vf[F32.VEL_X], y: vf[F32.VEL_Y], z: vf[F32.VEL_Z] };
    const pMass = Math.max(1, this.sourceConfig.playerMass);
    const pInvMass = 1 / pMass;
    const maxPushImpulse = f32(this.sourceConfig.playerMaxPushForce * FIXED_DT * 10);

    for (let i = 0; i < this.rigidBodies.length; i++) {
      const b = this.rigidBodies[i];
      if (b.mass <= 0 || b.kind === 'weapon' || this.gravityGun.heldBodyId === b.id) continue;

      const dx = b.pos.x - pPos.x;
      const dy = b.pos.y - pPos.y;
      const dz = b.pos.z - pPos.z;

      const overlapX = phx + b.hx - Math.abs(dx);
      const overlapY = phy + b.hy - Math.abs(dy);
      const overlapZ = phz + b.hz - Math.abs(dz);
      if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue;

      this.wakeBody(b);

      let nx = 0, ny = 0, nz = 0, pen = 0;
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
      const pShare = playerIsSurfing ? 0 : pInvMass / totalInvMass;
      const bShare = playerIsSurfing ? 1 : bInvMass / totalInvMass;

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
        x: f32(b.vel.x + omegaCrossRB.x - pVel.x),
        y: f32(b.vel.y + omegaCrossRB.y - pVel.y),
        z: f32(b.vel.z + omegaCrossRB.z - pVel.z),
      };

      const vRelDotN = dotVec3(vRel, n);
      if (vRelDotN >= 0) continue;

      const angTermB = dotVec3(crossVec3(mulMat3Vec3(invIB, crossVec3(rB, n)), rB), n);
      const e = Math.max(b.restitution, this.sourceConfig.svBounce);
      const denom = (playerIsSurfing ? 0 : pInvMass) + bInvMass + angTermB;
      if (denom <= 1e-8) continue;

      const rawJ = (-(1 + e) * vRelDotN) / denom;
      const clampedJ = f32(Math.min(rawJ, maxPushImpulse));
      const jn: Vec3 = { x: f32(clampedJ * n.x), y: f32(clampedJ * n.y), z: f32(clampedJ * n.z) };

      if (!playerIsSurfing) {
        pVel.x = f32(pVel.x - jn.x * pInvMass);
        pVel.y = f32(pVel.y - jn.y * pInvMass);
        pVel.z = f32(pVel.z - jn.z * pInvMass);
      }

      b.vel.x = f32(b.vel.x + jn.x * bInvMass);
      b.vel.y = f32(b.vel.y + jn.y * bInvMass);
      b.vel.z = f32(b.vel.z + jn.z * bInvMass);

      const dOmegaB = mulMat3Vec3(invIB, crossVec3(rB, jn));
      b.angVel.x = f32(b.angVel.x + dOmegaB.x);
      b.angVel.y = f32(b.angVel.y + dOmegaB.y);
      b.angVel.z = f32(b.angVel.z + dOmegaB.z);

      this.callbacks.onRigidBodyHit?.(b.id, Math.abs(clampedJ), contact, b.kind ?? 'prop');
    }

    vf[F32.POS_X] = pPos.x;
    vf[F32.POS_Y] = pPos.y;
    vf[F32.POS_Z] = pPos.z;
    vf[F32.VEL_X] = pVel.x;
    vf[F32.VEL_Y] = pVel.y;
    vf[F32.VEL_Z] = pVel.z;
  }

  // ---------------------------------------------------------------------------
  // Support System E: Buoyancy & Fluid Drag (CPhysicsFluidController)
  // ---------------------------------------------------------------------------

  private stepRigidBodyBuoyancy(): void {
    const gravity = this.abi.f32[F32.CVAR_GRAVITY];

    for (let i = 0; i < this.rigidBodies.length; i++) {
      const b = this.rigidBodies[i];
      if (b.mass <= 0) continue;

      for (let wIdx = 0; wIdx < this.waterVolumes.length; wIdx++) {
        const w = this.waterVolumes[wIdx];
        if (
          b.pos.x + b.hx < w.minX ||
          b.pos.x - b.hx > w.maxX ||
          b.pos.y + b.hy < w.minY ||
          b.pos.y - b.hy > w.maxY ||
          b.pos.z - b.hz > w.surfaceZ ||
          b.pos.z + b.hz < w.minZ
        ) {
          continue;
        }

        const height = b.hz * 2;
        if (height <= 1e-4) continue;
        const submergedDepth = Math.max(0, Math.min(height, w.surfaceZ - (b.pos.z - b.hz)));
        const fSub = submergedDepth / height;
        if (fSub <= 0) continue;

        this.wakeBody(b);

        const rhoRatio = (b.buoyancyRatio ?? 1.25) * (w.density ?? 1.0);
        const curVx = w.currentVel?.x ?? 0;
        const curVy = w.currentVel?.y ?? 0;
        const curVz = w.currentVel?.z ?? 0;

        // Upward buoyancy acceleration: a_buoy = g * rho_ratio * f_sub
        const buoyDvZ = f32(gravity * rhoRatio * fSub * FIXED_DT);
        b.vel.z = f32(b.vel.z + buoyDvZ);

        // Implicit fluid linear & angular drag relative to water current
        const linDrag = (b.linearDrag ?? w.linearDrag ?? 2.2) * fSub;
        const angDrag = (b.angularDrag ?? w.angularDrag ?? 2.6) * fSub;
        const linFactor = f32(1 / (1 + linDrag * FIXED_DT));
        const angFactor = f32(1 / (1 + angDrag * FIXED_DT));

        b.vel.x = f32(curVx + (b.vel.x - curVx) * linFactor);
        b.vel.y = f32(curVy + (b.vel.y - curVy) * linFactor);
        b.vel.z = f32(curVz + (b.vel.z - curVz) * linFactor);

        // Self-righting torque from offset between submerged centroid and center of mass
        const rot = quatToMat3(b.quat);
        const bodyUp: Vec3 = { x: rot[2], y: rot[5], z: rot[8] };
        const rightingTorque = crossVec3(bodyUp, { x: 0, y: 0, z: 1 });
        const torqueScale = f32(fSub * (1 - fSub * 0.5) * 3.5 * FIXED_DT);
        b.angVel.x = f32((b.angVel.x + rightingTorque.x * torqueScale) * angFactor);
        b.angVel.y = f32((b.angVel.y + rightingTorque.y * torqueScale) * angFactor);
        b.angVel.z = f32((b.angVel.z + rightingTorque.z * torqueScale) * angFactor);
        break;
      }
    }
  }

  private computePlayerWaterSubmersion(): number {
    if (this.waterVolumes.length === 0) return 0;
    const vf = this.abi.f32;
    const px = vf[F32.POS_X];
    const py = vf[F32.POS_Y];
    const pz = vf[F32.POS_Z];
    const hz = this.getHullHalfZ();

    for (let i = 0; i < this.waterVolumes.length; i++) {
      const w = this.waterVolumes[i];
      if (
        px + HULL_STAND.hx < w.minX ||
        px - HULL_STAND.hx > w.maxX ||
        py + HULL_STAND.hy < w.minY ||
        py - HULL_STAND.hy > w.maxY ||
        pz - hz > w.surfaceZ ||
        pz + hz < w.minZ
      ) {
        continue;
      }
      return f32(Math.max(0, Math.min(1, (w.surfaceZ - (pz - hz)) / (hz * 2))));
    }
    return 0;
  }

  private waterMove(
    forward: Vec3,
    right: Vec3,
    fmove: number,
    smove: number,
    maxSpeed: number,
  ): number {
    const vf = this.abi.f32;
    // Implicit water drag
    const drag = f32(1 / (1 + 2.4 * FIXED_DT));
    vf[F32.VEL_X] = f32(vf[F32.VEL_X] * drag);
    vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] * drag);
    vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] * drag);

    const wishX = f32(fmove * forward.x + smove * right.x);
    const wishY = f32(fmove * forward.y + smove * right.y);
    const wishZ = f32(fmove * forward.z + smove * right.z);
    const wishMag = f32(Math.hypot(wishX, wishY, wishZ));
    const wishspeed = f32(Math.min(wishMag, maxSpeed * 0.8));

    if (wishMag > 1e-5) {
      this.accelerate(
        f32(wishX / wishMag),
        f32(wishY / wishMag),
        f32(wishZ / wishMag),
        wishspeed,
        vf[F32.CVAR_ACCEL],
        this.sourceConfig.surfaceFriction,
      );
    }
    this.checkVelocity();
    return this.flyMove();
  }

  // ---------------------------------------------------------------------------
  // Support System F: Raycast Vehicle Suspension & Tire Friction
  // ---------------------------------------------------------------------------

  private stepVehicles(): void {
    const tr = this.auxTraceScratch;

    for (let vIdx = 0; vIdx < this.vehicles.length; vIdx++) {
      const veh = this.vehicles[vIdx];
      const chassis = this.findBodyById(veh.chassisId);
      if (!chassis || chassis.mass <= 0) continue;

      const rot = quatToMat3(chassis.quat);
      const { invInertia } = computeWorldInertia(rot, chassis.inertiaLocal);
      const invMass = 1 / chassis.mass;

      const chassisFwd: Vec3 = { x: rot[0], y: rot[3], z: rot[6] };
      const chassisRight: Vec3 = { x: rot[1], y: rot[4], z: rot[7] };
      const chassisUp: Vec3 = { x: rot[2], y: rot[5], z: rot[8] };

      const steerAngle = veh.steer * veh.maxSteerRad;
      const cosS = Math.cos(steerAngle);
      const sinS = Math.sin(steerAngle);

      for (let wIdx = 0; wIdx < veh.wheels.length; wIdx++) {
        const wheel = veh.wheels[wIdx];
        wheel.prevCompression = wheel.compression;

        const worldOffset = mulMat3Vec3(rot, wheel.localHardpoint);
        const startX = f32(chassis.pos.x + worldOffset.x);
        const startY = f32(chassis.pos.y + worldOffset.y);
        const startZ = f32(chassis.pos.z + worldOffset.z);

        const rayLen = wheel.restLength + wheel.radius;
        const endX = f32(startX - chassisUp.x * rayLen);
        const endY = f32(startY - chassisUp.y * rayLen);
        const endZ = f32(startZ - chassisUp.z * rayLen);

        this.traceWorld(startX, startY, startZ, endX, endY, endZ, 0, 0, 0, tr);
        if (tr.fraction >= 1.0) {
          wheel.inContact = false;
          wheel.compression = 0;
          continue;
        }

        this.wakeBody(chassis);
        wheel.inContact = true;
        const hitDist = tr.fraction * rayLen;
        const comp = f32(Math.max(0, wheel.restLength - (hitDist - wheel.radius)));
        wheel.compression = comp;
        wheel.contactPoint = { x: tr.endX, y: tr.endY, z: tr.endZ };
        wheel.contactNormal = { x: tr.normalX, y: tr.normalY, z: tr.normalZ };

        // 1. Hookean Spring-Damper Suspension Force: F_susp = k_s * x + c_d * dx/dt
        const compVel = (comp - wheel.prevCompression) / FIXED_DT;
        const suspForce = Math.max(0, wheel.stiffness * comp + wheel.damping * compVel);
        const suspImpulse = f32(suspForce * FIXED_DT);

        const rC: Vec3 = {
          x: f32(tr.endX - chassis.pos.x),
          y: f32(tr.endY - chassis.pos.y),
          z: f32(tr.endZ - chassis.pos.z),
        };
        const wCrossR = crossVec3(chassis.angVel, rC);
        const patchVel: Vec3 = {
          x: f32(chassis.vel.x + wCrossR.x),
          y: f32(chassis.vel.y + wCrossR.y),
          z: f32(chassis.vel.z + wCrossR.z),
        };

        // Wheel forward & lateral axes (steered if front wheel)
        const wf: Vec3 = wheel.steerable
          ? {
              x: f32(chassisFwd.x * cosS + chassisRight.x * sinS),
              y: f32(chassisFwd.y * cosS + chassisRight.y * sinS),
              z: f32(chassisFwd.z * cosS + chassisRight.z * sinS),
            }
          : chassisFwd;
        const wr: Vec3 = wheel.steerable
          ? {
              x: f32(-chassisFwd.x * sinS + chassisRight.x * cosS),
              y: f32(-chassisFwd.y * sinS + chassisRight.y * cosS),
              z: f32(-chassisFwd.z * sinS + chassisRight.z * cosS),
            }
          : chassisRight;

        // 2. Pacejka-inspired lateral slip & longitudinal drive/brake impulses clamped by grip cone
        const vLong = dotVec3(patchVel, wf);
        const vLat = dotVec3(patchVel, wr);
        wheel.spinAngle = f32(wheel.spinAngle + (vLong / Math.max(1, wheel.radius)) * FIXED_DT);

        const muGrip = wheel.grip * (veh.handbrake > 0.5 && !wheel.steerable ? 0.35 : 1.0);
        const maxTireImpulse = f32(suspImpulse * muGrip);

        let driveImpulse = wheel.driven ? f32(veh.throttle * veh.engineForce * FIXED_DT) : 0;
        if (veh.handbrake > 0.1) {
          const brakeDir = vLong > 1 ? -1 : vLong < -1 ? 1 : 0;
          driveImpulse = f32(driveImpulse + brakeDir * veh.handbrake * veh.brakeForce * FIXED_DT);
        }

        const latImpulseRaw = f32(-vLat * chassis.mass * 0.25);
        const tireMag = Math.hypot(driveImpulse, latImpulseRaw);
        let jLong = driveImpulse;
        let jLat = latImpulseRaw;
        if (tireMag > maxTireImpulse && tireMag > 1e-6) {
          const s = maxTireImpulse / tireMag;
          jLong = f32(jLong * s);
          jLat = f32(jLat * s);
        }

        const totalImpulse: Vec3 = {
          x: f32(tr.normalX * suspImpulse + wf.x * jLong + wr.x * jLat),
          y: f32(tr.normalY * suspImpulse + wf.y * jLong + wr.y * jLat),
          z: f32(tr.normalZ * suspImpulse + wf.z * jLong + wr.z * jLat),
        };

        chassis.vel.x = f32(chassis.vel.x + totalImpulse.x * invMass);
        chassis.vel.y = f32(chassis.vel.y + totalImpulse.y * invMass);
        chassis.vel.z = f32(chassis.vel.z + totalImpulse.z * invMass);

        const dOmega = mulMat3Vec3(invInertia, crossVec3(rC, totalImpulse));
        chassis.angVel.x = f32(chassis.angVel.x + dOmega.x);
        chassis.angVel.y = f32(chassis.angVel.y + dOmega.y);
        chassis.angVel.z = f32(chassis.angVel.z + dOmega.z);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // BSP Minkowski Plane Sweeps & BVH Broad-Phase Queries
  // ---------------------------------------------------------------------------

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

    // Reuse cached union-AABB candidate list inside StepMove when active
    let candidates: Int32Array;
    let count: number;
    if (this.stepCandidateCount >= 0) {
      candidates = this.stepQueryScratch;
      count = this.stepCandidateCount;
    } else {
      candidates = this.queryScratch;
      count = this.brushBvh.queryAabb(bMinX, bMinY, bMinZ, bMaxX, bMaxY, bMaxZ, candidates);
    }

    for (let i = 0; i < count; i++) {
      const br = this.brushes[candidates[i]];
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

  // ---------------------------------------------------------------------------
  // Core CGameMovement (GoldSrc / Source Exact Velocity Math)
  // ---------------------------------------------------------------------------

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

  /**
   * TryPlayerMove / PM_FlyMove: multi-plane iterative sliding with crease cross-product,
   * duplicate-normal clamping, and optional surf ramp-seam dead-stop recovery.
   */
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
    let lastSurfNx = f32(0);
    let lastSurfNy = f32(0);
    let lastSurfNz = f32(0);
    let seamRecovered = false;

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

      // Surf ramp-seam glitch recovery: if an internal brush seam abruptly kills high-speed ramp slide,
      // nudge outward along the surf ramp normal by 2*DIST_EPSILON and re-trace once.
      if (
        this.sourceConfig.enableRampSeamFix &&
        !seamRecovered &&
        lastSurfNz > 0.05 &&
        tr.fraction < 0.05 &&
        tr.normalZ < 0.05
      ) {
        const preSpeed = Math.hypot(curOrigX, curOrigY, curOrigZ);
        const opposing = curOrigX * tr.normalX + curOrigY * tr.normalY + curOrigZ * tr.normalZ;
        if (preSpeed > 320 && opposing < -preSpeed * 0.6) {
          const nudge = f32(DIST_EPSILON * 2.0);
          const nX = f32(vf[F32.POS_X] + lastSurfNx * nudge);
          const nY = f32(vf[F32.POS_Y] + lastSurfNy * nudge);
          const nZ = f32(vf[F32.POS_Z] + lastSurfNz * nudge);
          const nudgeTr = this.traceWorld(
            vf[F32.POS_X],
            vf[F32.POS_Y],
            vf[F32.POS_Z],
            nX,
            nY,
            nZ,
            HULL_STAND.hx,
            HULL_STAND.hy,
            hz,
            this.auxTraceScratch,
          );
          if (!nudgeTr.startSolid && !nudgeTr.allSolid && nudgeTr.fraction > 0.5) {
            vf[F32.POS_X] = nudgeTr.endX;
            vf[F32.POS_Y] = nudgeTr.endY;
            vf[F32.POS_Z] = nudgeTr.endZ;
            seamRecovered = true;
            continue;
          }
        }
      }

      if (tr.normalZ >= SURF_NORMAL_Z) {
        blocked |= 1;
      } else if (tr.normalZ > 0.05) {
        blocked |= 4;
        surfHitNz = tr.normalZ;
        lastSurfNx = tr.normalX;
        lastSurfNy = tr.normalY;
        lastSurfNz = tr.normalZ;
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

      // Duplicate plane normal clamping (prevents dense seams from tripping 3-plane dead-stop)
      let duplicate = false;
      for (let i = 0; i < numPlanes; i++) {
        if (
          this.planesX[i] * tr.normalX +
            this.planesY[i] * tr.normalY +
            this.planesZ[i] * tr.normalZ >
          0.999
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

  /**
   * StepMove / WalkMove with single union-AABB BVH candidate caching and overhang early-out.
   */
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

    // Pre-fetch candidate brushes once for the union AABB covering Path A and Path B
    const pad = f32(4.0);
    this.stepCandidateCount = this.brushBvh.queryAabb(
      Math.min(startX, destX) - HULL_STAND.hx - pad,
      Math.min(startY, destY) - HULL_STAND.hy - pad,
      startZ - hz - STEPSIZE - pad,
      Math.max(startX, destX) + HULL_STAND.hx + pad,
      Math.max(startY, destY) + HULL_STAND.hy + pad,
      startZ + hz + STEPSIZE + pad,
      this.stepQueryScratch,
    );

    try {
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

      const initialHitNz = tr.normalZ;
      const origVX = vf[F32.VEL_X];
      const origVY = vf[F32.VEL_Y];
      const origVZ = vf[F32.VEL_Z];

      // Path A (Slide)
      this.flyMove();

      // Early-out of Path B when hitting a ceiling/overhang (n_z < -0.1)
      if (initialHitNz < -0.1) {
        return;
      }

      const downX = vf[F32.POS_X];
      const downY = vf[F32.POS_Y];
      const downZ = vf[F32.POS_Z];
      const downVX = vf[F32.VEL_X];
      const downVY = vf[F32.VEL_Y];
      const downVZ = vf[F32.VEL_Z];
      const downDistSq = (downX - startX) ** 2 + (downY - startY) ** 2;

      // Path B (Step Up -> Forward -> Drop)
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
    } finally {
      this.stepCandidateCount = -1;
    }
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


//surfSandbox03.ts
// src/maps/surfSandbox03.ts
import { f32 } from '../core/constants';
import { BrushBuilder, BrushStyle } from '../physics/BrushBuilder';
import {
  createBoxRigidBody,
  createTargetRigidBody,
  createWeaponRigidBody,
  SourceRigidBody,
  SpawnPoint,
} from '../physics/GoldSrcPhysicsEngine';
import { MapBuildResult, WorldSign } from './surfSandbox01';

interface StaircaseSpec {
  idPrefix: string;
  /** Center of the bottom step's starting edge */
  startX: number;
  startY: number;
  /** Floor Z of the lower deck */
  baseZ: number;
  /** Cardinal direction of ascent */
  dir: '+x' | '-x' | '+y' | '-y';
  /** Total width perpendicular to climb direction */
  width: number;
  /** Number of steps */
  steps: number;
  /** Step riser height (keep <= 16u so GoldSrc StepMove steps up seamlessly at <= 18u STEPSIZE) */
  riser: number;
  /** Horizontal tread depth per step */
  tread: number;
  /** Base slab thickness beneath the lowest step */
  baseThickness?: number;
  style?: BrushStyle;
}

/**
 * Generates solid convex box steps compatible with CGameMovement::StepMove (sv_stepsize = 18u).
 * Each step extends down to baseZ - baseThickness so there are no underside trace gaps.
 */
function addStaircase(builder: BrushBuilder, spec: StaircaseSpec): { endX: number; endY: number; topZ: number } {
  const {
    idPrefix,
    startX,
    startY,
    baseZ,
    dir,
    width,
    steps,
    riser,
    tread,
    baseThickness = 40,
    style = 'walkable',
  } = spec;

  const halfW = width * 0.5;
  const bottomZ = baseZ - baseThickness;

  for (let i = 0; i < steps; i++) {
    const stepTopZ = baseZ + (i + 1) * riser;
    const d0 = i * tread;
    const d1 = (i + 1) * tread;

    if (dir === '+x') {
      builder.addBoxBrush(
        `${idPrefix}_step_${i + 1}`,
        startX + d0,
        startY - halfW,
        bottomZ,
        startX + d1,
        startY + halfW,
        stepTopZ,
        style,
      );
    } else if (dir === '-x') {
      builder.addBoxBrush(
        `${idPrefix}_step_${i + 1}`,
        startX - d1,
        startY - halfW,
        bottomZ,
        startX - d0,
        startY + halfW,
        stepTopZ,
        style,
      );
    } else if (dir === '+y') {
      builder.addBoxBrush(
        `${idPrefix}_step_${i + 1}`,
        startX - halfW,
        startY + d0,
        bottomZ,
        startX + halfW,
        startY + d1,
        stepTopZ,
        style,
      );
    } else {
      builder.addBoxBrush(
        `${idPrefix}_step_${i + 1}`,
        startX - halfW,
        startY - d1,
        bottomZ,
        startX + halfW,
        startY - d0,
        stepTopZ,
        style,
      );
    }
  }

  const totalRun = steps * tread;
  const topZ = baseZ + steps * riser;
  return {
    endX: dir === '+x' ? startX + totalRun : dir === '-x' ? startX - totalRun : startX,
    endY: dir === '+y' ? startY + totalRun : dir === '-y' ? startY - totalRun : startY,
    topZ,
  };
}

export function buildSurfSandbox03(): MapBuildResult {
  const builder = new BrushBuilder();
  const signs: WorldSign[] = [];

  const spawn: SpawnPoint = {
    x: f32(-260),
    y: f32(0),
    z: f32(1240),
    yaw: f32(0),
    pitch: f32(-0.04),
  };

  // =========================================================================
  // STAGE 0: SPAWN BASTION, STAIRWELL ARMORY & ELEVATED START GATE
  // =========================================================================

  // Lower spawn courtyard (Z = 1200)
  builder.addBoxBrush('spawn_deck', -420, -380, 1140, 140, 380, 1200, 'slate');
  builder.addBoxBrush('spawn_back_wall', -444, -380, 1200, -420, 380, 1440, 'slate');
  builder.addBoxBrush('spawn_south_rail', -420, -404, 1200, 140, -380, 1264, 'slate');

  // Stair Flight A: 10 steps (16u riser x 28u tread) climbing +Y to Armory Mezzanine (Z = 1360)
  addStaircase(builder, {
    idPrefix: 'spawn_armory_stair',
    startX: -280,
    startY: 220,
    baseZ: 1200,
    dir: '+y',
    width: 140,
    steps: 10,
    riser: 16,
    tread: 28,
    style: 'walkable',
  });

  // Elevated Armory Mezzanine (Z = 1360) overlooking a target range across the gap
  builder.addBoxBrush('armory_mezzanine', -420, 500, 1320, 180, 820, 1360, 'slate');
  builder.addBoxBrush('armory_weapon_table', -360, 620, 1360, -140, 740, 1392, 'walkable');
  builder.addBoxBrush('armory_back_wall', -444, 380, 1320, -420, 820, 1540, 'slate');
  // Target gallery platform across from the mezzanine
  builder.addBoxBrush('spawn_range_deck', 360, 520, 1310, 620, 820, 1350, 'slate');
  builder.addBoxBrush('spawn_range_backstop', 620, 520, 1350, 648, 820, 1560, 'slate');

  // Stair Flight B: 5 steps (16u riser x 32u tread) climbing +X from Z = 1200 -> 1280 to Start Gate
  addStaircase(builder, {
    idPrefix: 'start_entry_stair',
    startX: 140,
    startY: 0,
    baseZ: 1200,
    dir: '+x',
    width: 320,
    steps: 5,
    riser: 16,
    tread: 32,
    style: 'walkable',
  });

  // Elevated Start Launch Deck (Z = 1280) + Framing Gate
  builder.addBoxBrush('start_launch_deck', 300, -220, 1220, 440, 220, 1280, 'booster');
  builder.addBoxBrush('start_pillar_l', 396, 200, 1280, 428, 228, 1500, 'finish');
  builder.addBoxBrush('start_pillar_r', 396, -228, 1280, 428, -200, 1500, 'finish');
  builder.addBoxBrush('start_header', 396, -228, 1500, 428, 228, 1532, 'finish');
  builder.addTrigger('trig_start', 'start', 390, -200, 1280, 448, 200, 1500);

  signs.push(
    {
      x: 412,
      y: 0,
      z: 1565,
      yaw: Math.PI,
      text: 'CITADEL GAUNTLET (MAP 03)  •  5 STAGES • STAIRS • COMBAT SURF',
      color: '#34d399',
      scale: 1.15,
    },
    {
      x: -280,
      y: 200,
      z: 1320,
      yaw: -Math.PI * 0.5,
      text: '↑ 16u STEP-UP STAIRS TO ARMORY & TARGET GALLERY',
      color: '#38bdf8',
      scale: 0.85,
    },
    {
      x: -250,
      y: 780,
      z: 1455,
      yaw: -Math.PI * 0.5,
      text: 'ARMORY MEZZANINE  •  SCOUT + USP .45 (G DROP / E PICKUP)',
      color: '#fbbf24',
      scale: 0.82,
    },
  );

  // =========================================================================
  // STAGE 1: TWIN VALLEY DROP, S-TRANSFER & SNIPER PERCH
  // =========================================================================

  // Ramp 1: 50° drop-in wedge
  builder.addSurfRampBrush('s1_ramp_1', {
    start: [540, 0, 1230],
    end: [2040, 0, 990],
    angleDeg: 50,
    height: 360,
    topWidth: 24,
    sides: 'both',
    style: 'ramp',
  });

  // Ramp 2: 53° offset right (-Y) transfer
  builder.addSurfRampBrush('s1_ramp_2', {
    start: [2300, -370, 990],
    end: [3820, -370, 750],
    angleDeg: 53,
    height: 380,
    topWidth: 24,
    sides: 'both',
    style: 'ramp',
  });

  // Flanking combat target gallery on +Y side of Ramp 2 (mid-air snipe targets)
  builder.addBoxBrush('s1_target_gallery', 2780, 210, 790, 3420, 410, 830, 'slate');
  builder.addBoxBrush('s1_gallery_back', 2780, 410, 830, 3420, 434, 960, 'slate');

  // Ramp 3: 55° counter-transfer back to +Y
  builder.addSurfRampBrush('s1_ramp_3', {
    start: [4060, 340, 760],
    end: [5540, 340, 520],
    angleDeg: 55,
    height: 390,
    topWidth: 24,
    sides: 'both',
    style: 'ramp',
  });

  // Stage 1 Booster Pad -> launches to Stage 2 Checkpoint Deck (Z = 420)
  builder.addBoxBrush('s1_booster_pad', 5660, 100, 220, 6100, 580, 260, 'booster');
  builder.addTrigger('trig_push_1', 'push', 5660, 100, 260, 6120, 580, 680, {
    mode: 'hybrid',
    dirX: 0.96,
    dirY: -0.1,
    dirZ: 0.42,
    addSpeed: 420,
    minSpeedXY: 1480,
    minVelZ: 660,
    cooldownTicks: 24,
  });

  signs.push(
    {
      x: 1180,
      y: 0,
      z: 1320,
      yaw: Math.PI,
      text: 'STAGE 1  •  50° DROP-IN  →  53° RIGHT  →  55° LEFT',
      color: '#fbbf24',
      scale: 1.1,
    },
    {
      x: 5880,
      y: 340,
      z: 710,
      yaw: Math.PI,
      text: 'BOOSTER 1  •  STAGE 2 STAIRWELL DECK',
      color: '#22d3ee',
      scale: 1.1,
    },
  );

  // =========================================================================
  // STAGE 2: CHECKPOINT 2, STAIRWELL SPLIT & DUAL-ANGLE ROUTES
  // =========================================================================

  // Checkpoint 2 Landing Deck (Z = 420)
  builder.addBoxBrush('s2_cp_deck', 6900, -280, 360, 7700, 600, 420, 'slate');
  builder.addTrigger('trig_cp_2', 'checkpoint', 6900, -280, 420, 7700, 600, 820, {
    index: 2,
    label: 'STAGE 2 — DUAL SPLIT',
    respawnX: 7260,
    respawnY: 160,
    respawnZ: 460,
    respawnYaw: 0,
    respawnPitch: -0.04,
    respawnVelX: 0,
    respawnVelY: 0,
    respawnVelZ: 0,
  });

  // Stair Flight C: 8 steps (16u riser x 30u tread) climbing +X from Z = 420 -> 548 to High Split Balcony
  addStaircase(builder, {
    idPrefix: 's2_split_stair',
    startX: 7700,
    startY: 360,
    baseZ: 420,
    dir: '+x',
    width: 280,
    steps: 8,
    riser: 16,
    tread: 30,
    style: 'walkable',
  });

  // Upper Split Balcony (+Y, Z = 548) -> feeds High 58° Steep Route
  builder.addBoxBrush('s2_high_balcony', 7940, 220, 508, 8260, 580, 548, 'walkable');
  // Lower Split Lip (-Y, Z = 420) -> feeds Low 50° Technical Route
  builder.addBoxBrush('s2_low_lip', 7700, -560, 380, 8260, -140, 420, 'slate');

  // Branch A (High Risk/Speed): 58° Steep Ramp on +Y
  builder.addSurfRampBrush('s2_ramp_high_58', {
    start: [8420, 420, 535],
    end: [10240, 420, 270],
    angleDeg: 58,
    height: 410,
    topWidth: 24,
    sides: 'both',
    style: 'steep',
  });
  // Framing arch over Branch A
  builder.addBoxBrush('s2_arch_l', 9280, 690, 120, 9340, 740, 760, 'slate');
  builder.addBoxBrush('s2_arch_r', 9280, 100, 120, 9340, 150, 760, 'slate');
  builder.addBoxBrush('s2_arch_top', 9280, 100, 720, 9340, 740, 770, 'steep');

  // Branch B (Low Technical): 50° Glide Ramp on -Y + side combat catwalk
  builder.addSurfRampBrush('s2_ramp_low_50', {
    start: [8420, -420, 430],
    end: [10240, -420, 190],
    angleDeg: 50,
    height: 360,
    topWidth: 24,
    sides: 'both',
    style: 'ramp',
  });
  builder.addBoxBrush('s2_low_target_ledge', 9100, -860, 220, 9620, -680, 260, 'slate');

  // Stage 2 Convergence Explosion Boost Gate -> launches up to Stage 3 Skybridge (Z = 480)
  builder.addBoxBrush('s2_booster_pad', 10440, -440, 40, 11040, 440, 80, 'booster');
  builder.addTrigger('trig_exp_s2', 'explosion', 10480, -380, 80, 11000, 380, 560, {
    originX: 10540,
    originY: 0,
    originZ: -120,
    maxDamage: 26000,
    radius: 880,
    pushScale: 1.0,
    cooldownTicks: 42,
  });
  builder.addTrigger('trig_push_2', 'push', 10440, -440, 80, 11040, 440, 380, {
    mode: 'hybrid',
    dirX: 1.0,
    dirY: 0,
    dirZ: 0.48,
    addSpeed: 300,
    minSpeedXY: 1520,
    minVelZ: 860,
    cooldownTicks: 24,
  });

  signs.push(
    {
      x: 7690,
      y: 360,
      z: 615,
      yaw: Math.PI,
      text: 'STAIRS UP → HIGH 58° SPEED ROUTE',
      color: '#f97316',
      scale: 0.95,
    },
    {
      x: 7690,
      y: -220,
      z: 560,
      yaw: Math.PI,
      text: 'LOW ROUTE → 50° GLIDE + TARGET GALLERY',
      color: '#fbbf24',
      scale: 0.95,
    },
    {
      x: 10740,
      y: 0,
      z: 620,
      yaw: Math.PI,
      text: 'BLAST LAUNCH GATE  •  STAGE 3 SKYBRIDGE',
      color: '#f97316',
      scale: 1.2,
    },
  );

  // =========================================================================
  // STAGE 3: CHECKPOINT 3, CROUCH-GATE SKYBRIDGE & 90° CURVED BANK
  // =========================================================================

  builder.addBoxBrush('s3_skybridge', 12100, -360, 440, 12960, 360, 480, 'slate');
  builder.addTrigger('trig_cp_3', 'checkpoint', 12100, -360, 480, 12960, 360, 920, {
    index: 3,
    label: 'STAGE 3 — CURVED BANK',
    respawnX: 12360,
    respawnY: 0,
    respawnZ: 520,
    respawnYaw: 0,
    respawnPitch: -0.04,
    respawnVelX: 0,
    respawnVelY: 0,
    respawnVelZ: 0,
  });

  // Optional 48u Crouch-Slide Center Gate (standing 72u hits beam; ducking 36u slides cleanly under)
  builder.addBoxBrush('s3_crouch_pillar_l', 12620, 120, 480, 12680, 160, 620, 'slate');
  builder.addBoxBrush('s3_crouch_pillar_r', 12620, -160, 480, 12680, -120, 620, 'slate');
  builder.addBoxBrush('s3_crouch_beam', 12620, -160, 528, 12680, 160, 620, 'ramp');

  // 3-Segment 90° Sweeping Curved Surf Bank (+X turning smoothly to +Y North)
  builder.addSurfRampBrush('s3_curve_1', {
    start: [13160, 0, 515],
    end: [14220, 260, 405],
    angleDeg: 52,
    height: 400,
    topWidth: 24,
    sides: 'both',
    style: 'ramp',
  });
  builder.addSurfRampBrush('s3_curve_2', {
    start: [14180, 245, 405],
    end: [14960, 990, 295],
    angleDeg: 56,
    height: 400,
    topWidth: 24,
    sides: 'both',
    style: 'ramp',
  });
  builder.addSurfRampBrush('s3_curve_3', {
    start: [14930, 960, 295],
    end: [15260, 2040, 185],
    angleDeg: 58,
    height: 400,
    topWidth: 24,
    sides: 'both',
    style: 'ramp',
  });

  // Stage 3 North Booster Pad -> launches +Y onto Stage 4 Stair-Tower Bastion (Z = 280)
  builder.addBoxBrush('s3_booster_pad', 14900, 2180, -40, 15620, 2680, 0, 'booster');
  builder.addTrigger('trig_push_3', 'push', 14900, 2180, 0, 15620, 2680, 420, {
    mode: 'hybrid',
    dirX: 0,
    dirY: 1.0,
    dirZ: 0.44,
    addSpeed: 320,
    minSpeedXY: 1500,
    minVelZ: 740,
    cooldownTicks: 24,
  });

  signs.push(
    {
      x: 12650,
      y: 0,
      z: 675,
      yaw: Math.PI,
      text: '48u CROUCH GATE (CTRL)  •  90° CURVED BANK AHEAD',
      color: '#fbbf24',
      scale: 0.95,
    },
    {
      x: 14680,
      y: 720,
      z: 640,
      yaw: Math.PI + 0.78,
      text: '90° SWEEPING BANK  •  52° → 56° → 58°',
      color: '#fbbf24',
      scale: 1.25,
    },
    {
      x: 15260,
      y: 2430,
      z: 490,
      yaw: -Math.PI * 0.5,
      text: 'NORTH LAUNCH  •  STAGE 4 CITADEL STAIR TOWER',
      color: '#22d3ee',
      scale: 1.15,
    },
  );

  // =========================================================================
  // STAGE 4: CHECKPOINT 4, GRAND CITADEL STAIRCASE & 60°–62° HYPER-SLALOM
  // =========================================================================

  // Checkpoint 4 Lower Bastion (Z = 280)
  builder.addBoxBrush('s4_bastion_lower', 14840, 3650, 220, 15680, 4450, 280, 'slate');
  builder.addTrigger('trig_cp_4', 'checkpoint', 14840, 3650, 280, 15680, 4450, 740, {
    index: 4,
    label: 'STAGE 4 — CITADEL TOWER',
    respawnX: 15260,
    respawnY: 4000,
    respawnZ: 320,
    respawnYaw: Math.PI * 0.5,
    respawnPitch: -0.04,
    respawnVelX: 0,
    respawnVelY: 0,
    respawnVelZ: 0,
  });

  // Stair Flight D: Grand Citadel Staircase — 12 steps (16u riser x 30u tread), Z = 280 -> 472
  addStaircase(builder, {
    idPrefix: 's4_citadel_stair',
    startX: 15260,
    startY: 4450,
    baseZ: 280,
    dir: '+y',
    width: 360,
    steps: 12,
    riser: 16,
    tread: 30,
    style: 'walkable',
  });
  // Flanking stair parapet walls for strong architectural framing
  builder.addBoxBrush('s4_stair_wall_w', 15040, 4450, 280, 15080, 4810, 560, 'slate');
  builder.addBoxBrush('s4_stair_wall_e', 15440, 4450, 280, 15480, 4810, 560, 'slate');

  // High Slalom Launch Terrace (Z = 472)
  builder.addBoxBrush('s4_upper_terrace', 14840, 4810, 420, 15680, 5220, 472, 'slate');
  builder.addBoxBrush('s4_weapon_pedestal', 15480, 4920, 472, 15620, 5100, 504, 'walkable');

  // Ramp 4A: 60° Steep Slalom Left
  builder.addSurfRampBrush('s4_ramp_1', {
    start: [14960, 5400, 480],
    end: [14820, 6960, 250],
    angleDeg: 60,
    height: 430,
    topWidth: 24,
    sides: 'both',
    style: 'steep',
  });

  // Ramp 4B: 62° Hyper-Steep Slalom Right
  builder.addSurfRampBrush('s4_ramp_2', {
    start: [15600, 7200, 320],
    end: [15460, 8820, 80],
    angleDeg: 62,
    height: 450,
    topWidth: 24,
    sides: 'both',
    style: 'steep',
  });

  // Citadel Hyper-Arch framing Ramp 4B
  builder.addBoxBrush('s4_arch_w', 15020, 7960, -80, 15080, 8040, 760, 'slate');
  builder.addBoxBrush('s4_arch_e', 15980, 7960, -80, 16040, 8040, 760, 'slate');
  builder.addBoxBrush('s4_arch_top', 15020, 7960, 720, 16040, 8040, 780, 'steep');

  // Final Hyper-Launch Pad -> launches high onto Stage 5 Citadel Finish Arena (Z = 520)
  builder.addBoxBrush('s4_final_pad', 15060, 9020, -80, 15860, 9620, -40, 'booster');
  builder.addTrigger('trig_exp_finale', 'explosion', 15100, 9060, -40, 15820, 9580, 520, {
    originX: 15460,
    originY: 8960,
    originZ: -200,
    maxDamage: 26000,
    radius: 900,
    pushScale: 1.0,
    cooldownTicks: 42,
  });
  builder.addTrigger('trig_push_4', 'push', 15060, 9020, -40, 15860, 9620, 360, {
    mode: 'hybrid',
    dirX: 0,
    dirY: 1.0,
    dirZ: 0.56,
    addSpeed: 280,
    minSpeedXY: 1450,
    minVelZ: 1020,
    cooldownTicks: 24,
  });

  signs.push(
    {
      x: 15260,
      y: 4430,
      z: 515,
      yaw: -Math.PI * 0.5,
      text: 'STAGE 4  •  12-STEP CITADEL STAIRCASE  •  CLEAR TARGETS',
      color: '#c084fc',
      scale: 1.05,
    },
    {
      x: 15530,
      y: 8000,
      z: 830,
      yaw: -Math.PI * 0.5,
      text: '62° HYPER-SLALOM  •  FINAL LAUNCH AHEAD',
      color: '#f87171',
      scale: 1.25,
    },
  );

  // =========================================================================
  // STAGE 5: CITADEL FINISH ARENA & VICTORY OVERLOOK STAIRS
  // =========================================================================

  const finMinX = 14720;
  const finMaxX = 16200;
  const finMinY = 11100;
  const finMaxY = 12360;
  const finZ = 520;

  builder.addBoxBrush('finish_arena', finMinX, finMinY, finZ - 60, finMaxX, finMaxY, finZ, 'finish');
  builder.addBoxBrush('fin_pillar_sw', finMinX + 20, finMinY + 20, finZ, finMinX + 60, finMinY + 60, finZ + 320, 'finish');
  builder.addBoxBrush('fin_pillar_se', finMaxX - 60, finMinY + 20, finZ, finMaxX - 20, finMinY + 60, finZ + 320, 'finish');
  builder.addBoxBrush('fin_pillar_nw', finMinX + 20, finMaxY - 60, finZ, finMinX + 60, finMaxY - 20, finZ + 320, 'finish');
  builder.addBoxBrush('fin_pillar_ne', finMaxX - 60, finMaxY - 60, finZ, finMaxX - 20, finMaxY - 20, finZ + 320, 'finish');
  builder.addBoxBrush('fin_back_wall', finMinX, finMaxY - 28, finZ, finMaxX, finMaxY, finZ + 340, 'slate');

  // Stair Flight E: 6 steps (16u riser x 28u tread) up to Victory Overlook Podium (Z = 616)
  addStaircase(builder, {
    idPrefix: 'fin_podium_stair',
    startX: 15460,
    startY: 11840,
    baseZ: finZ,
    dir: '+y',
    width: 300,
    steps: 6,
    riser: 16,
    tread: 28,
    style: 'walkable',
  });
  builder.addBoxBrush('fin_victory_podium', 15140, 12008, finZ, 15780, 12332, finZ + 96, 'walkable');

  builder.addTrigger('trig_end', 'end', finMinX + 40, finMinY + 40, finZ, finMaxX - 40, finMaxY - 40, finZ + 460);

  signs.push({
    x: 15460,
    y: finMaxY - 40,
    z: finZ + 380,
    yaw: -Math.PI * 0.5,
    text: 'CITADEL FINISH ARENA  •  TRIG_END  •  CLEAR THE GARRISON',
    color: '#34d399',
    scale: 1.4,
  });

  // =========================================================================
  // GLOBAL FAIL FLOOR TELEPORT TRIGGER
  // =========================================================================
  builder.addTrigger('trig_tp_fail', 'teleport', -2000, -3000, -900, 18000, 14500, -240, {
    dest: spawn,
  });

  // =========================================================================
  // INITIAL VPHYSICS RIGID BODIES (WEAPONS, COMBAT TARGETS & CRATES)
  // =========================================================================
  const createRigidBodies = (): SourceRigidBody[] => [
    // --- Stage 0: Spawn Armory Weapons & Target Gallery ---
    createWeaponRigidBody(
      's0_armory_scout',
      { x: -290, y: 680, z: 1404 },
      { slot: 1, clipAmmo: 10, reserveAmmo: 90, pickupCooldownTick: 0 },
    ),
    createWeaponRigidBody(
      's0_armory_usp',
      { x: -195, y: 680, z: 1402 },
      { slot: 2, clipAmmo: 12, reserveAmmo: 100, silenced: true, pickupCooldownTick: 0 },
    ),
    createTargetRigidBody('s0_target_1', { x: 480, y: 580, z: 1390 }, 100),
    createTargetRigidBody('s0_target_2', { x: 510, y: 670, z: 1390 }, 100),
    createTargetRigidBody('s0_target_3', { x: 480, y: 760, z: 1390 }, 100),
    createBoxRigidBody('s0_crate_1', { x: -30, y: 620, z: 1384 }, { x: 22, y: 22, z: 22 }, 32, { hp: 80 }),
    createBoxRigidBody('s0_crate_2', { x: -30, y: 670, z: 1384 }, { x: 22, y: 22, z: 22 }, 32, { hp: 80 }),

    // --- Stage 1: Mid-Air Sniper Gallery Targets ---
    createTargetRigidBody('s1_gallery_target_1', { x: 2940, y: 310, z: 870 }, 75),
    createTargetRigidBody('s1_gallery_target_2', { x: 3100, y: 310, z: 870 }, 75),
    createTargetRigidBody('s1_gallery_target_3', { x: 3260, y: 310, z: 870 }, 75),

    // --- Stage 2: Checkpoint Deck Resupply, Guard & Low-Route Targets ---
    createWeaponRigidBody(
      's2_scout_pickup',
      { x: 7420, y: 480, z: 432 },
      { slot: 1, clipAmmo: 10, reserveAmmo: 90, pickupCooldownTick: 0 },
    ),
    createTargetRigidBody('s2_stair_guard', { x: 8080, y: 380, z: 588 }, 100),
    createTargetRigidBody('s2_low_target_1', { x: 9260, y: -770, z: 300 }, 75),
    createTargetRigidBody('s2_low_target_2', { x: 9460, y: -770, z: 300 }, 75),
    createBoxRigidBody('s2_crate_1', { x: 7520, y: -140, z: 444 }, { x: 24, y: 24, z: 24 }, 34, { hp: 80 }),
    createBoxRigidBody('s2_crate_2', { x: 7520, y: -140, z: 492 }, { x: 20, y: 20, z: 20 }, 24, { hp: 60 }),

    // --- Stage 3: Skybridge USP Resupply & Crates ---
    createWeaponRigidBody(
      's3_usp_pickup',
      { x: 12480, y: 220, z: 492 },
      { slot: 2, clipAmmo: 12, reserveAmmo: 100, silenced: true, pickupCooldownTick: 0 },
    ),
    createTargetRigidBody('s3_bridge_guard', { x: 12840, y: -220, z: 520 }, 100),

    // --- Stage 4: Citadel Stair Tower Garrison & Armory Pedestal ---
    createTargetRigidBody('s4_tower_guard_1', { x: 15160, y: 4980, z: 512 }, 100),
    createTargetRigidBody('s4_tower_guard_2', { x: 15360, y: 5060, z: 512 }, 100),
    createWeaponRigidBody(
      's4_terrace_scout',
      { x: 15550, y: 4980, z: 516 },
      { slot: 1, clipAmmo: 10, reserveAmmo: 90, pickupCooldownTick: 0 },
    ),
    createWeaponRigidBody(
      's4_terrace_usp',
      { x: 15550, y: 5050, z: 514 },
      { slot: 2, clipAmmo: 12, reserveAmmo: 100, silenced: true, pickupCooldownTick: 0 },
    ),

    // --- Stage 5: Citadel Finish Arena Garrison & Victory Crate Pyramid ---
    createTargetRigidBody('fin_target_1', { x: 15160, y: 11680, z: 560 }, 100),
    createTargetRigidBody('fin_target_2', { x: 15760, y: 11680, z: 560 }, 100),
    createTargetRigidBody('fin_target_podium', { x: 15460, y: 12180, z: 656 }, 125),
    createBoxRigidBody('fin_crate_1', { x: 15390, y: 11520, z: 546 }, { x: 24, y: 24, z: 24 }, 34, { hp: 90 }),
    createBoxRigidBody('fin_crate_2', { x: 15530, y: 11520, z: 546 }, { x: 24, y: 24, z: 24 }, 34, { hp: 90 }),
    createBoxRigidBody('fin_crate_top', { x: 15460, y: 11520, z: 594 }, { x: 22, y: 22, z: 22 }, 26, { hp: 70 }),
  ];

  return {
    brushes: builder.brushes,
    triggers: builder.triggers,
    signs,
    spawn,
    createRigidBodies,
  };
}


// src/ui/HudController.ts

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


//index.html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CS 1.6 Surf — Phase 1 Offline Movement Sandbox</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700;800&display=swap" rel="stylesheet" />
</head>
<body>
  <canvas id="viewport"></canvas>
  <div id="screen-flash"></div>

  <div id="hud">
    <div id="top-left-status">
      <div class="status-pill">
        <span class="dot"></span>
        <span>surf_sandbox_01 • 100Hz WASM ABI</span>
      </div>
      <div id="debug-pill" class="status-pill">
        <span>DEBUG WIREFRAMES ACTIVE [F2]</span>
      </div>
    </div>

    <div id="timer-panel">
      <div class="timer-card">
        <span id="timer-state" class="timer-badge">READY</span>
        <span id="run-time">00:00.00</span>
        <span id="run-delta" class="delta-neutral">--.--</span>
      </div>
      <div class="pb-strip">
        <span>PB: <strong id="pb-display">--:--.--</strong></span>
        <span class="top3-sep">|</span>
        <span id="top3-display">TOP 3: --</span>
      </div>
    </div>

    <div id="event-toast"></div>

    <div id="crosshair" aria-hidden="true">
      <div class="ch-line ch-top"></div>
      <div class="ch-line ch-bottom"></div>
      <div class="ch-line ch-left"></div>
      <div class="ch-line ch-right"></div>
      <div class="ch-line ch-dot"></div>
    </div>

    <div id="weapon-hud">
      <div class="weapon-slot active" data-slot="1">
        <span><span class="weapon-key">[1]</span>SCOUT</span>
        <span class="weapon-spd" id="spd-slot-1">250 u/s</span>
      </div>
      <div class="weapon-slot" data-slot="2">
        <span><span class="weapon-key">[2]</span>USP .45</span>
        <span class="weapon-spd">250 u/s</span>
      </div>
      <div class="weapon-slot" data-slot="3">
        <span><span class="weapon-key">[3]</span>KNIFE</span>
        <span class="weapon-spd">250 u/s</span>
      </div>
    </div>

    <div id="speed-cluster">
      <div id="strafe-overlay">
        <div class="key-grid">
          <div></div>
          <div class="keycap warn-w" id="key-w">W</div>
          <div></div>
          <div class="keycap" id="key-a">A</div>
          <div class="keycap" id="key-s">S</div>
          <div class="keycap" id="key-d">D</div>
        </div>
        <div class="key-aux">
          <div class="keycap keycap-wide" id="key-jump">JUMP</div>
          <div class="keycap keycap-wide" id="key-duck">DUCK</div>
        </div>
        <div class="sync-box">
          <div class="sync-header">
            <span>STRAFE SYNC</span>
            <span id="sync-pct">0%</span>
          </div>
          <div class="sync-track"><div id="sync-bar"></div></div>
          <div class="yaw-meter">
            <div class="yaw-center"></div>
            <div id="yaw-pip"></div>
          </div>
        </div>
      </div>

      <div class="speed-card">
        <div class="speed-main-row">
          <span id="speed-xy">0</span>
          <span class="speed-unit">u/s</span>
          <span id="speed-gain"></span>
        </div>
        <div class="speed-sub-row">
          <span>3D <strong id="speed-3d">0</strong></span>
          <span>PEAK <strong id="speed-peak">0</strong></span>
          <span>Z <strong id="speed-z">0</strong></span>
        </div>
      </div>
    </div>

    <div id="net-graph">
      <div class="ng-row">
        <span>fps: <strong id="ng-fps">0</strong></span>
        <span>tick: <strong>100 Hz</strong></span>
      </div>
      <div class="ng-row">
        <span>sim: <strong id="ng-sim">0.00</strong> ms</span>
        <span class="ng-muted">lerp: 0.0ms (WASM ABI)</span>
      </div>
      <div class="ng-row">
        <span>state: <span id="ng-state" class="ng-gnd">GROUND</span></span>
        <span>hull: <strong id="ng-hull">72u</strong></span>
      </div>
      <div class="ng-row">
        <span>sync: <strong id="ng-sync">0%</strong></span>
        <span class="ng-muted" id="ng-cvars">aa:100 mv:3500</span>
      </div>
    </div>
  </div>

  <div id="menu-overlay">
    <div class="menu-shell">
      <div class="menu-header">
        <div>
          <div class="brand-title">
            <span class="brand-tag">PHASE 1 SANDBOX</span>
            <h1>CS 1.6 Surf — GoldSrc 100Hz Physics Core</h1>
          </div>
          <div class="menu-subtitle">
            Deterministic Float32 Linear Memory ABI • Swept AABB Convex Brushes • Procedural Dev-Grid Map
          </div>
        </div>
      </div>

      <div class="cta-row">
        <button id="btn-play" type="button">CLICK TO SURF (POINTER LOCK)</button>
        <button id="btn-restart-menu" type="button">RESET RUN [R]</button>
        <div id="lock-hint"></div>
      </div>

      <div class="tip-banner">
        <span class="tip-badge">SURF TIP</span>
        <span>
          Hold <strong>D</strong> on left-side ramps, <strong>A</strong> on right-side ramps, and <strong>never hold W in mid-air!</strong>
          Match your mouse yaw smoothly to the ramp angle to accelerate past 2500+ u/s. Turn left at spawn to test the 30°/46°/52°/60° calibration wedges &amp; 48u crouch tunnel.
        </span>
      </div>

      <div class="menu-grid">
        <div class="panel-box">
          <div class="panel-title">
            <span>Server Physics CVars</span>
            <span id="preset-indicator" style="color: #fbbf24;">DEFAULT</span>
          </div>

          <div class="preset-group">
            <button type="button" class="preset-btn active" id="preset-default">
              DEFAULT SURF
              <small>aa 100 • maxvel 3500</small>
            </button>
            <button type="button" class="preset-btn" id="preset-hardcore">
              HARDCORE PRESET
              <small>aa 150 • maxvel 4500</small>
            </button>
          </div>

          <div class="slider-row">
            <div class="slider-meta">
              <label for="sl-airaccel">sv_airaccelerate</label>
              <span class="slider-val" id="val-airaccel">100</span>
            </div>
            <input type="range" id="sl-airaccel" min="10" max="250" step="5" value="100" />
          </div>

          <div class="slider-row">
            <div class="slider-meta">
              <label for="sl-maxvel">sv_maxvelocity</label>
              <span class="slider-val" id="val-maxvel">3500</span>
            </div>
            <input type="range" id="sl-maxvel" min="1500" max="6000" step="100" value="3500" />
          </div>

          <div class="slider-row">
            <div class="slider-meta">
              <label for="sl-gravity">sv_gravity</label>
              <span class="slider-val" id="val-gravity">800</span>
            </div>
            <input type="range" id="sl-gravity" min="400" max="1200" step="20" value="800" />
          </div>

          <div class="slider-row">
            <div class="slider-meta">
              <label for="sl-sens">Mouse Sensitivity</label>
              <span class="slider-val" id="val-sens">1.80</span>
            </div>
            <input type="range" id="sl-sens" min="0.4" max="5.0" step="0.05" value="1.80" />
          </div>

          <div class="slider-row">
            <div class="slider-meta">
              <label for="sl-fov">Base FOV (Scales +22° at 3000+ u/s)</label>
              <span class="slider-val" id="val-fov">90°</span>
            </div>
            <input type="range" id="sl-fov" min="75" max="110" step="1" value="90" />
          </div>
        </div>

        <div class="panel-box">
          <div class="panel-title">
            <span>Movement, Weapon &amp; HUD Options</span>
          </div>

          <div class="toggle-list">
            <label class="toggle-row">
              <span>
                Auto-Bhop (Hold Space)
                <small>Jump immediately on ground touch (Mouse Wheel also jumps)</small>
              </span>
              <input type="checkbox" id="tg-autobhop" checked />
            </label>

            <label class="toggle-row">
              <span>
                Legacy Scout 260 u/s
                <small>CS 1.6 classic Scout base ground speed (260 vs 250 u/s)</small>
              </span>
              <input type="checkbox" id="tg-scout260" />
            </label>

            <label class="toggle-row">
              <span>
                Strafe Sync &amp; Keycap HUD
                <small>Live yaw-to-strafe efficiency percentage &amp; key overlay</small>
              </span>
              <input type="checkbox" id="tg-strafe" checked />
            </label>

            <label class="toggle-row">
              <span>
                Mapper Debug Wireframes [F2]
                <small>Show trigger volumes (start/end/push/tp) &amp; convex hulls</small>
              </span>
              <input type="checkbox" id="tg-debug" />
            </label>

            <label class="toggle-row">
              <span>
                Mute Procedural Audio
                <small>Wind rush, ramp slide hum, booster whoosh, landing thuds</small>
              </span>
              <input type="checkbox" id="tg-mute" />
            </label>
          </div>

          <div style="margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(148,163,184,0.12); font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: #94a3b8; line-height: 1.55;">
            Fixed Hulls: <span style="color:#e2e8f0;">32×32×72u</span> (stand) / <span style="color:#e2e8f0;">32×32×36u</span> (duck)<br/>
            Fixed Ground CVars: <span style="color:#e2e8f0;">accel=10 • fric=4 • stop=100 • edge=2</span>
          </div>
        </div>
      </div>

      <div class="hotkey-bar">
        <span class="hk"><kbd>W A S D</kbd> Move / Strafe</span>
        <span class="hk"><kbd>SPACE</kbd> / <kbd>WHEEL</kbd> Jump</span>
        <span class="hk"><kbd>CTRL</kbd> / <kbd>C</kbd> Duck (36u Hull)</span>
        <span class="hk"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> Weapons</span>
        <span class="hk"><kbd>R</kbd> Restart Run</span>
        <span class="hk"><kbd>F2</kbd> Debug Triggers</span>
        <span class="hk"><kbd>TAB</kbd> / <kbd>ESC</kbd> Menu</span>
      </div>
    </div>
  </div>

  <script type="module" src="/src/main.ts"></script>
</body>
</html>

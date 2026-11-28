implement new weapon: Throw a grenade by key 5; Using the existing explosion physics; and update the CONTEXT.md at the end.

```markdown
# CONTEXT.md — Browser CS 1.6 Surf & Source Physics Sandbox

## 1. Project Overview
A browser-based Counter-Strike 1.6 Surf & Source VPhysics sandbox built with **TypeScript** and **Three.js**. It pairs a deterministic **100 Hz (`FIXED_DT = 0.01`) GoldSrc/Source `CGameMovement` player controller** with a **Rapier-inspired TGS Soft + NGS rigid-body solver**, communicating across a zero-allocation `SharedArrayBuffer` / typed-array ABI (`PhysicsMemoryAbi`).

### Core Capabilities
- **Player Movement (`GoldSrcPhysicsEngine`):** Exact `f32`-quantized GoldSrc/Source movement math (`AirAccelerate`, `Accelerate`, `Friction`, `ClipVelocity`, multi-plane `PM_FlyMove` with crease cross-products, `StepMove`, crouch/uncrouch hull transitions, sub-tick midpoint yaw, and surf ramp-seam dead-stop recovery).
- **Rigid-Body & Subsystem Pipeline:** Substepped TGS Soft velocity solver, unbiased relaxation, NGS position projection, circular Coulomb + torsional patch friction, selective CCD sweeps, sleeping islands, articulated breakable ragdolls/joints, Verlet ropes, buoyancy/swimming, ladder climbing, Velocity-PID Gravity Gun, and 4-wheel raycast vehicles.
- **Rendering (`WorldRenderer`):** Three.js WebGL renderer translating Hammer Z-up coordinates to Three.js Y-up space, featuring BSP brush meshes, dynamic rigid-body/rope/vehicle/joint visual sync, viewmodel rig overlay, tracers/particles/decals, a spring-arm third-person vehicle chase camera, and deterministic zero-leak GPU resource disposal across map reloads.
- **Gameplay & UI:** Scout / USP .45 / Knife weapon system, hitscan + expanded melee traces, run timer with checkpoint splits and personal bests, strafe-sync telemetry HUD, and procedural Web Audio synthesizer (`SurfAudioEngine`).

---

## 2. Directory & File Structure

```text
src/
├── main.ts                          # Entry point: mounts canvas and initializes SurfApp
├── app/SurfApp.ts                   # Main loop (100 Hz fixed step + variable render), map switching, input/subsystem orchestration
├── core/
│   ├── constants.ts                 # FIXED_DT (0.01s), f32(), hull dims, SURF_NORMAL_Z, MoveState, bitflags
│   ├── coordinates.ts               # Hammer Z-up <-> Three.js Y-up conversion helpers (gsToThree) & angle vectors
│   └── memoryAbi.ts                 # PhysicsMemoryAbi (F32 & I32 typed-array offsets for zero-GC state sync)
├── physics/
│   ├── BrushBuilder.ts              # ConvexBrush & TriggerVolume builders, Minkowski planes, surf ramp generators
│   └── GoldSrcPhysicsEngine.ts      # 100 Hz CGameMovement + TGS Soft/NGS rigid bodies, joints, ropes, water, ladders, vehicles
├── maps/
│   ├── mapRegistry.ts               # Map registry (MapId union, metadata, build() factory lookup)
│   ├── surfSandbox01.ts             # Base surf sandbox map & MapBuildResult / WorldSign interfaces
│   ├── surfSandbox02.ts             # Additional surf/skill course map
│   ├── surfSandbox03.ts             # Additional surf/skill course map
│   └── surfSandbox04.ts             # Full subsystem proving ground (4 bays: Props/Water, Ragdolls/Joints, 4WD Buggy, Ladders/52° Surf)
├── gameplay/
│   ├── InputController.ts           # Pointer lock, WASD/jump/duck/use key state, scroll-wheel bhop, mouse yaw/pitch
│   ├── WeaponSystem.ts              # Slot 1 (Scout), Slot 2 (USP .45), Slot 3 (Knife), recoil, reload, drop/pickup
│   ├── RunTracker.ts                # Start/checkpoint/finish tick timer, segment deltas, gold splits, PB tracking
│   └── StrafeSyncTracker.ts         # Rolling air-strafe sync percentage calculator (yaw delta vs A/D input)
├── render/
│   ├── WorldRenderer.ts             # Three.js scene, Z-up -> Y-up mapping, brush/prop/rope/vehicle sync, chase cam, zero-leak dispose()
│   ├── textures.ts                  # Procedural CanvasTexture generators (dev grids, water, boosters, hazard planes)
│   └── ViewmodelRig.ts              # First-person weapon viewmodel animation (bob, strafe tilt, mouse sway, recoil)
├── audio/
│   └── SurfAudioEngine.ts           # Procedural Web Audio API sound effects (surf wind, jumps, impacts, explosions, weapons)
├── styles/
│   └── sandbox.css                  # HUD, crosshair, scope overlay, and pause/settings menu styling
└── ui/
    ├── HudController.ts             # Speedometer, velocity Z, strafe sync, subsystem telemetry, interact prompts, toasts
    ├── CombatHudOverlay.ts          # Crosshair, dynamic spread, hitmarkers (normal/blood/kill), HP & blood vitals
    └── MenuController.ts            # Pause/settings overlay (map select, sensitivity, FOV, airaccel/maxvel cvars, debug)

```

---

## 3. Critical Architectural Rules & Invariants (Read Before Editing)

### A. Coordinate System & Euler Angles

1. **Physics & Maps = Hammer Z-Up Right-Handed:**
* `+X` = East (default spawn yaw `0`), `+Y` = North (`yaw = +π/2`), `+Z` = Up.
* `computeAngleVectors(sourcePitch, yaw, roll)` follows Source convention where **positive `sourcePitch` looks downward**. When converting from `InputController.viewPitch` (where positive looks upward), always negate pitch: `computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0)`.


2. **Three.js Renderer = Y-Up:**
* All Hammer-to-Three.js axis swaps stay encapsulated inside `WorldRenderer`. Never mix Three.js Y-up coordinates into `GoldSrcPhysicsEngine`, `SurfApp`, or map files.



### B. Deterministic `f32` Math & Memory ABI

* All player physics state lives in `PhysicsMemoryAbi` (`this.abi.f32` and `this.abi.i32`) indexed by `F32.*` and `I32.*` enums.
* Wrap velocity and position writes in `f32(...)` (`Math.fround`) inside `GoldSrcPhysicsEngine` to preserve single-precision determinism across snapshots (`capturePlayerSnapshot` / `restorePlayerSnapshot`).
* Keep hot-path sweeps allocation-free by reusing `traceScratch`, `bodyTraceScratch`, `auxTraceScratch`, and `StaticBrushBvh` scratch buffers.

### C. Subsystems & Dual-State Synchronization

* **Vehicle Driving:** `SurfApp.drivingVehicleId` and `GoldSrcPhysicsEngine.drivenVehicleId` **must always be updated together** via `enterVehicle()` / `exitVehicle()`. When `drivenVehicleId` is active, `GoldSrcPhysicsEngine.simulateTick()` skips standard player hull movement and pins `POS_X/Y/Z` to `chassis.pos + chassisUp * 36`.
* **Player Shadow Authority:** `resolvePlayerShadowCollisions(playerIsSurfing)` enforces one-way momentum when `playerIsSurfing === true` so rigid bodies never corrupt player speed on surf ramps.
* **Gravity Gun PID:** Uses velocity-level PID (`stepGravityGunPid`) rather than hard position snapping so held props still collide with world brushes.

### D. Renderer Lifecycle & Zero-Leak Map Switching (`WorldRenderer.dispose`)

* `SurfApp.loadMap()` calls `this.renderer?.dispose?.()` before constructing a new `WorldRenderer` against the existing `<canvas>`.
* `WorldRenderer.dispose()` is idempotent (`this.disposed` guard) and must always:
1. Remove the `window` `'resize'` listener (`handleResize`).
2. Detach `vmRoot` from `vmScene` (`this.vmScene.remove(this.vmRoot)`) **without** disposing `vmRoot`'s geometries/materials, because `ViewmodelRig` persists across map loads.
3. Deduplicate and dispose every `BufferGeometry`, `Material`, and attached `CanvasTexture` map (`map`, `emissiveMap`, `normalMap`, etc.) across both `this.scene` and `this.sharedMaterials` (covering brush styles or prop materials unused on the current map, `WorldSign` textures, and `makeHazardTexture()`).
4. Clear dynamic entity maps (`rigidBodyMeshes`, `ropeLines`, `vehicleVisuals`), active FX arrays (`explosionEffects`, `tracerEffects`, `particleEffects`, `decals`), `this.scene`, `this.renderer.renderLists`, and call `this.renderer.dispose()`.
5. **Never call `this.renderer.forceContextLoss()**`, so the shared `<canvas>` element can immediately initialize a fresh `THREE.WebGLRenderer` for the next map.



### E. Hotkey & Input Conventions

* `1 / 2 / 3`: Weapon slots (Scout, USP .45, Knife); `4`: Toggle Gravity Gun (Physics Gun); `Q`: Quick-switch.
* `E`: Context-sensitive interact (`exitVehicle` -> `releaseHeldBody` -> `enterVehicle` -> `tryPickupLookedWeapon` -> `tryGrabRigidBody`).
* `C` (while driving): Toggle 3rd-person chase camera vs. cockpit camera.
* `B / C / V` (on foot): Stage checkpoint respawn / save practice checkpoint / load practice checkpoint.
* `T / F / X`: Spawn crate / detonate test blast / reset props & subsystems.
* `R`: Reload weapon (or exit vehicle if driving; full reset if holding Knife or dead).

---

## 4. Coding Conventions for AI Assistants

* **TypeScript Strictness:** Maintain explicit interfaces for subsystem configs (`SourceRigidBody`, `SourceJoint`, `SourceRope`, `WaterVolume`, `SourceVehicle`, `LadderVolume`).
* **Complete File Outputs:** When modifying core files (`GoldSrcPhysicsEngine.ts`, `SurfApp.ts`, `WorldRenderer.ts`), preserve existing public APIs, telemetry hooks (`SubsystemTelemetry`, `PhysicsCallbacks`), and map factory signatures (`ExtendedMapBuildResult`).
* **Frame-Rate Independence:** Simulation logic runs strictly inside `SurfApp.stepPhysicsTick()` at `100 Hz` (`FIXED_DT = 0.01`). Camera smoothing, viewmodel sway, and visual interpolation belong in `SurfApp.frame()` / `WorldRenderer.update()` using exponential smoothing `1 - Math.exp(-rate * frameDt)`.

```

<FollowUp label="Want me to add the exact F32/I32 ABI memory offsets and physics constants to CONTEXT.md?" query="Inspect constants.ts and memoryAbi.ts or expand CONTEXT.md with the exact F32/I32 ABI memory offsets and physics tuning constants."/>

```

GoldSrcPhysicsEngine.ts//

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
interface WaterTriggerMeta {
  water?: boolean;
  surfaceZ?: number;
  density?: number;
  linearDrag?: number;
  angularDrag?: number;
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

export interface LadderVolume {
  id: string;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** Outward unit normal pointing away from the ladder face toward the climber */
  normalX: number;
  normalY: number;
  normalZ?: number;
  climbSpeed?: number;
}

export interface RagdollBundle {
  bodies: SourceRigidBody[];
  joints: SourceJoint[];
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

/**
 * 6-segment articulated ragdoll (pelvis, torso, head, L/R arms, L/R legs)
 * linked via ball/hinge joints with breakable impulse thresholds.
 */
export function createArticulatedRagdoll(
  idPrefix: string,
  footOrigin: Vec3,
  opts: { breakForce?: number; massScale?: number } = {},
): RagdollBundle {
  const m = opts.massScale ?? 1.0;
  const bf = opts.breakForce ?? 3200;
  const x = footOrigin.x;
  const y = footOrigin.y;
  const z = footOrigin.z;

  const legL = createBoxRigidBody(
    `${idPrefix}_leg_l`,
    { x, y: y + 7, z: z + 17 },
    { x: 5.5, y: 5.5, z: 16 },
    12 * m,
    { kind: 'target', hp: 90, bleeds: true, restitution: 0.15, surfaceFriction: 1.4 },
  );
  const legR = createBoxRigidBody(
    `${idPrefix}_leg_r`,
    { x, y: y - 7, z: z + 17 },
    { x: 5.5, y: 5.5, z: 16 },
    12 * m,
    { kind: 'target', hp: 90, bleeds: true, restitution: 0.15, surfaceFriction: 1.4 },
  );
  const torso = createBoxRigidBody(
    `${idPrefix}_torso`,
    { x, y, z: z + 47 },
    { x: 9, y: 12, z: 14 },
    28 * m,
    { kind: 'target', hp: 140, bleeds: true, restitution: 0.18, surfaceFriction: 1.35 },
  );
  const head = createBoxRigidBody(
    `${idPrefix}_head`,
    { x, y, z: z + 69 },
    { x: 7, y: 7, z: 7.5 },
    6 * m,
    { kind: 'target', hp: 60, bleeds: true, restitution: 0.22, surfaceFriction: 1.2 },
  );
  const armL = createBoxRigidBody(
    `${idPrefix}_arm_l`,
    { x, y: y + 18, z: z + 48 },
    { x: 4.5, y: 4.5, z: 13 },
    6 * m,
    { kind: 'target', hp: 70, bleeds: true, restitution: 0.15, surfaceFriction: 1.3 },
  );
  const armR = createBoxRigidBody(
    `${idPrefix}_arm_r`,
    { x, y: y - 18, z: z + 48 },
    { x: 4.5, y: 4.5, z: 13 },
    6 * m,
    { kind: 'target', hp: 70, bleeds: true, restitution: 0.15, surfaceFriction: 1.3 },
  );

  const joints: SourceJoint[] = [
    {
      id: `${idPrefix}_jt_neck`,
      kind: 'ball',
      bodyAId: torso.id,
      bodyBId: head.id,
      localAnchorA: { x: 0, y: 0, z: 14.5 },
      localAnchorB: { x: 0, y: 0, z: -7.5 },
      frequencyHz: 22,
      dampingRatio: 1.0,
      breakForce: bf * 0.75,
    },
    {
      id: `${idPrefix}_jt_hip_l`,
      kind: 'hinge',
      bodyAId: torso.id,
      bodyBId: legL.id,
      localAnchorA: { x: 0, y: 7, z: -14 },
      localAnchorB: { x: 0, y: 0, z: 16 },
      localAxisA: { x: 0, y: 1, z: 0 },
      localAxisB: { x: 0, y: 1, z: 0 },
      frequencyHz: 24,
      dampingRatio: 1.0,
      breakForce: bf,
    },
    {
      id: `${idPrefix}_jt_hip_r`,
      kind: 'hinge',
      bodyAId: torso.id,
      bodyBId: legR.id,
      localAnchorA: { x: 0, y: -7, z: -14 },
      localAnchorB: { x: 0, y: 0, z: 16 },
      localAxisA: { x: 0, y: 1, z: 0 },
      localAxisB: { x: 0, y: 1, z: 0 },
      frequencyHz: 24,
      dampingRatio: 1.0,
      breakForce: bf,
    },
    {
      id: `${idPrefix}_jt_shoulder_l`,
      kind: 'ball',
      bodyAId: torso.id,
      bodyBId: armL.id,
      localAnchorA: { x: 0, y: 13, z: 10 },
      localAnchorB: { x: 0, y: -4.5, z: 10 },
      frequencyHz: 20,
      dampingRatio: 1.0,
      breakForce: bf * 0.8,
    },
    {
      id: `${idPrefix}_jt_shoulder_r`,
      kind: 'ball',
      bodyAId: torso.id,
      bodyBId: armR.id,
      localAnchorA: { x: 0, y: -13, z: 10 },
      localAnchorB: { x: 0, y: 4.5, z: 10 },
      frequencyHz: 20,
      dampingRatio: 1.0,
      breakForce: bf * 0.8,
    },
  ];

  return { bodies: [legL, legR, torso, head, armL, armR], joints };
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
  // src/physics/GoldSrcPhysicsEngine.ts — add field & setter:
  private drivenVehicleId: string | null = null;

  public setDrivenVehicle(vehicleId: string | null): void {
    this.drivenVehicleId = vehicleId;
    if (vehicleId) {
      const veh = this.vehicles.find((v) => v.id === vehicleId);
      if (veh) this.wakeBodyById(veh.chassisId);
    }
  }
  public getDrivenVehicleId(): string | null {
      return this.drivenVehicleId;
    }

  // Add to class fields:
    private readonly ladders: LadderVolume[] = [];
    private activeLadder: LadderVolume | null = null;
    private ladderDetachUntilTick = 0;

    // Add to public subsystem APIs:
    public addLadder(ladder: LadderVolume): void {
      this.ladders.push(ladder);
    }

    public clearLadders(): void {
      this.ladders.length = 0;
      this.activeLadder = null;
    }

    public getLadders(): readonly LadderVolume[] {
      return this.ladders;
    }

    public getActiveLadder(): Readonly<LadderVolume> | null {
      return this.activeLadder;
    }

    public getPlayerWaterSubmersion(): number {
      return this.playerWaterSubmersion;
    }

    /** Detect overlap with any registered LadderVolume */
    private findTouchingLadder(): LadderVolume | null {
      const { f32: vf, i32: vi } = this.abi;
      if (vi[I32.TICK] < this.ladderDetachUntilTick) return null;
      const hz = this.getHullHalfZ();
      const px = vf[F32.POS_X];
      const py = vf[F32.POS_Y];
      const pz = vf[F32.POS_Z];
      const pad = 4.0;

      for (let i = 0; i < this.ladders.length; i++) {
        const l = this.ladders[i];
        if (
          px + HULL_STAND.hx + pad < l.minX ||
          px - HULL_STAND.hx - pad > l.maxX ||
          py + HULL_STAND.hy + pad < l.minY ||
          py - HULL_STAND.hy - pad > l.maxY ||
          pz + hz < l.minZ ||
          pz - hz > l.maxZ
        ) {
          continue;
        }
        return l;
      }
      return null;
    }

    /**
     * Authentic GoldSrc/Source PM_LadderMove:
     * Projects look-space forward/side speed onto the ladder plane so looking up + W
     * climbs upward and diagonal W+A/D fast-climbs at sqrt(2) * climbSpeed.
     */
    private ladderMove(
      ladder: LadderVolume,
      forward: Vec3,
      right: Vec3,
      fmove: number,
      smove: number,
    ): void {
      const vf = this.abi.f32;
      const climbMax = ladder.climbSpeed ?? 200;
      const fSpeed = Math.max(-climbMax, Math.min(climbMax, fmove));
      const sSpeed = Math.max(-climbMax, Math.min(climbMax, smove));

      if (Math.abs(fSpeed) < 1e-3 && Math.abs(sSpeed) < 1e-3) {
        vf[F32.VEL_X] = f32(0);
        vf[F32.VEL_Y] = f32(0);
        vf[F32.VEL_Z] = f32(0);
        return;
      }

      const vx = f32(forward.x * fSpeed + right.x * sSpeed);
      const vy = f32(forward.y * fSpeed + right.y * sSpeed);
      const vz = f32(forward.z * fSpeed + right.z * sSpeed);

      const nx = ladder.normalX;
      const ny = ladder.normalY;
      const nz = ladder.normalZ ?? 0;

      // perp = normalize(up x ladderNormal)
      let px = -ny;
      let py = nx;
      const pLen = Math.hypot(px, py) || 1;
      px /= pLen;
      py /= pLen;

      const normalDot = vx * nx + vy * ny + vz * nz;
      const latX = vx - nx * normalDot;
      const latY = vy - ny * normalDot;
      const latZ = vz - nz * normalDot;

      // tmp = ladderNormal x perp -> points along ladder up-axis
      const upX = ny * 0 - nz * py;
      const upY = nz * px - nx * 0;
      const upZ = nx * py - ny * px;

      // Pull gently toward ladder face if climbing so player tracks cleanly to the top lip
      const stick = normalDot < 0 ? -12 : 0;
          vf[F32.VEL_X] = f32(latX - upX * normalDot + nx * stick);
          vf[F32.VEL_Y] = f32(latY - upY * normalDot + ny * stick);
          vf[F32.VEL_Z] = f32(latZ - upZ * normalDot + nz * stick);

      this.checkVelocity();
      this.flyMove();
  }

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
      fallDamageThreshold: sourceConfig.fallDamageThreshold ?? 950,
      fallDamageScale: sourceConfig.fallDamageScale ?? 0.045,
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
    // Auto-register any trigger volumes tagged as water
        for (let i = 0; i < triggers.length; i++) {
          const t = triggers[i];
          const meta = t.meta as WaterTriggerMeta | undefined;
          if ((t.type as string) === 'water' || meta?.water === true) {
            this.waterVolumes.push({
              id: t.id,
              minX: t.minX,
              minY: t.minY,
              minZ: t.minZ,
              maxX: t.maxX,
              maxY: t.maxY,
              maxZ: t.maxZ,
              surfaceZ: meta?.surfaceZ ?? t.maxZ,
              density: meta?.density ?? 1.0,
              linearDrag: meta?.linearDrag ?? 2.2,
              angularDrag: meta?.angularDrag ?? 2.6,
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
    // Driving mode: step vehicles/props without player hull colliding against chassis
        if (this.drivenVehicleId) {
          this.stepSecondaryPhysics(false, false);
          const veh = this.vehicles.find((v) => v.id === this.drivenVehicleId);
          const chassis = veh ? this.findBodyById(veh.chassisId) : null;
          if (chassis) {
            const rot = quatToMat3(chassis.quat);
            const up = { x: rot[2], y: rot[5], z: rot[8] };
            vf[F32.POS_X] = f32(chassis.pos.x + up.x * 36);
            vf[F32.POS_Y] = f32(chassis.pos.y + up.y * 36);
            vf[F32.POS_Z] = f32(chassis.pos.z + up.z * 36);
            vf[F32.VEL_X] = chassis.vel.x;
            vf[F32.VEL_Y] = chassis.vel.y;
            vf[F32.VEL_Z] = chassis.vel.z;
            vi[I32.FLAGS] |= FL_ONGROUND;
            vi[I32.MOVESTATE] = MoveState.GROUND;
          } else {
            this.drivenVehicleId = null;
          }
          this.checkTriggers();
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

    // 2b. Check ladder engagement before jump & gravity
    // 2b. Check ladder engagement before jump & gravity
        const touchingLadder = this.findTouchingLadder();
        this.activeLadder = null;

    if (touchingLadder) {
      const buttons = vi[I32.BUTTONS];
            const prevButtons = vi[I32.PREV_BUTTONS];
            const freshJump = (buttons & IN_JUMP) !== 0 && (prevButtons & IN_JUMP) === 0;

            if (freshJump) {
              // Classic Source/GoldSrc jump-off away from ladder normal
              this.activeLadder = null;
              this.ladderDetachUntilTick = vi[I32.TICK] + 18;
              vi[I32.FLAGS] &= ~FL_ONGROUND;
              vf[F32.VEL_X] = f32(touchingLadder.normalX * 270);
              vf[F32.VEL_Y] = f32(touchingLadder.normalY * 270);
              vf[F32.VEL_Z] = f32(Math.max(vf[F32.VEL_Z], 185));
              this.callbacks.onJump?.();
            } else {
              vi[I32.FLAGS] &= ~FL_ONGROUND;
              vi[I32.MOVESTATE] = MoveState.LADDER;
              const { forward, right } = computeAngleVectors(-vf[F32.CMD_PITCH], vf[F32.CMD_YAW], 0);
              this.ladderMove(touchingLadder, forward, right, vf[F32.CMD_FMOVE], vf[F32.CMD_SMOVE]);
              this.stepSecondaryPhysics(true, false);
              this.checkTriggers();
              vi[I32.PREV_BUTTONS] = buttons;
              return;
            }
        }
    // 3. CheckJumpButton: v_z = sqrt(2 * g * h_jump), h_jump = 45u (CS:S / GoldSrc)
    const buttons = vi[I32.BUTTONS];
        const prevButtons = vi[I32.PREV_BUTTONS];
        const autoBhop = vi[I32.AUTOBHOP] === 1;
        const jumpPressed = (buttons & IN_JUMP) !== 0;
        const duckPressed = (buttons & IN_DUCK) !== 0;
        const freshJump = jumpPressed && (autoBhop || (prevButtons & IN_JUMP) === 0);

        if (inWater) {
          if (jumpPressed) {
            vi[I32.FLAGS] &= ~FL_ONGROUND;
            // Give an extra water-jump boost near the surface so player can hop onto the pool rim
            const nearSurface = this.playerWaterSubmersion < 0.68;
            vf[F32.VEL_Z] = f32(Math.max(vf[F32.VEL_Z], nearSurface ? 275.0 : 185.0));
          } else if (duckPressed) {
            vi[I32.FLAGS] &= ~FL_ONGROUND;
            vf[F32.VEL_Z] = f32(Math.min(vf[F32.VEL_Z], -150.0));
          }
        } else if (freshJump && (vi[I32.FLAGS] & FL_ONGROUND)) {
          vi[I32.FLAGS] &= ~FL_ONGROUND;
          vf[F32.VEL_Z] = f32(Math.sqrt(2.0 * gravity * 45.0));
          this.callbacks.onJump?.();
        }

        // 4. StartGravity (skip gravity in water — buoyancy is solved inside waterMove)
        const isGroundedNow = (vi[I32.FLAGS] & FL_ONGROUND) !== 0;
        if (!isGroundedNow && !inWater) {
          this.applyHalfGravity(gravity, 1.0);
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

    // 7. FinishGravity (preserve upward swimming velocity in water)
        this.categorizePosition();
        const landedNow = (vi[I32.FLAGS] & FL_ONGROUND) !== 0 && !(inWater && vf[F32.VEL_Z] > 5);
        if (inWater && vf[F32.VEL_Z] > 5) {
          vi[I32.FLAGS] &= ~FL_ONGROUND;
        }

        if (!landedNow) {
          if (!inWater) this.applyHalfGravity(gravity, 1.0);
        } else {
          vf[F32.VEL_Z] = f32(0);
          if (!wasOnGround && !inWater && preVelZ < -140) {
            const impact = Math.abs(preVelZ);
            this.callbacks.onLand?.(impact);
            if (impact > this.sourceConfig.fallDamageThreshold) {
              const rawDmg =
                (impact - this.sourceConfig.fallDamageThreshold) * this.sourceConfig.fallDamageScale;
              this.damagePlayer(Math.min(35, rawDmg), 'fall');
            }
          }
        }

    // 8. Determine telemetry state (GROUND / SURF / AIR) before player-shadow push check
    const isSurfing =
      !landedNow &&
      ((flyBlocked & 4) !== 0 || (vf[F32.SURF_NZ] > 0.05 && vf[F32.SURF_NZ] < SURF_NORMAL_Z));

    if (inWater) {
          vi[I32.MOVESTATE] = MoveState.WATER;
        } else if (landedNow) {
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
      // Inside stepRigidBodiesTgsSoft() step 5, right next to the gravityGun check:
        const isDrivenChassis =
          this.drivenVehicleId !== null &&
          this.vehicles.some((v) => v.id === this.drivenVehicleId && v.chassisId === b.id);
        if (this.gravityGun.heldBodyId === b.id || isDrivenChassis) {
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
  /** Integrate a single body over subDt with selective CCD and 2-pass surface sliding */
    private integrateRigidBodyWorldPose(b: SourceRigidBody, subDt: number): void {
      const tr = this.bodyTraceScratch;
      const minExtent = Math.min(b.hx, b.hy, b.hz);
      const maxRadius = Math.hypot(b.hx, b.hy, b.hz);
      const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
      const angSpeed = Math.hypot(b.angVel.x, b.angVel.y, b.angVel.z);
      const maxDisp = speed * subDt + maxRadius * angSpeed * subDt;

      const ccdSteps =
        b.enableCcd !== false && minExtent > 0.5 && maxDisp > minExtent * 0.5
          ? Math.min(4, Math.ceil(maxDisp / (minExtent * 0.5)))
          : 1;
      const stepDt = f32(subDt / ccdSteps);

      for (let k = 0; k < ccdSteps; k++) {
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

        // 2-pass slide loop so resting/scraping bodies still move horizontally
        let remDt = stepDt;
        for (let bump = 0; bump < 2 && remDt > 1e-6; bump++) {
          const targetX = f32(b.pos.x + b.vel.x * remDt);
          const targetY = f32(b.pos.y + b.vel.y * remDt);
          const targetZ = f32(b.pos.z + b.vel.z * remDt);

          this.traceWorld(b.pos.x, b.pos.y, b.pos.z, targetX, targetY, targetZ, b.hx, b.hy, b.hz, tr);

          if (tr.startSolid || tr.allSolid) {
            b.pos.z = f32(b.pos.z + 2.0);
            if (b.vel.z < 0) b.vel.z = f32(0);
            break;
          }

          b.pos.x = tr.endX;
          b.pos.y = tr.endY;
          b.pos.z = tr.endZ;

          if (tr.fraction >= 1.0) break;
          remDt = f32(remDt * (1.0 - tr.fraction));

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

            // Skip ground-belly friction on vehicle chassis (tires handle traction)
            if (b.kind !== 'vehicle') {
              const mu = b.surfaceFriction ?? this.sourceConfig.surfaceFriction;
              const postVn = b.vel.x * nx + b.vel.y * ny + b.vel.z * nz;
              const vtX = f32(b.vel.x - nx * postVn);
              const vtY = f32(b.vel.y - ny * postVn);
              const vtZ = f32(b.vel.z - nz * postVn);
              const vtLen = Math.hypot(vtX, vtY, vtZ);
              if (vtLen > 1e-4) {
                const maxFrictionDv = f32((mu * Math.abs(jn)) / b.mass);
                const drop = Math.min(vtLen, maxFrictionDv);
                const scale = f32((vtLen - drop) / vtLen);
                b.vel.x = f32(b.vel.x - vtX * (1 - scale));
                b.vel.y = f32(b.vel.y - vtY * (1 - scale));
                b.vel.z = f32(b.vel.z - vtZ * (1 - scale));

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
            }

            const wTwist = f32(b.angVel.x * nx + b.angVel.y * ny + b.angVel.z * nz);
            const twistDamp = f32(Math.max(0, 1 - 0.16 * (b.surfaceFriction ?? 1.0)));
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
      const gravity = vf[F32.CVAR_GRAVITY];
      const sub = this.playerWaterSubmersion;

      // Implicit water drag
      const drag = f32(1 / (1 + 2.6 * FIXED_DT));
      vf[F32.VEL_X] = f32(vf[F32.VEL_X] * drag);
      vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] * drag);
      vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] * drag);

      // Self-stabilizing player buoyancy: gently floats with head above water (~0.62 submersion)
      const neutralSub = 0.62;
      const buoyAccel = (sub - neutralSub) * gravity * 1.45;
      vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] + buoyAccel * FIXED_DT);

      const wishX = f32(fmove * forward.x + smove * right.x);
      const wishY = f32(fmove * forward.y + smove * right.y);
      const wishZ = f32(fmove * forward.z + smove * right.z);
      const wishMag = f32(Math.hypot(wishX, wishY, wishZ));
      const wishspeed = f32(Math.min(wishMag, maxSpeed * 0.85));

      if (wishMag > 1e-5) {
        if (wishZ > 0.15) {
          this.abi.i32[I32.FLAGS] &= ~FL_ONGROUND;
        }
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
                const comp = f32(
                  Math.max(0, Math.min(wheel.restLength, wheel.restLength - (hitDist - wheel.radius))),
                );
                wheel.compression = comp;
                wheel.contactPoint = { x: tr.endX, y: tr.endY, z: tr.endZ };
                wheel.contactNormal = { x: tr.normalX, y: tr.normalY, z: tr.normalZ };

                // 1. Hookean Spring-Damper Suspension (clamped >= 0 so rebound never pulls car down)
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

                const vLong = dotVec3(patchVel, wf);
                const vLat = dotVec3(patchVel, wr);
                wheel.spinAngle = f32(wheel.spinAngle + (vLong / Math.max(1, wheel.radius)) * FIXED_DT);

                const muGrip = wheel.grip * (veh.handbrake > 0.5 && !wheel.steerable ? 0.35 : 1.0);
                const maxTireImpulse = f32(Math.max(suspImpulse, 320) * muGrip);

                let driveImpulse = wheel.driven ? f32(veh.throttle * veh.engineForce * FIXED_DT) : 0;
                if (Math.abs(veh.throttle) < 0.05 && veh.handbrake < 0.1) {
                  // Gentle rolling resistance when coasting
                  driveImpulse = f32(-vLong * chassis.mass * 0.015);
                }
                if (veh.handbrake > 0.1) {
                  const stopImpulse = f32((-vLong * chassis.mass) / Math.max(1, veh.wheels.length));
                  const maxBrake = f32(veh.handbrake * veh.brakeForce * FIXED_DT);
                  driveImpulse = f32(driveImpulse + Math.max(-maxBrake, Math.min(maxBrake, stopImpulse)));
                }

                const latImpulseRaw = f32(-vLat * chassis.mass * 0.22);
                const tireMag = Math.hypot(driveImpulse, latImpulseRaw);
                let jLong = driveImpulse;
                let jLat = latImpulseRaw;
                if (tireMag > maxTireImpulse && tireMag > 1e-6) {
                  const s = maxTireImpulse / tireMag;
                  jLong = f32(jLong * s);
                  jLat = f32(jLat * s);
                }

                const suspVec: Vec3 = {
                  x: f32(tr.normalX * suspImpulse),
                  y: f32(tr.normalY * suspImpulse),
                  z: f32(tr.normalZ * suspImpulse),
                };
                const tireVec: Vec3 = {
                  x: f32(wf.x * jLong + wr.x * jLat),
                  y: f32(wf.y * jLong + wr.y * jLat),
                  z: f32(wf.z * jLong + wr.z * jLat),
                };

                chassis.vel.x = f32(chassis.vel.x + (suspVec.x + tireVec.x) * invMass);
                chassis.vel.y = f32(chassis.vel.y + (suspVec.y + tireVec.y) * invMass);
                chassis.vel.z = f32(chassis.vel.z + (suspVec.z + tireVec.z) * invMass);

                // Apply tire force at reduced vertical lever arm to prevent rear bumper squat
                const rTire: Vec3 = { x: rC.x, y: rC.y, z: f32(rC.z * 0.25) };
                const torque = {
                  x: f32(crossVec3(rC, suspVec).x + crossVec3(rTire, tireVec).x),
                  y: f32(crossVec3(rC, suspVec).y + crossVec3(rTire, tireVec).y),
                  z: f32(crossVec3(rC, suspVec).z + crossVec3(rTire, tireVec).z),
                };
                const dOmega = mulMat3Vec3(invInertia, torque);
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

//InputController.ts
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

//WeaponSystem.ts 
// src/gameplay/WeaponSystem.ts
import { f32 } from '../core/constants';
import { F32, I32, PhysicsMemoryAbi } from '../core/memoryAbi';
import {
  computeAngleVectors,
  createWeaponRigidBody,
  GoldSrcPhysicsEngine,
  SourceRigidBody,
  Vec3,
  WeaponSlot,
} from '../physics/GoldSrcPhysicsEngine';
import { SurfAudioEngine } from '../audio/SurfAudioEngine';
import { ViewmodelRig } from '../render/ViewmodelRig';
import { WorldRenderer } from '../render/WorldRenderer';
import { InputController } from './InputController';

export interface GunSlotState {
  owned: boolean;
  clip: number;
  clipMax: number;
  reserve: number;
  silenced?: boolean;
}

export interface WeaponHudSnapshot {
  activeSlot: WeaponSlot;
  scout: GunSlotState;
  usp: GunSlotState;
  knifeOwned: boolean;
  reloading: boolean;
  reloadProgress: number;
  scopeZoom: 0 | 1 | 2;
  nearbyPickupLabel: string | null;
}

export interface WeaponSystemCallbacks {
  onToast?: (msg: string, color: string) => void;
  onHitMarker?: (isBlood: boolean, isKill: boolean) => void;
  onActiveSlotChanged?: (slot: WeaponSlot) => void;
}

export class WeaponSystem {
  private readonly abi: PhysicsMemoryAbi;
  private readonly physics: GoldSrcPhysicsEngine;
  private readonly audio: SurfAudioEngine;
  private readonly viewmodel: ViewmodelRig;
  private readonly renderer: WorldRenderer;
  private readonly input: InputController;
  private readonly callbacks: WeaponSystemCallbacks;

  private activeSlot: WeaponSlot = 1;
  private lastSlot: WeaponSlot = 3;
  private scopeZoom: 0 | 1 | 2 = 0;

  private readonly scout: GunSlotState = {
    owned: true,
    clip: 10,
    clipMax: 10,
    reserve: 90,
  };

  private readonly usp: GunSlotState = {
    owned: true,
    clip: 12,
    clipMax: 12,
    reserve: 100,
    silenced: true,
  };

  private nextPrimaryAt = 0;
  private nextSecondaryAt = 0;
  private reloadEndsAt = 0;
  private reloadDuration = 1.15;
  private reloadingSlot: 1 | 2 | null = null;
  private droppedCounter = 0;
  private nearbyWeapon: SourceRigidBody | null = null;

  constructor(
    abi: PhysicsMemoryAbi,
    physics: GoldSrcPhysicsEngine,
    audio: SurfAudioEngine,
    viewmodel: ViewmodelRig,
    renderer: WorldRenderer,
    input: InputController,
    callbacks: WeaponSystemCallbacks = {},
  ) {
    this.abi = abi;
    this.physics = physics;
    this.audio = audio;
    this.viewmodel = viewmodel;
    this.renderer = renderer;
    this.input = input;
    this.callbacks = callbacks;

    this.viewmodel.setUspSilenced(Boolean(this.usp.silenced));
    this.selectSlot(1, true);
  }

  public getActiveSlot(): WeaponSlot {
    return this.activeSlot;
  }

  public getMoveSpeed(): number {
    if (this.activeSlot === 1) {
      if (this.scopeZoom > 0) return f32(220.0);
      return this.abi.i32[I32.LEGACY_SCOUT] === 1 ? f32(260.0) : f32(250.0);
    }
    return f32(250.0);
  }

  public resetLoadout(): void {
    this.scout.owned = true;
    this.scout.clip = this.scout.clipMax;
    this.scout.reserve = 90;

    this.usp.owned = true;
    this.usp.clip = this.usp.clipMax;
    this.usp.reserve = 100;
    this.usp.silenced = true;

    this.cancelReload();
    this.setScopeZoom(0);
    this.viewmodel.setUspSilenced(true);
    this.selectSlot(1, true);
  }

  public selectSlot(slot: number, silent = false): boolean {
    if (slot !== 1 && slot !== 2 && slot !== 3) return false;
    if (slot === 1 && !this.scout.owned) {
      if (!silent) this.callbacks.onToast?.('NO PRIMARY WEAPON (Pick up a Scout)', 'rgba(148,163,184,0.75)');
      return false;
    }
    if (slot === 2 && !this.usp.owned) {
      if (!silent) this.callbacks.onToast?.('NO SECONDARY WEAPON (Pick up a USP .45)', 'rgba(148,163,184,0.75)');
      return false;
    }
    if (slot === this.activeSlot && !silent) return true;

    if (this.activeSlot !== slot) {
      this.lastSlot = this.activeSlot;
    }

    this.cancelReload();
    this.setScopeZoom(0);
    this.activeSlot = slot;
    this.abi.i32[I32.WEAPON] = slot;

    this.viewmodel.setActiveSlot(slot);
    this.viewmodel.triggerDeploy();
    if (!silent) {
      this.audio.playWeaponSwitch();
    }
    this.callbacks.onActiveSlotChanged?.(slot);
    return true;
  }

  public quickSwitch(): void {
    if (this.selectSlot(this.lastSlot)) return;
    if (this.activeSlot !== 3) {
      this.selectSlot(3);
    } else if (this.scout.owned) {
      this.selectSlot(1);
    } else if (this.usp.owned) {
      this.selectSlot(2);
    }
  }

  public handlePrimaryPress(nowSec: number): void {
    if (this.physics.getVitals().dead) return;
    if (nowSec < this.nextPrimaryAt) return;

    if (this.activeSlot === 1) {
      this.fireScout(nowSec);
    } else if (this.activeSlot === 2) {
      this.fireUsp(nowSec);
    } else {
      this.performKnifeAttack(nowSec, false);
    }
  }

  public handleSecondaryPress(nowSec: number): void {
    if (this.physics.getVitals().dead) return;
    if (nowSec < this.nextSecondaryAt) return;

    if (this.activeSlot === 1) {
      const nextZoom: 0 | 1 | 2 = this.scopeZoom === 0 ? 1 : this.scopeZoom === 1 ? 2 : 0;
      this.setScopeZoom(nextZoom);
      this.audio.playScopeZoom();
      this.nextSecondaryAt = nowSec + 0.22;
    } else if (this.activeSlot === 2) {
      this.cancelReload();
      this.usp.silenced = !this.usp.silenced;
      this.viewmodel.setUspSilenced(this.usp.silenced);
      this.audio.playSilencerToggle(this.usp.silenced);
      this.nextSecondaryAt = nowSec + 0.45;
      this.nextPrimaryAt = Math.max(this.nextPrimaryAt, nowSec + 0.45);
      this.callbacks.onToast?.(
        this.usp.silenced ? 'USP .45 SILENCER ATTACHED' : 'USP .45 SILENCER REMOVED',
        'rgba(148,163,184,0.8)',
      );
    } else {
      this.performKnifeAttack(nowSec, true);
    }
  }

  public tryReload(nowSec: number): boolean {
    if (this.physics.getVitals().dead) return false;
    if (this.activeSlot === 3 || this.reloadingSlot !== null) return false;

    const gun = this.activeSlot === 1 ? this.scout : this.usp;
    if (!gun.owned || gun.clip >= gun.clipMax || gun.reserve <= 0) return false;

    this.setScopeZoom(0);
    this.reloadingSlot = this.activeSlot;
    this.reloadDuration = this.activeSlot === 1 ? 1.35 : 1.05;
    this.reloadEndsAt = nowSec + this.reloadDuration;
    this.nextPrimaryAt = Math.max(this.nextPrimaryAt, this.reloadEndsAt);
    this.viewmodel.triggerReload(this.reloadDuration);
    this.audio.playReload();
    return true;
  }

  /** Drop active firearm (Slot 1 or 2) into the world as a VPhysics rigid body */
  public dropActiveWeapon(): void {
    if (this.physics.getVitals().dead) return;
    if (this.activeSlot === 3) {
      this.callbacks.onToast?.('CANNOT DROP COMBAT KNIFE', 'rgba(148,163,184,0.7)');
      return;
    }

    const slot = this.activeSlot;
    const gun = slot === 1 ? this.scout : this.usp;
    if (!gun.owned) return;

    this.cancelReload();
    this.setScopeZoom(0);

    const vf = this.abi.f32;
    const eye = this.physics.getPlayerEyePosition();
    const { forward, right } = computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0);

    const spawnPos: Vec3 = {
      x: f32(eye.x + forward.x * 34 + right.x * 6),
      y: f32(eye.y + forward.y * 34 + right.y * 6),
      z: f32(eye.z + forward.z * 34 - 6),
    };

    const throwSpeed = 310;
    const vel: Vec3 = {
      x: f32(vf[F32.VEL_X] + forward.x * throwSpeed),
      y: f32(vf[F32.VEL_Y] + forward.y * throwSpeed),
      z: f32(vf[F32.VEL_Z] + forward.z * throwSpeed + 75),
    };
    const angVel: Vec3 = {
      x: f32((Math.random() - 0.5) * 4.5),
      y: f32((Math.random() - 0.5) * 4.5),
      z: f32(5.2),
    };

    const tick = this.abi.i32[I32.TICK];
    const body = createWeaponRigidBody(
      `dropped_wpn_${slot}_${++this.droppedCounter}`,
      spawnPos,
      {
        slot,
        clipAmmo: gun.clip,
        reserveAmmo: gun.reserve,
        silenced: slot === 2 ? Boolean(gun.silenced) : undefined,
        pickupCooldownTick: tick + 85, // 0.85s auto-pickup cooldown
      },
      vel,
      angVel,
    );

    this.physics.addRigidBody(body);
    gun.owned = false;
    gun.clip = 0;
    gun.reserve = 0;

    this.audio.playWeaponDrop();
    this.callbacks.onToast?.(
      `DROPPED ${slot === 1 ? 'STEYR SCOUT .308' : 'USP .45 TACTICAL'}  (Press E to Pick Up)`,
      'rgba(56,189,248,0.8)',
    );

    // Auto-switch to next available weapon
    if (slot === 1 && this.usp.owned) {
      this.selectSlot(2, true);
    } else if (slot === 2 && this.scout.owned) {
      this.selectSlot(1, true);
    } else {
      this.selectSlot(3, true);
    }
  }

  /** Manual pickup via E key (swaps if that weapon slot is already occupied) */
  public tryPickupLookedWeapon(): boolean {
    if (this.physics.getVitals().dead) return false;
    const eye = this.physics.getPlayerEyePosition();
    const { forward } = computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0);
    const candidate = this.physics.findNearbyWeapon(135, eye, forward, 0.72, false);
    if (!candidate || !candidate.weaponData) return false;

    return this.equipGroundWeapon(candidate, true);
  }

  /** Per-frame update: reload completion, held-fire repeat, auto-pickup, and pickup prompt */
  public update(nowSec: number): void {
    if (this.physics.getVitals().dead) {
      this.nearbyWeapon = null;
      return;
    }

    // 1. Finish active reload
    if (this.reloadingSlot !== null && nowSec >= this.reloadEndsAt) {
      const gun = this.reloadingSlot === 1 ? this.scout : this.usp;
      if (gun.owned) {
        const needed = gun.clipMax - gun.clip;
        const load = Math.min(needed, gun.reserve);
        gun.clip += load;
        gun.reserve -= load;
      }
      this.reloadingSlot = null;
    }

    // 2. Continuous hold-to-slash for knife
    if (this.activeSlot === 3) {
      if (this.input.keys.attack1 && nowSec >= this.nextPrimaryAt) {
        this.performKnifeAttack(nowSec, false);
      } else if (this.input.keys.attack2 && nowSec >= this.nextSecondaryAt) {
        this.performKnifeAttack(nowSec, true);
      }
    }

    // 3. Auto-pickup when walking over a ground weapon for an empty slot
    const feetPickup = this.physics.findNearbyWeapon(54, undefined, undefined, -1, true);
    if (feetPickup && feetPickup.weaponData) {
      const slot = feetPickup.weaponData.slot;
      const gun = slot === 1 ? this.scout : this.usp;
      if (!gun.owned) {
        this.equipGroundWeapon(feetPickup, false);
      }
    }

    // 4. Highlight nearest looked-at ground weapon for HUD prompt
    const eye = this.physics.getPlayerEyePosition();
    const { forward } = computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0);
    this.nearbyWeapon = this.physics.findNearbyWeapon(135, eye, forward, 0.72, false);
  }

  public getHudSnapshot(nowSec: number): WeaponHudSnapshot {
    const reloading = this.reloadingSlot !== null;
    const reloadProgress = reloading
      ? Math.max(0, Math.min(1, 1 - (this.reloadEndsAt - nowSec) / Math.max(0.01, this.reloadDuration)))
      : 0;

    let nearbyPickupLabel: string | null = null;
    if (this.nearbyWeapon?.weaponData) {
      const wd = this.nearbyWeapon.weaponData;
      const name = wd.slot === 1 ? 'Steyr Scout .308' : 'USP .45 Tactical';
      const owned = wd.slot === 1 ? this.scout.owned : this.usp.owned;
      nearbyPickupLabel = `[E] ${owned ? 'Swap' : 'Pick up'} ${name} (${wd.clipAmmo}/${wd.reserveAmmo})`;
    }

    return {
      activeSlot: this.activeSlot,
      scout: { ...this.scout },
      usp: { ...this.usp },
      knifeOwned: true,
      reloading,
      reloadProgress,
      scopeZoom: this.scopeZoom,
      nearbyPickupLabel,
    };
  }

  private equipGroundWeapon(body: SourceRigidBody, allowSwap: boolean): boolean {
    const wd = body.weaponData;
    if (!wd) return false;
    const targetSlot = wd.slot;
    const gun = targetSlot === 1 ? this.scout : this.usp;

    if (gun.owned) {
      if (!allowSwap) return false;
      // Drop current weapon in that slot first
      const prevActive = this.activeSlot;
      this.activeSlot = targetSlot;
      this.dropActiveWeapon();
      this.activeSlot = prevActive;
    }

    const removed = this.physics.removeRigidBody(body.id);
    if (!removed) return false;

    gun.owned = true;
    gun.clip = wd.clipAmmo;
    gun.reserve = wd.reserveAmmo;
    if (targetSlot === 2) {
      gun.silenced = wd.silenced ?? true;
      this.viewmodel.setUspSilenced(gun.silenced);
    }

    this.audio.playWeaponPickup();
    this.selectSlot(targetSlot, true);
    this.callbacks.onToast?.(
      `EQUIPPED ${targetSlot === 1 ? 'STEYR SCOUT .308' : 'USP .45 TACTICAL'} (${gun.clip}/${gun.reserve})`,
      'rgba(52,211,153,0.85)',
    );
    return true;
  }

  private fireScout(nowSec: number): void {
    if (this.reloadingSlot !== null) return;
    if (this.scout.clip <= 0) {
      this.audio.playDryFire();
      this.nextPrimaryAt = nowSec + 0.25;
      this.tryReload(nowSec);
      return;
    }

    this.scout.clip -= 1;
    this.nextPrimaryAt = nowSec + 1.18;
    this.nextSecondaryAt = Math.max(this.nextSecondaryAt, nowSec + 0.35);

    const wasScoped = this.scopeZoom > 0;
    const spreadRad = wasScoped ? 0.0012 : 0.018;

    this.audio.playScoutShot();
    this.viewmodel.triggerFire(1, false);
    this.input.applyRecoilKick(0.036, (Math.random() - 0.5) * 0.01);

    this.fireHitscanRay(8192, spreadRad, 75, 19500, 0xfef08a);

    // Classic CS 1.6 bolt-action unscope on shot
    if (wasScoped) {
      this.setScopeZoom(0);
    }
  }

  private fireUsp(nowSec: number): void {
    if (this.reloadingSlot !== null) return;
    if (this.usp.clip <= 0) {
      this.audio.playDryFire();
      this.nextPrimaryAt = nowSec + 0.22;
      this.tryReload(nowSec);
      return;
    }

    this.usp.clip -= 1;
    this.nextPrimaryAt = nowSec + 0.16;

    const silenced = Boolean(this.usp.silenced);
    const vf = this.abi.f32;
    const spd = Math.hypot(vf[F32.VEL_X], vf[F32.VEL_Y]);
    const spreadRad = (silenced ? 0.008 : 0.011) + Math.min(0.018, spd * 0.000018);

    this.audio.playUspShot(silenced);
    this.viewmodel.triggerFire(2, silenced);
    this.input.applyRecoilKick(silenced ? 0.012 : 0.018, (Math.random() - 0.5) * 0.007);

    this.fireHitscanRay(4096, spreadRad, silenced ? 30 : 34, 8200, silenced ? 0xbae6fd : 0xfde047);
  }

  private fireHitscanRay(
    range: number,
    spreadRad: number,
    damage: number,
    impulseMag: number,
    tracerColor: number,
  ): void {
    const eye = this.physics.getPlayerEyePosition();
    const { forward, right, up } = computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0);

    const sx = (Math.random() - 0.5) * 2 * spreadRad;
    const sy = (Math.random() - 0.5) * 2 * spreadRad;
    const dir: Vec3 = {
      x: f32(forward.x + right.x * sx + up.x * sy),
      y: f32(forward.y + right.y * sx + up.y * sy),
      z: f32(forward.z + right.z * sx + up.z * sy),
    };

    const hit = this.physics.traceRay(eye, dir, range);

    const muzzleStart: Vec3 = {
      x: f32(eye.x + forward.x * 20 + right.x * 6 - up.x * 4),
      y: f32(eye.y + forward.y * 20 + right.y * 6 - up.y * 4),
      z: f32(eye.z + forward.z * 20 + right.z * 6 - up.z * 4),
    };
    const tracerEnd: Vec3 = hit.hit
      ? hit.point
      : {
          x: f32(eye.x + dir.x * range),
          y: f32(eye.y + dir.y * range),
          z: f32(eye.z + dir.z * range),
        };
    this.renderer.spawnBulletTracer(muzzleStart, tracerEnd, tracerColor);

    if (!hit.hit) return;

    if (hit.kind === 'rigidBody' && hit.body) {
      const res = this.physics.applyPointImpulse(hit.body, hit.point, dir, impulseMag, damage);
      const mat = res.bled ? 'blood' : hit.body.kind === 'weapon' ? 'weapon' : 'prop';
      this.renderer.spawnImpactEffect(hit.point, hit.normal, mat);
      this.audio.playImpact(hit.point, mat, impulseMag, hit.body.vel);
      this.callbacks.onHitMarker?.(res.bled, res.destroyed);
    } else {
      this.renderer.spawnImpactEffect(hit.point, hit.normal, 'world');
      this.audio.playImpact(hit.point, 'world', impulseMag * 0.45);
    }
  }

  private performKnifeAttack(nowSec: number, heavy: boolean): void {
    const cooldown = heavy ? 0.72 : 0.36;
    this.nextPrimaryAt = nowSec + cooldown;
    this.nextSecondaryAt = nowSec + cooldown;

    this.viewmodel.triggerKnifeAttack(heavy);
    this.audio.playKnifeSwing(heavy);

    const eye = this.physics.getPlayerEyePosition();
    const { forward } = computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0);
    const reach = heavy ? 68 : 74;
    const hit = this.physics.traceMelee(eye, forward, reach);

    if (!hit.hit) return;

    const damage = heavy ? 65 : 25;
    const impulse = heavy ? 17500 : 8800;

    if (hit.kind === 'rigidBody' && hit.body) {
      const res = this.physics.applyPointImpulse(hit.body, hit.point, forward, impulse, damage);
      const mat = res.bled ? 'blood' : hit.body.kind === 'weapon' ? 'weapon' : 'prop';
      this.renderer.spawnImpactEffect(hit.point, hit.normal, mat);
      this.audio.playImpact(hit.point, mat, impulse, hit.body.vel);
      this.callbacks.onHitMarker?.(res.bled, res.destroyed);
    } else {
      this.renderer.spawnImpactEffect(hit.point, hit.normal, 'world');
      this.audio.playImpact(hit.point, 'world', impulse * 0.5);
    }
  }

  private setScopeZoom(level: 0 | 1 | 2): void {
    this.scopeZoom = level;
    this.renderer.setScopeZoom(level);
    this.viewmodel.setScoped(level > 0);
    this.input.sensitivityScale = level === 2 ? 0.25 : level === 1 ? 0.48 : 1.0;
  }

  private cancelReload(): void {
    this.reloadingSlot = null;
    this.reloadEndsAt = 0;
  }
}

//SurfApp.ts 
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
  WaterVolume,
} from '../physics/GoldSrcPhysicsEngine';
import { MapBuildResult } from '../maps/surfSandbox01';
import { DEFAULT_MAP_ID, getMapById, MapId } from '../maps/mapRegistry';
import { SurfAudioEngine } from '../audio/SurfAudioEngine';
import { WorldRenderer } from '../render/WorldRenderer';
import { ViewmodelRig } from '../render/ViewmodelRig';
import { InputController } from '../gameplay/InputController';
import { RunTracker } from '../gameplay/RunTracker';
import { StrafeSyncTracker } from '../gameplay/StrafeSyncTracker';
import { WeaponSystem } from '../gameplay/WeaponSystem';
import { HudController, InteractPrompt, SubsystemTelemetry } from '../ui/HudController';
import { CombatHudOverlay } from '../ui/CombatHudOverlay';
import { MenuController } from '../ui/MenuController';

/** Optional subsystem hooks provided by subsystem-enabled maps (e.g., surfSandbox04) */
interface SubsystemMapExtensions {
  createJoints?: () => SourceJoint[];
  createRopes?: () => SourceRope[];
  createWaterVolumes?: () => WaterVolume[];
  createVehicles?: () => SourceVehicle[];
  ladders?: LadderVolume[];
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
  private weapons!: WeaponSystem;

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
    this.runTracker.reset();

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
          if (!this.gravityGunActive) {
            this.hud.setActiveWeaponSlot(slot);
          }
        },
      },
    );

    this.physics.teleportToSpawn(false);
    this.weapons.resetLoadout();
    this.input.resetView(mapData.spawn.yaw, mapData.spawn.pitch);
    this.menu.setSelectedMap(mapId);

    if (announce) {
      this.hud.showToast(`LOADED ${def.name.toUpperCase()}`, 'rgba(56,189,248,0.85)');
    }
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
    this.setGravityGunMode(false);
    this.physics.restoreVitals();
    this.resetSubsystemsAndProps();
    this.physics.teleportToSpawn(false);
    this.weapons.resetLoadout();
    this.input.resetView(this.currentMapData.spawn.yaw, this.currentMapData.spawn.pitch);
    this.hud.showToast('FULL RUN, PROPS & SUBSYSTEMS RESET', 'rgba(245,158,11,0.65)');
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
      // Direct Gravity Gun punt impulse on looked-at rigid body
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

    // Align initial camera heading with the buggy chassis
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

  private handleSandboxHotkey = (e: KeyboardEvent): void => {
    if (!this.input.isPointerLocked || e.repeat) return;

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
    const t0 = performance.now();
    this.physics.simulateTick();
    const dtSim = performance.now() - t0;
    this.simMsAvg = this.simMsAvg * 0.92 + dtSim * 0.08;

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
    this.runTracker.tick(vi[I32.TICK]);
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

    // Detect manual mouse movement since the previous frame
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
        // Subtle ~8 deg apex look-in when steering forward
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

    // Clamp pitch tighter in chase cam so it won't burrow under the floor
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
    });

    this.combatHud.update(frameDt, this.physics.getVitals(), this.weapons.getHudSnapshot(nowSec));

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
    this.renderer.render();
  };
}

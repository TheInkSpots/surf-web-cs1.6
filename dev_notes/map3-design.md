You are a cs counter strikegame map designer. reference the map 1 surfSandbox01.ts and map 2 surfSandbox02.ts, and following classic cs counter strike game map designer guideline (space sensory, levels, platform, speed, stair stepup) to design map 3 surfSandbox03.ts ; map requirments : more complex, longer, weapons, stair stepup; and Player can select maps in the beginning.

GoldSrcPhysicsEngine.ts, SurfApp.ts, MenuController.ts, Maps : map 1 surfSandbox01.ts and map 2 surfSandbox02.ts

physics:
Source Engine physics is split into two distinct mathematical systems: **deterministic player movement** (`CGameMovement`, inherited from QuakeWorld and GoldSrc) and **rigid-body dynamics** (`VPhysics`, powered by a modified Havok solver).

---

## 1. Coordinate System & Wish Direction

Source uses a right-handed, Z-up coordinate system ($+X$ forward, $+Y$ left, $+Z$ up) measured in Hammer units ($1\text{ unit} \approx 1.905\text{ cm}$ or $0.75\text{ inches}$).

### View Basis Vectors (`AngleVectors`)

Given Euler view angles—pitch $\theta$ (positive looks downward), yaw $\psi$, and roll $\phi$:

$$\mathbf{f} = \begin{bmatrix} \cos\theta\cos\psi \\ \cos\theta\sin\psi \\ -\sin\theta \end{bmatrix}, \quad \mathbf{r} = \begin{bmatrix} -\sin\phi\sin\theta\cos\psi + \cos\phi\sin\psi \\ -\sin\phi\sin\theta\sin\psi - \cos\phi\cos\psi \\ -\sin\phi\cos\theta \end{bmatrix}$$

### Wish Velocity & Wish Direction

Player movement inputs ($f_{\text{move}}$ forward/back, $s_{\text{move}}$ left/right) are projected onto the horizontal plane ($z = 0$) and normalized:

$$\mathbf{f}_{xy} = \frac{(f_x, f_y, 0)}{\sqrt{f_x^2 + f_y^2}}, \quad \mathbf{r}_{xy} = \frac{(r_x, r_y, 0)}{\sqrt{r_x^2 + r_y^2}}$$

$$\mathbf{w} = f_{\text{move}}\,\mathbf{f}_{xy} + s_{\text{move}}\,\mathbf{r}_{xy}$$

$$v_{\text{wish}} = \min\left(\Vert{}\mathbf{w}\Vert{},\; v_{\text{max}}\right), \quad \hat{\mathbf{w}} = \frac{\mathbf{w}}{\Vert{}\mathbf{w}\Vert{}}$$

---

## 2. Player Movement Physics (`CGameMovement`)

Player physics updates once per server tick ($\Delta t = \frac{1}{\text{tickrate}}$, typically $\frac{1}{66}\text{ s}$ or $\frac{1}{128}\text{ s}$).

### Ground Friction (`Friction`)

Applied prior to ground acceleration when the player is on a walkable surface:

$$v_{\text{horiz}} = \sqrt{v_x^2 + v_y^2}$$

$$\text{control} = \max(v_{\text{horiz}},\; v_{\text{stop}})$$

$$v_{\text{drop}} = \text{control} \cdot k_{\text{friction}} \cdot \mu_{\text{surface}} \cdot \Delta t$$

$$\mathbf{v}' = \mathbf{v} \cdot \frac{\max(v_{\text{horiz}} - v_{\text{drop}},\; 0)}{v_{\text{horiz}}}$$

* $v_{\text{stop}}$: `sv_stopspeed` (minimum velocity threshold for linear vs. exponential decay).
* $k_{\text{friction}}$: `sv_friction`.
* $\mu_{\text{surface}}$: Surface friction multiplier (typically $1.0$; lower on ice/slick surfaces).

### Ground Acceleration (`Accelerate`)

Acceleration is capped by projecting current velocity $\mathbf{v}$ onto the desired unit direction $\hat{\mathbf{w}}$:

$$v_{\text{proj}} = \mathbf{v} \cdot \hat{\mathbf{w}}$$

$$v_{\text{add}} = v_{\text{wish}} - v_{\text{proj}}$$

If $v_{\text{add}} \le 0$, no acceleration is applied. Otherwise:

$$v_{\text{accel}} = \min\left(a \cdot \Delta t \cdot v_{\text{wish}} \cdot \mu_{\text{surface}},\; v_{\text{add}}\right)$$

$$\mathbf{v}' = \mathbf{v} + v_{\text{accel}}\,\hat{\mathbf{w}}$$

### Air Acceleration & Air Strafing (`AirAccelerate`)

In mid-air, `addspeed` caps $v_{\text{wish}}$ at $30\text{ u/s}$, while `accelspeed` still multiplies by the uncapped $v_{\text{wish}}$:

$$v_{\text{cap}} = \min(v_{\text{wish}},\; 30)$$

$$v_{\text{add}} = v_{\text{cap}} - (\mathbf{v} \cdot \hat{\mathbf{w}})$$

$$v_{\text{accel}} = \min\left(a_{\text{air}} \cdot \Delta t \cdot v_{\text{wish}} \cdot \mu_{\text{surface}},\; v_{\text{add}}\right)$$

$$\mathbf{v}' = \mathbf{v} + v_{\text{accel}}\,\hat{\mathbf{w}}$$

**Why Air Strafing Gains Speed:** Because the speed limit applies only to the dot product $\mathbf{v} \cdot \hat{\mathbf{w}}$, turning the view so $\hat{\mathbf{w}}$ is nearly perpendicular to $\mathbf{v}$ keeps $\mathbf{v} \cdot \hat{\mathbf{w}} \approx 0$. This yields $v_{\text{add}} \approx 30$, allowing $v_{\text{accel}}\,\hat{\mathbf{w}}$ to add orthogonally and increase total speed magnitude:

$$\Vert{}\mathbf{v}'\Vert{} = \sqrt{\Vert{}\mathbf{v}\Vert{}^2 + 2v_{\text{accel}}(\mathbf{v} \cdot \hat{\mathbf{w}}) + v_{\text{accel}}^2} \gt \Vert{}\mathbf{v}\Vert{}$$

### Gravity Integration (`StartGravity` & `FinishGravity`)

Source uses a half-step velocity-Verlet split around the position integration step to eliminate tickrate-dependent jump height drift:

1. **Before `TryPlayerMove`:** $v_z \leftarrow v_z - \frac{1}{2}\,g_{\text{ent}}\,g\,\Delta t$
2. **Integrate Position:** $\mathbf{x} \leftarrow \mathbf{x} + \mathbf{v}\,\Delta t$
3. **After `TryPlayerMove`:** $v_z \leftarrow v_z - \frac{1}{2}\,g_{\text{ent}}\,g\,\Delta t$

### Jump Impulse (`CheckJumpButton`)

Jumping sets vertical velocity directly (or adds to it in specific configurations) using conservation of energy:

$$v_z = \sqrt{2 \cdot g \cdot h_{\text{jump}}}$$

* **CS:S / GoldSrc ($h_{\text{jump}} = 45\text{ u}$, $g = 800\text{ u/s}^2$):** $v_z = \sqrt{2 \cdot 800 \cdot 45} \approx 268.33\text{ u/s}$
* **Half-Life 2 ($h_{\text{jump}} = 21\text{ u}$, $g = 800\text{ u/s}^2$):** $v_z = \sqrt{2 \cdot 800 \cdot 21} \approx 183.30\text{ u/s}$

### Velocity Clipping & Surf Ramps (`ClipVelocity`)

When a swept trace hits a plane with unit normal $\mathbf{n}$, velocity is projected onto the plane:

$$\mathbf{v}' = \mathbf{v} - (\mathbf{v} \cdot \mathbf{n}) \cdot \beta \cdot \mathbf{n}$$

* $\beta$ (`overbounce`): $1.0$ for sliding along walls/ramps; $1.0 + \text{bounce}$ for elastic entities.
* **Walkable vs. Surf Condition:** A surface is considered ground if $n_z \ge 0.7$ (slope angle $\le \arccos(0.7) \approx 45.57^\circ$). On steeper ramps ($n_z \lt 0.7$), the player remains in the airborne state—bypassing ground friction—while `TryPlayerMove` iteratively calls `ClipVelocity` against the ramp normal every tick, converting downward gravity into tangential ramp speed.

### Stair Step-Up (`StepMove`)

When horizontal movement hits a vertical obstacle ($n_z \approx 0$), Source evaluates two candidate trajectories over $\Delta t$:

1. **Path A (Slide):** Standard `TryPlayerMove` sliding along the wall.
2. **Path B (Step):** Trace up by `sv_stepsize` ($18\text{ u}$) $\rightarrow$ trace forward with $\mathbf{v}$ $\rightarrow$ trace down by `sv_stepsize`.

If Path B lands on walkable ground ($n_z \ge 0.7$) and covers greater horizontal squared distance $(x_B - x_0)^2 + (y_B - y_0)^2 \gt (x_A - x_0)^2 + (y_A - y_0)^2$, Path B is committed.

---

## 3. BSP Collision & Swept AABB Math

Player hitboxes are axis-aligned bounding boxes (AABBs) that never rotate with view yaw. Rather than testing an AABB against static BSP brush planes, Source expands each brush plane outward by the AABB's half-extents $\mathbf{e} = (e_x, e_y, e_z)$ (Minkowski sum) and traces a single point ray:

$$d_{\text{shifted}} = d - \left(\vert{}n_x e_x\vert{} + \vert{}n_y e_y\vert{} + \vert{}n_z e_z\vert{}\right)$$

For a movement segment from $\mathbf{p}_1$ to $\mathbf{p}_2$, signed distances to the shifted plane are $s_1 = \mathbf{n} \cdot \mathbf{p}_1 - d_{\text{shifted}}$ and $s_2 = \mathbf{n} \cdot \mathbf{p}_2 - d_{\text{shifted}}$. If $s_1 \gt 0$ and $s_2 \lt 0$, the exact time-of-impact fraction $t \in [0, 1]$ is:

$$t = \max\left(0,\; \frac{s_1 - \epsilon}{s_1 - s_2}\right)$$

where $\epsilon = \frac{1}{32}\text{ u} = 0.03125\text{ u}$ (`DIST_EPSILON`) prevents floating-point self-intersection on subsequent ticks.

---

## 4. Rigid-Body Dynamics (`VPhysics` / Havok)

Props and ragdolls are simulated as rigid bodies with mass $m$, center of mass $\mathbf{x}$, orientation quaternion $\mathbf{q}$, linear velocity $\mathbf{v}$, angular velocity $\boldsymbol{\omega}$, and world-space inertia tensor $\mathbf{I} = \mathbf{R}\,\mathbf{I}_{\text{local}}\,\mathbf{R}^T$.

### Semi-Implicit Euler Integration

At each physics step $\Delta t$:

$$\mathbf{v}_{t+\Delta t} = \mathbf{v}_t(1 - c_{\text{lin}}\Delta t) + \left(\frac{\mathbf{F}_{\text{ext}}}{m} + \mathbf{g}\right)\Delta t$$

$$\mathbf{x}_{t+\Delta t} = \mathbf{x}_t + \mathbf{v}_{t+\Delta t}\Delta t$$

$$\boldsymbol{\omega}_{t+\Delta t} = \boldsymbol{\omega}_t(1 - c_{\text{ang}}\Delta t) + \mathbf{I}^{-1}\left(\boldsymbol{\tau}_{\text{ext}} - \boldsymbol{\omega}_t \times (\mathbf{I}\boldsymbol{\omega}_t)\right)\Delta t$$

$$\mathbf{q}_{t+\Delta t} = \text{normalize}\left(\mathbf{q}_t + \frac{1}{2}\begin{bmatrix}0 \\ \boldsymbol{\omega}_{t+\Delta t}\end{bmatrix} \otimes \mathbf{q}_t\,\Delta t\right)$$

### Rigid-Body Collision Impulse

At contact point $\mathbf{p}$ with lever arms $\mathbf{r}_A = \mathbf{p} - \mathbf{x}_A$ and $\mathbf{r}_B = \mathbf{p} - \mathbf{x}_B$, contact normal $\mathbf{n}$, and restitution $e$:

$$\mathbf{v}_{\text{rel}} = (\mathbf{v}_B + \boldsymbol{\omega}_B \times \mathbf{r}_B) - (\mathbf{v}_A + \boldsymbol{\omega}_A \times \mathbf{r}_A)$$

$$j = \frac{-(1 + e)(\mathbf{v}_{\text{rel}} \cdot \mathbf{n})}{m_A^{-1} + m_B^{-1} + \left[\left(\mathbf{I}_A^{-1}(\mathbf{r}_A \times \mathbf{n})\right) \times \mathbf{r}_A + \left(\mathbf{I}_B^{-1}(\mathbf{r}_B \times \mathbf{n})\right) \times \mathbf{r}_B\right] \cdot \mathbf{n}}$$

$$\mathbf{v}_A' = \mathbf{v}_A - \frac{j}{m_A}\mathbf{n}, \quad \boldsymbol{\omega}_A' = \boldsymbol{\omega}_A - \mathbf{I}_A^{-1}(\mathbf{r}_A \times j\mathbf{n})$$

### Explosion & Damage Impulse

Radial explosions apply linear attenuation over blast radius $R$ scaled by `phys_pushscale` ($k_{\text{push}}$):

$$I_{\text{mag}} = D_{\text{max}} \cdot \max\left(0,\; 1 - \frac{\Vert{}\mathbf{x}_{\text{obj}} - \mathbf{x}_{\text{exp}}\Vert{}}{R}\right) \cdot k_{\text{push}}$$

$$\Delta \mathbf{v} = \frac{I_{\text{mag}}}{m}\,\frac{\mathbf{x}_{\text{obj}} - \mathbf{x}_{\text{exp}}}{\Vert{}\mathbf{x}_{\text{obj}} - \mathbf{x}_{\text{exp}}\Vert{}}$$

---

## 5. Standard Source Physics Constants

| ConVar / Constant | Default Value (HL2 / CS:S) | Surf / Bhop Typical | Units |
| --- | --- | --- | --- |
| `sv_gravity` | `800` | `800` | $\text{u/s}^2$ |
| `sv_accelerate` | `10` (HL2) / `5` (CS:S) | `5` – `10` | $\text{s}^{-1}$ |
| `sv_airaccelerate` | `10` | `100` – `1000` | $\text{s}^{-1}$ |
| `sv_friction` | `4` | `4` | $\text{s}^{-1}$ |
| `sv_stopspeed` | `100` (HL2) / `75` (CS:S) | `75` – `100` | $\text{u/s}$ |
| `sv_maxvelocity` | `3500` | `3500` – `10000` | $\text{u/s}$ |
| `sv_stepsize` | `18` | `18` | $\text{u}$ |
| `DIST_EPSILON` | `0.03125` ($1/32$) | `0.03125` | $\text{u}$ |
| Walkable $n_z$ threshold | `0.7` | `0.7` | dimensionless |


//GoldSrcPhysicsEngine.ts, 

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

//SurfApp.ts, 

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
  IN_ATTACK,
  IN_ATTACK2,
  IN_RELOAD,
  IN_USE,
  SourceRigidBody,
} from '../physics/GoldSrcPhysicsEngine';
import { buildSurfSandbox02 } from '../maps/surfSandbox02';
import { SurfAudioEngine } from '../audio/SurfAudioEngine';
import { WorldRenderer } from '../render/WorldRenderer';
import { ViewmodelRig } from '../render/ViewmodelRig';
import { InputController } from '../gameplay/InputController';
import { RunTracker } from '../gameplay/RunTracker';
import { StrafeSyncTracker } from '../gameplay/StrafeSyncTracker';
import { WeaponSystem } from '../gameplay/WeaponSystem';
import { HudController } from '../ui/HudController';
import { CombatHudOverlay } from '../ui/CombatHudOverlay';
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
  private readonly weapons: WeaponSystem;
  private readonly hud: HudController;
  private readonly combatHud: CombatHudOverlay;
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
    const mapData = buildSurfSandbox02();
    this.createInitialRigidBodies = mapData.createRigidBodies;

    this.hud = new HudController(this.runTracker);
    this.combatHud = new CombatHudOverlay();
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
        onPlayerDamage: (amount, source, bloodLostMl) => {
          this.audio.playPlayerHurt(amount);
          this.hud.flashScreen('rgba(220, 38, 38, 0.48)');
          this.hud.showToast(
            `-${amount} HP  •  -${bloodLostMl} mL BLOOD (${source.toUpperCase()})`,
            'rgba(239, 68, 68, 0.85)',
          );
        },
        onPlayerDeath: (source) => {
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
            `FINISHED IN ${RunTracker.formatTime(result.finishSec)}${deltaStr}${pbNote}  (Backspace for Full Reset)`,
            'rgba(16,185,129,0.75)',
          );
        },
      },
      this.createInitialRigidBodies(),
    );

    this.input = new InputController(canvas, mapData.spawn, {
      onUnlockRequest: () => this.audio.unlock(),
      onSelectWeapon: (slot) => this.weapons.selectSlot(slot),
      onQuickSwitch: () => this.weapons.quickSwitch(),
      onDropWeapon: () => this.weapons.dropActiveWeapon(),
      onPickupWeapon: () => {
        if (!this.weapons.tryPickupLookedWeapon()) {
          this.hud.showToast('AIM AT A GROUND WEAPON TO PICK UP', 'rgba(148,163,184,0.65)');
        }
      },
      onAttack1Press: () => this.weapons.handlePrimaryPress(performance.now() * 0.001),
      onAttack2Press: () => this.weapons.handleSecondaryPress(performance.now() * 0.001),
      onReloadOrReset: () => {
        if (this.physics.getVitals().dead) {
          this.fullReset(mapData.spawn);
          return;
        }
        const startedReload = this.weapons.tryReload(performance.now() * 0.001);
        if (!startedReload && this.weapons.getActiveSlot() === 3) {
          this.fullReset(mapData.spawn);
        }
      },
      onResetRun: () => this.fullReset(mapData.spawn),
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
        onActiveSlotChanged: (slot) => this.hud.setActiveWeaponSlot(slot),
      },
    );

    this.menu = new MenuController(this.abi, {
      onPlay: () => this.input.requestLock(),
      onRestart: () => {
        this.fullReset(mapData.spawn);
        this.input.requestLock();
      },
      onSensitivityChange: (sens) => {
        this.input.sensitivity = sens;
      },
      onBaseFovChange: (fov) => {
        this.renderer.baseFov = fov;
      },
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

  private fullReset(spawn: { yaw: number; pitch: number }): void {
    this.activeCheckpoint = null;
    this.visitedCheckpoints.clear();
    this.physics.restoreVitals();
    this.physics.setRigidBodies(this.createInitialRigidBodies());
    this.physics.teleportToSpawn(false);
    this.weapons.resetLoadout();
    this.input.resetView(spawn.yaw, spawn.pitch);
    this.hud.showToast('FULL RUN & LOADOUT RESET', 'rgba(245,158,11,0.65)');
  }

  /**
   * Live Sandbox Hotkeys (while pointer-locked):
   *   B = Respawn at active stage checkpoint
   *   C = Save custom practice checkpoint
   *   V = Load custom practice checkpoint (preserves velocity)
   *   T = Spawn VPhysics crate ahead
   *   F = Detonate radial blast ahead
   *   X = Reset VPhysics props, targets & ground weapons
   */
  private handleSandboxHotkey = (e: KeyboardEvent): void => {
    if (!this.input.isPointerLocked || e.repeat) return;

    if (e.code === 'KeyB') {
      if (!this.activeCheckpoint) {
        this.hud.showToast('NO STAGE CHECKPOINT REACHED YET', 'rgba(148,163,184,0.6)');
        return;
      }
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
      this.physics.setRigidBodies(this.createInitialRigidBodies());
      this.hud.showToast('PROPS, TARGETS & GROUND WEAPONS RESET', 'rgba(251,191,36,0.65)');
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

  private stepPhysicsTick(): void {
    const { f32: vf, i32: vi } = this.abi;
    const keys = this.input.keys;
    const maxSpd = this.weapons.getMoveSpeed();

    let fmove = 0;
    let smove = 0;
    if (keys.w) fmove += maxSpd;
    if (keys.s) fmove -= maxSpd;
    if (keys.d) smove += maxSpd;
    if (keys.a) smove -= maxSpd;

    let buttons = 0;
    if (keys.jump || this.input.consumeScrollJump()) buttons |= IN_JUMP;
    if (keys.duck) buttons |= IN_DUCK;
    if (keys.attack1) buttons |= IN_ATTACK;
    if (keys.attack2) buttons |= IN_ATTACK2;
    if (keys.reload) buttons |= IN_RELOAD;
    if (keys.use) buttons |= IN_USE;

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
      this.weapons.update(nowSec);
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

    this.audio.updateListener({
      pos: { x: rx, y: ry, z: rz + rEye },
      vel: { x: vf[F32.VEL_X], y: vf[F32.VEL_Y], z: vf[F32.VEL_Z] },
      yaw: renderYaw,
      pitch: renderPitch,
    });
    this.audio.updateContinuous(spd3D, vi[I32.MOVESTATE] === MoveState.SURF, !locked, vf[F32.SURF_NZ]);

    this.renderer.update(frameDt, rx, ry, rz + rEye, renderYaw, renderPitch, spdXY);

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

    this.combatHud.update(frameDt, this.physics.getVitals(), this.weapons.getHudSnapshot(nowSec));

    this.renderer.syncRigidBodies(this.physics.getRigidBodies());
    this.renderer.render();
  };
}


//MenuController.ts, 

import { f32 } from '../core/constants';
import { F32, I32, PhysicsMemoryAbi } from '../core/memoryAbi';

export interface MenuCallbacks {
  onPlay: () => void;
  onRestart: () => void;
  onSensitivityChange: (sens: number) => void;
  onBaseFovChange: (fov: number) => void;
  onScout260Change: (enabled: boolean) => void;
  onStrafeHudChange: (visible: boolean) => void;
  onDebugChange: (enabled: boolean) => void;
  onMuteChange: (muted: boolean) => void;
}

export class MenuController {
  private readonly abi: PhysicsMemoryAbi;
  private readonly callbacks: MenuCallbacks;

  private readonly slAirAccel = document.getElementById('sl-airaccel') as HTMLInputElement;
  private readonly slMaxVel = document.getElementById('sl-maxvel') as HTMLInputElement;
  private readonly slGravity = document.getElementById('sl-gravity') as HTMLInputElement;
  private readonly slSens = document.getElementById('sl-sens') as HTMLInputElement;
  private readonly slFov = document.getElementById('sl-fov') as HTMLInputElement;

  private readonly valAirAccel = document.getElementById('val-airaccel')!;
  private readonly valMaxVel = document.getElementById('val-maxvel')!;
  private readonly valGravity = document.getElementById('val-gravity')!;
  private readonly valSens = document.getElementById('val-sens')!;
  private readonly valFov = document.getElementById('val-fov')!;

  private readonly btnDefault = document.getElementById('preset-default')!;
  private readonly btnHardcore = document.getElementById('preset-hardcore')!;
  private readonly presetInd = document.getElementById('preset-indicator')!;
  private readonly ngCvars = document.getElementById('ng-cvars')!;

  private readonly tgAutoBhop = document.getElementById('tg-autobhop') as HTMLInputElement;
  private readonly tgScout260 = document.getElementById('tg-scout260') as HTMLInputElement;
  private readonly tgStrafe = document.getElementById('tg-strafe') as HTMLInputElement;
  private readonly tgDebug = document.getElementById('tg-debug') as HTMLInputElement;
  private readonly tgMute = document.getElementById('tg-mute') as HTMLInputElement;
  private readonly debugPill = document.getElementById('debug-pill')!;

  constructor(abi: PhysicsMemoryAbi, callbacks: MenuCallbacks) {
    this.abi = abi;
    this.callbacks = callbacks;

    this.btnDefault.addEventListener('click', () => this.applyPreset('default'));
    this.btnHardcore.addEventListener('click', () => this.applyPreset('hardcore'));

    this.slAirAccel.addEventListener('input', () => {
      this.abi.f32[F32.CVAR_AIRACCEL] = f32(Number(this.slAirAccel.value));
      this.syncAll();
    });
    this.slMaxVel.addEventListener('input', () => {
      this.abi.f32[F32.CVAR_MAXVEL] = f32(Number(this.slMaxVel.value));
      this.syncAll();
    });
    this.slGravity.addEventListener('input', () => {
      this.abi.f32[F32.CVAR_GRAVITY] = f32(Number(this.slGravity.value));
      this.syncAll();
    });
    this.slSens.addEventListener('input', () => {
      const sens = Number(this.slSens.value);
      this.valSens.textContent = sens.toFixed(2);
      this.callbacks.onSensitivityChange(sens);
    });
    this.slFov.addEventListener('input', () => {
      const fov = Number(this.slFov.value);
      this.valFov.textContent = `${fov}°`;
      this.callbacks.onBaseFovChange(fov);
    });

    this.tgAutoBhop.addEventListener('change', () => {
      this.abi.i32[I32.AUTOBHOP] = this.tgAutoBhop.checked ? 1 : 0;
    });
    this.tgScout260.addEventListener('change', () => {
      this.abi.i32[I32.LEGACY_SCOUT] = this.tgScout260.checked ? 1 : 0;
      this.callbacks.onScout260Change(this.tgScout260.checked);
    });
    this.tgStrafe.addEventListener('change', () => {
      this.callbacks.onStrafeHudChange(this.tgStrafe.checked);
    });
    this.tgDebug.addEventListener('change', () => {
      this.debugPill.classList.toggle('active', this.tgDebug.checked);
      this.callbacks.onDebugChange(this.tgDebug.checked);
    });
    this.tgMute.addEventListener('change', () => {
      this.callbacks.onMuteChange(this.tgMute.checked);
    });

    document.getElementById('btn-play')?.addEventListener('click', () => this.callbacks.onPlay());
    document
      .getElementById('btn-restart-menu')
      ?.addEventListener('click', () => this.callbacks.onRestart());
  }

  public setDebugChecked(checked: boolean): void {
    this.tgDebug.checked = checked;
    this.debugPill.classList.toggle('active', checked);
  }

  public syncAll(): void {
    const aa = Math.round(this.abi.f32[F32.CVAR_AIRACCEL]);
    const mv = Math.round(this.abi.f32[F32.CVAR_MAXVEL]);
    const gv = Math.round(this.abi.f32[F32.CVAR_GRAVITY]);

    this.slAirAccel.value = String(aa);
    this.valAirAccel.textContent = String(aa);

    this.slMaxVel.value = String(mv);
    this.valMaxVel.textContent = String(mv);

    this.slGravity.value = String(gv);
    this.valGravity.textContent = String(gv);

    this.ngCvars.textContent = `aa:${aa} mv:${mv}`;

    const isDef = aa === 100 && mv === 3500 && gv === 800;
    const isHc = aa === 150 && mv === 4500 && gv === 800;
    this.btnDefault.classList.toggle('active', isDef);
    this.btnHardcore.classList.toggle('active', isHc);
    this.presetInd.textContent = isDef ? 'DEFAULT' : isHc ? 'HARDCORE' : 'CUSTOM';
  }

  private applyPreset(name: 'default' | 'hardcore'): void {
    if (name === 'hardcore') {
      this.abi.f32[F32.CVAR_AIRACCEL] = f32(150.0);
      this.abi.f32[F32.CVAR_MAXVEL] = f32(4500.0);
      this.abi.f32[F32.CVAR_GRAVITY] = f32(800.0);
    } else {
      this.abi.f32[F32.CVAR_AIRACCEL] = f32(100.0);
      this.abi.f32[F32.CVAR_MAXVEL] = f32(3500.0);
      this.abi.f32[F32.CVAR_GRAVITY] = f32(800.0);
    }
    this.syncAll();
  }
}

Maps : 

//map 1 //surfSandbox01.ts 

import { f32 } from '../core/constants';
import { BrushBuilder, BrushStyle, ConvexBrush, TriggerVolume } from '../physics/BrushBuilder';
import { createBoxRigidBody, SourceRigidBody, SpawnPoint } from '../physics/GoldSrcPhysicsEngine';

export interface WorldSign {
  x: number;
  y: number;
  z: number;
  yaw: number;
  text: string;
  color: string;
  scale: number;
}

export interface MapBuildResult {
  brushes: ConvexBrush[];
  triggers: TriggerVolume[];
  signs: WorldSign[];
  spawn: SpawnPoint;
  createRigidBodies: () => SourceRigidBody[];
}

export function buildSurfSandbox01(): MapBuildResult {
  const builder = new BrushBuilder();
  const signs: WorldSign[] = [];
  const spawn: SpawnPoint = {
    x: f32(-190),
    y: f32(0),
    z: f32(1038),
    yaw: f32(0),
    pitch: f32(-0.07),
  };

  // =========================================================================
  // STAGE 1: SPAWN, DROP-IN ENTRY, TRANSFER & SWEEPING CURVE
  // =========================================================================

  // --- 1. ELEVATED SPAWN PLATFORM ---
  builder.addBoxBrush('spawn_deck', -340, -230, 940, 10, 230, 1000, 'slate');
  builder.addBoxBrush('spawn_back_wall', -356, -230, 1000, -340, 230, 1072, 'slate');
  builder.addBoxBrush('spawn_right_rail', -340, -246, 1000, 10, -230, 1044, 'slate');

  // Start Gate pillars & trig_start volume
  builder.addBoxBrush('start_pillar_l', -14, 210, 1000, 14, 234, 1210, 'finish');
  builder.addBoxBrush('start_pillar_r', -14, -234, 1000, 14, -210, 1210, 'finish');
  builder.addBoxBrush('start_header', -14, -234, 1210, 14, 234, 1236, 'finish');
  builder.addTrigger('trig_start', 'start', -18, -210, 1000, 32, 210, 1210);
  signs.push({
    x: 0,
    y: 0,
    z: 1265,
    yaw: Math.PI,
    text: 'START GATE  •  4-STAGE COURSE  (B: CP | G: CRATE | F: BLAST)',
    color: '#34d399',
    scale: 1.0,
  });

  // --- 2. RAMP 1: DROP-IN ENTRY WEDGE (50° double-sided) ---
  builder.addSurfRampBrush('col_ramp_1', {
    start: [90, 0, 955],
    end: [1420, 0, 745],
    angleDeg: 50,
    height: 330,
    topWidth: 22,
    sides: 'both',
    style: 'ramp',
  });
  signs.push({ x: 520, y: 0, z: 1030, yaw: Math.PI, text: 'STAGE 1  •  50° ENTRY', color: '#fbbf24', scale: 1.05 });

  // --- 3. RAMP 2: OFFSET RIGHT-SIDE 54° SURF RAMP ---
  builder.addSurfRampBrush('col_ramp_2', {
    start: [1700, -340, 760],
    end: [3020, -340, 560],
    angleDeg: 54,
    height: 350,
    topWidth: 22,
    sides: 'both',
    style: 'ramp',
  });
  signs.push({ x: 2260, y: -340, z: 830, yaw: Math.PI, text: 'RAMP 2  •  54° TRANSFER', color: '#fbbf24', scale: 1.05 });

  // --- 4. BOOSTER 1 (trig_push_1) + LAUNCH DECK ---
  builder.addBoxBrush('booster_1_pad', 3080, -580, 210, 3520, -100, 250, 'booster');
  builder.addTrigger('trig_push_1', 'push', 3080, -580, 250, 3540, -100, 760, {
    mode: 'hybrid',
    dirX: 0.92,
    dirY: 0.08,
    dirZ: 0.36,
    addSpeed: 400,
    minSpeedXY: 1450,
    minVelZ: 560,
  });
  signs.push({ x: 3300, y: -340, z: 790, yaw: Math.PI, text: 'BOOSTER 1  •  TRIG_PUSH', color: '#22d3ee', scale: 1.1 });

  // --- 5. CURVED 3-SEGMENT SURF BANK (52° -> 56° -> 58° sweeping left) ---
  builder.addSurfRampBrush('col_ramp_curve_1', {
    start: [4140, -360, 740],
    end: [5120, -187, 635],
    angleDeg: 52,
    height: 390,
    topWidth: 24,
    sides: 'both',
    style: 'ramp',
  });
  builder.addSurfRampBrush('col_ramp_curve_2', {
    start: [5080, -196, 635],
    end: [5990, 248, 530],
    angleDeg: 56,
    height: 390,
    topWidth: 24,
    sides: 'both',
    style: 'ramp',
  });
  builder.addSurfRampBrush('col_ramp_curve_3', {
    start: [5950, 226, 530],
    end: [6720, 970, 425],
    angleDeg: 58,
    height: 390,
    topWidth: 24,
    sides: 'both',
    style: 'ramp',
  });
  signs.push({
    x: 5420,
    y: 120,
    z: 810,
    yaw: Math.PI + 0.45,
    text: 'CURVED BANK  •  52° → 56° → 58°',
    color: '#fbbf24',
    scale: 1.25,
  });

  // =========================================================================
  // STAGE 2: CHECKPOINT 2, DUAL-ANGLE SPLIT & SKY LAUNCH
  // =========================================================================

  const d45 = Math.SQRT1_2;
  const splitOriginX = 7020;
  const splitOriginY = 1270;
  const splitLen = 1320;
  const splitOffset = 350;

  // Stage 2 Checkpoint Trigger (spans exit of curved bank into Dual Split entry)
  builder.addTrigger('trig_cp_2', 'checkpoint', 6660, 900, 120, 7280, 1580, 780, {
    index: 2,
    label: 'STAGE 2 — DUAL SPLIT',
    respawnX: 6920,
    respawnY: 1365,
    respawnZ: 365,
    respawnYaw: Math.PI * 0.25,
    respawnPitch: -0.05,
    respawnVelX: 660,
    respawnVelY: 660,
    respawnVelZ: 0,
  });

  // Side A (Left Branch): 48° Smooth Glide Ramp
  const sAx = splitOriginX - d45 * splitOffset;
  const sAy = splitOriginY + d45 * splitOffset;
  builder.addSurfRampBrush('col_ramp_split_48', {
    start: [sAx, sAy, 470],
    end: [sAx + d45 * splitLen, sAy + d45 * splitLen, 320],
    angleDeg: 48,
    height: 360,
    topWidth: 22,
    sides: 'both',
    style: 'ramp',
  });
  signs.push({
    x: sAx + d45 * 450,
    y: sAy + d45 * 450,
    z: 585,
    yaw: Math.PI + Math.PI * 0.25,
    text: 'STAGE 2A  •  48° SMOOTH GLIDE',
    color: '#fbbf24',
    scale: 1.05,
  });

  // Side B (Right Branch): 60° Steep Aggressive Speed Ramp
  const sBx = splitOriginX + d45 * splitOffset;
  const sBy = splitOriginY - d45 * splitOffset;
  builder.addSurfRampBrush('col_ramp_split_60', {
    start: [sBx, sBy, 470],
    end: [sBx + d45 * splitLen, sBy + d45 * splitLen, 320],
    angleDeg: 60,
    height: 390,
    topWidth: 22,
    sides: 'both',
    style: 'steep',
  });
  signs.push({
    x: sBx + d45 * 450,
    y: sBy + d45 * 450,
    z: 585,
    yaw: Math.PI + Math.PI * 0.25,
    text: 'STAGE 2B  •  60° STEEP SPEED',
    color: '#f97316',
    scale: 1.05,
  });

  // --- 6B. MID-AIR EXPLOSION BOOST GATE (rebalanced to ~1480 u/s arc onto Stage 3) ---
  const b2x = splitOriginX + d45 * (splitLen + 420);
  const b2y = splitOriginY + d45 * (splitLen + 420);
  builder.addBoxBrush('booster_2_pad', b2x - 360, b2y - 360, 40, b2x + 360, b2y + 360, 80, 'booster');
  builder.addTrigger('trig_exp_stage2', 'explosion', b2x - 340, b2y - 340, 80, b2x + 340, b2y + 340, 620, {
    originX: b2x - d45 * 220,
    originY: b2y - d45 * 220,
    originZ: -120,
    maxDamage: 26000,
    radius: 900,
    pushScale: 1.0,
    cooldownTicks: 40,
  });
  builder.addTrigger('trig_push_2', 'push', b2x - 360, b2y - 360, 80, b2x + 360, b2y + 360, 360, {
    mode: 'hybrid',
    dirX: d45,
    dirY: d45,
    dirZ: 0.48,
    addSpeed: 280,
    minSpeedXY: 1480,
    minVelZ: 980,
  });
  signs.push({
    x: b2x,
    y: b2y,
    z: 675,
    yaw: Math.PI + Math.PI * 0.25,
    text: 'EXPLOSION BOOST GATE  •  STAGE 3 LAUNCH',
    color: '#f97316',
    scale: 1.2,
  });

  // =========================================================================
  // STAGE 3: CHECKPOINT 3, HIGH-ALTITUDE APEX SWEEP & BLAST CANYON
  // =========================================================================

  const s3DeckX = b2x + d45 * 1120;
  const s3DeckY = b2y + d45 * 1120;
  builder.addBoxBrush(
    'stage3_sky_deck',
    s3DeckX - 240,
    s3DeckY - 240,
    700,
    s3DeckX + 240,
    s3DeckY + 240,
    740,
    'slate',
  );

  // Stage 3 Checkpoint Trigger (covers sky deck and fly-over air corridor into Ramp 6)
  builder.addTrigger(
    'trig_cp_3',
    'checkpoint',
    s3DeckX - 360,
    s3DeckY - 360,
    680,
    s3DeckX + 460,
    s3DeckY + 460,
    1180,
    {
      index: 3,
      label: 'STAGE 3 — HIGH APEX',
      respawnX: s3DeckX,
      respawnY: s3DeckY,
      respawnZ: 778,
      respawnYaw: 0.38,
      respawnPitch: -0.05,
      respawnVelX: 0,
      respawnVelY: 0,
      respawnVelZ: 0,
    },
  );

  signs.push({
    x: s3DeckX,
    y: s3DeckY,
    z: 960,
    yaw: Math.PI + Math.PI * 0.2,
    text: 'STAGE 3  •  HIGH-ALTITUDE APEX',
    color: '#38bdf8',
    scale: 1.15,
  });

  // --- 7. RAMP 6: 55° HIGH SPINE TURNING EAST-NORTHEAST ---
  builder.addSurfRampBrush('col_ramp_s3_1', {
    start: [9320, 3420, 860],
    end: [10520, 3920, 680],
    angleDeg: 55,
    height: 390,
    topWidth: 24,
    sides: 'both',
    style: 'ramp',
  });

  // --- 8. RAMP 7: 58° APEX TURN SWEEPING SOUTHEAST ---
  builder.addSurfRampBrush('col_ramp_s3_2', {
    start: [10680, 3930, 700],
    end: [11820, 3460, 490],
    angleDeg: 58,
    height: 410,
    topWidth: 24,
    sides: 'both',
    style: 'ramp',
  });
  signs.push({
    x: 11260,
    y: 3695,
    z: 860,
    yaw: Math.PI - 0.38,
    text: 'APEX SWEEP  •  58° RIGHT BANK',
    color: '#fbbf24',
    scale: 1.2,
  });

  // --- 9. RAMP 8: 60° THREAD-THE-NEEDLE DIVE + OVERHEAD ARCH ---
  builder.addSurfRampBrush('col_ramp_s3_dive', {
    start: [12020, 3260, 520],
    end: [12620, 1980, 210],
    angleDeg: 60,
    height: 430,
    topWidth: 24,
    sides: 'both',
    style: 'steep',
  });

  builder.addBoxBrush('arch_pillar_w', 11780, 2580, -40, 11840, 2660, 860, 'slate');
  builder.addBoxBrush('arch_pillar_e', 12800, 2580, -40, 12860, 2660, 860, 'slate');
  builder.addBoxBrush('arch_beam_top', 11780, 2580, 820, 12860, 2660, 890, 'steep');
  signs.push({
    x: 12320,
    y: 2620,
    z: 945,
    yaw: Math.PI * 0.5,
    text: '60° SPEED DIVE  •  BLAST CANYON AHEAD',
    color: '#f87171',
    scale: 1.25,
  });

  // --- 10. BLAST CANYON (rebalanced to ~1460 u/s onto Stage 4 Slalom) ---
  builder.addBoxBrush('canyon_pad', 12260, 1340, -10, 12960, 1880, 30, 'booster');
  builder.addTrigger('trig_exp_canyon', 'explosion', 12280, 1360, 30, 12940, 1860, 620, {
    originX: 12580,
    originY: 1940,
    originZ: -140,
    maxDamage: 28000,
    radius: 880,
    pushScale: 1.0,
    cooldownTicks: 38,
  });
  builder.addTrigger('trig_push_3', 'push', 12260, 1340, 30, 12960, 1880, 340, {
    mode: 'hybrid',
    dirX: -0.14,
    dirY: -0.94,
    dirZ: 0.34,
    addSpeed: 260,
    minSpeedXY: 1460,
    minVelZ: 680,
  });
  signs.push({
    x: 12610,
    y: 1610,
    z: 685,
    yaw: Math.PI * 0.5,
    text: 'BLAST CANYON  •  RADIAL IMPULSE',
    color: '#f97316',
    scale: 1.2,
  });

  // =========================================================================
  // STAGE 4: CHECKPOINT 4, SOUTH SLALOM, 62° HYPER-WALL & CITADEL FINISH
  // =========================================================================

  // Stage 4 Checkpoint Trigger (covers flight into Ramp 9 South Slalom)
  builder.addTrigger('trig_cp_4', 'checkpoint', 12120, 680, 180, 12960, 1320, 920, {
      index: 4,
      label: 'STAGE 4 — SOUTH SLALOM',
      respawnX: 12640,
      respawnY: 880,
      respawnZ: 480,
      respawnYaw: -1.836,
      respawnPitch: -0.05,
      respawnVelX: -230,
      respawnVelY: -850,
      respawnVelZ: 0,
    });

  // --- 11. RAMP 9: 54° LEFT-SIDE SLALOM ---
  builder.addSurfRampBrush('col_ramp_s4_1', {
    start: [12520, 960, 560],
    end: [12140, -440, 370],
    angleDeg: 54,
    height: 410,
    topWidth: 24,
    sides: 'both',
    style: 'ramp',
  });
  signs.push({
    x: 12330,
    y: 260,
    z: 670,
    yaw: Math.PI * 0.5,
    text: 'STAGE 4  •  54° SLALOM LEFT',
    color: '#fbbf24',
    scale: 1.15,
  });

  // --- 12. RAMP 10: 58° COUNTER-SLALOM RIGHT ---
  builder.addSurfRampBrush('col_ramp_s4_2', {
    start: [12720, -760, 450],
    end: [12260, -2160, 250],
    angleDeg: 58,
    height: 420,
    topWidth: 24,
    sides: 'both',
    style: 'ramp',
  });

  // --- 13. RAMP 11: 62° HYPER-STEEP FINALE WEDGE ---
  builder.addSurfRampBrush('col_ramp_s4_hyper', {
    start: [11920, -2480, 360],
    end: [10960, -3560, 140],
    angleDeg: 62,
    height: 440,
    topWidth: 24,
    sides: 'both',
    style: 'steep',
  });
  signs.push({
    x: 11440,
    y: -3020,
    z: 490,
    yaw: Math.PI * 0.25,
    text: '62° HYPER-WEDGE  •  HOLD SPEED',
    color: '#f87171',
    scale: 1.2,
  });

  // --- 14. FINAL HYPER-LAUNCH (rebalanced to land cleanly on Citadel Finish) ---
  const b4x = 10460;
  const b4y = -3960;
  builder.addBoxBrush('booster_4_pad', b4x - 380, b4y - 380, -40, b4x + 380, b4y + 380, 0, 'booster');
  builder.addTrigger('trig_exp_finale', 'explosion', b4x - 340, b4y - 340, 0, b4x + 340, b4y + 340, 560, {
    originX: b4x + 240,
    originY: b4y + 150,
    originZ: -180,
    maxDamage: 26000,
    radius: 900,
    pushScale: 1.0,
    cooldownTicks: 40,
  });
  builder.addTrigger('trig_push_4', 'push', b4x - 380, b4y - 380, 0, b4x + 380, b4y + 380, 360, {
    mode: 'hybrid',
    dirX: -0.82,
    dirY: -0.44,
    dirZ: 0.56,
    addSpeed: 240,
    minSpeedXY: 1380,
    minVelZ: 1160,
  });
  signs.push({
    x: b4x,
    y: b4y,
    z: 610,
    yaw: 0.45,
    text: 'FINAL LAUNCH  •  CITADEL FINISH',
    color: '#22d3ee',
    scale: 1.25,
  });

  // --- 15. ELEVATED CITADEL FINISH PLATFORM (trig_end + Victory Crates) ---
  const finX = 9060;
  const finY = -4720;
  const finZ = 700;
  builder.addBoxBrush('finish_platform', finX - 440, finY - 440, finZ - 60, finX + 440, finY + 440, finZ, 'finish');
  builder.addBoxBrush('fin_p1', finX - 420, finY - 420, finZ, finX - 388, finY - 388, finZ + 280, 'finish');
  builder.addBoxBrush('fin_p2', finX + 388, finY - 420, finZ, finX + 420, finY - 388, finZ + 280, 'finish');
  builder.addBoxBrush('fin_p3', finX - 420, finY + 388, finZ, finX - 388, finY + 420, finZ + 280, 'finish');
  builder.addBoxBrush('fin_p4', finX + 388, finY + 388, finZ, finX + 420, finY + 420, finZ + 280, 'finish');
  builder.addTrigger('trig_end', 'end', finX - 420, finY - 420, finZ, finX + 420, finY + 420, finZ + 420);
  signs.push({
    x: finX,
    y: finY,
    z: finZ + 335,
    yaw: 0.45,
    text: 'CITADEL FINISH  •  TRIG_END',
    color: '#34d399',
    scale: 1.4,
  });

  // =========================================================================
  // SIDE CALIBRATION & VPHYSICS PROP LAB (LEFT OF SPAWN)
  // =========================================================================

  builder.addBoxBrush('calib_deck', -340, 230, 940, 560, 1680, 1000, 'slate');
  builder.addBoxBrush('lab_wall_n', -340, 1680, 1000, 560, 1704, 1140, 'slate');
  builder.addBoxBrush('lab_wall_w', -364, 230, 1000, -340, 1704, 1140, 'slate');
  builder.addBoxBrush('lab_wall_e', 560, 1180, 1000, 584, 1704, 1140, 'slate');

  signs.push({
    x: -60,
    y: 310,
    z: 1125,
    yaw: -Math.PI * 0.5,
    text: '← CALIBRATION & VPHYSICS PROP LAB',
    color: '#38bdf8',
    scale: 0.85,
  });

  const calibSpecs: Array<{ y: number; deg: number; style: BrushStyle; label: string; color: string }> = [
    { y: 420, deg: 30, style: 'walkable', label: '30° WALKABLE (nz=0.87)', color: '#2dd4bf' },
    { y: 650, deg: 46, style: 'ramp', label: '46° THRESHOLD (nz=0.69)', color: '#fbbf24' },
    { y: 880, deg: 52, style: 'ramp', label: '52° SURF WEDGE (nz=0.62)', color: '#fb923c' },
    { y: 1110, deg: 60, style: 'steep', label: '60° STEEP WEDGE (nz=0.50)', color: '#f87171' },
  ];

  for (const spec of calibSpecs) {
    const h = 110;
    builder.addSurfRampBrush(`col_calib_${spec.deg}`, {
      start: [90, spec.y, 1000 + h],
      end: [370, spec.y, 1000 + h],
      angleDeg: spec.deg,
      height: h,
      topWidth: 16,
      sides: 'both',
      style: spec.style,
    });
    signs.push({
      x: 230,
      y: spec.y,
      z: 1000 + h + 58,
      yaw: Math.PI,
      text: spec.label,
      color: spec.color,
      scale: 0.72,
    });
  }

  // 48u Crouch-Height Hull Calibration Tunnel
  builder.addBoxBrush('crouch_wall_l', -288, 640, 1000, -264, 940, 1110, 'slate');
  builder.addBoxBrush('crouch_wall_r', -116, 640, 1000, -92, 940, 1110, 'slate');
  builder.addBoxBrush('crouch_roof', -288, 640, 1048, -92, 940, 1110, 'ramp');
  signs.push({
    x: -190,
    y: 635,
    z: 1152,
    yaw: -Math.PI * 0.5,
    text: '48u CROUCH TUNNEL (STAND 72u / DUCK 36u)',
    color: '#fbbf24',
    scale: 0.72,
  });

  // Lab Blast Pad
  builder.addBoxBrush('lab_blast_pad', 240, 1340, 1000, 360, 1460, 1012, 'steep');
  builder.addTrigger('trig_exp_lab', 'explosion', 240, 1340, 1012, 360, 1460, 1120, {
    originX: 300,
    originY: 1400,
    originZ: 1006,
    maxDamage: 62000,
    radius: 540,
    pushScale: 1.25,
    cooldownTicks: 65,
  });
  signs.push({
    x: 110,
    y: 1645,
    z: 1190,
    yaw: -Math.PI * 0.5,
    text: 'VPHYSICS CRATES  •  STEP ON RED PAD OR PRESS F / G / X',
    color: '#f97316',
    scale: 0.85,
  });

  // =========================================================================
  // FAIL FLOOR TELEPORTER (covers full 4-stage world)
  // =========================================================================
  builder.addTrigger('trig_tp_fail', 'teleport', -3000, -7500, -800, 16000, 7000, -160, {
    dest: spawn,
  });

  const createRigidBodies = (): SourceRigidBody[] => [
    // Calibration Lab crates
    createBoxRigidBody('lab_crate_1', { x: 80, y: 1420, z: 1024 }, { x: 24, y: 24, z: 24 }, 38, { restitution: 0.35 }),
    createBoxRigidBody('lab_crate_2', { x: 80, y: 1474, z: 1024 }, { x: 24, y: 24, z: 24 }, 38, { restitution: 0.35 }),
    createBoxRigidBody('lab_crate_3', { x: 134, y: 1447, z: 1024 }, { x: 24, y: 24, z: 24 }, 38, { restitution: 0.35 }),
    createBoxRigidBody('lab_crate_top', { x: 105, y: 1447, z: 1074 }, { x: 22, y: 22, z: 22 }, 28, { restitution: 0.45 }),
    createBoxRigidBody('lab_heavy_block', { x: -120, y: 1460, z: 1030 }, { x: 30, y: 30, z: 30 }, 110, { restitution: 0.15 }),
    createBoxRigidBody('lab_bouncy_cube', { x: -40, y: 1320, z: 1020 }, { x: 18, y: 18, z: 18 }, 18, { restitution: 0.78 }),

    // Stage 3 Sky Deck crates
    createBoxRigidBody('s3_crate_1', { x: s3DeckX - 70, y: s3DeckY + 70, z: 766 }, { x: 24, y: 24, z: 24 }, 35, { restitution: 0.4 }),
    createBoxRigidBody('s3_crate_2', { x: s3DeckX + 70, y: s3DeckY - 70, z: 766 }, { x: 24, y: 24, z: 24 }, 35, { restitution: 0.4 }),

    // Blast Canyon crates
    createBoxRigidBody('canyon_crate_1', { x: 12460, y: 1580, z: 58 }, { x: 26, y: 26, z: 26 }, 32, { restitution: 0.5 }),
    createBoxRigidBody('canyon_crate_2', { x: 12740, y: 1580, z: 58 }, { x: 26, y: 26, z: 26 }, 32, { restitution: 0.5 }),

    // Citadel Finish Victory Stack
    createBoxRigidBody('fin_crate_1', { x: finX - 50, y: finY, z: finZ + 26 }, { x: 26, y: 26, z: 26 }, 30, { restitution: 0.45 }),
    createBoxRigidBody('fin_crate_2', { x: finX + 50, y: finY, z: finZ + 26 }, { x: 26, y: 26, z: 26 }, 30, { restitution: 0.45 }),
    createBoxRigidBody('fin_crate_3', { x: finX, y: finY + 55, z: finZ + 26 }, { x: 26, y: 26, z: 26 }, 30, { restitution: 0.45 }),
    createBoxRigidBody('fin_crate_top', { x: finX, y: finY + 18, z: finZ + 80 }, { x: 24, y: 24, z: 24 }, 22, { restitution: 0.55 }),
  ];

  return {
    brushes: builder.brushes,
    triggers: builder.triggers,
    signs,
    spawn,
    createRigidBodies,
  };
}

//and map 2 //surfSandbox02.ts

// src/maps/surfSandbox02.ts
import { ConvexBrush, TriggerVolume } from '../physics/BrushBuilder';
import {
  createBoxRigidBody,
  createTargetRigidBody,
  createWeaponRigidBody,
  SourceRigidBody,
  SpawnPoint,
} from '../physics/GoldSrcPhysicsEngine';
import { WorldSign } from './surfSandbox01';

export interface SurfMap02Data {
  brushes: ConvexBrush[];
  triggers: TriggerVolume[];
  signs: WorldSign[];
  spawn: SpawnPoint;
  createRigidBodies: () => SourceRigidBody[];
}

type BrushStyle = ConvexBrush['style'];

function makeBoxBrush(
  id: string,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
  style: BrushStyle = 'slate',
): ConvexBrush {
  return {
    id,
    style,
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    planes: [
      { nx: 1, ny: 0, nz: 0, d: maxX },
      { nx: -1, ny: 0, nz: 0, d: -minX },
      { nx: 0, ny: 1, nz: 0, d: maxY },
      { nx: 0, ny: -1, nz: 0, d: -minY },
      { nx: 0, ny: 0, nz: 1, d: maxZ },
      { nx: 0, ny: 0, nz: -1, d: -minZ },
    ],
    renderFaces: [
      {
        nx: 0,
        ny: 0,
        nz: 1,
        d: maxZ,
        verts: [
          [minX, minY, maxZ],
          [maxX, minY, maxZ],
          [maxX, maxY, maxZ],
          [minX, maxY, maxZ],
        ],
      },
      {
        nx: 0,
        ny: 0,
        nz: -1,
        d: -minZ,
        verts: [
          [minX, maxY, minZ],
          [maxX, maxY, minZ],
          [maxX, minY, minZ],
          [minX, minY, minZ],
        ],
      },
      {
        nx: 1,
        ny: 0,
        nz: 0,
        d: maxX,
        verts: [
          [maxX, minY, minZ],
          [maxX, maxY, minZ],
          [maxX, maxY, maxZ],
          [maxX, minY, maxZ],
        ],
      },
      {
        nx: -1,
        ny: 0,
        nz: 0,
        d: -minX,
        verts: [
          [minX, maxY, minZ],
          [minX, minY, minZ],
          [minX, minY, maxZ],
          [minX, maxY, maxZ],
        ],
      },
      {
        nx: 0,
        ny: 1,
        nz: 0,
        d: maxY,
        verts: [
          [maxX, maxY, minZ],
          [minX, maxY, minZ],
          [minX, maxY, maxZ],
          [maxX, maxY, maxZ],
        ],
      },
      {
        nx: 0,
        ny: -1,
        nz: 0,
        d: -minY,
        verts: [
          [minX, minY, minZ],
          [maxX, minY, minZ],
          [maxX, minY, maxZ],
          [minX, minY, maxZ],
        ],
      },
    ],
  };
}

/**
 * Symmetric A-frame surf ramp running along X (default height/halfW = 1.25 -> ~51.3 deg, n_z = 0.625 < 0.7).
 */
function makeSurfRampX(
  id: string,
  x0: number,
  x1: number,
  yCenter: number,
  halfW: number,
  zBot: number,
  zTop: number,
  style: BrushStyle = 'ramp',
): ConvexBrush {
  const h = zTop - zBot;
  const w = halfW;
  const len = Math.hypot(h, w);
  const nyL = h / len;
  const nzL = w / len;
  const nyR = -h / len;
  const nzR = w / len;

  const dLeft = nyL * yCenter + nzL * zTop;
  const dRight = nyR * yCenter + nzR * zTop;

  return {
    id,
    style,
    minX: x0,
    maxX: x1,
    minY: yCenter - w,
    maxY: yCenter + w,
    minZ: zBot,
    maxZ: zTop,
    planes: [
      { nx: 1, ny: 0, nz: 0, d: x1 },
      { nx: -1, ny: 0, nz: 0, d: -x0 },
      { nx: 0, ny: nyL, nz: nzL, d: dLeft },
      { nx: 0, ny: nyR, nz: nzR, d: dRight },
      { nx: 0, ny: 0, nz: -1, d: -zBot },
    ],
    renderFaces: [
      // +Y surf slope
      {
        nx: 0,
        ny: nyL,
        nz: nzL,
        d: dLeft,
        verts: [
          [x0, yCenter + w, zBot],
          [x0, yCenter, zTop],
          [x1, yCenter, zTop],
          [x1, yCenter + w, zBot],
        ],
      },
      // -Y surf slope
      {
        nx: 0,
        ny: nyR,
        nz: nzR,
        d: dRight,
        verts: [
          [x1, yCenter - w, zBot],
          [x1, yCenter, zTop],
          [x0, yCenter, zTop],
          [x0, yCenter - w, zBot],
        ],
      },
      // -X end cap
      {
        nx: -1,
        ny: 0,
        nz: 0,
        d: -x0,
        verts: [
          [x0, yCenter - w, zBot],
          [x0, yCenter, zTop],
          [x0, yCenter + w, zBot],
        ],
      },
      // +X end cap
      {
        nx: 1,
        ny: 0,
        nz: 0,
        d: x1,
        verts: [
          [x1, yCenter + w, zBot],
          [x1, yCenter, zTop],
          [x1, yCenter - w, zBot],
        ],
      },
      // Bottom
      {
        nx: 0,
        ny: 0,
        nz: -1,
        d: -zBot,
        verts: [
          [x0, yCenter + w, zBot],
          [x1, yCenter + w, zBot],
          [x1, yCenter - w, zBot],
          [x0, yCenter - w, zBot],
        ],
      },
    ],
  };
}

export function buildSurfSandbox02(): SurfMap02Data {
  const brushes: ConvexBrush[] = [];
  const triggers: TriggerVolume[] = [];
  const signs: WorldSign[] = [];

  // =========================================================================
  // 1. SPAWN DECK & COMBAT / WEAPON RANGE
  // =========================================================================
  brushes.push(
    makeBoxBrush('spawn_deck', -420, 420, -480, 480, 420, 460, 'slate'),
    makeBoxBrush('range_backstop', -420, 420, 456, 480, 460, 660, 'slate'),
    makeBoxBrush('armory_table', -240, -60, -340, -240, 460, 492, 'walkable'),
    makeBoxBrush('launch_lip', 420, 520, -220, 220, 430, 460, 'booster'),
  );

  triggers.push({
    id: 'trig_start',
    type: 'start',
    minX: 430,
    maxX: 520,
    minY: -220,
    maxY: 220,
    minZ: 460,
    maxZ: 680,
    meta: {},
  });

  // =========================================================================
  // 2. STAGE 1 — DUAL SURF RAMPS + BOOSTER PAD
  // =========================================================================
  brushes.push(
    makeSurfRampX('s1_ramp_1', 640, 2240, -210, 175, 100, 320, 'ramp'),
    makeSurfRampX('s1_ramp_2', 2380, 4050, 230, 175, 40, 260, 'ramp'),
    makeBoxBrush('s1_target_ledge', 2750, 3250, -360, -180, 180, 212, 'slate'),
    makeBoxBrush('s1_booster_pad', 4220, 4620, -140, 340, 140, 172, 'booster'),
  );

  triggers.push({
    id: 'trig_boost_1',
    type: 'push',
    minX: 4220,
    maxX: 4620,
    minY: -140,
    maxY: 340,
    minZ: 172,
    maxZ: 340,
    meta: {
      dirX: 1,
      dirY: 0,
      dirZ: 0.38,
      addSpeed: 420,
      minSpeedXY: 1480,
      minVelZ: 560,
      cooldownTicks: 24,
    },
  });

  // =========================================================================
  // 3. STAGE 2 — CHECKPOINT DECK, STEEP 58° SURF RAMPS & BLAST ZONE
  // =========================================================================
  brushes.push(
    makeBoxBrush('s2_checkpoint_deck', 4850, 5450, -260, 260, 320, 360, 'slate'),
    makeSurfRampX('s2_ramp_1', 5620, 7380, 240, 160, 80, 336, 'steep'),
    makeSurfRampX('s2_ramp_2', 7550, 9320, -240, 160, 20, 276, 'steep'),
    makeBoxBrush('s2_blast_bridge', 9480, 9980, -240, 240, 160, 192, 'slate'),
  );

  triggers.push(
    {
      id: 'trig_cp_2',
      type: 'checkpoint',
      minX: 4860,
      maxX: 5440,
      minY: -250,
      maxY: 250,
      minZ: 360,
      maxZ: 580,
      meta: {
        index: 2,
        label: 'STAGE 2 — COMBAT SURF',
        respawnX: 5150,
        respawnY: 0,
        respawnZ: 400,
        respawnYaw: 0,
        respawnPitch: 0,
      },
    },
    {
      id: 'trig_blast_2',
      type: 'explosion',
      minX: 9600,
      maxX: 9860,
      minY: -140,
      maxY: 140,
      minZ: 192,
      maxZ: 360,
      meta: {
        originX: 9730,
        originY: 0,
        originZ: 170,
        maxDamage: 62000,
        radius: 560,
        pushScale: 1.15,
        cooldownTicks: 75,
      },
    },
  );

  // =========================================================================
  // 4. STAGE 3 — FINAL SURF LAUNCH & COMBAT FINISH ARENA
  // =========================================================================
  brushes.push(
    makeSurfRampX('s3_ramp_final', 10180, 12100, 0, 185, 60, 300, 'ramp'),
    makeBoxBrush('finish_arena', 12350, 13450, -520, 520, 220, 260, 'finish'),
    makeBoxBrush('finish_wall_back', 13410, 13450, -520, 520, 260, 480, 'slate'),
  );

  triggers.push({
    id: 'trig_finish',
    type: 'end',
    minX: 12380,
    maxX: 13400,
    minY: -500,
    maxY: 500,
    minZ: 260,
    maxZ: 560,
    meta: {},
  });

  // =========================================================================
  // 5. GLOBAL FAIL FLOOR TELEPORT TRIGGER
  // =========================================================================
  triggers.push({
    id: 'trig_fail_floor',
    type: 'teleport',
    minX: -2000,
    maxX: 16000,
    minY: -5000,
    maxY: 5000,
    minZ: -600,
    maxZ: -170,
    meta: {},
  });

  // =========================================================================
  // 6. WORLD SIGNS
  // =========================================================================
  signs.push(
    {
      x: 420,
      y: 0,
      z: 590,
      yaw: 0,
      scale: 1.1,
      text: 'SURF SANDBOX 02 — COMBAT & WEAPONS',
      color: '#38bdf8',
    },
    {
      x: 0,
      y: 448,
      z: 615,
      yaw: -Math.PI * 0.5,
      scale: 1.0,
      text: 'SHOOT / KNIFE TARGETS — BLOOD & VPHYSICS TEST',
      color: '#f87171',
    },
    {
      x: -150,
      y: -360,
      z: 555,
      yaw: Math.PI * 0.5,
      scale: 0.85,
      text: 'ARMORY: G DROP • E PICK UP WEAPONS',
      color: '#fbbf24',
    },
    {
      x: 5150,
      y: 0,
      z: 510,
      yaw: 0,
      scale: 1.0,
      text: 'STAGE 2 CHECKPOINT — STEEP 58° RAMPS',
      color: '#c084fc',
    },
    {
      x: 13390,
      y: 0,
      z: 410,
      yaw: Math.PI,
      scale: 1.15,
      text: 'FINISH ARENA — CLEAR THE TARGETS',
      color: '#34d399',
    },
  );

  // =========================================================================
  // 7. INITIAL VPHYSICS RIGID BODIES (TARGETS, CRATES, GROUND WEAPONS)
  // =========================================================================
  const createRigidBodies = (): SourceRigidBody[] => [
    createTargetRigidBody('spawn_target_1', { x: -160, y: 360, z: 500 }, 100),
    createTargetRigidBody('spawn_target_2', { x: 0, y: 380, z: 500 }, 100),
    createTargetRigidBody('spawn_target_3', { x: 160, y: 360, z: 500 }, 100),

    createBoxRigidBody('spawn_crate_1', { x: 240, y: -260, z: 486 }, { x: 22, y: 22, z: 22 }, 32, {
      hp: 80,
      restitution: 0.35,
    }),
    createBoxRigidBody('spawn_crate_2', { x: 240, y: -260, z: 534 }, { x: 20, y: 20, z: 20 }, 24, {
      hp: 60,
      restitution: 0.38,
    }),
    createBoxRigidBody('spawn_crate_3', { x: 290, y: -260, z: 486 }, { x: 22, y: 22, z: 22 }, 32, {
      hp: 80,
      restitution: 0.35,
    }),

    createWeaponRigidBody(
      'armory_scout_1',
      { x: -190, y: -290, z: 504 },
      { slot: 1, clipAmmo: 10, reserveAmmo: 90, pickupCooldownTick: 0 },
    ),
    createWeaponRigidBody(
      'armory_usp_1',
      { x: -105, y: -290, z: 502 },
      { slot: 2, clipAmmo: 12, reserveAmmo: 100, silenced: true, pickupCooldownTick: 0 },
    ),

    createTargetRigidBody('s1_target_1', { x: 2900, y: -270, z: 252 }, 75),
    createTargetRigidBody('s1_target_2', { x: 3100, y: -270, z: 252 }, 75),

    createBoxRigidBody('s2_crate_1', { x: 5300, y: -150, z: 386 }, { x: 22, y: 22, z: 22 }, 30, {
      hp: 80,
    }),
    createWeaponRigidBody(
      's2_ground_scout',
      { x: 5260, y: 150, z: 372 },
      { slot: 1, clipAmmo: 10, reserveAmmo: 60, pickupCooldownTick: 0 },
    ),

    createTargetRigidBody('fin_target_1', { x: 12950, y: -220, z: 300 }, 100),
    createTargetRigidBody('fin_target_2', { x: 13080, y: 0, z: 300 }, 100),
    createTargetRigidBody('fin_target_3', { x: 12950, y: 220, z: 300 }, 100),
    createBoxRigidBody('fin_crate_1', { x: 12780, y: -80, z: 286 }, { x: 24, y: 24, z: 24 }, 36, {
      hp: 90,
    }),
    createBoxRigidBody('fin_crate_2', { x: 12780, y: 80, z: 286 }, { x: 24, y: 24, z: 24 }, 36, {
      hp: 90,
    }),
  ];

  return {
    brushes,
    triggers,
    signs,
    spawn: { x: -140, y: 0, z: 500, yaw: 0, pitch: 0 },
    createRigidBodies,
  };
}

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
  linearDamping?: number;
}

export interface RigidBody {
  id: string;
  posX: number;
  posY: number;
  posZ: number;
  velX: number;
  velY: number;
  velZ: number;
  hx: number;
  hy: number;
  hz: number;
  mass: number;
  restitution: number;
  gravityScale: number;
}

export interface PhysicsCallbacks {
  onLand?: (impactSpeed: number) => void;
  onJump?: () => void;
  onStartRun?: () => void;
  onFinishRun?: () => void;
  onBoost?: (triggerId: string) => void;
  onTeleport?: (isFail: boolean) => void;
  onRigidBodyHit?: (bodyId: string, impulseMag: number) => void;
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

export class GoldSrcPhysicsEngine {
  private readonly abi: PhysicsMemoryAbi;
  private readonly brushes: ConvexBrush[];
  private readonly triggers: TriggerVolume[];
  private readonly rigidBodies: RigidBody[];
  private readonly spawn: SpawnPoint;
  private readonly callbacks: PhysicsCallbacks;
  private readonly sourceConfig: Required<SourcePhysicsConfig>;

  private readonly pushCooldowns = new Map<string, number>();
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
    rigidBodies: RigidBody[] = [],
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
      linearDamping: sourceConfig.linearDamping ?? 0.02,
    };
  }

  public getRigidBodies(): readonly RigidBody[] {
    return this.rigidBodies;
  }

  public addRigidBody(body: RigidBody): void {
    this.rigidBodies.push(body);
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
    this.pushCooldowns.clear();
    this.callbacks.onTeleport?.(isFail);
  }

  public simulateTick(): void {
    const { f32: vf, i32: vi } = this.abi;

    // Save previous transform for high-refresh-rate render interpolation
    vf[F32.PREV_X] = vf[F32.POS_X];
    vf[F32.PREV_Y] = vf[F32.POS_Y];
    vf[F32.PREV_Z] = vf[F32.POS_Z];
    vf[F32.PREV_VIEW_OFS_Z] = vf[F32.VIEW_OFS_Z];

    vi[I32.TICK] += 1;
    vf[F32.SURF_NZ] = f32(0);

    const wasOnGround = (vi[I32.FLAGS] & FL_ONGROUND) !== 0;
    const preVelZ = vf[F32.VEL_Z];

    // 1. Update duck state & hull
    this.duck();

    // 2. Categorize ground/air position
    this.categorizePosition();

    // 3. Jump check (supports Auto-Bhop or exact fresh jump / scroll-wheel input)
    const buttons = vi[I32.BUTTONS];
    const prevButtons = vi[I32.PREV_BUTTONS];
    const autoBhop = vi[I32.AUTOBHOP] === 1;
    const jumpPressed = (buttons & IN_JUMP) !== 0;
    const freshJump = jumpPressed && (autoBhop || (prevButtons & IN_JUMP) === 0);

    if (freshJump && (vi[I32.FLAGS] & FL_ONGROUND)) {
      vi[I32.FLAGS] &= ~FL_ONGROUND;
      // Jump impulse: sqrt(2 * gravity * 45) ≈ 268.328 u/s
      vf[F32.VEL_Z] = f32(Math.sqrt(2.0 * vf[F32.CVAR_GRAVITY] * 45.0));
      this.callbacks.onJump?.();
    }

    // 4. First half of gravity step (only while airborne)
    const isGroundedNow = (vi[I32.FLAGS] & FL_ONGROUND) !== 0;
    if (!isGroundedNow) {
      vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] - 0.5 * vf[F32.CVAR_GRAVITY] * FIXED_DT);
    }

    // Apply Source basevelocity before movement sweep
    if (this.baseVelX !== 0 || this.baseVelY !== 0 || this.baseVelZ !== 0) {
      vf[F32.VEL_X] = f32(vf[F32.VEL_X] + this.baseVelX);
      vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] + this.baseVelY);
      vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] + this.baseVelZ);
    }

    // 5. Compute horizontal wish vector from view yaw & WASD move axes
    const yaw = vf[F32.CMD_YAW];
    const fwdX = Math.cos(yaw);
    const fwdY = Math.sin(yaw);
    const rightX = Math.sin(yaw);
    const rightY = -Math.cos(yaw);

    const fmove = vf[F32.CMD_FMOVE];
    const smove = vf[F32.CMD_SMOVE];
    const maxSpeed =
      (vi[I32.FLAGS] & FL_DUCKING) && isGroundedNow
        ? f32(vf[F32.CMD_MAXSPEED] * 0.34)
        : vf[F32.CMD_MAXSPEED];

    let wishX = f32(fwdX * fmove + rightX * smove);
    let wishY = f32(fwdY * fmove + rightY * smove);
    let wishspeed = f32(Math.hypot(wishX, wishY));
    if (wishspeed > 0.0001) {
      wishX = f32(wishX / wishspeed);
      wishY = f32(wishY / wishspeed);
    }
    if (wishspeed > maxSpeed) wishspeed = maxSpeed;

    // 6. Ground vs Air/Surf movement branch
    let flyBlocked = 0;
    if (isGroundedNow) {
      this.friction();
      this.walkMove(wishX, wishY, wishspeed);
    } else {
      flyBlocked = this.airMove(wishX, wishY, wishspeed);
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
      vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] - 0.5 * vf[F32.CVAR_GRAVITY] * FIXED_DT);
    } else {
      vf[F32.VEL_Z] = f32(0);
      if (!wasOnGround && preVelZ < -140) {
        this.callbacks.onLand?.(Math.abs(preVelZ));
      }
    }

    // 8. Source VPhysics-style rigid bodies & player-prop collision resolution
    if (this.rigidBodies.length > 0) {
      this.stepRigidBodies();
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

    // 10. Check triggers (start, end, push boosters, fail teleporter)
    this.checkTriggers();

    vi[I32.PREV_BUTTONS] = buttons;
  }

  /** Step VPhysics-style rigid bodies against world convex brushes */
  private stepRigidBodies(): void {
    const gravity = this.abi.f32[F32.CVAR_GRAVITY];
    const dampingFactor = f32(Math.max(0, 1.0 - this.sourceConfig.linearDamping * FIXED_DT));
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

      b.velZ = f32(b.velZ - gravity * b.gravityScale * FIXED_DT);
      b.velX = f32(b.velX * dampingFactor);
      b.velY = f32(b.velY * dampingFactor);
      b.velZ = f32(b.velZ * dampingFactor);

      const targetX = f32(b.posX + b.velX * FIXED_DT);
      const targetY = f32(b.posY + b.velY * FIXED_DT);
      const targetZ = f32(b.posZ + b.velZ * FIXED_DT);

      this.traceWorld(b.posX, b.posY, b.posZ, targetX, targetY, targetZ, b.hx, b.hy, b.hz, traceOut);

      b.posX = traceOut.endX;
      b.posY = traceOut.endY;
      b.posZ = traceOut.endZ;

      if (traceOut.fraction < 1.0) {
        const vn = f32(
          b.velX * traceOut.normalX + b.velY * traceOut.normalY + b.velZ * traceOut.normalZ,
        );
        if (vn < 0) {
          const bounce = f32(1.0 + Math.max(b.restitution, this.sourceConfig.svBounce));
          b.velX = f32(b.velX - traceOut.normalX * vn * bounce);
          b.velY = f32(b.velY - traceOut.normalY * vn * bounce);
          b.velZ = f32(b.velZ - traceOut.normalZ * vn * bounce);

          // Ground contact friction for rigid bodies
          if (traceOut.normalZ >= SURF_NORMAL_Z) {
            b.velX = f32(b.velX * 0.92);
            b.velY = f32(b.velY * 0.92);
            if (Math.abs(b.velZ) < 12) b.velZ = f32(0);
          }
        }
      }
    }
  }

  /** Resolve AABB overlap and impulse transfer between player hull and rigid bodies */
  private resolvePlayerRigidBodyCollisions(): void {
    const vf = this.abi.f32;
    const phx = HULL_STAND.hx;
    const phy = HULL_STAND.hy;
    const phz = this.getHullHalfZ();

    const pMass = Math.max(1, this.sourceConfig.playerMass);
    const pInvMass = 1 / pMass;

    for (let i = 0; i < this.rigidBodies.length; i++) {
      const b = this.rigidBodies[i];
      if (b.mass <= 0) continue;

      const dx = vf[F32.POS_X] - b.posX;
      const dy = vf[F32.POS_Y] - b.posY;
      const dz = vf[F32.POS_Z] - b.posZ;

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

      const bInvMass = 1 / b.mass;
      const totalInvMass = pInvMass + bInvMass;
      const pShare = pInvMass / totalInvMass;
      const bShare = bInvMass / totalInvMass;

      // Positional separation along minimum penetration axis
      vf[F32.POS_X] = f32(vf[F32.POS_X] + nx * pen * pShare);
      vf[F32.POS_Y] = f32(vf[F32.POS_Y] + ny * pen * pShare);
      vf[F32.POS_Z] = f32(vf[F32.POS_Z] + nz * pen * pShare);

      b.posX = f32(b.posX - nx * pen * bShare);
      b.posY = f32(b.posY - ny * pen * bShare);
      b.posZ = f32(b.posZ - nz * pen * bShare);

      // Relative velocity along contact normal (normal points from body toward player)
      const rvx = vf[F32.VEL_X] - b.velX;
      const rvy = vf[F32.VEL_Y] - b.velY;
      const rvz = vf[F32.VEL_Z] - b.velZ;
      const velAlongNormal = rvx * nx + rvy * ny + rvz * nz;

      if (velAlongNormal > 0) continue;

      const e = Math.max(b.restitution, this.sourceConfig.svBounce);
      const j = (-(1 + e) * velAlongNormal) / totalInvMass;
      const ix = j * nx;
      const iy = j * ny;
      const iz = j * nz;

      vf[F32.VEL_X] = f32(vf[F32.VEL_X] + ix * pInvMass);
      vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] + iy * pInvMass);
      vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] + iz * pInvMass);

      b.velX = f32(b.velX - ix * bInvMass);
      b.velY = f32(b.velY - iy * bInvMass);
      b.velZ = f32(b.velZ - iz * bInvMass);

      this.callbacks.onRigidBodyHit?.(b.id, Math.abs(j));
    }
  }

  /**
   * GoldSrc/Quake ClipBoxToBrush using Minkowski plane expansion:
   *   offset = |nx|*hx + |ny|*hy + |nz|*hz
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
      const dist = f32(p.d + offset);
      const d1 = f32(p.nx * sX + p.ny * sY + p.nz * sZ - dist);
      const d2 = f32(p.nx * eX + p.ny * eY + p.nz * eZ - dist);

      if (d1 > 0) startsOut = true;
      if (d2 > 0) getsOut = true;

      if (d1 > 0 && (d2 >= DIST_EPSILON || d2 >= d1)) return;
      if (d1 <= 0 && d2 <= 0) continue;

      if (d1 > d2) {
        let f = f32((d1 - DIST_EPSILON) / (d1 - d2));
        if (f < 0) f = f32(0);
        if (f > enterFrac) {
          enterFrac = f;
          clipPlane = p;
        }
      } else {
        let f = f32((d1 + DIST_EPSILON) / (d1 - d2));
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

  /** PM_ClipVelocity: projects incoming velocity along collision plane with bounce support */
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

  /** AirAccelerate: wishspeed capped at 30.0 u/s for projection */
  private airAccelerate(
    wishX: number,
    wishY: number,
    wishZ: number,
    wishspeed: number,
    accel: number,
  ): void {
    const vf = this.abi.f32;
    const wishspd = wishspeed > AIR_WISH_CAP ? AIR_WISH_CAP : wishspeed;
    const currentspeed = f32(
      vf[F32.VEL_X] * wishX + vf[F32.VEL_Y] * wishY + vf[F32.VEL_Z] * wishZ,
    );
    const addspeed = f32(wishspd - currentspeed);
    if (addspeed <= 0) return;

    let accelspeed = f32(accel * wishspeed * FIXED_DT);
    if (accelspeed > addspeed) accelspeed = addspeed;

    vf[F32.VEL_X] = f32(vf[F32.VEL_X] + accelspeed * wishX);
    vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] + accelspeed * wishY);
    vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] + accelspeed * wishZ);
  }

  /** Accelerate (Ground only) */
  private accelerate(
    wishX: number,
    wishY: number,
    wishZ: number,
    wishspeed: number,
    accel: number,
  ): void {
    const vf = this.abi.f32;
    const currentspeed = f32(
      vf[F32.VEL_X] * wishX + vf[F32.VEL_Y] * wishY + vf[F32.VEL_Z] * wishZ,
    );
    const addspeed = f32(wishspeed - currentspeed);
    if (addspeed <= 0) return;

    let accelspeed = f32(accel * FIXED_DT * wishspeed);
    if (accelspeed > addspeed) accelspeed = addspeed;

    vf[F32.VEL_X] = f32(vf[F32.VEL_X] + accelspeed * wishX);
    vf[F32.VEL_Y] = f32(vf[F32.VEL_Y] + accelspeed * wishY);
    vf[F32.VEL_Z] = f32(vf[F32.VEL_Z] + accelspeed * wishZ);
  }

  /** Friction with leading-edge drop-off detection (Ground only) */
  private friction(): void {
    const vf = this.abi.f32;
    const vx = vf[F32.VEL_X];
    const vy = vf[F32.VEL_Y];
    const vz = vf[F32.VEL_Z];
    const speed = f32(Math.hypot(vx, vy, vz));
    if (speed < 0.1) return;

    let friction = vf[F32.CVAR_FRICTION];
    const hz = this.getHullHalfZ();

    const leadX = f32(vf[F32.POS_X] + (vx / speed) * 16.0);
    const leadY = f32(vf[F32.POS_Y] + (vy / speed) * 16.0);
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
      friction = f32(friction * vf[F32.CVAR_EDGEFRIC]);
    }

    const stopspeed = vf[F32.CVAR_STOPSPEED];
    const control = speed < stopspeed ? stopspeed : speed;
    const drop = f32(control * friction * FIXED_DT);

    let newspeed = f32(speed - drop);
    if (newspeed < 0) newspeed = f32(0);
    newspeed = f32(newspeed / speed);

    vf[F32.VEL_X] = f32(vx * newspeed);
    vf[F32.VEL_Y] = f32(vy * newspeed);
    vf[F32.VEL_Z] = f32(vz * newspeed);
  }

  /**
   * FlyMove: multi-plane iterative sliding (up to 4 bumps)
   * with crease cross-product resolution when sliding against 2 planes simultaneously.
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

  /** CategorizePosition: sets/clears FL_ONGROUND and detects surf ramps */
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

  /** WalkMove with step-up handling */
  private walkMove(wishX: number, wishY: number, wishspeed: number): void {
    const vf = this.abi.f32;
    vf[F32.VEL_Z] = f32(0);
    this.accelerate(wishX, wishY, f32(0), wishspeed, vf[F32.CVAR_ACCEL]);
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

  /** AirMove: computes horizontal wishdir & runs airAccelerate + flyMove */
  private airMove(wishX: number, wishY: number, wishspeed: number): number {
    this.airAccelerate(wishX, wishY, f32(0), wishspeed, this.abi.f32[F32.CVAR_AIRACCEL]);
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
      } else if (t.type === 'push') {
        const lastTick = this.pushCooldowns.get(t.id) ?? -999;
        if (tick - lastTick >= 22) {
          this.pushCooldowns.set(t.id, tick);
          const dirX = t.meta.dirX ?? 1;
          const dirY = t.meta.dirY ?? 0;
          const dirZ = t.meta.dirZ ?? 0.5;
          const addSpeed = t.meta.addSpeed ?? 500;
          const minSpeedXY = t.meta.minSpeedXY ?? 1500;
          const minVelZ = t.meta.minVelZ ?? 600;

          // Route pusher impulse through Source basevelocity for clean movement integration
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

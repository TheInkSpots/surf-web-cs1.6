import { f32 } from './constants';


export const MAX_ACTORS = 16;

export const enum TeamId {
  SPEC = 0,
  T = 1,
  CT = 2,
}

export const enum HitGroup {
  GENERIC = 0,
  HEAD = 1,
  CHEST = 2,
  STOMACH = 3,
  LEGS = 4,
}

export const HITGROUP_DAMAGE_MULT: Record<HitGroup, number> = {
  [HitGroup.GENERIC]: 1.0,
  [HitGroup.HEAD]: 4.0,
  [HitGroup.CHEST]: 1.0,
  [HitGroup.STOMACH]: 1.25,
  [HitGroup.LEGS]: 0.75,
};

// Per-actor Float32 layout (16 floats = 64 bytes per actor -> cache-line aligned)
export const enum ActorF32 {
  POS_X = 0,
  POS_Y = 1,
  POS_Z = 2,
  VEL_X = 3,
  VEL_Y = 4,
  VEL_Z = 5,
  BASE_VEL_X = 6,
  BASE_VEL_Y = 7,
  BASE_VEL_Z = 8,
  YAW = 9,
  PREV_YAW = 10,
  PITCH = 11,
  VIEW_OFS_Z = 12,
  SURF_NZ = 13,
  CMD_FMOVE = 14,
  CMD_SMOVE = 15,
}
export const ACTOR_F32_STRIDE = 16;

// Per-actor Int32 layout (16 ints = 64 bytes per actor)
export const enum ActorI32 {
  ACTIVE = 0,          // 0 = free slot, 1 = active
  IS_BOT = 1,          // 0 = human, 1 = bot
  TEAM = 2,            // TeamId (0=SPEC, 1=T, 2=CT)
  ALIVE = 3,           // 0/1
  HP = 4,              // 0..100
  ARMOR = 5,           // 0..100
  HAS_HELMET = 6,      // 0/1
  CASH = 7,            // 0..16000
  FLAGS = 8,           // FL_ONGROUND | FL_DUCKING
  MOVE_STATE = 9,      // MoveState enum
  BUTTONS = 10,        // IN_JUMP | IN_DUCK | IN_ATTACK | ...
  PREV_BUTTONS = 11,
  ACTIVE_SLOT = 12,    // 1=Scout, 2=USP, 3=Knife, 5=HE
  WEAPON_MASK = 13,    // Bitmask of owned slots (bit 1, 2, 3, 5)
  GROUND_ACTOR = 14,   // -1 = world/air, >=0 = actorId stood on (head-boost)
  MODEL_VARIANT = 15,  // 0 = Phoenix/SAS, 1 = Leet/GIGN
}
export const ACTOR_I32_STRIDE = 16;
export const F32 = {
  POS_X: 0,
  POS_Y: 1,
  POS_Z: 2,
  VEL_X: 3,
  VEL_Y: 4,
  VEL_Z: 5,
  PREV_X: 6,
  PREV_Y: 7,
  PREV_Z: 8,
  YAW: 9,
  PITCH: 10,
  VIEW_OFS_Z: 11,
  PREV_VIEW_OFS_Z: 12,
  SURF_NZ: 13,

  // Server Physics CVars
  CVAR_AIRACCEL: 32,
  CVAR_MAXVEL: 33,
  CVAR_GRAVITY: 34,
  CVAR_ACCEL: 35,
  CVAR_FRICTION: 36,
  CVAR_STOPSPEED: 37,
  CVAR_EDGEFRIC: 38,

  // UserCmd
  CMD_FMOVE: 48,
  CMD_SMOVE: 49,
  CMD_YAW: 50,
  CMD_PITCH: 51,
  CMD_MAXSPEED: 52,
} as const;

export const I32 = {
  FLAGS: 0,
  BUTTONS: 1,
  PREV_BUTTONS: 2,
  MOVESTATE: 3,
  TICK: 4,
  WEAPON: 5,
  AUTOBHOP: 6,
  LEGACY_SCOUT: 7,
} as const;

// Byte offsets in WebAssembly.Memory (after existing single-player header & CVars):
export const ACTOR_F32_BASE_INDEX = 64;  // Float32 index (byte 256)
export const ACTOR_I32_BASE_INDEX = 64;  // Int32 index (offset inside i32 view)

// Add these helper methods onto PhysicsMemoryAbi:
export function actorF32Idx(actorId: number, field: ActorF32): number {
  return ACTOR_F32_BASE_INDEX + actorId * ACTOR_F32_STRIDE + field;
}

export function actorI32Idx(actorId: number, field: ActorI32): number {
  return ACTOR_I32_BASE_INDEX + actorId * ACTOR_I32_STRIDE + field;
}

export function initActorSlot(
  f32View: Float32Array,
  i32View: Int32Array,
  actorId: number,
  team: TeamId,
  isBot: boolean,
  x: number,
  y: number,
  z: number,
  yaw: number,
): void {
  const f = ACTOR_F32_BASE_INDEX + actorId * ACTOR_F32_STRIDE;
  const i = ACTOR_I32_BASE_INDEX + actorId * ACTOR_I32_STRIDE;

  f32View[f + ActorF32.POS_X] = f32(x);
  f32View[f + ActorF32.POS_Y] = f32(y);
  f32View[f + ActorF32.POS_Z] = f32(z);
  f32View[f + ActorF32.VEL_X] = 0;
  f32View[f + ActorF32.VEL_Y] = 0;
  f32View[f + ActorF32.VEL_Z] = 0;
  f32View[f + ActorF32.BASE_VEL_X] = 0;
  f32View[f + ActorF32.BASE_VEL_Y] = 0;
  f32View[f + ActorF32.BASE_VEL_Z] = 0;
  f32View[f + ActorF32.YAW] = f32(yaw);
  f32View[f + ActorF32.PREV_YAW] = f32(yaw);
  f32View[f + ActorF32.PITCH] = 0;
  f32View[f + ActorF32.VIEW_OFS_Z] = f32(28);
  f32View[f + ActorF32.SURF_NZ] = 0;
  f32View[f + ActorF32.CMD_FMOVE] = 0;
  f32View[f + ActorF32.CMD_SMOVE] = 0;

  i32View[i + ActorI32.ACTIVE] = 1;
  i32View[i + ActorI32.IS_BOT] = isBot ? 1 : 0;
  i32View[i + ActorI32.TEAM] = team;
  i32View[i + ActorI32.ALIVE] = 1;
  i32View[i + ActorI32.HP] = 100;
  i32View[i + ActorI32.ARMOR] = 0;
  i32View[i + ActorI32.HAS_HELMET] = 0;
  i32View[i + ActorI32.CASH] = 800;
  i32View[i + ActorI32.FLAGS] = 0;
  i32View[i + ActorI32.MOVE_STATE] = 0;
  i32View[i + ActorI32.BUTTONS] = 0;
  i32View[i + ActorI32.PREV_BUTTONS] = 0;
  i32View[i + ActorI32.ACTIVE_SLOT] = 2; // USP .45 default sidearm
  i32View[i + ActorI32.WEAPON_MASK] = (1 << 2) | (1 << 3);
  i32View[i + ActorI32.GROUND_ACTOR] = -1;
  i32View[i + ActorI32.MODEL_VARIANT] = actorId & 1;
}
export const F32_BUFFER_LENGTH = ACTOR_F32_BASE_INDEX + MAX_ACTORS * ACTOR_F32_STRIDE; // 320 floats = 1280 bytes
export const I32_BYTE_OFFSET = 2048; // Aligned past f32 with headroom (fits in 1 Wasm page)
export const I32_BUFFER_LENGTH = ACTOR_I32_BASE_INDEX + MAX_ACTORS * ACTOR_I32_STRIDE; // 320 ints = 1280 bytes
export class PhysicsMemoryAbi {
  public readonly memory: WebAssembly.Memory;
  public readonly f32: Float32Array;
  public readonly i32: Int32Array;

  constructor(pages = 2) {
      this.memory = new WebAssembly.Memory({ initial: pages });
      this.f32 = new Float32Array(this.memory.buffer, 0, F32_BUFFER_LENGTH);
      this.i32 = new Int32Array(this.memory.buffer, I32_BYTE_OFFSET, I32_BUFFER_LENGTH);
      this.resetCvars();
    }


  public resetCvars(): void {
    this.f32[F32.CVAR_AIRACCEL] = f32(100.0);
    this.f32[F32.CVAR_MAXVEL] = f32(3500.0);
    this.f32[F32.CVAR_GRAVITY] = f32(800.0);
    this.f32[F32.CVAR_ACCEL] = f32(10.0);
    this.f32[F32.CVAR_FRICTION] = f32(4.0);
    this.f32[F32.CVAR_STOPSPEED] = f32(100.0);
    this.f32[F32.CVAR_EDGEFRIC] = f32(2.0);
    this.i32[I32.WEAPON] = 1;
    this.i32[I32.AUTOBHOP] = 1;
    this.i32[I32.LEGACY_SCOUT] = 0;
    // Add to your existing F32 / I32 CVar enums:
    // I32.CVAR_SOLID_TEAMMATES (0 = semiclip, 1 = solid boosting)
    // I32.CVAR_FRIENDLY_FIRE   (0 = off, 1 = on)
    // I32.ACTOR_COUNT
  }
}

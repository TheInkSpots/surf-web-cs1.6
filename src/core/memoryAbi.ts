import { f32 } from './constants';

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

export class PhysicsMemoryAbi {
  public readonly memory: WebAssembly.Memory;
  public readonly f32: Float32Array;
  public readonly i32: Int32Array;

  constructor(pages = 2) {
    this.memory = new WebAssembly.Memory({ initial: pages });
    this.f32 = new Float32Array(this.memory.buffer, 0, 256);
    this.i32 = new Int32Array(this.memory.buffer, 1024, 64);
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
  }
}

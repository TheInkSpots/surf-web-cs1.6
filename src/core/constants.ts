// src/core/constants.ts
export const f32 = Math.fround;

export const FIXED_DT = f32(0.01);
export const DIST_EPSILON = f32(0.03125);
export const STOP_EPSILON = f32(0.1);
export const MAX_CLIP_PLANES = 5;
export const STEPSIZE = f32(18.0);
export const SURF_NORMAL_Z = f32(0.7);
export const AIR_WISH_CAP = f32(30.0);

export const HULL_STAND = { hx: f32(16.0), hy: f32(16.0), hz: f32(36.0), eyeZ: f32(28.0) };
export const HULL_DUCK  = { hx: f32(16.0), hy: f32(16.0), hz: f32(18.0), eyeZ: f32(12.0) };

export const FL_ONGROUND = 1;
export const FL_DUCKING  = 2;

export const IN_JUMP = 1;
export const IN_DUCK = 2;

export const MoveState = {
  GROUND: 0,
  AIR: 1,
  SURF: 2,
} as const;

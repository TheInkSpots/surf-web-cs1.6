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

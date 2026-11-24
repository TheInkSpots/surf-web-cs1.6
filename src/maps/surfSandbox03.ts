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

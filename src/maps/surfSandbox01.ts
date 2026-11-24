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

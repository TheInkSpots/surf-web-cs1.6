import { f32 } from '../core/constants';
import { BrushBuilder, BrushStyle, ConvexBrush, TriggerVolume } from '../physics/BrushBuilder';
import { SpawnPoint } from '../physics/GoldSrcPhysicsEngine';

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

  // --- 1. ELEVATED SPAWN PLATFORM ---
  builder.addBoxBrush('spawn_deck', -340, -230, 940, 10, 230, 1000, 'slate');
  builder.addBoxBrush('spawn_back_wall', -356, -230, 1000, -340, 230, 1072, 'slate');
  builder.addBoxBrush('spawn_right_rail', -340, -246, 1000, 10, -230, 1044, 'slate');

  // Start Gate pillars & trig_start volume
  builder.addBoxBrush('start_pillar_l', -14, 210, 1000, 14, 234, 1210, 'finish');
  builder.addBoxBrush('start_pillar_r', -14, -234, 1000, 14, -210, 1210, 'finish');
  builder.addBoxBrush('start_header', -14, -234, 1210, 14, 234, 1236, 'finish');
  builder.addTrigger('trig_start', 'start', -18, -210, 1000, 32, 210, 1210);
  signs.push({ x: 0, y: 0, z: 1265, yaw: Math.PI, text: 'START GATE  •  DROP IN', color: '#34d399', scale: 1.0 });

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
  signs.push({ x: 520, y: 0, z: 1030, yaw: Math.PI, text: 'RAMP 1  •  50° ENTRY', color: '#fbbf24', scale: 1.05 });

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
    dirZ: 0.38,
    addSpeed: 520,
    minSpeedXY: 1550,
    minVelZ: 640,
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

  // --- 6. SPLIT DUAL-ANGLE TEST RAMPS (48° GLIDE vs 60° STEEP) ---
  const d45 = Math.SQRT1_2;
  const splitOriginX = 7020;
  const splitOriginY = 1270;
  const splitLen = 1320;
  const splitOffset = 350;

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
    text: '48° SMOOTH GLIDE',
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
    text: '60° STEEP SPEED',
    color: '#f97316',
    scale: 1.05,
  });

  // --- 7. BOOSTER 2 (trig_push_2) -> ELEVATED FINISH PLATFORM ---
  const b2x = splitOriginX + d45 * (splitLen + 360);
  const b2y = splitOriginY + d45 * (splitLen + 360);
  builder.addBoxBrush('booster_2_pad', b2x - 360, b2y - 360, 40, b2x + 360, b2y + 360, 80, 'booster');
  builder.addTrigger('trig_push_2', 'push', b2x - 380, b2y - 380, 80, b2x + 380, b2y + 380, 620, {
    mode: 'hybrid',
    dirX: d45,
    dirY: d45,
    dirZ: 0.55,
    addSpeed: 540,
    minSpeedXY: 1650,
    minVelZ: 820,
  });
  signs.push({
    x: b2x,
    y: b2y,
    z: 660,
    yaw: Math.PI + Math.PI * 0.25,
    text: 'FINAL LAUNCH  •  TRIG_PUSH',
    color: '#22d3ee',
    scale: 1.15,
  });

  // Elevated Finish Platform (trig_end)
  const finX = b2x + d45 * 1420;
  const finY = b2y + d45 * 1420;
  const finZ = 660;
  builder.addBoxBrush('finish_platform', finX - 380, finY - 380, finZ - 60, finX + 380, finY + 380, finZ, 'finish');
  builder.addBoxBrush('fin_p1', finX - 360, finY - 360, finZ, finX - 332, finY - 332, finZ + 220, 'finish');
  builder.addBoxBrush('fin_p2', finX + 332, finY - 360, finZ, finX + 360, finY - 332, finZ + 220, 'finish');
  builder.addBoxBrush('fin_p3', finX - 360, finY + 332, finZ, finX - 332, finY + 360, finZ + 220, 'finish');
  builder.addBoxBrush('fin_p4', finX + 332, finY + 332, finZ, finX + 360, finY + 360, finZ + 220, 'finish');
  builder.addTrigger('trig_end', 'end', finX - 360, finY - 360, finZ, finX + 360, finY + 360, finZ + 380);
  signs.push({
    x: finX,
    y: finY,
    z: finZ + 280,
    yaw: Math.PI + Math.PI * 0.25,
    text: 'FINISH ZONE  •  TRIG_END',
    color: '#34d399',
    scale: 1.35,
  });

  // --- 8. SIDE CALIBRATION ZONE (LEFT OF SPAWN: 30°, 46°, 52°, 60° + 48u CROUCH TUNNEL) ---
  builder.addBoxBrush('calib_deck', -340, 230, 940, 440, 1280, 1000, 'slate');
  signs.push({
    x: -60,
    y: 310,
    z: 1125,
    yaw: -Math.PI * 0.5,
    text: '← CALIBRATION LAB (SLOPES & HULLS)',
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

  // 48u Crouch-Height Hull Calibration Tunnel (Standing 72u blocked, Ducking 36u passes!)
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

  // --- 9. FAIL FLOOR TELEPORTER (trig_tp_fail) ---
  builder.addTrigger('trig_tp_fail', 'teleport', -2500, -3500, -600, 13000, 6500, -160, {
    dest: spawn,
  });

  return {
    brushes: builder.brushes,
    triggers: builder.triggers,
    signs,
    spawn,
  };
}

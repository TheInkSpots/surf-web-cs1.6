// src/maps/deDust2.ts
import { f32 } from '../core/constants';
import { MapNavGraph, NavWaypoint } from '../gameplay/BotController';
import { BrushBuilder, ConvexBrush, TriggerVolume } from '../physics/BrushBuilder';
import {
  createBoxRigidBody,
  createWeaponRigidBody,
  LadderVolume,
  SourceJoint,
  SourceRigidBody,
  SourceRope,
  SourceVehicle,
  SpawnPoint,
  WaterVolume,
} from '../physics/GoldSrcPhysicsEngine';
import { MapBuildResult, WorldSign } from './surfSandbox01';

export interface Dust2MapBuildResult extends MapBuildResult {
  createJoints: () => SourceJoint[];
  createRopes: () => SourceRope[];
  createWaterVolumes: () => WaterVolume[];
  createVehicles: () => SourceVehicle[];
  ladders: LadderVolume[];
  navGraph: MapNavGraph;
  tSpawns: SpawnPoint[];
  ctSpawns: SpawnPoint[];
}

/**
 * Adds a smooth 16u-rise staircase (within GoldSrc 18u STEPSIZE) so both
 * human players and bots traverse elevation changes cleanly without snagging.
 */
function addStairFlight(
  builder: BrushBuilder,
  idPrefix: string,
  opts: {
    axis: 'x' | 'y';
    dir: 1 | -1;
    startPos: number;
    crossMin: number;
    crossMax: number;
    zLow: number;
    zHigh: number;
    stepRise?: number;
    treadDepth?: number;
    style?: 'walkable' | 'slate' | 'ramp';
  },
): void {
  const stepRise = opts.stepRise ?? 16;
  const tread = opts.treadDepth ?? 28;
  const style = opts.style ?? 'walkable';
  const totalRise = opts.zHigh - opts.zLow;
  const numRises = Math.max(2, Math.round(totalRise / stepRise));
  const stepCount = numRises - 1; // Top rise steps directly onto upper deck

  for (let i = 0; i < stepCount; i++) {
    const zTop = opts.zLow + (i + 1) * (totalRise / numRises);
    const p0 = opts.startPos + opts.dir * i * tread;
    const p1 = opts.startPos + opts.dir * (i + 1) * tread;
    const aMin = Math.min(p0, p1);
    const aMax = Math.max(p0, p1);

    if (opts.axis === 'y') {
      builder.addBoxBrush(
        `${idPrefix}_s${i}`,
        opts.crossMin,
        aMin,
        opts.zLow,
        opts.crossMax,
        aMax,
        zTop,
        style,
      );
    } else {
      builder.addBoxBrush(
        `${idPrefix}_s${i}`,
        aMin,
        opts.crossMin,
        opts.zLow,
        aMax,
        opts.crossMax,
        zTop,
        style,
      );
    }
  }
}

export function buildDeDust2(): Dust2MapBuildResult {
  const builder = new BrushBuilder();
  const signs: WorldSign[] = [];
  const ladders: LadderVolume[] = [];

  // =========================================================================
  // TEAM SPAWN POINTS (~3000u APART: CT NORTH, T SOUTH)
  // =========================================================================
  const ctSpawns: SpawnPoint[] = [
    { x: f32(80), y: f32(1480), z: f32(38), yaw: f32(-Math.PI * 0.5), pitch: f32(0) },
    { x: f32(-60), y: f32(1480), z: f32(38), yaw: f32(-Math.PI * 0.5), pitch: f32(0) },
    { x: f32(220), y: f32(1480), z: f32(38), yaw: f32(-Math.PI * 0.5), pitch: f32(0) },
    { x: f32(-180), y: f32(1380), z: f32(38), yaw: f32(-Math.PI * 0.5), pitch: f32(0) },
    { x: f32(320), y: f32(1380), z: f32(38), yaw: f32(-Math.PI * 0.5), pitch: f32(0) },
  ];

  const tSpawns: SpawnPoint[] = [
    { x: f32(0), y: f32(-1500), z: f32(166), yaw: f32(Math.PI * 0.5), pitch: f32(0) },
    { x: f32(-160), y: f32(-1500), z: f32(166), yaw: f32(Math.PI * 0.5), pitch: f32(0) },
    { x: f32(160), y: f32(-1500), z: f32(166), yaw: f32(Math.PI * 0.5), pitch: f32(0) },
    { x: f32(-300), y: f32(-1420), z: f32(166), yaw: f32(Math.PI * 0.5), pitch: f32(0) },
    { x: f32(300), y: f32(-1420), z: f32(166), yaw: f32(Math.PI * 0.5), pitch: f32(0) },
  ];

  // Default fallback spawn = CT Spawn[0]
  const spawn: SpawnPoint = { ...ctSpawns[0] };

  // =========================================================================
  // GLOBAL GROUND SLAB (Z = 0) & OUTER PERIMETER WALLS
  // =========================================================================
  builder.addBoxBrush('d2_ground', -1680, -1700, -64, 1680, 1700, 0, 'slate');

  builder.addBoxBrush('d2_bound_s', -1744, -1764, -64, 1744, -1700, 420, 'slate');
  builder.addBoxBrush('d2_bound_n', -1744, 1700, -64, 1744, 1764, 420, 'slate');
  builder.addBoxBrush('d2_bound_w', -1744, -1700, -64, -1680, 1700, 420, 'slate');
  builder.addBoxBrush('d2_bound_e', 1680, -1700, -64, 1744, 1700, 420, 'slate');

  // =========================================================================
  // 1. T SPAWN TERRACE (SOUTH, ELEVATED Z = 128)
  // =========================================================================
  builder.addBoxBrush('d2_tspawn_deck', -480, -1700, 0, 480, -1240, 128, 'walkable');

  // Low sniper parapet overlooking Mid (leaves center Suicide stairs open)
  builder.addBoxBrush('d2_tspawn_parapet_l', -480, -1264, 128, -120, -1240, 172, 'ramp');
  builder.addBoxBrush('d2_tspawn_parapet_r', 120, -1264, 128, 480, -1240, 172, 'ramp');

  // Center Suicide stairs descending North (+Y): Y = -1044 -> -1240 (128 -> 0)
  addStairFlight(builder, 'd2_tspawn_mid_stairs', {
    axis: 'y',
    dir: -1,
    startPos: -1044,
    crossMin: -120,
    crossMax: 120,
    zLow: 0,
    zHigh: 128,
  });

  // East stairs descending to Outside Long (+X): X = 676 -> 480 (128 -> 0)
  addStairFlight(builder, 'd2_tspawn_long_stairs', {
    axis: 'x',
    dir: -1,
    startPos: 676,
    crossMin: -1540,
    crossMax: -1320,
    zLow: 0,
    zHigh: 128,
  });

  // West stairs descending to Outside B Tunnels (-X): X = -676 -> -480 (128 -> 0)
  addStairFlight(builder, 'd2_tspawn_b_stairs', {
    axis: 'x',
    dir: 1,
    startPos: -676,
    crossMin: -1540,
    crossMax: -1320,
    zLow: 0,
    zHigh: 128,
  });

  // =========================================================================
  // 2. MID, XBOX, DOUBLE DOORS & CATWALK / SHORT A
  // =========================================================================
  // West Mid wall (gap at Y: -120..120 leads into Lower B Tunnels)
  builder.addBoxBrush('d2_mid_wall_w_s', -400, -1020, 0, -340, -120, 320, 'slate');
  builder.addBoxBrush('d2_mid_wall_w_n', -400, 120, 0, -340, 1060, 320, 'slate');

  // East Mid wall (south of Catwalk) + Catwalk supporting spine
  builder.addBoxBrush('d2_mid_wall_e_s', 340, -1020, 0, 400, -360, 320, 'slate');
  builder.addBoxBrush('d2_cat_wall_support', 340, -56, 0, 400, 680, 104, 'slate');

  // Mid-to-Catwalk stairs climbing North (+Y): Y = -252 -> -56 (0 -> 128)
  addStairFlight(builder, 'd2_cat_stairs', {
    axis: 'y',
    dir: 1,
    startPos: -252,
    crossMin: 160,
    crossMax: 340,
    zLow: 0,
    zHigh: 128,
  });

  // Catwalk elevated walkway (Z = 128) & Short A bridge into Bombsite A
  builder.addBoxBrush('d2_catwalk_deck', 160, -56, 104, 400, 680, 128, 'walkable');
  builder.addBoxBrush('d2_catwalk_rail', 160, -56, 128, 176, 680, 168, 'ramp');
  builder.addBoxBrush('d2_short_a_bridge', 160, 680, 104, 960, 984, 128, 'walkable');
  builder.addBoxBrush('d2_short_a_rail_n', 160, 968, 128, 640, 984, 172, 'ramp');

  // Classic Mid Double Doors (88u center gap X: -44..44)
  builder.addBoxBrush('d2_mid_door_l', -340, 580, 0, -44, 612, 220, 'steep');
  builder.addBoxBrush('d2_mid_door_r', 44, 580, 0, 160, 612, 220, 'steep');
  builder.addBoxBrush('d2_mid_door_lintel', -340, 580, 220, 160, 612, 320, 'slate');

  // Iconic Mid Xbox & palm-corner cover
  builder.addBoxBrush('d2_mid_xbox', -40, -180, 0, 80, -60, 64, 'ramp');
  builder.addBoxBrush('d2_topmid_box', -260, -760, 0, -160, -660, 68, 'ramp');

  // =========================================================================
  // 3. LONG A HOUSE, LONG STRAIGHTAWAY, A RAMP & BOMBSITE A (EAST)
  // =========================================================================
  // Long Doors House (Y: -980..-580)
  builder.addBoxBrush('d2_long_house_w', 400, -980, 0, 448, -580, 280, 'slate');
  // South entry open at X: 880..1120
  builder.addBoxBrush('d2_long_house_s_l', 448, -980, 0, 880, -932, 280, 'slate');
  builder.addBoxBrush('d2_long_house_s_r', 1120, -980, 0, 1680, -932, 280, 'slate');
  // North exit open at X: 1140..1420
  builder.addBoxBrush('d2_long_house_n_l', 448, -628, 0, 1140, -580, 280, 'slate');
  builder.addBoxBrush('d2_long_house_n_r', 1420, -628, 0, 1680, -580, 280, 'slate');
  builder.addBoxBrush('d2_long_house_roof', 400, -980, 260, 1680, -580, 292, 'slate');

  // Divider wall between Catwalk/Mid and Long A
  builder.addBoxBrush('d2_long_divider', 900, -580, 0, 960, 680, 320, 'slate');

  // Long A cover (Blue corner box & Car block)
  builder.addBoxBrush('d2_long_bluebox', 1000, -400, 0, 1120, -290, 76, 'ramp');
  builder.addBoxBrush('d2_long_car', 1520, 380, 0, 1660, 560, 72, 'steep');

  // A Ramp climbing North (+Y): Y = 788 -> 984 (0 -> 128)
  addStairFlight(builder, 'd2_a_ramp', {
    axis: 'y',
    dir: 1,
    startPos: 788,
    crossMin: 1180,
    crossMax: 1680,
    zLow: 0,
    zHigh: 128,
  });

  // Bombsite A elevated platform (Z = 128)
  builder.addBoxBrush('d2_asite_deck', 640, 984, 0, 1680, 1700, 128, 'slate');
  builder.addBoxBrush('d2_asite_pad', 1020, 1200, 126, 1340, 1480, 129, 'finish');

  // CT Spawn -> Bombsite A ramp climbing East (+X): X = 444 -> 640 (0 -> 128)
  addStairFlight(builder, 'd2_ct_a_ramp', {
    axis: 'x',
    dir: 1,
    startPos: 444,
    crossMin: 1140,
    crossMax: 1380,
    zLow: 0,
    zHigh: 128,
  });

  // Bombsite A cover boxes (Default plant, Goose, Short crate)
  builder.addBoxBrush('d2_asite_default_box', 1100, 1270, 128, 1220, 1390, 208, 'ramp');
  builder.addBoxBrush('d2_asite_goose_box', 1480, 1500, 128, 1610, 1620, 212, 'ramp');
  builder.addBoxBrush('d2_asite_short_box', 820, 1100, 128, 930, 1190, 188, 'ramp');

  // =========================================================================
  // 4. B TUNNELS & BOMBSITE B (WEST)
  // =========================================================================
  // South B Tunnel wall (T-side entrance open at X: -1460..-1160)
  builder.addBoxBrush('d2_btun_s_e', -1160, -860, 0, -400, -812, 280, 'slate');
  builder.addBoxBrush('d2_btun_s_w', -1680, -860, 0, -1460, -812, 280, 'slate');
  // North B Tunnel wall (B Site entrance open at X: -1480..-1220)
  builder.addBoxBrush('d2_btun_n_e', -1220, 272, 0, -400, 320, 280, 'slate');
  builder.addBoxBrush('d2_btun_n_w', -1680, 272, 0, -1480, 320, 280, 'slate');
  // Partition separating Upper & Lower Tunnels (open at Y: -180..272)
  builder.addBoxBrush('d2_btun_mid_wall', -1020, -812, 0, -960, -180, 280, 'slate');
  // B Tunnels roof
  builder.addBoxBrush('d2_btun_roof', -1680, -860, 260, -400, 320, 292, 'slate');

  // Wall separating B Site from CT Mid/Spawn (B Doors at Y: 740..940, Window at Y: 1180..1360)
  builder.addBoxBrush('d2_bsite_wall_s', -460, 320, 0, -400, 740, 320, 'slate');
  builder.addBoxBrush('d2_bsite_wall_mid', -460, 940, 0, -400, 1180, 320, 'slate');
  builder.addBoxBrush('d2_bsite_win_sill', -460, 1180, 0, -400, 1360, 44, 'ramp');
  builder.addBoxBrush('d2_bsite_win_lintel', -460, 1180, 180, -400, 1360, 320, 'slate');
  builder.addBoxBrush('d2_bsite_wall_n', -460, 1360, 0, -400, 1700, 320, 'slate');

  // Bombsite B elevated platform (Z = 48) + smooth 16u steps
  builder.addBoxBrush('d2_bsite_plat', -1640, 1180, 0, -1100, 1660, 48, 'walkable');
  builder.addBoxBrush('d2_bsite_pad', -1520, 1240, 46, -1220, 1540, 49, 'finish');
  addStairFlight(builder, 'd2_bsite_stairs_s', {
    axis: 'y',
    dir: 1,
    startPos: 1132,
    crossMin: -1520,
    crossMax: -1160,
    zLow: 0,
    zHigh: 48,
    stepRise: 16,
    treadDepth: 24,
  });
  addStairFlight(builder, 'd2_bsite_stairs_e', {
    axis: 'x',
    dir: -1,
    startPos: -1052,
    crossMin: 1220,
    crossMax: 1540,
    zLow: 0,
    zHigh: 48,
    stepRise: 16,
    treadDepth: 24,
  });

  // Bombsite B cover boxes (Big Box, Center Double Stack, Closet Car)
  builder.addBoxBrush('d2_bsite_bigbox', -1460, 1360, 48, -1340, 1480, 148, 'ramp');
  builder.addBoxBrush('d2_bsite_center_box', -940, 780, 0, -820, 900, 108, 'ramp');
  builder.addBoxBrush('d2_bsite_car', -1640, 540, 0, -1520, 720, 76, 'steep');

  // =========================================================================
  // CALLOUT SIGNS
  // =========================================================================
  signs.push(
    { x: 80, y: 1680, z: 190, yaw: -Math.PI * 0.5, text: 'CT SPAWN  •  DE_DUST2 BOT ARENA', color: '#38bdf8', scale: 0.95 },
    { x: 0, y: -1680, z: 290, yaw: Math.PI * 0.5, text: 'T SPAWN  •  MID • LONG A • B TUNNELS', color: '#fbbf24', scale: 0.95 },
    { x: 1180, y: 1680, z: 290, yaw: -Math.PI * 0.5, text: 'BOMBSITE A  (SHORT / LONG)', color: '#34d399', scale: 0.95 },
    { x: -1360, y: 1680, z: 220, yaw: -Math.PI * 0.5, text: 'BOMBSITE B  (TUNNELS / DOORS)', color: '#34d399', scale: 0.95 },
    { x: 0, y: 575, z: 270, yaw: -Math.PI * 0.5, text: 'MID DOUBLE DOORS', color: '#f87171', scale: 0.8 },
    { x: 1280, y: -575, z: 220, yaw: Math.PI * 0.5, text: 'LONG A', color: '#fb923c', scale: 0.78 },
    { x: -1340, y: 325, z: 220, yaw: Math.PI * 0.5, text: 'UPPER B TUNNELS', color: '#a78bfa', scale: 0.78 },
  );

  // Global fail-safe teleport below floor
  builder.addTrigger('trig_tp_fail', 'teleport', -2400, -2400, -600, 2400, 2400, -180, {
    dest: spawn,
  });

  // =========================================================================
  // NAV GRAPH FOR BOT PATHFINDING (ALL EDGES AXIS-ALIGNED THROUGH DOORWAYS)
  // =========================================================================
  const waypoints: NavWaypoint[] = [
    // CT Spawn & Mid-North
    { id: 0, x: 80, y: 1460, z: 38, radius: 56, flags: ['ct_spawn'], edges: [{ to: 1 }, { to: 21 }] },
    { id: 1, x: 0, y: 860, z: 38, radius: 52, flags: ['mid'], edges: [{ to: 0 }, { to: 2 }, { to: 20 }] },
    { id: 2, x: 0, y: 440, z: 38, radius: 44, flags: ['mid'], edges: [{ to: 1 }, { to: 3 }] },
    { id: 3, x: -160, y: 0, z: 38, radius: 52, flags: ['mid'], edges: [{ to: 2 }, { to: 4 }, { to: 14 }, { to: 17 }] },
    { id: 4, x: 0, y: -960, z: 38, radius: 52, flags: ['mid'], edges: [{ to: 3 }, { to: 5 }, { to: 14 }] },

    // T Spawn & 3 Exit Stairs
    { id: 5, x: 0, y: -1340, z: 166, radius: 60, flags: ['t_spawn'], edges: [{ to: 4 }, { to: 6 }, { to: 15 }] },
    { id: 6, x: 420, y: -1430, z: 166, radius: 48, flags: ['t_spawn'], edges: [{ to: 5 }, { to: 7 }] },
    { id: 7, x: 1000, y: -1430, z: 38, radius: 56, flags: ['t_spawn'], edges: [{ to: 6 }, { to: 8 }] },

    // Long A -> Bombsite A
    { id: 8, x: 1000, y: -780, z: 38, radius: 48, flags: [], edges: [{ to: 7 }, { to: 9 }] },
    { id: 9, x: 1280, y: -780, z: 38, radius: 48, flags: [], edges: [{ to: 8 }, { to: 10 }] },
    { id: 10, x: 1320, y: -220, z: 38, radius: 56, flags: [], edges: [{ to: 9 }, { to: 11 }] },
    { id: 11, x: 1400, y: 660, z: 38, radius: 56, flags: [], edges: [{ to: 10 }, { to: 12 }] },
    { id: 12, x: 1400, y: 1120, z: 166, radius: 64, flags: ['bombsite_a'], edges: [{ to: 11 }, { to: 13 }, { to: 22 }] },
    { id: 13, x: 960, y: 1060, z: 166, radius: 60, flags: ['bombsite_a'], edges: [{ to: 12 }, { to: 22 }, { to: 23 }] },

    // Catwalk / Short A
    { id: 14, x: 250, y: -340, z: 38, radius: 44, flags: ['mid'], edges: [{ to: 3 }, { to: 4 }, { to: 23 }] },

    // B Tunnels -> Bombsite B -> B Doors
    { id: 15, x: -420, y: -1430, z: 166, radius: 48, flags: ['t_spawn'], edges: [{ to: 5 }, { to: 16 }] },
    { id: 16, x: -1300, y: -1430, z: 38, radius: 56, flags: ['t_spawn'], edges: [{ to: 15 }, { to: 18 }] },
    { id: 17, x: -680, y: 0, z: 38, radius: 48, flags: [], edges: [{ to: 3 }, { to: 18 }] },
    { id: 18, x: -1320, y: 0, z: 38, radius: 56, flags: [], edges: [{ to: 16 }, { to: 17 }, { to: 19 }] },
    { id: 19, x: -1320, y: 680, z: 38, radius: 64, flags: ['bombsite_b'], edges: [{ to: 18 }, { to: 20 }] },
    { id: 20, x: -680, y: 840, z: 38, radius: 56, flags: ['bombsite_b'], edges: [{ to: 19 }, { to: 1 }] },

    // CT A-Ramp & Catwalk Bridge Connectors
    { id: 21, x: 360, y: 1260, z: 38, radius: 48, flags: ['ct_spawn'], edges: [{ to: 0 }, { to: 22 }] },
    { id: 22, x: 740, y: 1260, z: 166, radius: 52, flags: ['bombsite_a'], edges: [{ to: 21 }, { to: 12 }, { to: 13 }] },
    { id: 23, x: 260, y: 800, z: 166, radius: 48, flags: [], edges: [{ to: 14 }, { to: 13 }] },
  ];

  const navGraph: MapNavGraph = { waypoints };

  // =========================================================================
  // INTERACTIVE CRATES & SPAWN WEAPON PICKUPS
  // =========================================================================
  const createRigidBodies = (): SourceRigidBody[] => [
    // Spare Scout & USP at CT Spawn and T Spawn
    createWeaponRigidBody(
      'd2_ct_scout',
      { x: 180, y: 1580, z: 18 },
      { slot: 1, clipAmmo: 10, reserveAmmo: 90, pickupCooldownTick: 0 },
    ),
    createWeaponRigidBody(
      'd2_t_scout',
      { x: -240, y: -1580, z: 146 },
      { slot: 1, clipAmmo: 10, reserveAmmo: 90, pickupCooldownTick: 0 },
    ),
    // Shootable wooden crates around Mid, A Site, and B Site
    createBoxRigidBody('d2_crate_mid', { x: -220, y: 260, z: 22 }, { x: 20, y: 20, z: 20 }, 30, { hp: 90 }),
    createBoxRigidBody('d2_crate_a1', { x: 1260, y: 1320, z: 150 }, { x: 20, y: 20, z: 20 }, 30, { hp: 90 }),
    createBoxRigidBody('d2_crate_b1', { x: -1120, y: 920, z: 22 }, { x: 20, y: 20, z: 20 }, 30, { hp: 90 }),
  ];

  return {
    brushes: builder.brushes as ConvexBrush[],
    triggers: builder.triggers as TriggerVolume[],
    signs,
    spawn,
    tSpawns,
    ctSpawns,
    navGraph,
    createRigidBodies,
    createJoints: (): SourceJoint[] => [],
    createRopes: (): SourceRope[] => [],
    createWaterVolumes: (): WaterVolume[] => [],
    createVehicles: (): SourceVehicle[] => [],
    ladders,
  };
}

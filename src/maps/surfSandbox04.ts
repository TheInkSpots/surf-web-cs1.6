// src/maps/surfSandbox04.ts
import { f32 } from '../core/constants';
import { BrushBuilder, ConvexBrush, TriggerVolume } from '../physics/BrushBuilder';
import {
  createArticulatedRagdoll,
  createBoxRigidBody,
  createFourWheelVehicle,
  createVerletRope,
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

export interface SubsystemMapBuildResult extends MapBuildResult {
  createJoints: () => SourceJoint[];
  createRopes: () => SourceRope[];
  createWaterVolumes: () => WaterVolume[];
  createVehicles: () => SourceVehicle[];
  ladders: LadderVolume[];
}

/**
 * Adds a functional LadderVolume plus non-blocking side rails & thin visual rungs
 * so the player sees clear ladder geometry aligned to the climb surface.
 */
function addLadderAssembly(
  builder: BrushBuilder,
  ladders: LadderVolume[],
  opts: {
    id: string;
    /** Center X/Y of the ladder face plane */
    faceX: number;
    faceY: number;
    bottomZ: number;
    topZ: number;
    width: number;
    normalX: number;
    normalY: number;
    climbSpeed?: number;
  },
): void {
  const { id, faceX, faceY, bottomZ, topZ, width, normalX, normalY, climbSpeed = 200 } = opts;
  const halfW = width * 0.5;
  const depth = 16;

  // Tangent along ladder width
  const tx = -normalY;
  const ty = normalX;

  const p0x = faceX - tx * halfW;
  const p0y = faceY - ty * halfW;
  const p1x = faceX + tx * halfW;
  const p1y = faceY + ty * halfW;

  const minX = Math.min(p0x, p1x, p0x + normalX * depth, p1x + normalX * depth);
  const maxX = Math.max(p0x, p1x, p0x + normalX * depth, p1x + normalX * depth);
  const minY = Math.min(p0y, p1y, p0y + normalY * depth, p1y + normalY * depth);
  const maxY = Math.max(p0y, p1y, p0y + normalY * depth, p1y + normalY * depth);

  ladders.push({
    id,
    minX,
    minY,
    minZ: bottomZ,
    maxX,
    maxY,
    maxZ: topZ,
    //maxZ: topZ + 12,
    normalX,
    normalY,
    normalZ: 0,
    climbSpeed,
  });

  // Backplate strip painted with high-contrast booster/hazard style for visibility
  const backThick = 4;
  const bx0 = Math.min(p0x, p1x, p0x - normalX * backThick, p1x - normalX * backThick);
  const bx1 = Math.max(p0x, p1x, p0x - normalX * backThick, p1x - normalX * backThick);
  const by0 = Math.min(p0y, p1y, p0y - normalY * backThick, p1y - normalY * backThick);
  const by1 = Math.max(p0y, p1y, p0y - normalY * backThick, p1y - normalY * backThick);
  builder.addBoxBrush(`${id}_rail_plate`, bx0, by0, bottomZ, bx1, by1, topZ, 'booster');

  // Visual climb rungs every 24u (thin 2u depth so they don't snag StepMove)
  const rungSpacing = 24;
  for (let z = bottomZ + 18; z <= topZ - 12; z += rungSpacing) {
    const rx0 = Math.min(p0x, p1x, p0x + normalX * 2, p1x + normalX * 2);
    const rx1 = Math.max(p0x, p1x, p0x + normalX * 2, p1x + normalX * 2);
    const ry0 = Math.min(p0y, p1y, p0y + normalY * 2, p1y + normalY * 2);
    const ry1 = Math.max(p0y, p1y, p0y + normalY * 2, p1y + normalY * 2);
    builder.addBoxBrush(`${id}_rung_${Math.round(z)}`, rx0, ry0, z - 2, rx1, ry1, z + 2, 'walkable');
  }
}

export function buildSurfSandbox04(): SubsystemMapBuildResult {
  const builder = new BrushBuilder();
  const signs: WorldSign[] = [];
  const ladders: LadderVolume[] = [];

  const spawn: SpawnPoint = {
    x: f32(0),
    y: f32(0),
    z: f32(240),
    yaw: f32(0), // Facing East (+X) toward Bay 1 Prop & Buoyancy Lab
    pitch: f32(-0.04),
  };

  // =========================================================================
  // CENTRAL HUB DECK (Z = 200)
  // =========================================================================
  builder.addBoxBrush('hub_floor', -520, -520, 140, 520, 520, 200, 'slate');
  builder.addBoxBrush('hub_weapon_pedestal', -160, -240, 200, 160, -170, 232, 'walkable');

  // Corner directional pylons
  builder.addBoxBrush('hub_pylon_ne', 480, 480, 200, 520, 520, 380, 'finish');
  builder.addBoxBrush('hub_pylon_nw', -520, 480, 200, -480, 520, 380, 'finish');
  builder.addBoxBrush('hub_pylon_se', 480, -520, 200, 520, -480, 380, 'finish');
  builder.addBoxBrush('hub_pylon_sw', -520, -520, 200, -480, -480, 380, 'finish');

  signs.push(
    {
      x: 490,
      y: 0,
      z: 340,
      yaw: Math.PI,
      text: 'BAY 1 (+X)  •  PROPS • GRAVITY GUN [4/RMB] • ROPES • BUOYANCY',
      color: '#22d3ee',
      scale: 0.95,
    },
    {
      x: 0,
      y: 490,
      z: 340,
      yaw: -Math.PI * 0.5,
      text: 'BAY 2 (+Y)  •  RAGDOLLS • BREAKABLE JOINTS • BLAST STAGE',
      color: '#f87171',
      scale: 0.95,
    },
    {
      x: 0,
      y: -490,
      z: 340,
      yaw: Math.PI * 0.5,
      text: 'BAY 3 (-Y)  •  4-WHEEL RAYCAST VEHICLE PROVING TRACK [E DRIVE]',
      color: '#fbbf24',
      scale: 0.95,
    },
    {
      x: -490,
      y: 0,
      z: 340,
      yaw: 0,
      text: 'BAY 4 (-X)  •  3-TIER LADDER TOWER & 52° SURF SHADOW RETURN',
      color: '#34d399',
      scale: 0.95,
    },
  );

  // =========================================================================
  // BAY 1 (+X): TACTILE PROPS, GRAVITY GUN, VERLET ROPES & BUOYANCY TANK
  // =========================================================================
  // Main prop workshop slab (X: 520..1180)
  builder.addBoxBrush('b1_workshop_floor', 520, -520, 140, 1180, 520, 200, 'slate');
  // Tank perimeter decks surrounding recessed pool [X: 1180..1660, Y: -340..340]
  builder.addBoxBrush('b1_pool_rim_n', 1180, 340, 140, 1780, 520, 200, 'slate');
  builder.addBoxBrush('b1_pool_rim_s', 1180, -520, 140, 1780, -340, 200, 'slate');
  builder.addBoxBrush('b1_pool_rim_e', 1660, -340, 140, 1780, 340, 200, 'slate');
  // Pool basin bottom & inner retaining walls
  builder.addBoxBrush('b1_pool_bottom', 1140, -380, -20, 1700, 380, 20, 'walkable');
  builder.addBoxBrush('b1_pool_wall_w', 1140, -340, 20, 1180, 340, 140, 'slate');
  builder.addBoxBrush('b1_pool_wall_e', 1660, -340, 20, 1700, 340, 140, 'slate');
  builder.addBoxBrush('b1_pool_wall_n', 1180, 340, 20, 1660, 380, 140, 'slate');
  builder.addBoxBrush('b1_pool_wall_s', 1180, -380, 20, 1660, -340, 140, 'slate');

  // Pool exit ladder on West basin wall (normal +X into pool)
  addLadderAssembly(builder, ladders, {
    id: 'lad_pool_exit',
    faceX: 1180,
    faceY: 0,
    bottomZ: 20,
    topZ: 200,
    width: 68,
    normalX: 1,
    normalY: 0,
    climbSpeed: 200,
  });

  // Prop calibration table & overhead Verlet Rope Gantry
  builder.addBoxBrush('b1_prop_bench', 620, -380, 200, 960, -260, 232, 'walkable');
  builder.addBoxBrush('b1_gantry_l', 840, 260, 200, 876, 296, 460, 'slate');
  builder.addBoxBrush('b1_gantry_r', 840, -296, 200, 876, -260, 460, 'slate');
  builder.addBoxBrush('b1_gantry_beam', 840, -296, 440, 876, 296, 472, 'booster');

  signs.push(
    {
      x: 790,
      y: -360,
      z: 310,
      yaw: Math.PI * 0.5,
      text: 'MASS BENCH  •  8kg FOAM  •  32kg WOOD  •  240kg STEEL',
      color: '#38bdf8',
      scale: 0.78,
    },
    {
      x: 1680,
      y: 0,
      z: 310,
      yaw: Math.PI,
      text: 'BUOYANCY TANK (Z=184)  •  SELF-RIGHTING FLOATERS vs IRON SINKS',
      color: '#22d3ee',
      scale: 0.85,
    },
  );

  // =========================================================================
  // BAY 2 (+Y): ARTICULATED RAGDOLLS & BREAKABLE JOINTS ARENA
  // =========================================================================
  builder.addBoxBrush('b2_arena_floor', -560, 520, 140, 560, 1740, 200, 'slate');
  builder.addBoxBrush('b2_back_wall', -560, 1740, 200, 560, 1772, 480, 'slate');
  // 16u step-up blast stage (StepMove friendly)
  builder.addBoxBrush('b2_blast_stage', -260, 960, 200, 260, 1440, 216, 'walkable');

  // Remote blast button pad on West flank (safely triggers explosion at ragdoll stage center)
  builder.addBoxBrush('b2_blast_pad', -440, 1080, 200, -320, 1200, 212, 'steep');
  builder.addTrigger('trig_exp_ragdoll', 'explosion', -440, 1080, 212, -320, 1200, 320, {
    originX: 0,
    originY: 1180,
    originZ: 230,
    maxDamage: 48000,
    radius: 360,
    pushScale: 1.15,
    cooldownTicks: 60,
  });

  // Overhead gallows beam for Verlet-suspended ragdoll
  builder.addBoxBrush('b2_hang_post_l', -180, 1520, 200, -148, 1552, 470, 'slate');
  builder.addBoxBrush('b2_hang_post_r', 148, 1520, 200, 180, 1552, 470, 'slate');
  builder.addBoxBrush('b2_hang_beam', -180, 1520, 448, 180, 1552, 476, 'steep');

  // Door frame for breakable hinged door test (East side of Bay 2)
  builder.addBoxBrush('b2_door_post_l', 300, 920, 200, 328, 948, 340, 'slate');
  builder.addBoxBrush('b2_door_post_r', 440, 920, 200, 468, 948, 340, 'slate');
  builder.addBoxBrush('b2_door_lintel', 300, 920, 340, 468, 948, 368, 'slate');

  signs.push(
    {
      x: -380,
      y: 1140,
      z: 290,
      yaw: 0,
      text: 'STEP ON RED PAD → DETONATE RAGDOLL BLAST (BREAKS JOINTS)',
      color: '#f87171',
      scale: 0.78,
    },
    {
      x: 384,
      y: 934,
      z: 405,
      yaw: -Math.PI * 0.5,
      text: 'BREAKABLE HINGED DOOR  •  PUNT OR SHOOT TO SEVER',
      color: '#fb923c',
      scale: 0.76,
    },
  );

  // =========================================================================
  // BAY 3 (-Y): 4-WHEEL RAYCAST VEHICLE PROVING TRACK
  // =========================================================================
  builder.addBoxBrush('b3_track_floor', -1200, -2320, 140, 1500, -520, 200, 'slate');

  // Perimeter retaining curbs (56u tall)
  builder.addBoxBrush('b3_curb_s', -1200, -2352, 200, 1500, -2320, 268, 'steep');
  builder.addBoxBrush('b3_curb_w', -1232, -2352, 200, -1200, -520, 268, 'steep');
  builder.addBoxBrush('b3_curb_e', 1500, -2352, 200, 1532, -520, 268, 'steep');
  builder.addBoxBrush('b3_curb_nw', -1200, -552, 200, -520, -520, 268, 'steep');
  builder.addBoxBrush('b3_curb_ne', 520, -552, 200, 1500, -520, 268, 'steep');

  // Washboard suspension test ribs (8u tall x 28u wide) along straightaway
  for (let i = 0; i < 4; i++) {
    const rx = 280 + i * 92;
    builder.addBoxBrush(`b3_rib_${i}`, rx, -1120, 200, rx + 26, -740, 208, 'walkable');
  }

  // Smooth 22° double-sided vehicle jump kicker on South return straight
  builder.addSurfRampBrush('b3_vehicle_kicker', {
    start: [260, -1960, 200],
    end: [260, -1580, 200],
    angleDeg: 22,
    height: 76,
    topWidth: 48,
    sides: 'both',
    style: 'ramp',
  });

  // Low-angle side ramp for rollover & chassis contact verification
  builder.addSurfRampBrush('b3_bank_ramp', {
    start: [-860, -1960, 200],
    end: [-860, -1580, 200],
    angleDeg: 26,
    height: 88,
    topWidth: 32,
    sides: 'both',
    style: 'ramp',
  });

  signs.push(
    {
      x: 0,
      y: -760,
      z: 320,
      yaw: Math.PI * 0.5,
      text: '4WD RAYCAST BUGGY  •  PRESS [E] TO DRIVE  •  [SPACE] HANDBRAKE',
      color: '#fbbf24',
      scale: 0.9,
    },
    {
      x: 420,
      y: -1150,
      z: 295,
      yaw: Math.PI * 0.5,
      text: 'SUSPENSION WASHBOARD RIBS  •  WATCH 4-WHEEL HUD COMPRESSION',
      color: '#22d3ee',
      scale: 0.82,
    },
  );

  // =========================================================================
  // BAY 4 (-X): 3-TIER LADDER TOWER & 52° SURF RETURN (SHADOW AUTHORITY TEST)
  // =========================================================================
  // Base deck connecting Hub to Tower
  builder.addBoxBrush('b4_base_floor', -1200, -440, 140, -520, 440, 200, 'slate');

  // Tier 1 Tower Shaft & Deck (Z = 200 -> 520)
  builder.addBoxBrush('b4_pillar_1', -1160, -340, 200, -820, 340, 520, 'slate');
  addLadderAssembly(builder, ladders, {
    id: 'lad_tower_1',
    faceX: -820,
    faceY: 0,
    bottomZ: 200,
    topZ: 520,
    width: 84,
    normalX: 1,
    normalY: 0,
    climbSpeed: 200,
  });

  // Tier 2 Shaft & Deck (Z = 520 -> 840) + 48u Crouch Hatch at top
  builder.addBoxBrush('b4_pillar_2', -1160, 160, 520, -840, 440, 840, 'slate');
  addLadderAssembly(builder, ladders, {
    id: 'lad_tower_2',
    faceX: -990,
    faceY: 160,
    bottomZ: 520,
    topZ: 840,
    width: 80,
    normalX: 0,
    normalY: -1,
    climbSpeed: 200,
  });
  // 48u Crouch Hatch frame across Tier 2 deck
  builder.addBoxBrush('b4_hatch_beam', -1160, 290, 888, -840, 340, 960, 'ramp');

  // Tier 3 Upper Mast & Summit Overlook (Z = 840 -> 1120)
  builder.addBoxBrush('b4_pillar_3', -980, 160, 840, -760, 440, 1120, 'slate');
  builder.addBoxBrush('b4_summit_deck', -1040, -380, 1080, -720, 440, 1120, 'finish');
  addLadderAssembly(builder, ladders, {
    id: 'lad_tower_3',
    faceX: -980,
    faceY: 300,
    bottomZ: 840,
    topZ: 1120,
    width: 80,
    normalX: -1,
    normalY: 0,
    climbSpeed: 220,
  });

  // 52° Surf Return Ramp from Summit (-X, Z=1080) back toward Hub (+X, Z=420)
  // Props perched on the ramp test one-way Player Shadow surf immunity.
  builder.addSurfRampBrush('b4_surf_return', {
    start: [-680, -300, 1060],
    end: [420, -300, 460],
    angleDeg: 52,
    height: 320,
    topWidth: 28,
    sides: 'both',
    style: 'ramp',
  });

  // Start / End timer triggers for optional Tower-to-Hub climb+surf loop
  builder.addTrigger('trig_start', 'start', -800, -80, 200, -720, 80, 340);
  builder.addTrigger('trig_end', 'end', 300, -440, 200, 500, -160, 460);

  signs.push(
    {
      x: -810,
      y: 0,
      z: 360,
      yaw: 0,
      text: 'LADDER 1 (200 u/s)  •  W+A/D FOR FAST DIAGONAL CLIMB • [SPACE] JUMP OFF',
      color: '#34d399',
      scale: 0.78,
    },
    {
      x: -880,
      y: -300,
      z: 1190,
      yaw: Math.PI,
      text: 'SUMMIT (Z=1120)  •  DROP ONTO 52° SURF RAMP (ONE-WAY SHADOW TEST)',
      color: '#fbbf24',
      scale: 0.85,
    },
  );

  // Global fail teleport below track/pool
  builder.addTrigger('trig_tp_fail', 'teleport', -2400, -3200, -600, 2800, 2600, -180, {
    dest: spawn,
  });

  // =========================================================================
  // SUBSYSTEM FACTORIES (RIGID BODIES, JOINTS, ROPES, WATER, VEHICLES)
  // =========================================================================

  const buildRagdollAndJointData = (): { bodies: SourceRigidBody[]; joints: SourceJoint[] } => {
    const ragA = createArticulatedRagdoll('rag_alpha', { x: -90, y: 1180, z: 216 }, { breakForce: 2800 });
    const ragB = createArticulatedRagdoll('rag_beta', { x: 90, y: 1180, z: 216 }, { breakForce: 2800 });
    const ragHang = createArticulatedRagdoll('rag_hang', { x: 0, y: 1536, z: 280 }, { breakForce: 2600 });

    const bodies: SourceRigidBody[] = [
      // --- Hub Pedestal Weapons ---
      createWeaponRigidBody(
        'hub_scout',
        { x: -60, y: -205, z: 244 },
        { slot: 1, clipAmmo: 10, reserveAmmo: 90, pickupCooldownTick: 0 },
      ),
      createWeaponRigidBody(
        'hub_usp',
        { x: 60, y: -205, z: 242 },
        { slot: 2, clipAmmo: 12, reserveAmmo: 100, silenced: true, pickupCooldownTick: 0 },
      ),

      // --- Bay 1: Mass Calibration Props (Foam, Wood, Heavy Steel) ---
      createBoxRigidBody('b1_foam_1', { x: 680, y: -320, z: 254 }, { x: 18, y: 18, z: 18 }, 8, {
        restitution: 0.48,
        buoyancyRatio: 2.2,
      }),
      createBoxRigidBody('b1_wood_1', { x: 780, y: -320, z: 256 }, { x: 22, y: 22, z: 22 }, 32, {
        restitution: 0.28,
        hp: 100,
        buoyancyRatio: 1.45,
      }),
      createBoxRigidBody('b1_steel_heavy', { x: 890, y: -320, z: 258 }, { x: 24, y: 24, z: 24 }, 240, {
        restitution: 0.12,
        surfaceFriction: 1.6,
        buoyancyRatio: 0.35,
      }),

      // --- Bay 1: TGS Soft + NGS 3-Tier Stability Stack ---
      createBoxRigidBody('b1_stack_b1', { x: 980, y: 180, z: 222 }, { x: 22, y: 22, z: 22 }, 34),
      createBoxRigidBody('b1_stack_b2', { x: 1030, y: 180, z: 222 }, { x: 22, y: 22, z: 22 }, 34),
      createBoxRigidBody('b1_stack_mid', { x: 1005, y: 180, z: 266 }, { x: 22, y: 22, z: 22 }, 28),
      createBoxRigidBody('b1_stack_top', { x: 1005, y: 180, z: 308 }, { x: 18, y: 18, z: 18 }, 18),

      // --- Bay 1: Verlet Rope Swinging Crate ---
      createBoxRigidBody('b1_pendulum_crate', { x: 858, y: 0, z: 310 }, { x: 20, y: 20, z: 20 }, 26, {
        restitution: 0.35,
      }),

      // --- Bay 1: Buoyancy Tank Floaters & Sinkers ---
      createBoxRigidBody('b1_buoy_float_1', { x: 1360, y: -120, z: 170 }, { x: 22, y: 22, z: 26 }, 28, {
        buoyancyRatio: 1.75,
        restitution: 0.25,
      }),
      createBoxRigidBody('b1_buoy_float_2', { x: 1480, y: 110, z: 175 }, { x: 28, y: 18, z: 18 }, 24, {
        buoyancyRatio: 1.9,
        restitution: 0.3,
      }),
      createBoxRigidBody('b1_buoy_sink_iron', { x: 1420, y: 0, z: 150 }, { x: 18, y: 18, z: 18 }, 140, {
        buoyancyRatio: 0.32,
      }),

      // --- Bay 2: Articulated Ragdolls & Breakable Hinged Door ---
      ...ragA.bodies,
      ...ragB.bodies,
      ...ragHang.bodies,
      createBoxRigidBody('b2_hinged_door', { x: 384, y: 934, z: 270 }, { x: 54, y: 6, z: 66 }, 42, {
        restitution: 0.2,
        surfaceFriction: 1.1,
      }),

      // --- Bay 3: 4-Wheel Raycast Vehicle Chassis & Slalom Pylons ---
      createBoxRigidBody('veh_buggy_chassis', { x: -120, y: -930, z: 256 }, { x: 72, y: 38, z: 18 }, 420, {
        kind: 'vehicle',
        restitution: 0.12,
        surfaceFriction: 0.75,
        buoyancyRatio: 0.85,
      }),
      createBoxRigidBody('b3_pylon_1', { x: 780, y: -1020, z: 224 }, { x: 16, y: 16, z: 24 }, 14),
      createBoxRigidBody('b3_pylon_2', { x: 960, y: -840, z: 224 }, { x: 16, y: 16, z: 24 }, 14),
      createBoxRigidBody('b3_pylon_3', { x: 1140, y: -1020, z: 224 }, { x: 16, y: 16, z: 24 }, 14),

      // --- Bay 4: Surf Ramp Shadow Authority Test Props ---
      createBoxRigidBody('b4_surf_prop_1', { x: -240, y: -300, z: 855 }, { x: 18, y: 18, z: 18 }, 16),
      createBoxRigidBody('b4_surf_prop_2', { x: 80, y: -300, z: 685 }, { x: 18, y: 18, z: 18 }, 16),
    ];

    const joints: SourceJoint[] = [
      ...ragA.joints,
      ...ragB.joints,
      ...ragHang.joints,
      // Pendulum distance constraint pinning swinging crate to Bay 1 gantry beam
      {
        id: 'b1_jt_pendulum',
        kind: 'distance',
        bodyAId: 'b1_pendulum_crate',
        bodyBId: null,
        localAnchorA: { x: 0, y: 0, z: 20 },
        localAnchorB: { x: 858, y: 0, z: 440 },
        restLength: 110,
        frequencyHz: 14,
        dampingRatio: 0.85,
        breakForce: 3600,
      },
      // Breakable hinge pins for Bay 2 door
      {
        id: 'b2_jt_door_top',
        kind: 'hinge',
        bodyAId: 'b2_hinged_door',
        bodyBId: null,
        localAnchorA: { x: -54, y: 0, z: 46 },
        localAnchorB: { x: 330, y: 934, z: 316 },
        localAxisA: { x: 0, y: 0, z: 1 },
        localAxisB: { x: 0, y: 0, z: 1 },
        frequencyHz: 20,
        dampingRatio: 1.0,
        breakForce: 1500,
      },
      {
        id: 'b2_jt_door_bot',
        kind: 'hinge',
        bodyAId: 'b2_hinged_door',
        bodyBId: null,
        localAnchorA: { x: -54, y: 0, z: -46 },
        localAnchorB: { x: 330, y: 934, z: 224 },
        localAxisA: { x: 0, y: 0, z: 1 },
        localAxisB: { x: 0, y: 0, z: 1 },
        frequencyHz: 20,
        dampingRatio: 1.0,
        breakForce: 1500,
      },
      // Pin hanging ragdoll head to overhead gallows beam
      {
        id: 'b2_jt_hang_pin',
        kind: 'distance',
        bodyAId: 'rag_hang_head',
        bodyBId: null,
        localAnchorA: { x: 0, y: 0, z: 7.5 },
        localAnchorB: { x: 0, y: 1536, z: 448 },
        restLength: 92,
        frequencyHz: 14,
        dampingRatio: 0.9,
        breakForce: 2200,
      },
    ];

    return { bodies, joints };
  };

  const createRigidBodies = (): SourceRigidBody[] => buildRagdollAndJointData().bodies;
  const createJoints = (): SourceJoint[] => buildRagdollAndJointData().joints;

  const createRopes = (): SourceRope[] => [
    // Visual/physical Verlet cable for Bay 1 swinging pendulum crate
    createVerletRope(
      'rope_b1_pendulum',
      { x: 858, y: 0, z: 440 },
      { x: 858, y: 0, z: 330 },
      8,
      {
        startPin: { anchor: { x: 858, y: 0, z: 440 } },
        endPin: { bodyId: 'b1_pendulum_crate', anchor: { x: 0, y: 0, z: 20 } },
      },
    ),
    // Free-draping cable across Bay 1 gantry posts
    createVerletRope(
      'rope_b1_span',
      { x: 858, y: -260, z: 440 },
      { x: 858, y: 260, z: 440 },
      14,
      {
        startPin: { anchor: { x: 858, y: -260, z: 440 } },
        endPin: { anchor: { x: 858, y: 260, z: 440 } },
        damping: 0.03,
      },
    ),
    // Suspension tether on Bay 2 hanging ragdoll
    createVerletRope(
      'rope_b2_ragdoll',
      { x: 0, y: 1536, z: 448 },
      { x: 0, y: 1536, z: 356 },
      7,
      {
        startPin: { anchor: { x: 0, y: 1536, z: 448 } },
        endPin: { bodyId: 'rag_hang_head', anchor: { x: 0, y: 0, z: 7.5 } },
      },
    ),
  ];

  const createWaterVolumes = (): WaterVolume[] => [
    {
      id: 'water_b1_tank',
      minX: 1180,
      minY: -340,
      minZ: 20,
      maxX: 1660,
      maxY: 340,
      maxZ: 200,
      surfaceZ: 184,
      density: 1.0,
      linearDrag: 2.3,
      angularDrag: 2.8,
      currentVel: { x: 0, y: 28, z: 0 },
    },
  ];

  const createVehicles = (): SourceVehicle[] => [
    createFourWheelVehicle('veh_buggy_01', 'veh_buggy_chassis', {
          halfTrackY: 36,
          frontAxleX: 56,
          rearAxleX: -54,
          hubZ: -10,
          restLength: 28,
          wheelRadius: 16,
          stiffness: 7200,
          damping: 850,
          grip: 1.5,
          maxSteerRad: 0.54,
          engineForce: 340000,
          brakeForce: 320000,
        }),
  ];

  return {
    brushes: builder.brushes as ConvexBrush[],
    triggers: builder.triggers as TriggerVolume[],
    signs,
    spawn,
    createRigidBodies,
    createJoints,
    createRopes,
    createWaterVolumes,
    createVehicles,
    ladders,
  };
}

Integration Note for WorldRenderer.ts If WorldRenderer creates a THREE.WebGLRenderer and attaches a resize listener in its constructor, add a dispose() method (calling window.removeEventListener('resize', ...) and disposing geometries/materials) so switching between Maps 1, 2, 3, 4 leaks zero GPU memory. SurfApp.loadMap() already calls this.renderer?.dispose?.() automatically.

```markdown
# CONTEXT.md — Browser CS 1.6 Surf & Source Physics Sandbox

## 1. Project Overview
A browser-based Counter-Strike 1.6 Surf & Source VPhysics sandbox built with **TypeScript** and **Three.js**. It pairs a deterministic **100 Hz (`FIXED_DT = 0.01`) GoldSrc/Source `CGameMovement` player controller** with a **Rapier-inspired TGS Soft + NGS rigid-body solver**, communicating across a zero-allocation `SharedArrayBuffer` / typed-array ABI (`PhysicsMemoryAbi`).

### Core Capabilities
- **Player Movement (`GoldSrcPhysicsEngine`):** Exact `f32`-quantized GoldSrc/Source movement math (`AirAccelerate`, `Accelerate`, `Friction`, `ClipVelocity`, multi-plane `PM_FlyMove` with crease cross-products, `StepMove`, crouch/uncrouch hull transitions, sub-tick midpoint yaw, and surf ramp-seam dead-stop recovery).
- **Rigid-Body & Subsystem Pipeline:** Substepped TGS Soft velocity solver, unbiased relaxation, NGS position projection, circular Coulomb + torsional patch friction, selective CCD sweeps, sleeping islands, articulated breakable ragdolls/joints, Verlet ropes, buoyancy/swimming, ladder climbing, Velocity-PID Gravity Gun, and 4-wheel raycast vehicles.
- **Rendering (`WorldRenderer`):** Three.js WebGL renderer translating Hammer Z-up coordinates to Three.js Y-up space, featuring BSP brush meshes, dynamic rigid-body/rope/vehicle/joint visual sync, viewmodel rig, tracers/particles, and a spring-arm third-person vehicle chase camera.
- **Gameplay & UI:** Scout / USP .45 / Knife weapon system, hitscan + expanded melee traces, run timer with checkpoint splits and personal bests, strafe-sync telemetry HUD, and procedural Web Audio synthesizer (`SurfAudioEngine`).

---

## 2. Directory & File Structure

```text
src/
├── main.ts                          # Entry point: mounts canvas and initializes SurfApp
├── app/SurfApp.ts
├── core/
│   ├── constants.ts                 # FIXED_DT (0.01s), f32(), hull dims, SURF_NORMAL_Z, MoveState, bitflags
│   ├── coordinates.ts
│   └── memoryAbi.ts                 # PhysicsMemoryAbi (F32 & I32 typed-array offsets for zero-GC state sync)
├── physics/
│   ├── BrushBuilder.ts              # ConvexBrush & TriggerVolume builders, Minkowski planes, surf ramp generators
│   └── GoldSrcPhysicsEngine.ts      # 100 Hz CGameMovement + TGS Soft/NGS rigid bodies, joints, ropes, water, ladders, vehicles
├── maps/
│   ├── mapRegistry.ts               # Map registry (MapId union, metadata, build() factory lookup)
│   ├── surfSandbox01.ts             # Base surf sandbox map & MapBuildResult / WorldSign interfaces
│   ├── surfSandbox02.ts             # Additional surf/skill course map
│   ├── surfSandbox03.ts             # Additional surf/skill course map
│   └── surfSandbox04.ts             # Full subsystem proving ground (4 bays: Props/Water, Ragdolls/Joints, 4WD Buggy, Ladders/52° Surf)
├── gameplay/
│   ├── InputController.ts           # Pointer lock, WASD/jump/duck/use key state, scroll-wheel bhop, mouse yaw/pitch
│   ├── WeaponSystem.ts              # Slot 1 (Scout), Slot 2 (USP .45), Slot 3 (Knife), recoil, reload, drop/pickup
│   ├── RunTracker.ts                # Start/checkpoint/finish tick timer, segment deltas, gold splits, PB tracking
│   └── StrafeSyncTracker.ts         # Rolling air-strafe sync percentage calculator (yaw delta vs A/D input)
├── render/
│   ├── WorldRenderer.ts             # Three.js scene, Z-up -> Y-up coordinate mapping, brush/prop/rope/vehicle sync, chase cam
│   ├── textures.ts
│   └── ViewmodelRig.ts              # First-person weapon viewmodel animation (bob, strafe tilt, mouse sway, recoil)
├── audio/
│   └── SurfAudioEngine.ts           # Procedural Web Audio API sound effects (surf wind, jumps, impacts, explosions, weapons)
├── styles/
├   └── sandbox.css 
└── ui/
    ├── HudController.ts             # Speedometer, velocity Z, strafe sync, subsystem telemetry, interact prompts, toasts
    ├── CombatHudOverlay.ts          # Crosshair, dynamic spread, hitmarkers (normal/blood/kill), HP & blood vitals
    └── MenuController.ts            # Pause/settings overlay (map select, sensitivity, FOV, airaccel/maxvel cvars, debug)

```

---

## 3. Critical Architectural Rules & Invariants (Read Before Editing)

### A. Coordinate System & Euler Angles

1. **Physics & Maps = Hammer Z-Up Right-Handed:**
* `+X` = East (default spawn yaw `0`), `+Y` = North (`yaw = +π/2`), `+Z` = Up.
* `computeAngleVectors(sourcePitch, yaw, roll)` follows Source convention where **positive `sourcePitch` looks downward**. When converting from `InputController.viewPitch` (where positive looks upward), always negate pitch: `computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0)`.


2. **Three.js Renderer = Y-Up:**
* All Hammer-to-Three.js axis swaps stay encapsulated inside `WorldRenderer`. Never mix Three.js Y-up coordinates into `GoldSrcPhysicsEngine`, `SurfApp`, or map files.



### B. Deterministic `f32` Math & Memory ABI

* All player physics state lives in `PhysicsMemoryAbi` (`this.abi.f32` and `this.abi.i32`) indexed by `F32.*` and `I32.*` enums.
* Wrap velocity and position writes in `f32(...)` (`Math.fround`) inside `GoldSrcPhysicsEngine` to preserve single-precision determinism across snapshots (`capturePlayerSnapshot` / `restorePlayerSnapshot`).
* Keep hot-path sweeps allocation-free by reusing `traceScratch`, `bodyTraceScratch`, `auxTraceScratch`, and `StaticBrushBvh` scratch buffers.

### C. Subsystems & Dual-State Synchronization

* **Vehicle Driving:** `SurfApp.drivingVehicleId` and `GoldSrcPhysicsEngine.drivenVehicleId` **must always be updated together** via `enterVehicle()` / `exitVehicle()`. When `drivenVehicleId` is active, `GoldSrcPhysicsEngine.simulateTick()` skips standard player hull movement and pins `POS_X/Y/Z` to `chassis.pos + chassisUp * 36`.
* **Player Shadow Authority:** `resolvePlayerShadowCollisions(playerIsSurfing)` enforces one-way momentum when `playerIsSurfing === true` so rigid bodies never corrupt player speed on surf ramps.
* **Gravity Gun PID:** Uses velocity-level PID (`stepGravityGunPid`) rather than hard position snapping so held props still collide with world brushes.

### D. Hotkey & Input Conventions

* `1 / 2 / 3`: Weapon slots (Scout, USP .45, Knife); `4`: Toggle Gravity Gun (Physics Gun); `Q`: Quick-switch.
* `E`: Context-sensitive interact (`exitVehicle` -> `releaseHeldBody` -> `enterVehicle` -> `tryPickupLookedWeapon` -> `tryGrabRigidBody`).
* `C` (while driving): Toggle 3rd-person chase camera vs. cockpit camera.
* `B / C / V` (on foot): Stage checkpoint respawn / save practice checkpoint / load practice checkpoint.
* `T / F / X`: Spawn crate / detonate test blast / reset props & subsystems.
* `R`: Reload weapon (or exit vehicle if driving; full reset if holding Knife or dead).

---

## 4. Coding Conventions for AI Assistants

* **TypeScript Strictness:** Maintain explicit interfaces for subsystem configs (`SourceRigidBody`, `SourceJoint`, `SourceRope`, `WaterVolume`, `SourceVehicle`, `LadderVolume`).
* **Complete File Outputs:** When modifying core files (`GoldSrcPhysicsEngine.ts`, `SurfApp.ts`, `WorldRenderer.ts`), preserve existing public APIs, telemetry hooks (`SubsystemTelemetry`, `PhysicsCallbacks`), and map factory signatures (`ExtendedMapBuildResult`).
* **Frame-Rate Independence:** Simulation logic runs strictly inside `SurfApp.stepPhysicsTick()` at `100 Hz` (`FIXED_DT = 0.01`). Camera smoothing, viewmodel sway, and visual interpolation belong in `SurfApp.frame()` / `WorldRenderer.update()` using exponential smoothing `1 - Math.exp(-rate * frameDt)`.

```

<FollowUp label="Want me to add a section documenting the exact F32/I32 ABI memory layout and physics tuning constants?" query="Inspect constants.ts and memoryAbi.ts or expand CONTEXT.md with the exact F32/I32 ABI memory offsets and physics cvar defaults."/>

```
//

//WorldRenderer.ts
// src/render/WorldRenderer.ts
import * as THREE from 'three';
import { SURF_NORMAL_Z } from '../core/constants';
import { gsToThree } from '../core/coordinates';
import { ConvexBrush, TriggerVolume } from '../physics/BrushBuilder';
import {
  LadderVolume,
  SourceJoint,
  SourceRigidBody,
  SourceRope,
  SourceVehicle,
  Vec3,
  WaterVolume,
} from '../physics/GoldSrcPhysicsEngine';
import { WorldSign } from '../maps/surfSandbox01';
import { makeDevGridTexture, makeHazardTexture } from './textures';

interface ExplosionFx {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  duration: number;
  maxRadius: number;
}

interface TracerFx {
  line: THREE.Line;
  mat: THREE.LineBasicMaterial;
  age: number;
  duration: number;
}

interface ParticleFx {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  age: number;
  duration: number;
  gravity: number;
}

interface DecalFx {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  duration: number;
}

interface VehicleWheelVisual {
  wheelMeshes: THREE.Group[];
  strutLines: THREE.Line[];
}
export interface VehicleChaseCamInput {
  pivotX: number;
  pivotY: number;
  pivotZ: number;
  forwardX: number;
  forwardY: number;
  forwardZ: number;
  clampedDist: number;
  speedXY: number;
}

export class WorldRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly vmScene = new THREE.Scene();
  private readonly vmCamera: THREE.PerspectiveCamera;
  private readonly vmRoot: THREE.Group;

  private readonly boosterTex: THREE.CanvasTexture;
  private readonly waterTex: THREE.CanvasTexture;
  private readonly rigidBodyMat: THREE.MeshStandardMaterial;
  private readonly foamPropMat: THREE.MeshStandardMaterial;
  private readonly steelPropMat: THREE.MeshStandardMaterial;
  private readonly doorPropMat: THREE.MeshStandardMaterial;
  private readonly rigidBodyEdgeMat: THREE.LineBasicMaterial;
  private readonly ropeMat: THREE.LineBasicMaterial;
  private readonly strutMat: THREE.LineBasicMaterial;
  private readonly jointDbgMat: THREE.LineBasicMaterial;

  private readonly rigidBodyMeshes = new Map<string, THREE.Object3D>();
  private readonly seenRigidBodyIds = new Set<string>();
  private readonly ropeLines = new Map<string, THREE.Line>();
  private readonly seenRopeIds = new Set<string>();
  private readonly vehicleVisuals = new Map<string, VehicleWheelVisual>();
  private readonly seenVehicleIds = new Set<string>();

  private readonly waterGroup = new THREE.Group();
  private readonly ladderDebugGroup = new THREE.Group();
  private readonly jointDebugLines: THREE.LineSegments;
  private readonly jointDebugPositions = new Float32Array(256 * 6);

  // Gravity Gun PID tether beam + lock halo
  private readonly gravBeamLine: THREE.Line;
  private readonly gravBeamPositions = new Float32Array(6);
  private readonly gravHaloMesh: THREE.LineSegments;

  private readonly explosionGeo = new THREE.SphereGeometry(1, 20, 14);
  private readonly particleGeo = new THREE.BoxGeometry(2.8, 2.8, 2.8);
  private readonly decalGeo = new THREE.CircleGeometry(5.5, 10);

  private readonly explosionEffects: ExplosionFx[] = [];
  private readonly tracerEffects: TracerFx[] = [];
  private readonly particleEffects: ParticleFx[] = [];
  private readonly decals: DecalFx[] = [];

  public readonly debugGroup = new THREE.Group();
  public baseFov = 90;

  private scopeZoomLevel: 0 | 1 | 2 = 0;
  private currentFov = 90;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpVecA = new THREE.Vector3();
  private readonly tmpVecB = new THREE.Vector3();
  private readonly tmpVecC = new THREE.Vector3();
  // Third-person vehicle chase camera spring-arm state (Hammer Z-up space)
    private chaseInitialized = false;
    private chaseCurrentDist = 210;
    private chasePos = { x: 0, y: 0, z: 0 };
    private chaseFovOffset = 0;

    public resetVehicleChaseCamera(): void {
      this.chaseInitialized = false;
      this.chaseFovOffset = 0;
    }

    /**
     * Computes smoothed third-person chase camera coordinates in Hammer Z-up space.
     * Retracts fast when wall-clamped and extends smoothly when clear.
     */
    public resolveVehicleChaseCamera(
      dt: number,
      input: VehicleChaseCamInput,
    ): { x: number; y: number; z: number } {
      const clampedDt = Math.min(0.05, Math.max(0, dt));

      // Snap inward quickly on wall collision; ease outward smoothly when clear
      const distRate = input.clampedDist < this.chaseCurrentDist ? 26 : 7.5;
      const distAlpha = 1 - Math.exp(-distRate * clampedDt);
      this.chaseCurrentDist = this.chaseInitialized
        ? this.chaseCurrentDist + (input.clampedDist - this.chaseCurrentDist) * distAlpha
        : input.clampedDist;

      // Subtle lift above the sightline so the roof/hood stays cleanly framed
      const liftZ = 14 + (this.chaseCurrentDist / 220) * 10;
      const targetX = input.pivotX - input.forwardX * this.chaseCurrentDist;
      const targetY = input.pivotY - input.forwardY * this.chaseCurrentDist;
      const targetZ = input.pivotZ - input.forwardZ * this.chaseCurrentDist + liftZ;

      if (!this.chaseInitialized) {
        this.chasePos.x = targetX;
        this.chasePos.y = targetY;
        this.chasePos.z = targetZ;
        this.chaseInitialized = true;
      } else {
        // Tighten tracking when wall-blocked so the spring never lags behind geometry
        const posRate = input.clampedDist < 120 ? 28 : 14;
        const posAlpha = 1 - Math.exp(-posRate * clampedDt);
        this.chasePos.x += (targetX - this.chasePos.x) * posAlpha;
        this.chasePos.y += (targetY - this.chasePos.y) * posAlpha;
        this.chasePos.z += (targetZ - this.chasePos.z) * posAlpha;
      }

      // Optional speed FOV punch (+0..10 deg) you can add to your camera FOV in update()
      const targetFovBoost = Math.min(10, Math.max(0, (input.speedXY - 220) * 0.014));
      this.chaseFovOffset += (targetFovBoost - this.chaseFovOffset) * (1 - Math.exp(-6 * clampedDt));

      return this.chasePos;
    }

    public getVehicleChaseFovOffset(): number {
      return this.chaseFovOffset;
    }
  constructor(
    canvas: HTMLCanvasElement,
    brushes: ConvexBrush[],
    triggers: TriggerVolume[],
    signs: WorldSign[],
    vmRoot: THREE.Group,
  ) {
    this.vmRoot = vmRoot;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene.fog = new THREE.FogExp2(0x0c1322, 0.000085);

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 2, 32000);
    this.camera.up.set(0, 1, 0);

    this.vmCamera = new THREE.PerspectiveCamera(62, aspect, 0.05, 20);
    this.vmScene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.25));
    const vmKeyLight = new THREE.DirectionalLight(0xfff7ed, 1.4);
    vmKeyLight.position.set(2, 4, 3);
    this.vmScene.add(vmKeyLight);
    this.vmScene.add(vmRoot);

    this.scene.add(new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.85));
    const sunLight = new THREE.DirectionalLight(0xfffbeb, 1.35);
    sunLight.position.set(2800, 4600, 1900);
    this.scene.add(sunLight);
    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.42);
    fillLight.position.set(-2200, 1400, -2600);
    this.scene.add(fillLight);

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.boosterTex = makeDevGridTexture(
      '#083344',
      '#22d3ee',
      'rgba(34,211,238,0.25)',
      'rgba(103,232,249,0.9)',
      maxAniso,
      '',
      true,
    );
    this.waterTex = makeDevGridTexture(
      '#0369a1',
      '#38bdf8',
      'rgba(125,211,252,0.24)',
      '#7dd3fc',
      maxAniso,
      'H2O',
    );

    this.rigidBodyMat = new THREE.MeshStandardMaterial({
      map: makeDevGridTexture(
        '#3b2f1e',
        '#f59e0b',
        'rgba(251,191,36,0.22)',
        '#fbbf24',
        maxAniso,
        'PHYS',
      ),
      roughness: 0.5,
      metalness: 0.22,
    });
    this.foamPropMat = new THREE.MeshStandardMaterial({
      map: makeDevGridTexture('#0f4c5c', '#38bdf8', 'rgba(125,211,252,0.25)', '#7dd3fc', maxAniso, '8kg'),
      roughness: 0.78,
      metalness: 0.05,
    });
    this.steelPropMat = new THREE.MeshStandardMaterial({
      map: makeDevGridTexture('#1e293b', '#94a3b8', 'rgba(148,163,184,0.2)', '#cbd5e1', maxAniso, '240kg'),
      roughness: 0.32,
      metalness: 0.78,
    });
    this.doorPropMat = new THREE.MeshStandardMaterial({
      map: makeDevGridTexture('#431407', '#fb923c', 'rgba(251,146,60,0.25)', '#fdba74', maxAniso, 'DOOR'),
      roughness: 0.55,
      metalness: 0.25,
    });
    this.rigidBodyEdgeMat = new THREE.LineBasicMaterial({
      color: 0xfcd34d,
      transparent: true,
      opacity: 0.65,
    });
    this.ropeMat = new THREE.LineBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.92,
    });
    this.strutMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
    });
    this.jointDbgMat = new THREE.LineBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });

    const mats: Record<string, THREE.MeshStandardMaterial> = {
      slate: new THREE.MeshStandardMaterial({
        map: makeDevGridTexture('#1e2634', '#475569', 'rgba(148,163,184,0.12)', '#64748b', maxAniso, '64'),
        roughness: 0.72,
        metalness: 0.12,
      }),
      rampFace: new THREE.MeshStandardMaterial({
        map: makeDevGridTexture('#c2590c', '#fed7aa', 'rgba(255,237,213,0.18)', '#fbbf24', maxAniso, 'SURF'),
        roughness: 0.42,
        metalness: 0.14,
      }),
      steepFace: new THREE.MeshStandardMaterial({
        map: makeDevGridTexture('#b91c1c', '#fecaca', 'rgba(254,202,202,0.18)', '#fb923c', maxAniso, '60°'),
        roughness: 0.38,
        metalness: 0.16,
      }),
      walkable: new THREE.MeshStandardMaterial({
        map: makeDevGridTexture('#0f766e', '#99f6e4', 'rgba(153,246,228,0.18)', '#2dd4bf', maxAniso, '30°'),
        roughness: 0.55,
        metalness: 0.1,
      }),
      booster: new THREE.MeshStandardMaterial({
        map: this.boosterTex,
        emissive: 0x0891b2,
        emissiveIntensity: 0.65,
        roughness: 0.25,
        metalness: 0.2,
      }),
      finish: new THREE.MeshStandardMaterial({
        map: makeDevGridTexture('#065f46', '#6ee7b7', 'rgba(110,231,183,0.2)', '#34d399', maxAniso, 'FIN'),
        emissive: 0x059669,
        emissiveIntensity: 0.35,
        roughness: 0.45,
        metalness: 0.15,
      }),
    };

    // Debug joint segments
    const jointGeo = new THREE.BufferGeometry();
    jointGeo.setAttribute('position', new THREE.BufferAttribute(this.jointDebugPositions, 3));
    jointGeo.setDrawRange(0, 0);
    this.jointDebugLines = new THREE.LineSegments(jointGeo, this.jointDbgMat);
    this.jointDebugLines.frustumCulled = false;

    this.debugGroup.visible = false;
    this.debugGroup.add(this.ladderDebugGroup, this.jointDebugLines);
    this.scene.add(this.debugGroup, this.waterGroup);

    // Gravity Gun PID tether + wireframe halo
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute('position', new THREE.BufferAttribute(this.gravBeamPositions, 3));
    this.gravBeamLine = new THREE.Line(
      beamGeo,
      new THREE.LineBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
      }),
    );
    this.gravBeamLine.visible = false;
    this.gravBeamLine.frustumCulled = false;

    this.gravHaloMesh = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    );
    this.gravHaloMesh.visible = false;
    this.scene.add(this.gravBeamLine, this.gravHaloMesh);

    this.buildSkyDome();
    this.buildVisualWorld(brushes, triggers, mats);
    this.buildWorldSigns(signs);

    window.addEventListener('resize', this.handleResize);
  }

  public dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.vmScene.remove(this.vmRoot);

    this.scene.traverse((obj) => {
      if (
        obj instanceof THREE.Mesh ||
        obj instanceof THREE.Line ||
        obj instanceof THREE.LineSegments
      ) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });

    this.boosterTex.dispose();
    this.waterTex.dispose();
    this.explosionGeo.dispose();
    this.particleGeo.dispose();
    this.decalGeo.dispose();
    this.renderer.dispose();
  }

  public setDebugVisible(visible: boolean): void {
    this.debugGroup.visible = visible;
  }

  public setScopeZoom(level: 0 | 1 | 2): void {
    this.scopeZoomLevel = level;
  }

  /** Render translucent fluid surfaces & submerged volume tint for buoyancy tanks */
  public setWaterVolumes(volumes: readonly WaterVolume[]): void {
    while (this.waterGroup.children.length > 0) {
      const child = this.waterGroup.children.pop()!;
      child.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
          if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
          else c.material.dispose();
        }
      });
    }

    for (let i = 0; i < volumes.length; i++) {
      const w = volumes[i];
      const sx = w.maxX - w.minX;
      const sy = w.maxY - w.minY;
      const depth = Math.max(2, w.surfaceZ - w.minZ);
      const cx = (w.minX + w.maxX) * 0.5;
      const cy = (w.minY + w.maxY) * 0.5;

      // Animated top water surface plane
      const surfGeo = new THREE.PlaneGeometry(sx, sy);
      surfGeo.rotateX(-Math.PI / 2);
      const surfMat = new THREE.MeshStandardMaterial({
        map: this.waterTex,
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.32,
        transparent: true,
        opacity: 0.58,
        roughness: 0.18,
        metalness: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const surfMesh = new THREE.Mesh(surfGeo, surfMat);
      gsToThree(cx, cy, w.surfaceZ, surfMesh.position);
      this.waterGroup.add(surfMesh);

      // Subtle volumetric depth tint
      const volGeo = new THREE.BoxGeometry(sx, depth, sy);
      const volMat = new THREE.MeshBasicMaterial({
        color: 0x0ea5e9,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const volMesh = new THREE.Mesh(volGeo, volMat);
      gsToThree(cx, cy, w.minZ + depth * 0.5, volMesh.position);
      this.waterGroup.add(volMesh);
    }
  }

  /** Render emerald debug wireframes & outward normal arrows for ladders (visible under F2) */
  public setLadders(ladders: readonly LadderVolume[]): void {
    while (this.ladderDebugGroup.children.length > 0) {
      const child = this.ladderDebugGroup.children.pop()!;
      child.traverse((c) => {
        if (c instanceof THREE.Mesh || c instanceof THREE.LineSegments || c instanceof THREE.Line) {
          c.geometry.dispose();
          if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
          else c.material.dispose();
        }
      });
    }

    for (let i = 0; i < ladders.length; i++) {
      const l = ladders[i];
      const sx = Math.max(4, l.maxX - l.minX);
      const sy = Math.max(4, l.maxY - l.minY);
      const sz = Math.max(4, l.maxZ - l.minZ);
      const cx = (l.minX + l.maxX) * 0.5;
      const cy = (l.minY + l.maxY) * 0.5;
      const cz = (l.minZ + l.maxZ) * 0.5;

      const boxGeo = new THREE.BoxGeometry(sx, sz, sy);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(boxGeo),
        new THREE.LineBasicMaterial({ color: 0x34d399 }),
      );
      gsToThree(cx, cy, cz, edges.position);
      boxGeo.dispose();

      // Outward climb normal indicator
      const p0 = gsToThree(cx, cy, cz);
      const p1 = gsToThree(cx + l.normalX * 42, cy + l.normalY * 42, cz + (l.normalZ ?? 0) * 42);
      const normLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([p0, p1]),
        new THREE.LineBasicMaterial({ color: 0x6ee7b7 }),
      );

      this.ladderDebugGroup.add(edges, normLine);
    }
  }

  public spawnExplosionEffect(origin: Vec3, radius: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.48,
      wireframe: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.explosionGeo, mat);
    gsToThree(origin.x, origin.y, origin.z, mesh.position);
    mesh.scale.setScalar(12);
    this.scene.add(mesh);

    this.explosionEffects.push({
      mesh,
      mat,
      age: 0,
      duration: 0.36,
      maxRadius: Math.max(120, radius * 0.55),
    });
  }

  public spawnBulletTracer(start: Vec3, end: Vec3, color = 0xfef08a): void {
    const p1 = gsToThree(start.x, start.y, start.z);
    const p2 = gsToThree(end.x, end.y, end.z);
    const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracerEffects.push({ line, mat, age: 0, duration: 0.09 });
  }

  public spawnImpactEffect(
    point: Vec3,
    normal: Vec3,
    material: 'world' | 'prop' | 'blood' | 'weapon',
  ): void {
    const hitPos = gsToThree(point.x, point.y, point.z);
    const hitNorm = new THREE.Vector3(normal.x, normal.z, -normal.y).normalize();

    const isBlood = material === 'blood';
    const count = isBlood ? 14 : 8;
    const baseColor = isBlood ? 0xdc2626 : material === 'prop' ? 0xfbbf24 : 0xfef08a;

    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: isBlood && i % 3 === 0 ? 0x7f1d1d : baseColor,
        transparent: true,
        opacity: 0.95,
      });
      const mesh = new THREE.Mesh(this.particleGeo, mat);
      mesh.position.copy(hitPos).addScaledVector(hitNorm, 2);
      mesh.scale.setScalar(isBlood ? 1.1 + Math.random() * 1.1 : 0.65 + Math.random() * 0.6);

      const speed = isBlood ? 110 + Math.random() * 210 : 140 + Math.random() * 260;
      const spread = new THREE.Vector3(
        (Math.random() - 0.5) * 1.4,
        (Math.random() - 0.5) * 1.4,
        (Math.random() - 0.5) * 1.4,
      );
      const vel = hitNorm.clone().add(spread).normalize().multiplyScalar(speed);
      vel.y += isBlood ? 45 : 70;

      this.scene.add(mesh);
      this.particleEffects.push({
        mesh,
        mat,
        vel,
        age: 0,
        duration: isBlood ? 0.55 + Math.random() * 0.35 : 0.24 + Math.random() * 0.16,
        gravity: isBlood ? 620 : 780,
      });
    }

    if (material === 'world' || isBlood) {
      const decalMat = new THREE.MeshBasicMaterial({
        color: isBlood ? 0x991b1b : 0x0f172a,
        transparent: true,
        opacity: isBlood ? 0.82 : 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const decal = new THREE.Mesh(this.decalGeo, decalMat);
      decal.position.copy(hitPos).addScaledVector(hitNorm, 0.8);
      decal.lookAt(hitPos.clone().add(hitNorm));
      decal.scale.setScalar(isBlood ? 1.8 + Math.random() * 0.9 : 0.65 + Math.random() * 0.35);
      this.scene.add(decal);
      this.decals.push({ mesh: decal, mat: decalMat, age: 0, duration: 16 });

      if (this.decals.length > 64) {
        const old = this.decals.shift()!;
        this.scene.remove(old.mesh);
        old.mat.dispose();
      }
    }
  }

  private createRigidBodyVisual(b: SourceRigidBody): THREE.Object3D {
    // 1. Dropped weapons (Scout / USP .45)
    if (b.kind === 'weapon' && b.weaponData) {
      const group = new THREE.Group();
      const isScout = b.weaponData.slot === 1;
      const metal = new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.35,
        metalness: 0.75,
        emissive: 0x0f172a,
      });
      const accent = new THREE.MeshStandardMaterial({
        color: isScout ? 0x4d5f47 : 0x1e293b,
        roughness: 0.6,
        metalness: 0.2,
      });

      if (isScout) {
        const stock = new THREE.Mesh(new THREE.BoxGeometry(34, 7, 6), accent);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 36, 10), metal);
        barrel.rotation.z = Math.PI * 0.5;
        barrel.position.set(16, 2.5, 0);
        const scope = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 16, 10), metal);
        scope.rotation.z = Math.PI * 0.5;
        scope.position.set(2, 6.2, 0);
        group.add(stock, barrel, scope);
      } else {
        const slide = new THREE.Mesh(new THREE.BoxGeometry(16, 4.5, 3.6), metal);
        slide.position.set(0, 2, 0);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(4.5, 8.5, 3.2), accent);
        grip.position.set(-4.5, -3, 0);
        group.add(slide, grip);
        if (b.weaponData.silenced) {
          const sup = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 11, 10), accent);
          sup.rotation.z = Math.PI * 0.5;
          sup.position.set(13, 2, 0);
          group.add(sup);
        }
      }

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(isScout ? 16 : 11, isScout ? 18 : 13, 20),
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.45,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI * 0.5;
      ring.position.y = -b.hz + 1;
      group.add(ring);
      return group;
    }

    // 2. 4-Wheel Raycast Vehicle Chassis (Roll-cage buggy tub)
    if (b.kind === 'vehicle') {
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xd97706,
        roughness: 0.38,
        metalness: 0.45,
      });
      const frameMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.5,
        metalness: 0.72,
      });
      const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
      const taillightMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

      const tub = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.hz * 1.4, b.hy * 1.9), bodyMat);
      tub.position.y = -b.hz * 0.15;

      const hood = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 0.85, b.hz * 0.65, b.hy * 1.5), frameMat);
      hood.position.set(b.hx * 0.52, b.hz * 0.62, 0);

      // Roll cage pillars + roof bar
      const cageRoof = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 0.9, 4, b.hy * 1.55), frameMat);
      cageRoof.position.set(-10, b.hz + 28, 0);
      const pillarOffsets: Array<[number, number]> = [
        [20, b.hy * 0.72],
        [20, -b.hy * 0.72],
        [-42, b.hy * 0.72],
        [-42, -b.hy * 0.72],
      ];
      for (const [px, pz] of pillarOffsets) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(4, 30, 4), frameMat);
        post.position.set(px, b.hz + 13, pz);
        group.add(post);
      }

      // Headlights (+X front) & Taillights (-X rear)
      const hlL = new THREE.Mesh(new THREE.BoxGeometry(3, 6, 10), headlightMat);
      hlL.position.set(b.hx + 1, 2, b.hy * 0.62);
      const hlR = hlL.clone();
      hlR.position.z = -b.hy * 0.62;

      const tlL = new THREE.Mesh(new THREE.BoxGeometry(3, 6, 10), taillightMat);
      tlL.position.set(-b.hx - 1, 2, b.hy * 0.62);
      const tlR = tlL.clone();
      tlR.position.z = -b.hy * 0.62;

      group.add(tub, hood, cageRoof, hlL, hlR, tlL, tlR);
      return group;
    }

    // 3. Articulated Ragdoll Segments vs Monolithic Combat Dummies
    if (b.kind === 'target') {
      const isRagdollSegment = /_(head|torso|arm_[lr]|leg_[lr])$/.test(b.id);
      if (isRagdollSegment) {
        const isHead = b.id.endsWith('_head');
        const isTorso = b.id.endsWith('_torso');
        const segMat = new THREE.MeshStandardMaterial({
          color: isHead ? 0xfca5a5 : isTorso ? 0x991b1b : 0x334155,
          roughness: 0.55,
          metalness: 0.14,
        });
        const geo = new THREE.BoxGeometry(b.hx * 2, b.hz * 2, b.hy * 2);
        const mesh = new THREE.Mesh(geo, segMat);
        mesh.name = 'targetTorso';
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0xfca5a5, transparent: true, opacity: 0.4 }),
        );
        mesh.add(edges);
        return mesh;
      }

      const group = new THREE.Group();
      const torsoMat = new THREE.MeshStandardMaterial({
        color: 0x991b1b,
        roughness: 0.55,
        metalness: 0.1,
      });
      const headMat = new THREE.MeshStandardMaterial({
        color: 0xfca5a5,
        roughness: 0.5,
        metalness: 0.08,
      });
      const torso = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 1.85, b.hz * 1.4, b.hy * 1.25), torsoMat);
      torso.name = 'targetTorso';
      torso.position.y = -b.hz * 0.15;

      const head = new THREE.Mesh(new THREE.BoxGeometry(14, 15, 14), headMat);
      head.position.y = b.hz * 0.72;

      const bullseye = new THREE.Mesh(
        new THREE.RingGeometry(4, 9, 16),
        new THREE.MeshBasicMaterial({ color: 0xfef08a, side: THREE.DoubleSide }),
      );
      bullseye.position.set(0, 4, b.hy * 0.64);
      const bullseyeBack = bullseye.clone();
      bullseyeBack.position.z = -b.hy * 0.64;

      group.add(torso, head, bullseye, bullseyeBack);
      return group;
    }

    // 4. Tactile Physics Props styled by role/mass
    let mat = this.rigidBodyMat;
    if (b.id.includes('door')) {
      mat = this.doorPropMat;
    } else if (b.mass <= 12) {
      mat = this.foamPropMat;
    } else if (b.mass >= 120) {
      mat = this.steelPropMat;
    }

    const geo = new THREE.BoxGeometry(b.hx * 2, b.hz * 2, b.hy * 2);
    const mesh = new THREE.Mesh(geo, mat);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.rigidBodyEdgeMat);
    mesh.add(edges);
    return mesh;
  }

  public syncRigidBodies(bodies: readonly SourceRigidBody[]): void {
    this.seenRigidBodyIds.clear();

    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      this.seenRigidBodyIds.add(b.id);

      let obj = this.rigidBodyMeshes.get(b.id);
      if (!obj) {
        obj = this.createRigidBodyVisual(b);
        this.scene.add(obj);
        this.rigidBodyMeshes.set(b.id, obj);
      }

      gsToThree(b.pos.x, b.pos.y, b.pos.z, obj.position);
      obj.quaternion.set(b.quat.x, b.quat.z, -b.quat.y, b.quat.w);

      if (b.kind === 'target' && typeof b.hp === 'number' && typeof b.maxHp === 'number') {
        const torso = (obj.name === 'targetTorso' ? obj : obj.getObjectByName('targetTorso')) as
          | THREE.Mesh
          | undefined;
        if (torso && torso.material instanceof THREE.MeshStandardMaterial) {
          const ratio = Math.max(0, b.hp / Math.max(1, b.maxHp));
          if (!b.id.endsWith('_head') && !/_(arm|leg)_[lr]$/.test(b.id)) {
            torso.material.color.setRGB(0.45 + 0.45 * ratio, 0.08 * ratio, 0.08 * ratio);
          }
        }
      }
    }

    for (const [id, obj] of this.rigidBodyMeshes.entries()) {
      if (!this.seenRigidBodyIds.has(id)) {
        this.scene.remove(obj);
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
            child.geometry.dispose();
            if (
              child.material !== this.rigidBodyMat &&
              child.material !== this.foamPropMat &&
              child.material !== this.steelPropMat &&
              child.material !== this.doorPropMat &&
              child.material !== this.rigidBodyEdgeMat
            ) {
              if (Array.isArray(child.material)) {
                child.material.forEach((m) => m.dispose());
              } else {
                child.material.dispose();
              }
            }
          }
        });
        this.rigidBodyMeshes.delete(id);
      }
    }
  }

  /** Sync Verlet rope/cable polylines */
  public syncRopes(ropes: readonly SourceRope[]): void {
    this.seenRopeIds.clear();

    for (let i = 0; i < ropes.length; i++) {
      const rope = ropes[i];
      this.seenRopeIds.add(rope.id);
      const count = rope.nodes.length;
      if (count < 2) continue;

      let line = this.ropeLines.get(rope.id);
      if (!line) {
        const positions = new Float32Array(count * 3);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        line = new THREE.Line(geo, this.ropeMat);
        line.frustumCulled = false;
        this.scene.add(line);
        this.ropeLines.set(rope.id, line);
      }

      const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let n = 0; n < count; n++) {
        const node = rope.nodes[n];
        arr[n * 3] = node.x;
        arr[n * 3 + 1] = node.z;
        arr[n * 3 + 2] = -node.y;
      }
      attr.needsUpdate = true;
    }

    for (const [id, line] of this.ropeLines.entries()) {
      if (!this.seenRopeIds.has(id)) {
        this.scene.remove(line);
        line.geometry.dispose();
        this.ropeLines.delete(id);
      }
    }
  }

  /** Sync 4-wheel raycast vehicle tires (suspension travel, steering yaw, rolling spin) & struts */
  public syncVehicles(
    vehicles: readonly SourceVehicle[],
    bodies: readonly SourceRigidBody[],
  ): void {
    this.seenVehicleIds.clear();

    for (let vIdx = 0; vIdx < vehicles.length; vIdx++) {
      const veh = vehicles[vIdx];
      const chassis = bodies.find((b) => b.id === veh.chassisId);
      if (!chassis) continue;
      this.seenVehicleIds.add(veh.id);

      let visual = this.vehicleVisuals.get(veh.id);
      if (!visual) {
        visual = this.createVehicleWheelVisuals(veh);
        this.vehicleVisuals.set(veh.id, visual);
      }

      this.tmpQuat.set(chassis.quat.x, chassis.quat.z, -chassis.quat.y, chassis.quat.w);
      const chassisPos = gsToThree(chassis.pos.x, chassis.pos.y, chassis.pos.z, this.tmpVecA);
      const chassisUp = this.tmpVecB.set(0, 1, 0).applyQuaternion(this.tmpQuat);
      const steerAngle = veh.steer * veh.maxSteerRad;

      for (let wIdx = 0; wIdx < veh.wheels.length; wIdx++) {
        const wheel = veh.wheels[wIdx];
        const wheelGroup = visual.wheelMeshes[wIdx];
        const strutLine = visual.strutLines[wIdx];
        if (!wheelGroup || !strutLine) continue;

        // Hardpoint in Three.js world space
        const hpWorld = this.tmpVecC
          .set(wheel.localHardpoint.x, wheel.localHardpoint.z, -wheel.localHardpoint.y)
          .applyQuaternion(this.tmpQuat)
          .add(chassisPos);

        const ext = Math.max(0, wheel.restLength - wheel.compression);
        wheelGroup.position.copy(hpWorld).addScaledVector(chassisUp, -ext);

        // Apply chassis orientation + front steering + rolling wheel spin around local Z axle
        wheelGroup.quaternion.copy(this.tmpQuat);
        if (wheel.steerable) {
          wheelGroup.rotateY(steerAngle);
        }
        const tireMesh = wheelGroup.children[0];
        if (tireMesh) {
          tireMesh.rotation.z = -wheel.spinAngle;
        }

        // Update suspension strut line between chassis hardpoint and wheel hub
        const attr = strutLine.geometry.getAttribute('position') as THREE.BufferAttribute;
        const arr = attr.array as Float32Array;
        arr[0] = hpWorld.x;
        arr[1] = hpWorld.y;
        arr[2] = hpWorld.z;
        arr[3] = wheelGroup.position.x;
        arr[4] = wheelGroup.position.y;
        arr[5] = wheelGroup.position.z;
        attr.needsUpdate = true;
      }
    }

    for (const [id, vis] of this.vehicleVisuals.entries()) {
      if (!this.seenVehicleIds.has(id)) {
        for (const wg of vis.wheelMeshes) {
          this.scene.remove(wg);
          wg.traverse((c) => {
            if (c instanceof THREE.Mesh) {
              c.geometry.dispose();
              if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
              else c.material.dispose();
            }
          });
        }
        for (const sl of vis.strutLines) {
          this.scene.remove(sl);
          sl.geometry.dispose();
        }
        this.vehicleVisuals.delete(id);
      }
    }
  }

  private createVehicleWheelVisuals(veh: SourceVehicle): VehicleWheelVisual {
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.85,
      metalness: 0.12,
    });
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      roughness: 0.35,
      metalness: 0.72,
    });

    const wheelMeshes: THREE.Group[] = [];
    const strutLines: THREE.Line[] = [];

    for (let i = 0; i < veh.wheels.length; i++) {
      const w = veh.wheels[i];
      const hubGroup = new THREE.Group();
      const spinGroup = new THREE.Group();

      const tireGeo = new THREE.CylinderGeometry(w.radius, w.radius, 11, 16);
      tireGeo.rotateX(Math.PI * 0.5);
      const tire = new THREE.Mesh(tireGeo, tireMat);

      // Spoke bar makes wheel spin clearly readable while driving
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(w.radius * 1.4, 3.2, 12.2), rimMat);
      const spokeCross = new THREE.Mesh(new THREE.BoxGeometry(3.2, w.radius * 1.4, 12.2), rimMat);

      spinGroup.add(tire, spoke, spokeCross);
      hubGroup.add(spinGroup);
      this.scene.add(hubGroup);
      wheelMeshes.push(hubGroup);

      const strutGeo = new THREE.BufferGeometry();
      strutGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const strut = new THREE.Line(strutGeo, this.strutMat);
      strut.frustumCulled = false;
      this.scene.add(strut);
      strutLines.push(strut);
    }

    return { wheelMeshes, strutLines };
  }

  /** Sync debug constraint links inside debugGroup (visible when F2 debug is enabled) */
  public syncJoints(joints: readonly SourceJoint[], bodies: readonly SourceRigidBody[]): void {
    if (!this.debugGroup.visible || joints.length === 0) {
      this.jointDebugLines.geometry.setDrawRange(0, 0);
      return;
    }

    let segCount = 0;
    const maxSegs = Math.floor(this.jointDebugPositions.length / 6);

    for (let i = 0; i < joints.length && segCount < maxSegs; i++) {
      const jt = joints[i];
      if (jt.broken) continue;
      const a = bodies.find((b) => b.id === jt.bodyAId);
      if (!a) continue;
      const b = jt.bodyBId ? bodies.find((body) => body.id === jt.bodyBId) : null;

      this.tmpQuat.set(a.quat.x, a.quat.z, -a.quat.y, a.quat.w);
      const pA = this.tmpVecA
        .set(jt.localAnchorA.x, jt.localAnchorA.z, -jt.localAnchorA.y)
        .applyQuaternion(this.tmpQuat)
        .add(gsToThree(a.pos.x, a.pos.y, a.pos.z, this.tmpVecC));

      let pB: THREE.Vector3;
      if (b) {
        this.tmpQuat.set(b.quat.x, b.quat.z, -b.quat.y, b.quat.w);
        pB = this.tmpVecB
          .set(jt.localAnchorB.x, jt.localAnchorB.z, -jt.localAnchorB.y)
          .applyQuaternion(this.tmpQuat)
          .add(gsToThree(b.pos.x, b.pos.y, b.pos.z, this.tmpVecC));
      } else {
        pB = gsToThree(jt.localAnchorB.x, jt.localAnchorB.y, jt.localAnchorB.z, this.tmpVecB);
      }

      const off = segCount * 6;
      this.jointDebugPositions[off] = pA.x;
      this.jointDebugPositions[off + 1] = pA.y;
      this.jointDebugPositions[off + 2] = pA.z;
      this.jointDebugPositions[off + 3] = pB.x;
      this.jointDebugPositions[off + 4] = pB.y;
      this.jointDebugPositions[off + 5] = pB.z;
      segCount++;
    }

    const attr = this.jointDebugLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.jointDebugLines.geometry.setDrawRange(0, segCount * 2);
  }

  /** Sync Gravity Gun cyan PID tether beam & lock wireframe halo */
  public syncGravityGunBeam(eyePos: Vec3 | null, heldBody: SourceRigidBody | null): void {
    if (!eyePos || !heldBody) {
      this.gravBeamLine.visible = false;
      this.gravHaloMesh.visible = false;
      return;
    }

    this.gravBeamLine.visible = true;
    this.gravHaloMesh.visible = true;

    const p0 = gsToThree(eyePos.x, eyePos.y, eyePos.z - 8, this.tmpVecA);
    const p1 = gsToThree(heldBody.pos.x, heldBody.pos.y, heldBody.pos.z, this.tmpVecB);
    this.gravBeamPositions[0] = p0.x;
    this.gravBeamPositions[1] = p0.y;
    this.gravBeamPositions[2] = p0.z;
    this.gravBeamPositions[3] = p1.x;
    this.gravBeamPositions[4] = p1.y;
    this.gravBeamPositions[5] = p1.z;
    (this.gravBeamLine.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate =
      true;

    this.gravHaloMesh.position.copy(p1);
    this.gravHaloMesh.quaternion.set(
      heldBody.quat.x,
      heldBody.quat.z,
      -heldBody.quat.y,
      heldBody.quat.w,
    );
    this.gravHaloMesh.scale.set(heldBody.hx * 2.08, heldBody.hz * 2.08, heldBody.hy * 2.08);
  }

  /** Unified per-frame sync for all dynamic physics subsystems */
  public syncSubsystems(
    bodies: readonly SourceRigidBody[],
    ropes: readonly SourceRope[],
    vehicles: readonly SourceVehicle[],
    joints: readonly SourceJoint[],
    gravEyePos: Vec3 | null,
    gravHeldBody: SourceRigidBody | null,
  ): void {
    this.syncRigidBodies(bodies);
    this.syncRopes(ropes);
    this.syncVehicles(vehicles, bodies);
    this.syncJoints(joints, bodies);
    this.syncGravityGunBeam(gravEyePos, gravHeldBody);
  }

  public update(
    frameDt: number,
    rx: number,
    ry: number,
    eyeZ: number,
    renderYaw: number,
    renderPitch: number,
    spdXY: number,
  ): void {
    this.boosterTex.offset.y -= frameDt * 1.45;
    this.waterTex.offset.y -= frameDt * 0.22;
    this.waterTex.offset.x += frameDt * 0.08;

    for (let i = this.explosionEffects.length - 1; i >= 0; i--) {
      const fx = this.explosionEffects[i];
      fx.age += frameDt;
      const t = fx.age / fx.duration;
      if (t >= 1) {
        this.scene.remove(fx.mesh);
        fx.mat.dispose();
        this.explosionEffects.splice(i, 1);
      } else {
        const eased = 1 - (1 - t) * (1 - t);
        fx.mesh.scale.setScalar(12 + eased * fx.maxRadius);
        fx.mat.opacity = (1 - t) * 0.48;
      }
    }

    for (let i = this.tracerEffects.length - 1; i >= 0; i--) {
      const tr = this.tracerEffects[i];
      tr.age += frameDt;
      const t = tr.age / tr.duration;
      if (t >= 1) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        tr.mat.dispose();
        this.tracerEffects.splice(i, 1);
      } else {
        tr.mat.opacity = (1 - t) * 0.85;
      }
    }

    for (let i = this.particleEffects.length - 1; i >= 0; i--) {
      const p = this.particleEffects[i];
      p.age += frameDt;
      const t = p.age / p.duration;
      if (t >= 1) {
        this.scene.remove(p.mesh);
        p.mat.dispose();
        this.particleEffects.splice(i, 1);
      } else {
        p.vel.y -= p.gravity * frameDt;
        p.mesh.position.addScaledVector(p.vel, frameDt);
        p.mat.opacity = 1 - t;
      }
    }

    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.age += frameDt;
      if (d.age >= d.duration) {
        this.scene.remove(d.mesh);
        d.mat.dispose();
        this.decals.splice(i, 1);
      } else if (d.age > d.duration - 2) {
        d.mat.opacity = Math.max(0, ((d.duration - d.age) / 2) * 0.8);
      }
    }

    const cosP = Math.cos(renderPitch);
    const fwdX = cosP * Math.cos(renderYaw);
    const fwdY = cosP * Math.sin(renderYaw);
    const fwdZ = Math.sin(renderPitch);

    gsToThree(rx, ry, eyeZ, this.camPos);
    gsToThree(rx + fwdX * 100, ry + fwdY * 100, eyeZ + fwdZ * 100, this.camLook);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    let targetFov: number;
    if (this.scopeZoomLevel === 1) {
      targetFov = 38;
    } else if (this.scopeZoomLevel === 2) {
      targetFov = 16;
    } else {
      const fovBoost = THREE.MathUtils.clamp((spdXY - 450) / 2550, 0, 1) * 22.0;
      targetFov = this.baseFov + fovBoost;
    }

    if (Math.abs(this.currentFov - targetFov) > 0.02) {
      const rate = this.scopeZoomLevel > 0 ? 22 : 7.5;
      this.currentFov = THREE.MathUtils.lerp(this.currentFov, targetFov, Math.min(1, frameDt * rate));
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }
  }

  public render(): void {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
  }

  private handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  private buildSkyDome(): void {
    const skyGeo = new THREE.SphereGeometry(24000, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x070b14) },
        midColor: { value: new THREE.Color(0x162944) },
        horizonColor: { value: new THREE.Color(0x2d3a4b) },
        bottomColor: { value: new THREE.Color(0x080a10) },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 horizonColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPos;
        void main() {
          float h = normalize(vWorldPos).y;
          vec3 col = h >= 0.0
            ? mix(horizonColor, mix(midColor, topColor, smoothstep(0.08, 0.65, h)), smoothstep(0.0, 0.25, h))
            : mix(horizonColor, bottomColor, smoothstep(0.0, -0.35, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));
  }

  private buildVisualWorld(
    brushes: ConvexBrush[],
    triggers: TriggerVolume[],
    mats: Record<string, THREE.MeshStandardMaterial>,
  ): void {
    const tileScale = 1 / 128;

    for (const brush of brushes) {
      const buckets = new Map<string, { pos: number[]; norm: number[]; uv: number[] }>();

      for (const face of brush.renderFaces) {
        const isSurfSlope = face.nz > 0.05 && face.nz < SURF_NORMAL_Z;
        let matKey = 'slate';
        if (brush.style === 'booster') matKey = 'booster';
        else if (brush.style === 'finish') matKey = 'finish';
        else if (brush.style === 'walkable' && face.nz > 0.4 && face.nz < 0.98) matKey = 'walkable';
        else if (brush.style === 'steep' && isSurfSlope) matKey = 'steepFace';
        else if (brush.style === 'ramp' && isSurfSlope) matKey = 'rampFace';

        if (!buckets.has(matKey)) {
          buckets.set(matKey, { pos: [], norm: [], uv: [] });
        }
        const b = buckets.get(matKey)!;

        const n3 = new THREE.Vector3(face.nx, face.nz, -face.ny).normalize();
        const upRef = Math.abs(n3.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const uAxis = new THREE.Vector3().crossVectors(upRef, n3).normalize();
        const vAxis = new THREE.Vector3().crossVectors(n3, uAxis).normalize();

        const vs = face.verts;
        for (let i = 1; i < vs.length - 1; i++) {
          const tri = [vs[0], vs[i], vs[i + 1]];
          for (const v of tri) {
            const tx = v[0];
            const ty = v[2];
            const tz = -v[1];
            b.pos.push(tx, ty, tz);
            b.norm.push(n3.x, n3.y, n3.z);
            b.uv.push(
              (tx * uAxis.x + ty * uAxis.y + tz * uAxis.z) * tileScale,
              (tx * vAxis.x + ty * vAxis.y + tz * vAxis.z) * tileScale,
            );
          }
        }
      }

      for (const [matKey, data] of buckets.entries()) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.norm, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
        this.scene.add(new THREE.Mesh(geo, mats[matKey]));

        const edges = new THREE.EdgesGeometry(geo, 24);
        const edgeColor =
          matKey === 'rampFace' ? 0xfdba74 : matKey === 'booster' ? 0x67e8f9 : 0x475569;
        this.scene.add(
          new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.35 }),
          ),
        );

        this.debugGroup.add(
          new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.9 }),
          ),
        );
      }
    }

    const failGeo = new THREE.PlaneGeometry(24000, 18000);
    failGeo.rotateX(-Math.PI / 2);
    const failMat = new THREE.MeshBasicMaterial({
      map: makeHazardTexture(),
      transparent: true,
      opacity: 0.72,
    });
    const failMesh = new THREE.Mesh(failGeo, failMat);
    failMesh.position.set(6500, -200, 250);
    this.scene.add(failMesh);

    for (const trig of triggers) {
      const sx = trig.maxX - trig.minX;
      const sy = trig.maxY - trig.minY;
      const sz = trig.maxZ - trig.minZ;
      const cx = (trig.minX + trig.maxX) * 0.5;
      const cy = (trig.minY + trig.maxY) * 0.5;
      const cz = (trig.minZ + trig.maxZ) * 0.5;

      const boxGeo = new THREE.BoxGeometry(sx, sz, sy);
      const posThree = gsToThree(cx, cy, cz);

      if (trig.type === 'start') {
        const gate = new THREE.Mesh(
          boxGeo,
          new THREE.MeshBasicMaterial({
            color: 0x10b981,
            transparent: true,
            opacity: 0.14,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        gate.position.copy(posThree);
        this.scene.add(gate);
      } else if (trig.type === 'checkpoint') {
        const cpField = new THREE.Mesh(
          boxGeo,
          new THREE.MeshBasicMaterial({
            color: 0xa855f7,
            transparent: true,
            opacity: 0.08,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        cpField.position.copy(posThree);
        this.scene.add(cpField);

        const wire = new THREE.LineSegments(
          new THREE.EdgesGeometry(boxGeo),
          new THREE.LineBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.4 }),
        );
        wire.position.copy(posThree);
        this.scene.add(wire);
      } else if (trig.type === 'push') {
        const boostField = new THREE.Mesh(
          boxGeo,
          new THREE.MeshBasicMaterial({
            color: 0x22d3ee,
            transparent: true,
            opacity: 0.12,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        boostField.position.copy(posThree);
        this.scene.add(boostField);

        const wire = new THREE.LineSegments(
          new THREE.EdgesGeometry(boxGeo),
          new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55 }),
        );
        wire.position.copy(posThree);
        this.scene.add(wire);
      } else if (trig.type === 'explosion') {
        const blastField = new THREE.Mesh(
          boxGeo,
          new THREE.MeshBasicMaterial({
            color: 0xf97316,
            transparent: true,
            opacity: 0.14,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        blastField.position.copy(posThree);
        this.scene.add(blastField);

        const wire = new THREE.LineSegments(
          new THREE.EdgesGeometry(boxGeo),
          new THREE.LineBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.7 }),
        );
        wire.position.copy(posThree);
        this.scene.add(wire);
      } else if (trig.type === 'end') {
        const endField = new THREE.Mesh(
          boxGeo,
          new THREE.MeshBasicMaterial({
            color: 0x34d399,
            transparent: true,
            opacity: 0.12,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        endField.position.copy(posThree);
        this.scene.add(endField);
      }

      const dbgColors: Record<string, number> = {
        start: 0x10b981,
        checkpoint: 0xa855f7,
        end: 0x4ade80,
        push: 0x22d3ee,
        explosion: 0xf97316,
        teleport: 0xf43f5e,
      };
      const col = dbgColors[trig.type] ?? 0xffffff;
      const dbgMesh = new THREE.Mesh(
        boxGeo,
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: trig.type === 'teleport' ? 0.12 : 0.28,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      dbgMesh.position.copy(posThree);
      this.debugGroup.add(dbgMesh);

      const dbgEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(boxGeo),
        new THREE.LineBasicMaterial({ color: col }),
      );
      dbgEdges.position.copy(posThree);
      this.debugGroup.add(dbgEdges);
    }

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x131c2e, roughness: 0.9, metalness: 0.1 });
    const pillarCoords: Array<[number, number]> = [
      [900, 1200],
      [2300, -1450],
      [3700, 900],
      [4900, -1650],
      [6600, -900],
      [5600, 1750],
      [8200, 500],
      [7400, 3200],
      [10400, 5100],
      [13600, 3200],
      [13900, -200],
      [10800, -1400],
      [13400, -3400],
      [8200, -5600],
    ];
    for (const [px, py] of pillarCoords) {
      const pMesh = new THREE.Mesh(new THREE.BoxGeometry(220, 3000, 220), pillarMat);
      pMesh.position.copy(gsToThree(px, py, 500));
      this.scene.add(pMesh);
    }
  }

  private buildWorldSigns(signs: WorldSign[]): void {
    for (const s of signs) {
      const c = document.createElement('canvas');
      c.width = 760;
      c.height = 112;
      const g = c.getContext('2d')!;
      g.fillStyle = 'rgba(9, 13, 21, 0.84)';
      g.fillRect(6, 6, 748, 100);
      g.strokeStyle = s.color;
      g.lineWidth = 5;
      g.strokeRect(6, 6, 748, 100);
      g.fillStyle = s.color;
      g.font = '800 28px JetBrains Mono, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(s.text, 380, 58);

      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
      const geo = new THREE.PlaneGeometry(320 * s.scale, 49 * s.scale);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(gsToThree(s.x, s.y, s.z));
      mesh.rotation.y = s.yaw - Math.PI * 0.5;
      this.scene.add(mesh);
    }
  }
}

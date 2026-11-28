```markdown
# CONTEXT.md — Browser CS 1.6 Surf & Source Physics Sandbox

## 1. Project Overview
A browser-based Counter-Strike 1.6 Surf & Source VPhysics sandbox built with **TypeScript** and **Three.js**. It pairs a deterministic **100 Hz (`FIXED_DT = 0.01`) GoldSrc/Source `CGameMovement` player controller** with a **Rapier-inspired TGS Soft + NGS rigid-body solver**, communicating across a zero-allocation `SharedArrayBuffer` / typed-array ABI (`PhysicsMemoryAbi`).

### Core Capabilities
- **Player Movement (`GoldSrcPhysicsEngine`):** Exact `f32`-quantized GoldSrc/Source movement math (`AirAccelerate`, `Accelerate`, `Friction`, `ClipVelocity`, multi-plane `PM_FlyMove` with crease cross-products, `StepMove`, crouch/uncrouch hull transitions, sub-tick midpoint yaw, and surf ramp-seam dead-stop recovery).
- **Rigid-Body & Subsystem Pipeline:** Substepped TGS Soft velocity solver, unbiased relaxation, NGS position projection, circular Coulomb + torsional patch friction, selective CCD sweeps, sleeping islands, articulated breakable ragdolls/joints, Verlet ropes, buoyancy/swimming, ladder climbing, Velocity-PID Gravity Gun, and 4-wheel raycast vehicles.
- **Rendering (`WorldRenderer`):** Three.js WebGL renderer translating Hammer Z-up coordinates to Three.js Y-up space, featuring BSP brush meshes, dynamic rigid-body/rope/vehicle/joint visual sync, viewmodel rig overlay, tracers/particles/decals, a spring-arm third-person vehicle chase camera, and deterministic zero-leak GPU resource disposal across map reloads.
- **Gameplay & UI:** Scout / USP .45 / Knife weapon system, hitscan + expanded melee traces, run timer with checkpoint splits and personal bests, strafe-sync telemetry HUD, and procedural Web Audio synthesizer (`SurfAudioEngine`).

---

## 2. Directory & File Structure

```text
src/
├── main.ts                          # Entry point: mounts canvas and initializes SurfApp
├── app/SurfApp.ts                   # Main loop (100 Hz fixed step + variable render), map switching, input/subsystem orchestration
├── core/
│   ├── constants.ts                 # FIXED_DT (0.01s), f32(), hull dims, SURF_NORMAL_Z, MoveState, bitflags
│   ├── coordinates.ts               # Hammer Z-up <-> Three.js Y-up conversion helpers (gsToThree) & angle vectors
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
│   ├── WorldRenderer.ts             # Three.js scene, Z-up -> Y-up mapping, brush/prop/rope/vehicle sync, chase cam, zero-leak dispose()
│   ├── textures.ts                  # Procedural CanvasTexture generators (dev grids, water, boosters, hazard planes)
│   └── ViewmodelRig.ts              # First-person weapon viewmodel animation (bob, strafe tilt, mouse sway, recoil)
├── audio/
│   └── SurfAudioEngine.ts           # Procedural Web Audio API sound effects (surf wind, jumps, impacts, explosions, weapons)
├── styles/
│   └── sandbox.css                  # HUD, crosshair, scope overlay, and pause/settings menu styling
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

### D. Renderer Lifecycle & Zero-Leak Map Switching (`WorldRenderer.dispose`)

* `SurfApp.loadMap()` calls `this.renderer?.dispose?.()` before constructing a new `WorldRenderer` against the existing `<canvas>`.
* `WorldRenderer.dispose()` is idempotent (`this.disposed` guard) and must always:
1. Remove the `window` `'resize'` listener (`handleResize`).
2. Detach `vmRoot` from `vmScene` (`this.vmScene.remove(this.vmRoot)`) **without** disposing `vmRoot`'s geometries/materials, because `ViewmodelRig` persists across map loads.
3. Deduplicate and dispose every `BufferGeometry`, `Material`, and attached `CanvasTexture` map (`map`, `emissiveMap`, `normalMap`, etc.) across both `this.scene` and `this.sharedMaterials` (covering brush styles or prop materials unused on the current map, `WorldSign` textures, and `makeHazardTexture()`).
4. Clear dynamic entity maps (`rigidBodyMeshes`, `ropeLines`, `vehicleVisuals`), active FX arrays (`explosionEffects`, `tracerEffects`, `particleEffects`, `decals`), `this.scene`, `this.renderer.renderLists`, and call `this.renderer.dispose()`.
5. **Never call `this.renderer.forceContextLoss()**`, so the shared `<canvas>` element can immediately initialize a fresh `THREE.WebGLRenderer` for the next map.



### E. Hotkey & Input Conventions

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

<FollowUp label="Want me to add the exact F32/I32 ABI memory offsets and physics constants to CONTEXT.md?" query="Inspect constants.ts and memoryAbi.ts or expand CONTEXT.md with the exact F32/I32 ABI memory offsets and physics tuning constants."/>

```

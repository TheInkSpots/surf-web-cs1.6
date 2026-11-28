# CONTEXT.md — Browser CS 1.6 Surf & Source Physics Sandbox

## 1. Project Overview
A browser-based Counter-Strike 1.6 Surf & Source VPhysics sandbox built with **TypeScript** and **Three.js**. It pairs a deterministic **100 Hz (`FIXED_DT = 0.01`) GoldSrc/Source `CGameMovement` multi-actor controller** with a **Rapier-inspired TGS Soft + NGS rigid-body solver**, communicating across a zero-allocation `SharedArrayBuffer` / typed-array ABI (`PhysicsMemoryAbi`).

### Core Capabilities
- **Multi-Actor GoldSrc Movement (`GoldSrcPhysicsEngine`):** Exact `f32`-quantized GoldSrc/Source movement math (`AirAccelerate`, `Accelerate`, `Friction`, `ClipVelocity`, multi-plane `PM_FlyMove` with crease cross-products, `StepMove`, crouch/uncrouch hull transitions, sub-tick midpoint yaw, and surf ramp-seam dead-stop recovery) generalized across an indexed actor pool (`MAX_ACTORS = 16`).
- **T vs. CT Combat & Bots (`TeamMatchManager`, `BotController`):** Team assignment (`T`, `CT`, `SPEC`), round timer/economy, solid PvP hull-vs-hull collisions with CS 1.6 teammate head-boosting (`mp_solid_teammates`), 4-zone segmented hitboxes (`Head 4.0x`, `Stomach 1.25x`, `Chest 1.0x`, `Legs 0.75x`) with Kevlar/helmet damage reduction, and PODBot/ZBot-style AI (waypoint A* graph, 5-state FSM, humanized reaction delay/aim cone, footstep/gunfire sound alertness).
- **Rigid-Body & Subsystem Pipeline:** Substepped TGS Soft velocity solver, unbiased relaxation, NGS position projection, circular Coulomb + torsional patch friction, selective CCD sweeps, sleeping islands, articulated breakable ragdolls/joints (with seamless actor death handoff), Verlet ropes, buoyancy/swimming, ladder climbing, Velocity-PID Gravity Gun, 4-wheel raycast vehicles, and deterministic tick-fused HE grenades.
- **Rendering (`WorldRenderer`):** Three.js WebGL renderer translating Hammer Z-up coordinates to Three.js Y-up space, featuring BSP brush meshes, dynamic rigid-body/rope/vehicle/joint visual sync, articulated third-person T (Phoenix/Leet) & CT (SAS/GIGN) models with semiclip proximity fade, viewmodel rig overlay, tracers/particles/decals, a spring-arm third-person vehicle chase camera, and deterministic zero-leak GPU resource disposal across map reloads.
- **Gameplay & UI:** Scout / USP .45 / Knife / HE Grenade weapon system, hitscan + segmented actor hitboxes + expanded melee traces + VPhysics ballistic grenade throws, run timer with checkpoint splits and personal bests, strafe-sync telemetry HUD, and procedural Web Audio synthesizer (`SurfAudioEngine`).

---

## 2. Directory & File Structure

```text
src/
├── main.ts                          # Entry point: mounts canvas and initializes SurfApp
├── app/SurfApp.ts                   # Main loop (100 Hz fixed step + variable render), map switching, input/subsystem/match orchestration
├── core/
│   ├── constants.ts                 # FIXED_DT (0.01s), f32(), hull dims, SURF_NORMAL_Z, MoveState, bitflags
│   ├── coordinates.ts               # Hammer Z-up <-> Three.js Y-up conversion helpers (gsToThree) & angle vectors
│   └── memoryAbi.ts                 # PhysicsMemoryAbi (F32 & I32 offsets + strided MAX_ACTORS=16 pool, TeamId, HitGroup)
├── physics/
│   ├── BrushBuilder.ts              # ConvexBrush & TriggerVolume builders, Minkowski planes, surf ramp generators
│   └── GoldSrcPhysicsEngine.ts      # 100 Hz multi-actor CGameMovement, PvP hull boost, 4-zone hitboxes, TGS Soft/NGS VPhysics
├── maps/
│   ├── mapRegistry.ts               # Map registry (MapId union, metadata, build() factory lookup)
│   ├── surfSandbox01.ts             # Base surf sandbox map & MapBuildResult / WorldSign interfaces
│   ├── surfSandbox02.ts             # Additional surf/skill course map
│   ├── surfSandbox03.ts             # Additional surf/skill course map
│   └── surfSandbox04.ts             # Full subsystem proving ground (4 bays: Props/Water, Ragdolls/Joints, 4WD Buggy, Ladders/52° Surf)
├── gameplay/
│   ├── InputController.ts           # Pointer lock, WASD/jump/duck/use key state, scroll-wheel bhop, mouse yaw/pitch, weapon hotkeys (1/2/3/5)
│   ├── WeaponSystem.ts              # Slot 1 (Scout), Slot 2 (USP .45), Slot 3 (Knife), Slot 5 (HE Grenade), actor hitbox traces, recoil/reload
│   ├── BotController.ts             # PODBot/ZBot AI: MapNavGraph A* routing, 5-state FSM, humanized aim/reaction, sound alertness
│   ├── TeamMatchManager.ts          # T vs. CT team assignment, spawn distribution, CS 1.6 economy, round win evaluation
│   ├── RunTracker.ts                # Start/checkpoint/finish tick timer, segment deltas, gold splits, PB tracking
│   └── StrafeSyncTracker.ts         # Rolling air-strafe sync percentage calculator (yaw delta vs A/D input)
├── render/
│   ├── WorldRenderer.ts             # Three.js scene, Z-up -> Y-up mapping, brush/prop/rope/vehicle/actor sync, chase cam, zero-leak dispose()
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


    3. Critical Architectural Rules & Invariants (Read Before Editing)
    A. Coordinate System & Euler Angles
    Physics & Maps = Hammer Z-Up Right-Handed:
    
    +X = East (default spawn yaw 0), +Y = North (yaw = +π/2), +Z = Up.
    
    computeAngleVectors(sourcePitch, yaw, roll) follows Source convention where positive sourcePitch looks downward. When converting from InputController.viewPitch (where positive looks upward), always negate pitch: computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0).
    
    Three.js Renderer = Y-Up:
    
    All Hammer-to-Three.js axis swaps stay encapsulated inside WorldRenderer. Never mix Three.js Y-up coordinates into GoldSrcPhysicsEngine, BotController, SurfApp, or map files.
    
    B. Deterministic f32 Math & Multi-Actor Memory ABI
    All player and bot physics state lives in PhysicsMemoryAbi (this.abi.f32 and this.abi.i32) indexed by F32.*, I32.*, and strided ActorF32 / ActorI32 slots (MAX_ACTORS = 16, 16 floats + 16 ints per actor).
    
    Actor 0 is always the local player; slots 1..15 hold bots or remote players.
    
    Wrap velocity and position writes in f32(...) (Math.fround) inside GoldSrcPhysicsEngine to preserve single-precision determinism across snapshots (capturePlayerSnapshot / restorePlayerSnapshot).
    
    Keep hot-path sweeps allocation-free by reusing traceScratch, bodyTraceScratch, auxTraceScratch, and StaticBrushBvh scratch buffers.
    
    C. Multi-Actor PvP, Hitboxes & Bot Pipeline
    Tick Order (SurfApp.stepPhysicsTick): BotController.stepTick(tick) writes bot ActorInputCmds -> GoldSrcPhysicsEngine.simulateTick() steps Actor 0 + VPhysics -> GoldSrcPhysicsEngine.simulateAllBotsAndPvp() steps bots through the exact same CGameMovement pipeline and resolves PvP hulls -> TeamMatchManager.evaluateRound(tick).
    
    PvP Collisions & Boosting (mp_solid_teammates): Solid hull checks (32×32×72 standing, 32×32×36 ducking) allow vertical stacking where the upper actor receives FL_ONGROUND and inherits the lower actor's horizontal velocity via BASE_VEL_X/Y. When mp_solid_teammates is disabled, teammates pass through each other and fade opacity in WorldRenderer.syncActors().
    
    Segmented Hitboxes & Ragdoll Handoff: traceRayWithActors() tests 4 yaw-aligned OBBs per alive actor (HEAD 4.0x, STOMACH 1.25x, CHEST 1.0x, LEGS 0.75x). applyActorDamage() applies Kevlar/helmet reduction (legs ignore armor; head requires helmet) and, on lethal damage, marks ActorI32.ALIVE = 0 and spawns a velocity-inheriting createArticulatedRagdoll() struck by the lethal bullet impulse while WorldRenderer.syncActors() hides the actor mesh.
    
    Bot AI (BotController): Driven purely by ActorInputCmd (no teleporting or movement cheats). Uses MapNavGraph (ExtendedMapBuildResult.navGraph) with A* pathing, edge flags (jump, duck, ladder, surf_ramp, camp, bombsite), reaction delay (150–450 ms), angular aim-error cone, counter-strafe stopping, and sound-triggered alertness from gunfire and running footsteps.
    
    D. Subsystems & Dual-State Synchronization
    Vehicle Driving: SurfApp.drivingVehicleId and GoldSrcPhysicsEngine.drivenVehicleId must always be updated together via enterVehicle() / exitVehicle(). When drivenVehicleId is active, GoldSrcPhysicsEngine.simulateTick() skips standard player hull movement and pins POS_X/Y/Z to chassis.pos + chassisUp * 36.
    
    Player Shadow Authority: resolvePlayerShadowCollisions(playerIsSurfing) enforces one-way momentum when playerIsSurfing === true so rigid bodies never corrupt player speed on surf ramps, and ignores 'weapon' and 'grenade' bodies so thrown items never snag the thrower.
    
    Gravity Gun PID: Uses velocity-level PID (stepGravityGunPid) rather than hard position snapping so held props (and live grenades mid-flight) still collide with world brushes.
    
    HE Grenade Fuse & Blast Pipeline: WeaponSystem.throwGrenade() spawns a kind: 'grenade' VPhysics body via GoldSrcPhysicsEngine.spawnGrenade() with a wall-clamped spawn origin, velocity inheritance, CCD sweeps, and a tick-anchored GrenadeData.detonateTick (1.8 s = 180 ticks). stepGrenades() runs inside stepSecondaryPhysics(), keeps live grenades awake, removes expired bodies before detonation, and delegates blast impulses/damage/VFX/audio directly to applyExplosionImpulse().
    
    E. Renderer Lifecycle & Zero-Leak Map Switching (WorldRenderer.dispose)
    SurfApp.loadMap() calls this.renderer?.dispose?.() before constructing a new WorldRenderer against the existing <canvas>.
    
    WorldRenderer.dispose() is idempotent (this.disposed guard) and must always:
    
    Remove the window 'resize' listener (handleResize).
    
    Detach vmRoot from vmScene (this.vmScene.remove(this.vmRoot)) without disposing vmRoot's geometries/materials, because ViewmodelRig persists across map loads.
    
    Deduplicate and dispose every BufferGeometry, Material, and attached CanvasTexture map (map, emissiveMap, normalMap, etc.) across both this.scene and this.sharedMaterials (covering brush styles, prop materials, third-person actor rig materials, WorldSign textures, and makeHazardTexture()).
    
    Clear dynamic entity maps (rigidBodyMeshes, ropeLines, vehicleVisuals, actorVisuals), active FX arrays (explosionEffects, tracerEffects, particleEffects, decals), this.scene, this.renderer.renderLists, and call this.renderer.dispose().
    
    Never call this.renderer.forceContextLoss(), so the shared <canvas> element can immediately initialize a fresh THREE.WebGLRenderer for the next map.
    
    F. Hotkey & Input Conventions
    1 / 2 / 3: Weapon slots (Scout, USP .45, Knife); 4: Toggle Gravity Gun (Physics Gun); 5: Equip HE Grenade (press 5 again or LMB for overhand throw, RMB for underhand lob); Q: Quick-switch.
    
    E: Context-sensitive interact (exitVehicle -> releaseHeldBody -> enterVehicle -> tryPickupLookedWeapon -> tryGrabRigidBody).
    
    C (while driving): Toggle 3rd-person chase camera vs. cockpit camera.
    
    B / C / V (on foot): Stage checkpoint respawn / save practice checkpoint / load practice checkpoint.
    
    T / F / X: Spawn crate / detonate test blast / reset props & subsystems.
    
    R: Reload firearm or restock HE grenades on Slot 5 (or exit vehicle if driving; full reset if holding Knife or dead).
    
    4. Coding Conventions for AI Assistants
    TypeScript Strictness: Maintain explicit interfaces for subsystem and combat configs (SourceRigidBody, GrenadeData, SourceJoint, SourceRope, WaterVolume, SourceVehicle, LadderVolume, MapNavGraph, ActorInputCmd, BotProfile, TeamSpawnConfig).
    
    Complete File Outputs: When modifying core files (GoldSrcPhysicsEngine.ts, SurfApp.ts, WorldRenderer.ts, BotController.ts), preserve existing public APIs, telemetry hooks (SubsystemTelemetry, PhysicsCallbacks), and map factory signatures (ExtendedMapBuildResult).
    
    Frame-Rate Independence: Simulation and bot AI logic run strictly inside SurfApp.stepPhysicsTick() at 100 Hz (FIXED_DT = 0.01). Camera smoothing, viewmodel sway, third-person limb animation, and visual interpolation belong in SurfApp.frame() / WorldRenderer.update() using exponential smoothing 1 - Math.exp(-rate * frameDt).

<FollowUp label="Want me to output the complete patched SurfApp.ts and WeaponSystem.ts wired to BotController and TeamMatchManager?" query="Output the complete updated SurfApp.ts and WeaponSystem.ts wired to BotController, TeamMatchManager, traceRayWithActors, and WorldRenderer.syncActors."/>

add a green display name on teamates heads;

add the T vs. CT scoreboard, round timer, and kill-feed overlay to HudController and index.html?
need to wire simulateAllBotsAndPvp() into SurfApp's fixed-tick loop and bot AI?

Want me to add the 3D bot character meshes and SurfApp's player-shooting-bots wiring next?

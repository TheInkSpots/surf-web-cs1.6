Adding **Rapier** into the comparison bridges the gap between native AAA engines (Unreal, Source) and browser-based engines (Babylon.js). While Babylon.js wraps a closed C++ Havok binary in WebAssembly, Rapier is a pure-Rust engine designed from the ground up for **cross-platform bit-exact determinism** across native servers and browser WASM clients.

---

## 1. Master Architectural Comparison

| Dimension | Source Engine (`QPhysics` + `VPhysics`) | Unreal Engine 5 (`Chaos Physics`) | Babylon.js (`Physics V2` / Havok WASM) | Rapier (`rapier3d` / `dimforge`) |
| --- | --- | --- | --- | --- |
| **Core Language & License** | C++ (SDK source-available; `vphysics.dll` closed Havok). | C++ (Source-available via Epic GitHub license). | TypeScript wrapping closed C++ **Havok WASM** binary (free for web). | **100% Rust** (Apache 2.0 open-source); compiles to native or WASM. |
| **Rigid-Body Solver Math** | **PGS (Sequential Impulses)** + Baumgarte stabilization. | **PGS + XPBD** (Extended Position-Based Dynamics). | **Havok PGS / Direct Solver** + Baumgarte / split-impulse. | **TGS (Temporal Gauss-Seidel)** + **NGS (Non-linear Gauss-Seidel)** position solver. |
| **Character Controller** | **`CGameMovement`:** Analytical non-rotating AABB swept over BSP planes. | **`UCharacterMovementComponent`:** Capsule sweep + floor walking plane + network prediction. | **`PhysicsCharacterController`:** Havok `shapeCast` state machine with slope/platform handling. | **`KinematicCharacterController`:** Swept convex shape-casts + `autostep` + `snap_to_ground`. |
| **Determinism** | Player movement is strictly tick-deterministic (`66/100/128 Hz`); `VPhysics` props are non-deterministic. | Deterministic when fixed-timestep & single-threaded; includes built-in **Rollback/Resimulate**. | Deterministic per-platform/browser build at fixed `dt`, but closed binary limits server reuse. | **Bit-exact cross-platform determinism** (`enhanced-determinism` via `libm` across x86, ARM, and WASM). |
| **Collision Geometry** | Minkowski-shifted BSP planes (world) + convex hulls (props). | Signed Distance Fields (SDF), convex hulls, trimeshes, Voronoi clusters. | Convex hulls, capsules, spheres, boxes, heightfields, static trimeshes. | Parry library: GJK/EPA, SAT, BVH, convex hulls, trimeshes, heightfields, compounds. |
| **Soft Bodies & Destruction** | Pre-fractured gibs + breakable joints only. | Real-time **Voronoi fracture**, XPBD cloth, hair, and flesh. | Rigid bodies & constraints only (in Havok WASM). | Rigid bodies & multibodies only (no built-in cloth or Voronoi fracture). |
| **Multi-Threading** | Single-threaded (`VPhysics`). | Heavily multi-threaded (Task Graph + simulation islands). | Single-threaded inside WASM worker/main thread. | Multi-threaded natively (`rayon`); single-threaded SIMD in standard WASM. |

---

## 2. Core Mathematical & Solver Differences

### A. Penetration Resolution: Baumgarte vs. XPBD vs. Rapier's NGS

When two rigid bodies overlap by penetration depth $d \gt 0$, every physics engine must push them apart without injecting fake kinetic energy ("exploding stacks"):

* **Source & Classic Havok (Baumgarte Stabilization):**
Adds a velocity bias proportional to penetration depth directly into the velocity constraint:

$$v_{\text{bias}} = \frac{\beta}{\Delta t}\max(d - d_{\text{slop}},\, 0)$$



*Trade-off:* Fast and simple, but because it modifies *velocity* rather than *position*, deep overlaps convert into outward rebound velocity—causing stacked crates to jitter or pop apart.
* **Unreal Engine 5 (XPBD — Extended Position-Based Dynamics):**
Solves constraints directly at the **position level** using inverse stiffness (compliance $\alpha = \frac{1}{k\,\Delta t^2}$):

$$\Delta \lambda = \frac{-C(\mathbf{x}) - \alpha \lambda}{\nabla C\,\mathbf{M}^{-1}\nabla C^T + \alpha}, \quad \Delta \mathbf{x} = \mathbf{M}^{-1}\nabla C^T \Delta \lambda$$



Velocities are derived afterward from $\mathbf{v} = \frac{\mathbf{x}_{t+\Delta t} - \mathbf{x}_t}{\Delta t}$, eliminating artificial energy injection and making cloth/joint stiffness independent of substep counts.
* **Rapier (TGS + Non-Linear Gauss-Seidel / NGS):**
Rapier separates velocity solving from position correction. It solves contact impulses using **Temporal Gauss-Seidel (TGS)** (substepping velocity updates within a single tick) and resolves remaining overlap using **NGS**—a pseudo-velocity position projection step that translates/rotates bodies out of penetration *without* altering their true linear/angular velocities. This gives Rapier remarkably stable tall stacks without Baumgarte bounce.

### B. Character Controller Math: Source vs. Rapier vs. Babylon vs. Unreal

1. **Source (`CGameMovement`):**
* Does **not** use a rigid-body collider at all.
* Expands BSP planes by the player's AABB half-extents and performs analytical ray-plane intersections (`t = (s1 - 0.03125) / (s1 - s2)`).
* Explicitly separates `Accelerate` and `AirAccelerate` (capping wishspeed at `30 u/s` in the dot-product check) and clips velocity on steep ramps ($n_z \lt 0.7$) without applying ground friction—enabling air-strafing, bhop, and surf.


2. **Rapier (`KinematicCharacterController`):**
* Structurally the closest modern equivalent to Source's `TryPlayerMove` + `StepMove`.
* Performs iterative **convex shape-casts** (capsule, cylinder, or cuboid) along the displacement vector, projects remaining displacement onto hit normals (`Slide`), checks slope angles (`max_slope_climb_angle` / `min_slope_slide_angle`), and executes an explicit 3-step `autostep` (up $\rightarrow$ forward $\rightarrow$ down) over stairs.
* *Difference from Source:* Rapier computes *kinematic displacement* rather than enforcing Quake-style air-strafe velocity caps—so if you want Source surf/bhop physics, you still compute $\mathbf{v}$ using `AirAccelerate` / `ClipVelocity` and pass $\Delta \mathbf{x} = \mathbf{v}\,\Delta t$ into Rapier's `move_shape()`.


3. **Babylon.js (`PhysicsCharacterController`):**
* Uses Havok's `shapeCast` under the hood with a state machine (`ON_GROUND`, `IN_AIR`, `START_JUMP`) and automatically inherits velocity from moving/rotating dynamic platforms.
* Like Rapier, it handles collision sliding and slopes out of the box, while leaving acceleration/air-control curves to your gameplay layer.


4. **Unreal Engine (`UCharacterMovementComponent`):**
* Uses capsule sweeps (`MoveUpdatedComponent`), per-frame floor penetration checks (`FindFloor`), and baked-in **client-side prediction + server timestamp reconciliation** (`FSavedMove_Character`), making networked FPS/TPS movement work out of the box at the cost of heavy engine coupling.



### C. Determinism & Multiplayer Netcode

* **Rapier** is uniquely suited for **authoritative multiplayer web games** because the exact same Rust crate runs natively on a server (Linux/Windows) and inside the browser via WASM. With `enhanced-determinism` enabled, Rapier swaps platform-specific floating-point math (`sin`, `cos`, `atan2`) for deterministic `libm` implementations—guaranteeing identical simulation hashes across Windows, macOS, Linux, and Chrome/Firefox/Safari.
* **Babylon.js (Havok WASM)** gives top-tier rigid-body throughput in the browser, but because Havok WASM is a closed binary, running an authoritative server in Node.js/Bun requires spinning up a headless Havok WASM instance rather than native multi-threaded C++/Rust.
* **Source** achieves deterministic multiplayer movement by keeping `CGameMovement` lightweight enough to re-simulate missed ticks on the server (`LagCompensation` + command history) while letting `VPhysics` props run loosely synced.
* **Unreal Engine** solves multiplayer physics via **Physics Prediction / Rewind-Resimulate**, buffering state history on both client and server and re-simulating Chaos substeps when mispredictions occur.

---

## 3. Summary: When to Choose Which

* **Choose Source-Style Custom Math (`CGameMovement` + custom BVH/BSP)** when tactile, frame-accurate movement mechanics (air-strafing, surf ramps, rocket jumping, 100Hz+ deterministic ticks) are the core gameplay loop—especially when paired with a lightweight custom Rust/C++ WASM core.
* **Choose Rapier** when building a **web or cross-platform multiplayer game** in TypeScript/Rust that needs fast rigid-body physics, convex shape-casting, and **bit-exact determinism** between a native server and a browser WASM client (or when pairing Rapier's collision world with custom movement math).
* **Choose Babylon.js + Havok WASM** when building a rich **browser-native 3D simulation or single-player/casual web game** inside the Babylon ecosystem where you want AAA-grade rigid-body stability, vehicle physics, and joints with zero native toolchain setup.
* **Choose Unreal Engine 5 (Chaos)** when targeting **native PC/Console AAA fidelity** requiring real-time structural destruction, cloth/soft-body simulation, massive object counts, and built-in networked physics rollback.
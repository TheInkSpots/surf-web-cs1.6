The optimal hybrid architecture keeps Source’s exact `CGameMovement` velocity math to preserve air-strafing, bhop, and surf mechanics, replaces legacy BSP-only traversal and Havok stabilization with Rapier’s SIMD QBVH and TGS Soft/NGS solver, and completes the remaining gameplay modules using velocity-level controllers and reduced-coordinate joints.

## 1. Optimizing Player Movement & Collision

Do not replace `AirAccelerate` or `ClipVelocity` with Rapier’s `KinematicCharacterController` displacement logic—doing so breaks the orthogonal velocity gain from the $30\text{ u/s}$ dot-product cap. Instead, optimize the collision queries and numerical edge cases around `TryPlayerMove`:

* **Hybrid Broad-Phase (Minkowski Planes + SIMD QBVH):** Retain analytical Minkowski-shifted plane traces ($d_{\text{shifted}} = d - \sum \vert{}n_i e_i\vert{}$) for convex BSP brushes, because they are exact and immune to iterative tolerances. For arbitrary triangle meshes, replace flat face lists with Rapier’s **4-way SIMD QBVH** (`f32x4` testing four child AABBs per instruction) and run an exact **swept AABB-vs-triangle SAT** query at the leaves instead of iterative GJK/EPA, avoiding grazing-angle normal wobble on surf ramps.
* **Internal Edge Filtering (Fixing the Ramp Glitch):** Classic Source loses speed or dead-stops when a player slides across coplanar brush or mesh seams, because the swept box catches a hidden bevel or triangle edge normal opposing $\mathbf{v}$. Pre-process static geometry to tag concave/coplanar shared edges (ghost edges) and clamp any hit normal onto the triangle’s Voronoi face normal. As a runtime fallback, if `ClipVelocity` drops tangential speed abruptly on a steep surf plane ($n_z \lt 0.7$), nudge backward by $\epsilon$ and re-trace once.
* **`StepMove` Query Deduplication:** Classic `StepMove` executes up to four separate world sweeps (Slide, Up, Forward, Down) on every wall contact. Optimize by computing one union AABB covering both Path A and Path B, querying the QBVH once to collect candidate brushes/triangles into a small stack buffer, and running all four narrow-phase sweeps against that cached set. Early-out of Path B whenever the initial wall hit is an overhang ($n_z \lt -0.1$) or horizontal velocity is near zero.
* **Sub-Tick Yaw Integration & Duplicate-Normal Clamping:** Evaluate $\mathbf{f}_{xy}$ and $\mathbf{r}_{xy}$ using midpoint yaw $\psi_{\text{eff}} = \frac{1}{2}(\psi_{t-1} + \psi_t)$ to smooth air-strafe curves at fixed tickrates without altering speed caps. In `TryPlayerMove`, discard duplicate plane normals where $\mathbf{n}_i \cdot \mathbf{n}_j \gt 0.999$ so dense meshes do not falsely trigger the 3-plane dead-stop branch.
* **Unit-Scaled Power-of-Two Margin:** Source’s `DIST_EPSILON` ($1/32\text{ u} = 2^{-5}$) assumes Hammer units. If your world uses meters, keep the skin margin a strict binary power of two (such as $2^{-10}\text{ m} \approx 0.976\text{ mm}$) to avoid repeating binary fractions in IEEE-754 arithmetic.

---

## 2. Upgrading Rigid-Body Math with Rapier’s Solver

Source’s legacy `VPhysics`/Havok layer suffers from stack jitter and explicit-damping instability. Replacing its solver internals with Rapier’s math fixes these directly:

* **Swap Baumgarte Bias for TGS Soft + NGS:** Source’s Baumgarte term $v_{\text{bias}} = \frac{\beta}{\Delta t}\max(d - d_{\text{slop}}, 0)$ converts deep overlap into outward bounce velocity. Use Rapier’s substepped **TGS Soft** constraints (parameterized by natural frequency $\omega$ and damping ratio $\zeta$) with an unbiased velocity relaxation pass, followed by **NGS** position projection so residual overlaps resolve purely on transforms $(\mathbf{t}, \mathbf{q})$ without adding kinetic energy.
* **Implicit Linear & Angular Damping:** Replace Source’s explicit damping $\mathbf{v}_t(1 - c_{\text{lin}}\Delta t)$—which inverts velocity and explodes whenever $c\Delta t \gt 1$—with Rapier’s unconditionally stable form $\mathbf{v}_{t+\Delta t} = \frac{\mathbf{v}_t + \mathbf{a}\Delta t}{1 + c_{\text{lin}}\Delta t}$.
* **Warm-Starting & Island Sleeping:** Track contact manifolds across ticks and warm-start TGS with the previous frame’s cached normal and tangential impulses $(\lambda_n, \boldsymbol{\lambda}_t)$. Partition active contact graphs into connected islands via BFS/DFS so stationary props sleep at zero solver cost, cutting required TGS iterations down to 4–8 per tick.
* **Torsional Patch Friction & Selective CCD:** Enable Rapier’s torsional twist clamp ($\vert{}\lambda_{\text{twist}}\vert{} \le \mu\,r_{\text{patch}}\,\lambda_n$) to stop flat props from spinning indefinitely, and restrict **Non-Linear Conservative Advancement CCD** to fast or thin bodies whose frame displacement $\Vert{}\mathbf{v}\Vert{}\Delta t + r_{\max}\Vert{}\boldsymbol{\omega}\Vert{}\Delta t$ exceeds half their minimum extent.

---

## 3. Completing Missing Source Gameplay Subsystems

Rather than re-implementing all six secondary Source modules from scratch, map each one to its cleanest Rapier-aligned mathematical equivalent:

| Source Subsystem | Legacy Source Approach | Optimized Hybrid / Rapier Implementation | Key Gain |
| --- | --- | --- | --- |
| **Player Shadow** (`IPhysicsPlayerController`) | Kinematic Havok hull + capped linear push force | Velocity-driven shadow body coupled via clamped **Velocity-Level PID**; one-way authority on surf ramps | Props react realistically without corrupting player air-strafe or surf velocity |
| **Gravity Gun** (`CWeaponPhysCannon`) | Raw force-level PD spring $\mathbf{F}_{\text{hold}}$ | Rapier **`PidController`** driving $\mathbf{v}_{\text{cmd}}$ and quaternion log-error $\mathbf{e}_q = \log(\mathbf{q}_{\text{target}} \otimes \mathbf{q}^{-1})$ | Mass-independent stability with zero spring overshoot |
| **Ragdolls & Joints** (`phys_constraintsystem`) | Maximal-coordinate PGS + Baumgarte | **Featherstone ABA** (`MultibodyJointSet`) for skeletons; impulse constraints with $\Vert{}\lambda\Vert{} \gt \lambda_{\max}$ break checks | Zero limb separation during explosions in $O(n)$ time |
| **Ropes & Cables** (`CRopeKeyframe`) | Separate Verlet particle chain | Keep lightweight **Verlet / XPBD** distance relaxation outside the main solver; pin endpoints to rigid bodies | Low CPU cost without polluting TGS contact islands |
| **Vehicles** (`CFourWheelVehiclePhysics`) | Custom raycast suspension + slip tables | Rapier **`DynamicRayCastVehicleController`** with Hookean spring-damper rays and surface-keyed slip curves | Native QBVH raycasts and stable chassis-to-world contact |
| **Buoyancy** (`CPhysicsFluidController`) | AABB submersion fraction $f_{\text{sub}}$ + upward impulse | Keep AABB/multi-sample $f_{\text{sub}}$, but apply upward force at the submerged centroid rather than body center of mass | Generates self-righting torque so floating props do not tumble endlessly |

---

## 4. Determinism, Networking & Runtime Efficiency

* **Unified `libm` Determinism Across Both Layers:** Rapier’s `enhanced-determinism` only protects rigid bodies. Extend the same rule to `CGameMovement` by routing every `sin`, `cos`, `sqrt`, and `atan2` call in `AngleVectors`, `Friction`, and `ClipVelocity` through pure-software **`libm`**, enforcing deterministic generational-arena iteration order, and disabling FMA contraction so native servers and browser WASM clients produce bit-identical state hashes.
* **Decoupled Rollback State:** Keep the player movement state struct compact (position, velocity, view angles, ground entity ID, duck/jump timers—roughly 64–96 bytes). Client-side prediction and server lag compensation can then re-simulate dozens of `CGameMovement` ticks in microseconds without snapshotting or rolling back the full Rapier rigid-body world.
* **Zero-Allocation Tick Pipeline:** Store entity transforms, QBVH nodes, and contact manifolds in contiguous Structure-of-Arrays (SoA) buffers, and pre-allocate fixed scratch arrays for `TryPlayerMove` clip planes (`MAX_CLIP_PLANES = 5`) and broad-phase hits. Eliminating per-tick heap allocations prevents frame-time spikes at 100 Hz–128 Hz tickrates.

Combining Source’s analytical movement core with Rapier’s SIMD broad-phase, soft-constraint solver, and `libm` determinism yields an engine that feels indistinguishable from classic Source movement while eliminating ramp glitches, prop jitter, and cross-platform desyncs.

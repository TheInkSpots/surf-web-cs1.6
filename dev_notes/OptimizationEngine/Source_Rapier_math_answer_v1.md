To build a complete, high-performance custom Source physics engine, preserve Source's analytical `CGameMovement` velocity equations for tactile movement feel while replacing its legacy BSP and Havok bottlenecks with Rapier's SIMD spatial queries, `TGS + NGS` contact resolution, and bit-exact `libm` determinism.

---

## 1. Optimizing Player Movement (`CGameMovement`)

### Surf Ramp Seam Deduplication & Voronoi Normal Clamping

In classic Source, `TryPlayerMove` performs iterative ray-plane sweeps with `DIST_EPSILON = 0.03125` ($1/32\text{ u}$) and projects velocity via `ClipVelocity`. When a player slides across internal seams between two coplanar triangles or adjacent ramp brushes, floating-point rounding can catch an internal edge normal—abruptly projecting tangential speed downward into a "ramp glitch."

* **Coplanar Face Merging:** At map load, merge adjacent triangles or brush faces whose normals satisfy $\mathbf{n}_A \cdot \mathbf{n}_B \gt 1 - 10^{-5}$ into larger logical collision planes.
* **Voronoi Edge-Normal Clamping:** Borrowing Rapier/`parry` manifold contact filtering, clamp any hit normal on a shared edge between faces $A$ and $B$ so it lies strictly within the spherical arc between $\mathbf{n}_A$ and $\mathbf{n}_B$.
* **Seam-Recovery Pass:** If a single `ClipVelocity` step reduces horizontal speed by more than $25\%$ over a displacement smaller than $2\epsilon$ ($0.0625\text{ u}$), discard the edge hit and re-project against the previous tick's dominant ramp normal.

### Tickrate-Invariant Exponential Ground Friction

Source's first-order Euler friction ($v_{\text{drop}} = \text{control} \cdot k_{\text{friction}} \cdot \mu_{\text{surface}} \cdot \Delta t$) produces slightly different stopping distances across $66\text{ Hz}$, $100\text{ Hz}$, and $128\text{ Hz}$ tickrates whenever $v_{\text{horiz}} \gt v_{\text{stop}}$.

* **Hybrid Decay Optimization:** Use exact analytical exponential decay above $v_{\text{stop}}$ so friction is strictly tickrate-independent, while keeping linear decay below $v_{\text{stop}}$ so players still snap cleanly to zero velocity:

$$\mathbf{v}' = \begin{cases} \mathbf{v} \cdot e^{-k_{\text{friction}}\,\mu_{\text{surface}}\,\Delta t} & \text{if } v_{\text{horiz}} \gt v_{\text{stop}} \\ \mathbf{v} \cdot \dfrac{\max(v_{\text{horiz}} - v_{\text{stop}}\,k_{\text{friction}}\,\mu_{\text{surface}}\,\Delta t,\; 0)}{v_{\text{horiz}}} & \text{if } v_{\text{horiz}} \le v_{\text{stop}} \end{cases}$$

### Sub-Tick Yaw Integration for High-Speed Air Strafing

Because `AirAccelerate` caps only the dot product $\mathbf{v} \cdot \hat{\mathbf{w}} \le 30\text{ u/s}$, fast mouse turns during a single $100\text{ Hz}$ tick quantize $\hat{\mathbf{w}}$ and waste potential orthogonal acceleration.

* **Micro-Substepping:** Inspired by Rapier's TGS substepping, subdivide `AirAccelerate` into $N_{\text{sub}} = 2\text{ to }4$ sub-steps ($\Delta t_{\text{sub}} = \Delta t / N_{\text{sub}}$) while linearly interpolating yaw $\psi$ from $\psi_{t-\Delta t}$ to $\psi_t$. Each sub-step computes a fresh $\hat{\mathbf{w}}(\psi_k)$, yielding smoother air-strafe acceleration curves without raising the $30\text{ u/s}$ speed cap.

---

## 2. Optimizing Collision Detection & Rigid-Body Dynamics

### Hybrid Minkowski BSP + SIMD `Qbvh` (`parry` Architecture)

Source's Minkowski plane shifting ($d_{\text{shifted}} = d - (\vert n_x e_x\vert + \vert n_y e_y\vert + \vert n_z e_z\vert)$) reduces AABB sweeps against convex `.bsp` brushes to fast point-ray intersections, but arbitrary `.glb` triangle meshes lack closed convex brush planes.

* **Dual-Path Broad/Narrow Phase:**
1. **Convex `.bsp` Brushes:** Keep Minkowski-shifted plane intersection ($t = \max(0, \frac{s_1 - \epsilon}{s_1 - s_2})$) inside a flat array-backed BSP tree for $O(\log B)$ traversal with zero dynamic allocation.
2. **Triangle `.glb` Meshes:** Index triangles into a 4-way SIMD Quaternary BVH (`parry`'s `Qbvh`), testing 4 child AABBs per SIMD instruction and executing swept-AABB vs. triangle slab/SAT tests with skin margin $\epsilon = 0.03125\text{ u}$.



### Continuous Swept Trigger Queries (Zero Tunneling)

At surf speeds above $3500\text{ u/s}$, a player travels over $35\text{ u}$ per $100\text{ Hz}$ tick and can tunnel straight through thin `trigger_teleport` or `trigger_push` volumes if tested only at discrete endpoints.

* **Conservative Advancement Trigger Layer:** Store trigger volumes in a separate bitmask-filtered `Qbvh` layer. Along every movement segment $[\mathbf{p}_1, \mathbf{p}_2]$, run a continuous swept-AABB overlap query to compute exact entry/exit fractions $[t_{\text{enter}}, t_{\text{exit}}] \subseteq [0, 1]$ so teleports fire at the exact impact fraction rather than one tick late.

### Replacing Baumgarte Bias with TGS Soft + NGS

If your engine simulates dynamic props or ragdolls (`VPhysics`), classic Havok Baumgarte stabilization ($v_{\text{bias}} = \frac{\beta}{\Delta t}\max(d - d_{\text{slop}}, 0)$) converts deep penetrations into outward rebound velocity, making stacked crates jitter.

* **Decoupled Solver:** Adopt Rapier's **Temporal Gauss-Seidel (TGS) Soft** velocity solver (using harmonic oscillator parameters $\omega = 2\pi f, \zeta$) paired with **Non-Linear Gauss-Seidel (NGS)** position projection. NGS translates and rotates overlapping bodies directly out of penetration without injecting artificial kinetic energy into $\mathbf{v}$ or $\boldsymbol{\omega}$.

### Bit-Exact Cross-Platform Determinism (`libm` + Arena Handles)

Hardware `sin`, `cos`, `atan2`, and `sqrt` instructions vary slightly across x86 SSE, Apple Silicon NEON, and browser WebAssembly runtimes—causing client-side prediction desyncs over long surf runs.

* **Software `libm` & Generational Arenas:** Following Rapier's `enhanced-determinism`, route all trigonometric and square-root calls in `AngleVectors`, `AirAccelerate`, and `CheckJumpButton` through pure deterministic `libm` implementations, and store colliders/entities in deterministic generational arenas (`SlotMap`) rather than iteration-order-dependent hash maps.
* **Zero-Allocation Hot Loop:** Keep all trace results, contact planes, and 16-byte aligned `Vec3A` SIMD math on the stack so a $100\text{ Hz}$ tick executes in under $20\,\mu\text{s}$ in Wasm—leaving ample budget to re-simulate $15\text{–}20$ rollback ticks during multiplayer reconciliation.

---

## 3. Subsystems Needed to Complete the Engine

To graduate from a core movement and collision prototype to a complete Source-compatible physics engine, five gameplay subsystems are required:

1. **Dynamic Hull Ducking (`CheckDuck` & `FixPlayerCrouchStuck`):**
* Support switching between standing AABB ($32 \times 32 \times 72\text{ u}$) and ducked AABB ($32 \times 32 \times 54\text{ u}$).
* When ducking mid-air, shift the player's center upward by $+9\text{ u}$ (raising the feet by $18\text{ u}$ for crouch-jumps). Before uncrouching, run an upward swept-hull trace of $+18\text{ u}$ to verify ceiling clearance.


2. **Surface Properties & Trigger Brushes (`surfaceproperties.txt`):**
* Bind material tags to brush faces/triangles to override $\mu_{\text{surface}}$ (e.g., `slick` surfaces with $\mu = 0.1$ for ice-surf ramps) and step sounds.
* Implement `trigger_teleport` (with landmark offset and velocity-retention vs. velocity-reset flags), `trigger_push` (additive impulse $\Delta \mathbf{v} = \mathbf{a}_{\text{push}}\,\Delta t$), and `func_ladder` (projecting wish velocity onto the ladder plane normal).


3. **Water Volume Physics (`WaterMove` & `CPhysicsFluidController`):**
* Compute submersion fraction $f_{\text{sub}} \in [0, 1]$ against water plane heights (`waterlevel` 0 to 3).
* When `waterlevel` is at least 2, bypass the horizontal $z = 0$ wish-direction projection so players swim along their 3D view vector $\mathbf{f}$, apply quadratic fluid drag, and apply Archimedes buoyancy $\mathbf{F}_{\text{buoy}} = m g \rho_{\text{ratio}} f_{\text{sub}}\,\hat{\mathbf{z}}$ to dynamic props.


4. **Two-Way Player-Prop Coupling & Carry (`IPhysicsPlayerController` + `PidController`):**
* Replace Source's 1-tick-delayed kinematic shadow body with direct swept-TOI impulse transfer: when a player trace hits a dynamic rigid body, compute a momentum-capped impulse (clamped by `player_throwforce`) and apply it directly to the rigid body's contact point.
* Implement Gravity Gun / object carrying using Rapier's velocity-level critically damped PD controller ($\mathbf{v}_{\text{cmd}} = K_p\,\mathbf{e}_p + K_d\,\dot{\mathbf{e}}_p$) so held props track the camera smoothly without exploding on wall collisions.


5. **Multiplayer Prediction, Rollback & Lag Compensation:**
* Maintain a fixed-size ring buffer (e.g., 128 ticks) of `UserCmd` inputs and compact deterministic state snapshots (`position`, `velocity`, `view_angles`, `flags`, `ground_normal`).
* On receiving an authoritative server snapshot, compare states; if error exceeds $0.01\text{ u}$, rewind to that tick and replay buffered `UserCmd` frames forward. On the server, retain a 1-second history buffer of entity AABBs/hitboxes to rewind hitscan traces by client RTT.



---

## 4. Hybrid Architecture Summary

| Engine Layer | Recommended Math & Data Structure | Origin |
| --- | --- | --- |
| **Player Movement** | `AirAccelerate` ($30\text{ u/s}$ dot cap) + exponential friction + sub-tick yaw | Source (`CGameMovement`) |
| **Ramp Sliding** | `ClipVelocity` ($n_z \lt 0.7$) + Voronoi edge-normal clamping | Source + Rapier `parry` |
| **Static Map Geometry** | Minkowski plane-shifted `.bsp` + 4-way SIMD `Qbvh` for `.glb` meshes | Source + Rapier `parry` |
| **Trigger Volumes** | Bitmask-filtered `Qbvh` + continuous swept-AABB TOI `[t_enter, t_exit]` | Rapier CCD |
| **Dynamic Rigid Bodies** | `TGS Soft` velocity solver + `NGS` position projection | Rapier |
| **Determinism & Memory** | Pure `libm` trig/sqrt + generational arena handles + stack `Vec3A` | Rapier `enhanced-determinism` |

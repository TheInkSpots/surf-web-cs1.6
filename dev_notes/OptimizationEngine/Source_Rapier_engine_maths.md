To optimize and complete the custom source physics engine GoldSrcPhysicsEngine.ts; what can be opitimized ? reference the source engine maths and Rapier physics engine:

Source Engine physics is split into two distinct mathematical systems: **deterministic player movement** (`CGameMovement`, inherited from QuakeWorld and GoldSrc) and **rigid-body dynamics** (`VPhysics`, powered by a modified Havok solver).

---

## 1. Coordinate System & Wish Direction

Source uses a right-handed, Z-up coordinate system ($+X$ forward, $+Y$ left, $+Z$ up) measured in Hammer units ($1\text{ unit} \approx 1.905\text{ cm}$ or $0.75\text{ inches}$).

### View Basis Vectors (`AngleVectors`)

Given Euler view angles—pitch $\theta$ (positive looks downward), yaw $\psi$, and roll $\phi$:

$$\mathbf{f} = \begin{bmatrix} \cos\theta\cos\psi \\ \cos\theta\sin\psi \\ -\sin\theta \end{bmatrix}, \quad \mathbf{r} = \begin{bmatrix} -\sin\phi\sin\theta\cos\psi + \cos\phi\sin\psi \\ -\sin\phi\sin\theta\sin\psi - \cos\phi\cos\psi \\ -\sin\phi\cos\theta \end{bmatrix}$$

### Wish Velocity & Wish Direction

Player movement inputs ($f_{\text{move}}$ forward/back, $s_{\text{move}}$ left/right) are projected onto the horizontal plane ($z = 0$) and normalized:

$$\mathbf{f}_{xy} = \frac{(f_x, f_y, 0)}{\sqrt{f_x^2 + f_y^2}}, \quad \mathbf{r}_{xy} = \frac{(r_x, r_y, 0)}{\sqrt{r_x^2 + r_y^2}}$$

$$\mathbf{w} = f_{\text{move}}\,\mathbf{f}_{xy} + s_{\text{move}}\,\mathbf{r}_{xy}$$

$$v_{\text{wish}} = \min\left(\Vert{}\mathbf{w}\Vert{},\; v_{\text{max}}\right), \quad \hat{\mathbf{w}} = \frac{\mathbf{w}}{\Vert{}\mathbf{w}\Vert{}}$$

---

## 2. Player Movement Physics (`CGameMovement`)

Player physics updates once per server tick ($\Delta t = \frac{1}{\text{tickrate}}$, typically $\frac{1}{66}\text{ s}$ or $\frac{1}{128}\text{ s}$).

### Ground Friction (`Friction`)

Applied prior to ground acceleration when the player is on a walkable surface:

$$v_{\text{horiz}} = \sqrt{v_x^2 + v_y^2}$$

$$\text{control} = \max(v_{\text{horiz}},\; v_{\text{stop}})$$

$$v_{\text{drop}} = \text{control} \cdot k_{\text{friction}} \cdot \mu_{\text{surface}} \cdot \Delta t$$

$$\mathbf{v}' = \mathbf{v} \cdot \frac{\max(v_{\text{horiz}} - v_{\text{drop}},\; 0)}{v_{\text{horiz}}}$$

* $v_{\text{stop}}$: `sv_stopspeed` (minimum velocity threshold for linear vs. exponential decay).
* $k_{\text{friction}}$: `sv_friction`.
* $\mu_{\text{surface}}$: Surface friction multiplier (typically $1.0$; lower on ice/slick surfaces).

### Ground Acceleration (`Accelerate`)

Acceleration is capped by projecting current velocity $\mathbf{v}$ onto the desired unit direction $\hat{\mathbf{w}}$:

$$v_{\text{proj}} = \mathbf{v} \cdot \hat{\mathbf{w}}$$

$$v_{\text{add}} = v_{\text{wish}} - v_{\text{proj}}$$

If $v_{\text{add}} \le 0$, no acceleration is applied. Otherwise:

$$v_{\text{accel}} = \min\left(a \cdot \Delta t \cdot v_{\text{wish}} \cdot \mu_{\text{surface}},\; v_{\text{add}}\right)$$

$$\mathbf{v}' = \mathbf{v} + v_{\text{accel}}\,\hat{\mathbf{w}}$$

### Air Acceleration & Air Strafing (`AirAccelerate`)

In mid-air, `addspeed` caps $v_{\text{wish}}$ at $30\text{ u/s}$, while `accelspeed` still multiplies by the uncapped $v_{\text{wish}}$:

$$v_{\text{cap}} = \min(v_{\text{wish}},\; 30)$$

$$v_{\text{add}} = v_{\text{cap}} - (\mathbf{v} \cdot \hat{\mathbf{w}})$$

$$v_{\text{accel}} = \min\left(a_{\text{air}} \cdot \Delta t \cdot v_{\text{wish}} \cdot \mu_{\text{surface}},\; v_{\text{add}}\right)$$

$$\mathbf{v}' = \mathbf{v} + v_{\text{accel}}\,\hat{\mathbf{w}}$$

**Why Air Strafing Gains Speed:** Because the speed limit applies only to the dot product $\mathbf{v} \cdot \hat{\mathbf{w}}$, turning the view so $\hat{\mathbf{w}}$ is nearly perpendicular to $\mathbf{v}$ keeps $\mathbf{v} \cdot \hat{\mathbf{w}} \approx 0$. This yields $v_{\text{add}} \approx 30$, allowing $v_{\text{accel}}\,\hat{\mathbf{w}}$ to add orthogonally and increase total speed magnitude:

$$\Vert{}\mathbf{v}'\Vert{} = \sqrt{\Vert{}\mathbf{v}\Vert{}^2 + 2v_{\text{accel}}(\mathbf{v} \cdot \hat{\mathbf{w}}) + v_{\text{accel}}^2} \gt \Vert{}\mathbf{v}\Vert{}$$

### Gravity Integration (`StartGravity` & `FinishGravity`)

Source uses a half-step velocity-Verlet split around the position integration step to eliminate tickrate-dependent jump height drift:

1. **Before `TryPlayerMove`:** $v_z \leftarrow v_z - \frac{1}{2}\,g_{\text{ent}}\,g\,\Delta t$
2. **Integrate Position:** $\mathbf{x} \leftarrow \mathbf{x} + \mathbf{v}\,\Delta t$
3. **After `TryPlayerMove`:** $v_z \leftarrow v_z - \frac{1}{2}\,g_{\text{ent}}\,g\,\Delta t$

### Jump Impulse (`CheckJumpButton`)

Jumping sets vertical velocity directly (or adds to it in specific configurations) using conservation of energy:

$$v_z = \sqrt{2 \cdot g \cdot h_{\text{jump}}}$$

* **CS:S / GoldSrc ($h_{\text{jump}} = 45\text{ u}$, $g = 800\text{ u/s}^2$):** $v_z = \sqrt{2 \cdot 800 \cdot 45} \approx 268.33\text{ u/s}$
* **Half-Life 2 ($h_{\text{jump}} = 21\text{ u}$, $g = 800\text{ u/s}^2$):** $v_z = \sqrt{2 \cdot 800 \cdot 21} \approx 183.30\text{ u/s}$

### Velocity Clipping & Surf Ramps (`ClipVelocity`)

When a swept trace hits a plane with unit normal $\mathbf{n}$, velocity is projected onto the plane:

$$\mathbf{v}' = \mathbf{v} - (\mathbf{v} \cdot \mathbf{n}) \cdot \beta \cdot \mathbf{n}$$

* $\beta$ (`overbounce`): $1.0$ for sliding along walls/ramps; $1.0 + \text{bounce}$ for elastic entities.
* **Walkable vs. Surf Condition:** A surface is considered ground if $n_z \ge 0.7$ (slope angle $\le \arccos(0.7) \approx 45.57^\circ$). On steeper ramps ($n_z \lt 0.7$), the player remains in the airborne state—bypassing ground friction—while `TryPlayerMove` iteratively calls `ClipVelocity` against the ramp normal every tick, converting downward gravity into tangential ramp speed.

### Stair Step-Up (`StepMove`)

When horizontal movement hits a vertical obstacle ($n_z \approx 0$), Source evaluates two candidate trajectories over $\Delta t$:

1. **Path A (Slide):** Standard `TryPlayerMove` sliding along the wall.
2. **Path B (Step):** Trace up by `sv_stepsize` ($18\text{ u}$) $\rightarrow$ trace forward with $\mathbf{v}$ $\rightarrow$ trace down by `sv_stepsize`.

If Path B lands on walkable ground ($n_z \ge 0.7$) and covers greater horizontal squared distance $(x_B - x_0)^2 + (y_B - y_0)^2 \gt (x_A - x_0)^2 + (y_A - y_0)^2$, Path B is committed.

---

## 3. BSP Collision & Swept AABB Math

Player hitboxes are axis-aligned bounding boxes (AABBs) that never rotate with view yaw. Rather than testing an AABB against static BSP brush planes, Source expands each brush plane outward by the AABB's half-extents $\mathbf{e} = (e_x, e_y, e_z)$ (Minkowski sum) and traces a single point ray:

$$d_{\text{shifted}} = d - \left(\vert{}n_x e_x\vert{} + \vert{}n_y e_y\vert{} + \vert{}n_z e_z\vert{}\right)$$

For a movement segment from $\mathbf{p}_1$ to $\mathbf{p}_2$, signed distances to the shifted plane are $s_1 = \mathbf{n} \cdot \mathbf{p}_1 - d_{\text{shifted}}$ and $s_2 = \mathbf{n} \cdot \mathbf{p}_2 - d_{\text{shifted}}$. If $s_1 \gt 0$ and $s_2 \lt 0$, the exact time-of-impact fraction $t \in [0, 1]$ is:

$$t = \max\left(0,\; \frac{s_1 - \epsilon}{s_1 - s_2}\right)$$

where $\epsilon = \frac{1}{32}\text{ u} = 0.03125\text{ u}$ (`DIST_EPSILON`) prevents floating-point self-intersection on subsequent ticks.

---

## 4. Rigid-Body Dynamics (`VPhysics` / Havok)

Props and ragdolls are simulated as rigid bodies with mass $m$, center of mass $\mathbf{x}$, orientation quaternion $\mathbf{q}$, linear velocity $\mathbf{v}$, angular velocity $\boldsymbol{\omega}$, and world-space inertia tensor $\mathbf{I} = \mathbf{R}\,\mathbf{I}_{\text{local}}\,\mathbf{R}^T$.

### Semi-Implicit Euler Integration

At each physics step $\Delta t$:

$$\mathbf{v}_{t+\Delta t} = \mathbf{v}_t(1 - c_{\text{lin}}\Delta t) + \left(\frac{\mathbf{F}_{\text{ext}}}{m} + \mathbf{g}\right)\Delta t$$

$$\mathbf{x}_{t+\Delta t} = \mathbf{x}_t + \mathbf{v}_{t+\Delta t}\Delta t$$

$$\boldsymbol{\omega}_{t+\Delta t} = \boldsymbol{\omega}_t(1 - c_{\text{ang}}\Delta t) + \mathbf{I}^{-1}\left(\boldsymbol{\tau}_{\text{ext}} - \boldsymbol{\omega}_t \times (\mathbf{I}\boldsymbol{\omega}_t)\right)\Delta t$$

$$\mathbf{q}_{t+\Delta t} = \text{normalize}\left(\mathbf{q}_t + \frac{1}{2}\begin{bmatrix}0 \\ \boldsymbol{\omega}_{t+\Delta t}\end{bmatrix} \otimes \mathbf{q}_t\,\Delta t\right)$$

### Rigid-Body Collision Impulse

At contact point $\mathbf{p}$ with lever arms $\mathbf{r}_A = \mathbf{p} - \mathbf{x}_A$ and $\mathbf{r}_B = \mathbf{p} - \mathbf{x}_B$, contact normal $\mathbf{n}$, and restitution $e$:

$$\mathbf{v}_{\text{rel}} = (\mathbf{v}_B + \boldsymbol{\omega}_B \times \mathbf{r}_B) - (\mathbf{v}_A + \boldsymbol{\omega}_A \times \mathbf{r}_A)$$

$$j = \frac{-(1 + e)(\mathbf{v}_{\text{rel}} \cdot \mathbf{n})}{m_A^{-1} + m_B^{-1} + \left[\left(\mathbf{I}_A^{-1}(\mathbf{r}_A \times \mathbf{n})\right) \times \mathbf{r}_A + \left(\mathbf{I}_B^{-1}(\mathbf{r}_B \times \mathbf{n})\right) \times \mathbf{r}_B\right] \cdot \mathbf{n}}$$

$$\mathbf{v}_A' = \mathbf{v}_A - \frac{j}{m_A}\mathbf{n}, \quad \boldsymbol{\omega}_A' = \boldsymbol{\omega}_A - \mathbf{I}_A^{-1}(\mathbf{r}_A \times j\mathbf{n})$$

### Explosion & Damage Impulse

Radial explosions apply linear attenuation over blast radius $R$ scaled by `phys_pushscale` ($k_{\text{push}}$):

$$I_{\text{mag}} = D_{\text{max}} \cdot \max\left(0,\; 1 - \frac{\Vert{}\mathbf{x}_{\text{obj}} - \mathbf{x}_{\text{exp}}\Vert{}}{R}\right) \cdot k_{\text{push}}$$

$$\Delta \mathbf{v} = \frac{I_{\text{mag}}}{m}\,\frac{\mathbf{x}_{\text{obj}} - \mathbf{x}_{\text{exp}}}{\Vert{}\mathbf{x}_{\text{obj}} - \mathbf{x}_{\text{exp}}\Vert{}}$$

---

## 5. Standard Source Physics Constants

| ConVar / Constant | Default Value (HL2 / CS:S) | Surf / Bhop Typical | Units |
| --- | --- | --- | --- |
| `sv_gravity` | `800` | `800` | $\text{u/s}^2$ |
| `sv_accelerate` | `10` (HL2) / `5` (CS:S) | `5` – `10` | $\text{s}^{-1}$ |
| `sv_airaccelerate` | `10` | `100` – `1000` | $\text{s}^{-1}$ |
| `sv_friction` | `4` | `4` | $\text{s}^{-1}$ |
| `sv_stopspeed` | `100` (HL2) / `75` (CS:S) | `75` – `100` | $\text{u/s}$ |
| `sv_maxvelocity` | `3500` | `3500` – `10000` | $\text{u/s}$ |
| `sv_stepsize` | `18` | `18` | $\text{u}$ |
| `DIST_EPSILON` | `0.03125` ($1/32$) | `0.03125` | $\text{u}$ |
| Walkable $n_z$ threshold | `0.7` | `0.7` | dimensionless |

Source engine :

The remaining physics systems in Source Engine fall into specialized gameplay subsystems built on top of VPhysics and QPhysics, followed by the foundational mathematical pillars every real-time physics engine implements, and how Source compares to Unreal Engine and Babylon.js.

1. Remaining Source Engine Physics Subsystems
Beyond core player movement (CGameMovement) and rigid-body collisions, Source implements six specialized physics modules:   

A. VPhysics Constraint & Joint Solver (phys_constraintsystem)
Articulated ragdolls, hinges, pulleys, and breakable structures are modeled as Lagrange multiplier velocity constraints solved iteratively via Projected Gauss-Seidel (PGS):   

Holonomic Position Constraints: Enforces $C(\mathbf{x}_A, \mathbf{x}_B) = 0$ (e.g., ball-and-socket distance $\Vert{}\mathbf{p}_A - \mathbf{p}_B\Vert{} = 0$, or hinge axis alignment $\mathbf{a}_A \times \mathbf{a}_B = \mathbf{0}$).

Velocity-Level Formulation: Differentiating with respect to time yields $\mathbf{J}\mathbf{v} + \beta \frac{C}{\Delta t} = 0$, where $\mathbf{J}$ is the constraint Jacobian and $\beta \in [0, 1]$ is the Baumgarte stabilization factor that pulls drifting joints back together without adding explosive energy.

Breakable Thresholds: Each constraint tracks accumulated impulse $\lambda$; if $\Vert{}\lambda\Vert{} \gt \lambda_{\text{max}}$ or torque $\Vert{}\boldsymbol{\tau}\Vert{} \gt \tau_{\text{max}}$, the joint severs.

B. Rope & Cable Dynamics (CRopeKeyframe / move_rope)
Ropes and power lines are not simulated by Havok; they run a lightweight Verlet / Mass-Spring particle chain on the client/server:

$$\mathbf{x}_{i}(t + \Delta t) = \mathbf{x}_i(t) + \left(\mathbf{x}_i(t) - \mathbf{x}_i(t - \Delta t)\right)(1 - d) + \mathbf{g}\,\Delta t^2$$
Followed by iterative distance relaxation between adjacent nodes $i$ and $i+1$ to enforce segment length $L$:

$$\Delta \mathbf{x} = \frac{\Vert{}\mathbf{x}_{i+1} - \mathbf{x}_i\Vert{} - L}{\Vert{}\mathbf{x}_{i+1} - \mathbf{x}_i\Vert{}} (\mathbf{x}_{i+1} - \mathbf{x}_i), \quad \mathbf{x}_i \leftarrow \mathbf{x}_i + \frac{1}{2}\Delta \mathbf{x}, \quad \mathbf{x}_{i+1} \leftarrow \mathbf{x}_{i+1} - \frac{1}{2}\Delta \mathbf{x}$$
C. Vehicle Suspension & Tire Friction (CFourWheelVehiclePhysics)
Used by the HL2 Jeep/Buggy and Jalopy:

Spring-Damper Raycast Suspension: Casts downward rays from wheel hubs; compression depth $x$ generates upward Hookean spring force plus velocity damping:

$$F_{\text{susp}} = k_{\text{spring}}\,x - c_{\text{damper}}\,\dot{x}$$
Pacejka-Inspired Slip Curves: Longitudinal traction and lateral cornering forces are piecewise-linear/curved functions of tire slip ratio and slip angle, scaled by surface material friction (surfaceproperties.txt).

D. Simplified Buoyancy & Fluid Drag (CPhysicsFluidController)
Source does not compute true 3D fluid pressure integrals. Instead, it checks bounding-box submersion fraction $f_{\text{sub}} \in [0, 1]$ against a water plane and applies an upward impulse proportional to a per-object buoyancy ratio $\rho_{\text{ratio}}$:

$$\mathbf{F}_{\text{buoy}} = m \cdot g \cdot \rho_{\text{ratio}} \cdot f_{\text{sub}}\,\hat{\mathbf{z}} - c_{\text{drag}}\,f_{\text{sub}}\,\mathbf{v}$$
E. Player-to-VPhysics Shadow Controller (IPhysicsPlayerController)   
Because players use non-rotating AABBs (QPhysics) while props use Havok (VPhysics), Source bridges them via a kinematic physics shadow—a Havok rigid body slaved to the player's AABB. When the player walks into a prop, the shadow applies a bounded PD-controller force capped by player_throwforce so players can push barrels without launching 10-ton dumpsters.   

F. Gravity Gun / Zero-Point Energy Field Manipulator (CWeaponPhysCannon)
Uses a critically damped Proportional-Derivative (PD) spring-damper to pull and hold a rigid body at target anchor $\mathbf{x}_{\text{target}}$ in front of the view camera:

$$\mathbf{F}_{\text{hold}} = k_p (\mathbf{x}_{\text{target}} - \mathbf{x}_{\text{obj}}) - k_d\,\mathbf{v}_{\text{obj}}$$

----

###2. Core Mathematics Required in Any Physics Engine
Every real-time 3D physics engine—whether written in C++, Rust, or WebAssembly—requires six foundational mathematical layers:

Linear Algebra & Spatial Transforms:

3D vectors, $3\times 3$ rotation matrices, $4\times 4$ homogeneous transforms, and unit quaternions ($\mathbf{q} = w + xi + yj + zk$) to represent orientation without gimbal lock.

Inertia tensors ($\mathbf{I} \in \mathbb{R}^{3\times 3}$) and their world-space transform $\mathbf{I}_{\text{world}} = \mathbf{R}\,\mathbf{I}_{\text{local}}\,\mathbf{R}^T$.

Numerical Integration (ODE Solvers):

Solving $\dot{\mathbf{x}} = \mathbf{v}$ and $\dot{\mathbf{v}} = \mathbf{M}^{-1}\mathbf{F}$ over discrete timesteps $\Delta t$.

Explicit Euler adds artificial energy and explodes; engines must use Semi-Implicit (Symplectic) Euler, Velocity Verlet, or RK4 (for high-precision trajectories).

Broad-Phase Collision Detection (Spatial Partitioning):

Reducing $O(N^2)$ pairwise checks to $O(N \log N)$ or $O(N)$ using Dynamic Bounding Volume Hierarchies (DBVH), Sweep-and-Prune (SAP) along sorted AABB axes, or Spatial Hashing / Octrees.

Narrow-Phase Collision Detection & Convex Geometry:

SAT (Separating Axis Theorem) for boxes/convex polyhedra.

GJK (Gilbert–Johnson–Keerthi) using Minkowski differences ($A \ominus B$) to detect overlap between arbitrary convex shapes, paired with EPA (Expanding Polytope Algorithm) to compute penetration depth and contact normal.

Continuous Collision Detection (CCD): Swept AABB/sphere raycasts or conservative advancement to prevent fast objects from tunneling through thin walls.

Constraint & Contact Resolution:

Formulating non-penetration, friction cones (Coulomb friction $\Vert{}\mathbf{F}_t\Vert{} \le \mu \Vert{}\mathbf{F}_n\Vert{}$), and joints as a Linear Complementarity Problem (LCP) solved via Projected Gauss-Seidel (PGS) / Sequential Impulses or Extended Position-Based Dynamics (XPBD).

Island Building & Sleeping:

Connected-component graph traversal (BFS/DFS over contact graphs) to group interacting bodies into independent simulation islands for multithreading and put low-kinetic-energy islands to sleep.


---
Rigid-Body Solver Math
TGS (Temporal Gauss-Seidel) + NGS (Non-linear Gauss-Seidel) position solver.

Character Controller
KinematicCharacterController: Swept convex shape-casts + autostep + snap_to_ground.

Determinism
Bit-exact cross-platform determinism (enhanced-determinism via libm across x86, ARM, and WASM).

Collision Geometry
Parry library: GJK/EPA, SAT, BVH, convex hulls, trimeshes, heightfields, compounds.

Soft Bodies & Destruction
Rigid bodies & multibodies only (no built-in cloth or Voronoi fracture).

Multi-Threading
Multi-threaded natively (rayon); single-threaded SIMD in standard WASM.

Character Controller Math: Source vs. Rapier vs. Babylon vs. Unreal
Source (CGameMovement):

Does not use a rigid-body collider at all.

Expands BSP planes by the player's AABB half-extents and performs analytical ray-plane intersections (t = (s1 - 0.03125) / (s1 - s2)).

* **Source & Classic Havok (Baumgarte Stabilization):**
Adds a velocity bias proportional to penetration depth directly into the velocity constraint:

$$v_{\text{bias}} = \frac{\beta}{\Delta t}\max(d - d_{\text{slop}},\, 0)$$

*Trade-off:* Fast and simple, but because it modifies *velocity* rather than *position*, deep overlaps convert into outward rebound velocity—causing stacked crates to jitter or pop apart.

* **Rapier (TGS + Non-Linear Gauss-Seidel / NGS):**
Rapier separates velocity solving from position correction. It solves contact impulses using **Temporal Gauss-Seidel (TGS)** (substepping velocity updates within a single tick) and resolves remaining overlap using **NGS**—a pseudo-velocity position projection step that translates/rotates bodies out of penetration *without* altering their true linear/angular velocities. This gives Rapier remarkably stable tall stacks without Baumgarte bounce.

1. **Source (`CGameMovement`):**
* Does **not** use a rigid-body collider at all.
* Expands BSP planes by the player's AABB half-extents and performs analytical ray-plane intersections (`t = (s1 - 0.03125) / (s1 - s2)`).
* Explicitly separates `Accelerate` and `AirAccelerate` (capping wishspeed at `30 u/s` in the dot-product check) and clips velocity on steep ramps ($n_z \lt 0.7$) without applying ground friction—enabling air-strafing, bhop, and surf.
* 
2. **Rapier (`KinematicCharacterController`):**
* Structurally the closest modern equivalent to Source's `TryPlayerMove` + `StepMove`.
* Performs iterative **convex shape-casts** (capsule, cylinder, or cuboid) along the displacement vector, projects remaining displacement onto hit normals (`Slide`), checks slope angles (`max_slope_climb_angle` / `min_slope_slide_angle`), and executes an explicit 3-step `autostep` (up $\rightarrow$ forward $\rightarrow$ down) over stairs.
* *Difference from Source:* Rapier computes *kinematic displacement* rather than enforcing Quake-style air-strafe velocity caps—so if you want Source surf/bhop physics, you still compute $\mathbf{v}$ using `AirAccelerate` / `ClipVelocity` and pass $\Delta \mathbf{x} = \mathbf{v}\,\Delta t$ into Rapier's `move_shape()`.

Rapier is uniquely suited for authoritative multiplayer web games because the exact same Rust crate runs natively on a server (Linux/Windows) and inside the browser via WASM. With enhanced-determinism enabled, Rapier swaps platform-specific floating-point math (sin, cos, atan2) for deterministic libm implementations—guaranteeing identical simulation hashes across Windows, macOS, Linux, and Chrome/Firefox/Safari.

Source achieves deterministic multiplayer movement by keeping CGameMovement lightweight enough to re-simulate missed ticks on the server (LagCompensation + command history) while letting VPhysics props run loosely synced.

Choose Source-Style Custom Math (CGameMovement + custom BVH/BSP) when tactile, frame-accurate movement mechanics (air-strafing, surf ramps, rocket jumping, 100Hz+ deterministic ticks) are the core gameplay loop—especially when paired with a lightweight custom Rust/C++ WASM core.

Choose Rapier when building a web or cross-platform multiplayer game in TypeScript/Rust that needs fast rigid-body physics, convex shape-casting, and bit-exact determinism between a native server and a browser WASM client (or when pairing Rapier's collision world with custom movement math).

// Rapier Physics Engine Maths:

Rapier (rapier2d / rapier3d) is structured around a modular mathematical pipeline built on nalgebra for linear algebra and parry for geometric collision queries. Its simulation step combines a Temporal Gauss-Seidel (TGS) Soft velocity solver, Non-linear Gauss-Seidel (NGS) position projection, Featherstone reduced-coordinate multibodies, and Finite Element Method (FEM) soft bodies.   

1. Spatial Kinematics & Rigid-Body Integration (nalgebra)
Rigid Transformations ($SE(3)$)
Every rigid body's pose is represented as an isometry $\mathbf{T} = (\mathbf{t}, \mathbf{q}) \in \mathbb{R}^3 \rtimes SO(3)$, combining a translation vector $\mathbf{t} \in \mathbb{R}^3$ and a unit quaternion $\mathbf{q} = w + xi + yj + zk$.

Inertia Tensor & Gyroscopic Torque
Local shape inertia tensors are diagonalized into principal axes $\mathbf{I}_{\text{local}} = \text{diag}(I_x, I_y, I_z)$ during collider construction. At each step, world-space inverse inertia is transformed by rotation matrix $\mathbf{R}(\mathbf{q})$:

$$\mathbf{I}_{\text{world}}^{-1} = \mathbf{R}\,\mathbf{I}_{\text{local}}^{-1}\,\mathbf{R}^T$$
Angular acceleration accounts for external torque $\boldsymbol{\tau}_{\text{ext}}$ and Euler's gyroscopic term:

$$\dot{\boldsymbol{\omega}} = \mathbf{I}_{\text{world}}^{-1}\left(\boldsymbol{\tau}_{\text{ext}} - \boldsymbol{\omega} \times (\mathbf{I}_{\text{world}}\boldsymbol{\omega})\right)$$
Semi-Implicit Euler with Implicit Damping
After solving constraint impulses, velocities are integrated with unconditional-stability implicit linear and angular damping ($c_{\text{lin}}, c_{\text{ang}}$):

$$\mathbf{v}_{t+\Delta t} = \frac{\mathbf{v}_t + (\mathbf{g} + m^{-1}\mathbf{F}_{\text{ext}})\Delta t}{1 + c_{\text{lin}}\Delta t}, \qquad \boldsymbol{\omega}_{t+\Delta t} = \frac{\boldsymbol{\omega}_t + \dot{\boldsymbol{\omega}}\Delta t}{1 + c_{\text{ang}}\Delta t}$$
Positions and orientations advance via exponential map / quaternion integration:

$$\mathbf{t}_{t+\Delta t} = \mathbf{t}_t + \mathbf{v}_{t+\Delta t}\Delta t, \qquad \mathbf{q}_{t+\Delta t} = \text{normalize}\left(\mathbf{q}_t + \frac{1}{2}\begin{bmatrix}0 \\ \boldsymbol{\omega}_{t+\Delta t}\end{bmatrix} \otimes \mathbf{q}_t\,\Delta t\right)$$
2. Broad-Phase & Narrow-Phase Geometry (parry)
Broad-Phase: SIMD Quaternary BVH (Qbvh)
Rapier stores scene colliders in a 4-way Bounding Volume Hierarchy (QBVH) that tests four child AABBs simultaneously using SIMD instructions. Each dynamic AABB is dilated by a prediction margin and swept along its frame displacement $\mathbf{v}\Delta t$ to generate candidate contact pairs in $O(N \log N)$ time.

Narrow-Phase: GJK & EPA on Minkowski Differences
For arbitrary convex shapes $A$ and $B$, parry tests intersection on the Minkowski difference $A \ominus B = \{ \mathbf{a} - \mathbf{b} \mid \mathbf{a} \in A, \mathbf{b} \in B \}$ using support mappings $S_{A \ominus B}(\mathbf{d}) = S_A(\mathbf{d}) - S_B(-\mathbf{d})$:

GJK (Gilbert–Johnson–Keerthi): Iteratively builds a simplex inside $A \ominus B$ toward the origin $\mathbf{0}$. If the simplex encloses $\mathbf{0}$, the shapes intersect; otherwise, the closest point on the simplex yields the exact separation distance and witness points.

EPA (Expanding Polytope Algorithm): When GJK detects overlap, EPA expands the terminating tetrahedron by repeatedly splitting the face closest to $\mathbf{0}$ along its outward normal $\mathbf{n}$ with new support points $S_{A \ominus B}(\mathbf{n})$ until convergence, yielding penetration depth $d$ and contact normal $\mathbf{n}$.

Continuous Collision Detection (Non-Linear Conservative Advancement)
To prevent fast or rapidly spinning bodies from tunneling, Rapier computes a lower-bound Time-of-Impact $t_{\text{TOI}} \in [0, 1]$ using Non-Linear Conservative Advancement. Given maximum body radius $r_{\max}$, translational speed $\Vert{}\mathbf{v}\Vert{}$, and angular speed $\Vert{}\boldsymbol{\omega}\Vert{}$, the maximum displacement of any point on the collider over $\Delta t$ is bounded by:

$$\Delta s_{\max}(\Delta t) = \Vert{}\mathbf{v}\Vert{}\Delta t + r_{\max}\Vert{}\boldsymbol{\omega}\Vert{}\Delta t$$
At each iteration $k$, parry queries the current separation distance $d_k$ and advances time safely by $\Delta t_k = \frac{d_k}{\Vert{}\mathbf{v}_{\text{rel}}\Vert{} + r_A\Vert{}\boldsymbol{\omega}_A\Vert{} + r_B\Vert{}\boldsymbol{\omega}_B\Vert{}}$ until $d_k \le \epsilon_{\text{tol}}$.   

3. Constraint & Contact Solver (TGS Soft + NGS)   
Rapier formulates contact non-penetration, Coulomb friction, and joints as a velocity-level Mixed Linear Complementarity Problem (MLCP) solved via Temporal Gauss-Seidel (TGS) Soft substeps.   

Substepped TGS & Harmonic Oscillator Soft Constraints   
Instead of running many iterations at a single full timestep $\Delta t$, TGS divides $\Delta t$ into $N_{\text{sub}}$ substeps ($\Delta t_{\text{sub}} = \Delta t / N_{\text{sub}}$) and warm-starts impulses from the previous frame.   

Rather than stiff Baumgarte velocity bias (which injects rebound energy into deep overlaps), Rapier uses soft constraints parameterized by natural frequency $\omega = 2\pi f$ and damping ratio $\zeta$:   

$$k_{\text{spring}} = m_{\text{eff}}\,\omega^2, \qquad c_{\text{damp}} = 2\,m_{\text{eff}}\,\zeta\,\omega$$
$$\gamma = \frac{1}{\Delta t_{\text{sub}}\,(c_{\text{damp}} + \Delta t_{\text{sub}}\,k_{\text{spring}})}, \qquad \beta_{\text{soft}} = \frac{\Delta t_{\text{sub}}\,k_{\text{spring}}}{c_{\text{damp}} + \Delta t_{\text{sub}}\,k_{\text{spring}}}$$
For a contact constraint with Jacobian $\mathbf{J}$, effective mass $m_{\text{eff}} = (\mathbf{J}\mathbf{M}^{-1}\mathbf{J}^T)^{-1}$, signed penetration error $C \lt 0$, and restitution velocity $v_{\text{rest}} = -e\,v_n^{-}$, the normal impulse update per iteration is:

$$\Delta \lambda_n = \frac{-\left(\mathbf{J}\mathbf{v} + \max\left(\frac{\beta_{\text{soft}}}{\Delta t_{\text{sub}}}C,\; v_{\text{rest}}\right) + \gamma\,\lambda_n\right)}{\mathbf{J}\mathbf{M}^{-1}\mathbf{J}^T + \gamma}, \qquad \lambda_n \leftarrow \max(\lambda_n + \Delta \lambda_n,\; 0)$$
After position integration within each substep, Rapier runs an unbiased velocity relaxation pass ($\beta_{\text{soft}} = 0$) to dissipate residual Baumgarte/soft-constraint expansion velocity.

Coulomb Friction Cone & Torsional Friction
At each contact manifold point, two orthonormal tangent vectors $\mathbf{t}_1, \mathbf{t}_2$ span the contact plane. Tangential impulses $\boldsymbol{\lambda}_t = (\lambda_{t1}, \lambda_{t2})$ are clamped to the circular Coulomb friction cone:

$$\Vert{}\boldsymbol{\lambda}_t\Vert{}_2 \le \mu\,\lambda_n$$
For patch contacts, Rapier also solves a torsional friction impulse around $\mathbf{n}$ bounded by $\vert{}\lambda_{\text{twist}}\vert{} \le \mu\,r_{\text{patch}}\,\lambda_n$ to prevent objects from spinning indefinitely on flat surfaces.

NGS (Non-Linear Gauss-Seidel) Position Projection
Any residual penetration remaining after velocity substeps is corrected directly on transforms $(\mathbf{t}, \mathbf{q})$ via NGS pseudo-impulses—translating and rotating bodies along the contact normal without altering their true velocities $\mathbf{v}, \boldsymbol{\omega}$.   

4. Articulated Multibodies (Featherstone ABA)   
For kinematic trees (robotic arms, chains, ragdolls without closed loops), Rapier provides reduced-coordinate multibodies (MultibodyJointSet) alongside standard impulse joints:   

6D Spatial Vector Algebra: Combines angular and linear quantities into Plücker spatial vectors—spatial velocity $\hat{\mathbf{v}} = [\boldsymbol{\omega};\, \mathbf{v}] \in \mathbb{R}^6$, spatial force $\hat{\mathbf{f}} = [\boldsymbol{\tau};\, \mathbf{f}] \in \mathbb{R}^6$, and $6\times 6$ spatial articulated inertia matrices $\hat{\mathbf{I}}^A$.

Featherstone's Articulated Body Algorithm (ABA): Computes forward dynamics in $O(n)$ time directly in generalized joint coordinates $(\mathbf{q}_{\text{gen}}, \dot{\mathbf{q}}_{\text{gen}})$, guaranteeing zero joint separation at large timesteps. Closed-loop structures combine a spanning multibody tree with loop-closing impulse constraints.   

5. Soft-Body Mechanics (FEM, Shape-Matching & Tearing)   
Rapier's volumetric soft-body engine discretizes 2D shapes via constrained Delaunay triangulation and 3D meshes into tetrahedra via Isosurface Stuffing, supporting three constitutive models:   

1. Finite Element Method (FEM)
For each tetrahedral element with rest edge matrix $\mathbf{D}_m = [\mathbf{x}_1^0 - \mathbf{x}_0^0,\; \mathbf{x}_2^0 - \mathbf{x}_0^0,\; \mathbf{x}_3^0 - \mathbf{x}_0^0]$ and deformed edge matrix $\mathbf{D}_s$, the deformation gradient is:

$$\mathbf{F} = \mathbf{D}_s\,\mathbf{D}_m^{-1}$$
Corotated Linear Elasticity: Extracts rotation $\mathbf{R}$ via polar decomposition ($\mathbf{F} = \mathbf{R}\mathbf{S}$) to measure pure strain $\boldsymbol{\varepsilon} = \mathbf{S} - \mathbf{I}$, yielding first Piola-Kirchhoff stress:

$$\mathbf{P}(\mathbf{F}) = 2\mu(\mathbf{F} - \mathbf{R}) + \lambda\,\text{tr}(\mathbf{R}^T\mathbf{F} - \mathbf{I})\mathbf{R}$$
Neo-Hookean Hyperelasticity: Models large non-linear volumetric deformations using strain energy density with Lamé parameters $\mu, \lambda$ and $J = \det(\mathbf{F})$:

$$\Psi(\mathbf{F}) = \frac{\mu}{2}\left(\text{tr}(\mathbf{F}^T\mathbf{F}) - 3\right) - \mu \ln J + \frac{\lambda}{2}(\ln J)^2$$
Volume Conservation Constraint: Enforces $C_{\text{vol}} = \det(\mathbf{F}) - 1 = 0$ across cells.

2. Shape-Matching (Topology-Free)
Aligns rest point cloud $\mathbf{x}_i^0$ to deformed mass points $\mathbf{x}_i$ around centers of mass $\bar{\mathbf{x}}^0, \bar{\mathbf{x}}$ by computing the optimal rotation $\mathbf{R}$ via polar decomposition of the covariance matrix:

$$\mathbf{A} = \sum_i m_i (\mathbf{x}_i - \bar{\mathbf{x}})(\mathbf{x}_i^0 - \bar{\mathbf{x}}^0)^T = \mathbf{R}\mathbf{S}, \qquad \mathbf{g}_i = \mathbf{R}(\mathbf{x}_i^0 - \bar{\mathbf{x}}^0) + \bar{\mathbf{x}}$$
3. Plasticity & Mass-Splitting Tearing
Plasticity: When elemental strain $\Vert{}\boldsymbol{\varepsilon}\Vert{}$ exceeds a yield threshold, the rest matrix $\mathbf{D}_m$ updates permanently toward the deformed state.

Mass-Splitting Fracture: When stress exceeds fracture limits, shared vertices split into independent mass nodes rather than deleting cells, preserving total mesh volume across torn pieces.

6. Specialized Gameplay Controllers
Kinematic Character Controller (KinematicCharacterController)
Resolves desired translation $\Delta \mathbf{x}_{\text{des}}$ against scene colliders using iterative convex shape-casts with skin margin $\delta_{\text{offset}}$:

Slide & Slope Filtering: Projects remaining displacement onto hit normal $\mathbf{n}$ ($\Delta \mathbf{x}_{\text{rem}} \leftarrow \Delta \mathbf{x}_{\text{rem}} - (\Delta \mathbf{x}_{\text{rem}} \cdot \mathbf{n})\mathbf{n}$). Compares surface angle $\theta = \arccos(\mathbf{n} \cdot \hat{\mathbf{u}}_{\text{up}})$ against max_slope_climb_angle and min_slope_slide_angle to block climbing steep walls or trigger downward sliding.

3-Stage Autostep: If blocked while grounded, sweeps upward by $h_{\text{step}}$, sweeps forward to verify minimum step clearance width $w_{\text{min}}$, and sweeps downward to land on the stair tread.

Snap-to-Ground: Casts downward by $d_{\text{snap}}$ at the end of movement to keep the character attached when cresting downward slopes.

Raycast Vehicle Controller (DynamicRayCastVehicleController)
Casts suspension rays of rest length $L_0$ from chassis wheel hardpoints. For compression $x = L_0 - L$, suspension force follows a damped Hookean law:

$$F_{\text{susp}} = k_{\text{susp}}\,x - c_{\text{damp}}\,\dot{x}$$
Longitudinal traction and lateral cornering forces are applied at contact patches based on wheel slip ratio and lateral slip velocity.

Velocity-Level PID Controller (PidController)
Drives a dynamic body toward a target pose $(\mathbf{t}_{\text{target}}, \mathbf{q}_{\text{target}})$ by computing desired linear and angular velocities from translational error $\mathbf{e}_p = \mathbf{t}_{\text{target}} - \mathbf{t}$ and axis-angle orientation error $\mathbf{e}_q = \text{log}(\mathbf{q}_{\text{target}} \otimes \mathbf{q}^{-1})$:

$$\mathbf{v}_{\text{cmd}} = K_p\,\mathbf{e}_p + K_i \int \mathbf{e}_p\,dt + K_d\,\dot{\mathbf{e}}_p$$
7. Cross-Platform Determinism (enhanced-determinism)
When compiled with the enhanced-determinism feature, Rapier guarantees bit-identical IEEE-754 state transitions across x86, ARM, and WebAssembly targets by:
Enforcing deterministic arena handle ordering (Arena generational indices) for simulation island construction and contact solving.

Replacing hardware-dependent standard library math (f32::sin, cos, acos, atan2, sqrt) with deterministic pure-Rust libm software implementations.

//GoldSrcPhysicsEngine.ts

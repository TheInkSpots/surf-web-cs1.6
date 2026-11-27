1. pickup object, tactile props
2. ragdolls
2. vehicles
3. Ladder


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
2. Core Mathematics Required in Any Physics Engine
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

3. Comparison: Source Engine vs. Unreal Engine vs. Babylon.js
Dimension	Source Engine (VPhysics + QPhysics)	Unreal Engine 5 (Chaos Physics)	Babylon.js (Havok WASM / Legacy Plugins)
Core Solver Architecture	Split Hybrid: Quake swept-AABB CGameMovement for players + modified Havok sequential-impulse rigid-body solver for props.	Unified Chaos Solver: Combines rigid-body sequential impulses with XPBD (Extended Position-Based Dynamics) for cloth, destruction, and hair.	Plugin Abstraction (Physics V2): Primary backend is official Havok compiled to WebAssembly (same lineage as Source's solver, 20+ years newer). Legacy V1 supports Cannon.js (JS), Oimo.js (JS), and Ammo.js (Bullet WASM).
Mathematical Formulation	Velocity-based Impulse Solver ($\mathbf{J}\mathbf{M}^{-1}\mathbf{J}^T \boldsymbol{\lambda} = -\mathbf{J}\mathbf{v} - \mathbf{b}$) with Baumgarte position stabilization.	Impulse + XPBD Compliance Solver: Updates positions directly via compliance $\alpha = \frac{1}{k\,\Delta t^2}$ and Lagrange multipliers $\Delta \lambda$, making stiffness independent of substep count.	
Havok WASM: Velocity-based PGS/direct impulse solver with continuous collision detection (CCD).


Cannon.js: Naive SPOOK/PGS solver in JS.
Collision Primitives	Static world uses BSP convex brushes (plane-shifted Minkowski AABBs); dynamic props use convex hull decompositions ($collisionmodel).	Signed Distance Fields (SDF), convex hulls, triangle meshes, and Geometry Collections (Voronoi fracture clusters).	Convex hulls, capsules, spheres, boxes, heightfields, and static triangle meshes (via Havok WASM).
Character Controller	Hardcoded Kinematic Math: Non-rotating AABB with explicit dot-product air-strafe caps and 0.7 normal surf clipping.	Capsule Sweep + Movement Component: UCharacterMovementComponent uses capsule traces, floor walking planes, and optional physics interaction.	Physics Character Controller / Capsule: Uses Havok shape-casts (shapeCast) and velocity projection—does not naturally exhibit Quake/Source air-strafing unless manually coded.
Destruction & Deformables	Pre-authored gibs held by breakable weld constraints (func_breakable); no real-time fracturing.	Real-Time Voronoi Fracture & Strain Clustering: Computes structural strain graphs across clustered rigid bodies and breaks bonds dynamically.	Rigid-body constraints only in Havok WASM; soft bodies available only via legacy Ammo.js (Bullet).
Determinism & Tickrate	Deterministic fixed tickrate (66 Hz or 128 Hz) for player movement; VPhysics is single-threaded and non-deterministic across different CPU architectures.	Asynchronous physics thread with Network Prediction / Rewind support; Chaos offers deterministic mode when fixed-timestep and single-threaded.	Runs on the browser main thread or Web Worker at a fixed dt (default 1/60s). Havok WASM is deterministic per-platform, though JS floating-point timing requires fixed-step accumulators.


Source feels uniquely responsive and exploitable (bhop, surf, rocket jumping) because player movement is not simulated by the rigid-body solver at all—it is a pure analytical vector-projection state machine running over BSP planes.

Unreal (Chaos) unifies rigid bodies, vehicles, cloth, and destructible geometry under XPBD + impulse solvers, prioritizing physical consistency, real-time fracture, and heavy multi-threading over arcade kinematic quirks.   

Babylon.js actually shares Source's exact DNA under the hood in its modern V2 architecture because Microsoft/Havok released the official Havok C++ engine compiled to WebAssembly for Babylon.js—giving browser apps near-native rigid-body performance, though you still have to write a custom CGameMovement layer if you want Quake/Source air-strafe physics.   
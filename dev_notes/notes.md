You are a Game developer; Finish the specs first, no code first.

Make web based multiplayer FPS game (CS 1.6);

1. only 1 mode: Surf
2. reference the same physics configuration in cs 1.6;
  i. The physics behind it
  GoldSrc's movement code allows air acceleration — when airborne, if your view angle differs from your velocity direction, the engine adds a small velocity component toward where you're looking. Normally that value is capped low. On a surf server:
  
  sv_airaccelerate 100    // default 10 — surf servers uncap this
  sv_maxvelocity 3500     // default 3500, sometimes higher on hardcore surf
  With high sv_airaccelerate, sliding along a 30°-60° ramp with a strafe key produces continuous acceleration. Skilled surfers hit 3000-4000 units/second on hard maps. The normal running speed is 250.
  ii. Ramp entry — hit the ramp with A or D pressed before touching it, so momentum carries in
  Angle matching — turn your view slightly toward the ramp direction to maximise acceleration
  Airtime chaining — leave one ramp and land exactly on the next without touching flat ground
  Boost surfing — some maps have booster triggers that add flat velocity
  Perfs — perfect edge boosts, adding significant speed at the top of a ramp
3. import custom maps, using most standard 3d map format. so players can easily edit or create new map for surf or zombie escape modes. And also support the old cs 1.6 map format if possible.
4. Using Wasm. for other technical specs (client side and backend) using the best pratice way.

Game Core:
Surf : Counter-Strike 1.6 surfing relies on the GoldSrc movement engine's air acceleration mechanic, where sliding along steep ramps while strafing and smoothly turning your mouse lets you glide and build high speed without ground friction slowing you down.; players split to 2 teams. or the room master can choose 1 team only.


//
Make web based multiplayer FPS game (CS 1.6);

1. Core Gameplay & Match Rules
The game is a browser-based, first-person multiplayer movement shooter replicating Counter-Strike 1.6 Surf mechanics. Matches operate on a dedicated, room-based server model with two configurable team structures controlled by the Room Master:

Two-Team Competitive Surf (CT vs. T): Players split into Counter-Terrorists and Terrorists. Both teams surf parallel or shared courses toward a map finish zone. Reaching the end teleports the winner to a vantage/armory room ("Jail" or "Finish Arena") to eliminate opposing players who fail to finish before the round timer expires.

Single-Team / Time-Trial Mode (Room Master Toggle): All players join a single unified roster with PvP damage disabled. Gameplay focuses purely on stage completion, personal bests, and live server leaderboard records.

Player Collision (semiclip): Solid player-vs-player collision is disabled by default during surfing so players never block each other on ramps or spawns; nearby teammates/opponents dynamically fade in opacity based on proximity to preserve clear sightlines.

Weapon Movement Speeds: Equipping specific classic weapons alters base max ground speed (250 u/s with Knife, USP, Glock, or Scout; 260 u/s with Scout zoomed-out legacy profile if enabled by room preset), while airborne surf velocity remains governed by sv_maxvelocity.

2. Deterministic GoldSrc Physics Specification
To achieve authentic CS 1.6 surf feel, movement runs at a fixed 100 Hz (10 ms timestep) simulation rate using exact GoldSrc player bounding hulls ($32 \times 32 \times 72$ units standing; $32 \times 32 \times 36$ units ducking) and swept AABB collision traces.

Server Physics CVars (Default & Room Presets)
Parameter	Default Value	Hardcore Preset	Role in Simulation
sv_airaccelerate	100	150	Multiplier controlling air-strafe acceleration responsiveness
sv_maxvelocity	3500	4500	Hard speed cap per axis / total velocity clamp
sv_gravity	800	800	Downward gravitational acceleration ($u/s^2$)
sv_accelerate	10	10	Ground movement acceleration
sv_friction	4	4	Ground deceleration (bypassed on surf ramps)
sv_stopspeed	100	100	Minimum threshold for ground friction deceleration
edgefriction	2	2	Ground edge friction multiplier (inactive while airborne)
Surf Mechanics & Edge-Case Behavior
Air-Strafe Wishspeed Cap: In GoldSrc's air-acceleration formula, the player's desired horizontal speed is clamped to a maximum cap of $30.0\text{ u/s}$ before projecting current velocity onto the wish direction:

$$v_{\text{add}} = \min(\text{wishspeed}, 30.0) - (\vec{v} \cdot \hat{w})$$
Because acceleration scales off the perpendicular difference between look/strafe direction ($\hat{w}$) and current velocity ($\vec{v}$), turning smoothly while holding A or D adds velocity every tick without hitting the $30\text{ u/s}$ projection ceiling.

Ramp Sliding & Slope Detection: Any surface whose plane normal has a vertical component $n_z < 0.7$ (angles steeper than $\approx 45.5^\circ$, typically $30^\circ\text{–}60^\circ$ surf wedges) is classified as non-walkable. The player remains in the airborne state (FL_ONGROUND unset), preventing ground friction from triggering while ClipVelocity projects momentum smoothly along the ramp plane.

Ramp Entry & Angle Matching: Entering a ramp while holding A (for a ramp on the left) or D (for a ramp on the right) presses the player's velocity vector into the angled plane. Smoothly matching mouse yaw rotation to the ramp's curvature maintains a near-$90^\circ$ angle between $\vec{v}$ and $\hat{w}$, maximizing per-tick speed gain.

Airtime Chaining & Triggers: Leaving a ramp transitions seamlessly into standard air-strafing until the next ramp intercept. Touching flat ground ($n_z \ge 0.7$) either applies instant ground friction or triggers a trigger_teleport fail-state back to the current stage start.

Boosters (trigger_push): Volume triggers configured with directional vectors and impulse magnitudes apply either additive velocity (preserving existing momentum) or velocity overrides (launching players across large gaps).

Edge Boosts ("Perfs"): Flicking toward the top lip of a ramp right at apex separation redirects horizontal ramp speed upward without clipping the top flat surface, converting stored horizontal speed into vertical lift.

3. Dual-Format Map Pipeline
The map loader supports both a modern 3D creator workflow and native legacy CS 1.6 map assets so community mappers can use Blender, TrenchBroom, or classic .bsp files.

Primary Modern Format: glTF 2.0 (.glb) + Entity Naming Convention
Creators build maps in Blender (or any 3D DCC tool) and export a single binary .glb file. The importer parses mesh node prefixes and custom properties automatically:

col_ramp_* / col_solid_*: Static collision geometry decomposed into convex hulls and indexed into a Bounding Volume Hierarchy (BVH) for fast swept-box collision.

trig_start / trig_end: Run timer start and finish volumes.

trig_tp_<id> & dest_tp_<id>: Fail-zone teleporters and linked destination nodes (preserving or resetting velocity based on node metadata).

trig_push_<id>: Directional booster pads with custom properties for direction (vec3) and speed (float).

spawn_ct / spawn_t: Team spawn transforms.

Zombie Escape Extensibility: The same .glb schema supports func_breakable (shootable barricades with HP metadata) and func_door (timed hold-point gates) so Zombie Escape maps can be imported without changing the underlying map format.

Legacy CS 1.6 Format: GoldSrc .bsp (v30) & .wad
Geometry & Hulls: Parses GoldSrc BSP lumps directly—specifically Hull 1 (standing player) and Hull 2 (crouching player) pre-compiled clipnodes—giving 1:1 collision parity with original CS 1.6 surf maps (surf_ski_2, surf_green, etc.).

Textures & Lighting: Extracts embedded textures or resolves external .wad archives, applying original pre-baked lightmap lumps (LUMP_LIGHTING) for authentic visual tone and ultra-fast rendering.

Entity Lump Parsing: Maps classic GoldSrc entities (info_player_start, info_player_deathmatch, trigger_teleport, info_teleport_destination, trigger_push, func_illusionary, func_wall) directly into the engine's runtime entity system.

4. Technical Architecture & WebAssembly (Wasm) Stack
To guarantee zero physics drift between client prediction and server authority, the simulation core is written once in Rust (or C++20) and compiled to WebAssembly.

Shared Wasm Simulation Core
Single Source of Truth: Both the browser client and the authoritative game server load the exact same .wasm physics binary.

Zero-Copy Shared Memory: Input commands, player state structs (position, velocity, view angles, duck state, ground flags), and BSP/BVH collision trees live in linear Wasm memory, read directly via typed views without JSON serialization overhead.

Deterministic Fixed Timestep: Runs strictly at 100 ticks/sec (dt = 0.01s). Given identical input packets and tick numbers, client and server produce bit-identical coordinates.

Client-Side Architecture (TypeScript + WebGL2 / WebGPU)
Rendering Engine: Lightweight custom renderer built on Three.js (WebGL2 / WebGPU backend) with custom shaders supporting GoldSrc lightmaps, skyboxes, world-space grid overlays (optional mapper debug mode), and dynamic FOV scaling at high velocities.

Input & Camera Pipeline: Uses the Pointer Lock API with raw unaccelerated mouse deltas (movementX/movementY). Mouse look updates at the monitor's native refresh rate (144Hz–240Hz+) for silky-smooth angle matching, while movement commands are sampled and quantized into 100Hz tick packets.

Client-Side Prediction & Reconciliation: The client runs the Wasm physics step immediately on local input, stores a ring buffer of recent predicted states, and reconciles against authoritative server snapshots—replaying unacknowledged inputs only if a misprediction occurs (e.g., an external trigger_push or teleporter).

Remote Entity Interpolation: Other players are rendered with a configurable 20–30 ms interpolation buffer, smoothly interpolating between authoritative server snapshots so nearby surfers glide without jitter.

Spatial Audio (Web Audio API): Velocity-reactive wind rush audio (pitch and gain scaled from 500 u/s to 3500 u/s), classic CS 1.6 landing thuds, teleporter whooshes, and weapon audio.

Backend & Multiplayer Networking
Authoritative Tick Server: Node.js / Bun (or native Rust/Go) host running the shared Wasm physics module at 100 Hz per active room instance.

Transport Layer: WebTransport (unreliable UDP-like datagrams for 100Hz movement/snapshot packets + reliable streams for chat, map load, and scoreboard events) with automatic fallback to WebSockets (binary ArrayBuffer frames) on browsers/networks blocking QUIC.

Bandwidth Optimization: Binary bit-packed delta snapshots transmitting only active player transforms within visibility/proximity bounds, keeping bandwidth under ~15–25 KB/s per client even in 32-player surf lobbies.

Map & Asset Delivery: Custom .glb and .bsp maps uploaded by room hosts are validated, hashed, and cached on object storage/CDN so joining players download the map binary once via HTTP range requests before entering the room.

5. HUD & Surf Telemetry Specification
Speedometer: Center-lower digital readout displaying live horizontal speed (u/s), total 3D speed, and session peak velocity with color shifts at speed milestones (1000, 2000, 3000+ u/s).

Strafe Sync & Angle Helper (Toggleable): Live percentage indicator showing how efficiently mouse yaw movements align with active A/D strafe inputs.

Run Timer & Splits: Stage timer, total map timer, delta comparison against personal best (-0.42s), and top-3 server record overlay.

Classic net_graph Overlay: Compact corner telemetry showing current ping (ms), server tickrate (100 Hz), packet loss (0%), and interpolation delay (lerp).

6. Phased Implementation Roadmap
Phase 1 — Offline Wasm Movement Sandbox: Build the Rust/C++ Wasm physics core (PM_AirAccelerate, PM_ClipVelocity, hulls) paired with a browser test map containing standard $30^\circ\text{–}60^\circ$ ramps, boosters, and HUD speedometer to dial in exact CS 1.6 movement feel.

Phase 2 — Dual Map Importer (.glb + .bsp): Implement the BVH collision builder for .glb scenes and the GoldSrc v30 .bsp / .wad parser with trigger volume detection.

Phase 3 — Authoritative Multiplayer & Prediction: Stand up the 100Hz tick server, WebTransport/WebSocket binary protocol, client-side prediction/reconciliation, and semiclip interpolation.

Phase 4 — Room Lobbies, Teams & Leaderboards: Add Room Master controls (1-team vs. 2-team mode, CVar presets, custom map upload) and persistent map/stage time records.

Would you like to begin Phase 1 by implementing the Wasm GoldSrc physics core and local testbed first, or start with the .glb / .bsp map parser and renderer?

Recommended AI-Modular Repo Structure
To keep LLM context windows small and prevent regressions as features grow, isolate the codebase into four strict boundaries:
/surf-game
├── /packages/physics-wasm     # Rust (or C++20) deterministic 100Hz GoldSrc movement + BVH/BSP collision
├── /packages/shared-protocol  # Binary packet encoders/decoders (inputs, snapshots, room CVars)
├── /apps/client               # Vite + TypeScript + Three.js renderer, Pointer Lock, audio, HTML/CSS HUD
└── /apps/server               # Node.js / Bun 100Hz authoritative tick server loading physics-wasm

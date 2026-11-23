I will now build the CS 1.6 Surf Phase 1 — Offline Wasm Movement Sandbox in a single self-contained HTML application, combining a deterministic 100 Hz GoldSrc physics engine, synchronized convex-brush 3D surf map, first-person weapon viewmodels, procedural Web Audio SFX, and full surf telemetry HUD.

CS 1.6 Surf — Phase 1 Offline Movement Sandbox

I have built the CS 1.6 Surf — Phase 1 Offline Movement Sandbox in cs16_surf_sandbox.html.

What's Included
Deterministic 100 Hz GoldSrc Physics Core (WebAssembly.Memory Linear ABI + Float32 Math.fround):

Standing (32×32×72u) and ducking (32×32×36u) hulls with headroom-checked uncrouching and mid-air crouch-jumping.

Exact convex-brush swept AABB collision (ClipBoxToBrush with Minkowski plane expansion and DIST_EPSILON = 0.03125) plus multi-plane PM_FlyMove sliding and 2-plane crease resolution.

Authentic PM_AirAccelerate (30 u/s wishspeed projection cap), ground-only PM_Accelerate & PM_Friction (with edgefriction = 2), normal.z < 0.7 ramp detection, and configurable Default (aa 100 / maxvel 3500) vs Hardcore (aa 150 / maxvel 4500) CVar presets.

Synchronized Convex-Brush 3D Surf Map (surf_sandbox_01):

Spawn platform + trig_start gate, 50° drop-in wedge, 54° offset ramp, Booster 1 (trig_push), a curved 3-segment surf bank (52° → 56° → 58°), split dual-angle test ramps (48° Glide vs 60° Steep), Booster 2, elevated trig_end finish platform, and a trig_tp_fail floor.

Calibration Lab (left of spawn): labeled 30° walkable, 46° threshold, 52°, and 60° test wedges plus a 48u crouch-height tunnel.

Weapons, Telemetry & Audio:

Low-poly depth-cleared first-person viewmodels ([1] Scout with optional Legacy 260 u/s toggle, [2] USP .45, [3] Combat Knife), dynamic velocity FOV, F2 Mapper Debug wireframes, digital milestone speedometer, live Strafe Sync % & keycaps, localStorage PB/Top-3 timer, classic net_graph, and procedural Web Audio SFX.

Click Preview to jump in and test the movement feel—let me know if you want to tune ramp layouts, add replay ghosts, or move on to Phase 2 (Rust Wasm binary + WebTransport/WebSocket multiplayer room sync)!

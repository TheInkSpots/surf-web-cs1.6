6. Phased Implementation Roadmap
Phase 1 — Offline Wasm Movement Sandbox: Build the Rust/C++ Wasm physics core (PM_AirAccelerate, PM_ClipVelocity, hulls) paired with a browser test map containing standard $30^\circ\text{–}60^\circ$ ramps, boosters, and HUD speedometer to dial in exact CS 1.6 movement feel.

Phase 2 — Dual Map Importer (.glb + .bsp): Implement the BVH collision builder for .glb scenes and the GoldSrc v30 .bsp / .wad parser with trigger volume detection.

Phase 3 — Authoritative Multiplayer & Prediction: Stand up the 100Hz tick server, WebTransport/WebSocket binary protocol, client-side prediction/reconciliation, and semiclip interpolation.

Phase 4 — Room Lobbies, Teams & Leaderboards: Add Room Master controls (1-team vs. 2-team mode, CVar presets, custom map upload) and persistent map/stage time records.

Would you like to begin Phase 1 by implementing the Wasm GoldSrc physics core and local testbed first, or start with the .glb / .bsp map parser and renderer?

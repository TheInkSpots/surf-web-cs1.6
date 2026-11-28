Your physics core (`100 Hz` `CGameMovement`, `f32` determinism, `PhysicsMemoryAbi`, hitscan/melee, and tick-fused HE grenades) already covers the hardest part of Counter-Strike 1.6. Turning this sandbox into a playable CS 1.6 experience requires **multi-actor state**, **round/economy rules**, **weapon ballistics**, and **VGUI-style HUD/audio systems**.

---

### 1. Multi-Actor & T vs. CT Bot Architecture

Currently, `PhysicsMemoryAbi` and `GoldSrcPhysicsEngine` track a single player hull. Supporting teams and bots requires generalizing player state into an entity pool:

* **Indexed Actor Pool (`PhysicsMemoryAbi` & `GoldSrcPhysicsEngine.ts`):** Expand player offsets into a fixed-capacity array (e.g., `MAX_ACTORS = 16` or `32`) storing `team` (`T`, `CT`, `SPEC`), `hp`, `armor`, `hasHelmet`, `cash`, `alive`, and weapon inventory per slot.
* **Player-vs-Player Collisions & Hitboxes:**
* Add solid hull-vs-hull checks (`32×32×72` standing, `32×32×36` ducking) so teammates can boost each other onto ledges (classic CS 1.6 mechanic), gated by `mp_solid_teammates`.
* Replace single-capsule hit tests with segmented hitboxes (`Head` **4.0×**, `Stomach` **1.25×**, `Chest` **1.0×**, `Legs` **0.75×**).


* **PODBot / ZBot-Style AI (`src/gameplay/BotController.ts`):**
* **Navigation Graph:** Extend `ExtendedMapBuildResult` with a lightweight waypoint graph (`position`, `radius`, and edge flags like `jump`, `duck`, `ladder`, `surf_ramp`, `camp`, `bombsite`).
* **Behavior FSM:** `Buy` → `RouteToObjective` → `Engage` (burst-fire control, recoil compensation, strafe-stopping) → `Plant / Defuse` → `Retreat / Reload`.
* **Humanized Parameters:** Reaction delay (`150–450 ms`), angular aim-error cone, and sound-triggered alertness when enemies run nearby.


* **Third-Person Player Models (`WorldRenderer.ts`):** Render distinct T (Phoenix/Leet) and CT (SAS/GIGN) articulated meshes with weapon attachments, walk/duck/jump animations, and seamless handoff to your existing ragdoll solver upon death.

---

### 2. Round Loop, Economy & Game Modes (`GameRulesEngine.ts`)

* **Round State Machine:**
1. **`FREEZE_TIME` (3–5s):** Movement locked (`maxspeed = 0`), camera/buy menu unlocked.
2. **`LIVE_ROUND` (`1:45`–`2:00`):** Standard combat and objective play.
3. **`BOMB_PLANTED` (`45s`):** Overrides round clock with C4 countdown.
4. **`ROUND_END` (`5s`):** Displays win banner, awards cash, and resets actors/props (`resetSubsystems()`) for the next round.


* **CS 1.6 Economy & Buy Menu (`B` Key):**
* Start cash (`$800`), kill rewards (`$300` standard, `$1500` Knife), win payout (`$3250`), and consecutive loss bonus scaling (`$1400` → `$1900` → `$2400` → `$2900` → `$3400`).
* Numeric VGUI buy menu (`B` → `1` Pistols, `2` Shotguns, `3` SMGs, `4` Rifles, `5` Machine Guns, `6` Equipment: Kevlar `$650`, Kevlar+Helmet `$1000`, Defuse Kit `$400`, Grenades).


* **Objectives & Map Triggers (`BrushBuilder.ts`):**
* `BuyZoneTrigger`: Restricts `B` purchases to spawn zones during the first `15–30s`.
* `BombTargetTrigger` (`A` / `B` sites): Equips C4 in Slot 5 for Terrorists, runs a `3.2s` plant channel, spawns an audible pulsing C4 entity, and allows CTs to hold `E` for `10s` (`5s` with Defuse Kit) to defuse.



---

### 3. Authentic CS 1.6 Arsenal & Combat Mechanics (`WeaponSystem.ts`)

* **Signature Weapons & Weapon-Specific Move Speeds:**
* Enforce CS 1.6 `maxspeed` limits per equipped item (`250 u/s` Knife/Scout/Pistols, `221 u/s` AK-47, `230 u/s` M4A1, `210 u/s` AWP).
* **AK-47 & M4A1:** Add deterministic recoil spray tables (`punchangle` pitch/yaw patterns), one-tap helmet lethality for the AK-47, and RMB silencer attachment toggle for the M4A1.
* **AWP & Glock-18 / FAMAS:** Dual-stage sniper zoom with heavy un-scoped inaccuracy for the AWP; RMB 3-round burst-fire toggle for Glock-18 and FAMAS.


* **Utility Grenades (Slot 4) vs. Gravity Gun:**
* Move the HL2 Gravity Gun to Slot `6` (or `G` sandbox toggle) and dedicate Slot `4` to cycling **HE Grenade**, **Flashbang**, and **Smoke Grenade**.
* **Flashbang:** Raycast line-of-sight + view-angle dot product to drive a full-screen whiteout decay and a Web Audio low-pass tinnitus ring (`SurfAudioEngine.ts`).
* **Smoke Grenade:** Volumetric particle billboard cluster that blocks bot line-of-sight.


* **Wallbang Penetration & Tagging:**
* **Wallbanging:** Allow rifle, Deagle, and sniper hitscan rays to pass through thin brush walls (`< 16–32 units`) with distance/thickness damage falloff and exit decals.
* **Tagging (Hit Slowdown):** Dampen victim horizontal velocity (`vel *= 0.45`) on bullet impact—essential to CS 1.6 gunplay.
* **Fall Damage:** Apply downward impact damage when landing above `580 u/s` vertical speed.



---

### 4. Audio Cues, VGUI HUD & Classic Maps

* **Footstep & Spatial Sound (`SurfAudioEngine.ts`):** Trigger surface-dependent footstep sounds whenever ground speed exceeds `~135 u/s` (silent while holding `Shift` walk or crouching), giving players and bots audio intel.
* **CS 1.6 HUD & Scoreboard (`CombatHudOverlay.ts` & `HudController.ts`):**
* **Bottom Classic Bar:** Numeric Health (`+`), Armor shield value, `$` Cash counter, Round Timer, and `Clip | Reserve` ammo.
* **Kill Feed & Radar:** Top-right kill log (`Killer [Weapon / Headshot] Victim`) and top-left circular radar showing teammates, bomb status, and spotted enemies.
* **`Tab` Scoreboard:** T vs. CT split table with Kills, Deaths, Cash, and Alive/Dead/C4 status.


* **Game Mode Presets:**
* **`aim_map` / `fy_iceworld`:** Fast symmetrical arena to validate bot pathing, recoil, and team rounds immediately.
* **Surf Combat (`surf_ski_2` style):** Reuse your existing surf ramps with a bottom jail/teleport trigger and mid-air gunfights.

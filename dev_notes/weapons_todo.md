**No** — your existing code only supports **visual weapon switching and movement speed differences** across slots `1` (Scout), `2` (USP .45), and `3` (Knife), not firing bullets or melee attacks.

### What Your Code Currently Does

* **Weapon State & Speed (`SurfApp.ts`):** Pressing `1`, `2`, or `3` calls `selectWeapon(slot)`, which writes the slot index to `I32.WEAPON`, plays the switch sound, updates the HUD icon, and adjusts `CMD_MAXSPEED` (`260 u/s` for Legacy Scout in slot 1, `250 u/s` for USP .45 and Knife).
* **Viewmodel & Input (`ViewmodelRig.ts` / `InputController.ts`):** Only `triggerDeploy()`, idle/move sway, and bobbing exist on the viewmodel, and `stepPhysicsTick()` only populates `IN_JUMP` and `IN_DUCK` in `I32.BUTTONS`.

---

### What Needs to Be Added to Support Shooting & Knife Attacks

Because you already have `GoldSrcPhysicsEngine` with `traceWorld()` and `SourceRigidBody` crates, adding functional weapons connects cleanly across four layers:

1. **Mouse Attack Input (`InputController.ts` & `constants.ts`):**
* Add `IN_ATTACK = 1 << 0` (left-click) and `IN_ATTACK2 = 1 << 11` (right-click) bitflags.
* Listen for `mousedown` / `mouseup` while `isPointerLocked` is active and write those flags into `vi[I32.BUTTONS]` each tick.


2. **Hitscan & Melee Raycasting (`GoldSrcPhysicsEngine.ts`):**
* **Scout (Slot 1) & USP .45 (Slot 2):** Cast a zero-extent ray (`traceWorld` with `hx = 0, hy = 0, hz = 0` plus ray-AABB tests against `this.rigidBodies`) from `POS + VIEW_OFS_Z` along `angleVectors(CMD_PITCH, CMD_YAW).forward`. When a bullet hits a `SourceRigidBody` crate, apply linear impulse $\Delta \mathbf{v} = \frac{J}{m}\hat{\mathbf{d}}$ and eccentric torque $\Delta \boldsymbol{\omega} = \mathbf{I}^{-1}(\mathbf{r} \times J\hat{\mathbf{d}})$ so you can shoot crates across the map.
* **Knife (Slot 3):** Run a short-range forward trace (`48 u` for left-click slash, `36 u` for right-click stab) that pushes rigid bodies and triggers a metallic/wood hit sound on contact.
* Enforce per-weapon fire-rate cooldowns (`~1.25 s` Scout bolt cycle, `~0.15 s` USP semi-auto, `~0.4 s` Knife slash).


3. **Recoil Kick & Tracers (`ViewmodelRig.ts` & `WorldRenderer.ts`):**
* Add `triggerAttack(slot, isSecondary)` to `ViewmodelRig` for slide/bolt kickback and knife slash swing.
* Render brief fading tracer lines and impact sparks in `WorldRenderer` from the muzzle to the ray hit point.


4. **Weapon Audio (`SurfAudioEngine.ts`):**
* Synthesize Web Audio gunshot crack/suppressed USP pop and knife swing/impact sounds.

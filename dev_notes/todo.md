add checkpoint teleports and stage split timers to RunTracker.ts?
### 1. Configuring Booster Velocity

Your `GoldSrcPhysicsEngine.ts` models Source's `trigger_push` using transient `basevelocity` (`baseVelX/Y/Z`) and clears `FL_ONGROUND` on contact so ground friction does not strip momentum on the launch tick.

#### `push` Trigger Parameters (`surfSandbox01.ts`)

```ts
builder.addTrigger('trig_push_custom', 'push', minX, minY, minZ, maxX, maxY, maxZ, {
  dirX: 0.85,        // Unit X direction (+X = East/Forward)
  dirY: 0.25,        // Unit Y direction (+Y = North/Left)
  dirZ: 0.46,        // Unit Z direction (+Z = Up)
  addSpeed: 500,     // Impulse added to current velocity (u/s)
  minSpeedXY: 1600,  // Horizontal speed floor (u/s) — rescues slow entries
  minVelZ: 700,      // Vertical launch speed floor (u/s) — guarantees arc height
  cooldownTicks: 22, // Minimum ticks between re-triggers (100Hz -> 22 ticks = 0.22s)
});

```

* **How `addSpeed` vs. `minSpeedXY` / `minVelZ` interact:**
* If you enter fast (`2200 u/s`), `addSpeed` adds `dir * addSpeed` on top of your existing momentum (capped by `sv_maxvelocity`).
* If you enter slow (`600 u/s`), `minSpeedXY` and `minVelZ` override the floor so you still clear the gap to the next ramp.


* **Tuning Presets:**
* **Flat Speed Pad (carry horizontal momentum):** `dirZ: 0.05`, `addSpeed: 650`, `minSpeedXY: 1900`, `minVelZ: 120`
* **High-Arc Stage Launcher:** `dirZ: 0.62`, `addSpeed: 450`, `minSpeedXY: 1650`, `minVelZ: 900`
* **Pure Vertical Elevator:** `dirX: 0`, `dirY: 0`, `dirZ: 1.0`, `addSpeed: 300`, `minSpeedXY: 0`, `minVelZ: 950`
* **Radial Explosion Booster (`'explosion'`):** Uses `originX/Y/Z`, `maxDamage`, `radius`, and `pushScale` to apply distance-attenuated impulses $I = D_{\max}\max(0, 1 - d/R)\cdot k_{\text{push}}$ to both the player and nearby `SourceRigidBody` crates.



#### Optional `GoldSrcPhysicsEngine.ts` Upgrade for Configurable Cooldown & Vertical Pads

In `checkTriggers()` inside `GoldSrcPhysicsEngine.ts`, replace the `'push'` block so `cooldownTicks` is read from `t.meta` and `minSpeedXY` does not force horizontal velocity when `dirX === 0 && dirY === 0`:

```ts
      } else if (t.type === 'push') {
        const cooldown = (t.meta.cooldownTicks as number | undefined) ?? 22;
        const lastTick = this.triggerCooldowns.get(t.id) ?? -999;
        if (tick - lastTick >= cooldown) {
          this.triggerCooldowns.set(t.id, tick);
          const dirX = t.meta.dirX ?? 1;
          const dirY = t.meta.dirY ?? 0;
          const dirZ = t.meta.dirZ ?? 0.5;
          const addSpeed = t.meta.addSpeed ?? 500;
          const minSpeedXY = t.meta.minSpeedXY ?? 1500;
          const minVelZ = t.meta.minVelZ ?? 600;

          this.baseVelX = f32(this.baseVelX + dirX * addSpeed);
          this.baseVelY = f32(this.baseVelY + dirY * addSpeed);

          const dirLen = Math.hypot(dirX, dirY);
          if (dirLen > 1e-4 && minSpeedXY > 0) {
            const projectedXY = Math.hypot(vf[F32.VEL_X] + this.baseVelX, vf[F32.VEL_Y] + this.baseVelY);
            if (projectedXY < minSpeedXY) {
              this.baseVelX = f32((dirX / dirLen) * minSpeedXY - vf[F32.VEL_X]);
              this.baseVelY = f32((dirY / dirLen) * minSpeedXY - vf[F32.VEL_Y]);
            }
          }

          const nextZ = Math.max(vf[F32.VEL_Z] + this.baseVelZ + dirZ * addSpeed, minVelZ);
          this.baseVelZ = f32(nextZ - vf[F32.VEL_Z]);

          vi[I32.FLAGS] &= ~FL_ONGROUND;
          this.callbacks.onBoost?.(t.id);
        }
      }

```

---

### 2. Adding Stage Checkpoints & Practice Save-States

In CS surf timers, checkpoints serve two roles: **zone checkpoints** (`map_cpX` / `stageX_start`) that record split deltas against your Personal Best, and **respawn/practice checkpoints** (`!cp` / `!tp`) that let you teleport back to the last reached stage without restarting from Stage 1.

#### Step 1: Add `'checkpoint'` Trigger Type (`src/physics/BrushBuilder.ts`)

Add `'checkpoint'` to your trigger union in `BrushBuilder.ts`:

```ts
export type TriggerType = 'start' | 'end' | 'push' | 'teleport' | 'explosion' | 'checkpoint';

```

#### Step 2: Place Stage Checkpoint Zones (`src/maps/surfSandbox01.ts`)

Add checkpoint triggers at the entry of Stages 2, 3, and 4 with safe respawn coordinates (`respawnX/Y/Z/Yaw/Pitch`):

```ts
  // Stage 2 Checkpoint (at the Dual-Angle Split entry)
  builder.addTrigger('trig_cp_2', 'checkpoint', 6760, 1020, 320, 7220, 1520, 820, {
    index: 2,
    label: 'STAGE 2 — DUAL SPLIT',
    respawnX: 6880,
    respawnY: 1270,
    respawnZ: 540,
    respawnYaw: Math.PI * 0.25,
    respawnPitch: -0.06,
  });

  // Stage 3 Checkpoint (above the Sky Deck)
  builder.addTrigger('trig_cp_3', 'checkpoint', s3DeckX - 240, s3DeckY - 240, 740, s3DeckX + 240, s3DeckY + 240, 1060, {
    index: 3,
    label: 'STAGE 3 — HIGH APEX',
    respawnX: s3DeckX,
    respawnY: s3DeckY,
    respawnZ: 780,
    respawnYaw: 0.38,
    respawnPitch: -0.05,
  });

  // Stage 4 Checkpoint (before South Slalom Ramp 9)
  builder.addTrigger('trig_cp_4', 'checkpoint', 12340, 780, 420, 12740, 1180, 860, {
    index: 4,
    label: 'STAGE 4 — SOUTH SLALOM',
    respawnX: 12540,
    respawnY: 980,
    respawnZ: 620,
    respawnYaw: -Math.PI * 0.5,
    respawnPitch: -0.06,
  });

```

#### Step 3: Add Checkpoint Detection & Teleportation (`src/physics/GoldSrcPhysicsEngine.ts`)

1. Add `onCheckpoint` to `PhysicsCallbacks` and an interface for saved player states:

```ts
export interface CheckpointState {
  index: number;
  label: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  velX?: number;
  velY?: number;
  velZ?: number;
}

export interface PhysicsCallbacks {
  onLand?: (impactSpeed: number) => void;
  onJump?: () => void;
  onStartRun?: () => void;
  onFinishRun?: () => void;
  onBoost?: (triggerId: string) => void;
  onTeleport?: (isFail: boolean) => void;
  onRigidBodyHit?: (bodyId: string, impulseMag: number) => void;
  onExplosion?: (triggerId: string, origin: Vec3, radius: number) => void;
  onCheckpoint?: (cp: CheckpointState) => void;
}

```

2. Add `teleportToCheckpoint(cp: CheckpointState)` and `captureCheckpointState()` to `GoldSrcPhysicsEngine`:

```ts
  public captureCheckpointState(index = 0, label = 'CUSTOM SAVE'): CheckpointState {
    const vf = this.abi.f32;
    return {
      index,
      label,
      x: vf[F32.POS_X],
      y: vf[F32.POS_Y],
      z: vf[F32.POS_Z],
      yaw: vf[F32.YAW],
      pitch: vf[F32.PITCH],
      velX: vf[F32.VEL_X],
      velY: vf[F32.VEL_Y],
      velZ: vf[F32.VEL_Z],
    };
  }

  public teleportToCheckpoint(cp: CheckpointState): void {
    const { f32: vf, i32: vi } = this.abi;
    vf[F32.POS_X] = f32(cp.x);
    vf[F32.POS_Y] = f32(cp.y);
    vf[F32.POS_Z] = f32(cp.z);
    vf[F32.PREV_X] = f32(cp.x);
    vf[F32.PREV_Y] = f32(cp.y);
    vf[F32.PREV_Z] = f32(cp.z);
    vf[F32.VEL_X] = f32(cp.velX ?? 0);
    vf[F32.VEL_Y] = f32(cp.velY ?? 0);
    vf[F32.VEL_Z] = f32(cp.velZ ?? 0);
    this.baseVelX = f32(0);
    this.baseVelY = f32(0);
    this.baseVelZ = f32(0);
    vf[F32.YAW] = f32(cp.yaw);
    vf[F32.PITCH] = f32(cp.pitch);
    vi[I32.FLAGS] &= ~FL_ONGROUND;
    vi[I32.MOVESTATE] = MoveState.AIR;
  }

```

3. Handle `t.type === 'checkpoint'` inside `checkTriggers()`:

```ts
      } else if (t.type === 'checkpoint') {
        const index = (t.meta.index as number | undefined) ?? 1;
        this.callbacks.onCheckpoint?.({
          index,
          label: (t.meta.label as string | undefined) ?? `CHECKPOINT ${index}`,
          x: (t.meta.respawnX as number | undefined) ?? (t.minX + t.maxX) * 0.5,
          y: (t.meta.respawnY as number | undefined) ?? (t.minY + t.maxY) * 0.5,
          z: (t.meta.respawnZ as number | undefined) ?? t.minZ + 38,
          yaw: (t.meta.respawnYaw as number | undefined) ?? vf[F32.YAW],
          pitch: (t.meta.respawnPitch as number | undefined) ?? 0,
        });
      }

```

#### Step 4: Track Split Deltas & Wire Hotkeys (`SurfApp.ts` & `WorldRenderer.ts`)

1. **In `WorldRenderer.ts`:** Add a violet/amber translucent field inside `buildVisualWorld` for `trig.type === 'checkpoint'` (and `checkpoint: 0xa855f7` in `dbgColors`) so checkpoint gates are visible in-world.
2. **In `SurfApp.ts`:** Track `activeCheckpoint: CheckpointState | null` and `visitedCheckpoints = new Set<number>()`, plus `stageStartTick`:

```ts
  // Inside SurfApp fields:
  private activeCheckpoint: CheckpointState | null = null;
  private customCheckpoint: CheckpointState | null = null;
  private readonly visitedCheckpoints = new Set<number>();
  private runStartTick = 0;

  // Inside GoldSrcPhysicsEngine callbacks:
  onStartRun: () => {
    if (this.runTracker.state !== 'RUNNING') {
      this.runStartTick = this.abi.i32[I32.TICK];
      this.visitedCheckpoints.clear();
      this.activeCheckpoint = null;
      this.runTracker.start(this.runStartTick);
      this.audio.playStartBeep();
      this.hud.showToast('RUN STARTED — GO!', 'rgba(52,211,153,0.6)');
    }
  },
  onCheckpoint: (cp) => {
    if (this.visitedCheckpoints.has(cp.index)) return;
    this.visitedCheckpoints.add(cp.index);
    this.activeCheckpoint = cp;
    const elapsedSec = (this.abi.i32[I32.TICK] - this.runStartTick) * FIXED_DT;
    this.audio.playStartBeep();
    this.hud.showToast(
      `${cp.label}  •  ${RunTracker.formatTime(elapsedSec)}  (Press B to Respawn Here)`,
      'rgba(168,85,247,0.75)',
    );
  },

```

3. **Bind Hotkeys in `handleSandboxHotkey` (`SurfApp.ts`):**
* **`B`:** Teleport back to `this.activeCheckpoint` (and reset `this.input.resetView(cp.yaw, cp.pitch)`).
* **`C` / `V`:** Save (`this.customCheckpoint = this.physics.captureCheckpointState()`) and restore a mid-air practice state with full velocity preserved.
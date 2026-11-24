// src/gameplay/WeaponSystem.ts
import { f32 } from '../core/constants';
import { F32, I32, PhysicsMemoryAbi } from '../core/memoryAbi';
import {
  computeAngleVectors,
  createWeaponRigidBody,
  GoldSrcPhysicsEngine,
  SourceRigidBody,
  Vec3,
  WeaponSlot,
} from '../physics/GoldSrcPhysicsEngine';
import { SurfAudioEngine } from '../audio/SurfAudioEngine';
import { ViewmodelRig } from '../render/ViewmodelRig';
import { WorldRenderer } from '../render/WorldRenderer';
import { InputController } from './InputController';

export interface GunSlotState {
  owned: boolean;
  clip: number;
  clipMax: number;
  reserve: number;
  silenced?: boolean;
}

export interface WeaponHudSnapshot {
  activeSlot: WeaponSlot;
  scout: GunSlotState;
  usp: GunSlotState;
  knifeOwned: boolean;
  reloading: boolean;
  reloadProgress: number;
  scopeZoom: 0 | 1 | 2;
  nearbyPickupLabel: string | null;
}

export interface WeaponSystemCallbacks {
  onToast?: (msg: string, color: string) => void;
  onHitMarker?: (isBlood: boolean, isKill: boolean) => void;
  onActiveSlotChanged?: (slot: WeaponSlot) => void;
}

export class WeaponSystem {
  private readonly abi: PhysicsMemoryAbi;
  private readonly physics: GoldSrcPhysicsEngine;
  private readonly audio: SurfAudioEngine;
  private readonly viewmodel: ViewmodelRig;
  private readonly renderer: WorldRenderer;
  private readonly input: InputController;
  private readonly callbacks: WeaponSystemCallbacks;

  private activeSlot: WeaponSlot = 1;
  private lastSlot: WeaponSlot = 3;
  private scopeZoom: 0 | 1 | 2 = 0;

  private readonly scout: GunSlotState = {
    owned: true,
    clip: 10,
    clipMax: 10,
    reserve: 90,
  };

  private readonly usp: GunSlotState = {
    owned: true,
    clip: 12,
    clipMax: 12,
    reserve: 100,
    silenced: true,
  };

  private nextPrimaryAt = 0;
  private nextSecondaryAt = 0;
  private reloadEndsAt = 0;
  private reloadDuration = 1.15;
  private reloadingSlot: 1 | 2 | null = null;
  private droppedCounter = 0;
  private nearbyWeapon: SourceRigidBody | null = null;

  constructor(
    abi: PhysicsMemoryAbi,
    physics: GoldSrcPhysicsEngine,
    audio: SurfAudioEngine,
    viewmodel: ViewmodelRig,
    renderer: WorldRenderer,
    input: InputController,
    callbacks: WeaponSystemCallbacks = {},
  ) {
    this.abi = abi;
    this.physics = physics;
    this.audio = audio;
    this.viewmodel = viewmodel;
    this.renderer = renderer;
    this.input = input;
    this.callbacks = callbacks;

    this.viewmodel.setUspSilenced(Boolean(this.usp.silenced));
    this.selectSlot(1, true);
  }

  public getActiveSlot(): WeaponSlot {
    return this.activeSlot;
  }

  public getMoveSpeed(): number {
    if (this.activeSlot === 1) {
      if (this.scopeZoom > 0) return f32(220.0);
      return this.abi.i32[I32.LEGACY_SCOUT] === 1 ? f32(260.0) : f32(250.0);
    }
    return f32(250.0);
  }

  public resetLoadout(): void {
    this.scout.owned = true;
    this.scout.clip = this.scout.clipMax;
    this.scout.reserve = 90;

    this.usp.owned = true;
    this.usp.clip = this.usp.clipMax;
    this.usp.reserve = 100;
    this.usp.silenced = true;

    this.cancelReload();
    this.setScopeZoom(0);
    this.viewmodel.setUspSilenced(true);
    this.selectSlot(1, true);
  }

  public selectSlot(slot: number, silent = false): boolean {
    if (slot !== 1 && slot !== 2 && slot !== 3) return false;
    if (slot === 1 && !this.scout.owned) {
      if (!silent) this.callbacks.onToast?.('NO PRIMARY WEAPON (Pick up a Scout)', 'rgba(148,163,184,0.75)');
      return false;
    }
    if (slot === 2 && !this.usp.owned) {
      if (!silent) this.callbacks.onToast?.('NO SECONDARY WEAPON (Pick up a USP .45)', 'rgba(148,163,184,0.75)');
      return false;
    }
    if (slot === this.activeSlot && !silent) return true;

    if (this.activeSlot !== slot) {
      this.lastSlot = this.activeSlot;
    }

    this.cancelReload();
    this.setScopeZoom(0);
    this.activeSlot = slot;
    this.abi.i32[I32.WEAPON] = slot;

    this.viewmodel.setActiveSlot(slot);
    this.viewmodel.triggerDeploy();
    if (!silent) {
      this.audio.playWeaponSwitch();
    }
    this.callbacks.onActiveSlotChanged?.(slot);
    return true;
  }

  public quickSwitch(): void {
    if (this.selectSlot(this.lastSlot)) return;
    if (this.activeSlot !== 3) {
      this.selectSlot(3);
    } else if (this.scout.owned) {
      this.selectSlot(1);
    } else if (this.usp.owned) {
      this.selectSlot(2);
    }
  }

  public handlePrimaryPress(nowSec: number): void {
    if (this.physics.getVitals().dead) return;
    if (nowSec < this.nextPrimaryAt) return;

    if (this.activeSlot === 1) {
      this.fireScout(nowSec);
    } else if (this.activeSlot === 2) {
      this.fireUsp(nowSec);
    } else {
      this.performKnifeAttack(nowSec, false);
    }
  }

  public handleSecondaryPress(nowSec: number): void {
    if (this.physics.getVitals().dead) return;
    if (nowSec < this.nextSecondaryAt) return;

    if (this.activeSlot === 1) {
      const nextZoom: 0 | 1 | 2 = this.scopeZoom === 0 ? 1 : this.scopeZoom === 1 ? 2 : 0;
      this.setScopeZoom(nextZoom);
      this.audio.playScopeZoom();
      this.nextSecondaryAt = nowSec + 0.22;
    } else if (this.activeSlot === 2) {
      this.cancelReload();
      this.usp.silenced = !this.usp.silenced;
      this.viewmodel.setUspSilenced(this.usp.silenced);
      this.audio.playSilencerToggle(this.usp.silenced);
      this.nextSecondaryAt = nowSec + 0.45;
      this.nextPrimaryAt = Math.max(this.nextPrimaryAt, nowSec + 0.45);
      this.callbacks.onToast?.(
        this.usp.silenced ? 'USP .45 SILENCER ATTACHED' : 'USP .45 SILENCER REMOVED',
        'rgba(148,163,184,0.8)',
      );
    } else {
      this.performKnifeAttack(nowSec, true);
    }
  }

  public tryReload(nowSec: number): boolean {
    if (this.physics.getVitals().dead) return false;
    if (this.activeSlot === 3 || this.reloadingSlot !== null) return false;

    const gun = this.activeSlot === 1 ? this.scout : this.usp;
    if (!gun.owned || gun.clip >= gun.clipMax || gun.reserve <= 0) return false;

    this.setScopeZoom(0);
    this.reloadingSlot = this.activeSlot;
    this.reloadDuration = this.activeSlot === 1 ? 1.35 : 1.05;
    this.reloadEndsAt = nowSec + this.reloadDuration;
    this.nextPrimaryAt = Math.max(this.nextPrimaryAt, this.reloadEndsAt);
    this.viewmodel.triggerReload(this.reloadDuration);
    this.audio.playReload();
    return true;
  }

  /** Drop active firearm (Slot 1 or 2) into the world as a VPhysics rigid body */
  public dropActiveWeapon(): void {
    if (this.physics.getVitals().dead) return;
    if (this.activeSlot === 3) {
      this.callbacks.onToast?.('CANNOT DROP COMBAT KNIFE', 'rgba(148,163,184,0.7)');
      return;
    }

    const slot = this.activeSlot;
    const gun = slot === 1 ? this.scout : this.usp;
    if (!gun.owned) return;

    this.cancelReload();
    this.setScopeZoom(0);

    const vf = this.abi.f32;
    const eye = this.physics.getPlayerEyePosition();
    const { forward, right } = computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0);

    const spawnPos: Vec3 = {
      x: f32(eye.x + forward.x * 34 + right.x * 6),
      y: f32(eye.y + forward.y * 34 + right.y * 6),
      z: f32(eye.z + forward.z * 34 - 6),
    };

    const throwSpeed = 310;
    const vel: Vec3 = {
      x: f32(vf[F32.VEL_X] + forward.x * throwSpeed),
      y: f32(vf[F32.VEL_Y] + forward.y * throwSpeed),
      z: f32(vf[F32.VEL_Z] + forward.z * throwSpeed + 75),
    };
    const angVel: Vec3 = {
      x: f32((Math.random() - 0.5) * 4.5),
      y: f32((Math.random() - 0.5) * 4.5),
      z: f32(5.2),
    };

    const tick = this.abi.i32[I32.TICK];
    const body = createWeaponRigidBody(
      `dropped_wpn_${slot}_${++this.droppedCounter}`,
      spawnPos,
      {
        slot,
        clipAmmo: gun.clip,
        reserveAmmo: gun.reserve,
        silenced: slot === 2 ? Boolean(gun.silenced) : undefined,
        pickupCooldownTick: tick + 85, // 0.85s auto-pickup cooldown
      },
      vel,
      angVel,
    );

    this.physics.addRigidBody(body);
    gun.owned = false;
    gun.clip = 0;
    gun.reserve = 0;

    this.audio.playWeaponDrop();
    this.callbacks.onToast?.(
      `DROPPED ${slot === 1 ? 'STEYR SCOUT .308' : 'USP .45 TACTICAL'}  (Press E to Pick Up)`,
      'rgba(56,189,248,0.8)',
    );

    // Auto-switch to next available weapon
    if (slot === 1 && this.usp.owned) {
      this.selectSlot(2, true);
    } else if (slot === 2 && this.scout.owned) {
      this.selectSlot(1, true);
    } else {
      this.selectSlot(3, true);
    }
  }

  /** Manual pickup via E key (swaps if that weapon slot is already occupied) */
  public tryPickupLookedWeapon(): boolean {
    if (this.physics.getVitals().dead) return false;
    const eye = this.physics.getPlayerEyePosition();
    const { forward } = computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0);
    const candidate = this.physics.findNearbyWeapon(135, eye, forward, 0.72, false);
    if (!candidate || !candidate.weaponData) return false;

    return this.equipGroundWeapon(candidate, true);
  }

  /** Per-frame update: reload completion, held-fire repeat, auto-pickup, and pickup prompt */
  public update(nowSec: number): void {
    if (this.physics.getVitals().dead) {
      this.nearbyWeapon = null;
      return;
    }

    // 1. Finish active reload
    if (this.reloadingSlot !== null && nowSec >= this.reloadEndsAt) {
      const gun = this.reloadingSlot === 1 ? this.scout : this.usp;
      if (gun.owned) {
        const needed = gun.clipMax - gun.clip;
        const load = Math.min(needed, gun.reserve);
        gun.clip += load;
        gun.reserve -= load;
      }
      this.reloadingSlot = null;
    }

    // 2. Continuous hold-to-slash for knife
    if (this.activeSlot === 3) {
      if (this.input.keys.attack1 && nowSec >= this.nextPrimaryAt) {
        this.performKnifeAttack(nowSec, false);
      } else if (this.input.keys.attack2 && nowSec >= this.nextSecondaryAt) {
        this.performKnifeAttack(nowSec, true);
      }
    }

    // 3. Auto-pickup when walking over a ground weapon for an empty slot
    const feetPickup = this.physics.findNearbyWeapon(54, undefined, undefined, -1, true);
    if (feetPickup && feetPickup.weaponData) {
      const slot = feetPickup.weaponData.slot;
      const gun = slot === 1 ? this.scout : this.usp;
      if (!gun.owned) {
        this.equipGroundWeapon(feetPickup, false);
      }
    }

    // 4. Highlight nearest looked-at ground weapon for HUD prompt
    const eye = this.physics.getPlayerEyePosition();
    const { forward } = computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0);
    this.nearbyWeapon = this.physics.findNearbyWeapon(135, eye, forward, 0.72, false);
  }

  public getHudSnapshot(nowSec: number): WeaponHudSnapshot {
    const reloading = this.reloadingSlot !== null;
    const reloadProgress = reloading
      ? Math.max(0, Math.min(1, 1 - (this.reloadEndsAt - nowSec) / Math.max(0.01, this.reloadDuration)))
      : 0;

    let nearbyPickupLabel: string | null = null;
    if (this.nearbyWeapon?.weaponData) {
      const wd = this.nearbyWeapon.weaponData;
      const name = wd.slot === 1 ? 'Steyr Scout .308' : 'USP .45 Tactical';
      const owned = wd.slot === 1 ? this.scout.owned : this.usp.owned;
      nearbyPickupLabel = `[E] ${owned ? 'Swap' : 'Pick up'} ${name} (${wd.clipAmmo}/${wd.reserveAmmo})`;
    }

    return {
      activeSlot: this.activeSlot,
      scout: { ...this.scout },
      usp: { ...this.usp },
      knifeOwned: true,
      reloading,
      reloadProgress,
      scopeZoom: this.scopeZoom,
      nearbyPickupLabel,
    };
  }

  private equipGroundWeapon(body: SourceRigidBody, allowSwap: boolean): boolean {
    const wd = body.weaponData;
    if (!wd) return false;
    const targetSlot = wd.slot;
    const gun = targetSlot === 1 ? this.scout : this.usp;

    if (gun.owned) {
      if (!allowSwap) return false;
      // Drop current weapon in that slot first
      const prevActive = this.activeSlot;
      this.activeSlot = targetSlot;
      this.dropActiveWeapon();
      this.activeSlot = prevActive;
    }

    const removed = this.physics.removeRigidBody(body.id);
    if (!removed) return false;

    gun.owned = true;
    gun.clip = wd.clipAmmo;
    gun.reserve = wd.reserveAmmo;
    if (targetSlot === 2) {
      gun.silenced = wd.silenced ?? true;
      this.viewmodel.setUspSilenced(gun.silenced);
    }

    this.audio.playWeaponPickup();
    this.selectSlot(targetSlot, true);
    this.callbacks.onToast?.(
      `EQUIPPED ${targetSlot === 1 ? 'STEYR SCOUT .308' : 'USP .45 TACTICAL'} (${gun.clip}/${gun.reserve})`,
      'rgba(52,211,153,0.85)',
    );
    return true;
  }

  private fireScout(nowSec: number): void {
    if (this.reloadingSlot !== null) return;
    if (this.scout.clip <= 0) {
      this.audio.playDryFire();
      this.nextPrimaryAt = nowSec + 0.25;
      this.tryReload(nowSec);
      return;
    }

    this.scout.clip -= 1;
    this.nextPrimaryAt = nowSec + 1.18;
    this.nextSecondaryAt = Math.max(this.nextSecondaryAt, nowSec + 0.35);

    const wasScoped = this.scopeZoom > 0;
    const spreadRad = wasScoped ? 0.0012 : 0.018;

    this.audio.playScoutShot();
    this.viewmodel.triggerFire(1, false);
    this.input.applyRecoilKick(0.036, (Math.random() - 0.5) * 0.01);

    this.fireHitscanRay(8192, spreadRad, 75, 19500, 0xfef08a);

    // Classic CS 1.6 bolt-action unscope on shot
    if (wasScoped) {
      this.setScopeZoom(0);
    }
  }

  private fireUsp(nowSec: number): void {
    if (this.reloadingSlot !== null) return;
    if (this.usp.clip <= 0) {
      this.audio.playDryFire();
      this.nextPrimaryAt = nowSec + 0.22;
      this.tryReload(nowSec);
      return;
    }

    this.usp.clip -= 1;
    this.nextPrimaryAt = nowSec + 0.16;

    const silenced = Boolean(this.usp.silenced);
    const vf = this.abi.f32;
    const spd = Math.hypot(vf[F32.VEL_X], vf[F32.VEL_Y]);
    const spreadRad = (silenced ? 0.008 : 0.011) + Math.min(0.018, spd * 0.000018);

    this.audio.playUspShot(silenced);
    this.viewmodel.triggerFire(2, silenced);
    this.input.applyRecoilKick(silenced ? 0.012 : 0.018, (Math.random() - 0.5) * 0.007);

    this.fireHitscanRay(4096, spreadRad, silenced ? 30 : 34, 8200, silenced ? 0xbae6fd : 0xfde047);
  }

  private fireHitscanRay(
    range: number,
    spreadRad: number,
    damage: number,
    impulseMag: number,
    tracerColor: number,
  ): void {
    const eye = this.physics.getPlayerEyePosition();
    const { forward, right, up } = computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0);

    const sx = (Math.random() - 0.5) * 2 * spreadRad;
    const sy = (Math.random() - 0.5) * 2 * spreadRad;
    const dir: Vec3 = {
      x: f32(forward.x + right.x * sx + up.x * sy),
      y: f32(forward.y + right.y * sx + up.y * sy),
      z: f32(forward.z + right.z * sx + up.z * sy),
    };

    const hit = this.physics.traceRay(eye, dir, range);

    const muzzleStart: Vec3 = {
      x: f32(eye.x + forward.x * 20 + right.x * 6 - up.x * 4),
      y: f32(eye.y + forward.y * 20 + right.y * 6 - up.y * 4),
      z: f32(eye.z + forward.z * 20 + right.z * 6 - up.z * 4),
    };
    const tracerEnd: Vec3 = hit.hit
      ? hit.point
      : {
          x: f32(eye.x + dir.x * range),
          y: f32(eye.y + dir.y * range),
          z: f32(eye.z + dir.z * range),
        };
    this.renderer.spawnBulletTracer(muzzleStart, tracerEnd, tracerColor);

    if (!hit.hit) return;

    if (hit.kind === 'rigidBody' && hit.body) {
      const res = this.physics.applyPointImpulse(hit.body, hit.point, dir, impulseMag, damage);
      const mat = res.bled ? 'blood' : hit.body.kind === 'weapon' ? 'weapon' : 'prop';
      this.renderer.spawnImpactEffect(hit.point, hit.normal, mat);
      this.audio.playImpact(hit.point, mat, impulseMag, hit.body.vel);
      this.callbacks.onHitMarker?.(res.bled, res.destroyed);
    } else {
      this.renderer.spawnImpactEffect(hit.point, hit.normal, 'world');
      this.audio.playImpact(hit.point, 'world', impulseMag * 0.45);
    }
  }

  private performKnifeAttack(nowSec: number, heavy: boolean): void {
    const cooldown = heavy ? 0.72 : 0.36;
    this.nextPrimaryAt = nowSec + cooldown;
    this.nextSecondaryAt = nowSec + cooldown;

    this.viewmodel.triggerKnifeAttack(heavy);
    this.audio.playKnifeSwing(heavy);

    const eye = this.physics.getPlayerEyePosition();
    const { forward } = computeAngleVectors(-this.input.viewPitch, this.input.viewYaw, 0);
    const reach = heavy ? 68 : 74;
    const hit = this.physics.traceMelee(eye, forward, reach);

    if (!hit.hit) return;

    const damage = heavy ? 65 : 25;
    const impulse = heavy ? 17500 : 8800;

    if (hit.kind === 'rigidBody' && hit.body) {
      const res = this.physics.applyPointImpulse(hit.body, hit.point, forward, impulse, damage);
      const mat = res.bled ? 'blood' : hit.body.kind === 'weapon' ? 'weapon' : 'prop';
      this.renderer.spawnImpactEffect(hit.point, hit.normal, mat);
      this.audio.playImpact(hit.point, mat, impulse, hit.body.vel);
      this.callbacks.onHitMarker?.(res.bled, res.destroyed);
    } else {
      this.renderer.spawnImpactEffect(hit.point, hit.normal, 'world');
      this.audio.playImpact(hit.point, 'world', impulse * 0.5);
    }
  }

  private setScopeZoom(level: 0 | 1 | 2): void {
    this.scopeZoom = level;
    this.renderer.setScopeZoom(level);
    this.viewmodel.setScoped(level > 0);
    this.input.sensitivityScale = level === 2 ? 0.25 : level === 1 ? 0.48 : 1.0;
  }

  private cancelReload(): void {
    this.reloadingSlot = null;
    this.reloadEndsAt = 0;
  }
}

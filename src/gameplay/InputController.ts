// src/gameplay/InputController.ts
import * as THREE from 'three';
import { SpawnPoint } from '../physics/GoldSrcPhysicsEngine';

export interface KeyState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  jump: boolean;
  duck: boolean;
  attack1: boolean;
  attack2: boolean;
  use: boolean;
  reload: boolean;
}

export interface InputCallbacks {
  onUnlockRequest?: () => void;
  onSelectWeapon?: (slot: number) => void;
  onQuickSwitch?: () => void;
  onDropWeapon?: () => void;
  onPickupWeapon?: () => void;
  onReloadOrReset?: () => void;
  onResetRun?: () => void;
  onToggleDebug?: () => void;
  onAttack1Press?: () => void;
  onAttack2Press?: () => void;
}

export class InputController {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: InputCallbacks;
  private readonly menuOverlay: HTMLElement | null;
  private readonly lockHint: HTMLElement | null;

  public readonly keys: KeyState = {
    w: false,
    a: false,
    s: false,
    d: false,
    jump: false,
    duck: false,
    attack1: false,
    attack2: false,
    use: false,
    reload: false,
  };

  public isPointerLocked = false;
  public sensitivity = 1.8;
  public sensitivityScale = 1.0;
  public viewYaw: number;
  public viewPitch: number;
  public smoothYawVisual = 0;
  public vmSwayX = 0;
  public vmSwayY = 0;

  private scrollJumpQueued = false;
  private accumYawDeltaTick = 0;

  constructor(canvas: HTMLCanvasElement, spawn: SpawnPoint, callbacks: InputCallbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.viewYaw = spawn.yaw;
    this.viewPitch = spawn.pitch;
    this.menuOverlay = document.getElementById('menu-overlay');
    this.lockHint = document.getElementById('lock-hint');

    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('pointerlockerror', this.handlePointerLockError);
    this.canvas.addEventListener('click', this.handleCanvasClick);
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    document.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('wheel', this.handleWheel, { passive: true });
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.releaseAllKeys);
  }

  public resetView(yaw: number, pitch: number): void {
    this.viewYaw = yaw;
    this.viewPitch = pitch;
  }

  /** Apply recoil view punch in radians (+pitch kicks upward) */
  public applyRecoilKick(pitchRad: number, yawRad: number): void {
    this.viewPitch = Math.max(-1.535, Math.min(1.535, this.viewPitch + pitchRad));
    this.viewYaw += yawRad;
  }

  public consumeScrollJump(): boolean {
    const queued = this.scrollJumpQueued;
    this.scrollJumpQueued = false;
    return queued;
  }

  public consumeTickYawDelta(): number {
    const delta = this.accumYawDeltaTick;
    this.accumYawDeltaTick = 0;
    return delta;
  }

  public decayVisuals(dtSec: number): void {
    this.smoothYawVisual *= Math.pow(0.0005, dtSec);
    this.vmSwayX *= Math.pow(0.001, dtSec);
    this.vmSwayY *= Math.pow(0.001, dtSec);
  }

  public requestLock(): void {
    this.callbacks.onUnlockRequest?.();
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          if (this.lockHint) {
            this.lockHint.textContent = 'Browser cooldown active — click again to lock mouse.';
          }
        });
      }
    } catch {
      if (this.lockHint) {
        this.lockHint.textContent = 'Click the orange button again to engage Pointer Lock.';
      }
    }
  }

  private openMenu(): void {
    this.menuOverlay?.classList.remove('hidden');
    this.releaseAllKeys();
  }

  private closeMenu(): void {
    this.menuOverlay?.classList.add('hidden');
    if (this.lockHint) this.lockHint.textContent = '';
  }

  private releaseAllKeys = (): void => {
    this.keys.w = false;
    this.keys.a = false;
    this.keys.s = false;
    this.keys.d = false;
    this.keys.jump = false;
    this.keys.duck = false;
    this.keys.attack1 = false;
    this.keys.attack2 = false;
    this.keys.use = false;
    this.keys.reload = false;
    this.scrollJumpQueued = false;
  };

  private handlePointerLockChange = (): void => {
    this.isPointerLocked = document.pointerLockElement === this.canvas;
    if (this.isPointerLocked) {
      this.closeMenu();
    } else {
      this.openMenu();
    }
  };

  private handlePointerLockError = (): void => {
    if (this.lockHint) {
      this.lockHint.textContent = 'Pointer lock paused briefly by browser — click button again.';
    }
  };

  private handleCanvasClick = (): void => {
    if (!this.isPointerLocked && this.menuOverlay?.classList.contains('hidden')) {
      this.requestLock();
    }
  };

  private handleContextMenu = (e: MouseEvent): void => {
    if (this.isPointerLocked) {
      e.preventDefault();
    }
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (!this.isPointerLocked) return;
    if (e.button === 0) {
      this.keys.attack1 = true;
      this.callbacks.onAttack1Press?.();
    } else if (e.button === 2) {
      this.keys.attack2 = true;
      this.callbacks.onAttack2Press?.();
    }
  };

  private handleMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.keys.attack1 = false;
    } else if (e.button === 2) {
      this.keys.attack2 = false;
    }
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.isPointerLocked) return;

    // CS 1.6 m_yaw = 0.022 deg per count (scaled when scoped)
    const radPerCount = (0.022 * Math.PI) / 180;
    const effSens = this.sensitivity * this.sensitivityScale;
    const dYaw = -e.movementX * effSens * radPerCount;
    const dPitch = -e.movementY * effSens * radPerCount;

    this.viewYaw += dYaw;
    this.viewPitch = Math.max(-1.535, Math.min(1.535, this.viewPitch + dPitch));

    this.accumYawDeltaTick += dYaw;
    this.smoothYawVisual = THREE.MathUtils.clamp(this.smoothYawVisual + dYaw * 14, -1, 1);

    this.vmSwayX = THREE.MathUtils.clamp(this.vmSwayX - e.movementX * 0.00028, -0.055, 0.055);
    this.vmSwayY = THREE.MathUtils.clamp(this.vmSwayY + e.movementY * 0.00022, -0.04, 0.04);
  };

  private handleWheel = (): void => {
    if (!this.isPointerLocked) return;
    this.scrollJumpQueued = true;
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Tab') {
      e.preventDefault();
      if (this.isPointerLocked) {
        document.exitPointerLock();
      } else {
        this.requestLock();
      }
      return;
    }

    if (e.code === 'F2') {
      e.preventDefault();
      this.callbacks.onToggleDebug?.();
      return;
    }

    if (!this.isPointerLocked) return;

    switch (e.code) {
      case 'KeyW':
        this.keys.w = true;
        break;
      case 'KeyS':
        this.keys.s = true;
        break;
      case 'KeyA':
        this.keys.a = true;
        break;
      case 'KeyD':
        this.keys.d = true;
        break;
      case 'Space':
        this.keys.jump = true;
        e.preventDefault();
        break;
      case 'ControlLeft':
      case 'ControlRight':
        this.keys.duck = true;
        break;
      case 'Digit1':
        if (!e.repeat) this.callbacks.onSelectWeapon?.(1);
        break;
      case 'Digit2':
        if (!e.repeat) this.callbacks.onSelectWeapon?.(2);
        break;
      case 'Digit3':
        if (!e.repeat) this.callbacks.onSelectWeapon?.(3);
        break;
      case 'KeyQ':
        if (!e.repeat) this.callbacks.onQuickSwitch?.();
        break;
      case 'KeyG':
        if (!e.repeat) this.callbacks.onDropWeapon?.();
        break;
      case 'KeyE':
        this.keys.use = true;
        if (!e.repeat) this.callbacks.onPickupWeapon?.();
        break;
      case 'KeyR':
        this.keys.reload = true;
        if (!e.repeat) {
          if (e.shiftKey) {
            this.callbacks.onResetRun?.();
          } else {
            this.callbacks.onReloadOrReset?.();
          }
        }
        break;
      case 'Backspace':
        if (!e.repeat) this.callbacks.onResetRun?.();
        break;
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'KeyW':
        this.keys.w = false;
        break;
      case 'KeyS':
        this.keys.s = false;
        break;
      case 'KeyA':
        this.keys.a = false;
        break;
      case 'KeyD':
        this.keys.d = false;
        break;
      case 'Space':
        this.keys.jump = false;
        break;
      case 'ControlLeft':
      case 'ControlRight':
        this.keys.duck = false;
        break;
      case 'KeyE':
        this.keys.use = false;
        break;
      case 'KeyR':
        this.keys.reload = false;
        break;
    }
  };
}

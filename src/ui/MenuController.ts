import { f32 } from '../core/constants';
import { F32, I32, PhysicsMemoryAbi } from '../core/memoryAbi';

export interface MenuCallbacks {
  onPlay: () => void;
  onRestart: () => void;
  onSensitivityChange: (sens: number) => void;
  onBaseFovChange: (fov: number) => void;
  onScout260Change: (enabled: boolean) => void;
  onStrafeHudChange: (visible: boolean) => void;
  onDebugChange: (enabled: boolean) => void;
  onMuteChange: (muted: boolean) => void;
}

export class MenuController {
  private readonly abi: PhysicsMemoryAbi;
  private readonly callbacks: MenuCallbacks;

  private readonly slAirAccel = document.getElementById('sl-airaccel') as HTMLInputElement;
  private readonly slMaxVel = document.getElementById('sl-maxvel') as HTMLInputElement;
  private readonly slGravity = document.getElementById('sl-gravity') as HTMLInputElement;
  private readonly slSens = document.getElementById('sl-sens') as HTMLInputElement;
  private readonly slFov = document.getElementById('sl-fov') as HTMLInputElement;

  private readonly valAirAccel = document.getElementById('val-airaccel')!;
  private readonly valMaxVel = document.getElementById('val-maxvel')!;
  private readonly valGravity = document.getElementById('val-gravity')!;
  private readonly valSens = document.getElementById('val-sens')!;
  private readonly valFov = document.getElementById('val-fov')!;

  private readonly btnDefault = document.getElementById('preset-default')!;
  private readonly btnHardcore = document.getElementById('preset-hardcore')!;
  private readonly presetInd = document.getElementById('preset-indicator')!;
  private readonly ngCvars = document.getElementById('ng-cvars')!;

  private readonly tgAutoBhop = document.getElementById('tg-autobhop') as HTMLInputElement;
  private readonly tgScout260 = document.getElementById('tg-scout260') as HTMLInputElement;
  private readonly tgStrafe = document.getElementById('tg-strafe') as HTMLInputElement;
  private readonly tgDebug = document.getElementById('tg-debug') as HTMLInputElement;
  private readonly tgMute = document.getElementById('tg-mute') as HTMLInputElement;
  private readonly debugPill = document.getElementById('debug-pill')!;

  constructor(abi: PhysicsMemoryAbi, callbacks: MenuCallbacks) {
    this.abi = abi;
    this.callbacks = callbacks;

    this.btnDefault.addEventListener('click', () => this.applyPreset('default'));
    this.btnHardcore.addEventListener('click', () => this.applyPreset('hardcore'));

    this.slAirAccel.addEventListener('input', () => {
      this.abi.f32[F32.CVAR_AIRACCEL] = f32(Number(this.slAirAccel.value));
      this.syncAll();
    });
    this.slMaxVel.addEventListener('input', () => {
      this.abi.f32[F32.CVAR_MAXVEL] = f32(Number(this.slMaxVel.value));
      this.syncAll();
    });
    this.slGravity.addEventListener('input', () => {
      this.abi.f32[F32.CVAR_GRAVITY] = f32(Number(this.slGravity.value));
      this.syncAll();
    });
    this.slSens.addEventListener('input', () => {
      const sens = Number(this.slSens.value);
      this.valSens.textContent = sens.toFixed(2);
      this.callbacks.onSensitivityChange(sens);
    });
    this.slFov.addEventListener('input', () => {
      const fov = Number(this.slFov.value);
      this.valFov.textContent = `${fov}°`;
      this.callbacks.onBaseFovChange(fov);
    });

    this.tgAutoBhop.addEventListener('change', () => {
      this.abi.i32[I32.AUTOBHOP] = this.tgAutoBhop.checked ? 1 : 0;
    });
    this.tgScout260.addEventListener('change', () => {
      this.abi.i32[I32.LEGACY_SCOUT] = this.tgScout260.checked ? 1 : 0;
      this.callbacks.onScout260Change(this.tgScout260.checked);
    });
    this.tgStrafe.addEventListener('change', () => {
      this.callbacks.onStrafeHudChange(this.tgStrafe.checked);
    });
    this.tgDebug.addEventListener('change', () => {
      this.debugPill.classList.toggle('active', this.tgDebug.checked);
      this.callbacks.onDebugChange(this.tgDebug.checked);
    });
    this.tgMute.addEventListener('change', () => {
      this.callbacks.onMuteChange(this.tgMute.checked);
    });

    document.getElementById('btn-play')?.addEventListener('click', () => this.callbacks.onPlay());
    document
      .getElementById('btn-restart-menu')
      ?.addEventListener('click', () => this.callbacks.onRestart());
  }

  public setDebugChecked(checked: boolean): void {
    this.tgDebug.checked = checked;
    this.debugPill.classList.toggle('active', checked);
  }

  public syncAll(): void {
    const aa = Math.round(this.abi.f32[F32.CVAR_AIRACCEL]);
    const mv = Math.round(this.abi.f32[F32.CVAR_MAXVEL]);
    const gv = Math.round(this.abi.f32[F32.CVAR_GRAVITY]);

    this.slAirAccel.value = String(aa);
    this.valAirAccel.textContent = String(aa);

    this.slMaxVel.value = String(mv);
    this.valMaxVel.textContent = String(mv);

    this.slGravity.value = String(gv);
    this.valGravity.textContent = String(gv);

    this.ngCvars.textContent = `aa:${aa} mv:${mv}`;

    const isDef = aa === 100 && mv === 3500 && gv === 800;
    const isHc = aa === 150 && mv === 4500 && gv === 800;
    this.btnDefault.classList.toggle('active', isDef);
    this.btnHardcore.classList.toggle('active', isHc);
    this.presetInd.textContent = isDef ? 'DEFAULT' : isHc ? 'HARDCORE' : 'CUSTOM';
  }

  private applyPreset(name: 'default' | 'hardcore'): void {
    if (name === 'hardcore') {
      this.abi.f32[F32.CVAR_AIRACCEL] = f32(150.0);
      this.abi.f32[F32.CVAR_MAXVEL] = f32(4500.0);
      this.abi.f32[F32.CVAR_GRAVITY] = f32(800.0);
    } else {
      this.abi.f32[F32.CVAR_AIRACCEL] = f32(100.0);
      this.abi.f32[F32.CVAR_MAXVEL] = f32(3500.0);
      this.abi.f32[F32.CVAR_GRAVITY] = f32(800.0);
    }
    this.syncAll();
  }
}

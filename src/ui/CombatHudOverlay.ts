// src/ui/CombatHudOverlay.ts
import { PlayerVitalState } from '../physics/GoldSrcPhysicsEngine';
import { WeaponHudSnapshot } from '../gameplay/WeaponSystem';

export class CombatHudOverlay {
  private readonly root: HTMLDivElement;
  private readonly scopeEl: HTMLDivElement;
  private readonly hitmarkerEl: HTMLDivElement;
  private readonly pickupEl: HTMLDivElement;
  private readonly deathEl: HTMLDivElement;
  private readonly hpValueEl: HTMLSpanElement;
  private readonly hpFillEl: HTMLDivElement;
  private readonly bloodValueEl: HTMLSpanElement;
  private readonly bloodCountEl: HTMLSpanElement;
  private readonly ammoClipEl: HTMLSpanElement;
  private readonly ammoReserveEl: HTMLSpanElement;
  private readonly reloadBarWrapEl: HTMLDivElement;
  private readonly reloadBarFillEl: HTMLDivElement;
  private readonly slotEls: [HTMLDivElement, HTMLDivElement, HTMLDivElement];

  private hitmarkerTimer = 0;

  constructor() {
    this.injectStyles();

    this.root = document.createElement('div');
    this.root.id = 'combat-hud-root';
    this.root.innerHTML = `
      <div class="chud-scope hidden" id="chud-scope">
        <div class="chud-scope-h"></div>
        <div class="chud-scope-v"></div>
        <div class="chud-scope-ring"></div>
      </div>

      <div class="chud-hitmarker" id="chud-hitmarker"></div>

      <div class="chud-pickup hidden" id="chud-pickup"></div>

      <div class="chud-death hidden" id="chud-death">
        <div class="chud-death-title">YOU DIED</div>
        <div class="chud-death-sub">Press <b>R</b> or <b>Backspace</b> to Respawn</div>
      </div>

      <div class="chud-vitals">
        <div class="chud-vitals-row">
          <span class="chud-label">HP</span>
          <span class="chud-hp-val" id="chud-hp-val">100</span>
          <div class="chud-hp-bar"><div class="chud-hp-fill" id="chud-hp-fill"></div></div>
        </div>
        <div class="chud-vitals-row chud-blood-row">
          <span class="chud-label">BLOOD</span>
          <span class="chud-blood-val" id="chud-blood-val">5000 mL</span>
          <span class="chud-blood-hits" id="chud-blood-hits">LOSSES: 0</span>
        </div>
      </div>

      <div class="chud-weapons">
        <div class="chud-slots">
          <div class="chud-slot" id="chud-slot-1">1 SCOUT</div>
          <div class="chud-slot" id="chud-slot-2">2 USP .45</div>
          <div class="chud-slot" id="chud-slot-3">3 KNIFE</div>
        </div>
        <div class="chud-ammo-box">
          <span class="chud-ammo-clip" id="chud-ammo-clip">10</span>
          <span class="chud-ammo-sep">/</span>
          <span class="chud-ammo-res" id="chud-ammo-res">90</span>
        </div>
        <div class="chud-reload-wrap hidden" id="chud-reload-wrap">
          <div class="chud-reload-fill" id="chud-reload-fill"></div>
        </div>
        <div class="chud-controls-hint">LMB Fire/Slash • RMB Scope/Silencer/Stab • G Drop • E Take • R Reload</div>
      </div>
    `;

    document.body.appendChild(this.root);

    this.scopeEl = this.root.querySelector('#chud-scope')!;
    this.hitmarkerEl = this.root.querySelector('#chud-hitmarker')!;
    this.pickupEl = this.root.querySelector('#chud-pickup')!;
    this.deathEl = this.root.querySelector('#chud-death')!;
    this.hpValueEl = this.root.querySelector('#chud-hp-val')!;
    this.hpFillEl = this.root.querySelector('#chud-hp-fill')!;
    this.bloodValueEl = this.root.querySelector('#chud-blood-val')!;
    this.bloodCountEl = this.root.querySelector('#chud-blood-hits')!;
    this.ammoClipEl = this.root.querySelector('#chud-ammo-clip')!;
    this.ammoReserveEl = this.root.querySelector('#chud-ammo-res')!;
    this.reloadBarWrapEl = this.root.querySelector('#chud-reload-wrap')!;
    this.reloadBarFillEl = this.root.querySelector('#chud-reload-fill')!;
    this.slotEls = [
      this.root.querySelector('#chud-slot-1')!,
      this.root.querySelector('#chud-slot-2')!,
      this.root.querySelector('#chud-slot-3')!,
    ];
  }

  public triggerHitMarker(isBlood: boolean, isKill: boolean): void {
    this.hitmarkerTimer = isKill ? 0.28 : 0.16;
    this.hitmarkerEl.style.setProperty(
      '--hm-color',
      isKill ? '#ef4444' : isBlood ? '#fb7185' : '#fef08a',
    );
    this.hitmarkerEl.classList.add('active');
  }

  public update(dt: number, vitals: Readonly<PlayerVitalState>, weapon: WeaponHudSnapshot): void {
    // Scope overlay
    this.scopeEl.classList.toggle('hidden', weapon.scopeZoom === 0 || vitals.dead);

    // Hitmarker decay
    if (this.hitmarkerTimer > 0) {
      this.hitmarkerTimer = Math.max(0, this.hitmarkerTimer - dt);
      if (this.hitmarkerTimer === 0) {
        this.hitmarkerEl.classList.remove('active');
      }
    }

    // Pickup prompt
    if (weapon.nearbyPickupLabel && !vitals.dead) {
      this.pickupEl.textContent = weapon.nearbyPickupLabel;
      this.pickupEl.classList.remove('hidden');
    } else {
      this.pickupEl.classList.add('hidden');
    }

    // Death overlay
    this.deathEl.classList.toggle('hidden', !vitals.dead);

    // HP & Blood
    const hpPct = Math.max(0, Math.min(100, (vitals.hp / Math.max(1, vitals.maxHp)) * 100));
    this.hpValueEl.textContent = String(vitals.hp);
    this.hpFillEl.style.width = `${hpPct}%`;
    this.hpFillEl.style.background =
      hpPct > 55 ? '#22c55e' : hpPct > 25 ? '#f59e0b' : '#ef4444';

    this.bloodValueEl.textContent = `${vitals.bloodMl} mL`;
    this.bloodCountEl.textContent = `BLEED HITS: ${vitals.bloodLossCount}`;

    // Weapon slots
    const owned = [weapon.scout.owned, weapon.usp.owned, weapon.knifeOwned];
    const labels = [
      weapon.scout.owned ? '1 SCOUT' : '1 [EMPTY]',
      weapon.usp.owned ? (weapon.usp.silenced ? '2 USP-S' : '2 USP .45') : '2 [EMPTY]',
      '3 KNIFE',
    ];
    for (let i = 0; i < 3; i++) {
      const el = this.slotEls[i];
      el.textContent = labels[i];
      el.classList.toggle('active', weapon.activeSlot === i + 1);
      el.classList.toggle('missing', !owned[i]);
    }

    // Ammo readout
    if (weapon.activeSlot === 1) {
      this.ammoClipEl.textContent = String(weapon.scout.clip);
      this.ammoReserveEl.textContent = String(weapon.scout.reserve);
    } else if (weapon.activeSlot === 2) {
      this.ammoClipEl.textContent = String(weapon.usp.clip);
      this.ammoReserveEl.textContent = String(weapon.usp.reserve);
    } else {
      this.ammoClipEl.textContent = '∞';
      this.ammoReserveEl.textContent = 'MELEE';
    }

    // Reload bar
    this.reloadBarWrapEl.classList.toggle('hidden', !weapon.reloading);
    if (weapon.reloading) {
      this.reloadBarFillEl.style.width = `${Math.round(weapon.reloadProgress * 100)}%`;
    }
  }

  private injectStyles(): void {
    if (document.getElementById('combat-hud-styles')) return;
    const style = document.createElement('style');
    style.id = 'combat-hud-styles';
    style.textContent = `
      #combat-hud-root {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 25;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        color: #f8fafc;
      }
      #combat-hud-root .hidden { display: none !important; }

      .chud-scope {
        position: fixed;
        inset: 0;
        background: radial-gradient(circle at center, transparent 34%, rgba(2,6,23,0.96) 36%);
      }
      .chud-scope-h {
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        height: 1.5px;
        background: rgba(15, 23, 42, 0.92);
      }
      .chud-scope-v {
        position: absolute;
        left: 50%;
        top: 0;
        bottom: 0;
        width: 1.5px;
        background: rgba(15, 23, 42, 0.92);
      }
      .chud-scope-ring {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 10px;
        height: 10px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        border: 1.5px solid #ef4444;
      }

      .chud-hitmarker {
        position: fixed;
        left: 50%;
        top: 50%;
        width: 22px;
        height: 22px;
        transform: translate(-50%, -50%) rotate(45deg);
        opacity: 0;
        transition: opacity 0.08s ease;
        --hm-color: #fef08a;
      }
      .chud-hitmarker.active { opacity: 1; }
      .chud-hitmarker::before,
      .chud-hitmarker::after {
        content: '';
        position: absolute;
        background: var(--hm-color);
      }
      .chud-hitmarker::before { left: 10px; top: 0; width: 2px; height: 22px; }
      .chud-hitmarker::after { top: 10px; left: 0; height: 2px; width: 22px; }

      .chud-pickup {
        position: fixed;
        left: 50%;
        bottom: 148px;
        transform: translateX(-50%);
        padding: 6px 14px;
        border-radius: 6px;
        background: rgba(15, 23, 42, 0.85);
        border: 1px solid rgba(56, 189, 248, 0.65);
        color: #e0f2fe;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
      }

      .chud-death {
        position: fixed;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(127, 29, 29, 0.42);
        backdrop-filter: blur(2px);
      }
      .chud-death-title {
        font-size: 44px;
        font-weight: 900;
        letter-spacing: 0.18em;
        color: #fecaca;
        text-shadow: 0 2px 18px rgba(0, 0, 0, 0.85);
      }
      .chud-death-sub {
        margin-top: 10px;
        font-size: 14px;
        color: #fef2f2;
      }

      .chud-vitals {
        position: fixed;
        left: 20px;
        bottom: 20px;
        background: rgba(9, 13, 21, 0.78);
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 8px;
        padding: 10px 14px;
        min-width: 240px;
      }
      .chud-vitals-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .chud-blood-row {
        margin-top: 6px;
        font-size: 11px;
        color: #fca5a5;
      }
      .chud-label {
        font-size: 11px;
        font-weight: 800;
        color: #94a3b8;
        width: 44px;
      }
      .chud-hp-val {
        font-size: 20px;
        font-weight: 900;
        min-width: 38px;
        color: #f8fafc;
      }
      .chud-hp-bar {
        flex: 1;
        height: 8px;
        background: rgba(30, 41, 59, 0.9);
        border-radius: 4px;
        overflow: hidden;
      }
      .chud-hp-fill {
        height: 100%;
        width: 100%;
        background: #22c55e;
        transition: width 0.12s ease;
      }
      .chud-blood-val { font-weight: 800; color: #f87171; }
      .chud-blood-hits { margin-left: auto; color: #fda4af; }

      .chud-weapons {
        position: fixed;
        right: 20px;
        bottom: 20px;
        background: rgba(9, 13, 21, 0.78);
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 8px;
        padding: 10px 14px;
        text-align: right;
      }
      .chud-slots {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
        margin-bottom: 6px;
      }
      .chud-slot {
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 4px;
        background: rgba(30, 41, 59, 0.75);
        color: #94a3b8;
        border: 1px solid transparent;
      }
      .chud-slot.active {
        background: rgba(249, 115, 22, 0.22);
        color: #fdba74;
        border-color: rgba(249, 115, 22, 0.75);
      }
      .chud-slot.missing { opacity: 0.35; }

      .chud-ammo-box {
        display: flex;
        align-items: baseline;
        justify-content: flex-end;
        gap: 6px;
      }
      .chud-ammo-clip { font-size: 26px; font-weight: 900; color: #f8fafc; }
      .chud-ammo-sep { font-size: 16px; color: #64748b; }
      .chud-ammo-res { font-size: 15px; font-weight: 700; color: #cbd5e1; }

      .chud-reload-wrap {
        margin-top: 6px;
        height: 4px;
        background: rgba(30, 41, 59, 0.9);
        border-radius: 2px;
        overflow: hidden;
      }
      .chud-reload-fill {
        height: 100%;
        width: 0%;
        background: #38bdf8;
      }
      .chud-controls-hint {
        margin-top: 6px;
        font-size: 10px;
        color: #94a3b8;
      }
    `;
    document.head.appendChild(style);
  }
}

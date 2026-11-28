// src/render/ViewmodelRig.ts
import * as THREE from 'three';

export class ViewmodelRig {
  public readonly root = new THREE.Group();

  private readonly scoutGroup = new THREE.Group();
  private readonly uspGroup = new THREE.Group();
  private readonly knifeGroup = new THREE.Group();
  private readonly grenadeGroup = new THREE.Group();

  private readonly uspSuppressor: THREE.Mesh;
  private readonly scoutBoltHandle: THREE.Mesh;
  private readonly scoutFlash: THREE.Mesh;
  private readonly uspFlash: THREE.Mesh;

  private readonly grenadeBodyGroup = new THREE.Group();
  private readonly grenadePinRing: THREE.Mesh;
  private readonly grenadeSpoon: THREE.Mesh;

  private activeSlot = 1;
  private scoped = false;
  private grenadeCount = 5;
  private bobPhase = 0;
  private deployTimer = 0;
  private recoilKick = 0;
  private recoilPitch = 0;
  private flashTimer = 0;
  private boltCycleTimer = 0;

  private knifeAnimTimer = 0;
  private knifeAnimDuration = 0.24;
  private knifeHeavy = false;

  private grenadeAnimTimer = 0;
  private grenadeAnimDuration = 0.62;
  private grenadeUnderhand = false;

  private reloadTimer = 0;
  private reloadDuration = 1.1;

  constructor() {
    const gunmetal = new THREE.MeshStandardMaterial({
      color: 0x262f3d,
      roughness: 0.38,
      metalness: 0.72,
    });
    const darkPolymer = new THREE.MeshStandardMaterial({
      color: 0x181e28,
      roughness: 0.78,
      metalness: 0.14,
    });
    const oliveStock = new THREE.MeshStandardMaterial({
      color: 0x3b4838,
      roughness: 0.68,
      metalness: 0.12,
    });
    const grenadeOlive = new THREE.MeshStandardMaterial({
      color: 0x3f4f2f,
      roughness: 0.56,
      metalness: 0.34,
    });
    const grenadeBandMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      emissive: 0xea580c,
      emissiveIntensity: 0.55,
      roughness: 0.32,
      metalness: 0.2,
    });
    const chromeSteel = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.22,
      metalness: 0.92,
    });
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0369a1,
      emissiveIntensity: 0.45,
      roughness: 0.1,
      metalness: 0.8,
    });
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });

    // --- Slot 1: Steyr Scout .308 ---
    const scoutStock = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.085, 0.62), oliveStock);
    scoutStock.position.set(0, -0.02, 0.06);
    this.scoutGroup.add(scoutStock);

    const scoutReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.052, 0.34), gunmetal);
    scoutReceiver.position.set(0, 0.032, -0.02);
    this.scoutGroup.add(scoutReceiver);

    const scoutBarrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.018, 0.66, 12),
      gunmetal,
    );
    scoutBarrel.rotation.x = Math.PI * 0.5;
    scoutBarrel.position.set(0, 0.036, -0.45);
    this.scoutGroup.add(scoutBarrel);

    const scopeTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.32, 14),
      darkPolymer,
    );
    scopeTube.rotation.x = Math.PI * 0.5;
    scopeTube.position.set(0, 0.095, -0.04);
    this.scoutGroup.add(scopeTube);

    const scopeBell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.029, 0.023, 0.08, 14),
      darkPolymer,
    );
    scopeBell.rotation.x = Math.PI * 0.5;
    scopeBell.position.set(0, 0.095, -0.22);
    this.scoutGroup.add(scopeBell);

    const scopeLens = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.008, 14), lensMat);
    scopeLens.rotation.x = Math.PI * 0.5;
    scopeLens.position.set(0, 0.095, 0.12);
    this.scoutGroup.add(scopeLens);

    this.scoutBoltHandle = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.014, 0.016), chromeSteel);
    this.scoutBoltHandle.position.set(0.042, 0.04, 0.07);
    this.scoutGroup.add(this.scoutBoltHandle);

    this.scoutFlash = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), flashMat);
    this.scoutFlash.position.set(0, 0.036, -0.82);
    this.scoutFlash.visible = false;
    this.scoutGroup.add(this.scoutFlash);

    this.scoutGroup.position.set(0.24, -0.22, -0.42);
    this.root.add(this.scoutGroup);

    // --- Slot 2: USP .45 Tactical ---
    const uspSlide = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.046, 0.25), gunmetal);
    uspSlide.position.set(0, 0.032, -0.05);
    this.uspGroup.add(uspSlide);

    const uspFrame = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.034, 0.23), darkPolymer);
    uspFrame.position.set(0, 0.0, -0.04);
    this.uspGroup.add(uspFrame);

    const uspGrip = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.125, 0.068), darkPolymer);
    uspGrip.position.set(0, -0.068, 0.045);
    uspGrip.rotation.x = 0.22;
    this.uspGroup.add(uspGrip);

    this.uspSuppressor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.019, 0.019, 0.22, 12),
      darkPolymer,
    );
    this.uspSuppressor.rotation.x = Math.PI * 0.5;
    this.uspSuppressor.position.set(0, 0.032, -0.28);
    this.uspGroup.add(this.uspSuppressor);

    this.uspFlash = new THREE.Mesh(new THREE.OctahedronGeometry(0.052, 0), flashMat);
    this.uspFlash.position.set(0, 0.032, -0.41);
    this.uspFlash.visible = false;
    this.uspGroup.add(this.uspFlash);

    this.uspGroup.position.set(0.21, -0.19, -0.36);
    this.uspGroup.visible = false;
    this.root.add(this.uspGroup);

    // --- Slot 3: Combat Knife ---
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.15, 10), darkPolymer);
    handle.rotation.x = Math.PI * 0.35;
    handle.position.set(0, -0.04, 0.04);
    this.knifeGroup.add(handle);

    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.018, 0.022), gunmetal);
    guard.position.set(0, 0.01, -0.01);
    this.knifeGroup.add(guard);

    const bladeGeo = new THREE.BoxGeometry(0.008, 0.036, 0.25);
    const blade = new THREE.Mesh(bladeGeo, chromeSteel);
    blade.position.set(0, 0.035, -0.14);
    blade.rotation.x = -0.14;
    this.knifeGroup.add(blade);

    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 4), chromeSteel);
    tip.rotation.x = -Math.PI * 0.5 - 0.14;
    tip.rotation.z = Math.PI * 0.25;
    tip.scale.set(0.32, 1, 1);
    tip.position.set(0, 0.056, -0.29);
    this.knifeGroup.add(tip);

    this.knifeGroup.position.set(0.23, -0.2, -0.34);
    this.knifeGroup.rotation.set(0.14, 0.24, -0.18);
    this.knifeGroup.visible = false;
    this.root.add(this.knifeGroup);

    // --- Slot 5: HE Fragmentation Grenade ---
    const grenadeHull = new THREE.Mesh(new THREE.SphereGeometry(0.054, 14, 12), grenadeOlive);
    grenadeHull.scale.set(1.0, 1.24, 1.0);
    this.grenadeBodyGroup.add(grenadeHull);

    const grenadeBand = new THREE.Mesh(new THREE.TorusGeometry(0.053, 0.0055, 8, 18), grenadeBandMat);
    grenadeBand.rotation.x = Math.PI * 0.5;
    grenadeBand.position.y = 0.008;
    this.grenadeBodyGroup.add(grenadeBand);

    const fuseCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.021, 0.032, 10),
      gunmetal,
    );
    fuseCollar.position.set(0, 0.074, 0);
    this.grenadeBodyGroup.add(fuseCollar);

    const fuseHead = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.02, 0.026), chromeSteel);
    fuseHead.position.set(0.004, 0.095, 0);
    this.grenadeBodyGroup.add(fuseHead);

    this.grenadeSpoon = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.095, 0.02), gunmetal);
    this.grenadeSpoon.position.set(0.044, 0.045, 0);
    this.grenadeSpoon.rotation.z = -0.22;
    this.grenadeBodyGroup.add(this.grenadeSpoon);

    this.grenadePinRing = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.0026, 8, 16), chromeSteel);
    this.grenadePinRing.position.set(-0.028, 0.092, 0.008);
    this.grenadePinRing.rotation.y = 0.35;
    this.grenadeBodyGroup.add(this.grenadePinRing);

    this.grenadeGroup.add(this.grenadeBodyGroup);
    this.grenadeGroup.position.set(0.22, -0.19, -0.34);
    this.grenadeGroup.rotation.set(0.12, -0.28, 0.14);
    this.grenadeGroup.visible = false;
    this.root.add(this.grenadeGroup);

    this.setActiveSlot(1);
  }

  public setActiveSlot(slot: number): void {
    this.activeSlot = slot;
    this.syncVisibility();
  }

  public setUspSilenced(silenced: boolean): void {
    this.uspSuppressor.visible = silenced;
    this.uspFlash.position.z = silenced ? -0.41 : -0.2;
  }

  public setScoped(scoped: boolean): void {
    this.scoped = scoped;
    this.syncVisibility();
  }

  public setGrenadeCount(count: number): void {
    this.grenadeCount = Math.max(0, Math.round(count));
    this.syncVisibility();
  }

  private syncVisibility(): void {
    this.scoutGroup.visible = this.activeSlot === 1 && !this.scoped;
    this.uspGroup.visible = this.activeSlot === 2;
    this.knifeGroup.visible = this.activeSlot === 3;
    this.grenadeGroup.visible =
      this.activeSlot === 5 && (this.grenadeCount > 0 || this.grenadeAnimTimer > 0);
  }

  public triggerDeploy(): void {
    this.deployTimer = 0.24;
    this.reloadTimer = 0;
    this.grenadeAnimTimer = 0;
    this.resetGrenadeParts();
    this.syncVisibility();
  }

  public triggerFire(slot: 1 | 2, silenced = false): void {
    this.recoilKick = slot === 1 ? 0.11 : 0.048;
    this.recoilPitch = slot === 1 ? 0.22 : 0.095;
    this.flashTimer = silenced ? 0.022 : 0.048;
    if (slot === 1) {
      this.boltCycleTimer = 0.72;
    }
  }

  public triggerKnifeAttack(heavy: boolean): void {
    this.knifeHeavy = heavy;
    this.knifeAnimDuration = heavy ? 0.34 : 0.2;
    this.knifeAnimTimer = this.knifeAnimDuration;
  }

  public triggerGrenadeThrow(underhand = false): void {
    this.grenadeUnderhand = underhand;
    this.grenadeAnimDuration = underhand ? 0.56 : 0.64;
    this.grenadeAnimTimer = this.grenadeAnimDuration;
    this.deployTimer = 0;
    this.syncVisibility();
  }

  public triggerReload(durationSec = 1.15): void {
    this.reloadDuration = durationSec;
    this.reloadTimer = durationSec;
  }

  private resetGrenadeParts(): void {
    this.grenadeBodyGroup.visible = true;
    this.grenadePinRing.visible = true;
    this.grenadePinRing.position.set(-0.028, 0.092, 0.008);
    this.grenadePinRing.rotation.set(0, 0.35, 0);
    this.grenadeSpoon.position.set(0.044, 0.045, 0);
    this.grenadeSpoon.rotation.set(0, 0, -0.22);
  }

  public update(
    dt: number,
    spdXY: number,
    grounded: boolean,
    strafeA: boolean,
    strafeD: boolean,
    swayX: number,
    swayY: number,
  ): void {
    // Walk bobbing & air drift
    const moveFactor = grounded ? Math.min(1, spdXY / 260) : 0.14;
    this.bobPhase += dt * (grounded ? 8.5 : 2.6);

    const bobX = Math.cos(this.bobPhase) * 0.011 * moveFactor;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * -0.014 * moveFactor;
    const strafeRoll = (strafeA ? 0.055 : 0) + (strafeD ? -0.055 : 0);

    // Decay deploy, recoil, flash, bolt cycle, reload, knife, and grenade timers
    if (this.deployTimer > 0) this.deployTimer = Math.max(0, this.deployTimer - dt);
    this.recoilKick *= Math.pow(0.00025, dt);
    this.recoilPitch *= Math.pow(0.0004, dt);

    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      const showFlash = this.flashTimer > 0 && !this.scoped;
      this.scoutFlash.visible = showFlash && this.activeSlot === 1;
      this.uspFlash.visible = showFlash && this.activeSlot === 2;
      const s = 0.75 + Math.random() * 0.55;
      this.scoutFlash.scale.setScalar(s);
      this.uspFlash.scale.setScalar(s);
      this.scoutFlash.rotation.z = Math.random() * Math.PI;
      this.uspFlash.rotation.z = Math.random() * Math.PI;
    } else {
      this.scoutFlash.visible = false;
      this.uspFlash.visible = false;
    }

    // Scout bolt-action handle motion
    if (this.boltCycleTimer > 0) {
      this.boltCycleTimer = Math.max(0, this.boltCycleTimer - dt);
      const phase = 1 - this.boltCycleTimer / 0.72;
      const pull = phase > 0.35 && phase < 0.85 ? Math.sin(((phase - 0.35) / 0.5) * Math.PI) : 0;
      this.scoutBoltHandle.position.set(0.042 + pull * 0.018, 0.04 + pull * 0.025, 0.07 + pull * 0.08);
    } else {
      this.scoutBoltHandle.position.set(0.042, 0.04, 0.07);
    }

    // Reload / grenade restock dip & tilt
    let reloadDipY = 0;
    let reloadRoll = 0;
    if (this.reloadTimer > 0) {
      this.reloadTimer = Math.max(0, this.reloadTimer - dt);
      const p = 1 - this.reloadTimer / Math.max(0.01, this.reloadDuration);
      const arc = Math.sin(p * Math.PI);
      reloadDipY = -0.14 * arc;
      reloadRoll = 0.48 * arc;
    }

    // Knife slash / heavy stab swing kinematics
    let animOffX = 0;
    let animOffY = 0;
    let animOffZ = 0;
    let animRotX = 0;
    let animRotY = 0;
    let animRotZ = 0;
    if (this.knifeAnimTimer > 0 && this.activeSlot === 3) {
      this.knifeAnimTimer = Math.max(0, this.knifeAnimTimer - dt);
      const p = 1 - this.knifeAnimTimer / Math.max(0.01, this.knifeAnimDuration);
      const swing = Math.sin(p * Math.PI);
      if (this.knifeHeavy) {
        animOffX = -0.12 * swing;
        animOffY = 0.04 * swing;
        animOffZ = -0.26 * swing;
        animRotX = -0.58 * swing;
        animRotY = 0.25 * swing;
      } else {
        animOffX = -0.24 * swing;
        animOffY = -0.05 * swing;
        animOffZ = -0.11 * swing;
        animRotY = 0.85 * swing;
        animRotZ = 0.62 * swing;
      }
    }

    // HE Grenade pin-pull -> throw follow-through -> re-draw next grenade
    if (this.grenadeAnimTimer > 0 && this.activeSlot === 5) {
      this.grenadeAnimTimer = Math.max(0, this.grenadeAnimTimer - dt);
      const p = 1 - this.grenadeAnimTimer / Math.max(0.01, this.grenadeAnimDuration);

      if (p < 0.28) {
        // Phase 1: Pull pin outward to the left and wind arm back
        const k = p / 0.28;
        const ease = Math.sin(k * Math.PI * 0.5);
        this.grenadeBodyGroup.visible = true;
        this.grenadePinRing.visible = true;
        this.grenadePinRing.position.set(-0.028 - ease * 0.09, 0.092 + ease * 0.02, 0.008 + ease * 0.02);
        this.grenadePinRing.rotation.set(0, 0.35 + ease * 0.7, ease * 0.9);
        this.grenadeSpoon.rotation.set(0, 0, -0.22 - ease * 0.14);

        if (this.grenadeUnderhand) {
          animOffY = -0.09 * ease;
          animOffZ = 0.07 * ease;
          animRotX = -0.35 * ease;
        } else {
          animOffX = 0.05 * ease;
          animOffY = 0.08 * ease;
          animOffZ = 0.11 * ease;
          animRotX = 0.52 * ease;
          animRotZ = -0.25 * ease;
        }
      } else if (p < 0.6) {
        // Phase 2: Fast forward throw release (spoon pops, grenade leaves hand)
        const k = (p - 0.28) / 0.32;
        const whip = Math.sin(k * Math.PI * 0.5);
        this.grenadePinRing.visible = false;
        this.grenadeSpoon.rotation.set(0, 0, -0.58);
        this.grenadeBodyGroup.visible = k < 0.45;

        if (this.grenadeUnderhand) {
          animOffY = -0.09 + 0.2 * whip;
          animOffZ = 0.07 - 0.28 * whip;
          animRotX = -0.35 + 0.78 * whip;
        } else {
          animOffX = 0.05 - 0.14 * whip;
          animOffY = 0.08 - 0.19 * whip;
          animOffZ = 0.11 - 0.34 * whip;
          animRotX = 0.52 - 1.18 * whip;
          animRotZ = -0.25 + 0.48 * whip;
        }
      } else {
        // Phase 3: Re-draw next grenade from below if any remain
        const k = (p - 0.6) / 0.4;
        this.resetGrenadeParts();
        this.grenadeBodyGroup.visible = this.grenadeCount > 0;
        const rise = 1 - k;
        animOffY = -0.24 * rise * rise;
        animRotX = -0.4 * rise;
      }

      if (this.grenadeAnimTimer === 0) {
        this.resetGrenadeParts();
        this.syncVisibility();
      }
    } else if (this.activeSlot === 5) {
      this.resetGrenadeParts();
    }

    const deployNorm = this.deployTimer / 0.24;
    const deployDrop = deployNorm * deployNorm * -0.24;

    this.root.position.set(
      bobX + swayX + animOffX,
      bobY + swayY + deployDrop + reloadDipY + animOffY,
      this.recoilKick + animOffZ,
    );
    this.root.rotation.set(
      this.recoilPitch - deployNorm * 0.45 + animRotX,
      swayX * 1.4 + animRotY,
      strafeRoll + reloadRoll + animRotZ,
    );
  }
}

import * as THREE from 'three';

export class ViewmodelRig {
  public readonly root = new THREE.Group();
  private readonly viewmodels: Record<number, THREE.Group>;
  private deployT = 1.0;
  private bobPhase = 0;

  constructor() {
    const gunDarkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.55 });
    const gunBodyMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.58, metalness: 0.25 });
    const gunSteelMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.28, metalness: 0.85 });
    const gunAccentMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.4, metalness: 0.65 });
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0284c7,
      emissiveIntensity: 0.6,
      roughness: 0.1,
    });
    const tritiumMat = new THREE.MeshBasicMaterial({ color: 0x4ade80 });

    // [1] Steyr Scout Sniper Rifle
    const vmScout = new THREE.Group();
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.72), gunBodyMat);
    stock.position.set(0, -0.04, 0.08);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.95, 10), gunDarkMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.45);
    const scopeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.028, 0.42, 12), gunDarkMat);
    scopeTube.rotation.x = Math.PI / 2;
    scopeTube.position.set(0, 0.11, -0.14);
    const scopeLens = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 12), lensMat);
    scopeLens.rotation.x = Math.PI / 2;
    scopeLens.position.set(0, 0.11, 0.07);
    const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.022, 0.022), gunSteelMat);
    bolt.position.set(0.06, 0.02, 0.02);
    vmScout.add(stock, barrel, scopeTube, scopeLens, bolt);
    vmScout.position.set(0.32, -0.27, -0.58);
    vmScout.rotation.set(0.03, 0.06, 0);

    // [2] USP .45 Tactical (Suppressed)
    const vmUsp = new THREE.Group();
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.34), gunDarkMat);
    slide.position.set(0, 0.03, -0.05);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.06, 0.31), gunBodyMat);
    frame.position.set(0, -0.03, -0.03);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.21, 0.095), gunBodyMat);
    grip.position.set(0, -0.13, 0.08);
    grip.rotation.x = 0.24;
    const suppressor = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.34, 12), gunDarkMat);
    suppressor.rotation.x = Math.PI / 2;
    suppressor.position.set(0, 0.035, -0.38);
    const sightL = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.012), tritiumMat);
    sightL.position.set(-0.022, 0.08, 0.1);
    const sightR = sightL.clone();
    sightR.position.x = 0.022;
    vmUsp.add(slide, frame, grip, suppressor, sightL, sightR);
    vmUsp.position.set(0.28, -0.25, -0.55);
    vmUsp.rotation.set(0.02, 0.08, 0);
    vmUsp.visible = false;

    // [3] CS 1.6 Combat Knife
    const vmKnife = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.024, 0.24, 8), gunDarkMat);
    handle.position.set(0, -0.12, 0);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.022, 0.04), gunAccentMat);
    guard.position.set(0, 0.0, 0);
    const bladeGeo = new THREE.ConeGeometry(0.042, 0.38, 4);
    bladeGeo.scale(0.32, 1.0, 1.0);
    const blade = new THREE.Mesh(bladeGeo, gunSteelMat);
    blade.position.set(0, 0.19, 0.005);
    vmKnife.add(handle, guard, blade);
    vmKnife.position.set(0.3, -0.24, -0.54);
    vmKnife.rotation.set(-0.72, 0.35, 0.42);
    vmKnife.visible = false;

    this.viewmodels = { 1: vmScout, 2: vmUsp, 3: vmKnife };
    this.root.add(vmScout, vmUsp, vmKnife);
  }

  public triggerDeploy(): void {
    this.deployT = 0.0;
  }

  public setActiveSlot(slot: number): void {
    for (const k of [1, 2, 3]) {
      this.viewmodels[k].visible = k === slot;
    }
  }

  public update(
    dtSec: number,
    spdXY: number,
    grounded: boolean,
    keyA: boolean,
    keyD: boolean,
    swayX: number,
    swayY: number,
  ): void {
    this.deployT = Math.min(1.0, this.deployT + dtSec * 4.5);
    const deployDrop = (1 - this.deployT) * (1 - this.deployT) * 0.24;

    let bobX = 0;
    let bobY = 0;
    if (grounded && spdXY > 15) {
      this.bobPhase += dtSec * Math.min(13, 6 + spdXY * 0.025);
      const amp = Math.min(1, spdXY / 250) * 0.015;
      bobX = Math.cos(this.bobPhase) * amp;
      bobY = Math.abs(Math.sin(this.bobPhase)) * amp * 0.85;
    }

    const strafeTilt = ((keyA ? 1 : 0) - (keyD ? 1 : 0)) * (grounded ? 0.02 : 0.055);
    this.root.position.set(swayX + bobX, swayY - bobY - deployDrop, 0);
    this.root.rotation.z = THREE.MathUtils.lerp(this.root.rotation.z, strafeTilt, Math.min(1, dtSec * 10));
  }
}

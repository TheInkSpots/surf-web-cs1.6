// src/render/TeammateNameplates.ts
import * as THREE from 'three';
import { FL_DUCKING, HULL_DUCK, HULL_STAND } from '../core/constants';
import {
  ACTOR_F32_BASE_INDEX,
  ACTOR_F32_STRIDE,
  ACTOR_I32_BASE_INDEX,
  ACTOR_I32_STRIDE,
  ActorF32,
  ActorI32,
  MAX_ACTORS,
  PhysicsMemoryAbi,
  TeamId,
} from '../core/memoryAbi';

export class TeammateNameplates {
  private readonly group = new THREE.Group();
  private readonly sprites = new Map<number, { sprite: THREE.Sprite; label: string }>();

  constructor(scene: THREE.Scene) {
    this.group.name = 'teammate-nameplates';
    scene.add(this.group);
  }

  /** Sync every frame after physics interpolation */
  public sync(
    abi: PhysicsMemoryAbi,
    actorNames: readonly string[],
    localActorId = 0,
  ): void {
    const f32Arr = abi.f32;
    const i32Arr = abi.i32;
    const localTeam =
      i32Arr[ACTOR_I32_BASE_INDEX + localActorId * ACTOR_I32_STRIDE + ActorI32.TEAM];

    for (let id = 0; id < MAX_ACTORS; id++) {
      const idxI = ACTOR_I32_BASE_INDEX + id * ACTOR_I32_STRIDE;
      const active = i32Arr[idxI + ActorI32.ACTIVE] === 1;
      const alive = i32Arr[idxI + ActorI32.ALIVE] === 1;
      const team = i32Arr[idxI + ActorI32.TEAM];
      const isTeammate = id !== localActorId && active && alive && team !== TeamId.SPEC && team === localTeam;

      const existing = this.sprites.get(id);
      if (!isTeammate) {
        if (existing) existing.sprite.visible = false;
        continue;
      }

      const name = actorNames[id] || `BOT ${id}`;
      const entry = this.getOrCreateSprite(id, name);
      entry.sprite.visible = true;

      const idxF = ACTOR_F32_BASE_INDEX + id * ACTOR_F32_STRIDE;
      const ducking = (i32Arr[idxI + ActorI32.FLAGS] & FL_DUCKING) !== 0;
      const halfZ = ducking ? HULL_DUCK.hz : HULL_STAND.hz;

      const gx = f32Arr[idxF + ActorF32.POS_X];
      const gy = f32Arr[idxF + ActorF32.POS_Y];
      const headZ = f32Arr[idxF + ActorF32.POS_Z] + halfZ + 14;

      // GoldSrc Z-up (x, y, z) -> Three.js Y-up (x, z, -y)
      entry.sprite.position.set(gx, headZ, -gy);
    }
  }

  private getOrCreateSprite(actorId: number, name: string): { sprite: THREE.Sprite; label: string } {
    const existing = this.sprites.get(actorId);
    if (existing && existing.label === name) return existing;
    if (existing) {
      this.group.remove(existing.sprite);
      existing.sprite.material.map?.dispose();
      existing.sprite.material.dispose();
    }

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '700 26px "JetBrains Mono", monospace';
    const textW = Math.min(232, ctx.measureText(name).width);
    const pillW = textW + 24;
    const pillX = (canvas.width - pillW) * 0.5;

    ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(pillX, 12, pillW, 40, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#4ade80'; // Bright green teammate display name
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, canvas.width * 0.5, 33);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false, // Visible over teammate head cleanly; set true to occlude behind walls
      depthWrite: false,
    });

    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(42, 10.5, 1);
    sprite.renderOrder = 20;
    this.group.add(sprite);

    const created = { sprite, label: name };
    this.sprites.set(actorId, created);
    return created;
  }

  public dispose(): void {
    for (const { sprite } of this.sprites.values()) {
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    this.sprites.clear();
    this.group.clear();
    this.group.removeFromParent();
  }
}

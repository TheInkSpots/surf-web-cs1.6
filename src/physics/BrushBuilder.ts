import { f32 } from '../core/constants';

export type Vec3Tuple = [number, number, number];
export type BrushStyle = 'slate' | 'ramp' | 'steep' | 'walkable' | 'booster' | 'finish';
export type TriggerType = 'start' | 'end' | 'push' | 'teleport';

export interface BrushPlane {
  nx: number;
  ny: number;
  nz: number;
  d: number;
}

export interface RenderFace extends BrushPlane {
  verts: Vec3Tuple[];
}

export interface ConvexBrush {
  id: string;
  style: BrushStyle;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  planes: BrushPlane[];
  renderFaces: RenderFace[];
}

export interface SurfRampOptions {
  start: Vec3Tuple;
  end: Vec3Tuple;
  angleDeg?: number;
  height?: number;
  topWidth?: number;
  sides?: 'both' | 'left' | 'right';
  style?: BrushStyle;
}

export interface PushTriggerMeta {
  mode: 'hybrid';
  dirX: number;
  dirY: number;
  dirZ: number;
  addSpeed: number;
  minSpeedXY: number;
  minVelZ: number;
}

export interface TeleportTriggerMeta {
  dest: { x: number; y: number; z: number; yaw: number; pitch: number };
}

export interface TriggerVolume {
  id: string;
  type: TriggerType;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  meta: Partial<PushTriggerMeta & TeleportTriggerMeta>;
}

export class BrushBuilder {
  public readonly brushes: ConvexBrush[] = [];
  public readonly triggers: TriggerVolume[] = [];

  private makePlaneFromFace(verts: Vec3Tuple[], centroid: Vec3Tuple): RenderFace | null {
    const a = verts[0];
    const b = verts[1];
    const c = verts[2];

    const e1x = b[0] - a[0];
    const e1y = b[1] - a[1];
    const e1z = b[2] - a[2];
    const e2x = c[0] - a[0];
    const e2y = c[1] - a[1];
    const e2z = c[2] - a[2];

    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) return null;

    nx /= len;
    ny /= len;
    nz /= len;
    let d = nx * a[0] + ny * a[1] + nz * a[2];

    // Ensure outward normal: centroid must satisfy dot(n, centroid) < d
    const cDot = nx * centroid[0] + ny * centroid[1] + nz * centroid[2];
    let flipped = false;
    if (cDot > d) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
      d = -d;
      flipped = true;
    }

    return {
      nx: f32(nx),
      ny: f32(ny),
      nz: f32(nz),
      d: f32(d),
      verts: flipped ? [...verts].reverse() : verts,
    };
  }

  public addConvexBrush(id: string, faces: Vec3Tuple[][], style: BrushStyle = 'slate'): ConvexBrush {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let count = 0;

    for (const f of faces) {
      for (const v of f) {
        if (v[0] < minX) minX = v[0];
        if (v[1] < minY) minY = v[1];
        if (v[2] < minZ) minZ = v[2];
        if (v[0] > maxX) maxX = v[0];
        if (v[1] > maxY) maxY = v[1];
        if (v[2] > maxZ) maxZ = v[2];
        cx += v[0];
        cy += v[1];
        cz += v[2];
        count++;
      }
    }

    const centroid: Vec3Tuple = [cx / count, cy / count, cz / count];
    const planes: BrushPlane[] = [];
    const renderFaces: RenderFace[] = [];

    for (const f of faces) {
      const p = this.makePlaneFromFace(f, centroid);
      if (!p) continue;
      planes.push({ nx: p.nx, ny: p.ny, nz: p.nz, d: p.d });
      renderFaces.push(p);
    }

    const brush: ConvexBrush = {
      id,
      style,
      minX: f32(minX),
      minY: f32(minY),
      minZ: f32(minZ),
      maxX: f32(maxX),
      maxY: f32(maxY),
      maxZ: f32(maxZ),
      planes,
      renderFaces,
    };

    this.brushes.push(brush);
    return brush;
  }

  public addBoxBrush(
    id: string,
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    style: BrushStyle = 'slate',
  ): ConvexBrush {
    const p000: Vec3Tuple = [minX, minY, minZ];
    const p100: Vec3Tuple = [maxX, minY, minZ];
    const p110: Vec3Tuple = [maxX, maxY, minZ];
    const p010: Vec3Tuple = [minX, maxY, minZ];
    const p001: Vec3Tuple = [minX, minY, maxZ];
    const p101: Vec3Tuple = [maxX, minY, maxZ];
    const p111: Vec3Tuple = [maxX, maxY, maxZ];
    const p011: Vec3Tuple = [minX, maxY, maxZ];

    const faces: Vec3Tuple[][] = [
      [p001, p101, p111, p011], // +Z top
      [p000, p010, p110, p100], // -Z bottom
      [p100, p110, p111, p101], // +X
      [p000, p001, p011, p010], // -X
      [p010, p011, p111, p110], // +Y
      [p000, p100, p101, p001], // -Y
    ];

    return this.addConvexBrush(id, faces, style);
  }

  public addSurfRampBrush(id: string, opts: SurfRampOptions): ConvexBrush {
    const {
      start,
      end,
      angleDeg = 52,
      height = 300,
      topWidth = 22,
      sides = 'both',
      style = 'ramp',
    } = opts;

    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const horizLen = Math.hypot(dx, dy);
    const dirX = dx / horizLen;
    const dirY = dy / horizLen;

    // Unit left vector in GoldSrc Z-up: (-dirY, dirX, 0)
    const leftX = -dirY;
    const leftY = dirX;

    const rad = (angleDeg * Math.PI) / 180;
    const run = height / Math.tan(rad);
    const halfTop = topWidth * 0.5;

    const leftReach = sides === 'both' || sides === 'left' ? halfTop + run : halfTop;
    const rightReach = sides === 'both' || sides === 'right' ? halfTop + run : halfTop;

    const sTL: Vec3Tuple = [start[0] + leftX * halfTop, start[1] + leftY * halfTop, start[2]];
    const sTR: Vec3Tuple = [start[0] - leftX * halfTop, start[1] - leftY * halfTop, start[2]];
    const sBL: Vec3Tuple = [start[0] + leftX * leftReach, start[1] + leftY * leftReach, start[2] - height];
    const sBR: Vec3Tuple = [start[0] - leftX * rightReach, start[1] - leftY * rightReach, start[2] - height];

    const eTL: Vec3Tuple = [end[0] + leftX * halfTop, end[1] + leftY * halfTop, end[2]];
    const eTR: Vec3Tuple = [end[0] - leftX * halfTop, end[1] - leftY * halfTop, end[2]];
    const eBL: Vec3Tuple = [end[0] + leftX * leftReach, end[1] + leftY * leftReach, end[2] - height];
    const eBR: Vec3Tuple = [end[0] - leftX * rightReach, end[1] - leftY * rightReach, end[2] - height];

    const faces: Vec3Tuple[][] = [
      [sTL, sTR, eTR, eTL], // Top spine
      [sBL, eBL, eBR, sBR], // Bottom flat
      [sTL, eTL, eBL, sBL], // Left sloped face
      [sTR, sBR, eBR, eTR], // Right sloped face
      [sTL, sBL, sBR, sTR], // Start cap
      [eTL, eTR, eBR, eBL], // End cap
    ];

    return this.addConvexBrush(id, faces, style);
  }

  public addTrigger(
    id: string,
    type: TriggerType,
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    meta: Partial<PushTriggerMeta & TeleportTriggerMeta> = {},
  ): TriggerVolume {
    const trigger: TriggerVolume = {
      id,
      type,
      minX: f32(minX),
      minY: f32(minY),
      minZ: f32(minZ),
      maxX: f32(maxX),
      maxY: f32(maxY),
      maxZ: f32(maxZ),
      meta,
    };
    this.triggers.push(trigger);
    return trigger;
  }
}

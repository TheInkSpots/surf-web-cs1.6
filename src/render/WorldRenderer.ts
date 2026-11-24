import * as THREE from 'three';
import { SURF_NORMAL_Z } from '../core/constants';
import { gsToThree } from '../core/coordinates';
import { ConvexBrush, TriggerVolume } from '../physics/BrushBuilder';
import { SourceRigidBody, Vec3 } from '../physics/GoldSrcPhysicsEngine';
import { WorldSign } from '../maps/surfSandbox01';
import { makeDevGridTexture, makeHazardTexture } from './textures';

interface ExplosionFx {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  duration: number;
  maxRadius: number;
}

export class WorldRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly vmScene = new THREE.Scene();
  private readonly vmCamera: THREE.PerspectiveCamera;
  private readonly boosterTex: THREE.CanvasTexture;
  private readonly rigidBodyMat: THREE.MeshStandardMaterial;
  private readonly rigidBodyEdgeMat: THREE.LineBasicMaterial;
  private readonly rigidBodyMeshes = new Map<string, THREE.Mesh>();
  private readonly seenRigidBodyIds = new Set<string>();
  private readonly explosionGeo = new THREE.SphereGeometry(1, 20, 14);
  private readonly explosionEffects: ExplosionFx[] = [];

  public readonly debugGroup = new THREE.Group();
  public baseFov = 90;

  private currentFov = 90;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();

  constructor(
    canvas: HTMLCanvasElement,
    brushes: ConvexBrush[],
    triggers: TriggerVolume[],
    signs: WorldSign[],
    vmRoot: THREE.Group,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene.fog = new THREE.FogExp2(0x0c1322, 0.000085);

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 2, 32000);
    this.camera.up.set(0, 1, 0);

    this.vmCamera = new THREE.PerspectiveCamera(62, aspect, 0.05, 20);
    this.vmScene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.25));
    const vmKeyLight = new THREE.DirectionalLight(0xfff7ed, 1.4);
    vmKeyLight.position.set(2, 4, 3);
    this.vmScene.add(vmKeyLight);
    this.vmScene.add(vmRoot);

    // Map lighting
    this.scene.add(new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.85));
    const sunLight = new THREE.DirectionalLight(0xfffbeb, 1.35);
    sunLight.position.set(2800, 4600, 1900);
    this.scene.add(sunLight);
    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.42);
    fillLight.position.set(-2200, 1400, -2600);
    this.scene.add(fillLight);

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.boosterTex = makeDevGridTexture(
      '#083344',
      '#22d3ee',
      'rgba(34,211,238,0.25)',
      'rgba(103,232,249,0.9)',
      maxAniso,
      '',
      true,
    );

    this.rigidBodyMat = new THREE.MeshStandardMaterial({
      map: makeDevGridTexture(
        '#3b2f1e',
        '#f59e0b',
        'rgba(251,191,36,0.22)',
        '#fbbf24',
        maxAniso,
        'PHYS',
      ),
      roughness: 0.5,
      metalness: 0.22,
    });
    this.rigidBodyEdgeMat = new THREE.LineBasicMaterial({
      color: 0xfcd34d,
      transparent: true,
      opacity: 0.65,
    });

    const mats: Record<string, THREE.MeshStandardMaterial> = {
      slate: new THREE.MeshStandardMaterial({
        map: makeDevGridTexture('#1e2634', '#475569', 'rgba(148,163,184,0.12)', '#64748b', maxAniso, '64'),
        roughness: 0.72,
        metalness: 0.12,
      }),
      rampFace: new THREE.MeshStandardMaterial({
        map: makeDevGridTexture('#c2590c', '#fed7aa', 'rgba(255,237,213,0.18)', '#fbbf24', maxAniso, 'SURF'),
        roughness: 0.42,
        metalness: 0.14,
      }),
      steepFace: new THREE.MeshStandardMaterial({
        map: makeDevGridTexture('#b91c1c', '#fecaca', 'rgba(254,202,202,0.18)', '#fb923c', maxAniso, '60°'),
        roughness: 0.38,
        metalness: 0.16,
      }),
      walkable: new THREE.MeshStandardMaterial({
        map: makeDevGridTexture('#0f766e', '#99f6e4', 'rgba(153,246,228,0.18)', '#2dd4bf', maxAniso, '30°'),
        roughness: 0.55,
        metalness: 0.1,
      }),
      booster: new THREE.MeshStandardMaterial({
        map: this.boosterTex,
        emissive: 0x0891b2,
        emissiveIntensity: 0.65,
        roughness: 0.25,
        metalness: 0.2,
      }),
      finish: new THREE.MeshStandardMaterial({
        map: makeDevGridTexture('#065f46', '#6ee7b7', 'rgba(110,231,183,0.2)', '#34d399', maxAniso, 'FIN'),
        emissive: 0x059669,
        emissiveIntensity: 0.35,
        roughness: 0.45,
        metalness: 0.15,
      }),
    };

    this.debugGroup.visible = false;
    this.scene.add(this.debugGroup);

    this.buildSkyDome();
    this.buildVisualWorld(brushes, triggers, mats);
    this.buildWorldSigns(signs);

    window.addEventListener('resize', this.handleResize);
  }

  public setDebugVisible(visible: boolean): void {
    this.debugGroup.visible = visible;
  }

  public spawnExplosionEffect(origin: Vec3, radius: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.48,
      wireframe: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.explosionGeo, mat);
    gsToThree(origin.x, origin.y, origin.z, mesh.position);
    mesh.scale.setScalar(12);
    this.scene.add(mesh);

    this.explosionEffects.push({
      mesh,
      mat,
      age: 0,
      duration: 0.36,
      maxRadius: Math.max(120, radius * 0.55),
    });
  }

  public syncRigidBodies(bodies: readonly SourceRigidBody[]): void {
    this.seenRigidBodyIds.clear();

    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      this.seenRigidBodyIds.add(b.id);

      let mesh = this.rigidBodyMeshes.get(b.id);
      if (!mesh) {
        const geo = new THREE.BoxGeometry(b.hx * 2, b.hz * 2, b.hy * 2);
        mesh = new THREE.Mesh(geo, this.rigidBodyMat);

        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.rigidBodyEdgeMat);
        mesh.add(edges);

        this.scene.add(mesh);
        this.rigidBodyMeshes.set(b.id, mesh);
      }

      gsToThree(b.pos.x, b.pos.y, b.pos.z, mesh.position);
      mesh.quaternion.set(b.quat.x, b.quat.z, -b.quat.y, b.quat.w);
    }

    for (const [id, mesh] of this.rigidBodyMeshes.entries()) {
      if (!this.seenRigidBodyIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        for (const child of mesh.children) {
          if (child instanceof THREE.LineSegments) {
            child.geometry.dispose();
          }
        }
        this.rigidBodyMeshes.delete(id);
      }
    }
  }

  public update(
    frameDt: number,
    rx: number,
    ry: number,
    eyeZ: number,
    renderYaw: number,
    renderPitch: number,
    spdXY: number,
  ): void {
    this.boosterTex.offset.y -= frameDt * 1.45;

    // Advance expanding shockwave spheres
    for (let i = this.explosionEffects.length - 1; i >= 0; i--) {
      const fx = this.explosionEffects[i];
      fx.age += frameDt;
      const t = fx.age / fx.duration;
      if (t >= 1) {
        this.scene.remove(fx.mesh);
        fx.mat.dispose();
        this.explosionEffects.splice(i, 1);
      } else {
        const eased = 1 - (1 - t) * (1 - t);
        fx.mesh.scale.setScalar(12 + eased * fx.maxRadius);
        fx.mat.opacity = (1 - t) * 0.48;
      }
    }

    const cosP = Math.cos(renderPitch);
    const fwdX = cosP * Math.cos(renderYaw);
    const fwdY = cosP * Math.sin(renderYaw);
    const fwdZ = Math.sin(renderPitch);

    gsToThree(rx, ry, eyeZ, this.camPos);
    gsToThree(rx + fwdX * 100, ry + fwdY * 100, eyeZ + fwdZ * 100, this.camLook);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    const fovBoost = THREE.MathUtils.clamp((spdXY - 450) / 2550, 0, 1) * 22.0;
    const targetFov = this.baseFov + fovBoost;
    if (Math.abs(this.currentFov - targetFov) > 0.02) {
      this.currentFov = THREE.MathUtils.lerp(this.currentFov, targetFov, Math.min(1, frameDt * 7.5));
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }
  }

  public render(): void {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
  }

  private handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  private buildSkyDome(): void {
    const skyGeo = new THREE.SphereGeometry(24000, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x070b14) },
        midColor: { value: new THREE.Color(0x162944) },
        horizonColor: { value: new THREE.Color(0x2d3a4b) },
        bottomColor: { value: new THREE.Color(0x080a10) },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 horizonColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPos;
        void main() {
          float h = normalize(vWorldPos).y;
          vec3 col = h >= 0.0
            ? mix(horizonColor, mix(midColor, topColor, smoothstep(0.08, 0.65, h)), smoothstep(0.0, 0.25, h))
            : mix(horizonColor, bottomColor, smoothstep(0.0, -0.35, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));
  }

  private buildVisualWorld(
    brushes: ConvexBrush[],
    triggers: TriggerVolume[],
    mats: Record<string, THREE.MeshStandardMaterial>,
  ): void {
    const tileScale = 1 / 128;

    for (const brush of brushes) {
      const buckets = new Map<string, { pos: number[]; norm: number[]; uv: number[] }>();

      for (const face of brush.renderFaces) {
        const isSurfSlope = face.nz > 0.05 && face.nz < SURF_NORMAL_Z;
        let matKey = 'slate';
        if (brush.style === 'booster') matKey = 'booster';
        else if (brush.style === 'finish') matKey = 'finish';
        else if (brush.style === 'walkable' && face.nz > 0.4 && face.nz < 0.98) matKey = 'walkable';
        else if (brush.style === 'steep' && isSurfSlope) matKey = 'steepFace';
        else if (brush.style === 'ramp' && isSurfSlope) matKey = 'rampFace';

        if (!buckets.has(matKey)) {
          buckets.set(matKey, { pos: [], norm: [], uv: [] });
        }
        const b = buckets.get(matKey)!;

        const n3 = new THREE.Vector3(face.nx, face.nz, -face.ny).normalize();
        const upRef = Math.abs(n3.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const uAxis = new THREE.Vector3().crossVectors(upRef, n3).normalize();
        const vAxis = new THREE.Vector3().crossVectors(n3, uAxis).normalize();

        const vs = face.verts;
        for (let i = 1; i < vs.length - 1; i++) {
          const tri = [vs[0], vs[i], vs[i + 1]];
          for (const v of tri) {
            const tx = v[0];
            const ty = v[2];
            const tz = -v[1];
            b.pos.push(tx, ty, tz);
            b.norm.push(n3.x, n3.y, n3.z);
            b.uv.push(
              (tx * uAxis.x + ty * uAxis.y + tz * uAxis.z) * tileScale,
              (tx * vAxis.x + ty * vAxis.y + tz * vAxis.z) * tileScale,
            );
          }
        }
      }

      for (const [matKey, data] of buckets.entries()) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.norm, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
        this.scene.add(new THREE.Mesh(geo, mats[matKey]));

        const edges = new THREE.EdgesGeometry(geo, 24);
        const edgeColor =
          matKey === 'rampFace' ? 0xfdba74 : matKey === 'booster' ? 0x67e8f9 : 0x475569;
        this.scene.add(
          new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.35 }),
          ),
        );

        this.debugGroup.add(
          new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.9 }),
          ),
        );
      }
    }

    // Expanded hazard-striped fail floor below the 4-stage course (Z = -200)
    const failGeo = new THREE.PlaneGeometry(24000, 18000);
    failGeo.rotateX(-Math.PI / 2);
    const failMat = new THREE.MeshBasicMaterial({
      map: makeHazardTexture(),
      transparent: true,
      opacity: 0.72,
    });
    const failMesh = new THREE.Mesh(failGeo, failMat);
    failMesh.position.set(6500, -200, 250);
    this.scene.add(failMesh);

    // Diegetic trigger fields + Mapper Debug Trigger Volumes (F2)
    for (const trig of triggers) {
      const sx = trig.maxX - trig.minX;
      const sy = trig.maxY - trig.minY;
      const sz = trig.maxZ - trig.minZ;
      const cx = (trig.minX + trig.maxX) * 0.5;
      const cy = (trig.minY + trig.maxY) * 0.5;
      const cz = (trig.minZ + trig.maxZ) * 0.5;

      const boxGeo = new THREE.BoxGeometry(sx, sz, sy);
      const posThree = gsToThree(cx, cy, cz);

      if (trig.type === 'start') {
        const gate = new THREE.Mesh(
          boxGeo,
          new THREE.MeshBasicMaterial({
            color: 0x10b981,
            transparent: true,
            opacity: 0.14,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        gate.position.copy(posThree);
        this.scene.add(gate);
      } else if (trig.type === 'push') {
        const boostField = new THREE.Mesh(
          boxGeo,
          new THREE.MeshBasicMaterial({
            color: 0x22d3ee,
            transparent: true,
            opacity: 0.12,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        boostField.position.copy(posThree);
        this.scene.add(boostField);

        const wire = new THREE.LineSegments(
          new THREE.EdgesGeometry(boxGeo),
          new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55 }),
        );
        wire.position.copy(posThree);
        this.scene.add(wire);
      } else if (trig.type === 'explosion') {
        const blastField = new THREE.Mesh(
          boxGeo,
          new THREE.MeshBasicMaterial({
            color: 0xf97316,
            transparent: true,
            opacity: 0.14,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        blastField.position.copy(posThree);
        this.scene.add(blastField);

        const wire = new THREE.LineSegments(
          new THREE.EdgesGeometry(boxGeo),
          new THREE.LineBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.7 }),
        );
        wire.position.copy(posThree);
        this.scene.add(wire);
      } else if (trig.type === 'end') {
        const endField = new THREE.Mesh(
          boxGeo,
          new THREE.MeshBasicMaterial({
            color: 0x34d399,
            transparent: true,
            opacity: 0.12,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        endField.position.copy(posThree);
        this.scene.add(endField);
      }

      const dbgColors: Record<string, number> = {
        start: 0x10b981,
        end: 0x4ade80,
        push: 0x22d3ee,
        explosion: 0xf97316,
        teleport: 0xf43f5e,
      };
      const col = dbgColors[trig.type] ?? 0xffffff;
      const dbgMesh = new THREE.Mesh(
        boxGeo,
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: trig.type === 'teleport' ? 0.12 : 0.28,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      dbgMesh.position.copy(posThree);
      this.debugGroup.add(dbgMesh);

      const dbgEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(boxGeo),
        new THREE.LineBasicMaterial({ color: col }),
      );
      dbgEdges.position.copy(posThree);
      this.debugGroup.add(dbgEdges);
    }

    // Distant parallax monolith pillars spanning Stages 1-4
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x131c2e, roughness: 0.9, metalness: 0.1 });
    const pillarCoords: Array<[number, number]> = [
      [900, 1200],
      [2300, -1450],
      [3700, 900],
      [4900, -1650],
      [6600, -900],
      [5600, 1750],
      [8200, 500],
      [7400, 3200],
      [10400, 5100],
      [13600, 3200],
      [13900, -200],
      [10800, -1400],
      [13400, -3400],
      [8200, -5600],
    ];
    for (const [px, py] of pillarCoords) {
      const pMesh = new THREE.Mesh(new THREE.BoxGeometry(220, 3000, 220), pillarMat);
      pMesh.position.copy(gsToThree(px, py, 500));
      this.scene.add(pMesh);
    }
  }

  private buildWorldSigns(signs: WorldSign[]): void {
    for (const s of signs) {
      const c = document.createElement('canvas');
      c.width = 760;
      c.height = 112;
      const g = c.getContext('2d')!;
      g.fillStyle = 'rgba(9, 13, 21, 0.84)';
      g.fillRect(6, 6, 748, 100);
      g.strokeStyle = s.color;
      g.lineWidth = 5;
      g.strokeRect(6, 6, 748, 100);
      g.fillStyle = s.color;
      g.font = '800 28px JetBrains Mono, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(s.text, 380, 58);

      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
      const geo = new THREE.PlaneGeometry(320 * s.scale, 49 * s.scale);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(gsToThree(s.x, s.y, s.z));
      mesh.rotation.y = s.yaw - Math.PI * 0.5;
      this.scene.add(mesh);
    }
  }
}

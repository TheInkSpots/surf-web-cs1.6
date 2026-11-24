add all the source engine physics math to GoldSrcPhysicsEngine.ts:
Source Engine physics is split into two distinct mathematical systems: **deterministic player movement** (`CGameMovement`, inherited from QuakeWorld and GoldSrc) and **rigid-body dynamics** (`VPhysics`, powered by a modified Havok solver).

---

## 1. Coordinate System & Wish Direction

Source uses a right-handed, Z-up coordinate system ($+X$ forward, $+Y$ left, $+Z$ up) measured in Hammer units ($1\text{ unit} \approx 1.905\text{ cm}$ or $0.75\text{ inches}$).

### View Basis Vectors (`AngleVectors`)

Given Euler view angles—pitch $\theta$ (positive looks downward), yaw $\psi$, and roll $\phi$:

$$\mathbf{f} = \begin{bmatrix} \cos\theta\cos\psi \\ \cos\theta\sin\psi \\ -\sin\theta \end{bmatrix}, \quad \mathbf{r} = \begin{bmatrix} -\sin\phi\sin\theta\cos\psi + \cos\phi\sin\psi \\ -\sin\phi\sin\theta\sin\psi - \cos\phi\cos\psi \\ -\sin\phi\cos\theta \end{bmatrix}$$

### Wish Velocity & Wish Direction

Player movement inputs ($f_{\text{move}}$ forward/back, $s_{\text{move}}$ left/right) are projected onto the horizontal plane ($z = 0$) and normalized:

$$\mathbf{f}_{xy} = \frac{(f_x, f_y, 0)}{\sqrt{f_x^2 + f_y^2}}, \quad \mathbf{r}_{xy} = \frac{(r_x, r_y, 0)}{\sqrt{r_x^2 + r_y^2}}$$

$$\mathbf{w} = f_{\text{move}}\,\mathbf{f}_{xy} + s_{\text{move}}\,\mathbf{r}_{xy}$$

$$v_{\text{wish}} = \min\left(\Vert{}\mathbf{w}\Vert{},\; v_{\text{max}}\right), \quad \hat{\mathbf{w}} = \frac{\mathbf{w}}{\Vert{}\mathbf{w}\Vert{}}$$

---

## 2. Player Movement Physics (`CGameMovement`)

Player physics updates once per server tick ($\Delta t = \frac{1}{\text{tickrate}}$, typically $\frac{1}{66}\text{ s}$ or $\frac{1}{128}\text{ s}$).

### Ground Friction (`Friction`)

Applied prior to ground acceleration when the player is on a walkable surface:

$$v_{\text{horiz}} = \sqrt{v_x^2 + v_y^2}$$

$$\text{control} = \max(v_{\text{horiz}},\; v_{\text{stop}})$$

$$v_{\text{drop}} = \text{control} \cdot k_{\text{friction}} \cdot \mu_{\text{surface}} \cdot \Delta t$$

$$\mathbf{v}' = \mathbf{v} \cdot \frac{\max(v_{\text{horiz}} - v_{\text{drop}},\; 0)}{v_{\text{horiz}}}$$

* $v_{\text{stop}}$: `sv_stopspeed` (minimum velocity threshold for linear vs. exponential decay).
* $k_{\text{friction}}$: `sv_friction`.
* $\mu_{\text{surface}}$: Surface friction multiplier (typically $1.0$; lower on ice/slick surfaces).

### Ground Acceleration (`Accelerate`)

Acceleration is capped by projecting current velocity $\mathbf{v}$ onto the desired unit direction $\hat{\mathbf{w}}$:

$$v_{\text{proj}} = \mathbf{v} \cdot \hat{\mathbf{w}}$$

$$v_{\text{add}} = v_{\text{wish}} - v_{\text{proj}}$$

If $v_{\text{add}} \le 0$, no acceleration is applied. Otherwise:

$$v_{\text{accel}} = \min\left(a \cdot \Delta t \cdot v_{\text{wish}} \cdot \mu_{\text{surface}},\; v_{\text{add}}\right)$$

$$\mathbf{v}' = \mathbf{v} + v_{\text{accel}}\,\hat{\mathbf{w}}$$

### Air Acceleration & Air Strafing (`AirAccelerate`)

In mid-air, `addspeed` caps $v_{\text{wish}}$ at $30\text{ u/s}$, while `accelspeed` still multiplies by the uncapped $v_{\text{wish}}$:

$$v_{\text{cap}} = \min(v_{\text{wish}},\; 30)$$

$$v_{\text{add}} = v_{\text{cap}} - (\mathbf{v} \cdot \hat{\mathbf{w}})$$

$$v_{\text{accel}} = \min\left(a_{\text{air}} \cdot \Delta t \cdot v_{\text{wish}} \cdot \mu_{\text{surface}},\; v_{\text{add}}\right)$$

$$\mathbf{v}' = \mathbf{v} + v_{\text{accel}}\,\hat{\mathbf{w}}$$

**Why Air Strafing Gains Speed:** Because the speed limit applies only to the dot product $\mathbf{v} \cdot \hat{\mathbf{w}}$, turning the view so $\hat{\mathbf{w}}$ is nearly perpendicular to $\mathbf{v}$ keeps $\mathbf{v} \cdot \hat{\mathbf{w}} \approx 0$. This yields $v_{\text{add}} \approx 30$, allowing $v_{\text{accel}}\,\hat{\mathbf{w}}$ to add orthogonally and increase total speed magnitude:

$$\Vert{}\mathbf{v}'\Vert{} = \sqrt{\Vert{}\mathbf{v}\Vert{}^2 + 2v_{\text{accel}}(\mathbf{v} \cdot \hat{\mathbf{w}}) + v_{\text{accel}}^2} \gt \Vert{}\mathbf{v}\Vert{}$$

### Gravity Integration (`StartGravity` & `FinishGravity`)

Source uses a half-step velocity-Verlet split around the position integration step to eliminate tickrate-dependent jump height drift:

1. **Before `TryPlayerMove`:** $v_z \leftarrow v_z - \frac{1}{2}\,g_{\text{ent}}\,g\,\Delta t$
2. **Integrate Position:** $\mathbf{x} \leftarrow \mathbf{x} + \mathbf{v}\,\Delta t$
3. **After `TryPlayerMove`:** $v_z \leftarrow v_z - \frac{1}{2}\,g_{\text{ent}}\,g\,\Delta t$

### Jump Impulse (`CheckJumpButton`)

Jumping sets vertical velocity directly (or adds to it in specific configurations) using conservation of energy:

$$v_z = \sqrt{2 \cdot g \cdot h_{\text{jump}}}$$

* **CS:S / GoldSrc ($h_{\text{jump}} = 45\text{ u}$, $g = 800\text{ u/s}^2$):** $v_z = \sqrt{2 \cdot 800 \cdot 45} \approx 268.33\text{ u/s}$
* **Half-Life 2 ($h_{\text{jump}} = 21\text{ u}$, $g = 800\text{ u/s}^2$):** $v_z = \sqrt{2 \cdot 800 \cdot 21} \approx 183.30\text{ u/s}$

### Velocity Clipping & Surf Ramps (`ClipVelocity`)

When a swept trace hits a plane with unit normal $\mathbf{n}$, velocity is projected onto the plane:

$$\mathbf{v}' = \mathbf{v} - (\mathbf{v} \cdot \mathbf{n}) \cdot \beta \cdot \mathbf{n}$$

* $\beta$ (`overbounce`): $1.0$ for sliding along walls/ramps; $1.0 + \text{bounce}$ for elastic entities.
* **Walkable vs. Surf Condition:** A surface is considered ground if $n_z \ge 0.7$ (slope angle $\le \arccos(0.7) \approx 45.57^\circ$). On steeper ramps ($n_z \lt 0.7$), the player remains in the airborne state—bypassing ground friction—while `TryPlayerMove` iteratively calls `ClipVelocity` against the ramp normal every tick, converting downward gravity into tangential ramp speed.

### Stair Step-Up (`StepMove`)

When horizontal movement hits a vertical obstacle ($n_z \approx 0$), Source evaluates two candidate trajectories over $\Delta t$:

1. **Path A (Slide):** Standard `TryPlayerMove` sliding along the wall.
2. **Path B (Step):** Trace up by `sv_stepsize` ($18\text{ u}$) $\rightarrow$ trace forward with $\mathbf{v}$ $\rightarrow$ trace down by `sv_stepsize`.

If Path B lands on walkable ground ($n_z \ge 0.7$) and covers greater horizontal squared distance $(x_B - x_0)^2 + (y_B - y_0)^2 \gt (x_A - x_0)^2 + (y_A - y_0)^2$, Path B is committed.

---

## 3. BSP Collision & Swept AABB Math

Player hitboxes are axis-aligned bounding boxes (AABBs) that never rotate with view yaw. Rather than testing an AABB against static BSP brush planes, Source expands each brush plane outward by the AABB's half-extents $\mathbf{e} = (e_x, e_y, e_z)$ (Minkowski sum) and traces a single point ray:

$$d_{\text{shifted}} = d - \left(\vert{}n_x e_x\vert{} + \vert{}n_y e_y\vert{} + \vert{}n_z e_z\vert{}\right)$$

For a movement segment from $\mathbf{p}_1$ to $\mathbf{p}_2$, signed distances to the shifted plane are $s_1 = \mathbf{n} \cdot \mathbf{p}_1 - d_{\text{shifted}}$ and $s_2 = \mathbf{n} \cdot \mathbf{p}_2 - d_{\text{shifted}}$. If $s_1 \gt 0$ and $s_2 \lt 0$, the exact time-of-impact fraction $t \in [0, 1]$ is:

$$t = \max\left(0,\; \frac{s_1 - \epsilon}{s_1 - s_2}\right)$$

where $\epsilon = \frac{1}{32}\text{ u} = 0.03125\text{ u}$ (`DIST_EPSILON`) prevents floating-point self-intersection on subsequent ticks.

---

## 4. Rigid-Body Dynamics (`VPhysics` / Havok)

Props and ragdolls are simulated as rigid bodies with mass $m$, center of mass $\mathbf{x}$, orientation quaternion $\mathbf{q}$, linear velocity $\mathbf{v}$, angular velocity $\boldsymbol{\omega}$, and world-space inertia tensor $\mathbf{I} = \mathbf{R}\,\mathbf{I}_{\text{local}}\,\mathbf{R}^T$.

### Semi-Implicit Euler Integration

At each physics step $\Delta t$:

$$\mathbf{v}_{t+\Delta t} = \mathbf{v}_t(1 - c_{\text{lin}}\Delta t) + \left(\frac{\mathbf{F}_{\text{ext}}}{m} + \mathbf{g}\right)\Delta t$$

$$\mathbf{x}_{t+\Delta t} = \mathbf{x}_t + \mathbf{v}_{t+\Delta t}\Delta t$$

$$\boldsymbol{\omega}_{t+\Delta t} = \boldsymbol{\omega}_t(1 - c_{\text{ang}}\Delta t) + \mathbf{I}^{-1}\left(\boldsymbol{\tau}_{\text{ext}} - \boldsymbol{\omega}_t \times (\mathbf{I}\boldsymbol{\omega}_t)\right)\Delta t$$

$$\mathbf{q}_{t+\Delta t} = \text{normalize}\left(\mathbf{q}_t + \frac{1}{2}\begin{bmatrix}0 \\ \boldsymbol{\omega}_{t+\Delta t}\end{bmatrix} \otimes \mathbf{q}_t\,\Delta t\right)$$

### Rigid-Body Collision Impulse

At contact point $\mathbf{p}$ with lever arms $\mathbf{r}_A = \mathbf{p} - \mathbf{x}_A$ and $\mathbf{r}_B = \mathbf{p} - \mathbf{x}_B$, contact normal $\mathbf{n}$, and restitution $e$:

$$\mathbf{v}_{\text{rel}} = (\mathbf{v}_B + \boldsymbol{\omega}_B \times \mathbf{r}_B) - (\mathbf{v}_A + \boldsymbol{\omega}_A \times \mathbf{r}_A)$$

$$j = \frac{-(1 + e)(\mathbf{v}_{\text{rel}} \cdot \mathbf{n})}{m_A^{-1} + m_B^{-1} + \left[\left(\mathbf{I}_A^{-1}(\mathbf{r}_A \times \mathbf{n})\right) \times \mathbf{r}_A + \left(\mathbf{I}_B^{-1}(\mathbf{r}_B \times \mathbf{n})\right) \times \mathbf{r}_B\right] \cdot \mathbf{n}}$$

$$\mathbf{v}_A' = \mathbf{v}_A - \frac{j}{m_A}\mathbf{n}, \quad \boldsymbol{\omega}_A' = \boldsymbol{\omega}_A - \mathbf{I}_A^{-1}(\mathbf{r}_A \times j\mathbf{n})$$

### Explosion & Damage Impulse

Radial explosions apply linear attenuation over blast radius $R$ scaled by `phys_pushscale` ($k_{\text{push}}$):

$$I_{\text{mag}} = D_{\text{max}} \cdot \max\left(0,\; 1 - \frac{\Vert{}\mathbf{x}_{\text{obj}} - \mathbf{x}_{\text{exp}}\Vert{}}{R}\right) \cdot k_{\text{push}}$$

$$\Delta \mathbf{v} = \frac{I_{\text{mag}}}{m}\,\frac{\mathbf{x}_{\text{obj}} - \mathbf{x}_{\text{exp}}}{\Vert{}\mathbf{x}_{\text{obj}} - \mathbf{x}_{\text{exp}}\Vert{}}$$

---

## 5. Standard Source Physics Constants

| ConVar / Constant | Default Value (HL2 / CS:S) | Surf / Bhop Typical | Units |
| --- | --- | --- | --- |
| `sv_gravity` | `800` | `800` | $\text{u/s}^2$ |
| `sv_accelerate` | `10` (HL2) / `5` (CS:S) | `5` – `10` | $\text{s}^{-1}$ |
| `sv_airaccelerate` | `10` | `100` – `1000` | $\text{s}^{-1}$ |
| `sv_friction` | `4` | `4` | $\text{s}^{-1}$ |
| `sv_stopspeed` | `100` (HL2) / `75` (CS:S) | `75` – `100` | $\text{u/s}$ |
| `sv_maxvelocity` | `3500` | `3500` – `10000` | $\text{u/s}$ |
| `sv_stepsize` | `18` | `18` | $\text{u}$ |
| `DIST_EPSILON` | `0.03125` ($1/32$) | `0.03125` | $\text{u}$ |
| Walkable $n_z$ threshold | `0.7` | `0.7` | dimensionless |

//WorldRenderer.ts
import * as THREE from 'three';
import { SURF_NORMAL_Z } from '../core/constants';
import { gsToThree } from '../core/coordinates';
import { ConvexBrush, TriggerVolume } from '../physics/BrushBuilder';
import { WorldSign } from '../maps/surfSandbox01';
import { makeDevGridTexture, makeHazardTexture } from './textures';

export class WorldRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly vmScene = new THREE.Scene();
  private readonly vmCamera: THREE.PerspectiveCamera;
  private readonly boosterTex: THREE.CanvasTexture;

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

    this.scene.fog = new THREE.FogExp2(0x0c1322, 0.000105);

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 2, 26000);
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

    const cosP = Math.cos(renderPitch);
    const fwdX = cosP * Math.cos(renderYaw);
    const fwdY = cosP * Math.sin(renderYaw);
    const fwdZ = Math.sin(renderPitch);

    gsToThree(rx, ry, eyeZ, this.camPos);
    gsToThree(rx + fwdX * 100, ry + fwdY * 100, eyeZ + fwdZ * 100, this.camLook);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    // Velocity-reactive Dynamic FOV (base -> +22° at 3000+ u/s)
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
    const skyGeo = new THREE.SphereGeometry(18000, 32, 20);
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

    // Hazard-striped fail floor visual below map (Z = -200)
    const failGeo = new THREE.PlaneGeometry(18000, 13000);
    failGeo.rotateX(-Math.PI / 2);
    const failMat = new THREE.MeshBasicMaterial({
      map: makeHazardTexture(),
      transparent: true,
      opacity: 0.75,
    });
    const failMesh = new THREE.Mesh(failGeo, failMat);
    failMesh.position.set(5200, -200, -1400);
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

    // Distant parallax monolith pillars for spatial speed perception
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
      [10400, 2900],
    ];
    for (const [px, py] of pillarCoords) {
      const pMesh = new THREE.Mesh(new THREE.BoxGeometry(220, 2600, 220), pillarMat);
      pMesh.position.copy(gsToThree(px, py, 400));
      this.scene.add(pMesh);
    }
  }

  private buildWorldSigns(signs: WorldSign[]): void {
    for (const s of signs) {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 112;
      const g = c.getContext('2d')!;
      g.fillStyle = 'rgba(9, 13, 21, 0.84)';
      g.fillRect(6, 6, 628, 100);
      g.strokeStyle = s.color;
      g.lineWidth = 5;
      g.strokeRect(6, 6, 628, 100);
      g.fillStyle = s.color;
      g.font = '800 32px JetBrains Mono, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(s.text, 320, 58);

      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
      const geo = new THREE.PlaneGeometry(280 * s.scale, 49 * s.scale);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(gsToThree(s.x, s.y, s.z));
      mesh.rotation.y = s.yaw - Math.PI * 0.5;
      this.scene.add(mesh);
    }
  }
}


//SurfApp.ts
// src/app/SurfApp.ts
import {
  f32,
  FIXED_DT,
  FL_DUCKING,
  FL_ONGROUND,
  IN_DUCK,
  IN_JUMP,
  MoveState,
} from '../core/constants';
import { F32, I32, PhysicsMemoryAbi } from '../core/memoryAbi';
import { GoldSrcPhysicsEngine } from '../physics/GoldSrcPhysicsEngine';
import { buildSurfSandbox01 } from '../maps/surfSandbox01';
import { SurfAudioEngine } from '../audio/SurfAudioEngine';
import { WorldRenderer } from '../render/WorldRenderer';
import { ViewmodelRig } from '../render/ViewmodelRig';
import { InputController } from '../gameplay/InputController';
import { RunTracker } from '../gameplay/RunTracker';
import { StrafeSyncTracker } from '../gameplay/StrafeSyncTracker';
import { HudController } from '../ui/HudController';
import { MenuController } from '../ui/MenuController';

export class SurfApp {
  private readonly abi = new PhysicsMemoryAbi(2);
  private readonly audio = new SurfAudioEngine();
  private readonly runTracker = new RunTracker();
  private readonly strafeSync = new StrafeSyncTracker(140);
  private readonly physics: GoldSrcPhysicsEngine;
  private readonly renderer: WorldRenderer;
  private readonly viewmodel: ViewmodelRig;
  private readonly input: InputController;
  private readonly hud: HudController;
  private readonly menu: MenuController;

  private lastFrameTime = performance.now();
  private accumulator = 0;
  private simMsAvg = 0.08;
  private idleClock = 0;

  constructor(canvas: HTMLCanvasElement) {
    const mapData = buildSurfSandbox01();

    this.hud = new HudController(this.runTracker);
    this.viewmodel = new ViewmodelRig();
    this.renderer = new WorldRenderer(canvas, mapData.brushes, mapData.triggers, mapData.signs, this.viewmodel.root);

    this.physics = new GoldSrcPhysicsEngine(
      this.abi,
      mapData.brushes,
      mapData.triggers,
      mapData.spawn,
      {
        onLand: (impact) => this.audio.playLand(impact),
        onJump: () => this.audio.playJump(),
        onBoost: () => {
          this.audio.playBoost();
          this.hud.flashScreen('rgba(34, 211, 238, 0.35)');
        },
        onTeleport: (isFail) => {
          this.runTracker.reset();
          if (isFail) {
            this.audio.playTeleport();
            this.hud.flashScreen('rgba(251, 113, 133, 0.42)');
            this.hud.showToast('FAIL ZONE — TELEPORTED TO SPAWN', 'rgba(251,113,133,0.6)');
          }
        },
        onStartRun: () => {
          if (this.runTracker.state !== 'RUNNING') {
            this.runTracker.start(this.abi.i32[I32.TICK]);
            this.audio.playStartBeep();
            this.hud.showToast('RUN STARTED — GO!', 'rgba(52,211,153,0.6)');
          }
        },
        onFinishRun: () => {
          const result = this.runTracker.finish(this.abi.i32[I32.TICK]);
          if (!result) return;
          this.audio.playFinishChime();
          this.hud.flashScreen('rgba(16, 185, 129, 0.42)');
          const pbNote = result.isNewPb ? ' ★ NEW PERSONAL BEST!' : '';
          this.hud.showToast(
            `FINISHED IN ${RunTracker.formatTime(result.finishSec)}${pbNote}  (Press R to Restart)`,
            'rgba(16,185,129,0.75)',
          );
        },
      },
    );

    this.input = new InputController(canvas, mapData.spawn, {
      onUnlockRequest: () => this.audio.unlock(),
      onSelectWeapon: (slot) => this.selectWeapon(slot),
      onResetRun: () => {
        this.physics.teleportToSpawn(false);
        this.input.resetView(mapData.spawn.yaw, mapData.spawn.pitch);
        this.hud.showToast('RUN RESET', 'rgba(245,158,11,0.6)');
      },
      onToggleDebug: () => {
        const next = !this.renderer.debugGroup.visible;
        this.renderer.setDebugVisible(next);
        this.menu.setDebugChecked(next);
        this.hud.showToast(
          next ? 'MAPPER DEBUG WIREFRAMES: ON' : 'MAPPER DEBUG WIREFRAMES: OFF',
          'rgba(245,158,11,0.65)',
        );
      },
    });

    this.menu = new MenuController(this.abi, {
      onPlay: () => this.input.requestLock(),
      onRestart: () => {
        this.physics.teleportToSpawn(false);
        this.input.resetView(mapData.spawn.yaw, mapData.spawn.pitch);
        this.input.requestLock();
      },
      onSensitivityChange: (sens) => { this.input.sensitivity = sens; },
      onBaseFovChange: (fov) => { this.renderer.baseFov = fov; },
      onScout260Change: (enabled) => this.hud.setScoutSpeedLabel(enabled),
      onStrafeHudChange: (visible) => this.hud.setStrafeHudVisible(visible),
      onDebugChange: (enabled) => {
        this.renderer.setDebugVisible(enabled);
        this.hud.showToast(
          enabled ? 'MAPPER DEBUG WIREFRAMES: ON' : 'MAPPER DEBUG WIREFRAMES: OFF',
          'rgba(245,158,11,0.65)',
        );
      },
      onMuteChange: (muted) => this.audio.setMuted(muted),
    });

    this.physics.teleportToSpawn(false);
    this.menu.syncAll();
  }

  private getActiveWeaponSpeed(): number {
    const { i32: vi } = this.abi;
    if (vi[I32.WEAPON] === 1 && vi[I32.LEGACY_SCOUT] === 1) return f32(260.0);
    return f32(250.0);
  }

  private selectWeapon(slot: number): void {
    const { i32: vi } = this.abi;
    if (slot < 1 || slot > 3 || vi[I32.WEAPON] === slot) return;
    vi[I32.WEAPON] = slot;
    this.viewmodel.triggerDeploy();
    this.viewmodel.setActiveSlot(slot);
    this.hud.setActiveWeaponSlot(slot);
    this.audio.playWeaponSwitch();
  }

  private stepPhysicsTick(): void {
    const { f32: vf, i32: vi } = this.abi;
    const keys = this.input.keys;
    const maxSpd = this.getActiveWeaponSpeed();

    let fmove = 0;
    let smove = 0;
    if (keys.w) fmove += maxSpd;
    if (keys.s) fmove -= maxSpd;
    if (keys.d) smove += maxSpd;
    if (keys.a) smove -= maxSpd;

    let buttons = 0;
    if (keys.jump || this.input.consumeScrollJump()) buttons |= IN_JUMP;
    if (keys.duck) buttons |= IN_DUCK;

    vf[F32.CMD_FMOVE] = f32(fmove);
    vf[F32.CMD_SMOVE] = f32(smove);
    vf[F32.CMD_YAW] = f32(this.input.viewYaw);
    vf[F32.CMD_PITCH] = f32(this.input.viewPitch);
    vf[F32.CMD_MAXSPEED] = maxSpd;
    vi[I32.BUTTONS] = buttons;

    const preXY = Math.hypot(vf[F32.VEL_X], vf[F32.VEL_Y]);
    const t0 = performance.now();
    this.physics.simulateTick();
    const dtSim = performance.now() - t0;
    this.simMsAvg = this.simMsAvg * 0.92 + dtSim * 0.08;

    const postXY = Math.hypot(vf[F32.VEL_X], vf[F32.VEL_Y]);
    const airborne = (vi[I32.FLAGS] & FL_ONGROUND) === 0;
    const yawDelta = this.input.consumeTickYawDelta();
    this.strafeSync.recordTick(airborne, keys.a, keys.d, yawDelta, preXY, postXY);
    this.runTracker.tick(vi[I32.TICK]);
  }

  public start(): void {
    this.lastFrameTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);

    const frameDt = Math.min(0.05, (now - this.lastFrameTime) * 0.001);
    this.lastFrameTime = now;
    this.idleClock += frameDt;

    const locked = this.input.isPointerLocked;
    if (locked) {
      this.accumulator += frameDt;
      let substeps = 0;
      while (this.accumulator >= FIXED_DT && substeps < 6) {
        this.stepPhysicsTick();
        this.accumulator -= FIXED_DT;
        substeps++;
      }
      if (substeps === 6) this.accumulator = 0;
    } else {
      this.accumulator = 0;
    }

    const alpha = locked ? this.accumulator / FIXED_DT : 1.0;
    const { f32: vf, i32: vi } = this.abi;

    const rx = vf[F32.PREV_X] + (vf[F32.POS_X] - vf[F32.PREV_X]) * alpha;
    const ry = vf[F32.PREV_Y] + (vf[F32.POS_Y] - vf[F32.PREV_Y]) * alpha;
    const rz = vf[F32.PREV_Z] + (vf[F32.POS_Z] - vf[F32.PREV_Z]) * alpha;
    const rEye = vf[F32.PREV_VIEW_OFS_Z] + (vf[F32.VIEW_OFS_Z] - vf[F32.PREV_VIEW_OFS_Z]) * alpha;

    const renderYaw = locked ? this.input.viewYaw : this.input.viewYaw + Math.sin(this.idleClock * 0.45) * 0.08;
    const renderPitch = locked ? this.input.viewPitch : this.input.viewPitch + Math.cos(this.idleClock * 0.35) * 0.025;

    const spdXY = Math.hypot(vf[F32.VEL_X], vf[F32.VEL_Y]);
    const spd3D = Math.hypot(vf[F32.VEL_X], vf[F32.VEL_Y], vf[F32.VEL_Z]);
    const grounded = (vi[I32.FLAGS] & FL_ONGROUND) !== 0;
    const ducking = (vi[I32.FLAGS] & FL_DUCKING) !== 0;

    this.input.decayVisuals(frameDt);
    this.viewmodel.update(
      frameDt,
      spdXY,
      grounded,
      this.input.keys.a,
      this.input.keys.d,
      this.input.vmSwayX,
      this.input.vmSwayY,
    );
    this.renderer.update(frameDt, rx, ry, rz + rEye, renderYaw, renderPitch, spdXY);
    this.audio.updateContinuous(spd3D, vi[I32.MOVESTATE] === MoveState.SURF, !locked);

    this.hud.update({
      now,
      spdXY,
      spd3D,
      velZ: vf[F32.VEL_Z],
      simMsAvg: this.simMsAvg,
      syncPct: this.strafeSync.getSyncPercent(),
      smoothYawVisual: this.input.smoothYawVisual,
      moveState: vi[I32.MOVESTATE],
      ducking,
      keys: this.input.keys,
      cvarLabel: `aa:${Math.round(vf[F32.CVAR_AIRACCEL])} mv:${Math.round(vf[F32.CVAR_MAXVEL])}`,
    });

    this.renderer.render();
  };
}

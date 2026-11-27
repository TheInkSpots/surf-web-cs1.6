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

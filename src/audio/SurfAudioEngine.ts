// src/audio/SurfAudioEngine.ts
import { computeAngleVectors, RigidBodyKind, Vec3 } from '../physics/GoldSrcPhysicsEngine';

/** 1 Hammer unit = 0.01905 meters -> Speed of sound 343 m/s ≈ 18005.25 Hammer u/s */
const HAMMER_TO_METERS = 0.01905;
const SPEED_OF_SOUND_HU = 343 / HAMMER_TO_METERS;

export interface ListenerKinematics {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  /** Camera pitch (+up); converted internally to Source pitch (+down) */
  pitch: number;
}

interface SpatialCue {
  gain: number;
  pan: number;
  dopplerRatio: number;
  lowpassHz: number;
}

export class SurfAudioEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private ready = false;
  private noiseBuf: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private slideGain: GainNode | null = null;
  private slideFilter: BiquadFilterNode | null = null;

  private listener: ListenerKinematics = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
  };

  public unlock(): void {
    if (this.ready) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();

      const len = this.ctx.sampleRate * 2;
      const noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuf = noiseBuf;

      // Velocity-reactive aerodynamic wind rush
      const windSrc = this.ctx.createBufferSource();
      windSrc.buffer = noiseBuf;
      windSrc.loop = true;
      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 320;
      this.windFilter.Q.value = 1.3;
      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0;
      windSrc.connect(this.windFilter).connect(this.windGain).connect(this.ctx.destination);
      windSrc.start();

      // Continuous surf-ramp slide hum (active during MoveState.SURF, n_z < 0.7)
      const slideSrc = this.ctx.createBufferSource();
      slideSrc.buffer = noiseBuf;
      slideSrc.loop = true;
      this.slideFilter = this.ctx.createBiquadFilter();
      this.slideFilter.type = 'bandpass';
      this.slideFilter.frequency.value = 220;
      this.slideFilter.Q.value = 4.5;
      this.slideGain = this.ctx.createGain();
      this.slideGain.gain.value = 0;
      slideSrc.connect(this.slideFilter).connect(this.slideGain).connect(this.ctx.destination);
      slideSrc.start();

      this.ready = true;
    } catch (err) {
      console.warn('Web Audio initialization skipped:', err);
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted && this.ready && this.ctx && this.windGain && this.slideGain) {
      const t = this.ctx.currentTime;
      this.windGain.gain.setTargetAtTime(0, t, 0.04);
      this.slideGain.gain.setTargetAtTime(0, t, 0.04);
    }
  }

  public updateListener(kinematics: ListenerKinematics): void {
      const { pos, vel, yaw, pitch } = kinematics;
      if (
        !Number.isFinite(pos.x) ||
        !Number.isFinite(pos.y) ||
        !Number.isFinite(pos.z) ||
        !Number.isFinite(vel.x) ||
        !Number.isFinite(vel.y) ||
        !Number.isFinite(vel.z) ||
        !Number.isFinite(yaw) ||
        !Number.isFinite(pitch)
      ) {
        if (!this.loggedNanWarning) {
          this.loggedNanWarning = true;
          console.error('[SurfAudioEngine] Non-finite listener kinematics:', kinematics);
        }
        return;
      }
      this.listener = kinematics;
  }
  private loggedNanWarning = false;

    private computeSpatialCue(
        sourcePos?: Vec3,
        sourceVel: Vec3 = { x: 0, y: 0, z: 0 },
        refDistHu = 240,
      ): SpatialCue {
        const fallback: SpatialCue = { gain: 1, pan: 0, dopplerRatio: 1, lowpassHz: 18000 };
        if (!sourcePos) return fallback;

        const dx = sourcePos.x - this.listener.pos.x;
        const dy = sourcePos.y - this.listener.pos.y;
        const dz = sourcePos.z - this.listener.pos.z;
        const distHu = Math.hypot(dx, dy, dz);

        if (!Number.isFinite(distHu)) {
          if (!this.loggedNanWarning) {
            this.loggedNanWarning = true;
            console.error('[SurfAudioEngine] Non-finite spatial distance:', {
              sourcePos,
              listener: this.listener,
            });
          }
          return fallback;
        }
        if (distHu < 8) return fallback;

        const dirX = dx / distHu;
        const dirY = dy / distHu;
        const dirZ = dz / distHu;

        const { right } = computeAngleVectors(-this.listener.pitch, this.listener.yaw, 0);
        const rawPan = dirX * right.x + dirY * right.y + dirZ * right.z;
        const pan = Number.isFinite(rawPan) ? Math.max(-1, Math.min(1, rawPan)) : 0;

        const distM = distHu * HAMMER_TO_METERS;
        const refM = Math.max(1.5, refDistHu * HAMMER_TO_METERS);
        const rawGain = 1 / (1 + Math.pow(distM / refM, 1.35));
        const gain = Number.isFinite(rawGain) ? Math.max(0.03, Math.min(1, rawGain)) : 1;

        const vListenerAlong =
          this.listener.vel.x * dirX + this.listener.vel.y * dirY + this.listener.vel.z * dirZ;
        const vSourceAlong = sourceVel.x * dirX + sourceVel.y * dirY + sourceVel.z * dirZ;
        const rawDoppler =
          (SPEED_OF_SOUND_HU + vListenerAlong) / Math.max(2000, SPEED_OF_SOUND_HU + vSourceAlong);
        const dopplerRatio = Number.isFinite(rawDoppler)
          ? Math.max(0.72, Math.min(1.38, rawDoppler))
          : 1;

        const rawLp = 18000 * Math.exp(-distM * 0.022);
        const lowpassHz = Number.isFinite(rawLp) ? Math.max(1400, rawLp) : 18000;

        return { gain, pan, dopplerRatio, lowpassHz };
      }

      private createSpatialOut(cue: SpatialCue): AudioNode {
          const ctx = this.ctx!;
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = Number.isFinite(cue.lowpassHz) ? cue.lowpassHz : 18000;

          const gain = ctx.createGain();
          gain.gain.value = Number.isFinite(cue.gain) ? cue.gain : 1;

          if (typeof ctx.createStereoPanner === 'function') {
            const panner = ctx.createStereoPanner();
            panner.pan.value = Number.isFinite(cue.pan) ? cue.pan : 0;
            lp.connect(gain).connect(panner).connect(ctx.destination);
          } else {
            lp.connect(gain).connect(ctx.destination);
          }
          return lp;
        }

  public updateContinuous(
    speed3D: number,
    isSurfing: boolean,
    isPaused: boolean,
    surfNormalZ = 0,
  ): void {
    if (
      !this.ready ||
      !this.ctx ||
      !this.windGain ||
      !this.windFilter ||
      !this.slideGain ||
      !this.slideFilter
    ) {
      return;
    }

    const t = this.ctx.currentTime;
    if (this.muted || isPaused) {
      this.windGain.gain.setTargetAtTime(0, t, 0.05);
      this.slideGain.gain.setTargetAtTime(0, t, 0.05);
      return;
    }

    const windNorm = Math.max(0, Math.min(1, (speed3D - 450) / 3050));
    this.windGain.gain.setTargetAtTime(windNorm * windNorm * 0.2, t, 0.06);
    this.windFilter.frequency.setTargetAtTime(260 + windNorm * 1550, t, 0.06);

    const slopeFactor = isSurfing ? Math.max(0.4, 1.15 - surfNormalZ) : 0;
    const slideTarget = isSurfing ? Math.min(0.13, (0.025 + windNorm * 0.095) * slopeFactor) : 0;
    this.slideGain.gain.setTargetAtTime(slideTarget, t, 0.04);
    this.slideFilter.frequency.setTargetAtTime(160 + windNorm * 460 * slopeFactor, t, 0.05);
  }

  public playLand(impactSpeed: number): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const intensity = Math.min(1, Math.max(0.18, impactSpeed / 650));

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(105 + intensity * 25, t);
    osc.frequency.exponentialRampToValueAtTime(36, t + 0.095);
    gain.gain.setValueAtTime(0.24 * intensity, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.115);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.125);
  }

  public playJump(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(215, t + 0.055);
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.07);
  }

  public playBoost(): void {
    if (!this.ready || this.muted || !this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.2;
    filter.frequency.setValueAtTime(280, t);
    filter.frequency.exponentialRampToValueAtTime(2400, t + 0.28);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + 0.36);

    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(760, t + 0.24);
    og.gain.setValueAtTime(0.11, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(og).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  public playExplosion(origin: Vec3, radius: number): void {
    if (!this.ready || this.muted || !this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const cue = this.computeSpatialCue(origin, { x: 0, y: 0, z: 0 }, Math.max(360, radius * 0.65));
    const out = this.createSpatialOut(cue);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(950 * cue.dopplerRatio, t);
    lp.frequency.exponentialRampToValueAtTime(95, t + 0.55);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.45, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.62);
    src.connect(lp).connect(ng).connect(out);
    src.start(t);
    src.stop(t + 0.65);

    const sub = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(118 * cue.dopplerRatio, t);
    sub.frequency.exponentialRampToValueAtTime(26, t + 0.42);
    sg.gain.setValueAtTime(0.42, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
    sub.connect(sg).connect(out);
    sub.start(t);
    sub.stop(t + 0.5);
  }

  public playScoutShot(): void {
    if (!this.ready || this.muted || !this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1450, t);
    bp.frequency.exponentialRampToValueAtTime(260, t + 0.24);
    bp.Q.value = 0.85;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.42, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    noise.connect(bp).connect(ng).connect(this.ctx.destination);
    noise.start(t);
    noise.stop(t + 0.3);

    const body = this.ctx.createOscillator();
    const bg = this.ctx.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(195, t);
    body.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    bg.gain.setValueAtTime(0.32, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    body.connect(bg).connect(this.ctx.destination);
    body.start(t);
    body.stop(t + 0.17);

    const boltTimes = [0.34, 0.46, 0.58];
    const boltFreqs = [920, 640, 1180];
    boltTimes.forEach((offset, idx) => {
      if (!this.ctx) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(boltFreqs[idx], t + offset);
      o.frequency.exponentialRampToValueAtTime(boltFreqs[idx] * 0.55, t + offset + 0.035);
      g.gain.setValueAtTime(0.038, t + offset);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.04);
      o.connect(g).connect(this.ctx.destination);
      o.start(t + offset);
      o.stop(t + offset + 0.045);
    });
  }

  public playUspShot(silenced: boolean): void {
    if (!this.ready || this.muted || !this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = silenced ? 'bandpass' : 'lowpass';
    filter.frequency.setValueAtTime(silenced ? 2600 : 3400, t);
    filter.frequency.exponentialRampToValueAtTime(silenced ? 750 : 420, t + (silenced ? 0.065 : 0.13));
    filter.Q.value = silenced ? 2.4 : 0.9;

    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(silenced ? 0.19 : 0.34, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + (silenced ? 0.075 : 0.15));
    noise.connect(filter).connect(ng).connect(this.ctx.destination);
    noise.start(t);
    noise.stop(t + (silenced ? 0.085 : 0.16));

    const slide = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    slide.type = silenced ? 'sine' : 'sawtooth';
    slide.frequency.setValueAtTime(silenced ? 360 : 250, t);
    slide.frequency.exponentialRampToValueAtTime(silenced ? 115 : 58, t + 0.055);
    sg.gain.setValueAtTime(silenced ? 0.11 : 0.22, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
    slide.connect(sg).connect(this.ctx.destination);
    slide.start(t);
    slide.stop(t + 0.07);
  }

  public playSilencerToggle(attaching: boolean): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const steps = attaching ? [320, 480, 680] : [680, 480, 320];
    steps.forEach((f, idx) => {
      if (!this.ctx) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      const st = t + idx * 0.08;
      o.frequency.setValueAtTime(f, st);
      o.frequency.exponentialRampToValueAtTime(f * 0.82, st + 0.055);
      g.gain.setValueAtTime(0.06, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.065);
      o.connect(g).connect(this.ctx.destination);
      o.start(st);
      o.stop(st + 0.07);
    });
  }

  public playKnifeSwing(heavy: boolean): void {
    if (!this.ready || this.muted || !this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const dur = heavy ? 0.19 : 0.12;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3.2;
    bp.frequency.setValueAtTime(heavy ? 620 : 1200, t);
    bp.frequency.exponentialRampToValueAtTime(heavy ? 2100 : 2800, t + dur * 0.45);
    bp.frequency.exponentialRampToValueAtTime(380, t + dur);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(heavy ? 0.21 : 0.14, t + dur * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noise.connect(bp).connect(gain).connect(this.ctx.destination);
    noise.start(t);
    noise.stop(t + dur + 0.02);
  }

  public playImpact(
    pos: Vec3,
    material: 'world' | 'prop' | 'blood' | 'weapon',
    impulseMag = 1200,
    sourceVel: Vec3 = { x: 0, y: 0, z: 0 },
  ): void {
    if (!this.ready || this.muted || !this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const cue = this.computeSpatialCue(pos, sourceVel, 320);
    const out = this.createSpatialOut(cue);
    const strength = Math.min(1, Math.max(0.22, impulseMag / 3400));

    if (material === 'blood') {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(920 * cue.dopplerRatio, t);
      bp.frequency.exponentialRampToValueAtTime(240, t + 0.09);
      bp.Q.value = 1.6;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.28 * strength, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      noise.connect(bp).connect(ng).connect(out);
      noise.start(t);
      noise.stop(t + 0.12);

      const thud = this.ctx.createOscillator();
      const tg = this.ctx.createGain();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(165 * cue.dopplerRatio, t);
      thud.frequency.exponentialRampToValueAtTime(52, t + 0.08);
      tg.gain.setValueAtTime(0.22 * strength, t);
      tg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      thud.connect(tg).connect(out);
      thud.start(t);
      thud.stop(t + 0.1);
      return;
    }

    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    osc.type = material === 'prop' ? 'triangle' : 'square';
    const baseFreq = material === 'weapon' ? 880 : material === 'world' ? 1420 : 230;
    osc.frequency.setValueAtTime(baseFreq * cue.dopplerRatio, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.38, t + 0.075);
    og.gain.setValueAtTime(0.14 * strength, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.095);
  }

  public playRigidBodyClatter(pos: Vec3, impulseMag: number, kind: RigidBodyKind): void {
    const mat = kind === 'weapon' ? 'weapon' : kind === 'target' ? 'blood' : 'prop';
    this.playImpact(pos, mat, impulseMag);
  }

  public playDryFire(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1650, t);
    osc.frequency.exponentialRampToValueAtTime(720, t + 0.02);
    g.gain.setValueAtTime(0.055, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.03);
  }

  public playReload(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const cues = [
      { delay: 0.0, freq: 420, dur: 0.05 },
      { delay: 0.42, freq: 620, dur: 0.05 },
      { delay: 0.82, freq: 980, dur: 0.06 },
    ];
    for (const c of cues) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(c.freq, t + c.delay);
      osc.frequency.exponentialRampToValueAtTime(c.freq * 0.6, t + c.delay + c.dur);
      g.gain.setValueAtTime(0.08, t + c.delay);
      g.gain.exponentialRampToValueAtTime(0.001, t + c.delay + c.dur + 0.01);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(t + c.delay);
      osc.stop(t + c.delay + c.dur + 0.02);
    }
  }

  public playWeaponDrop(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(340, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.09);
    g.gain.setValueAtTime(0.11, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.11);
  }

  public playWeaponPickup(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = [440, 740];
    notes.forEach((f, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'square';
      const st = t + idx * 0.045;
      osc.frequency.setValueAtTime(f, st);
      g.gain.setValueAtTime(0.065, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.06);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(st);
      osc.stop(st + 0.065);
    });
  }

  public playScopeZoom(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1120, t);
    osc.frequency.exponentialRampToValueAtTime(540, t + 0.04);
    g.gain.setValueAtTime(0.055, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  public playPlayerHurt(damage: number): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const intensity = Math.min(1, Math.max(0.25, damage / 45));

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(145, t);
    osc.frequency.exponentialRampToValueAtTime(58, t + 0.14);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    g.gain.setValueAtTime(0.22 * intensity, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(lp).connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  }

  public playPlayerDeath(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.55);
    g.gain.setValueAtTime(0.26, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.65);
  }

  public playTeleport(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(780, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.14);
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.26);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 1600;
    gain.gain.setValueAtTime(0.11, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(filt).connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  public playWeaponSwitch(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.045);
    gain.gain.setValueAtTime(0.045, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.055);
  }

  public playStartBeep(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.setValueAtTime(880, t + 0.06);
    gain.gain.setValueAtTime(0.09, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  public playFinishChime(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const start = t + idx * 0.065;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.11, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.42);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + 0.45);
    });
  }
}

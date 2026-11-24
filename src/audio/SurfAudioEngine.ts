export class SurfAudioEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private ready = false;
  private noiseBuf: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private slideGain: GainNode | null = null;
  private slideFilter: BiquadFilterNode | null = null;

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

      // Reusable 2-second white noise buffer
      const len = this.ctx.sampleRate * 2;
      const noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuf = noiseBuf;

      // Continuous velocity-reactive wind rush
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

      // Continuous subtle ramp slide hum (active during MoveState.SURF)
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

  public updateContinuous(speed3D: number, isSurfing: boolean, isPaused: boolean): void {
    if (!this.ready || !this.ctx || !this.windGain || !this.windFilter || !this.slideGain || !this.slideFilter) {
      return;
    }

    const t = this.ctx.currentTime;
    if (this.muted || isPaused) {
      this.windGain.gain.setTargetAtTime(0, t, 0.05);
      this.slideGain.gain.setTargetAtTime(0, t, 0.05);
      return;
    }

    // Wind scales smoothly from 480 u/s to 3500 u/s
    const windNorm = Math.max(0, Math.min(1, (speed3D - 480) / 3020));
    this.windGain.gain.setTargetAtTime(windNorm * windNorm * 0.19, t, 0.06);
    this.windFilter.frequency.setTargetAtTime(260 + windNorm * 1450, t, 0.06);

    // Ramp slide texture hum
    const slideTarget = isSurfing ? Math.min(0.11, 0.025 + windNorm * 0.09) : 0;
    this.slideGain.gain.setTargetAtTime(slideTarget, t, 0.04);
    this.slideFilter.frequency.setTargetAtTime(160 + windNorm * 420, t, 0.05);
  }

  public playLand(impactSpeed: number): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const intensity = Math.min(1, Math.max(0.18, impactSpeed / 650));

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(105, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.09);
    gain.gain.setValueAtTime(0.24 * intensity, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  public playJump(): void {
    if (!this.ready || this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(210, t + 0.055);
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

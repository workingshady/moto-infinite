// Procedural vehicle sound: engine (firing pulses with a real gearbox), turbo, exhaust crackle,
// rev limiter, plus wind and off-road rumble. One instance per local vehicle.
// Firing frequency of a 4-stroke = rpm / 60 * cylinders / 2.
import { clamp, damp, lerp } from '../utils/math';

export interface EngineProfile {
  type: 'single' | 'twin' | 'vtwin' | 'i4' | 'i6' | 'v8' | 'rotary' | 'hybrid';
  cyl: number;
  idle: number; // rpm
  redline: number; // rpm
  gears: number;
  turbo?: boolean;
  crackle?: number; // 0..1 overrun pops
  lope?: number; // 0..1 uneven-firing burble (V-twin / big V8)
}

export interface DriveState {
  speed: number; // m/s, absolute
  top: number; // vehicle top speed (m/s)
  throttle: boolean;
  boost: number; // 0..1
  air: boolean;
  riding: boolean;
  offroad: boolean;
  volume: number; // per-player mix (split screen halves it)
}

/** Callbacks for one-shot sounds (shift clack, blow-off, crackle pops). */
export interface EngineFx {
  shift(): void;
  blowoff(): void;
  pop(): void;
}

function distortion(amount: number) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

export class EngineSound {
  private out: GainNode;
  private main: OscillatorNode;
  private sub: OscillatorNode;
  private harm: OscillatorNode;
  private filt: BiquadFilterNode;
  private engineGain: GainNode;
  private trem: GainNode;
  private lfo: OscillatorNode;
  private lfoDepth: GainNode;
  private intake: AudioBufferSourceNode;
  private intakeFilt: BiquadFilterNode;
  private intakeGain: GainNode;
  private whistle: OscillatorNode | null = null;
  private whistleGain: GainNode | null = null;
  private whine: OscillatorNode | null = null;
  private whineGain: GainNode | null = null;
  private wind: AudioBufferSourceNode;
  private windGain: GainNode;
  private rumble: AudioBufferSourceNode;
  private rumbleGain: GainNode;

  private rpm: number;
  private gear = 1;
  private spool = 0;
  private overrun = 0;
  private limiter = 0;
  private wasThrottle = false;

  constructor(private ac: AudioContext, dest: AudioNode, noise: AudioBuffer, private p: EngineProfile, private fx: EngineFx) {
    this.rpm = p.idle;
    const t = ac.currentTime;
    this.out = ac.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);

    // engine core: saw at the firing frequency, sub at half (body), square harmonic (rasp)
    this.main = ac.createOscillator();
    this.main.type = 'sawtooth';
    this.sub = ac.createOscillator();
    this.sub.type = 'sine';
    this.harm = ac.createOscillator();
    this.harm.type = p.type === 'rotary' ? 'square' : 'triangle';
    const shaper = ac.createWaveShaper();
    shaper.curve = distortion(p.type === 'v8' || p.type === 'vtwin' ? 6 : p.type === 'single' ? 9 : 3.5);
    this.filt = ac.createBiquadFilter();
    this.filt.type = 'lowpass';
    this.filt.Q.value = p.type === 'rotary' ? 4 : 1.6;
    this.engineGain = ac.createGain();
    this.engineGain.gain.value = 0.5;
    // amplitude "lope": uneven firing of V-twins and big V8s
    this.trem = ac.createGain();
    this.trem.gain.value = 1;
    this.lfo = ac.createOscillator();
    this.lfoDepth = ac.createGain();
    this.lfoDepth.gain.value = (p.lope ?? 0) * 0.55;
    this.lfo.connect(this.lfoDepth).connect(this.trem.gain);
    const mix = ac.createGain();
    const subG = ac.createGain();
    subG.gain.value = p.type === 'single' || p.type === 'vtwin' || p.type === 'v8' ? 0.9 : 0.5;
    const harmG = ac.createGain();
    harmG.gain.value = p.type === 'i4' || p.type === 'rotary' ? 0.45 : 0.25;
    this.main.connect(mix);
    this.sub.connect(subG).connect(mix);
    this.harm.connect(harmG).connect(mix);
    mix.connect(shaper).connect(this.filt).connect(this.trem).connect(this.engineGain).connect(this.out);

    // intake / mechanical noise
    this.intake = ac.createBufferSource();
    this.intake.buffer = noise;
    this.intake.loop = true;
    this.intakeFilt = ac.createBiquadFilter();
    this.intakeFilt.type = 'bandpass';
    this.intakeFilt.Q.value = 1.2;
    this.intakeGain = ac.createGain();
    this.intakeGain.gain.value = 0;
    this.intake.connect(this.intakeFilt).connect(this.intakeGain).connect(this.out);

    if (p.turbo) {
      this.whistle = ac.createOscillator();
      this.whistle.type = 'sine';
      this.whistleGain = ac.createGain();
      this.whistleGain.gain.value = 0;
      this.whistle.connect(this.whistleGain).connect(this.out);
      this.whistle.start(t);
    }
    if (p.type === 'hybrid') {
      this.whine = ac.createOscillator();
      this.whine.type = 'sine';
      this.whineGain = ac.createGain();
      this.whineGain.gain.value = 0;
      this.whine.connect(this.whineGain).connect(this.out);
      this.whine.start(t);
    }

    // wind (speed²) and off-road rumble go straight to the destination, not through the engine mix
    const mk = (type: BiquadFilterType, f: number, q: number) => {
      const src = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = noise;
      src.loop = true;
      src.playbackRate.value = 0.5 + Math.random() * 0.2;
      fl.type = type;
      fl.frequency.value = f;
      fl.Q.value = q;
      g.gain.value = 0;
      src.connect(fl).connect(g).connect(dest);
      src.start(t);
      return { src, g };
    };
    const w = mk('bandpass', 700, 0.5), r = mk('lowpass', 220, 0.8);
    this.wind = w.src; this.windGain = w.g;
    this.rumble = r.src; this.rumbleGain = r.g;

    for (const o of [this.main, this.sub, this.harm, this.lfo]) o.start(t);
    this.intake.start(t);
  }

  update(dt: number, s: DriveState) {
    const p = this.p, ac = this.ac, now = ac.currentTime, k = 0.04;
    const frac = clamp(s.speed / Math.max(1, s.top * 1.6), 0, 1); // 0..1 across the whole speed range (incl. nitro)
    // gearbox: each gear spans an equal slice of the speed range; rpm climbs inside the gear, drops on upshift
    const gf = frac * p.gears, gear = clamp(Math.floor(gf) + 1, 1, p.gears);
    if (gear > this.gear && s.riding && !s.air) {
      this.fx.shift();
      if (p.turbo && this.spool > 0.4) this.fx.blowoff();
    }
    this.gear = gear;
    let target: number;
    if (!s.riding) target = p.idle * 0.9;
    else if (s.air && s.throttle) target = p.redline * 0.97; // wheels free: revs flare
    else {
      const inGear = gear === p.gears && gf >= p.gears ? 1 : gf - (gear - 1);
      target = p.idle + (p.redline - p.idle) * (gear === 1 ? inGear * 0.85 + 0.05 : 0.38 + inGear * 0.6);
      if (!s.throttle && s.speed < 1) target = p.idle;
    }
    this.rpm = lerp(this.rpm, target, damp(dt, target < this.rpm ? 6 : 9));
    // rev limiter bounce at the top of the last gear
    const atLimit = s.throttle && this.rpm > p.redline * 0.96;
    this.limiter = atLimit ? (this.limiter + dt * 14) % 1 : 0;
    const rpm = this.rpm * (atLimit && this.limiter < 0.35 ? 0.94 : 1);
    const fire = (rpm / 60) * (p.cyl / 2);
    const load = s.throttle || s.boost > 0.2 ? 1 : 0.35;

    this.main.frequency.setTargetAtTime(fire, now, k);
    this.sub.frequency.setTargetAtTime(fire * 0.5, now, k);
    this.harm.frequency.setTargetAtTime(fire * (p.type === 'rotary' ? 3 : 2), now, k);
    this.lfo.frequency.setTargetAtTime(Math.max(2, fire * 0.5), now, k);
    this.filt.frequency.setTargetAtTime(300 + (rpm / p.redline) * (p.type === 'i4' || p.type === 'rotary' ? 5200 : 3200) * (0.55 + load * 0.45), now, k);
    this.engineGain.gain.setTargetAtTime(0.32 + load * 0.35, now, k);
    this.intakeFilt.frequency.setTargetAtTime(500 + rpm * 0.35, now, k);
    this.intakeGain.gain.setTargetAtTime(load * 0.05 * (rpm / p.redline), now, k);

    // turbo: spools with load and rpm, blows off when you lift
    this.spool = lerp(this.spool, s.throttle && rpm > p.redline * 0.45 ? 1 : 0, damp(dt, s.throttle ? 1.8 : 6));
    if (this.whistle && this.whistleGain) {
      this.whistle.frequency.setTargetAtTime(2200 + this.spool * 3800, now, k);
      this.whistleGain.gain.setTargetAtTime(this.spool * 0.025, now, k);
    }
    if (this.wasThrottle && !s.throttle && p.turbo && this.spool > 0.5) this.fx.blowoff();
    // overrun crackle: lifting off at high rpm pops through the exhaust
    if (this.wasThrottle && !s.throttle && rpm > p.redline * 0.55) this.overrun = 0.7;
    this.overrun = Math.max(0, this.overrun - dt);
    if (this.overrun > 0 && Math.random() < (p.crackle ?? 0) * 10 * dt) this.fx.pop();
    this.wasThrottle = s.throttle;
    if (this.whine && this.whineGain) {
      this.whine.frequency.setTargetAtTime(300 + s.speed * 70, now, k);
      this.whineGain.gain.setTargetAtTime(0.02 + frac * 0.03, now, k);
    }

    const v = s.volume;
    this.out.gain.setTargetAtTime(s.riding ? 0.16 * v : 0, now, 0.08);
    this.windGain.gain.setTargetAtTime(Math.min(0.12, (s.speed / 45) ** 2 * 0.12) * v, now, 0.1);
    this.rumbleGain.gain.setTargetAtTime(s.riding && s.offroad && !s.air ? clamp(s.speed / 25, 0, 1) * 0.18 * v : 0, now, 0.08);
  }

  stop() {
    for (const n of [this.main, this.sub, this.harm, this.lfo, this.intake, this.wind, this.rumble, this.whistle, this.whine]) {
      try { n?.stop(); } catch { /* already stopped */ }
    }
    this.out.disconnect();
    this.windGain.disconnect();
    this.rumbleGain.disconnect();
  }
}

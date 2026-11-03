// Procedural vehicle sound: engine (band-limited additive "engine orders" with a real gearbox), turbo,
// exhaust crackle, rev limiter, plus wind and off-road rumble. One instance per local vehicle.
// Firing frequency of a 4-stroke = rpm / 60 * cylinders / 2 (the "firing order" in crank orders).
// The oscillator runs at crank order 0.5 (rpm / 120) and its PeriodicWave holds the half / whole orders
// that give each layout its character (V8 burble, inline-4 smoothness, single-cylinder thump...).
// Everything is band-limited (no raw saw / square), gently saturated and low-passed so sustained high
// rpm stays clear rather than piercing.
import { clamp, damp, lerp } from '../utils/math';

export interface EngineProfile {
  type: 'single' | 'twin' | 'vtwin' | 'i4' | 'i6' | 'v8' | 'v10' | 'rotary' | 'hybrid' | 'twostroke' | 'flat' | 'v12' | 'electric';
  cyl: number;
  idle: number; // rpm
  redline: number; // rpm
  gears: number;
  turbo?: boolean;
  crackle?: number; // 0..1 overrun pops
  lope?: number; // 0..1 uneven-firing burble (V-twin / big V8)
  /** Audible pitch multiplier (rpm/HUD unaffected). <1 tames very high-revving engines. */
  pitch?: number;
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

type Orders = [order: number, amp: number][];

/** Engine orders (multiples of crank speed) and their amplitudes per layout. */
function engineOrders(p: EngineProfile): Orders {
  const F = p.cyl / 2, L = 0.35 + 0.9 * (p.lope ?? 0);
  switch (p.type) {
    case 'single': // big punchy pulse once every two revs
      return [[0.5, 1], [1, 0.7], [1.5, 0.5], [2, 0.38], [2.5, 0.26], [3, 0.2], [3.5, 0.14], [4, 0.1], [5, 0.06], [6, 0.04]];
    case 'vtwin': // uneven "potato" lope: strong half orders
      return [[0.5, 0.85 * L], [1, 1], [1.5, 0.6 * L], [2, 0.55], [2.5, 0.3 * L], [3, 0.3], [4, 0.16], [5, 0.09], [6, 0.05]];
    case 'twin':
      return [[0.5, 0.3 * L], [1, 1], [1.5, 0.2 * L], [2, 0.55], [3, 0.3], [4, 0.18], [5, 0.1], [6, 0.06]];
    case 'i4': // smooth, 2nd-order dominated
      return [[0.5, 0.04], [1, 0.12], [2, 1], [3, 0.06], [4, 0.42], [6, 0.2], [8, 0.08], [10, 0.03]];
    case 'i6': // silky 3rd order
      return [[1.5, 0.1], [3, 1], [4.5, 0.06], [6, 0.38], [9, 0.16], [12, 0.05]];
    case 'v8': // cross-plane burble: rich 0.5/1/1.5... orders around the 4th
      return [[0.5, 0.3 * L], [1, 0.4 * L], [1.5, 0.35 * L], [2, 0.5 * L], [2.5, 0.2 * L], [3, 0.25 * L], [3.5, 0.15 * L],
        [4, 1], [4.5, 0.12 * L], [5, 0.1], [6, 0.2], [8, 0.32], [12, 0.1], [16, 0.03]];
    case 'v10': // clean high scream: almost pure 5th order
      return [[2.5, 0.1], [5, 1], [7.5, 0.05], [10, 0.28], [15, 0.07], [20, 0.02]];
    case 'rotary': // bright but smooth buzz
      return [[F / 2, 0.12], [F, 1], [2 * F, 0.6], [3 * F, 0.42], [4 * F, 0.28], [5 * F, 0.18], [6 * F, 0.1], [7 * F, 0.05]];
    case 'hybrid': // small turbo engine, muffled by the turbine: clean fundamental
      return [[F / 2, 0.12], [F, 1], [1.5 * F, 0.08], [2 * F, 0.32], [3 * F, 0.1], [4 * F, 0.03]];
    case 'twostroke': // fires every rev: raspy "ring-ding", strong harmonics of cyl x crank
      return [[p.cyl, 1], [2 * p.cyl, 0.7], [3 * p.cyl, 0.5], [4 * p.cyl, 0.36], [5 * p.cyl, 0.25], [6 * p.cyl, 0.16], [8 * p.cyl, 0.08]];
    case 'flat': // boxer: unequal-length headers give a half-order burble over the firing order
      return [[0.5, 0.22 * L], [1, 0.3 * L], [F / 2, 0.25 * L], [F, 1], [1.5 * F, 0.18 * L], [2 * F, 0.4], [3 * F, 0.14], [4 * F, 0.05]];
    case 'v12': // V12 / W16: smooth, dense firing order (cyl / 2) with a clean octave
      return [[F / 2, 0.1], [F, 1], [1.5 * F, 0.05], [2 * F, 0.3], [3 * F, 0.08], [4 * F, 0.02]];
    case 'electric': // motor whine: cyl = pole pairs, nearly pure tone with faint inverter harmonics
      return [[F, 1], [2 * F, 0.22], [3 * F, 0.08], [6 * F, 0.04]];
  }
}

/** Per-layout voicing: saturation, body EQ, how far the low-pass opens (× firing freq) and its ceiling. */
const VOICE: Record<EngineProfile['type'], { drive: number; body: number; cut: number; maxCut: number }> = {
  single: { drive: 2.2, body: 180, cut: 9, maxCut: 2200 },
  twin: { drive: 1.5, body: 160, cut: 6, maxCut: 2400 },
  vtwin: { drive: 1.8, body: 110, cut: 7, maxCut: 2000 },
  i4: { drive: 1.2, body: 250, cut: 4, maxCut: 3000 },
  i6: { drive: 1.1, body: 200, cut: 3.5, maxCut: 2800 },
  v8: { drive: 1.6, body: 120, cut: 4, maxCut: 2400 },
  v10: { drive: 1.0, body: 400, cut: 2.5, maxCut: 3400 },
  rotary: { drive: 1.4, body: 300, cut: 4.5, maxCut: 3000 },
  hybrid: { drive: 1.1, body: 220, cut: 3.5, maxCut: 2800 },
  twostroke: { drive: 2.0, body: 350, cut: 7, maxCut: 3200 },
  flat: { drive: 1.4, body: 160, cut: 4, maxCut: 2600 },
  v12: { drive: 1.0, body: 380, cut: 2.6, maxCut: 3400 },
  electric: { drive: 0.6, body: 500, cut: 3, maxCut: 4200 },
};

/** Gentle tanh saturation, normalised so ±1 in gives ±1 out. */
function saturation(drive: number) {
  const n = 2048, curve = new Float32Array(n), norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

/** Band-limited engine waveform at crank order 0.5, plus a level trim so every layout sits at the same loudness. */
function engineWave(ac: AudioContext, p: EngineProfile) {
  const ord = engineOrders(p), amps = new Map<number, number>();
  for (const [o, a] of ord) {
    const k = Math.round(o * 2);
    if (k >= 1) amps.set(k, (amps.get(k) ?? 0) + a);
  }
  const N = Math.max(...amps.keys());
  const real = new Float32Array(N + 1), imag = new Float32Array(N + 1);
  // spread phases (Schroeder-like) so the wave has a low crest factor: more level, less spiky
  for (const [k, a] of amps) {
    const ph = (k * k * Math.PI) / N;
    real[k] = a * Math.sin(ph);
    imag[k] = a * Math.cos(ph);
  }
  // the browser normalises the wave to peak 1; measure the resulting RMS to level-match layouts
  const S = 2048;
  let peak = 0, sq = 0;
  for (let i = 0; i < S; i++) {
    const w = (2 * Math.PI * i) / S;
    let v = 0;
    for (const [k] of amps) v += real[k] * Math.cos(k * w) + imag[k] * Math.sin(k * w);
    peak = Math.max(peak, Math.abs(v));
    sq += v * v;
  }
  const rms = Math.sqrt(sq / S) / (peak || 1);
  return { wave: ac.createPeriodicWave(real, imag), trim: clamp(0.38 / rms, 0.6, 1.6) };
}

export class EngineSound {
  private out: GainNode;
  private osc: OscillatorNode;
  private pre: GainNode;
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
  private windFilt: BiquadFilterNode;
  private windGain: GainNode;
  private rumble: AudioBufferSourceNode;
  private rumbleGain: GainNode;
  private voice: (typeof VOICE)[EngineProfile['type']];

  rpm: number;
  gear = 1;
  private spool = 0;
  private overrun = 0;
  private limiter = 0;
  private wasThrottle = false;
  private shiftDip = 0; // brief torque cut on upshift
  private fatigue = 0; // 0..1, grows while holding high rpm: eases the level down
  private popCool = 0;

  constructor(private ac: AudioContext, dest: AudioNode, noise: AudioBuffer, private p: EngineProfile, private fx: EngineFx) {
    this.rpm = p.idle;
    this.voice = VOICE[p.type];
    const t = ac.currentTime, V = this.voice;
    this.out = ac.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);

    // engine core: one band-limited oscillator -> gentle saturation -> rpm-tracking low-pass -> body EQ
    const { wave, trim } = engineWave(ac, p);
    this.osc = ac.createOscillator();
    this.osc.setPeriodicWave(wave);
    this.pre = ac.createGain();
    this.pre.gain.value = 0.8;
    const shaper = ac.createWaveShaper();
    shaper.curve = saturation(V.drive);
    shaper.oversample = '4x';
    const trimG = ac.createGain();
    trimG.gain.value = trim;
    this.filt = ac.createBiquadFilter();
    this.filt.type = 'lowpass';
    this.filt.Q.value = p.type === 'rotary' ? 1 : 0.7;
    const body = ac.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = V.body;
    body.Q.value = 0.9;
    body.gain.value = 3;
    const hp = ac.createBiquadFilter(); // nothing useful below ~30 Hz, it only eats headroom
    hp.type = 'highpass';
    hp.frequency.value = 30;
    hp.Q.value = 0.6;
    this.engineGain = ac.createGain();
    this.engineGain.gain.value = 0.5;
    // amplitude "lope": uneven firing of V-twins and big V8s (the half orders already carry most of it)
    this.trem = ac.createGain();
    this.trem.gain.value = 1;
    this.lfo = ac.createOscillator();
    this.lfoDepth = ac.createGain();
    this.lfoDepth.gain.value = (p.lope ?? 0) * 0.3;
    this.lfo.connect(this.lfoDepth).connect(this.trem.gain);
    this.osc.connect(this.pre).connect(shaper).connect(trimG).connect(this.filt);
    this.filt.connect(hp).connect(body).connect(this.trem).connect(this.engineGain).connect(this.out);

    // intake breath: narrow-ish band of noise, also through the engine low-pass so it never hisses
    this.intake = ac.createBufferSource();
    this.intake.buffer = noise;
    this.intake.loop = true;
    this.intakeFilt = ac.createBiquadFilter();
    this.intakeFilt.type = 'bandpass';
    this.intakeFilt.Q.value = 1.4;
    this.intakeGain = ac.createGain();
    this.intakeGain.gain.value = 0;
    this.intake.connect(this.intakeFilt).connect(this.intakeGain).connect(this.filt);

    if (p.turbo) {
      this.whistle = ac.createOscillator();
      this.whistle.type = 'sine';
      this.whistleGain = ac.createGain();
      this.whistleGain.gain.value = 0;
      this.whistle.connect(this.whistleGain).connect(this.out);
      this.whistle.start(t);
    }
    if (p.type === 'hybrid' || p.type === 'electric') {
      // ERS / MGU-K whine: soft triangle, low-passed so only a couple of partials remain
      this.whine = ac.createOscillator();
      this.whine.type = 'triangle';
      const wl = ac.createBiquadFilter();
      wl.type = 'lowpass';
      wl.frequency.value = 2200;
      wl.Q.value = 0.5;
      this.whineGain = ac.createGain();
      this.whineGain.gain.value = 0;
      this.whine.connect(wl).connect(this.whineGain).connect(this.out);
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
      src.start(t, Math.random() * 0.9);
      return { src, fl, g };
    };
    const w = mk('bandpass', 400, 0.6), r = mk('lowpass', 150, 0.7);
    this.wind = w.src; this.windFilt = w.fl; this.windGain = w.g;
    this.rumble = r.src; this.rumbleGain = r.g;

    for (const o of [this.osc, this.lfo]) o.start(t);
    this.intake.start(t, Math.random() * 0.9);
  }

  update(dt: number, s: DriveState) {
    const p = this.p, V = this.voice, ac = this.ac, now = ac.currentTime, k = 0.04;
    const frac = clamp(s.speed / Math.max(1, s.top * 1.6), 0, 1); // 0..1 across the whole speed range (incl. nitro)
    // gearbox: each gear spans an equal slice of the speed range; rpm climbs inside the gear, drops on upshift
    const gf = frac * p.gears, gear = clamp(Math.floor(gf) + 1, 1, p.gears);
    if (gear > this.gear && s.riding && !s.air) {
      this.fx.shift();
      this.shiftDip = 0.09;
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
    // rev limiter: a soft bounce at the top of the last gear
    const atLimit = s.throttle && this.rpm > p.redline * 0.96;
    this.limiter = atLimit ? (this.limiter + dt * 12) % 1 : 0;
    const cut = atLimit && this.limiter < 0.35;
    const rpm = this.rpm * (cut ? 0.965 : 1);
    const r = clamp((rpm - p.idle) / Math.max(1, p.redline - p.idle), 0, 1); // 0 idle .. 1 redline
    const pitch = p.pitch ?? 1;
    const base = (rpm / 120) * pitch; // crank order 0.5
    const fire = (rpm / 60) * (p.cyl / 2) * pitch;
    const load = s.throttle || s.boost > 0.2 ? 1 : 0.35;

    this.osc.frequency.setTargetAtTime(base, now, k);
    this.lfo.frequency.setTargetAtTime(Math.max(2, base), now, k);
    this.lfoDepth.gain.setTargetAtTime((p.lope ?? 0) * 0.3 * (1 - r * 0.7), now, 0.1); // lope smooths out with revs
    this.pre.gain.setTargetAtTime(0.65 + load * 0.35, now, 0.06); // more drive under load
    this.filt.frequency.setTargetAtTime(clamp(fire * V.cut * (0.6 + load * 0.4), 350, V.maxCut), now, k);

    // level: quieter idle, full in the mid range, ease off when the limiter / torque cut bites,
    // and a gentle (~-2.5 dB) fatigue trim while you hold high rpm for a long time
    this.shiftDip = Math.max(0, this.shiftDip - dt);
    this.fatigue = lerp(this.fatigue, s.throttle && r > 0.8 ? 1 : 0, damp(dt, s.throttle && r > 0.8 ? 0.25 : 0.8));
    const level = (0.55 + 0.45 * Math.min(1, r / 0.55)) * (0.5 + load * 0.5) * (cut ? 0.8 : 1) * (this.shiftDip > 0 ? 0.65 : 1) * (1 - this.fatigue * 0.25);
    this.engineGain.gain.setTargetAtTime(0.8 * level, now, this.shiftDip > 0 ? 0.015 : k);
    this.intakeFilt.frequency.setTargetAtTime(clamp(fire * 2, 150, 1600), now, k);
    this.intakeGain.gain.setTargetAtTime(load * 0.035 * r * r, now, k);

    // turbo: spools with load and rpm, blows off when you lift
    this.spool = lerp(this.spool, s.throttle && rpm > p.redline * 0.45 ? 1 : 0, damp(dt, s.throttle ? 1.8 : 6));
    if (this.whistle && this.whistleGain) {
      this.whistle.frequency.setTargetAtTime(900 + this.spool * 1500 + r * 200, now, k);
      this.whistleGain.gain.setTargetAtTime(this.spool * this.spool * 0.008, now, k);
    }
    if (this.wasThrottle && !s.throttle && p.turbo && this.spool > 0.5) this.fx.blowoff();
    // overrun crackle: lifting off at high rpm pops through the exhaust (spaced, not machine-gunned)
    if (this.wasThrottle && !s.throttle && rpm > p.redline * 0.55) this.overrun = 0.7;
    this.overrun = Math.max(0, this.overrun - dt);
    this.popCool = Math.max(0, this.popCool - dt);
    if (this.overrun > 0 && this.popCool <= 0 && Math.random() < (p.crackle ?? 0) * 8 * dt) {
      this.fx.pop();
      this.popCool = 0.05 + Math.random() * 0.08;
    }
    this.wasThrottle = s.throttle;
    if (this.whine && this.whineGain) {
      const sr = clamp(s.speed / Math.max(1, s.top), 0, 1.3);
      this.whine.frequency.setTargetAtTime(220 + sr * 1300, now, k);
      this.whineGain.gain.setTargetAtTime(s.riding ? (0.008 + sr * 0.014) * (0.6 + load * 0.4) : 0, now, 0.08);
    }

    const v = s.volume;
    this.out.gain.setTargetAtTime(s.riding ? 0.17 * v : 0, now, 0.08);
    const ws = Math.min(1, (s.speed / 50) ** 2);
    this.windFilt.frequency.setTargetAtTime(350 + ws * 450, now, 0.2);
    this.windGain.gain.setTargetAtTime(ws * 0.055 * v, now, 0.15);
    this.rumbleGain.gain.setTargetAtTime(s.riding && s.offroad && !s.air ? clamp(s.speed / 25, 0, 1) * 0.11 * v : 0, now, 0.1);
  }

  stop() {
    for (const n of [this.osc, this.lfo, this.intake, this.wind, this.rumble, this.whistle, this.whine]) {
      try { n?.stop(); } catch { /* already stopped */ }
    }
    this.out.disconnect();
    this.windGain.disconnect();
    this.rumbleGain.disconnect();
  }
}

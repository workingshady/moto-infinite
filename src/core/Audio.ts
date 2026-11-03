// WebAudio synth: every sound is generated, no audio files to download.
// Mixer: sfx / engines / music buses -> master (mute) -> compressor -> speakers.
import { EngineSound, type EngineProfile } from './EngineSound';
import { Music } from './Music';
import { prefs } from './prefs';

export type SfxName =
  | 'gem' | 'blaster' | 'scatter' | 'rocket' | 'rail' | 'swarm' | 'mine' | 'boom' | 'hit' | 'hurt' | 'crash'
  | 'nitro' | 'pad' | 'level' | 'trick' | 'challenge' | 'fail' | 'orb' | 'power' | 'count' | 'go' | 'select'
  | 'unlock' | 'lap' | 'weapon' | 'mount' | 'jump' | 'thud' | 'cone' | 'crate' | 'thunder' | 'hitmark' | 'story'
  | 'shift' | 'blowoff' | 'pop' | 'clank' | 'whoosh' | 'land';

export interface Engine {
  set(freq: number, filter: number, gain: number): void;
  stop(): void;
}

export class Audio {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null; // mute switch
  private sfx: GainNode | null = null; // effects bus (tone/noise one-shots)
  private engines: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  music: Music | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('moto:muted') === '1';
    } catch {
      /* storage blocked: default to sound on */
    }
  }

  /** Must be called from a user gesture (browser autoplay rules). */
  init() {
    if (this.ac) {
      if (this.ac.state === 'suspended') void this.ac.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ac = new Ctor();
    } catch {
      return;
    }
    const ac = this.ac;
    // a gentle, soft-knee compressor glues everything together and stops explosions from clipping
    // (low ratio + slower release so engines / music don't audibly pump)
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 3;
    comp.attack.value = 0.008;
    comp.release.value = 0.3;
    comp.connect(ac.destination);
    this.master = ac.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(comp);
    // each bus gets a soft high-shelf so nothing sits harshly in the 3-6 kHz "fatigue" zone
    const shelf = (f: number, db: number, to: AudioNode) => {
      const s = ac.createBiquadFilter();
      s.type = 'highshelf';
      s.frequency.value = f;
      s.gain.value = db;
      s.connect(to);
      return s;
    };
    this.sfx = ac.createGain();
    this.sfx.connect(shelf(5000, -3, this.master));
    const engLp = ac.createBiquadFilter();
    engLp.type = 'lowpass';
    engLp.frequency.value = 9000;
    engLp.Q.value = 0.5;
    engLp.connect(this.master);
    this.engines = ac.createGain();
    this.engines.connect(shelf(3200, -4, engLp));
    this.noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.music = new Music(ac, this.master, this.noiseBuf);
    this.applyVolumes();
    this.music.start();
  }

  /** Apply the Music / Effects volume settings (0..1). */
  applyVolumes() {
    if (!this.ac) return;
    this.sfx!.gain.value = 0.75 * prefs.sfx;
    this.engines!.gain.value = 0.9 * prefs.sfx;
    this.music?.setVolume(prefs.music);
  }

  /** Engine + wind + off-road rumble for one vehicle; one-shots (shift, blow-off, crackle) come back through play(). */
  createEngineSound(profile: EngineProfile): EngineSound | null {
    if (!this.ac || !this.engines || !this.noiseBuf) return null;
    return new EngineSound(this.ac, this.engines, this.noiseBuf, profile, {
      shift: () => this.play('shift'),
      blowoff: () => this.play('blowoff'),
      pop: () => this.play('pop'),
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
    try {
      localStorage.setItem('moto:muted', this.muted ? '1' : '0');
    } catch {
      /* not persisted */
    }
    return this.muted;
  }

  tone(f: number, dur: number, type: OscillatorType = 'square', vol = 0.12, slide = 1, delay = 0) {
    const ac = this.ac;
    if (!ac || !this.sfx || this.muted) return;
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur: number, vol = 0.3, freq = 1000, type: BiquadFilterType = 'lowpass') {
    const ac = this.ac;
    if (!ac || !this.sfx || !this.noiseBuf || this.muted) return;
    const t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = this.noiseBuf;
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.2), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t);
    s.stop(t + dur);
  }

  /**
   * Softer filtered-noise burst for vehicle one-shots: short attack (no click), filter sweeps f -> f2,
   * random buffer offset so repeats never sound identical.
   */
  private burst(dur: number, vol: number, f: number, f2: number, type: BiquadFilterType = 'lowpass', q = 0.8, attack = 0.004, delay = 0) {
    const ac = this.ac;
    if (!ac || !this.sfx || !this.noiseBuf || this.muted) return;
    const t = ac.currentTime + delay, s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = this.noiseBuf;
    fl.type = type;
    fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t);
    fl.frequency.exponentialRampToValueAtTime(Math.max(40, f2), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(this.sfx);
    s.start(t, Math.random() * 0.8);
    s.stop(t + dur + 0.02);
  }

  /** Soft sine/triangle thump with a click-free attack. */
  private thump(f: number, dur: number, vol: number, slide = 0.6, type: OscillatorType = 'sine', delay = 0) {
    const ac = this.ac;
    if (!ac || !this.sfx || this.muted) return;
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private previewStop: (() => void) | null = null;

  /**
   * Garage "hear engine": a temporary EngineSound blips, revs from idle to the limiter and back over `seconds`.
   * Call from a user gesture (it initialises audio if needed). Returns a function that stops it early.
   */
  previewEngine(profile: EngineProfile, seconds = 3.5): () => void {
    this.init();
    this.previewStop?.();
    const eng = this.createEngineSound(profile);
    if (!eng) return () => {};
    let last = performance.now(), el = 0, done = false;
    const S = Math.max(1.5, seconds);
    const stop = () => {
      if (done) return;
      done = true;
      clearInterval(id);
      eng.update(0.016, { speed: 0, top: 30, throttle: false, boost: 0, air: false, riding: false, offroad: false, volume: 1 });
      window.setTimeout(() => eng.stop(), 400); // let the output fade before tearing down
      if (this.previewStop === stop) this.previewStop = null;
    };
    const id = window.setInterval(() => {
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      el += dt;
      const x = el / S;
      if (x >= 1) return stop();
      // idle -> short blip -> idle -> full rev into the limiter -> lift (crackle / blow-off) -> idle
      const throttle = (x > 0.15 && x < 0.27) || (x > 0.45 && x < 0.75);
      eng.update(dt, { speed: 0, top: 30, throttle, boost: 0, air: true, riding: true, offroad: false, volume: 1 });
    }, 16);
    this.previewStop = stop;
    return stop;
  }

  play(name: SfxName, v = 1) {
    const T = this.tone.bind(this), N = this.noise.bind(this), B = this.burst.bind(this), K = this.thump.bind(this);
    const rr = (a: number, b: number) => a + Math.random() * (b - a);
    switch (name) {
      case 'gem': T(880, 0.09, 'triangle', 0.14); T(1320, 0.14, 'triangle', 0.12, 1, 0.07); break;
      case 'blaster': T(1100, 0.09, 'square', 0.05, 0.35); break;
      case 'scatter': N(0.18, 0.25, 2500); T(300, 0.1, 'square', 0.05, 0.5); break;
      case 'rocket': T(180, 0.35, 'sawtooth', 0.09, 0.5); N(0.3, 0.15, 900); break;
      case 'rail': T(2200, 0.25, 'sawtooth', 0.07, 0.2); N(0.2, 0.2, 5000, 'highpass'); break;
      case 'swarm': [0, 0.05, 0.1].forEach((d) => T(700, 0.12, 'triangle', 0.05, 1.8, d)); break;
      case 'mine': T(220, 0.12, 'square', 0.08, 1.5); T(440, 0.08, 'square', 0.05, 1, 0.1); break;
      case 'boom': N(0.9, 0.55 * v, 900); T(70, 0.6, 'sine', 0.35 * v, 0.4); break;
      case 'hit': T(260, 0.06, 'square', 0.06, 0.6); break;
      case 'hurt': T(160, 0.18, 'sawtooth', 0.12, 0.5); break;
      case 'crash': B(rr(0.4, 0.55), 0.3, rr(800, 1100), 150, 'lowpass', 0.7, 0.005); K(rr(75, 90), 0.32, 0.18, 0.55); B(0.12, 0.05, 2200, 1200, 'bandpass', 1.5, 0.003, 0.02); break;
      case 'nitro': B(0.6, 0.1, rr(1300, 1600), 600, 'bandpass', 0.8, 0.04); K(90, 0.5, 0.06, 0.8); break;
      case 'pad': T(500, 0.3, 'sine', 0.12, 2.5); break;
      case 'level': [523, 659, 784, 1046].forEach((f, i) => T(f, 0.18, 'triangle', 0.13, 1, i * 0.09)); break;
      case 'trick': T(660, 0.1, 'triangle', 0.1); T(990, 0.16, 'triangle', 0.1, 1, 0.08); break;
      case 'challenge': [392, 523, 659, 784, 1046].forEach((f, i) => T(f, 0.16, 'square', 0.07, 1, i * 0.08)); break;
      case 'fail': T(300, 0.25, 'sawtooth', 0.08, 0.6); T(200, 0.35, 'sawtooth', 0.08, 0.6, 0.2); break;
      case 'orb': T(420, 0.15, 'sine', 0.05, 0.6); break;
      case 'power': [660, 880, 1320].forEach((f, i) => T(f, 0.14, 'sine', 0.12, 1, i * 0.06)); break;
      case 'count': T(440, 0.18, 'square', 0.1); break;
      case 'go': T(880, 0.45, 'square', 0.12); break;
      case 'select': T(700, 0.06, 'triangle', 0.08); break;
      case 'unlock': [523, 784, 1046, 1568].forEach((f, i) => T(f, 0.2, 'triangle', 0.12, 1, i * 0.1)); break;
      case 'lap': T(784, 0.15, 'square', 0.08); T(1175, 0.25, 'square', 0.08, 1, 0.12); break;
      case 'weapon': T(600 + v * 120, 0.08, 'triangle', 0.08); break;
      case 'mount': T(120, 0.4, 'sawtooth', 0.1, 2); break;
      case 'jump': T(300, 0.12, 'triangle', 0.06, 1.6); break;
      case 'thud': K(90, 0.15, 0.1, 0.6, 'triangle'); break;
      case 'cone': T(500, 0.06, 'triangle', 0.06); break;
      case 'crate': K(140, 0.15, 0.1, 0.5, 'triangle'); B(0.08, 0.05, 1200, 400, 'bandpass', 1.2); break;
      // gearbox clunk + short exhaust bark (soft, low, a little random)
      case 'shift': B(0.035, 0.045, rr(1000, 1400), 600, 'bandpass', 1.2, 0.002); K(rr(95, 120), 0.07, 0.06, 0.6); break;
      // turbo "pssh": mid band, not a 6 kHz hiss
      case 'blowoff': B(rr(0.28, 0.36), 0.035, rr(2200, 2700), 1100, 'bandpass', 0.8, 0.015); break;
      // overrun crackle: dull pop + tiny thump, varied
      case 'pop': B(rr(0.03, 0.05), rr(0.1, 0.16), rr(700, 1300), 200, 'lowpass', 0.8, 0.002); K(rr(70, 110), 0.05, 0.06, 0.6); break;
      case 'clank':
        B(0.15, 0.08, rr(1300, 1700), 900, 'bandpass', 3, 0.002);
        K(rr(220, 260), 0.18, 0.07, 0.8, 'triangle');
        K(rr(560, 620), 0.12, 0.025, 0.95, 'sine', 0.01); // inharmonic partial: metallic, not buzzy
        break;
      case 'whoosh': B(0.6, 0.12, 450, 1500, 'bandpass', 0.9, 0.18); K(180, 0.5, 0.025, 2); break;
      case 'land': B(0.2, 0.22 * v, rr(240, 300), 80, 'lowpass', 0.7, 0.004); K(rr(60, 72), 0.18, 0.16 * v, 0.6); break;
      case 'thunder': N(2.8, 0.5, 260); T(45, 2, 'sine', 0.25, 0.6); break;
      case 'hitmark': T(1600, 0.04, 'square', 0.04, 0.8); break;
      case 'story': [392, 494, 587].forEach((f, i) => T(f, 0.5, 'sine', 0.08, 1, i * 0.18)); break;
    }
  }

  /**
   * Looping tyre screech (band-passed noise); gain and pitch follow slip angle and speed.
   * Pitch is mapped into a 700-1500 Hz band and wobbles slightly, gain is scaled down with a slow
   * attack / slower release, and a low-pass removes the hiss, so it reads as a squeal, not a whistle.
   */
  createScreech(): Engine | null {
    const ac = this.ac;
    if (!ac || !this.master || !this.noiseBuf) return null;
    const src = ac.createBufferSource(), filt = ac.createBiquadFilter(), lp = ac.createBiquadFilter(), gain = ac.createGain();
    src.buffer = this.noiseBuf;
    src.loop = true;
    filt.type = 'bandpass';
    filt.Q.value = 4;
    filt.frequency.value = 1000;
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    lp.Q.value = 0.5;
    // slow wobble on the band centre so a long slide isn't a static tone
    const wob = ac.createOscillator(), wobG = ac.createGain();
    wob.frequency.value = 5.5;
    wobG.gain.value = 45;
    wob.connect(wobG).connect(filt.frequency);
    gain.gain.value = 0;
    src.connect(filt).connect(lp).connect(gain).connect(this.engines ?? this.master);
    src.start(0, Math.random() * 0.9);
    wob.start();
    let cur = 0;
    return {
      set(freq, _filter, g) {
        const target = g * 0.6, now = ac.currentTime;
        filt.frequency.setTargetAtTime(Math.min(1500, Math.max(700, 500 + freq * 0.4)), now, 0.12);
        gain.gain.setTargetAtTime(target, now, target > cur ? 0.1 : 0.18);
        cur = target;
      },
      stop() {
        try { src.stop(); wob.stop(); gain.disconnect(); } catch { /* already stopped */ }
      },
    };
  }

  /**
   * Cold-gas thruster hiss loop (Tesla Roadster "SpaceX package"): bright high-passed noise with a little
   * flutter. set(level 0..1.2, _, gain): level brightens the hiss, gain is the loop volume.
   */
  createHiss(): Engine | null {
    const ac = this.ac;
    if (!ac || !this.master || !this.noiseBuf) return null;
    const src = ac.createBufferSource(), hp = ac.createBiquadFilter(), bp = ac.createBiquadFilter(), gain = ac.createGain();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 1.3;
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    hp.Q.value = 0.7;
    bp.type = 'peaking';
    bp.frequency.value = 4200;
    bp.Q.value = 0.8;
    bp.gain.value = 5;
    const flut = ac.createOscillator(), flutG = ac.createGain();
    flut.frequency.value = 17;
    flutG.gain.value = 0;
    flut.connect(flutG).connect(gain.gain);
    gain.gain.value = 0;
    src.connect(hp).connect(bp).connect(gain).connect(this.engines ?? this.master);
    src.start(0, Math.random() * 0.9);
    flut.start();
    return {
      set(level, _filter, g) {
        const now = ac.currentTime;
        hp.frequency.setTargetAtTime(1500 + level * 900, now, 0.05);
        gain.gain.setTargetAtTime(g, now, g > 0 ? 0.03 : 0.12); // sharp valve open, softer close
        flutG.gain.setTargetAtTime(g * 0.15, now, 0.05);
      },
      stop() {
        try { src.stop(); flut.stop(); gain.disconnect(); } catch { /* already stopped */ }
      },
    };
  }
}

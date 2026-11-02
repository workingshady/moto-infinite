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
    // a gentle compressor glues everything together and stops explosions from clipping
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(ac.destination);
    this.master = ac.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(comp);
    this.sfx = ac.createGain();
    this.sfx.connect(this.master);
    this.engines = ac.createGain();
    this.engines.connect(this.master);
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
    this.engines!.gain.value = prefs.sfx;
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

  play(name: SfxName, v = 1) {
    const T = this.tone.bind(this), N = this.noise.bind(this);
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
      case 'crash': N(0.5, 0.4, 600); T(90, 0.35, 'square', 0.1, 0.5); break;
      case 'nitro': N(0.55, 0.22, 3000, 'bandpass'); break;
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
      case 'thud': T(90, 0.15, 'square', 0.08, 0.6); break;
      case 'cone': T(500, 0.06, 'square', 0.05); break;
      case 'crate': T(140, 0.15, 'square', 0.08, 0.5); break;
      case 'shift': N(0.05, 0.08, 1800, 'bandpass'); T(90, 0.06, 'square', 0.05, 0.7); break; // gearbox clack + exhaust bark
      case 'blowoff': N(0.45, 0.07, 6000, 'highpass'); break; // turbo "pssh"
      case 'pop': N(0.04, 0.2 + Math.random() * 0.15, 900 + Math.random() * 900); break; // overrun crackle
      case 'clank': T(180, 0.25, 'square', 0.09, 0.6); T(410, 0.18, 'triangle', 0.07, 0.8, 0.02); N(0.3, 0.25, 4000, 'highpass'); break;
      case 'whoosh': N(0.7, 0.28, 2600, 'bandpass'); T(220, 0.5, 'sawtooth', 0.04, 2.2); break;
      case 'land': N(0.25, 0.3 * v, 300); T(70, 0.18, 'sine', 0.2 * v, 0.6); break;
      case 'thunder': N(2.8, 0.5, 260); T(45, 2, 'sine', 0.25, 0.6); break;
      case 'hitmark': T(1600, 0.04, 'square', 0.04, 0.8); break;
      case 'story': [392, 494, 587].forEach((f, i) => T(f, 0.5, 'sine', 0.08, 1, i * 0.18)); break;
    }
  }

  /** Looping tyre screech (band-passed noise); gain and pitch follow slip angle and speed. */
  createScreech(): Engine | null {
    const ac = this.ac;
    if (!ac || !this.master || !this.noiseBuf) return null;
    const src = ac.createBufferSource(), filt = ac.createBiquadFilter(), gain = ac.createGain();
    src.buffer = this.noiseBuf;
    src.loop = true;
    filt.type = 'bandpass';
    filt.Q.value = 6;
    filt.frequency.value = 1800;
    gain.gain.value = 0;
    src.connect(filt).connect(gain).connect(this.engines ?? this.master);
    src.start();
    return {
      set(freq, _filter, g) {
        filt.frequency.setTargetAtTime(freq, ac.currentTime, 0.05);
        gain.gain.setTargetAtTime(g, ac.currentTime, 0.06);
      },
      stop() {
        try { src.stop(); gain.disconnect(); } catch { /* already stopped */ }
      },
    };
  }
}

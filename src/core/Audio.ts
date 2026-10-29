// WebAudio synth: every sound is generated, no audio files to download.

export type SfxName =
  | 'gem' | 'blaster' | 'scatter' | 'rocket' | 'rail' | 'swarm' | 'mine' | 'boom' | 'hit' | 'hurt' | 'crash'
  | 'nitro' | 'pad' | 'level' | 'trick' | 'challenge' | 'fail' | 'orb' | 'power' | 'count' | 'go' | 'select'
  | 'unlock' | 'lap' | 'weapon' | 'mount' | 'jump' | 'thud' | 'cone' | 'crate' | 'thunder' | 'hitmark' | 'story';

export interface Engine {
  set(freq: number, filter: number, gain: number): void;
  stop(): void;
}

export class Audio {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
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
    this.master = this.ac.createGain();
    this.master.gain.value = this.muted ? 0 : 0.45;
    this.master.connect(this.ac.destination);
    this.noiseBuf = this.ac.createBuffer(1, this.ac.sampleRate, this.ac.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.45;
    try {
      localStorage.setItem('moto:muted', this.muted ? '1' : '0');
    } catch {
      /* not persisted */
    }
    return this.muted;
  }

  tone(f: number, dur: number, type: OscillatorType = 'square', vol = 0.12, slide = 1, delay = 0) {
    const ac = this.ac;
    if (!ac || !this.master || this.muted) return;
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur: number, vol = 0.3, freq = 1000, type: BiquadFilterType = 'lowpass') {
    const ac = this.ac;
    if (!ac || !this.master || !this.noiseBuf || this.muted) return;
    const t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = this.noiseBuf;
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.2), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
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
      case 'thunder': N(2.8, 0.5, 260); T(45, 2, 'sine', 0.25, 0.6); break;
      case 'hitmark': T(1600, 0.04, 'square', 0.04, 0.8); break;
      case 'story': [392, 494, 587].forEach((f, i) => T(f, 0.5, 'sine', 0.08, 1, i * 0.18)); break;
    }
  }

  createEngine(): Engine | null {
    const ac = this.ac;
    if (!ac || !this.master) return null;
    const osc = ac.createOscillator(), filt = ac.createBiquadFilter(), gain = ac.createGain();
    osc.type = 'sawtooth';
    filt.type = 'lowpass';
    filt.frequency.value = 500;
    gain.gain.value = 0;
    osc.connect(filt).connect(gain).connect(this.master);
    osc.start();
    return {
      set(freq, filter, g) {
        osc.frequency.setTargetAtTime(freq, ac.currentTime, 0.05);
        filt.frequency.setTargetAtTime(filter, ac.currentTime, 0.05);
        gain.gain.setTargetAtTime(g, ac.currentTime, 0.05);
      },
      stop() {
        try {
          osc.stop();
          gain.disconnect();
        } catch {
          /* already stopped */
        }
      },
    };
  }
}

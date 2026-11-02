// Generative synthwave soundtrack. A lookahead scheduler (audio clock, not timers) queues 16th-note steps
// slightly ahead. Layers come in with intensity: 0 menu pads, 1 riding drums+bass, 2 fast/drifting arp, 3 action lead.

const STEP_AHEAD = 0.12; // seconds scheduled in advance
const TICK_MS = 25;

// chord progressions (semitone offsets from the key root) for a little variety per song
const PROGRESSIONS = [
  [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], // i  VI III VII
  [[0, 3, 7], [5, 8, 12], [-2, 2, 5], [3, 7, 10]], // i  iv VII III
  [[0, 3, 7], [-4, 0, 3], [-7, -3, 0], [-2, 2, 5]], // i  VI iv VII
];
const KEYS = [57, 52, 55, 50]; // A, E, G, D (MIDI roots)
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Music {
  private bus: GainNode;
  private tone: BiquadFilterNode;
  private delay: DelayNode;
  private timer = 0;
  private next = 0;
  private step = 0;
  private bpm = 112;
  private key = 57;
  private prog = PROGRESSIONS[0];
  intensity = 0;
  private target = 0;

  constructor(private ac: AudioContext, dest: AudioNode, private noise: AudioBuffer) {
    this.bus = ac.createGain();
    this.bus.gain.value = 0.5;
    this.tone = ac.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 1200;
    this.bus.connect(this.tone).connect(dest);
    // simple feedback echo for the arp/lead
    this.delay = ac.createDelay(1);
    const fb = ac.createGain();
    fb.gain.value = 0.32;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(this.bus);
  }

  start() {
    if (this.timer) return;
    this.newSong();
    this.next = this.ac.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = 0;
  }

  /** 0 = menu, 1 = riding, 2 = fast / drifting, 3 = action. Menu also muffles the mix. */
  setIntensity(level: number) {
    this.target = level;
    const f = level === 0 ? 1400 : 16000;
    this.tone.frequency.setTargetAtTime(f, this.ac.currentTime, 0.6);
  }

  setVolume(v: number) {
    this.bus.gain.setTargetAtTime(v * 0.55, this.ac.currentTime, 0.2);
  }

  private newSong() {
    this.key = KEYS[Math.floor(Math.random() * KEYS.length)];
    this.prog = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
    this.bpm = 104 + Math.floor(Math.random() * 20);
    this.delay.delayTime.value = (60 / this.bpm) * 0.75; // dotted-8th echo
  }

  private schedule() {
    const spb = 60 / this.bpm / 4; // seconds per 16th
    while (this.next < this.ac.currentTime + STEP_AHEAD) {
      this.playStep(this.step, this.next, spb);
      this.next += spb;
      this.step++;
      if (this.step % 16 === 0) this.intensity += Math.sign(this.target - this.intensity); // layers change on the bar
      if (this.step % (16 * 32) === 0) this.newSong(); // fresh key/progression every 32 bars
    }
  }

  private playStep(step: number, t: number, spb: number) {
    const s16 = step % 16, bar = Math.floor(step / 16), chord = this.prog[bar % 4].map((x) => this.key + x), lvl = this.intensity;
    // pads: one long chord per bar, always on
    if (s16 === 0) for (const n of chord) this.pad(midi(n), t, spb * 16);
    if (lvl >= 1) {
      if (s16 % 4 === 0) this.kick(t);
      if (s16 === 4 || s16 === 12) this.snare(t);
      if (s16 % 2 === 0) this.hat(t, s16 % 4 === 2 ? 0.07 : 0.04);
      if (s16 % 2 === 0) this.bass(midi(chord[0] - 24 + (s16 % 8 === 6 ? 12 : 0)), t, spb * 1.8);
    } else if (s16 === 0 || s16 === 8) this.bass(midi(chord[0] - 24), t, spb * 7);
    if (lvl >= 2) {
      const arp = [0, 1, 2, 1, 2, 0, 2, 1];
      this.pluck(midi(chord[arp[s16 % 8]] + 12), t, spb * 0.9, 0.05);
    }
    if (lvl >= 3 && s16 % 4 === 2) {
      const melody = [2, 1, 0, 1];
      this.pluck(midi(chord[melody[(s16 >> 2) % 4]] + 24), t, spb * 3, 0.04);
      if (s16 === 14) this.snare(t, 0.12);
    }
  }

  private env(g: GainNode, t: number, a: number, peak: number, dur: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private pad(f: number, t: number, dur: number) {
    const ac = this.ac, g = ac.createGain(), lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    for (const d of [-7, 7]) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = d;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    lp.connect(g).connect(this.bus);
    this.env(g, t, dur * 0.3, 0.035, dur);
  }

  private bass(f: number, t: number, dur: number) {
    const ac = this.ac, o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.value = f;
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + dur);
    o.connect(lp).connect(g).connect(this.bus);
    this.env(g, t, 0.01, 0.12, dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pluck(f: number, t: number, dur: number, vol: number) {
    const ac = this.ac, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(g);
    g.connect(this.bus);
    g.connect(this.delay);
    this.env(g, t, 0.005, vol, dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number) {
    const ac = this.ac, o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(g).connect(this.bus);
    this.env(g, t, 0.003, 0.5, 0.22);
    o.start(t);
    o.stop(t + 0.25);
  }

  private snare(t: number, vol = 0.18) {
    const ac = this.ac, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = this.noise;
    f.type = 'bandpass';
    f.frequency.value = 1800;
    s.connect(f).connect(g).connect(this.bus);
    this.env(g, t, 0.002, vol, 0.16);
    s.start(t, Math.random() * 0.5);
    s.stop(t + 0.18);
  }

  private hat(t: number, vol: number) {
    const ac = this.ac, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = this.noise;
    f.type = 'highpass';
    f.frequency.value = 7000;
    s.connect(f).connect(g).connect(this.bus);
    this.env(g, t, 0.001, vol, 0.04);
    s.start(t, Math.random() * 0.5);
    s.stop(t + 0.05);
  }
}

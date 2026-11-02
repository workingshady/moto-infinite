// Generative synthwave soundtrack. A lookahead scheduler (audio clock, not timers) queues 16th-note steps
// slightly ahead. Layers come in with intensity: 0 menu pads, 1 riding drums+bass, 2 fast/drifting arp, 3 action lead.
// Voiced to sit softly under the game: warm filtered pads, round bass, quiet hats, triangle/filtered-saw
// leads through a dark feedback echo. Patterns, fills and voicings vary per song so loops don't grate.

const STEP_AHEAD = 0.12; // seconds scheduled in advance
const TICK_MS = 25;

// chord progressions (semitone offsets from the key root) for a little variety per song
const PROGRESSIONS = [
  [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], // i  VI III VII
  [[0, 3, 7], [5, 8, 12], [-2, 2, 5], [3, 7, 10]], // i  iv VII III
  [[0, 3, 7], [-4, 0, 3], [-7, -3, 0], [-2, 2, 5]], // i  VI iv VII
  [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-5, -2, 2]], // i  VII VI v
  [[0, 3, 7, 10], [-4, 0, 3, 7], [5, 8, 12], [-2, 2, 5, 9]], // i7 VImaj7 iv VII
];
const KEYS = [57, 52, 55, 50, 53]; // A, E, G, D, F (MIDI roots)
const ARPS = [
  [0, 1, 2, 1, 2, 0, 2, 1],
  [0, 2, 1, 2, 0, 2, 1, 2],
  [0, 1, 2, 3, 2, 1, 0, 1],
  [2, 1, 0, 1, 2, 1, 0, 2],
];
const MELODIES = [
  [2, 1, 0, 1],
  [0, 2, 1, -1],
  [1, 2, 3, 2],
  [2, -1, 1, 0],
]; // -1 = rest
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export class Music {
  private bus: GainNode;
  private tone: BiquadFilterNode;
  private delay: DelayNode;
  private send: GainNode;
  private timer = 0;
  private next = 0;
  private step = 0;
  private bpm = 112;
  private key = 57;
  private prog = PROGRESSIONS[0];
  private arp = ARPS[0];
  private melody = MELODIES[0];
  private hatOpen = false; // song-level groove choice
  intensity = 0;
  private target = 0;

  constructor(private ac: AudioContext, dest: AudioNode, private noise: AudioBuffer) {
    this.bus = ac.createGain();
    this.bus.gain.value = 0.5;
    this.tone = ac.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 1200;
    this.tone.Q.value = 0.5;
    // keep the music out of the engines' way: slight dip in the upper mids, soft top end
    const mid = ac.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 2500;
    mid.Q.value = 0.8;
    mid.gain.value = -3;
    const top = ac.createBiquadFilter();
    top.type = 'highshelf';
    top.frequency.value = 6000;
    top.gain.value = -6;
    this.bus.connect(this.tone).connect(mid).connect(top).connect(dest);
    // dark feedback echo (reverb-ish tail) for pads / arp / lead: each repeat is filtered further
    this.delay = ac.createDelay(1);
    this.send = ac.createGain();
    this.send.gain.value = 0.5;
    const fb = ac.createGain(), damp = ac.createBiquadFilter();
    fb.gain.value = 0.38;
    damp.type = 'lowpass';
    damp.frequency.value = 2200;
    damp.Q.value = 0.5;
    this.send.connect(this.delay);
    this.delay.connect(damp).connect(fb).connect(this.delay);
    damp.connect(this.bus);
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
    const f = level === 0 ? 1400 : 9000;
    this.tone.frequency.setTargetAtTime(f, this.ac.currentTime, 0.6);
  }

  setVolume(v: number) {
    this.bus.gain.setTargetAtTime(v * 0.5, this.ac.currentTime, 0.2);
  }

  private newSong() {
    this.key = pick(KEYS);
    this.prog = pick(PROGRESSIONS);
    this.arp = pick(ARPS);
    this.melody = pick(MELODIES);
    this.hatOpen = Math.random() < 0.5;
    this.bpm = 100 + Math.floor(Math.random() * 20);
    this.delay.delayTime.setValueAtTime((60 / this.bpm) * 0.75, this.ac.currentTime); // dotted-8th echo
  }

  private schedule() {
    const spb = 60 / this.bpm / 4; // seconds per 16th
    while (this.next < this.ac.currentTime + STEP_AHEAD) {
      this.playStep(this.step, this.next, spb);
      this.next += spb;
      this.step++;
      if (this.step % 16 === 0) this.intensity += Math.sign(this.target - this.intensity); // layers change on the bar
      if (this.step % (16 * 24) === 0) this.newSong(); // fresh key/progression/patterns every 24 bars
    }
  }

  private playStep(step: number, t: number, spb: number) {
    const s16 = step % 16, bar = Math.floor(step / 16), lvl = this.intensity;
    const chord = this.prog[bar % 4].map((x) => this.key + x);
    const phrase = bar % 8, fill = phrase === 7 && s16 >= 12; // every 8th bar ends with a small fill
    const hum = () => 0.85 + Math.random() * 0.3; // velocity humanisation
    // pads: one long chord per bar, always on; top voice dropped an octave on alternate phrases for variety
    if (s16 === 0) chord.forEach((n, i) => this.pad(midi(n - (i === chord.length - 1 && bar % 16 >= 8 ? 12 : 0)), t, spb * 16));
    if (lvl >= 1) {
      if (s16 % 4 === 0 && !(fill && s16 === 12)) this.kick(t, s16 === 0 ? 0.42 : 0.36);
      if (s16 === 4 || s16 === 12) this.snare(t, 0.09 * hum());
      if (fill && (s16 === 13 || s16 === 14 || s16 === 15)) this.snare(t, 0.04 + (s16 - 13) * 0.015);
      if (s16 % 2 === 0) this.hat(t, (s16 % 4 === 2 ? 0.022 : 0.012) * hum(), this.hatOpen && s16 % 4 === 2 ? 0.09 : 0.035);
      if (s16 % 2 === 0) this.bass(midi(chord[0] - 24 + (s16 % 8 === 6 ? 12 : 0)), t, spb * 1.8, 0.1 * hum());
    } else if (s16 === 0 || s16 === 8) this.bass(midi(chord[0] - 24), t, spb * 7, 0.08);
    if (lvl >= 2) {
      const n = chord[this.arp[s16 % 8] % chord.length] + 12;
      if (!(phrase === 3 && s16 >= 8)) this.pluck(midi(n), t, spb * 0.9, 0.035 * hum(), 'triangle');
    }
    if (lvl >= 3 && s16 % 4 === 2) {
      const m = this.melody[((s16 >> 2) + (bar % 2) * 2) % 4];
      if (m >= 0 && Math.random() > 0.12) this.pluck(midi(chord[m % chord.length] + 24), t, spb * 3, 0.022 * hum(), 'sawtooth');
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
    lp.Q.value = 0.5;
    // slow filter swell: opens and closes over the bar, warm rather than buzzy
    lp.frequency.setValueAtTime(450, t);
    lp.frequency.linearRampToValueAtTime(800, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(500, t + dur);
    const voices: [OscillatorType, number][] = [['triangle', -6], ['sawtooth', 5]];
    for (const [type, d] of voices) {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = d;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    lp.connect(g);
    g.connect(this.bus);
    const s = ac.createGain();
    s.gain.value = 0.35;
    g.connect(s).connect(this.send);
    this.env(g, t, dur * 0.35, 0.026, dur);
  }

  private bass(f: number, t: number, dur: number, vol: number) {
    const ac = this.ac, o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.value = f;
    lp.type = 'lowpass';
    lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(650, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + dur);
    o.connect(lp).connect(g).connect(this.bus);
    this.env(g, t, 0.012, vol, dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pluck(f: number, t: number, dur: number, vol: number, type: OscillatorType) {
    const ac = this.ac, o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
    o.type = type;
    o.frequency.value = f;
    lp.type = 'lowpass';
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(Math.min(4000, f * 4), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.2), t + dur);
    o.connect(lp).connect(g);
    g.connect(this.bus);
    g.connect(this.send);
    this.env(g, t, 0.008, vol, dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number, vol: number) {
    const ac = this.ac, o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    o.connect(g).connect(this.bus);
    this.env(g, t, 0.004, vol, 0.22);
    o.start(t);
    o.stop(t + 0.25);
  }

  private snare(t: number, vol: number) {
    const ac = this.ac, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = this.noise;
    f.type = 'bandpass';
    f.frequency.value = 1500;
    f.Q.value = 0.8;
    s.connect(f).connect(g).connect(this.bus);
    this.env(g, t, 0.003, vol, 0.15);
    s.start(t, Math.random() * 0.5);
    s.stop(t + 0.17);
    // tonal body so it isn't just a burst of hiss
    const o = ac.createOscillator(), og = ac.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    o.connect(og).connect(this.bus);
    this.env(og, t, 0.003, vol * 0.6, 0.09);
    o.start(t);
    o.stop(t + 0.1);
  }

  private hat(t: number, vol: number, len: number) {
    const ac = this.ac, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = this.noise;
    f.type = 'bandpass'; // band, not open highpass: a soft "tss" without the ice-pick top end
    f.frequency.value = 7500;
    f.Q.value = 0.9;
    s.connect(f).connect(g).connect(this.bus);
    this.env(g, t, 0.002, vol, len);
    s.start(t, Math.random() * 0.5);
    s.stop(t + len + 0.01);
  }
}

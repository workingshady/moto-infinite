// Electric-motor voice for EngineSound profiles of type 'electric' (Tesla cars): no firing pulses, gearbox,
// turbo or crackle. A single-speed motor whines in step with road speed:
//  - inverter tone: the switching whine, strongest under load at low speed, a "spaceship" rise off the line
//  - gear whine: reduction-gear mesh, a clean sine (plus a soft 2nd harmonic) climbing with motor speed
//  - tyre roar and extra wind: what you mostly hear in an EV at speed
// `r` is the motor speed 0..1 (EngineSound's rpm ratio), so it also revs in the garage preview.
import { clamp } from '../utils/math';
import type { DriveState } from './EngineSound';

export class EvVoice {
  private inv: OscillatorNode;
  private invGain: GainNode;
  private gear: OscillatorNode;
  private gear2: OscillatorNode;
  private gearGain: GainNode;
  private tyre: AudioBufferSourceNode;
  private tyreFilt: BiquadFilterNode;
  private tyreGain: GainNode;
  private air: AudioBufferSourceNode;
  private airGain: GainNode;

  constructor(ac: AudioContext, out: AudioNode, dest: AudioNode, noise: AudioBuffer) {
    const t = ac.currentTime;
    this.inv = ac.createOscillator();
    this.inv.type = 'triangle';
    const invBp = ac.createBiquadFilter();
    invBp.type = 'bandpass';
    invBp.frequency.value = 1600;
    invBp.Q.value = 1.2;
    this.invGain = ac.createGain();
    this.invGain.gain.value = 0;
    this.inv.connect(invBp).connect(this.invGain).connect(out);

    this.gear = ac.createOscillator();
    this.gear.type = 'sine';
    this.gear2 = ac.createOscillator();
    this.gear2.type = 'sine';
    const g2 = ac.createGain();
    g2.gain.value = 0.3;
    this.gearGain = ac.createGain();
    this.gearGain.gain.value = 0;
    this.gear.connect(this.gearGain);
    this.gear2.connect(g2).connect(this.gearGain);
    this.gearGain.connect(out);

    const noiseBand = (type: BiquadFilterType, f: number, q: number) => {
      const src = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = noise;
      src.loop = true;
      src.playbackRate.value = 0.6 + Math.random() * 0.2;
      fl.type = type;
      fl.frequency.value = f;
      fl.Q.value = q;
      g.gain.value = 0;
      src.connect(fl).connect(g).connect(dest);
      src.start(t, Math.random() * 0.9);
      return { src, fl, g };
    };
    const ty = noiseBand('lowpass', 450, 0.9), ai = noiseBand('highpass', 1400, 0.5);
    this.tyre = ty.src; this.tyreFilt = ty.fl; this.tyreGain = ty.g;
    this.air = ai.src; this.airGain = ai.g;
    for (const o of [this.inv, this.gear, this.gear2]) o.start(t);
  }

  update(now: number, r: number, load: number, s: DriveState) {
    const k = 0.04, on = s.riding ? 1 : 0;
    // inverter: rises fast off the line, then fades as the gear whine takes over
    this.inv.frequency.setTargetAtTime(700 + clamp(r * 3, 0, 1) * 1400 + r * 600, now, k);
    this.invGain.gain.setTargetAtTime(on * load * (0.05 + 0.1 * clamp(1 - r * 1.6, 0, 1)) * clamp(r * 8, 0, 1), now, 0.06);
    const gf = 260 + r * 2900;
    this.gear.frequency.setTargetAtTime(gf, now, k);
    this.gear2.frequency.setTargetAtTime(gf * 2, now, k);
    this.gearGain.gain.setTargetAtTime(on * (0.04 + 0.16 * r) * (0.55 + 0.45 * load) * clamp(r * 6, 0, 1), now, 0.06);
    // tyres + extra wind: dominant at speed
    const v = s.volume, sp = clamp(s.speed / 40, 0, 1.3), grounded = s.riding && !s.air ? 1 : 0;
    this.tyreFilt.frequency.setTargetAtTime(300 + sp * 500, now, 0.2);
    this.tyreGain.gain.setTargetAtTime(grounded * sp * 0.075 * v, now, 0.12);
    this.airGain.gain.setTargetAtTime(Math.min(1, sp * sp) * 0.025 * v, now, 0.15);
  }

  stop() {
    for (const n of [this.inv, this.gear, this.gear2, this.tyre, this.air]) {
      try { n.stop(); } catch { /* already stopped */ }
    }
    this.tyreGain.disconnect();
    this.airGain.disconnect();
  }
}

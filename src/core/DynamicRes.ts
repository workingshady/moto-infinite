// Dynamic resolution: lowers the render pixel ratio while the frame rate is too low, raises it back when there is headroom.
// Frame-rate caps (iOS low-power mode = 30 fps) are detected: if lowering does not help, it stops lowering.
import { QUALITY } from '../config';
import type { Renderer } from './Renderer';

export const DYNRES = {
  window: 2000, // ms of frames averaged per decision
  lowFps: 40, // below: render fewer pixels
  highFps: 55, // above: render more again
  step: 0.15, // scale change per decision (down; up is half)
  minScale: 0.55, // never below this fraction of the quality's pixel ratio
  minRatio: 0.5, // ...or this absolute pixel ratio
};

export class DynamicResolution {
  scale = 1;
  private acc = 0;
  private frames = 0;
  private quality = '';
  private lastFps = 0;
  private lowered = false;
  private noGain = 0;

  constructor(private r: Renderer) {}

  /** Call once per rendered frame with the real frame time in ms. */
  frame(ms: number) {
    if (this.r.quality !== this.quality) { // quality changed in the menu: start over at full resolution
      this.quality = this.r.quality;
      this.scale = 1;
      this.noGain = 0;
      this.acc = this.frames = 0;
    }
    if (ms > 250 || document.hidden) return; // hitches (world builds, tab switches) say nothing about steady fps
    this.acc += ms;
    this.frames++;
    if (this.acc < DYNRES.window) return;
    const fps = (this.frames * 1000) / this.acc;
    this.acc = this.frames = 0;
    if (this.lowered) {
      this.noGain = fps < this.lastFps * 1.08 ? this.noGain + 1 : 0;
      this.lowered = false;
    }
    this.lastFps = fps;
    let next = this.scale;
    if (fps < DYNRES.lowFps && this.noGain < 2) next = Math.max(DYNRES.minScale, this.scale - DYNRES.step);
    else if (fps > DYNRES.highFps) next = Math.min(1, this.scale + DYNRES.step / 2);
    if (next === this.scale) return;
    this.lowered = next < this.scale;
    this.scale = next;
    const base = Math.min(devicePixelRatio, QUALITY[this.r.quality].pixelRatio);
    this.r.gl.setPixelRatio(Math.max(DYNRES.minRatio, base * next));
  }
}

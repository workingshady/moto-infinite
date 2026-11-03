import { describe, expect, it } from 'vitest';
import { Circuit } from '../world/layout';
import { Noise } from '../utils/noise';
import { vehicleById } from '../data/vehicles';
import { buildLine, defaultLine, lapEstimate, lineBounds, optimiseOffsets, speedProfile } from './racingLine';

const track = new Circuit(new Noise(1201), 1201);
const hw = () => 7.5;

/** Sum of squared curvature along a line. */
function bend(k: Float32Array) {
  let s = 0;
  for (const v of k) s += v * v;
  return s;
}

describe('racing line optimiser', () => {
  const line = defaultLine(track, hw);

  it('stays inside the usable width and has no NaN', () => {
    for (let i = 0; i < line.n; i++) {
      expect(Number.isFinite(line.off[i])).toBe(true);
      expect(Number.isFinite(line.k[i])).toBe(true);
      expect(line.off[i]).toBeGreaterThanOrEqual(line.lo[i] - 1e-4);
      expect(line.off[i]).toBeLessThanOrEqual(line.hi[i] + 1e-4);
      // the world point really is within the half width of the centre line
      const d = Math.hypot(line.x[i] - track.px[i], line.z[i] - track.pz[i]);
      expect(d).toBeLessThanOrEqual(7.5);
    }
  });

  it('is smoother than the centre line (less summed curvature²) and uses the width', () => {
    const { lo, hi } = lineBounds(track, hw);
    const centre = buildLine(track, new Float32Array(track.n), lo, hi);
    expect(bend(line.k)).toBeLessThan(bend(centre.k) * 0.85);
    let maxOff = 0;
    for (const o of line.off) maxOff = Math.max(maxOff, Math.abs(o));
    expect(maxOff).toBeGreaterThan(3); // cuts apexes / uses the outside
  });

  it('respects a per-point half width (narrow section)', () => {
    const narrow = (i: number) => (i > 100 && i < 300 ? 3 : 7.5);
    const l = defaultLine(track, narrow);
    for (let i = 101; i < 300; i++) expect(Math.abs(l.off[i])).toBeLessThanOrEqual(3 - 1.6 + 1e-4);
  });

  it('handles a degenerate zero-width track without NaN', () => {
    const { lo, hi } = lineBounds(track, () => 0);
    const off = optimiseOffsets(track, lo, hi, 20);
    expect([...off].every((v) => v === 0)).toBe(true);
  });

  it('gives a sane speed profile and a faster lap than the centre line', () => {
    const def = vehicleById('gt'), v = speedProfile(line, def);
    expect([...v].every((x) => Number.isFinite(x) && x > 3)).toBe(true);
    const { lo, hi } = lineBounds(track, hw), centre = buildLine(track, new Float32Array(track.n), lo, hi);
    const tLine = lapEstimate(line, def, v), tCentre = lapEstimate(centre, def, speedProfile(centre, def));
    expect(tLine).toBeLessThan(tCentre);
    expect(tLine).toBeGreaterThan(line.ds.reduce((a, b) => a + b, 0) / def.top); // can not beat flat-out top speed
  });
});

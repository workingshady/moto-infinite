// Physics-based lap time estimate for a vehicle on a closed racing line. Uses the same cornering model
// as the AI racers (curvature -> lateral grip limit, backwards braking pass) plus a forward
// acceleration pass, so medal times scale with both the track and the vehicle you picked.
import type { TrackLine } from '../world/layout';
import type { VehicleDef } from '../data/vehicles';
import { clamp } from '../utils/math';

export interface PaceProfile {
  /** Seconds for one flying lap. */
  lap: number;
  /** Fraction of the lap time spent up to each sample (0 at the start line, 1 at the end). */
  cum: Float32Array;
}

/** skill ~ the AI skill scale (0.86..0.98 for the field); topMul > 1 models nitro use on straights. */
export function paceProfile(t: TrackLine, def: VehicleDef, skill: number, topMul = 1): PaceProfile {
  const n = t.n, v = new Float32Array(n);
  const top = def.top * skill * topMul, aLat = def.grip * 4.8 * (0.9 + skill * 0.1), acc = def.accel * skill, dec = 16;
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let j = -4; j <= 4; j++) k = Math.max(k, Math.abs(Math.asin(clamp(t.curvature((i + j + n) % n), -1, 1))) / (6 * t.spacing));
    v[i] = k <= 0 ? top : Math.min(top, Math.sqrt(aLat / k));
  }
  // two laps of each pass so the loop wraps cleanly (flying lap)
  for (let pass = 0; pass < 2; pass++)
    for (let i = n - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[(i + 1) % n] ** 2 + 2 * dec * t.spacing));
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < n; i++) {
      const prev = v[(i - 1 + n) % n];
      v[i] = Math.min(v[i], Math.sqrt(prev * prev + 2 * acc * (1 - (prev / (top * 1.1)) ** 2 * 0.7) * t.spacing));
    }
  const cum = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + t.spacing / Math.max(3, v[i]);
  const lap = cum[n];
  for (let i = 0; i <= n; i++) cum[i] /= lap;
  return { lap, cum };
}

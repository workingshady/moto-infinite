// Racing line + speed profile for the computer racers.
//
// Line: an "elastic band" minimum-curvature optimiser. Each point may only slide along its track normal, inside the
// usable width; Gauss-Seidel sweeps move every point toward the midpoint of its neighbours, which minimises the summed
// squared second difference (≈ curvature²) of the closed polyline. Coarse-to-fine neighbour strides make it converge
// in a few hundred cheap sweeps (milliseconds, at load time only). See the ForzaETH race stack (arXiv 2403.11784) for
// the full QP formulation this approximates.
//
// Speed profile: the corner limit comes from the SAME physics the bots drive with (entities/vehiclePhysics.ts):
// F1 = μ·g·(1 + k·v²) lateral grip with downforce; road cars/bikes = steering-rate and slip-angle budget of the
// arcade drift model. Then a backward pass with a braking decel the car can really produce.
import { AI, F1 } from '../config';
import type { VehicleDef } from '../data/vehicles';
import type { TrackLine } from '../world/layout';

export interface RacingLine {
  readonly n: number;
  /** Lateral offset from the centre line (+ = right of the race direction: x = cx + tz·off, z = cz − tx·off). */
  readonly off: Float32Array;
  /** Allowed offset range per sample. */
  readonly lo: Float32Array;
  readonly hi: Float32Array;
  /** World points of the line. */
  readonly x: Float32Array;
  readonly z: Float32Array;
  /** Signed curvature (1/m), + = turning left. */
  readonly k: Float32Array;
  /** Distance to the next sample along the line (m). */
  readonly ds: Float32Array;
}

export type HalfWidthFn = (i: number) => number;

/** Half width as a function: per-point if the track provides one (F1 tracks may), else a constant. */
export function halfWidthOf(track: TrackLine, fallback: number): HalfWidthFn {
  const t = track as TrackLine & { halfWidthAt?(i: number): number; halfWidth?: number | ((i: number) => number) };
  if (typeof t.halfWidthAt === 'function') return (i) => t.halfWidthAt!(i);
  if (typeof t.halfWidth === 'function') return (i) => (t.halfWidth as (i: number) => number)(i);
  const hw = typeof t.halfWidth === 'number' ? t.halfWidth : fallback;
  return () => hw;
}

/** Bounds for the line: half width minus the car's half width and a safety margin. */
export function lineBounds(track: TrackLine, hw: HalfWidthFn, margin = AI.line.margin) {
  const n = track.n, lo = new Float32Array(n), hi = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = Math.max(0, hw(i) - margin);
    lo[i] = -w;
    hi[i] = w;
  }
  return { lo, hi };
}

/** Minimum-curvature offsets inside [lo, hi] (start = `init` or the centre line). */
export function optimiseOffsets(track: TrackLine, lo: Float32Array, hi: Float32Array, iters = AI.line.iters, init?: Float32Array, strides: readonly number[] = AI.line.strides): Float32Array {
  const n = track.n, off = init ? Float32Array.from(init) : new Float32Array(n), px = track.px, pz = track.pz, tx = track.tx, tz = track.tz;
  const per = Math.max(1, Math.round(iters / strides.length));
  for (const k0 of strides) {
    // coarse-to-fine: on level k only every k-th sample is a free point; the samples between follow by interpolation
    const k = Math.max(1, Math.min(k0, Math.floor(n / 6)));
    const m = Math.ceil(n / k), X = (q: number) => { const j = ((q % m) + m) % m * k; return px[j] + tz[j] * off[j]; }, Z = (q: number) => { const j = ((q % m) + m) % m * k; return pz[j] - tx[j] * off[j]; };
    for (let it = 0; it < per; it++) {
      for (let q = 0; q < m; q++) {
        const i = q * k;
        // biharmonic Gauss-Seidel: the point that zeroes the local 4th difference minimises Σ|P(i−1) − 2P(i) + P(i+1)|²
        const tx_ = (4 * (X(q - 1) + X(q + 1)) - X(q - 2) - X(q + 2)) / 6, tz_ = (4 * (Z(q - 1) + Z(q + 1)) - Z(q - 2) - Z(q + 2)) / 6;
        const x = px[i] + tz[i] * off[i], z = pz[i] - tx[i] * off[i];
        const d = (tx_ - x) * tz[i] - (tz_ - z) * tx[i];
        let o = off[i] + d * 0.9;
        if (o < lo[i]) o = lo[i];
        else if (o > hi[i]) o = hi[i];
        off[i] = o;
      }
    }
    if (k > 1)
      for (let i = 0; i < n; i += k) {
        const j = i + k >= n ? n : i + k, oj = off[j % n], span = j - i;
        for (let m = 1; m < span; m++) off[i + m] = Math.min(hi[i + m], Math.max(lo[i + m], off[i] + ((oj - off[i]) * m) / span));
      }
  }
  return off;
}

/** Build the line geometry (points, curvature, segment lengths) from offsets. */
export function buildLine(track: TrackLine, off: Float32Array, lo: Float32Array, hi: Float32Array): RacingLine {
  const n = track.n, x = new Float32Array(n), z = new Float32Array(n), k = new Float32Array(n), ds = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = Number.isFinite(off[i]) ? Math.min(hi[i], Math.max(lo[i], off[i])) : 0;
    off[i] = o;
    x[i] = track.px[i] + track.tz[i] * o;
    z[i] = track.pz[i] - track.tx[i] * o;
  }
  const m = Math.max(1, Math.round(6 / track.spacing));
  for (let i = 0; i < n; i++) {
    const a = (i - m + n) % n, b = (i + m) % n, j = (i + 1) % n;
    ds[i] = Math.max(0.05, Math.hypot(x[j] - x[i], z[j] - z[i]));
    // circumscribed circle through a, i, b: κ = 2·cross / (|ab|·|ai|·|ib|)
    const ux = x[i] - x[a], uz = z[i] - z[a], vx = x[b] - x[i], vz = z[b] - z[i], wx = x[b] - x[a], wz = z[b] - z[a];
    const cross = ux * vz - uz * vx, den = Math.hypot(ux, uz) * Math.hypot(vx, vz) * Math.hypot(wx, wz);
    k[i] = den > 1e-6 ? (-2 * cross) / den : 0; // x = sin(h), z = cos(h): a left turn has negative cross here
  }
  // light smoothing of curvature (3-tap) to keep the speed profile calm
  const ks = Float32Array.from(k);
  for (let i = 0; i < n; i++) k[i] = (ks[(i - 1 + n) % n] + 2 * ks[i] + ks[(i + 1) % n]) / 4;
  return { n, off, lo, hi, x, z, k, ds };
}

/** Optimised default line for a track. */
export function defaultLine(track: TrackLine, hw: HalfWidthFn): RacingLine {
  const { lo, hi } = lineBounds(track, hw);
  return buildLine(track, optimiseOffsets(track, lo, hi), lo, hi);
}

// ---------------------------------------------------------------- speed profile
/** Downforce growth factor k so that grip = μ·g·(1 + k·v²). */
export const downK = (def: VehicleDef) => (def.f1 ? (0.5 * F1.rho * def.f1.cla) / (def.f1.mass * 9.81) : 0);
/** Speed the profile uses where nothing limits it: full throttle, physics decides the real top speed. */
export const openSpeed = (def: VehicleDef) => (def.f1 ? 130 : def.top * 1.6);

/** Rough flat-out top speed (m/s): arcade top, or where F1 power (plus half the ERS) meets drag. */
export function topEstimate(def: VehicleDef) {
  const F = def.f1;
  return F ? Math.cbrt(((F.power + F.ers * 0.5) * 1000 * F1.drivetrain) / (0.5 * F1.rho * F.cda)) : def.top;
}

/** Cornering limit (m/s) at curvature |k| for this vehicle at grip 1 (physical limit × safety margin). */
export function cornerSpeed(def: VehicleDef, k: number) {
  const ak = Math.abs(k), P = AI.profile, open = openSpeed(def);
  if (ak < 1e-5) return open;
  if (def.f1) {
    const a0 = def.f1.mu * 9.81 * P.margin, denom = ak - a0 * downK(def); // downforce: fast corners open up
    return denom <= 0 ? open : Math.min(open, Math.sqrt(a0 / denom));
  }
  // arcade drift model: the yaw rate is capped by the steering rate, and the slip angle needed to bend the travel
  // direction (slip = ω / traction) must stay small or the slide scrubs speed / the throttle kicks the tail out
  const omega = Math.min(P.steerShare * def.grip, P.slipMax * def.traction) * P.margin;
  return Math.min(open, omega / ak);
}

/** Braking decel the profile plans with at speed v (a share of what the car can do). */
export function planBrake(def: VehicleDef, v: number) {
  if (def.f1) return Math.min(def.f1.muBrake * 9.81 * (1 + downK(def) * v * v), AI.profile.f1MaxBrake) * AI.profile.brakeShare;
  return AI.profile.arcadeBrake;
}

/** Max target speed per sample at pace 1 / grip 1: corner limits, then a backward braking pass (two laps: wraps). */
export function speedProfile(line: RacingLine, def: VehicleDef, brakeMul = 1): Float32Array {
  const n = line.n, v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let j = -2; j <= 2; j++) k = Math.max(k, Math.abs(line.k[(i + j + n) % n]));
    v[i] = cornerSpeed(def, k);
  }
  backPass(v, line.ds, def, brakeMul);
  return v;
}

/** Backward braking pass in place. */
export function backPass(v: Float32Array, ds: Float32Array, def: VehicleDef, brakeMul = 1) {
  const n = v.length;
  for (let pass = 0; pass < 2; pass++)
    for (let i = n - 1; i >= 0; i--) {
      const nx = v[(i + 1) % n], lim = Math.sqrt(nx * nx + 2 * planBrake(def, nx) * brakeMul * ds[i]);
      if (lim < v[i]) v[i] = lim;
    }
}

/** Forward acceleration estimate (m/s²) at speed v, full throttle, for lap time estimates. */
export function accelAt(def: VehicleDef, v: number) {
  const F = def.f1;
  if (!F) return v < def.top ? def.accel : 0;
  const drive = Math.min((F.power * 1000 * F1.drivetrain) / (F.mass * Math.max(v, 4)), F.muLong * 9.81 * (1 + downK(def) * v * v));
  return drive - (0.5 * F1.rho * F.cda * v * v) / F.mass - F1.rolling * 9.81;
}

/** Lap time (s) driving a speed profile with a forward acceleration pass (a flying lap). */
export function lapEstimate(line: RacingLine, def: VehicleDef, vmax: Float32Array, scale = 1) {
  const n = line.n, v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = vmax[i] * scale;
  const cap = def.f1 ? 120 : def.top;
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < n; i++) {
      const p = (i - 1 + n) % n, lim = Math.sqrt(v[p] * v[p] + 2 * Math.max(0, accelAt(def, v[p])) * line.ds[p]);
      v[i] = Math.min(v[i], lim, cap);
    }
  let t = 0;
  for (let i = 0; i < n; i++) t += line.ds[i] / Math.max(2, v[i]);
  return t;
}

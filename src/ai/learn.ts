// Bots learn racing lines from real laps: the player's local best ghost (systems/Race.ts) and the leaderboard #1
// ghost (net/leaderboard.ts, fetched lazily, offline = skipped). Each ghost lap (x, y, z, heading, pitch at 10 Hz) is
// projected onto the track: lateral position and speed per sample. Laps that leave the track (thruster flight cuts
// the infield) or don't cover the lap are rejected. Good laps pull the optimised line toward the human line and move
// the bots' braking points toward where humans brake, weighted by lap quality. The result is cached per track in
// localStorage (a few KB, bounded number of tracks).
import { AI, RACE } from '../config';
import type { VehicleDef } from '../data/vehicles';
import { vehicleById } from '../data/vehicles';
import type { TrackLine } from '../world/layout';
import { backPass, buildLine, defaultLine, lapEstimate, lineBounds, optimiseOffsets, speedProfile, topEstimate, type HalfWidthFn, type RacingLine } from './racingLine';

export interface GhostLap { time: number; s: number[]; vehicle?: string; src: 'local' | 'lb' }
/** A ghost projected onto the track: lateral offset and speed per sample (NaN = not covered). */
export interface GhostTrace { lat: Float32Array; speed: Float32Array; cover: number }

const STRIDE = 5;

/** Project a ghost lap onto the track. Null when it is not a clean ground lap of this track. */
export function traceGhost(track: TrackLine, hw: HalfWidthFn, g: GhostLap): GhostTrace | null {
  const n = track.n, s = g.s, N = Math.floor((s?.length ?? 0) / STRIDE);
  if (!Number.isFinite(g.time) || g.time <= 0 || N < 20) return null;
  const lat = new Float32Array(n).fill(NaN), speed = new Float32Array(n).fill(NaN);
  let prevI = -1, prevLat = 0, prevV = 0, covered = 0, travelled = 0;
  for (let k = 0; k < N; k++) {
    const x = s[k * STRIDE], z = s[k * STRIDE + 2];
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const near = track.nearest(x, z, true);
    if (near.i < 0) return null;
    const i = near.i, l = (x - track.px[i]) * track.tz[i] - (z - track.pz[i]) * track.tx[i];
    if (Math.abs(l) > hw(i) + AI.learn.offTrack) return null; // left the track: a flight / cut / crash lap teaches nothing
    const nx = s[Math.min(N - 1, k + 1) * STRIDE], nz = s[Math.min(N - 1, k + 1) * STRIDE + 2];
    const v = Math.hypot(nx - x, nz - z) * RACE.ghostHz;
    if (prevI >= 0) {
      const di = (i - prevI + n) % n;
      if (di > n / 2) { if (n - di > 6) return null; continue; } // going backwards = not a clean lap
      if (di * track.spacing > 60) return null; // a jump across the infield
      travelled += di;
      for (let m = 1; m <= di; m++) {
        const j = (prevI + m) % n, f = m / di;
        if (Number.isNaN(lat[j])) covered++;
        lat[j] = prevLat + (l - prevLat) * f;
        speed[j] = prevV + (v - prevV) * f;
      }
    }
    prevI = i; prevLat = l; prevV = v;
  }
  const cover = covered / n;
  if (cover < AI.learn.minCover || travelled > n * 1.3) return null;
  return { lat, speed, cover };
}

/** Lap quality 0..1 against the vehicle's ideal lap (a lap 10 % off the ideal counts ~half). */
export const lapQuality = (time: number, ideal: number) => Math.pow(Math.min(1, ideal / Math.max(1e-3, time)), AI.learn.qualityExp);

export interface Learned {
  line: RacingLine;
  /** Speed multiplier per sample learned from humans (braking points), 1 = none. */
  speedMul: Float32Array;
  /** Ghost laps used (for the HUD / tests). */
  used: number;
}

/**
 * Optimised line + what ghost laps teach. `def` = the class reference vehicle for lap quality and speed scaling.
 */
export function learnLine(track: TrackLine, hw: HalfWidthFn, ghosts: GhostLap[], def: VehicleDef): Learned {
  const base = defaultLine(track, hw), n = track.n, speedMul = new Float32Array(n).fill(1);
  const vBase = speedProfile(base, def), ideal = lapEstimate(base, def, vBase);
  const traces: { t: GhostTrace; w: number; scale: number }[] = [];
  for (const g of ghosts) {
    const t = traceGhost(track, hw, g);
    if (!t) continue;
    const gDef = g.vehicle ? vehicleById(g.vehicle) : def;
    // a ghost in a different vehicle: scale its speed by the top-speed ratio, and judge its time in its own vehicle
    const scale = gDef.id === def.id ? 1 : topEstimate(def) / topEstimate(gDef);
    const q = lapQuality(g.time * (gDef.id === def.id ? 1 : 1 / scale), ideal);
    if (q > 0.02) traces.push({ t, w: q, scale: g.vehicle ? scale : 0 }); // unknown vehicle: learn the line, not its speeds
  }
  if (!traces.length) return { line: base, speedMul, used: 0 };
  // lateral: weighted blend of the optimised line and the human lines, then a few smoothing sweeps inside the width
  const off = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = base.off[i], wsum = 1;
    for (const { t, w } of traces) if (!Number.isNaN(t.lat[i])) { sum += t.lat[i] * w * AI.learn.lineWeight * 2; wsum += w * AI.learn.lineWeight * 2; }
    off[i] = sum / wsum;
  }
  const smooth = optimiseOffsets(track, base.lo, base.hi, 40, off, [2, 1]);
  const line = buildLine(track, smooth, base.lo, base.hi);
  // braking points / corner speeds: where humans are faster or slower than our profile, lean toward them
  const vLine = speedProfile(line, def);
  for (let i = 0; i < n; i++) {
    if (vLine[i] > topEstimate(def) * 0.97) continue; // straights: power-limited, nothing to learn
    let sum = 0, wsum = 0;
    for (const { t, w, scale } of traces) if (scale > 0 && !Number.isNaN(t.speed[i]) && t.speed[i] > 2) { sum += Math.min(1.15, Math.max(0.85, (t.speed[i] * scale) / vLine[i])) * w; wsum += w; }
    if (wsum > 0) speedMul[i] = 1 + (sum / wsum - 1) * Math.min(1, wsum) * AI.learn.speedWeight;
  }
  // smooth the multiplier (±5 samples) so single noisy samples don't make the bots twitch
  const tmp = Float32Array.from(speedMul);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -5; k <= 5; k++) s += tmp[(i + k + n) % n];
    speedMul[i] = s / 11;
  }
  return { line, speedMul, used: traces.length };
}

/** A bot's profile on a learned line: physics corner limits × learned multiplier, then the braking pass again. */
export function learnedProfile(l: Learned, def: VehicleDef, brakeMul: number) {
  const v = speedProfile(l.line, def, brakeMul);
  for (let i = 0; i < v.length; i++) v[i] *= l.speedMul[i];
  backPass(v, l.line.ds, def, brakeMul);
  return v;
}

// ---------------------------------------------------------------- cache (localStorage, bounded)
const KEY = 'moto:ailine:', IDX = 'moto:ailine:idx';

function b64(a: Int8Array | Uint8Array) {
  let s = '';
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i] & 255);
  return btoa(s);
}
function unb64(s: string) {
  const r = atob(s), a = new Uint8Array(r.length);
  for (let i = 0; i < r.length; i++) a[i] = r.charCodeAt(i);
  return a;
}

/** Signature of what a learned line was built from: track size + ghost times/sources. */
export const learnSig = (n: number, ghosts: GhostLap[], cls: string) => `${n}|${cls}|${ghosts.map((g) => `${g.src}:${g.time.toFixed(2)}:${g.vehicle ?? ''}`).sort().join(',')}`;

export function loadLearned(track: TrackLine, hw: HalfWidthFn, key: string, sig: string): Learned | null {
  try {
    const raw = localStorage.getItem(KEY + key);
    if (!raw) return null;
    const d = JSON.parse(raw) as { sig?: string; off?: string; mul?: string; used?: number };
    if (d.sig !== sig || typeof d.off !== 'string' || typeof d.mul !== 'string') return null;
    const o = new Int8Array(unb64(d.off).buffer), m = unb64(d.mul), n = track.n;
    if (o.length !== n || m.length !== n) return null;
    const { lo, hi } = lineBounds(track, hw), off = new Float32Array(n), mul = new Float32Array(n);
    for (let i = 0; i < n; i++) { off[i] = o[i] / 5; mul[i] = 0.8 + m[i] / 600; }
    return { line: buildLine(track, off, lo, hi), speedMul: mul, used: d.used ?? 0 };
  } catch {
    return null; // damaged cache: rebuild
  }
}

export function saveLearned(key: string, sig: string, l: Learned) {
  try {
    const n = l.line.n, o = new Int8Array(n), m = new Uint8Array(n);
    for (let i = 0; i < n; i++) { o[i] = Math.max(-127, Math.min(127, Math.round(l.line.off[i] * 5))); m[i] = Math.max(0, Math.min(255, Math.round((l.speedMul[i] - 0.8) * 600))); }
    localStorage.setItem(KEY + key, JSON.stringify({ sig, off: b64(o), mul: b64(m), used: l.used }));
    // bounded: keep the most recent few tracks
    let idx: string[] = [];
    try { idx = JSON.parse(localStorage.getItem(IDX) ?? '[]') as string[]; } catch { idx = []; }
    if (!Array.isArray(idx)) idx = [];
    idx = [key, ...idx.filter((k) => k !== key && typeof k === 'string')];
    for (const old of idx.slice(AI.line.cacheTracks)) localStorage.removeItem(KEY + old);
    localStorage.setItem(IDX, JSON.stringify(idx.slice(0, AI.line.cacheTracks)));
  } catch {
    /* storage full / blocked: learned line just isn't cached */
  }
}

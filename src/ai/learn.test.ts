// Learning racing lines from ghost laps: projection, rejection of flight / cut laps, blending, cache.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Circuit } from '../world/layout';
import { Noise } from '../utils/noise';
import { AI, RACE } from '../config';
import { vehicleById } from '../data/vehicles';
import { learnLine, learnSig, loadLearned, saveLearned, traceGhost, learnedProfile, type GhostLap } from './learn';

const track = new Circuit(new Noise(1201), 1201), hw = () => 7.5, def = vehicleById('gt');

/** A synthetic ghost lap: drives the centre line at lateral `lat` with speed `v` (m/s), sampled at RACE.ghostHz. */
function ghost(lat: number, v: number, time?: number): GhostLap {
  const s: number[] = [], step = v / RACE.ghostHz, n = track.n;
  for (let d = 0; d < n * track.spacing; d += step) {
    const f = d / track.spacing, i = Math.floor(f) % n, j = (i + 1) % n, u = f - Math.floor(f);
    const cx = track.px[i] + (track.px[j] - track.px[i]) * u, cz = track.pz[i] + (track.pz[j] - track.pz[i]) * u;
    s.push(cx + track.tz[i] * lat, 0, cz - track.tx[i] * lat, Math.atan2(track.tx[i], track.tz[i]), 0);
  }
  return { time: time ?? (n * track.spacing) / v, s, vehicle: 'gt', src: 'local' };
}

describe('ghost tracing', () => {
  it('projects a clean ground lap: lateral offset and speed per sample, full coverage', () => {
    const t = traceGhost(track, hw, ghost(3, 30))!;
    expect(t).not.toBeNull();
    expect(t.cover).toBeGreaterThan(0.95);
    let lat = 0, sp = 0, k = 0;
    for (let i = 0; i < track.n; i++) if (!Number.isNaN(t.lat[i])) { lat += t.lat[i]; sp += t.speed[i]; k++; }
    expect(lat / k).toBeCloseTo(3, 0);
    expect(sp / k).toBeCloseTo(30, 0);
  });

  it('rejects flight / shortcut laps (off the track or jumping across the infield) and partial laps', () => {
    const g = ghost(0, 30), N = g.s.length / 5;
    // thruster flight: a stretch of samples hundreds of metres off the track
    const fly = { ...g, s: g.s.slice() };
    for (let k = Math.floor(N * 0.4); k < Math.floor(N * 0.45); k++) { fly.s[k * 5] += 200; fly.s[k * 5 + 2] += 150; }
    expect(traceGhost(track, hw, fly)).toBeNull();
    // cut: skip a big chunk of the lap (teleports along the centre line)
    const cut = { ...g, s: [...g.s.slice(0, Math.floor(N * 0.3) * 5), ...g.s.slice(Math.floor(N * 0.6) * 5)] };
    expect(traceGhost(track, hw, cut)).toBeNull();
    expect(traceGhost(track, hw, { ...g, s: g.s.slice(0, Math.floor(N * 0.5) * 5) })).toBeNull();
    expect(traceGhost(track, hw, { ...g, time: NaN })).toBeNull();
  });
});

describe('learning', () => {
  it('pulls the optimised line toward good human lines, weighted by lap quality; stays inside the width', () => {
    const none = learnLine(track, hw, [], def);
    const good = learnLine(track, hw, [ghost(4, 40, 30)], def); // impossibly quick = full weight
    const slow = learnLine(track, hw, [ghost(4, 10, 400)], def); // very slow lap = almost no weight
    const mean = (a: Float32Array) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(none.used).toBe(0);
    expect(good.used).toBe(1);
    expect(mean(good.line.off) - mean(none.line.off)).toBeGreaterThan(0.8);
    expect(Math.abs(mean(slow.line.off) - mean(none.line.off))).toBeLessThan(mean(good.line.off) - mean(none.line.off));
    for (let i = 0; i < track.n; i++) {
      expect(Number.isFinite(good.line.off[i])).toBe(true);
      expect(Math.abs(good.line.off[i])).toBeLessThanOrEqual(7.5 - AI.line.margin + 1e-4);
    }
    const v = learnedProfile(good, def, 1);
    expect([...v].every((x) => Number.isFinite(x) && x > 0)).toBe(true);
  });

  it('a ghost of unknown vehicle teaches the line but not the speeds', () => {
    const g = { ...ghost(2, 40, 30), vehicle: undefined };
    const l = learnLine(track, hw, [g], def);
    expect([...l.speedMul].every((m) => m === 1)).toBe(true);
  });
});

describe('learned line cache', () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  afterEach(() => store.clear());

  it('round-trips (0.2 m resolution), misses on a different signature, survives damage, stays bounded', () => {
    const l = learnLine(track, hw, [ghost(3, 40, 30)], def), sig = learnSig(track.n, [ghost(3, 40, 30)], 'car');
    saveLearned('coast:car', sig, l);
    const back = loadLearned(track, hw, 'coast:car', sig)!;
    expect(back).not.toBeNull();
    for (let i = 0; i < track.n; i += 37) expect(Math.abs(back.line.off[i] - l.line.off[i])).toBeLessThan(0.11);
    expect(loadLearned(track, hw, 'coast:car', sig + 'x')).toBeNull();
    store.set('moto:ailine:coast:car', '{broken');
    expect(loadLearned(track, hw, 'coast:car', sig)).toBeNull();
    for (let k = 0; k < AI.line.cacheTracks + 5; k++) saveLearned('t' + k + ':car', sig, l);
    expect([...store.keys()].filter((k) => k.startsWith('moto:ailine:t')).length).toBe(AI.line.cacheTracks);
    expect((store.get('moto:ailine:t0:car') ?? '').length).toBe(0); // the oldest were dropped
  });
});

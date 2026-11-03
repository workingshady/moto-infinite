import { describe, expect, it } from 'vitest';
import { F1_TRACK } from '../config';
import { BOARD_RE, LB_F1 } from '../../shared/leaderboard';
import { F1_SHAPES, F1_TRACKS, clearance, f1Line, gridSlot, inLoopRange, projectGeo, radiusAt } from './f1Circuits';

const CAR_WIDTH = 1.9; // 2026 regulations: max 1900 mm (was 2000 mm)

describe('projection (lon/lat -> metres)', () => {
  it('uses the WGS84 local radii with a cos(lat) factor on longitude', () => {
    // 1 degree at 45 deg N: 78.85 km of longitude, 111.13 km of latitude
    const [x] = projectGeo([10, 45, 1e6, 0]), [, z] = projectGeo([10, 45, 0, 1e6]);
    expect(x).toBeCloseTo(78847, -1);
    expect(z).toBeCloseTo(-111132, -1); // north is -z
    const [xe] = projectGeo([0, 0, 1e6, 0]), [xn] = projectGeo([0, 60, 1e6, 0]);
    expect(xe).toBeCloseTo(111319, -1);
    expect(xn / xe).toBeCloseTo(0.5, 2);
  });
});

describe.each(F1_TRACKS.map((t) => [t.id, t] as const))('%s', (id, t) => {
  const L = f1Line(id), S = F1_SHAPES[id];

  it('lap length matches the official length (±3%, the trace itself within ±1%)', () => {
    expect(Math.abs(L.length / (t.lengthKm * 1000) - 1)).toBeLessThan(0.03);
    if (!t.fictional) expect(Math.abs(L.traceLength / (t.lengthKm * 1000) - 1)).toBeLessThan(0.01);
    expect(L.spacing).toBeCloseTo(F1_TRACK.spacing, 1);
  });

  it('width is in the FIA range (street-circuit narrows documented) with room for cars side by side', () => {
    // FIA Grade 1: at least 12 m. Exceptions: Monaco (~10 m, 8 m at the hairpin), Baku castle section (7.6 m).
    if (id === 'monaco') expect(S.width).toBe(10);
    else {
      expect(S.width).toBeGreaterThanOrEqual(F1_TRACK.fiaMinWidth);
      expect(S.width).toBeLessThanOrEqual(F1_TRACK.fiaMaxWidth);
    }
    let lo = Infinity;
    for (let i = 0; i < L.n; i++) lo = Math.min(lo, L.hw[i] * 2);
    expect(lo).toBeGreaterThanOrEqual(7.5);
    expect(lo / CAR_WIDTH).toBeGreaterThan(3.5);
    if (!S.narrow) expect(lo).toBe(S.width);
  });

  it('turns are plausible: no corner tighter than the circuit minimum (Monaco hairpin ~9-10 m), never folding the inner edge', () => {
    let r = Infinity, ri = 0;
    for (let i = 0; i < L.n; i++) { const v = radiusAt(L.px, L.pz, i); if (v < r) { r = v; ri = i; } }
    expect(r).toBeGreaterThan(S.minR * 0.9);
    expect(r).toBeGreaterThan(L.hw[ri] + 3);
    expect(r).toBeGreaterThanOrEqual(9);
  });

  it('no self-intersections except a real crossover; other parts of the track never overlap', () => {
    expect(L.crossings.length).toBe(S.crossovers ?? 0);
    const nearCross = (i: number) => L.crossings.some(([a, b]) => [a, b].some((c) => { const d = Math.abs(i - c); return Math.min(d, L.n - d) * L.spacing < 60; }));
    for (let i = 0; i < L.n; i += 3) {
      if (nearCross(i)) continue;
      const c = clearance(L, L.px[i], L.pz[i], i, 60);
      if (c.i >= 0 && nearCross(c.i)) continue;
      expect(c.d - L.hw[i], `edge gap at ${Math.round(i * L.spacing)} m`).toBeGreaterThan(0.5);
    }
  });

  it('elevation follows the real change, and nearby parts of the lap sit at nearby heights', () => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < L.n; i++) { lo = Math.min(lo, L.elev[i]); hi = Math.max(hi, L.elev[i]); }
    expect(hi - lo).toBeGreaterThan(S.elevRange * 0.8);
    expect(hi - lo).toBeLessThan(S.elevRange * 1.15 + 0.5);
    expect(lo).toBeGreaterThanOrEqual(F1_TRACK.minGround - 0.01);
    // crossovers: one height field, so both levels meet at the same height (the bridge is dressing)
    for (const [a, b] of L.crossings) expect(Math.abs(L.elev[a] - L.elev[b])).toBeLessThan(0.3);
    // no cliffs between parallel sections (the terrain blends between them)
    for (let i = 0; i < L.n; i += 4) {
      const c = clearance(L, L.px[i], L.pz[i], i, 80);
      const gap = c.d - L.hw[i];
      if (gap > 30 || c.i < 0) continue;
      expect(Math.abs(L.elev[i] - L.elev[c.i]), `height step at ${Math.round(i * L.spacing)} m`).toBeLessThan(1.5 + 0.5 * Math.max(0, gap));
    }
  });

  it('has its real number of DRS / straight-mode zones, each on a straight', () => {
    expect(L.drsZones.length).toBe(S.drs);
    for (const z of L.drsZones) {
      const len = (((z.i1 - z.i0) % L.n) + L.n) % L.n * L.spacing;
      expect(len).toBeGreaterThan(120);
      expect(L.straights.some((s) => inLoopRange(z.i0, s.a, s.b) && inLoopRange(z.i1, s.a, s.b))).toBe(true);
    }
  });

  it('pit lane is clear of every other part of the track', () => {
    const { i0, i1, side } = L.pit, len = ((((i1 - i0) % L.n) + L.n) % L.n) * L.spacing;
    expect(len).toBeGreaterThan(400);
    for (let k = 0; k * L.spacing <= len; k += 3) {
      const i = (i0 + k) % L.n;
      for (const off of [L.hw[i] + 1, L.hw[i] + F1_TRACK.pitWidth / 2, L.hw[i] + F1_TRACK.pitWidth]) {
        const x = L.px[i] + L.tz[i] * side * off, z = L.pz[i] - L.tx[i] * side * off;
        expect(clearance(L, x, z, i, 90).d, `pit at ${Math.round(k * L.spacing)} m, ${off.toFixed(1)} m out`).toBeGreaterThan(1);
      }
    }
  });

  it('grid: staggered slots 8 m apart behind the line, on the track', () => {
    for (let k = 0; k < 20; k++) {
      const a = gridSlot(L, k), b = gridSlot(L, k + 1);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(F1_TRACK.gridGap - 0.5);
      // lateral offset + half a car stays on the asphalt
      const j = (L.n - Math.round((F1_TRACK.gridFirst + k * F1_TRACK.gridGap) / L.spacing)) % L.n;
      expect(Math.hypot(a.x - L.px[j], a.z - L.pz[j]) + CAR_WIDTH / 2).toBeLessThan(L.hw[j]);
    }
  });

  it('id and leaderboard entry fit the online / board limits', () => {
    expect(id).toMatch(/^[a-z0-9]{3,16}$/);
    expect(BOARD_RE.test(`track:${id}:f1`)).toBe(true);
    expect(LB_F1[id]).toEqual({ name: t.name, km: t.lengthKm });
    expect(t.turns).toBeGreaterThan(3);
  });
});

describe('catalogue', () => {
  it('leaderboard copy lists exactly the circuits', () => {
    expect(Object.keys(LB_F1).sort()).toEqual(F1_TRACKS.map((t) => t.id).sort());
  });
  it('has easy, medium and hard circuits; only the rookie track is fictional', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) expect(F1_TRACKS.filter((t) => t.difficulty === d).length).toBeGreaterThanOrEqual(3);
    expect(F1_TRACKS.filter((t) => t.fictional).map((t) => t.id)).toEqual(['academy']);
  });
});

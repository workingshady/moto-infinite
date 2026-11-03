import { describe, expect, it } from 'vitest';
import { Noise } from '../utils/noise';
import { Circuit, GridRoads, hash01 } from './layout';

const roadPoints = (L: GridRoads | Circuit, x0: number, z0: number, size: number) => {
  const out: number[] = [];
  L.forEachRoadPoint(x0, z0, size, (x, z, tx, tz) => out.push(x, z, tx, tz));
  return out;
};

describe('hash01', () => {
  it('is deterministic and in [0, 1)', () => {
    expect(hash01(1, 2, 3)).toBe(hash01(1, 2, 3));
    expect(hash01(1, 2, 3)).not.toBe(hash01(1, 2, 4));
    for (let i = -50; i < 50; i++) {
      const v = hash01(i, i * 7, 12345);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('GridRoads (open world)', () => {
  const make = (seed: number) => new GridRoads(new Noise(seed), seed, 1, 0.35);

  it('same seed gives the same roads, landmarks and spawn', () => {
    const a = make(777), b = make(777);
    expect(roadPoints(a, -300, -300, 600)).toEqual(roadPoints(b, -300, -300, 600));
    expect(a.pois(-2000, -2000, 4000)).toEqual(b.pois(-2000, -2000, 4000));
    expect(a.spawn(0)).toEqual(b.spawn(0));
    expect(a.roadDist(123, -456)).toBe(b.roadDist(123, -456));
  });

  it('different seeds give different road maps', () => {
    expect(roadPoints(make(1), -300, -300, 600)).not.toEqual(roadPoints(make(2), -300, -300, 600));
  });

  it('road points lie on the road with unit tangents, inside the requested square', () => {
    const L = make(42);
    let count = 0;
    L.forEachRoadPoint(-200, -200, 400, (x, z, tx, tz) => {
      count++;
      expect(x).toBeGreaterThanOrEqual(-200);
      expect(x).toBeLessThan(200);
      expect(z).toBeGreaterThanOrEqual(-200);
      expect(z).toBeLessThan(200);
      expect(Math.hypot(tx, tz)).toBeCloseTo(1, 6);
      expect(L.roadDist(x, z)).toBeLessThan(0.5);
    });
    expect(count).toBeGreaterThan(20);
  });

  it('players spawn on the road, side by side', () => {
    const L = make(9);
    const p0 = L.spawn(0), p1 = L.spawn(1), p2 = L.spawn(2);
    expect(L.roadDist(p0.x, p0.z)).toBeLessThan(0.5);
    expect(L.roadDist(p1.x, p1.z)).toBeLessThan(4);
    expect(Math.hypot(p1.x - p0.x, p1.z - p0.z)).toBeGreaterThan(2);
    expect(Math.hypot(p2.x - p0.x, p2.z - p0.z)).toBeGreaterThan(2);
  });

  it('nearestRoad snaps onto a road', () => {
    const L = make(31);
    for (const [x, z] of [[50, 70], [-333, 12], [900, -800]]) {
      const p = L.nearestRoad(x, z);
      expect(L.roadDist(p.x, p.z)).toBeLessThan(1);
    }
  });

  it('no landmarks when the landmark chance is 0', () => {
    expect(new GridRoads(new Noise(3), 3, 1, 0).pois(-3000, -3000, 6000)).toEqual([]);
  });
});

describe('Circuit (race loop)', () => {
  it('same seed gives the same track', () => {
    const a = new Circuit(new Noise(5), 5), b = new Circuit(new Noise(5), 5);
    expect(a.n).toBe(b.n);
    expect(a.length).toBe(b.length);
    expect(Array.from(a.px)).toEqual(Array.from(b.px));
    expect(Array.from(a.pz)).toEqual(Array.from(b.pz));
  });

  it('different seeds give different tracks', () => {
    expect(new Circuit(new Noise(5), 5).length).not.toBe(new Circuit(new Noise(6), 6).length);
  });

  it('is a closed loop sampled every ~2 m with unit tangents', () => {
    const c = new Circuit(new Noise(11), 11);
    expect(c.spacing).toBeGreaterThan(1.8);
    expect(c.spacing).toBeLessThan(2.2);
    for (let i = 0; i < c.n; i++) {
      const j = (i + 1) % c.n; // includes the wrap from the last sample back to the first
      expect(Math.hypot(c.px[j] - c.px[i], c.pz[j] - c.pz[i])).toBeLessThan(c.spacing * 1.6);
      expect(Math.hypot(c.tx[i], c.tz[i])).toBeCloseTo(1, 5);
    }
  });

  it('nearest() finds the sample and the spatial hash agrees with a full scan', () => {
    const c = new Circuit(new Noise(12), 12);
    for (let i = 0; i < c.n; i += 37) {
      const hit = c.nearest(c.px[i] + 0.3, c.pz[i] - 0.2);
      expect(hit.i).toBe(i);
      expect(hit.d).toBeLessThan(0.5);
    }
    // far away: only the exhaustive search finds something
    expect(c.nearest(1e5, 1e5).i).toBe(-1);
    expect(c.nearest(1e5, 1e5, true).i).toBeGreaterThanOrEqual(0);
  });

  it('grid spawns sit behind the start line on the track', () => {
    const c = new Circuit(new Noise(13), 13);
    for (let i = 0; i < 6; i++) {
      const p = c.spawn(i);
      expect(c.roadDist(p.x, p.z)).toBeLessThan(3);
    }
    expect(c.spawn(0)).not.toEqual(c.spawn(1));
  });

  it('curvature is bounded and a loop turns one way overall', () => {
    const c = new Circuit(new Noise(14), 14);
    let sum = 0;
    for (let i = 0; i < c.n; i++) {
      const k = c.curvature(i);
      expect(Math.abs(k)).toBeLessThanOrEqual(1);
      sum += k;
    }
    expect(Math.abs(sum)).toBeGreaterThan(0); // a closed loop turns one way overall
  });
});

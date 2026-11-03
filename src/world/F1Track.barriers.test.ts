// Barrier layout on every Formula 1 circuit (including ones added later): the walls must form a continuous boundary
// a car can't drive out through, sit off the racing surface, and leave run-off.
import { describe, expect, it, vi } from 'vitest';

// F1Track builds a few canvas textures when its module loads; Node has no DOM, so hand it an inert canvas.
vi.hoisted(() => {
  const ctx = new Proxy({}, { get: () => () => ({ width: 0 }), set: () => true });
  (globalThis as Record<string, unknown>).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
});

import { F1Track, F1_TRACKS } from './F1Track';
import { obsOverlap, type Obstacle } from './collide';
import { Noise } from '../utils/noise';
import { WALL } from '../config';

interface Inside {
  solids: Obstacle[]; halfWidth: number; n: number; px: Float32Array; pz: Float32Array; tx: Float32Array; tz: Float32Array;
  edgeAt(x: number, z: number, own: number): number; isPit(x: number, z: number): boolean; roadDist(x: number, z: number): number;
  nearest(x: number, z: number): { i: number; d: number };
  pit: { i0: number; i1: number; side: 1 | -1 };
}

const CAR = WALL.radius.f1;

/** Grid of colliders for quick lookups. */
function grid(solids: Obstacle[]) {
  const cells = new Map<string, Obstacle[]>(), C = 16;
  for (const o of solids) {
    const x0 = Math.min(o.x, o.x2 ?? o.x) - o.r, x1 = Math.max(o.x, o.x2 ?? o.x) + o.r;
    const z0 = Math.min(o.z, o.z2 ?? o.z) - o.r, z1 = Math.max(o.z, o.z2 ?? o.z) + o.r;
    for (let a = Math.floor(x0 / C); a <= Math.floor(x1 / C); a++)
      for (let b = Math.floor(z0 / C); b <= Math.floor(z1 / C); b++) {
        const k = a + ',' + b;
        (cells.get(k) ?? cells.set(k, []).get(k)!).push(o);
      }
  }
  return (x: number, z: number, r: number) => {
    for (let a = Math.floor((x - r - 4) / C); a <= Math.floor((x + r + 4) / C); a++)
      for (let b = Math.floor((z - r - 4) / C); b <= Math.floor((z + r + 4) / C); b++)
        for (const o of cells.get(a + ',' + b) ?? []) if (obsOverlap(o, x, z, r)) return true;
    return false;
  };
}

describe.each(F1_TRACKS.map((t) => t.id))('F1 barriers: %s', (id) => {
  const t = new F1Track(new Noise(1), id) as unknown as Inside;
  const hit = grid(t.solids), hw = t.halfWidth;
  const at = (i: number, off: number): [number, number] => [t.px[i] + t.tz[i] * off, t.pz[i] - t.tx[i] * off];
  const inPit = (i: number) => (t.pit.i0 <= t.pit.i1 ? i >= t.pit.i0 && i <= t.pit.i1 : i >= t.pit.i0 || i <= t.pit.i1);

  /** Walk sideways from `from` until a wall stops a car-sized body (ok), another part of the course is reached (ok), or 40 m pass (gap). */
  const escapes = (i: number, side: number, from: number) => {
    for (let off = from; off < hw + 40; off += 0.5) {
      const [x, z] = at(i, side * off);
      if (hit(x, z, CAR)) return false;
      if (t.edgeAt(x, z, i) < 0 || (t.roadDist(x, z) < 7.5 && !t.isPit(x, z) && t.nearest(x, z).i !== i && Math.abs(t.nearest(x, z).i - i) > 30)) return false;
    }
    return true;
  };

  it('no wall or tyre stack on the racing surface', () => {
    const touch: number[] = [];
    for (let i = 0; i < t.n; i++) for (const s of [-1, 1]) {
      const [x, z] = at(i, s * (hw - 1.2)); // a car's width inside the white line
      if (hit(x, z, 0.05)) touch.push(i);
    }
    expect(touch.length, `samples ${touch.slice(0, 10).join(',')}`).toBe(0);
  });

  it('a continuous boundary: almost nowhere can a car drive straight off into the open', () => {
    let gaps = 0, rays = 0;
    const where: string[] = [];
    for (let i = 0; i < t.n; i++)
      for (const s of [-1, 1]) {
        rays++;
        // along the pits, check the pit lane's outer wall from inside the lane
        const from = s === t.pit.side && inPit(i) ? hw + 3 : hw + 0.5;
        if (escapes(i, s, from)) { gaps++; if (where.length < 12) where.push(`${i}${s > 0 ? 'R' : 'L'}`); }
      }
    // a handful of rays may slip through at bridges/crossovers and the ends of the pit lane
    expect(gaps / rays, `gaps at ${where.join(' ')}`).toBeLessThan(0.01);
  });

  it('the walls leave run-off beyond the white line (street circuits: half a metre, others: metres)', () => {
    let tight = 0;
    const street = id === 'monaco', probe = street ? 0.3 : 1.5;
    for (let i = 0; i < t.n; i += 2)
      for (const s of [-1, 1]) {
        const [x, z] = at(i, s * (hw + probe / 2));
        if (hit(x, z, probe / 2)) tight++;
      }
    expect(tight / t.n).toBeLessThan(0.05);
  });
});

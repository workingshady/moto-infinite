import { describe, expect, it } from 'vitest';
import { collidePair, massFromSpec, newBody, obsDist2, obsOverlap, obsPush, segSeg, sweep, sweepSteps, toSpeedHeading, type Body, type ContactParams, type Obstacle, type Push, type SegSeg } from './collide';
import { VEHICLES } from '../data/vehicles';

const P: ContactParams = { restitution: 0.1, friction: 0.35, maxPush: 0.35, slowPush: 0.04, spin: 0.6, maxSpin: 2.2, maxDy: 1.8 };
const body = (o: Partial<Body>): Body => Object.assign(newBody(), { r: 0.95, a: 1.3, m: 1300 }, o);
const finite = (b: Body) => [b.dvx, b.dvz, b.px, b.pz, b.spin, b.impact].every(Number.isFinite);
const push = (): Push => ({ nx: 0, nz: 0, depth: 0 });

describe('obstacles: circles and capsules', () => {
  const wall: Obstacle = { x: 0, z: 0, x2: 0, z2: 10, r: 0.3, top: 1 };

  it('capsule distance is to the segment, not the end points', () => {
    expect(obsDist2(wall, 2, 5)).toBeCloseTo(4);
    expect(obsDist2(wall, 0, 13)).toBeCloseTo(9); // past the end: distance to the end point
    expect(obsDist2({ x: 1, z: 1, r: 1, top: 1 }, 4, 5)).toBeCloseTo(25); // plain circle
  });

  it('pushes out along the wall normal everywhere along it (no zipper)', () => {
    const out = push();
    for (let z = 0.5; z <= 9.5; z += 0.5) {
      expect(obsPush(wall, 1, z, 1.05, out)).toBe(true);
      expect(out.nx).toBeCloseTo(1);
      expect(out.nz).toBeCloseTo(0);
      expect(out.depth).toBeCloseTo(0.35);
    }
    expect(obsPush(wall, 2, 5, 1.05, out)).toBe(false);
  });

  it('a probe exactly on the core reports a zero normal instead of NaN', () => {
    const out = push();
    expect(obsPush(wall, 0, 4, 1, out)).toBe(true);
    expect([out.nx, out.nz, out.depth].every(Number.isFinite)).toBe(true);
    expect(out.depth).toBeCloseTo(1.3);
  });

  it('a row of linked capsules is a continuous wall: a car-sized probe never fits through', () => {
    const row: Obstacle[] = [];
    for (let k = 0; k < 10; k++) row.push({ x: k * 4, z: 0, x2: (k + 1) * 4, z2: 0, r: 0.3, top: 1 });
    for (let x = 0; x <= 40; x += 0.25) expect(row.some((o) => obsOverlap(o, x, 0, 0.5))).toBe(true);
  });
});

describe('tunnelling guard', () => {
  const thin: Obstacle = { x: -5, z: 10, x2: 5, z2: 10, r: 0.15, top: 1 };
  const hit = (x: number, z: number) => obsOverlap(thin, x, z, 0.2);

  it('splits long moves into sub-steps no longer than half the probe radius', () => {
    expect(sweepSteps(1.5, 1.05)).toBe(3);
    expect(sweepSteps(0, 1)).toBe(1);
    expect(sweepSteps(Number.NaN, 1)).toBe(1);
    expect(sweepSteps(1e6, 1)).toBe(24); // capped
  });

  it('catches a thin barrier an end-point check would skip', () => {
    // F1 at 90 m/s for a 1/60 s step = 1.5 m: from z = 9.2 to 10.7 jumps clean over the 0.3 m wall + 0.2 m probe
    expect(hit(0, 9.2) || hit(0, 10.7)).toBe(false);
    const f = sweep(0, 9.2, 0, 10.7, 0.2, hit);
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
  });

  it('reports a clear path as -1', () => {
    expect(sweep(0, 0, 0, 5, 0.2, hit)).toBe(-1);
  });
});

describe('segment closest points', () => {
  const out: SegSeg = { s: 0, t: 0, d2: 0, c1x: 0, c1z: 0, c2x: 0, c2z: 0 };
  it('crossing segments touch', () => {
    segSeg(-1, 0, 1, 0, 0, -1, 0, 1, out);
    expect(out.d2).toBeCloseTo(0);
  });
  it('parallel segments', () => {
    segSeg(0, 0, 0, 4, 2, 1, 2, 3, out);
    expect(out.d2).toBeCloseTo(4);
  });
  it('degenerate (points)', () => {
    segSeg(0, 0, 0, 0, 3, 4, 3, 4, out);
    expect(out.d2).toBeCloseTo(25);
  });
});

describe('vehicle contact', () => {
  it('separates overlapping cars along the contact normal, heavier one moves less', () => {
    const a = body({ x: 0, z: 0, h: 0, m: 1000 }), b = body({ x: 1.5, z: 0, h: 0, m: 2000 });
    collidePair(a, b, P);
    expect(a.px).toBeLessThan(0); // A is on the -x side: pushed further -x
    expect(b.px).toBeGreaterThan(0);
    expect(Math.abs(a.pz) + Math.abs(b.pz)).toBeCloseTo(0);
    expect(Math.abs(a.px)).toBeCloseTo(2 * Math.abs(b.px)); // split by inverse mass
    expect(Math.abs(a.px) + Math.abs(b.px)).toBeLessThanOrEqual(P.maxPush + 1e-9);
  });

  it('conserves momentum and never adds energy', () => {
    for (const [ma, mb] of [[1000, 1000], [800, 2700], [280, 1500]]) {
      const a = body({ x: 0, z: 0, h: 0, vz: 30, m: ma }), b = body({ x: 0.4, z: 4, h: 0.3, vz: 5, vx: 2, m: mb });
      const imp = collidePair(a, b, P);
      expect(imp).toBeGreaterThan(0);
      expect(ma * a.dvx + mb * b.dvx).toBeCloseTo(0, 6);
      expect(ma * a.dvz + mb * b.dvz).toBeCloseTo(0, 6);
      const ke0 = ma * (a.vx ** 2 + a.vz ** 2) + mb * (b.vx ** 2 + b.vz ** 2);
      const ke1 = ma * ((a.vx + a.dvx) ** 2 + (a.vz + a.dvz) ** 2) + mb * ((b.vx + b.dvx) ** 2 + (b.vz + b.dvz) ** 2);
      expect(ke1).toBeLessThanOrEqual(ke0 + 1e-6);
    }
  });

  it('rear-end: the slower car ahead is pushed forward, the faster one slowed, relative speed ~ restitution', () => {
    const a = body({ x: 0, z: 0, h: 0, vz: 40 }), b = body({ x: 0, z: 4.3, h: 0, vz: 20 });
    collidePair(a, b, P);
    expect(b.dvz).toBeGreaterThan(0);
    expect(a.dvz).toBeLessThan(0);
    const rel = (a.vz + a.dvz) - (b.vz + b.dvz);
    expect(rel).toBeCloseTo(-P.restitution * 20, 5);
    expect(Math.abs(a.spin) + Math.abs(b.spin)).toBeLessThan(1e-6); // dead centre: no spin
  });

  it('side swipe spins both cars and keeps it bounded', () => {
    const a = body({ x: 0, z: 0, h: 0, vz: 30 }), b = body({ x: 1.8, z: 2, h: 0, vz: 10, vx: -4 });
    collidePair(a, b, P);
    expect(a.spin).not.toBe(0);
    expect(Math.abs(a.spin)).toBeLessThanOrEqual(P.maxSpin);
    expect(finite(a) && finite(b)).toBe(true);
  });

  it('online player (apply = false): only the local car responds, with the full separation', () => {
    const a = body({ x: 0, z: 0, h: 0, vx: 10 }), r = body({ x: 1.5, z: 0, h: 0, apply: false });
    collidePair(a, r, P);
    expect(r.dvx).toBe(0);
    expect(r.px).toBe(0);
    expect(a.dvx).toBeLessThan(0);
    expect(a.px).toBeCloseTo(-P.maxPush);
  });

  it('two cars spawned on the same spot ease apart instead of exploding, with no NaN', () => {
    const a = body({ x: 5, z: 5, h: 1 }), b = body({ x: 5, z: 5, h: 1 });
    collidePair(a, b, P);
    expect(finite(a) && finite(b)).toBe(true);
    expect(Math.hypot(a.px - b.px, a.pz - b.pz)).toBeCloseTo(P.slowPush);
    expect(a.dvx + a.dvz + b.dvx + b.dvz).toBe(0); // no velocity from overlap alone
  });

  it('far apart or at different heights: no contact', () => {
    expect(collidePair(body({ x: 0 }), body({ x: 10 }), P)).toBe(-1);
    expect(collidePair(body({ x: 0, y: 0 }), body({ x: 1, y: 5 }), P)).toBe(-1);
  });

  it('never NaN with odd inputs', () => {
    const a = body({ m: 0, r: 0, a: 0 }), b = body({ m: 0, r: 0.5, a: 0, x: 0.1 });
    collidePair(a, b, P);
    expect(finite(a) && finite(b)).toBe(true);
  });
});

describe('speed/heading after a contact', () => {
  const out = { v: 0, moveH: 0 };
  it('a push from behind keeps the car going forward', () => {
    toSpeedHeading(0, 5, 0, 0, out);
    expect(out.v).toBeCloseTo(5);
    expect(out.moveH).toBeCloseTo(0);
  });
  it('moving against the heading is a negative speed, not a 180° turn', () => {
    toSpeedHeading(0, -3, 0, 0, out);
    expect(out.v).toBeCloseTo(-3);
    expect(Math.cos(out.moveH)).toBeCloseTo(1);
  });
  it('NaN-safe', () => {
    toSpeedHeading(Number.NaN, 1, 0.5, Number.NaN, out);
    expect(out.v).toBe(0);
    expect(out.moveH).toBe(0.5);
  });
});

describe('vehicle masses from the garage specs', () => {
  it('parses "1,240 kg" and adds the driver / rider', () => {
    expect(massFromSpec('car', '1,240 kg')).toBe(1315);
    expect(massFromSpec('bike', '195 kg')).toBe(275);
    expect(massFromSpec('car', '768 kg', 800)).toBe(800);
    expect(massFromSpec('car', 'n/a')).toBeGreaterThan(1000);
  });
  it('every vehicle gets a plausible mass, bikes lighter than cars', () => {
    for (const v of VEHICLES) {
      const m = massFromSpec(v.kind, v.spec?.weight, v.f1?.mass);
      expect(m, v.id).toBeGreaterThan(v.kind === 'bike' ? 150 : 500);
      expect(m, v.id).toBeLessThan(v.kind === 'bike' ? 600 : 8000); // monster truck ~5.5 t
    }
  });
});

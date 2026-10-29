// A RoadLayout decides where roads are. Open world = infinite wavy grid, race = one closed loop.
// Terrain, chunk features, respawn and the minimap only talk to this interface.
import * as THREE from 'three';
import type { Noise } from '../utils/noise';
import { mulberry32, TAU } from '../utils/math';
import { GEN, POI_KINDS, type PoiKind } from '../config';

export interface Pose { x: number; z: number; h: number }
export type RoadPointFn = (x: number, z: number, tx: number, tz: number, along: number) => void;

export interface RoadLayout {
  readonly kind: 'grid' | 'circuit';
  roadDist(x: number, z: number): number;
  roadHeight(x: number, z: number): number;
  nearestRoad(x: number, z: number): Pose;
  /** Start position of player i. */
  spawn(i: number): Pose;
  /** Points along roads inside the square, every ~8 m, with unit tangent and distance along the road (-1 if unknown). */
  forEachRoadPoint(x0: number, z0: number, size: number, fn: RoadPointFn): void;
  drawRoads(ctx: CanvasRenderingContext2D, toMap: (x: number, z: number) => [number, number], px: number, pz: number, r: number): void;
  /** Landmarks inside a world square (open world only). */
  pois(x0: number, z0: number, size: number): Poi[];
}

const roadHeight = (noise: Noise, x: number, z: number) => 4 + noise.fbm(x / 220 + 40, z / 220 + 40, 3) * 12;

/** Deterministic 0..1 hash of integers (same on every client). */
export function hash01(a: number, b: number, c: number) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface Poi { x: number; z: number; kind: PoiKind; h: number; id: number }
interface Line { a1: number; a2: number; f1: number; f2: number; o1: number; o2: number }

/**
 * Open-world roads: two families of wavy lines crossing each other. Every seed rotates the whole
 * network and gives each line its own curviness, so no two worlds share the same road map.
 * Crossroads can host landmarks (villages, gas stations, windmills, stunt zones, drone outposts).
 */
export class GridRoads implements RoadLayout {
  readonly kind = 'grid';
  private readonly G: number;
  private readonly A: number;
  private readonly c: number;
  private readonly s: number;
  private lines = new Map<number, Line>();

  constructor(private noise: Noise, private seed: number, roads = 1, private poiChance = 0.35) {
    this.G = GEN.roads[roads].spacing;
    this.A = GEN.roads[roads].curve;
    const ang = hash01(seed, 7, 11) * Math.PI * 0.5;
    this.c = Math.cos(ang);
    this.s = Math.sin(ang);
  }

  private line(k: number, axis: number): Line {
    const key = k * 2 + axis;
    let L = this.lines.get(key);
    if (!L) {
      const h = (i: number) => hash01(k, axis * 31 + i, this.seed);
      L = { a1: 30 * this.A * (0.45 + h(1)), a2: 12 * this.A * (0.4 + h(2)), f1: 110 * (0.7 + h(3) * 0.7), f2: 47 * (0.7 + h(4) * 0.7), o1: h(5) * 20, o2: h(6) * 20 };
      this.lines.set(key, L);
    }
    return L;
  }
  // local frame: u across "vertical" roads, w along them
  private ru(k: number, w: number) { const L = this.line(k, 0); return k * this.G + L.a1 * Math.sin(w / L.f1 + L.o1) + L.a2 * Math.sin(w / L.f2 + L.o2); }
  private rw(j: number, u: number) { const L = this.line(j, 1); return j * this.G + L.a1 * Math.sin(u / L.f1 + L.o1) + L.a2 * Math.sin(u / L.f2 + L.o2); }
  private dru(k: number, w: number) { const L = this.line(k, 0); return (L.a1 / L.f1) * Math.cos(w / L.f1 + L.o1) + (L.a2 / L.f2) * Math.cos(w / L.f2 + L.o2); }
  private drw(j: number, u: number) { const L = this.line(j, 1); return (L.a1 / L.f1) * Math.cos(u / L.f1 + L.o1) + (L.a2 / L.f2) * Math.cos(u / L.f2 + L.o2); }
  private toU(x: number, z: number) { return x * this.c + z * this.s; }
  private toW(x: number, z: number) { return -x * this.s + z * this.c; }
  private toX(u: number, w: number) { return u * this.c - w * this.s; }
  private toZ(u: number, w: number) { return u * this.s + w * this.c; }

  private distV(u: number, w: number) {
    let d = 1e9;
    const k0 = Math.round(u / this.G);
    for (let k = k0 - 1; k <= k0 + 1; k++) d = Math.min(d, Math.abs(u - this.ru(k, w)));
    return d * 0.93;
  }
  private distH(u: number, w: number) {
    let d = 1e9;
    const j0 = Math.round(w / this.G);
    for (let j = j0 - 1; j <= j0 + 1; j++) d = Math.min(d, Math.abs(w - this.rw(j, u)));
    return d * 0.93;
  }

  roadDist(x: number, z: number) {
    const u = this.toU(x, z), w = this.toW(x, z);
    return Math.min(this.distV(u, w), this.distH(u, w));
  }
  roadHeight(x: number, z: number) { return roadHeight(this.noise, x, z); }

  /** World pose from a local point + local tangent. */
  private pose(u: number, w: number, tu: number, tw: number): Pose {
    const dx = tu * this.c - tw * this.s, dz = tu * this.s + tw * this.c;
    return { x: this.toX(u, w), z: this.toZ(u, w), h: Math.atan2(dx, dz) };
  }

  nearestRoad(x: number, z: number): Pose {
    const u = this.toU(x, z), w = this.toW(x, z);
    let best: Pose = { x, z, h: 0 }, bd = 1e9;
    const kx = Math.round(u / this.G), kz = Math.round(w / this.G);
    for (let k = kx - 1; k <= kx + 1; k++) {
      const ru = this.ru(k, w), d = Math.abs(ru - u);
      if (d < bd) { bd = d; best = this.pose(ru, w, this.dru(k, w), 1); }
    }
    for (let j = kz - 1; j <= kz + 1; j++) {
      const rw = this.rw(j, u), d = Math.abs(rw - w);
      if (d < bd) { bd = d; best = this.pose(u, rw, 1, this.drw(j, u)); }
    }
    return best;
  }

  spawn(i: number): Pose {
    const row = Math.floor(i / 2), w = -row * 7, side = i === 0 && row === 0 ? 0 : i % 2 ? 2.6 : -2.6;
    return this.pose(this.ru(0, w) + side, w, this.dru(0, w), 1);
  }

  /** Bounding box of a world square in the local road frame. */
  private localBox(x0: number, z0: number, size: number) {
    let u0 = 1e9, u1 = -1e9, w0 = 1e9, w1 = -1e9;
    for (const [x, z] of [[x0, z0], [x0 + size, z0], [x0, z0 + size], [x0 + size, z0 + size]]) {
      const u = this.toU(x, z), w = this.toW(x, z);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w);
    }
    return { u0, u1, w0, w1 };
  }

  forEachRoadPoint(x0: number, z0: number, size: number, fn: RoadPointFn) {
    const G = this.G, b = this.localBox(x0, z0, size);
    const inside = (x: number, z: number) => x >= x0 && x < x0 + size && z >= z0 && z < z0 + size;
    for (let k = Math.floor((b.u0 - 80) / G); k <= Math.ceil((b.u1 + 80) / G); k++)
      for (let w = Math.ceil(b.w0 / 8) * 8 + 4; w < b.w1; w += 8) {
        const u = this.ru(k, w);
        if (this.distH(u, w) < 22) continue;
        const P = this.pose(u, w, this.dru(k, w), 1);
        if (inside(P.x, P.z)) fn(P.x, P.z, Math.sin(P.h), Math.cos(P.h), -1);
      }
    for (let j = Math.floor((b.w0 - 80) / G); j <= Math.ceil((b.w1 + 80) / G); j++)
      for (let u = Math.ceil(b.u0 / 8) * 8 + 4; u < b.u1; u += 8) {
        const w = this.rw(j, u);
        if (this.distV(u, w) < 22) continue;
        const P = this.pose(u, w, 1, this.drw(j, u));
        if (inside(P.x, P.z)) fn(P.x, P.z, Math.sin(P.h), Math.cos(P.h), -1);
      }
  }

  /** Landmarks at crossroads inside a world square. */
  pois(x0: number, z0: number, size: number): Poi[] {
    if (this.poiChance <= 0) return [];
    const G = this.G, b = this.localBox(x0, z0, size), out: Poi[] = [];
    const total = POI_KINDS.reduce((a, p) => a + p.weight, 0);
    for (let k = Math.floor((b.u0 - 60) / G); k <= Math.ceil((b.u1 + 60) / G); k++)
      for (let j = Math.floor((b.w0 - 60) / G); j <= Math.ceil((b.w1 + 60) / G); j++) {
        if ((k === 0 && (j === 0 || j === -1)) || hash01(k, j, this.seed ^ 0x9e37) > this.poiChance) continue;
        let u = k * G, w = j * G;
        for (let it = 0; it < 4; it++) { u = this.ru(k, w); w = this.rw(j, u); } // solve for the crossing point
        const x = this.toX(u, w), z = this.toZ(u, w);
        if (x < x0 || x >= x0 + size || z < z0 || z >= z0 + size) continue;
        let r = hash01(k, j, this.seed ^ 0x51ed) * total, kind = POI_KINDS[0].kind;
        for (const p of POI_KINDS) { if ((r -= p.weight) <= 0) { kind = p.kind; break; } }
        out.push({ x, z, kind, h: this.pose(u, w, this.dru(k, w), 1).h, id: k * 100003 + j });
      }
    return out;
  }

  drawRoads(ctx: CanvasRenderingContext2D, toMap: (x: number, z: number) => [number, number], px: number, pz: number, R: number) {
    const pu = this.toU(px, pz), pw = this.toW(px, pz), span = R * 1.5, n = Math.ceil(span / this.G) + 1;
    const kx = Math.round(pu / this.G), kz = Math.round(pw / this.G), step = Math.max(6, R / 30);
    for (let k = kx - n; k <= kx + n; k++) {
      ctx.beginPath();
      for (let w = pw - span; w <= pw + span; w += step) {
        const u = this.ru(k, w), [a, b] = toMap(this.toX(u, w), this.toZ(u, w));
        if (w === pw - span) ctx.moveTo(a, b); else ctx.lineTo(a, b);
      }
      ctx.stroke();
    }
    for (let j = kz - n; j <= kz + n; j++) {
      ctx.beginPath();
      for (let u = pu - span; u <= pu + span; u += step) {
        const w = this.rw(j, u), [a, b] = toMap(this.toX(u, w), this.toZ(u, w));
        if (u === pu - span) ctx.moveTo(a, b); else ctx.lineTo(a, b);
      }
      ctx.stroke();
    }
  }
}

/** Closed race loop built from a seeded Catmull-Rom spline, sampled every ~2 m with a spatial hash for fast lookups. */
export class Circuit implements RoadLayout {
  readonly kind = 'circuit';
  readonly n: number;
  readonly length: number;
  readonly spacing: number;
  readonly px: Float32Array;
  readonly pz: Float32Array;
  readonly tx: Float32Array;
  readonly tz: Float32Array;
  private cells = new Map<number, number[]>();
  private readonly CELL = 40;

  constructor(private noise: Noise, seed: number) {
    const rng = mulberry32(seed ^ 0x5eed);
    const N = 14, R = 300 + rng() * 120, aspect = 0.8 + rng() * 0.4;
    const cps: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU, r = R * (0.72 + rng() * 0.5);
      cps.push(new THREE.Vector3(Math.sin(a) * r * aspect, 0, Math.cos(a) * r));
    }
    const curve = new THREE.CatmullRomCurve3(cps, true, 'centripetal');
    this.length = curve.getLength();
    this.n = Math.round(this.length / 2);
    this.spacing = this.length / this.n;
    const pts = curve.getSpacedPoints(this.n);
    this.px = new Float32Array(this.n); this.pz = new Float32Array(this.n);
    this.tx = new Float32Array(this.n); this.tz = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) { this.px[i] = pts[i].x; this.pz[i] = pts[i].z; }
    for (let i = 0; i < this.n; i++) {
      const a = (i - 1 + this.n) % this.n, b = (i + 1) % this.n;
      const dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a], l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
      const key = this.key(Math.floor(this.px[i] / this.CELL), Math.floor(this.pz[i] / this.CELL));
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(i);
    }
  }

  private key(cx: number, cz: number) { return (cx + 4096) * 8192 + (cz + 4096); }

  /** Nearest sample index. Searches 3x3 cells; with exhaustive=true falls back to all samples when far away. */
  nearest(x: number, z: number, exhaustive = false): { i: number; d: number } {
    const cx = Math.floor(x / this.CELL), cz = Math.floor(z / this.CELL);
    let bi = -1, bd = 1e18;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const list = this.cells.get(this.key(cx + a, cz + b));
        if (!list) continue;
        for (const i of list) {
          const dx = x - this.px[i], dz = z - this.pz[i], d = dx * dx + dz * dz;
          if (d < bd) { bd = d; bi = i; }
        }
      }
    if (bi < 0 && exhaustive)
      for (let i = 0; i < this.n; i++) {
        const dx = x - this.px[i], dz = z - this.pz[i], d = dx * dx + dz * dz;
        if (d < bd) { bd = d; bi = i; }
      }
    return { i: bi, d: bi < 0 ? 1e9 : Math.sqrt(bd) };
  }

  roadDist(x: number, z: number) { return this.nearest(x, z).d; }
  pois(): Poi[] { return []; }

  /** How sharply the track bends at sample i (sine of the turn over ~12 m, sign = direction). */
  curvature(i: number) {
    const a = (i - 3 + this.n) % this.n, b = (i + 3) % this.n;
    return this.tx[a] * this.tz[b] - this.tz[a] * this.tx[b];
  }
  roadHeight(x: number, z: number) { return roadHeight(this.noise, x, z); }

  nearestRoad(x: number, z: number): Pose {
    const { i } = this.nearest(x, z, true);
    return { x: this.px[i], z: this.pz[i], h: Math.atan2(this.tx[i], this.tz[i]) };
  }

  spawn(i: number): Pose {
    const row = Math.floor(i / 2), back = 8 + row * 7, side = i % 2 ? 2.6 : -2.6;
    const j = (this.n - Math.round(back / this.spacing)) % this.n;
    const tx = this.tx[j], tz = this.tz[j];
    return { x: this.px[j] + tz * side, z: this.pz[j] - tx * side, h: Math.atan2(tx, tz) };
  }

  forEachRoadPoint(x0: number, z0: number, size: number, fn: RoadPointFn) {
    const step = Math.max(1, Math.round(8 / this.spacing));
    for (let i = 0; i < this.n; i += step) {
      const x = this.px[i], z = this.pz[i];
      if (x < x0 || x >= x0 + size || z < z0 || z >= z0 + size) continue;
      fn(x, z, this.tx[i], this.tz[i], i * this.spacing);
    }
  }

  drawRoads(ctx: CanvasRenderingContext2D, toMap: (x: number, z: number) => [number, number]) {
    ctx.beginPath();
    for (let i = 0; i <= this.n; i += 3) {
      const j = i % this.n, [a, b] = toMap(this.px[j], this.pz[j]);
      if (i === 0) ctx.moveTo(a, b);
      else ctx.lineTo(a, b);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

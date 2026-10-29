// A RoadLayout decides where roads are. Open world = infinite wavy grid, race = one closed loop.
// Terrain, chunk features, respawn and the minimap only talk to this interface.
import * as THREE from 'three';
import type { Noise } from '../utils/noise';
import { mulberry32, TAU } from '../utils/math';
import { WORLD } from '../config';

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
}

const roadHeight = (noise: Noise, x: number, z: number) => 4 + noise.fbm(x / 220 + 40, z / 220 + 40, 3) * 12;

export class GridRoads implements RoadLayout {
  readonly kind = 'grid';
  private readonly G = WORLD.grid;
  constructor(private noise: Noise) {}

  private rx(k: number, z: number) { return k * this.G + 30 * Math.sin(z / 110 + k * 1.3) + 12 * Math.sin(z / 47 + k * 2.1); }
  private rz(k: number, x: number) { return k * this.G + 30 * Math.sin(x / 120 + k * 0.7) + 12 * Math.sin(x / 53 + k * 1.9); }
  private drx(k: number, z: number) { return (30 / 110) * Math.cos(z / 110 + k * 1.3) + (12 / 47) * Math.cos(z / 47 + k * 2.1); }
  private drz(k: number, x: number) { return (30 / 120) * Math.cos(x / 120 + k * 0.7) + (12 / 53) * Math.cos(x / 53 + k * 1.9); }

  private distV(x: number, z: number) {
    let d = 1e9;
    const k0 = Math.round(x / this.G);
    for (let k = k0 - 1; k <= k0 + 1; k++) d = Math.min(d, Math.abs(x - this.rx(k, z)));
    return d * 0.93;
  }
  private distH(x: number, z: number) {
    let d = 1e9;
    const k0 = Math.round(z / this.G);
    for (let k = k0 - 1; k <= k0 + 1; k++) d = Math.min(d, Math.abs(z - this.rz(k, x)));
    return d * 0.93;
  }

  roadDist(x: number, z: number) { return Math.min(this.distV(x, z), this.distH(x, z)); }
  roadHeight(x: number, z: number) { return roadHeight(this.noise, x, z); }

  nearestRoad(x: number, z: number): Pose {
    let best: Pose = { x, z, h: 0 }, bd = 1e9;
    const kx = Math.round(x / this.G), kz = Math.round(z / this.G);
    for (let k = kx - 1; k <= kx + 1; k++) {
      const rx = this.rx(k, z), d = Math.abs(rx - x);
      if (d < bd) { bd = d; best = { x: rx, z, h: Math.atan2(this.drx(k, z), 1) }; }
    }
    for (let k = kz - 1; k <= kz + 1; k++) {
      const rz = this.rz(k, x), d = Math.abs(rz - z);
      if (d < bd) { bd = d; best = { x, z: rz, h: Math.atan2(1, this.drz(k, x)) }; }
    }
    return best;
  }

  spawn(i: number): Pose {
    const row = Math.floor(i / 2), z = -row * 7, side = i % 2 ? 1.8 : -1.8;
    return { x: this.rx(0, z) + (i === 0 && row === 0 ? 0 : side), z, h: Math.atan2(this.drx(0, z), 1) };
  }

  forEachRoadPoint(x0: number, z0: number, size: number, fn: RoadPointFn) {
    const G = this.G;
    for (let k = Math.floor((x0 - 60) / G); k <= Math.ceil((x0 + size + 60) / G); k++)
      for (let z = z0 + 4; z < z0 + size; z += 8) {
        const x = this.rx(k, z);
        if (x < x0 || x >= x0 + size || this.distH(x, z) < 22) continue;
        const d = this.drx(k, z), l = Math.hypot(d, 1);
        fn(x, z, d / l, 1 / l, -1);
      }
    for (let k = Math.floor((z0 - 60) / G); k <= Math.ceil((z0 + size + 60) / G); k++)
      for (let x = x0 + 4; x < x0 + size; x += 8) {
        const z = this.rz(k, x);
        if (z < z0 || z >= z0 + size || this.distV(x, z) < 22) continue;
        const d = this.drz(k, x), l = Math.hypot(1, d);
        fn(x, z, 1 / l, d / l, -1);
      }
  }

  drawRoads(ctx: CanvasRenderingContext2D, toMap: (x: number, z: number) => [number, number], px: number, pz: number, R: number) {
    const kx = Math.round(px / this.G), kz = Math.round(pz / this.G);
    for (let k = kx - 2; k <= kx + 2; k++) {
      ctx.beginPath();
      for (let z = pz - R; z <= pz + R; z += 10) { const [a, b] = toMap(this.rx(k, z), z); if (z === pz - R) ctx.moveTo(a, b); else ctx.lineTo(a, b); }
      ctx.stroke();
    }
    for (let k = kz - 2; k <= kz + 2; k++) {
      ctx.beginPath();
      for (let x = px - R; x <= px + R; x += 10) { const [a, b] = toMap(x, this.rz(k, x)); if (x === px - R) ctx.moveTo(a, b); else ctx.lineTo(a, b); }
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
  roadHeight(x: number, z: number) { return roadHeight(this.noise, x, z); }

  nearestRoad(x: number, z: number): Pose {
    const { i } = this.nearest(x, z, true);
    return { x: this.px[i], z: this.pz[i], h: Math.atan2(this.tx[i], this.tz[i]) };
  }

  spawn(i: number): Pose {
    const row = Math.floor(i / 2), back = 8 + row * 7, side = i % 2 ? 1.8 : -1.8;
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

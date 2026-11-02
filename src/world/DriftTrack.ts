// Drift venues: closed loops with wide drivable pads, named drift zones (score multipliers) and venue dressing.
// Layout ideas from real events: container-yard drift days (walls of stacked boxes, inner/outer clipping points
// judged on line + angle), Japanese touge passes (switchback hairpins with guard rails on the drop side),
// skidpad figure-8s (two constant-radius circles joined by a crossover) and gymkhana arenas
// (slaloms, 180/360 spins around a post, barrier chicanes on one big open pad).
import * as THREE from 'three';
import type { Noise } from '../utils/noise';
import type { Game } from '../core/Game';
import type { Chunk, Obstacle } from './Chunks';
import { hash01, type Poi, type Pose, type RoadLayout, type RoadPointFn } from './layout';
import { G, M, MAT, canvasTex } from '../entities/assets';
import { ROAD } from '../config';
import { clamp, mulberry32, PI, TAU } from '../utils/math';

export type DriftTrackId = 'docks' | 'touge' | 'skidpad' | 'gymkhana' | 'random';

export const DRIFT_TRACKS: {
  id: DriftTrackId;
  name: string;
  blurb: string;
  time: 'day' | 'dawn' | 'sunset' | 'night';
  weather: 'clear' | 'cloudy' | 'rain' | 'fog';
  theme: 'mixed' | 'desert' | 'forest' | 'alpine' | 'islands';
}[] = [
  { id: 'docks', name: 'Container Port', blurb: 'Wide yard loop between walls of stacked containers. Clip the cranes, kiss the boxes.', time: 'night', weather: 'clear', theme: 'islands' },
  { id: 'touge', name: 'Mountain Pass', blurb: 'Narrow switchback climb: seven hairpins, guard rails on the drop side, flowing S-bends down.', time: 'dawn', weather: 'fog', theme: 'forest' },
  { id: 'skidpad', name: 'Figure-8 Skidpad', blurb: 'Two constant-radius circles and a crossover. Hold the angle, flick through the middle.', time: 'day', weather: 'clear', theme: 'desert' },
  { id: 'gymkhana', name: 'Gymkhana Arena', blurb: 'One huge pad: barrel slaloms, a donut post, barrier and container chicanes.', time: 'sunset', weather: 'cloudy', theme: 'mixed' },
  { id: 'random', name: 'Random Venue', blurb: 'A seeded mix of corners, walls and clipping points. New every seed.', time: 'day', weather: 'clear', theme: 'mixed' },
];

/** Sample-index range along the centre line (i0 > i1 means it wraps past the start line) and its score multiplier. */
export interface DriftZone { name: string; i0: number; i1: number; mult: number }

// ---------------------------------------------------------------------------------------------
// shared geometry / materials (module level, created once)

type PartId = 'cont' | 'box' | 'paint' | 'crowd' | 'cone' | 'barrel' | 'tyre' | 'cyl' | 'rock' | 'lamp';

const contMat = new THREE.MeshStandardMaterial({
  map: canvasTex(64, 32, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let x = 1; x < w; x += 4) g.fillRect(x, 0, 2, h);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, h - 2, w, 2);
    g.fillRect(0, 0, 2, h);
    g.fillRect(w - 2, 0, 2, h);
  }),
  roughness: 0.7,
  metalness: 0.2,
});
const crowdMat = new THREE.MeshStandardMaterial({
  map: canvasTex(128, 32, (g, w, h) => {
    g.fillStyle = '#39404d';
    g.fillRect(0, 0, w, h);
    const cols = ['#e2483d', '#3c8dff', '#ffd23f', '#39c46a', '#ffffff', '#ff7ad9'];
    for (let i = 0; i < 160; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect((i * 37) % w, ((i * 13) % 4) * 8 + 2, 4, 5); }
  }),
  roughness: 0.9,
});
const paintMat = M(0xffffff, { roughness: 0.6, flatShading: false });
const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
const tyreGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.5, 10);

const PARTS: Record<PartId, { g: THREE.BufferGeometry; m: THREE.Material; shadow: boolean }> = {
  cont: { g: G.box, m: contMat, shadow: true },
  box: { g: G.box, m: MAT.white, shadow: true },
  paint: { g: G.box, m: paintMat, shadow: false },
  crowd: { g: G.box, m: crowdMat, shadow: true },
  cone: { g: G.tcone, m: MAT.white, shadow: false },
  barrel: { g: G.barrel, m: MAT.white, shadow: true },
  tyre: { g: tyreGeo, m: MAT.white, shadow: true },
  cyl: { g: cylGeo, m: MAT.white, shadow: true },
  rock: { g: G.rock, m: MAT.white, shadow: true },
  lamp: { g: G.box, m: lampMat, shadow: false },
};

const CONTAINER_COLS = [0xc0392b, 0x2c5f9e, 0xe67e22, 0x2e8b57, 0x8a9199, 0xd4a017, 0x9b3b2a, 0x3d7a8c];
const CONE = 0xff7a1a, CONCRETE = 0xd9d6cf, STEEL = 0x6b7078, WHITE = 0xf4f4f4, RED = 0xd8322a, BLUE = 0x2c6fb7;
const zoneColor = (mult: number) => (mult < 1.5 ? 0xffd23f : mult < 2 ? 0xff8a1f : 0xff2a6a);

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color();

/** One instanced box/cone/... placed relative to the ground under its anchor (gx, gz). */
interface Prop { p: PartId; x: number; z: number; y: number; h: number; sx: number; sy: number; sz: number; c: number; gx: number; gz: number }

// ---------------------------------------------------------------------------------------------
// centre-line generators (metres, x/z). Dense or sparse control points for a closed centripetal Catmull-Rom.

type V2 = [number, number];

function line(out: V2[], a: V2, b: V2, step = 8) {
  const k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  for (let i = 0; i < k; i++) out.push([a[0] + ((b[0] - a[0]) * i) / k, a[1] + ((b[1] - a[1]) * i) / k]);
}
function arc(out: V2[], cx: number, cz: number, r: number, a0: number, a1: number, step = 8) {
  const k = Math.max(2, Math.round((Math.abs(a1 - a0) * r) / step));
  for (let i = 0; i < k; i++) { const a = a0 + ((a1 - a0) * i) / k; out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
}

/** Container port: big yard loop with a pocket ("Container Alley") and a V-dip on the quay side. */
function docksPts(): V2[] {
  return [[0, -170], [130, -170], [215, -140], [240, -60], [190, -10], [120, 10], [110, 65], [180, 95], [230, 150], [180, 210], [60, 210], [0, 165], [-60, 210], [-180, 210], [-240, 140], [-200, 60], [-250, -20], [-230, -120], [-140, -170]];
}

/** Mountain pass: 7 switchback legs climbing in z joined by 6 hairpins, an S-bend descent and a bottom hairpin back. */
function tougePts(): V2[] {
  const out: V2[] = [[-20, 0], [40, 0]], E = 80, GAP = 48;
  for (let k = 0; k < 7; k++) {
    const dir = k % 2 ? -1 : 1, z = k * GAP;
    if (k > 0) for (const [j, x] of [[0, -40], [1, 0], [2, 40]]) out.push([dir * x, z + (j % 2 ? -5 : 5) * (k % 3 ? 1 : -1)]);
    if (k === 6) { out.push([E, z]); break; }
    // hairpin at the end of this leg (x = dir*E), from z to z+GAP
    out.push([dir * E, z], [dir * (E + 16), z + 6], [dir * (E + 23), z + GAP / 2], [dir * (E + 16), z + GAP - 6], [dir * E, z + GAP]);
  }
  out.push([110, 292], [150, 282], [185, 245], [165, 200], [200, 150], [170, 100], [205, 50], [180, 0], [150, -50], [100, -75], [40, -68], [-20, -84], [-80, -74], [-125, -58], [-140, -30], [-128, -8], [-100, 0], [-60, 0]);
  return out;
}

/** Figure-8: two R=42 circles centred at x=±75, crossover through the origin. */
function skidpadPts(): V2[] {
  const C = 75, R = 42, b = Math.acos(R / C), cb = R * Math.cos(b), sb = R * Math.sin(b), o: V2[] = [];
  line(o, [0, 0], [C - cb, -sb]);
  arc(o, C, 0, R, PI + b, 3 * PI - b);
  line(o, [C - cb, sb], [0, 0]);
  line(o, [0, 0], [-C + cb, -sb]);
  arc(o, -C, 0, R, -b, -(2 * PI - b));
  line(o, [-C + cb, sb], [0, 0]);
  return o;
}

const GYM = { A: 140, B: 90, r: 45 };
/** Gymkhana: rounded rectangle, starting mid bottom straight heading +x, counter-clockwise. */
function gymkhanaPts(): V2[] {
  const { A, B, r } = GYM, o: V2[] = [];
  line(o, [0, -B], [A - r, -B]);
  arc(o, A - r, -B + r, r, -PI / 2, 0);
  line(o, [A, -B + r], [A, B - r]);
  arc(o, A - r, B - r, r, 0, PI / 2);
  line(o, [A - r, B], [-A + r, B]);
  arc(o, -A + r, B - r, r, PI / 2, PI);
  line(o, [-A, B - r], [-A, -B + r]);
  arc(o, -A + r, -B + r, r, PI, 1.5 * PI);
  line(o, [-A + r, -B], [0, -B]);
  return o;
}
/** Nominal (pre-spline) length and segment starts of the gymkhana loop, for placing obstacles by distance. */
function gymSeg() {
  const { A, B, r } = GYM, q = (PI / 2) * r, b1 = A - r, sv = 2 * (B - r), sh = 2 * (A - r);
  const c1 = b1, right = c1 + q, c2 = right + sv, top = c2 + q, c3 = top + sh, left = c3 + q, c4 = left + sv, bot2 = c4 + q;
  return { right, top, left, bot2, total: bot2 + b1 };
}

function randomPts(rng: () => number): V2[] {
  const N = 9 + Math.floor(rng() * 4), R = 150 + rng() * 70, asp = 0.75 + rng() * 0.5, o: V2[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU + (rng() - 0.5) * 0.25, r = R * (0.55 + rng() * 0.7);
    o.push([Math.sin(a) * r * asp, -Math.cos(a) * r]);
  }
  return o;
}

// ---------------------------------------------------------------------------------------------

export class DriftTrack implements RoadLayout {
  readonly kind = 'drift';
  readonly n: number;
  readonly length: number;
  readonly spacing: number;
  readonly px: Float32Array;
  readonly pz: Float32Array;
  readonly tx: Float32Array;
  readonly tz: Float32Array;
  /** Drivable half-width per sample. */
  readonly halfWidth: Float32Array;
  readonly zones: DriftZone[] = [];
  /** Signed turn angle (radians) over ±16 m at each sample. */
  private readonly turn: Float32Array;
  private readonly apex: number[] = [];
  private readonly cells = new Map<number, number[]>();
  private readonly CELL = 48;
  private readonly base = 5;
  private climb = 0;
  private iTop = 1;
  private cx = 0;
  private cz = 0;
  private readonly props: Prop[] = [];
  /** Colliders; top is relative to the ground. */
  private readonly solids: Obstacle[] = [];

  constructor(_noise: Noise, readonly id: DriftTrackId, private readonly seed: number) {
    const rng = mulberry32((seed ^ 0xd21f7) >>> 0);
    const ctrl = id === 'docks' ? docksPts() : id === 'touge' ? tougePts() : id === 'skidpad' ? skidpadPts() : id === 'gymkhana' ? gymkhanaPts() : randomPts(rng);
    const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    this.length = curve.getLength();
    const n = (this.n = Math.round(this.length / 2));
    this.spacing = this.length / n;
    const pts = curve.getSpacedPoints(n);
    this.px = new Float32Array(n); this.pz = new Float32Array(n);
    this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    this.turn = new Float32Array(n);
    this.halfWidth = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.px[i] = pts[i].x; this.pz[i] = pts[i].z; this.cx += pts[i].x / n; this.cz += pts[i].z / n; }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      const dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a], l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
      const key = this.key(Math.floor(this.px[i] / this.CELL), Math.floor(this.pz[i] / this.CELL));
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(i);
    }
    const K = 8;
    for (let i = 0; i < n; i++) {
      const a = (i - K + n) % n, b = (i + K) % n;
      this.turn[i] = Math.atan2(this.tx[a] * this.tz[b] - this.tz[a] * this.tx[b], this.tx[a] * this.tx[b] + this.tz[a] * this.tz[b]);
    }

    // drivable width: wide pads, wider still in the corners (more room to swing the tail)
    const raw = new Float32Array(n), wBase = 11 + rng() * 6;
    for (let i = 0; i < n; i++) {
      const t = Math.abs(this.turn[i]);
      raw[i] = id === 'docks' ? 16 + 6 * clamp(t / 0.9, 0, 1)
        : id === 'touge' ? 6.5 + 1.5 * clamp(t / 1.3, 0, 1)
        : id === 'skidpad' ? 18
        : id === 'gymkhana' ? 25
        : wBase + 5 * clamp(t / 0.8, 0, 1);
    }
    const W = 12;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = -W; j <= W; j++) s += raw[(i + j + n) % n];
      this.halfWidth[i] = s / (2 * W + 1);
    }

    if (id === 'touge') {
      let top = 0;
      for (let i = 1; i < n; i++) if (this.pz[i] > this.pz[top]) top = i;
      this.iTop = Math.max(1, Math.min(n - 1, top));
      this.climb = 26;
    }

    this.buildZones();
    if (id === 'docks') this.dressDocks();
    else if (id === 'touge') this.dressTouge();
    else if (id === 'skidpad') this.dressSkidpad();
    else if (id === 'gymkhana') this.dressGymkhana();
    else this.dressRandom();
    this.dressZones();
  }

  // ------------------------------------------------------------------ RoadLayout

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

  /** 0..ROAD.asphalt anywhere inside the drivable width, so the whole pad renders as asphalt. */
  roadDist(x: number, z: number) {
    const r = this.nearest(x, z);
    return r.i < 0 ? 1e9 : Math.max(0, r.d - this.halfWidth[r.i] + ROAD.asphalt);
  }

  roadHeight(x: number, z: number) {
    if (!this.climb) return this.base;
    const { i } = this.nearest(x, z);
    if (i < 0) return this.base;
    const f = ((x - this.px[i]) * this.tx[i] + (z - this.pz[i]) * this.tz[i]) / this.spacing;
    return this.elev(i + clamp(f, -1, 1));
  }

  /** Smooth climb to the top of the pass and back down, by (fractional) sample index. */
  private elev(fi: number) {
    const n = this.n;
    fi = ((fi % n) + n) % n;
    const u = fi <= this.iTop ? fi / this.iTop : 1 - (fi - this.iTop) / (n - this.iTop);
    return this.base + this.climb * u * u * (3 - 2 * u);
  }

  nearestRoad(x: number, z: number): Pose {
    const { i } = this.nearest(x, z, true);
    return { x: this.px[i], z: this.pz[i], h: Math.atan2(this.tx[i], this.tz[i]) };
  }

  spawn(i: number): Pose {
    const row = Math.floor(i / 2), back = 8 + row * 8, side = (i % 2 ? 1 : -1) * (this.id === 'touge' ? 2.6 : 3.2);
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
    const [ax, az] = toMap(0, 0), [bx, bz] = toMap(100, 0), scale = Math.hypot(bx - ax, bz - az) / 100;
    const lw0 = ctx.lineWidth, cap = ctx.lineCap, join = ctx.lineJoin;
    ctx.lineCap = ctx.lineJoin = 'round';
    const step = 3;
    let i = 0;
    while (i < this.n) {
      const w = Math.max(lw0, this.halfWidth[i] * 2 * scale);
      ctx.lineWidth = w;
      ctx.beginPath();
      const [sx, sz] = toMap(this.px[i], this.pz[i]);
      ctx.moveTo(sx, sz);
      let j = i;
      do {
        j = Math.min(j + step, this.n);
        const k = j % this.n, [a, b] = toMap(this.px[k], this.pz[k]);
        ctx.lineTo(a, b);
      } while (j < this.n && Math.abs(Math.max(lw0, this.halfWidth[j] * 2 * scale) - w) < 0.5);
      ctx.stroke();
      i = j;
    }
    ctx.lineWidth = lw0; ctx.lineCap = cap; ctx.lineJoin = join;
  }

  pois(): Poi[] { return []; }

  /** Zone the point is in, or null (used for scoring + HUD). */
  zoneAt(x: number, z: number): DriftZone | null {
    const r = this.nearest(x, z);
    if (r.i < 0 || r.d > this.halfWidth[r.i] + 3) return null;
    for (const zn of this.zones)
      if (zn.i0 <= zn.i1 ? r.i >= zn.i0 && r.i <= zn.i1 : r.i >= zn.i0 || r.i <= zn.i1) return zn;
    return null;
  }

  /** Build venue dressing for one chunk square: instanced meshes into ch.meshes + scene, colliders into ch.obs. */
  dress(game: Game, ch: Chunk, x0: number, z0: number, size: number) {
    const T = game.terrain, inside = (x: number, z: number) => x >= x0 && x < x0 + size && z >= z0 && z < z0 + size;
    const buckets = new Map<PartId, { m: number[]; c: number[] }>();
    let lastX = NaN, lastZ = NaN, gy = 0;
    for (const p of this.props) {
      if (!inside(p.gx, p.gz)) continue;
      if (p.gx !== lastX || p.gz !== lastZ) { gy = T.heightAt(p.gx, p.gz); lastX = p.gx; lastZ = p.gz; }
      if (gy < 0.5) continue; // under water
      let b = buckets.get(p.p);
      if (!b) buckets.set(p.p, (b = { m: [], c: [] }));
      _m.compose(_p.set(p.x, gy + p.y, p.z), _q.setFromAxisAngle(UP, p.h), _s.set(p.sx, p.sy, p.sz));
      for (let k = 0; k < 16; k++) b.m.push(_m.elements[k]);
      b.c.push(p.c);
    }
    for (const s of this.solids) {
      if (!inside(s.x, s.z)) continue;
      const y = T.heightAt(s.x, s.z);
      if (y >= 0.5) ch.obs.push({ x: s.x, z: s.z, r: s.r, top: y + s.top });
    }
    for (const [id, b] of buckets) {
      const P = PARTS[id], im = new THREE.InstancedMesh(P.g, P.m, b.c.length);
      (im.instanceMatrix.array as Float32Array).set(b.m);
      b.c.forEach((c, i) => im.setColorAt(i, _c.setHex(c)));
      im.castShadow = P.shadow;
      im.receiveShadow = true;
      game.scene.add(im);
      ch.meshes.push(im);
    }
  }

  // ------------------------------------------------------------------ helpers (construction time)

  private h(i: number) { return Math.atan2(this.tx[i], this.tz[i]); }
  /** Point offset sideways from sample i (positive = right-hand normal (tz, -tx)). */
  private at(i: number, off: number): V2 { i = ((i % this.n) + this.n) % this.n; return [this.px[i] + this.tz[i] * off, this.pz[i] - this.tx[i] * off]; }
  /** +1/-1: the side of sample i facing away from the loop's centroid. */
  private outSign(i: number) { return (this.px[i] - this.cx) * this.tz[i] - (this.pz[i] - this.cz) * this.tx[i] >= 0 ? 1 : -1; }
  /** Distance beyond the drivable edge (negative = on the pad). */
  private edge(x: number, z: number) { const r = this.nearest(x, z); return r.i < 0 ? 1e9 : r.d - this.halfWidth[r.i]; }
  private idx(s: number) { return ((Math.round(s / this.spacing) % this.n) + this.n) % this.n; }
  private put(p: PartId, x: number, z: number, y: number, h: number, sx: number, sy: number, sz: number, c: number, gx = x, gz = z) {
    this.props.push({ p, x, z, y, h, sx, sy, sz, c, gx, gz });
  }
  private solid(x: number, z: number, r: number, top: number) { this.solids.push({ x, z, r, top }); }

  /** A container stack, long axis along heading h. */
  private container(x: number, z: number, h: number, levels: number, key: number, solid: boolean) {
    for (let l = 0; l < levels; l++) {
      const c = CONTAINER_COLS[Math.floor(hash01(key, l, this.seed) * CONTAINER_COLS.length)];
      this.put('cont', x, z, 1.3 + l * 2.6, h + (l % 2 ? 0.02 : 0), 2.44, 2.6, 6.06, c);
    }
    if (solid) for (const s of [-1.6, 1.6]) this.solid(x + Math.sin(h) * s, z + Math.cos(h) * s, 1.5, levels * 2.6);
  }
  private barrier(x: number, z: number, h: number, c = CONCRETE) {
    this.put('box', x, z, 0.45, h, 0.6, 0.9, 3, c);
    this.solid(x, z, 1.4, 0.9);
  }
  private tyreStack(x: number, z: number, levels: number, c: number) {
    for (let l = 0; l < levels; l++) this.put('tyre', x, z, 0.25 + l * 0.5, 0, 1, 1, 1, l % 2 ? WHITE : c);
    this.solid(x, z, 0.8, levels * 0.5);
  }
  private cone(x: number, z: number, c = CONE) { this.put('cone', x, z, 0.38, 0, 1, 0.75, 1, c); }
  private pole(x: number, z: number, faceH: number) {
    this.put('cyl', x, z, 7, 0, 0.2, 14, 0.2, STEEL);
    this.put('lamp', x + Math.sin(faceH) * 0.8, z + Math.cos(faceH) * 0.8, 14.1, faceH, 0.9, 0.3, 1.8, 0xfff1c4, x, z);
    this.solid(x, z, 0.5, 14);
  }
  /** Grandstand whose back is toward heading h (front row at the anchor). */
  private stand(x: number, z: number, h: number, width: number) {
    const s = Math.sin(h), c = Math.cos(h);
    for (let r = 0; r < 4; r++) {
      const ht = 1.2 + r * 1.1, lz = r * 1.3;
      this.put(r % 2 ? 'crowd' : 'box', x + s * lz, z + c * lz, ht / 2, h + PI / 2, 1.4, ht, width, r % 2 ? 0xffffff : 0x2b2f38, x, z);
    }
    for (let k = -1; k <= 1; k++) this.solid(x + c * k * width * 0.33 + s * 2, z - s * k * width * 0.33 + c * 2, width * 0.2, 6);
  }

  // ------------------------------------------------------------------ zones

  private buildZones() {
    const n = this.n, a = this.turn, id = this.id;
    const maxZ = id === 'skidpad' ? 2 : id === 'gymkhana' || id === 'random' ? 4 : 5;
    let s0 = 0, thr = 0.42;
    type Run = { k0: number; k1: number; peak: number; pi: number; ord: number };
    let runs: Run[] = [];
    for (let tries = 0; tries < 5; tries++, thr *= 0.7) {
      s0 = 0;
      while (s0 < n && Math.abs(a[s0]) > thr) s0++;
      if (s0 >= n) { s0 = 0; continue; }
      runs = [];
      let cur: Run | null = null;
      for (let k = 1; k <= n; k++) {
        const i = (s0 + k) % n, v = Math.abs(a[i]);
        if (v > thr) {
          if (!cur) cur = { k0: k, k1: k, peak: v, pi: i, ord: 0 };
          cur.k1 = k;
          if (v > cur.peak) { cur.peak = v; cur.pi = i; }
        } else if (cur) { runs.push(cur); cur = null; }
      }
      runs = runs.filter((r) => (r.k1 - r.k0 + 1) * this.spacing >= 10);
      if (runs.length >= Math.min(3, maxZ)) break;
    }
    let hp = 0;
    for (const r of runs) if (r.peak > 1.1) r.ord = ++hp;
    const len = (r: Run) => (r.k1 - r.k0 + 1) * this.spacing;
    const pick = [...runs].sort((p, q) => q.peak * (1 + len(q) / 120) - p.peak * (1 + len(p) / 120)).slice(0, maxZ).sort((p, q) => p.k0 - q.k0);
    const pad = Math.round(10 / this.spacing);
    const NAMES: Record<DriftTrackId, string[]> = {
      docks: ['Crane Corner', 'Quay Hairpin', 'Container Alley', 'Reefer Bend', 'Gantry Sweep'],
      touge: [],
      skidpad: [],
      gymkhana: ['Slalom Exit', 'Barrier Hook', 'Container Corner', 'Cone Carousel'],
      random: ['Sector A', 'Sector B', 'Sector C', 'Sector D', 'Sector E'],
    };
    pick.forEach((r, k) => {
      const name = id === 'touge' ? (r.ord ? `Hairpin ${r.ord}` : k === pick.length - 1 ? 'Valley Esses' : 'Ridge S-Bends')
        : id === 'skidpad' ? (this.px[r.pi] > 0 ? 'East Circle' : 'West Circle')
        : NAMES[id][k];
      const mult = clamp(Math.round((1.1 + r.peak * 0.55 + Math.min(0.4, len(r) / 300)) * 10) / 10, 1.2, 2.5);
      this.zones.push({ name, i0: (s0 + r.k0 - pad + 2 * n) % n, i1: (s0 + r.k1 + pad) % n, mult });
      this.apex.push(r.pi);
    });
    if (id === 'skidpad') {
      // the two passes through the crossover (index 0 and the one halfway round)
      let mid = Math.floor(n / 4), bd = 1e9;
      for (let i = Math.floor(n / 4); i < Math.floor((3 * n) / 4); i++) { const d = Math.hypot(this.px[i], this.pz[i]); if (d < bd) { bd = d; mid = i; } }
      const w = Math.round(16 / this.spacing);
      this.zones.push({ name: 'Crossover', i0: (n - w) % n, i1: w, mult: 2 }, { name: 'Switchback', i0: mid - w, i1: mid + w, mult: 2 });
      this.apex.push(-1, -1);
    }
  }

  /** Banner arch at each zone entry, zone-coloured kerbs along both edges, inner clipping-point markers and outer clip zones. */
  private dressZones() {
    const n = this.n;
    this.zones.forEach((zn, k) => {
      const col = zoneColor(zn.mult), i0 = zn.i0, hw = this.halfWidth[i0], h0 = this.h(i0), [ax, az] = this.at(i0, 0);
      for (const side of [-1, 1]) {
        const [x, z] = this.at(i0, side * (hw + 1.5));
        this.put('box', x, z, 3.6, h0, 0.6, 7.2, 0.6, STEEL, ax, az);
        this.solid(x, z, 0.6, 7);
      }
      this.put('box', ax, az, 6.6, h0 + PI / 2, 0.4, 1.4, 2 * hw + 3.6, col);
      this.put('paint', ax, az, 6.6, h0 + PI / 2, 0.44, 0.35, 2 * hw + 3.6, WHITE);
      // kerbs
      const count = (zn.i1 - zn.i0 + n) % n;
      for (let s = 0, m = 0; s <= count; s += 2, m++) {
        const i = (zn.i0 + s) % n, hwi = this.halfWidth[i];
        for (const side of [-1, 1]) {
          const [x, z] = this.at(i, side * (hwi - 0.6));
          this.put('paint', x, z, 0.05, this.h(i), 1.2, 0.06, this.spacing * 2, m % 2 ? WHITE : col);
        }
      }
      // clipping points around the apex: inner = cone + painted square, outer = painted line on the far edge
      const ap = this.apex[k];
      if (ap < 0) return;
      const inner = this.turn[ap] > 0 ? -1 : 1, hwa = this.halfWidth[ap];
      const [ix, iz] = this.at(ap, inner * (hwa - 2.6));
      this.put('paint', ix, iz, 0.06, this.h(ap), 2.6, 0.05, 2.6, WHITE);
      this.put('cone', ix, iz, 0.6, 0, 1.8, 1.2, 1.8, col);
      const w = Math.round(14 / this.spacing);
      for (let s = -w; s <= w; s += 2) {
        const i = (ap + s + n) % n, [x, z] = this.at(i, -inner * (this.halfWidth[i] - 3));
        this.put('paint', x, z, 0.06, this.h(i), 0.35, 0.05, this.spacing * 2, WHITE);
      }
    });
  }

  // ------------------------------------------------------------------ venue dressing

  private dressDocks() {
    const n = this.n, step = Math.max(1, Math.round(6.6 / this.spacing));
    for (let i = 0; i < n; i += step) {
      if (hash01(i, 1, this.seed) < 0.1) continue; // a gap in the wall now and then
      const hw = this.halfWidth[i], h = this.h(i);
      for (const side of [-1, 1]) {
        for (const [row, off] of [[0, hw + 3], [1, hw + 6]]) {
          const [x, z] = this.at(i, side * off);
          if (this.edge(x, z) < 1.8) continue;
          const r = hash01(i, side * 7 + row, this.seed), levels = row ? 1 + Math.floor(r * 3) : 1 + Math.floor(r * 2);
          this.container(x, z, h, levels, i * 4 + row * 2 + (side > 0 ? 1 : 0), row === 0);
        }
      }
    }
    // gantry cranes out on the quay side
    let cranes = 0;
    for (let i = 0; i < n && cranes < 5; i += Math.round(85 / this.spacing)) {
      const o = this.outSign(i), hw = this.halfWidth[i], [x, z] = this.at(i, o * (hw + 38));
      if (this.edge(x, z) < 24 || hash01(i, 9, this.seed) > 0.7) continue;
      cranes++;
      const h = this.h(i), tX = this.tx[i], tZ = this.tz[i], nX = this.tz[i] * o, nZ = -this.tx[i] * o;
      const P = (u: number, v: number): V2 => [x + tX * u + nX * v, z + tZ * u + nZ * v];
      const col = cranes % 2 ? 0xc0392b : 0x2c6fb7;
      for (const u of [-7, 7]) for (const v of [-6, 6]) {
        const [lx, lz] = P(u, v);
        this.put('box', lx, lz, 14, h, 1.2, 28, 1.2, col, x, z);
        this.solid(lx, lz, 1, 28);
      }
      for (const v of [-6, 6]) { const [bx, bz] = P(0, v); this.put('box', bx, bz, 28.5, h, 1.4, 1.4, 15.4, col, x, z); }
      for (const u of [-7, 7]) { const [bx, bz] = P(u, 0); this.put('box', bx, bz, 28.5, h + PI / 2, 1.4, 1.4, 13.4, col, x, z); }
      const [mx, mz] = P(0, 14);
      this.put('box', mx, mz, 31, h + PI / 2, 2, 2, 64, WHITE, x, z);
      const [hx, hz] = P(0, 0);
      this.put('box', hx, hz, 33, h, 6, 3.6, 8, col, x, z);
    }
    this.poles(44);
  }

  private dressTouge() {
    const n = this.n;
    for (let i = 0; i < n; i += 2) {
      const t = this.turn[i];
      if (Math.abs(t) < 0.35) continue;
      const side = t > 0 ? 1 : -1, hw = this.halfWidth[i], h = this.h(i);
      // guard rail on the outside of the bend
      const [x, z] = this.at(i, side * (hw + 1));
      if (this.edge(x, z) > 0.4) {
        this.put('box', x, z, 0.75, h, 0.12, 0.34, this.spacing * 2 + 0.2, 0xc9ced4);
        this.put('box', x, z, 0.45, h, 0.16, 0.9, 0.16, 0x8a9199);
        this.solid(x, z, 1.1, 1);
      }
      // rock wall on the inside of the tight ones
      if (Math.abs(t) > 0.9 && i % 6 === 0) {
        const [rx, rz] = this.at(i, -side * (hw + 4.5));
        if (this.edge(rx, rz) > 2.5) {
          const sc = 2 + hash01(i, 5, this.seed) * 1.8;
          this.put('rock', rx, rz, sc * 0.5, hash01(i, 6, this.seed) * TAU, sc, sc * 1.3, sc, 0x8a8d91);
          this.solid(rx, rz, sc * 1.1, sc * 1.6);
        }
      }
    }
    // delineator posts on the straights
    for (let i = 0; i < n; i += Math.round(24 / this.spacing)) {
      if (Math.abs(this.turn[i]) >= 0.35) continue;
      for (const side of [-1, 1]) {
        const [x, z] = this.at(i, side * (this.halfWidth[i] + 0.8));
        if (this.edge(x, z) < 0.4) continue;
        this.put('box', x, z, 0.5, this.h(i), 0.14, 1, 0.14, WHITE);
        this.put('paint', x, z, 0.9, this.h(i), 0.16, 0.14, 0.16, RED);
      }
    }
  }

  private dressSkidpad() {
    const C = 75, R = 42, hw = 18;
    for (const cx of [-C, C]) {
      // cones on the inner and outer radius
      for (const [r, cnt] of [[R - hw + 0.8, 18], [R + hw - 0.8, 36]]) {
        for (let k = 0; k < cnt; k++) {
          const a = (k / cnt) * TAU, x = cx + Math.cos(a) * r, z = Math.sin(a) * r;
          if (r > R && this.nearest(x, z).d < hw - 1.5) continue; // on the crossover lanes
          this.cone(x, z);
        }
      }
      // tyre stacks in the middle of each circle
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU, x = cx + Math.cos(a) * 5, z = Math.sin(a) * 5;
        for (let l = 0; l < 3; l++) this.put('tyre', x, z, 0.25 + l * 0.5, 0, 1, 1, 1, l % 2 ? WHITE : k % 2 ? RED : 0x1d1d1f);
      }
      this.solid(cx, 0, 6, 1.5);
      this.put('cyl', cx, 0, 1.5, 0, 1.2, 3, 1.2, 0xffd23f);
      // light poles around the outside
      for (const a of [PI / 2, -PI / 2, cx > 0 ? 0 : PI]) {
        const x = cx + Math.cos(a) * (R + hw + 4), z = Math.sin(a) * (R + hw + 4);
        this.pole(x, z, Math.atan2(cx - x, -z));
      }
    }
    this.stand(0, 66, 0, 26);
    this.stand(0, -66, PI, 26);
  }

  private dressGymkhana() {
    const S = gymSeg(), L = this.length / S.total, n = this.n;
    const at = (s: number, off: number) => { const i = this.idx(s * L); return { i, p: this.at(i, off * this.outSign(i) * -1), h: this.h(i) }; };
    // positive offset = toward the infield
    // 1) barrel slalom out of the start
    for (let k = 0; k < 4; k++) {
      const { p } = at(64 + k * 11, k % 2 ? -6 : 6);
      this.put('barrel', p[0], p[1], 0.65, 0, 1, 1, 1, k % 2 ? BLUE : RED);
      this.put('box', p[0], p[1], 1.0, 0, 1.25, 0.12, 1.25, WHITE);
      this.solid(p[0], p[1], 0.75, 1.3);
    }
    // 2) jersey-barrier chicane on the right straight: walls perpendicular to the road from alternate edges
    for (const [s, sgn] of [[S.right + 20, -1], [S.right + 55, 1]]) {
      for (let k = 0; k < 4; k++) {
        const { p, h } = at(s, sgn * (23.5 - k * 3));
        this.barrier(p[0], p[1], h + PI / 2, k % 2 ? WHITE : RED);
      }
    }
    // 3) donut post in a ring of cones on the top straight
    {
      const { p } = at(S.top + 55, 12);
      this.put('cyl', p[0], p[1], 1.3, 0, 0.7, 2.6, 0.7, 0xffd23f);
      this.put('cyl', p[0], p[1], 2.7, 0, 0.75, 0.2, 0.75, RED);
      this.solid(p[0], p[1], 0.9, 2.6);
      for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; this.cone(p[0] + Math.cos(a) * 7, p[1] + Math.sin(a) * 7); }
    }
    // 4) container chicane further down the top straight (boxes across the road from alternate edges)
    for (const [s, sgn] of [[S.top + 115, -1], [S.top + 150, 1]]) {
      const { p, h } = at(s, sgn * 18.5);
      this.container(p[0], p[1], h + PI / 2, 2, Math.round(s), true);
    }
    // 5) cone slalom on the left straight
    for (let k = 0; k < 6; k++) { const { p } = at(S.left + 8 + k * 12, k % 2 ? -4.5 : 4.5); this.cone(p[0], p[1]); }
    // 6) a tyre-stack spin box near the end of the lap (infield half only)
    {
      const { p } = at(S.bot2 + 30, 14);
      for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + PI / 4; this.tyreStack(p[0] + Math.cos(a) * 5, p[1] + Math.sin(a) * 5, 3, RED); }
    }
    // perimeter: concrete barriers on the outside edge, grandstand + poles beyond
    const bstep = Math.max(1, Math.round(3 / this.spacing));
    for (let i = 0; i < n; i += bstep) {
      const [x, z] = this.at(i, this.outSign(i) * (this.halfWidth[i] + 1.6));
      if (this.edge(x, z) > 0.8) this.barrier(x, z, this.h(i), (i / bstep) % 6 < 3 ? CONCRETE : 0xbfbab0);
    }
    const st = at(S.top + 95, -(25 + 9));
    this.stand(st.p[0], st.p[1], Math.atan2(st.p[0], st.p[1]), 30);
    this.poles(70, 4);
  }

  private dressRandom() {
    const n = this.n, seg = 14, bstep = Math.max(1, Math.round(3 / this.spacing));
    for (let s = 0; s < n; s += seg) {
      const style = Math.floor(hash01(s, 3, this.seed) * 4);
      if (style === 3 || s < Math.round(30 / this.spacing)) continue;
      for (let i = s; i < Math.min(n, s + seg); i += style === 0 ? Math.max(1, Math.round(6.6 / this.spacing)) : bstep) {
        const o = this.outSign(i), hw = this.halfWidth[i];
        if (style === 0) {
          const [x, z] = this.at(i, o * (hw + 3));
          if (this.edge(x, z) > 1.8) this.container(x, z, this.h(i), 1 + Math.floor(hash01(i, 4, this.seed) * 2), i, true);
        } else if (style === 1) {
          const [x, z] = this.at(i, o * (hw + 1.4));
          if (this.edge(x, z) > 0.6) this.tyreStack(x, z, 2, (i / bstep) % 2 ? RED : 0x1d1d1f);
        } else {
          const [x, z] = this.at(i, o * (hw + 1.6));
          if (this.edge(x, z) > 0.8) this.barrier(x, z, this.h(i));
        }
      }
    }
    this.poles(60);
  }

  /** Light poles along the outside edge every `every` metres. */
  private poles(every: number, off = 2.2) {
    for (let i = Math.round(20 / this.spacing); i < this.n; i += Math.round(every / this.spacing)) {
      const o = this.outSign(i), [x, z] = this.at(i, o * (this.halfWidth[i] + off));
      if (this.edge(x, z) < 1) continue;
      this.pole(x, z, Math.atan2(this.px[i] - x, this.pz[i] - z));
    }
  }
}

// Real Formula 1 circuits at true 1:1 scale, with trackside furniture (kerbs, gravel, armco, pits, grandstands, start lights).
//
// The catalogue and the centre-line geometry live in f1Circuits.ts (pure, unit tested): circuit lines derived from
// "f1-circuits" by Tomislav Bacinger (github.com/bacinger/f1-circuits), MIT License, Copyright (c) Tomislav Bacinger.
// Index 0 is the start/finish line and points run in race direction.
import * as THREE from 'three';
import type { Noise } from '../utils/noise';
import type { Game } from '../core/Game';
import type { Chunk, Obstacle } from './Chunks';
import { hash01, type Poi, type Pose, type RoadLayout, type RoadPointFn } from './layout';
import { G, M, MAT, canvasTex } from '../entities/assets';
import { F1_BARRIERS, F1_TRACK, ROAD } from '../config';
import { clamp, PI, TAU } from '../utils/math';
import { F1_SHAPES, f1Line, f1Outline, gridSlot, inLoopRange, type F1Shape, type F1TrackId } from './f1Circuits';

export { F1_TRACKS, F1_DIFFICULTY, type F1TrackId, type F1Difficulty, type F1Circuit } from './f1Circuits';

/** Monaco harbour (water), local metres. */
const MONACO_HARBOUR = { x0: -180, z0: 95, x1: 170, z1: 450, y: -4 };
/** Monaco tunnel (after Portier, before the Nouvelle Chicane), metres from the line. */
const MONACO_TUNNEL: [number, number] = [1480, 1880];

// ---------------------------------------------------------------------------------------------
// shared materials / geometry

const fenceMat = new THREE.MeshStandardMaterial({
  map: canvasTex(32, 32, (g, w, h) => {
    g.strokeStyle = '#c4c8cc'; g.lineWidth = 1.5;
    for (let k = -w; k < w * 2; k += 8) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.moveTo(k + h, 0); g.lineTo(k, h); g.stroke(); }
    g.fillStyle = '#9aa0a6'; g.fillRect(0, 0, w, 2);
  }),
  transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.4, roughness: 0.5,
});
fenceMat.map!.wrapS = fenceMat.map!.wrapT = THREE.RepeatWrapping;
fenceMat.map!.repeat.set(4, 4);
const crowdMat = new THREE.MeshStandardMaterial({
  map: canvasTex(128, 32, (g, w, h) => {
    g.fillStyle = '#39404d'; g.fillRect(0, 0, w, h);
    const cols = ['#e2483d', '#3c8dff', '#ffd23f', '#39c46a', '#ffffff', '#ff7ad9'];
    for (let i = 0; i < 160; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect((i * 37) % w, ((i * 13) % 4) * 8 + 2, 4, 5); }
  }),
  roughness: 0.9,
});
const facadeTex = canvasTex(64, 48, (g, w, h) => {
  g.fillStyle = '#d8cbb4'; g.fillRect(0, 0, w, h);
  let s = 11;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
    s = (s * 16807) % 2147483647;
    g.fillStyle = s % 4 === 0 ? '#ffe2a0' : '#3a4656';
    g.fillRect(2 + c * 10.4, 3 + r * 16, 7, 10);
  }
});
const garageTex = canvasTex(128, 32, (g, w, h) => {
  g.fillStyle = '#e8e9ec'; g.fillRect(0, 0, w, h);
  for (let k = 0; k < 4; k++) { g.fillStyle = '#2b2f38'; g.fillRect(4 + k * 31, 8, 26, h - 8); g.fillStyle = '#ffd98a'; g.fillRect(6 + k * 31, 10, 22, 3); }
  g.fillStyle = '#d8322a'; g.fillRect(0, 0, w, 4);
});
const label = (txt: string, bg: string, fg = '#ffffff', w = 64, h = 64) =>
  new THREE.MeshStandardMaterial({
    map: canvasTex(w, h, (g, W, H) => {
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.strokeStyle = fg; g.lineWidth = 3; g.strokeRect(3, 3, W - 6, H - 6);
      g.fillStyle = fg; g.font = `bold ${Math.round(H * 0.62)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(txt, W / 2, H / 2 + 2);
    }),
    roughness: 0.6,
  });
const billboard = (k: number) =>
  new THREE.MeshStandardMaterial({
    map: canvasTex(128, 32, (g, w, h) => {
      const pal = [['#1b3a8c', '#ffd23f', '#ffffff'], ['#d8322a', '#ffffff', '#1d1d1f'], ['#16a37f', '#e8f7f1', '#0d3b30']][k];
      g.fillStyle = pal[0]; g.fillRect(0, 0, w, h);
      g.fillStyle = pal[1];
      if (k === 0) for (let x = -h; x < w; x += 18) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 9, h); g.lineTo(x + 9 + h, 0); g.lineTo(x + h, 0); g.fill(); }
      else if (k === 1) for (let x = 10; x < w; x += 24) { g.beginPath(); g.arc(x, h / 2, 8, 0, TAU); g.fill(); }
      else { g.fillRect(0, h / 2 - 3, w, 6); g.fillStyle = pal[2]; for (let x = 6; x < w; x += 20) g.fillRect(x, 6, 8, h - 12); }
    }),
    emissive: 0xffffff, emissiveIntensity: 0.15, roughness: 0.6,
  });
const ringGeo = new THREE.TorusGeometry(1, 0.025, 6, 48);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
const tyreGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.5, 10);
const archGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, false, PI / 2, PI).rotateX(PI / 2);
const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const paintMat = M(0xffffff, { roughness: 0.6, flatShading: false });
const glassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x6fd6ff, emissiveIntensity: 0.5, roughness: 0.2, metalness: 0.5 });

interface Part { g: THREE.BufferGeometry; m: THREE.Material; shadow: boolean }
const PARTS = new Map<string, Part>([
  ['box', { g: G.box, m: MAT.white, shadow: true }],
  ['paint', { g: G.box, m: paintMat, shadow: false }],
  ['cone', { g: G.tcone, m: MAT.white, shadow: false }],
  ['tyre', { g: tyreGeo, m: MAT.white, shadow: true }],
  ['cyl', { g: cylGeo, m: MAT.white, shadow: true }],
  ['lamp', { g: G.box, m: lampMat, shadow: false }],
  ['crowd', { g: G.box, m: crowdMat, shadow: true }],
  ['glass', { g: G.box, m: glassMat, shadow: false }],
  ['facade', { g: G.box, m: new THREE.MeshStandardMaterial({ map: facadeTex, emissive: 0xffffff, emissiveMap: facadeTex, emissiveIntensity: 0.25, roughness: 0.8 }), shadow: true }],
  ['garage', { g: G.box, m: new THREE.MeshStandardMaterial({ map: garageTex, roughness: 0.7 }), shadow: true }],
  ['fence', { g: G.box, m: fenceMat, shadow: false }],
  ['checker', { g: G.box, m: MAT.checker, shadow: false }],
  ['arch', { g: archGeo, m: MAT.white, shadow: true }],
  ['ring', { g: ringGeo, m: MAT.white, shadow: true }],
  ['cylZ', { g: new THREE.CylinderGeometry(1, 1, 1, 12).rotateX(PI / 2), m: MAT.white, shadow: true }],
  ['trunk', { g: G.trunk, m: MAT.white, shadow: true }],
  ['pine', { g: G.cone, m: MAT.white, shadow: true }],
  ['blob', { g: G.blob, m: MAT.white, shadow: true }],
  ['sphere', { g: G.sph, m: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff7a2e, emissiveIntensity: 0.9, roughness: 0.4 }), shadow: false }],
]);
/** Lazily created textured parts (number boards, DRS, billboards). */
function part(key: string): Part {
  let p = PARTS.get(key);
  if (!p) {
    const m = key === 'drs' ? label('DRS', '#ffffff', '#111111', 128, 64)
      : key.startsWith('bb') ? billboard(Number(key.slice(2)))
      : key.startsWith('d') ? label(key.slice(1), '#ffffff', '#111111')
      : label(key.slice(1), '#1d1d1f');
    PARTS.set(key, (p = { g: G.box, m, shadow: false }));
  }
  return p;
}

const WHITE = 0xf4f4f4, RED = 0xd8322a, STEEL = 0x8a9199, CONCRETE = 0xd9d6cf, SAND = 0xd9c79a;
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color(), _e = new THREE.Euler();

interface Prop { p: string; x: number; z: number; y: number; h: number; sx: number; sy: number; sz: number; c: number; gx: number; gz: number; t?: number; r?: number; abs?: boolean }
type Extra = { t?: number; r?: number; abs?: boolean };
interface Rect { x0: number; z0: number; x1: number; z1: number; y: number }
const rectDist = (q: Rect, x: number, z: number) => Math.hypot(Math.max(q.x0 - x, 0, x - q.x1), Math.max(q.z0 - z, 0, z - q.z1));

// ---------------------------------------------------------------------------------------------

/** Draw a circuit fitted into a w x h canvas area (menu preview). Uses the current stroke style/width. */
export function drawF1Map(ctx: CanvasRenderingContext2D, id: F1TrackId, w: number, h: number, pad = 8) {
  const d = f1Outline(id);
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < d.length; i += 2) { x0 = Math.min(x0, d[i]); x1 = Math.max(x1, d[i]); z0 = Math.min(z0, d[i + 1]); z1 = Math.max(z1, d[i + 1]); }
  const s = Math.min((w - 2 * pad) / (x1 - x0), (h - 2 * pad) / (z1 - z0)), ox = (w - (x1 - x0) * s) / 2, oz = (h - (z1 - z0) * s) / 2;
  const P = (i: number): [number, number] => [ox + (d[i] - x0) * s, oz + (d[i + 1] - z0) * s];
  ctx.beginPath();
  for (let i = 0; i < d.length; i += 2) { const [a, b] = P(i); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); }
  ctx.closePath();
  ctx.stroke();
  const [a, b] = P(0), fill = ctx.fillStyle;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(a - 3, b - 3, 6, 6);
  ctx.fillStyle = fill;
}

export class F1Track implements RoadLayout {
  readonly kind = 'f1';
  readonly n: number;
  readonly length: number;
  readonly spacing: number;
  readonly px: Float32Array;
  readonly pz: Float32Array;
  readonly tx: Float32Array;
  readonly tz: Float32Array;
  /** Typical half width (m); per-sample widths: halfWidthAt(i). */
  readonly halfWidth: number;
  readonly drsZones: readonly { i0: number; i1: number }[];
  readonly pit: { i0: number; i1: number; side: 1 | -1 };
  /** Start-light gantry (built when the chunk holding the line is dressed). */
  startLights: THREE.Group | null = null;
  private pods: THREE.MeshBasicMaterial[] = [];
  private greens: THREE.MeshBasicMaterial[] = [];
  private lightState = { lit: 0, green: false };
  private readonly hw: Float32Array;
  private readonly elevH: Float32Array;
  private readonly cfg: F1Shape;
  private readonly straights: readonly { a: number; b: number; len: number }[];
  private readonly corners: readonly number[];
  private readonly crossings: readonly [number, number][];
  private readonly rects: Rect[] = [];
  private readonly cells = new Map<number, number[]>();
  private readonly CELL = 32;
  private readonly props: Prop[] = [];
  private readonly solids: Obstacle[] = [];
  private static readonly PIT_W = F1_TRACK.pitWidth;

  constructor(_noise: Noise, readonly id: F1TrackId) {
    const cfg = (this.cfg = F1_SHAPES[id]), L = f1Line(id), n = (this.n = L.n);
    this.length = L.length; this.spacing = L.spacing;
    this.px = L.px; this.pz = L.pz; this.tx = L.tx; this.tz = L.tz;
    this.hw = L.hw; this.halfWidth = L.halfWidth; this.elevH = L.elev;
    this.drsZones = L.drsZones; this.pit = L.pit; this.straights = L.straights; this.corners = L.corners; this.crossings = L.crossings;
    for (let i = 0; i < n; i++) {
      const key = this.key(Math.floor(this.px[i] / this.CELL), Math.floor(this.pz[i] / this.CELL));
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(i);
    }
    if (id === 'monaco') this.rects.push(MONACO_HARBOUR);

    this.dressCommon();
    for (const d of cfg.dress ?? []) {
      if (d === 'monza') this.dressMonza();
      else if (d === 'pitRoof') this.dressPitRoof();
      else if (d === 'monaco') this.dressMonaco();
      else if (d === 'suzuka') this.dressSuzuka();
      else if (d === 'city') this.dressCity();
      else if (d === 'wheel') this.ferrisWheel(this.idx(this.length * 0.42), 1, 90);
      else if (d === 'tower') this.dressTower();
      else if (d === 'sphere') this.dressSphere();
      else if (d === 'dunes') this.dressDunes();
    }
    if (cfg.trees) this.dressTrees(cfg.trees);
    if (cfg.lights) this.dressFloodlights();
  }

  /** Half width of the asphalt at sample i (street circuits narrow in places). */
  halfWidthAt(i: number) { return this.hw[((i % this.n) + this.n) % this.n]; }

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

  /** Course + pit lane distance (asphalt inside the full width and the pit lane strip). */
  private dist0(x: number, z: number) {
    const r = this.nearest(x, z);
    if (r.i < 0) return 1e9;
    let d = Math.max(0, r.d - this.hw[r.i] + ROAD.asphalt);
    if (this.inRange(r.i, this.pit.i0, this.pit.i1)) {
      const lat = ((x - this.px[r.i]) * this.tz[r.i] - (z - this.pz[r.i]) * this.tx[r.i]) * this.pit.side;
      if (lat > 0) d = Math.min(d, Math.max(0, lat - (this.hw[r.i] + F1Track.PIT_W) + ROAD.asphalt));
    }
    return d;
  }

  roadDist(x: number, z: number) {
    let d = this.dist0(x, z);
    for (const q of this.rects) d = Math.min(d, rectDist(q, x, z));
    return d;
  }

  roadHeight(x: number, z: number) {
    if (this.rects.length) {
      let best = this.dist0(x, z), y = NaN;
      if (best > ROAD.asphalt) for (const q of this.rects) { const d = rectDist(q, x, z); if (d < best) { best = d; y = q.y; } }
      if (!Number.isNaN(y)) return y;
    }
    const { i } = this.nearest(x, z);
    if (i < 0) return this.cfg.base;
    const f = clamp(((x - this.px[i]) * this.tx[i] + (z - this.pz[i]) * this.tz[i]) / this.spacing, -1, 1);
    const j = f >= 0 ? (i + 1) % this.n : (i - 1 + this.n) % this.n;
    return this.elevH[i] + (this.elevH[j] - this.elevH[i]) * Math.abs(f);
  }

  nearestRoad(x: number, z: number): Pose {
    const { i } = this.nearest(x, z, true);
    return { x: this.px[i], z: this.pz[i], h: Math.atan2(this.tx[i], this.tz[i]) };
  }

  /** F1 grid: two staggered columns, consecutive slots 8 m apart (16 m within a column), behind the line, facing race direction. */
  spawn(i: number): Pose { return gridSlot(f1Line(this.id), i); }

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

  pois(): Poi[] { return []; }

  /** How sharply the track bends at sample i (sine of the turn over ~12 m, sign = direction). */
  curvature(i: number) {
    const a = (i - 3 + this.n) % this.n, b = (i + 3) % this.n;
    return this.tx[a] * this.tz[b] - this.tz[a] * this.tx[b];
  }

  /** Inside the pit lane box (for pit stops). */
  isPit(x: number, z: number) {
    const r = this.nearest(x, z);
    if (r.i < 0 || !this.inRange(r.i, this.pit.i0, this.pit.i1)) return false;
    const lat = ((x - this.px[r.i]) * this.tz[r.i] - (z - this.pz[r.i]) * this.tx[r.i]) * this.pit.side;
    return lat > this.hw[r.i] + 1 && lat < this.hw[r.i] + F1Track.PIT_W;
  }

  inDrs(i: number) { return this.drsZones.some((z) => this.inRange(i, z.i0, z.i1)); }

  /** Start lights: `lit` red pods (0..5), or all green. */
  setLights(lit: number, green: boolean) {
    this.lightState = { lit, green };
    this.pods.forEach((m, k) => m.color.setHex(!green && k % 5 < lit ? 0xff1a1a : 0x2a0606));
    this.greens.forEach((m) => m.color.setHex(green ? 0x22ff55 : 0x062a10));
  }

  /** Build trackside furniture for one chunk square (only things anchored inside it). */
  dress(game: Game, ch: Chunk, x0: number, z0: number, size: number) {
    const T = game.terrain, inside = (x: number, z: number) => x >= x0 && x < x0 + size && z >= z0 && z < z0 + size;
    const buckets = new Map<string, { m: number[]; c: number[] }>();
    let lastX = NaN, lastZ = NaN, gy = 0;
    for (const p of this.props) {
      if (!inside(p.gx, p.gz)) continue;
      if (p.gx !== lastX || p.gz !== lastZ) { gy = T.heightAt(p.gx, p.gz); lastX = p.gx; lastZ = p.gz; }
      if (gy < 0.5 && !p.abs) continue;
      let b = buckets.get(p.p);
      if (!b) buckets.set(p.p, (b = { m: [], c: [] }));
      if (p.t || p.r) _q.setFromEuler(_e.set(p.t ?? 0, p.h, p.r ?? 0, 'YXZ'));
      else _q.setFromAxisAngle(UP, p.h);
      _m.compose(_p.set(p.x, (p.abs ? 0 : gy) + p.y, p.z), _q, _s.set(p.sx, p.sy, p.sz));
      for (let k = 0; k < 16; k++) b.m.push(_m.elements[k]);
      b.c.push(p.c);
    }
    for (const s of this.solids) {
      if (!inside(s.x, s.z)) continue;
      const y = T.heightAt(s.x, s.z);
      if (y >= 0.5) ch.obs.push({ x: s.x, z: s.z, r: s.r, top: y + s.top, x2: s.x2, z2: s.z2 });
    }
    for (const [key, b] of buckets) {
      const P = part(key), im = new THREE.InstancedMesh(P.g, P.m, b.c.length);
      (im.instanceMatrix.array as Float32Array).set(b.m);
      b.c.forEach((c, i) => im.setColorAt(i, _c.setHex(c)));
      im.castShadow = P.shadow;
      im.receiveShadow = true;
      game.scene.add(im);
      ch.meshes.push(im);
    }
    if (inside(this.px[0], this.pz[0])) {
      const g = this.buildGantry(T.heightAt(this.px[0], this.pz[0]));
      game.scene.add(g);
      ch.meshes.push(g);
      ch.obs.push(...[-1, 1].map((s) => { const [x, z] = this.at(0, s * (this.hw[0] + 2.2)); return { x, z, r: 0.45, top: g.position.y + 8 }; }));
    }
  }

  private buildGantry(y: number) {
    const g = new THREE.Group(), hw = this.hw[0], steel = M(0x3b4048, { metalness: 0.5, roughness: 0.4 });
    g.position.set(this.px[0], y, this.pz[0]);
    g.rotation.y = Math.atan2(this.tx[0], this.tz[0]);
    for (const s of [-1, 1]) { const post = new THREE.Mesh(G.box, steel); post.position.set(s * (hw + 2.2), 4, 0); post.scale.set(0.7, 8, 0.7); g.add(post); }
    const beam = new THREE.Mesh(G.box, steel);
    beam.position.set(0, 7.6, 0);
    beam.scale.set(2 * hw + 5, 1.2, 0.8);
    g.add(beam);
    this.pods = []; this.greens = [];
    for (let k = 0; k < 5; k++) {
      const box = new THREE.Mesh(G.box, steel);
      box.position.set((k - 2) * 1.5, 6.4, -0.5);
      box.scale.set(1.1, 2.6, 0.5);
      g.add(box);
      for (const yy of [6.9, 5.9]) {
        const m = new THREE.MeshBasicMaterial({ color: 0x2a0606 }), lamp = new THREE.Mesh(G.sph, m);
        lamp.position.set((k - 2) * 1.5, yy, -0.8);
        lamp.scale.setScalar(0.38);
        g.add(lamp);
        this.pods.push(m);
      }
    }
    // pods were pushed two per column; light them column by column
    this.pods = this.pods.filter((_, k) => k % 2 === 0).concat(this.pods.filter((_, k) => k % 2 === 1));
    for (const s of [-1, 1]) {
      const m = new THREE.MeshBasicMaterial({ color: 0x062a10 }), lamp = new THREE.Mesh(G.sph, m);
      lamp.position.set(s * 4.6, 6.4, -0.8);
      lamp.scale.setScalar(0.45);
      g.add(lamp);
      this.greens.push(m);
    }
    this.startLights = g;
    this.setLights(this.lightState.lit, this.lightState.green);
    return g;
  }

  // ------------------------------------------------------------------ helpers (construction time)

  private inRange(i: number, i0: number, i1: number) { return inLoopRange(i, i0, i1); }
  private near(a: number, b: number, m: number) { const d = Math.abs(a - b); return Math.min(d, this.n - d) * this.spacing < m; }
  private idx(s: number) { return ((Math.round(s / this.spacing) % this.n) + this.n) % this.n; }
  private h(i: number) { return Math.atan2(this.tx[i], this.tz[i]); }
  /** Point offset sideways from sample i (positive = right-hand side of race direction). */
  private at(i: number, off: number): [number, number] { i = ((i % this.n) + this.n) % this.n; return [this.px[i] + this.tz[i] * off, this.pz[i] - this.tx[i] * off]; }
  /** Distance beyond the track edge, ignoring the part of the track around sample `own`. */
  private edgeAt(x: number, z: number, own: number) {
    let bd = 1e18, bi = -1;
    const cx = Math.floor(x / this.CELL), cz = Math.floor(z / this.CELL);
    for (let a = -2; a <= 2; a++)
      for (let b = -2; b <= 2; b++) {
        const list = this.cells.get(this.key(cx + a, cz + b));
        if (!list) continue;
        for (const i of list) {
          if (this.near(i, own, 90)) continue;
          const dx = x - this.px[i], dz = z - this.pz[i], d = dx * dx + dz * dz;
          if (d < bd) { bd = d; bi = i; }
        }
      }
    return Math.sqrt(bd) - (bi < 0 ? this.halfWidth : this.hw[bi]);
  }
  /** Clear of every other part of the track (and of the pit lane / harbour). */
  private free(x: number, z: number, own: number, m: number, rad = 0) {
    if (this.edgeAt(x, z, own) < m) return false;
    const r = this.nearest(x, z);
    if (r.i >= 0 && r.d - rad < this.hw[r.i] + 0.5) return false;
    if (this.isPit(x, z)) return false;
    return !this.rects.some((q) => rectDist(q, x, z) < 2);
  }
  private put(p: string, x: number, z: number, y: number, h: number, sx: number, sy: number, sz: number, c: number, gx = x, gz = z, extra?: Extra) {
    this.props.push({ p, x, z, y, h, sx, sy, sz, c, gx, gz, ...extra });
  }
  /** Local frame at anchor (ax, az) facing h: u forward, v to the right. */
  private putL(p: string, ax: number, az: number, h: number, u: number, v: number, y: number, dh: number, sx: number, sy: number, sz: number, c: number, extra?: Extra) {
    const s = Math.sin(h), co = Math.cos(h);
    this.put(p, ax + s * u + co * v, az + co * u - s * v, y, h + dh, sx, sy, sz, c, ax, az, extra);
  }
  private solid(x: number, z: number, r: number, top: number) { this.solids.push({ x, z, r, top }); }
  /** Capsule collider from (x, z) to (x2, z2): a straight piece of wall with no dents or gaps along it. */
  private seg(x: number, z: number, x2: number, z2: number, r: number, top: number) { this.solids.push({ x, z, x2, z2, r, top }); }
  /**
   * One post of a continuous barrier line (armco, tyre wall, pit wall, fence). Links to the previous post of the same
   * line when that was the sample just before: the visual panel and its capsule collider then run post to post, so
   * the wall follows the curve with no gaps on the outside of bends and no zipper of circles to snag on. A post
   * without a neighbour gets a panel of its own length. `line` keys the chain (e.g. side and kind).
   */
  private post(line: string, i: number, x: number, z: number, r: number, top: number, panel?: (cx: number, cz: number, h: number, len: number) => void) {
    const prev = this.lines.get(line), h0 = this.h(i);
    const linked = !!prev && (prev.i + 2) % this.n === i && Math.hypot(x - prev.x, z - prev.z) < this.spacing * 2 * F1_BARRIERS.maxStretch;
    if (linked) {
      const h = Math.atan2(x - prev.x, z - prev.z), len = Math.hypot(x - prev.x, z - prev.z);
      this.seg(prev.x, prev.z, x, z, r, top);
      panel?.((x + prev.x) / 2, (z + prev.z) / 2, h, len + 0.1);
    } else {
      const u = this.spacing, s = Math.sin(h0) * u, c = Math.cos(h0) * u;
      this.seg(x - s, z - c, x + s, z + c, r, top);
      panel?.(x, z, h0, this.spacing * 2 + 0.1);
    }
    if (prev) { prev.i = i; prev.x = x; prev.z = z; }
    else this.lines.set(line, { i, x, z });
  }
  private readonly lines = new Map<string, { i: number; x: number; z: number }>();
  /**
   * Barrier offset from the centre line on one side of sample i: the wanted run-off (metres beyond the track edge),
   * shrunk where another part of the circuit (or the pit lane) is close, so the wall sits between the two with run-off
   * for both and never on a racing surface. null = no room for a wall (a crossover or touching sections).
   */
  private fitBarrier(i: number, side: number, runoff: number, min: number) {
    const hw = this.hw[i]; // per-point width: the wall follows the track edge where it narrows / widens
    for (const f of F1_BARRIERS.shrink) {
      const ro = Math.max(min, runoff * f), [x, z] = this.at(i, side * (hw + ro));
      if (this.free(x, z, i, Math.max(0.4, ro - 1.5))) return hw + ro;
      if (ro <= min) break;
    }
    return null;
  }
  /** Gravel traps per sample: +1 / -1 = which side has one, 0 = none (run-off surface, see runoff()). */
  private gravel: Int8Array = new Int8Array(0);

  /**
   * Off-track surface at (x, z): 0 = on the track or pit lane, 1 = grass / paved run-off, 2 = gravel trap. Feeds the
   * F1 run-off drag (config RUNOFF): gravel bites hard, grass is slippery.
   */
  runoff(x: number, z: number) {
    if (this.dist0(x, z) <= ROAD.onRoad) return 0;
    const r = this.nearest(x, z);
    if (r.i < 0) return 1;
    const g = this.gravel[r.i];
    if (!g) return 1;
    const lat = ((x - this.px[r.i]) * this.tz[r.i] - (z - this.pz[r.i]) * this.tx[r.i]) * g;
    const hw = this.hw[r.i];
    return lat > hw + F1_BARRIERS.gravel[0] && lat < hw + F1_BARRIERS.gravel[1] ? 2 : 1;
  }
  private solidL(ax: number, az: number, h: number, u: number, v: number, r: number, top: number) {
    const s = Math.sin(h), co = Math.cos(h);
    this.solid(ax + s * u + co * v, az + co * u - s * v, r, top);
  }
  /** Board on a post, facing oncoming cars at sample i. */
  private board(key: string, i: number, side: number, off: number, w: number, hgt: number, y: number) {
    const [x, z] = this.at(i, side * off), h = this.h(i);
    if (!this.free(x, z, i, 1)) return;
    this.put('cyl', x, z, y / 2, 0, 0.08, y, 0.08, STEEL);
    this.put(key, x, z, y + hgt / 2, h + PI, w, hgt, 0.12, 0xffffff, x, z);
  }
  private stand(x: number, z: number, h: number, width: number) {
    const s = Math.sin(h), c = Math.cos(h);
    for (let r = 0; r < 5; r++) {
      const ht = 1.2 + r * 1.1, lz = r * 1.3;
      this.put(r % 2 ? 'crowd' : 'box', x + s * lz, z + c * lz, ht / 2, h + PI / 2, 1.4, ht, width, r % 2 ? 0xffffff : 0x2b2f38, x, z);
    }
    this.put('box', x + s * 3, z + c * 3, 7.6, h + PI / 2, 6.5, 0.3, width + 1, 0xe8e9ec, x, z);
    for (let k = -1; k <= 1; k++) this.solid(x + c * k * width * 0.33 + s * 2.6, z - s * k * width * 0.33 + c * 2.6, width * 0.2, 7);
  }

  // ------------------------------------------------------------------ dressing

  private dressCommon() {
    const n = this.n, mon = !!this.cfg.street, ps = this.pit.side, B = F1_BARRIERS, HW = (i: number) => this.halfWidthAt(i);
    const inPit = (i: number) => this.inRange(i, (this.pit.i0 - 10 + n) % n, (this.pit.i1 + 10) % n);
    const ahead = Math.round(8 / this.spacing);
    this.gravel = new Int8Array(n);
    const armco = (x: number, z: number, h: number, len: number) => this.put('box', x, z, 0.6, h, 0.15, 0.7, len, 0xc9ced4);
    const fence = (x: number, z: number, h: number, len: number) => this.put('fence', x, z, 3, h, 0.05, 4, len, WHITE);
    // kerbs (inside through the apex, outside on the exit), gravel + tyre walls on the outside, armco + catch fence beyond
    for (let i = 0; i < n; i += 2) {
      const hw = this.hw[i], k = this.curvature(i), h = this.h(i), out = k > 0 ? 1 : -1;
      const kPrev = this.curvature((i - ahead + n) % n), kNext = this.curvature((i + ahead) % n);
      // exit: the corner was turning this way just behind and is opening up
      const exit = Math.abs(kPrev) > 0.1 && Math.sign(kPrev) === Math.sign(k || kPrev) && Math.abs(kNext) < Math.abs(kPrev);
      for (const side of [-1, 1]) {
        const inside = side === -out && Math.abs(k) > 0.1, outside = side === (Math.sign(kPrev) > 0 ? 1 : -1) && exit;
        if (!inside && !outside) continue;
        const [x, z] = this.at(i, side * (hw + 0.55));
        if (this.edgeAt(x, z, i) > 0.5) this.put('paint', x, z, 0.05, h, 1.5, 0.1, this.spacing * 2, (i >> 1) % 2 ? RED : WHITE);
      }
      const big = Math.abs(k) > 0.2 && !mon;
      if (big && i % 4 === 0) {
        const [gx, gz] = this.at(i, out * (hw + 7));
        if (this.free(gx, gz, i, 6)) {
          this.put('paint', gx, gz, 0.03, h, 10, 0.05, this.spacing * 4 + 0.6, SAND);
          for (let k = -1; k <= 2; k++) this.gravel[(i + k + n) % n] = out;
        }
      }
      if (big) {
        const [tx, tz] = this.at(i, out * (hw + 13));
        if (this.free(tx, tz, i, 6)) {
          for (let l = 0; l < 2; l++) this.put('tyre', tx, tz, 0.25 + l * 0.5, 0, 1.1, 1, 1.1, l ? WHITE : (i >> 1) % 3 ? 0x1d1d1f : RED);
          this.post('tyre' + out, i, tx, tz, B.tyreR, 1);
        }
      }
      // armco: one continuous line per side (behind the pit lane along the pits), pulled in where sections run close
      for (const side of [-1, 1]) {
        const pitSide = side === ps && inPit(i);
        const want = pitSide ? F1Track.PIT_W + B.pitBack : mon ? B.street : big && side === out ? B.runoffOut : B.runoff;
        const off = pitSide ? hw + want : this.fitBarrier(i, side, want, mon ? B.street : B.minRunoff);
        if (off === null) continue;
        const [x, z] = this.at(i, side * off);
        if (pitSide && !this.free(x, z, i, 0.4)) continue;
        const tall = mon || (big && side === out) || Math.abs(k) > 0.1;
        this.post('armco' + side, i, x, z, B.armcoR, tall ? 5 : 1, (cx, cz, hh, len) => { armco(cx, cz, hh, len); if (tall) fence(cx, cz, hh, len); });
      }
    }
    // start/finish: chequered line, grid slots
    this.put('checker', this.px[0], this.pz[0], 0.04, this.h(0), 2 * HW(0), 0.02, 1.4, 0xffffff);
    for (let k = 0; k < 20; k++) {
      const p = this.spawn(k), i = this.nearest(p.x, p.z, true).i, [x, z] = [p.x + Math.sin(p.h) * 1.8, p.z + Math.cos(p.h) * 1.8];
      this.put('paint', x, z, 0.04, this.h(i), 2.2, 0.03, 0.3, WHITE);
    }
    this.dressPits();
    // grandstands: opposite the pits on the main straight, and outside the sharpest corners
    for (let s = -220; s <= 140; s += 34) {
      const i = this.idx(s), [x, z] = this.at(i, -ps * (HW(i) + (mon ? 6 : 16)));
      if (this.free(x, z, i, mon ? 4 : 12, 9)) this.stand(x, z, this.h(i) - ps * PI / 2, 30);
    }
    const sharp = [...this.corners].sort((a, b) => Math.abs(this.curvature(b + 4)) - Math.abs(this.curvature(a + 4))).slice(0, 4);
    for (const c of sharp)
      for (const ds of [0, 20]) {
        const i = (c + ds) % n, out = this.curvature(i) > 0 ? 1 : -1, [x, z] = this.at(i, out * (HW(i) + (mon ? 7 : 30)));
        if (this.free(x, z, i, mon ? 5 : 24, 9)) this.stand(x, z, this.h(i) + out * PI / 2, 26);
      }
    // corner numbers, marshal posts, DRS boards, braking boards, billboards
    this.corners.forEach((c, k) => { const out = this.curvature((c + 6) % n) > 0 ? 1 : -1; this.board('n' + (k + 1), (c - 10 + n) % n, out, HW(c - 10) + (mon ? 2 : 5), 1.6, 1.6, 2); });
    for (let s = 200, k = 0; s < this.length - 150; s += 350, k++) {
      const i = this.idx(s), side = k % 2 ? 1 : -1, [x, z] = this.at(i, side * (HW(i) + (mon ? 2.5 : 11)));
      if (!this.free(x, z, i, mon ? 1.5 : 9)) continue;
      this.put('box', x, z, 1.2, this.h(i), 2, 2.4, 2, 0xff8a1f);
      this.put('box', x, z, 2.5, this.h(i), 2.3, 0.2, 2.3, 0x3b4048);
      this.put('cyl', x + 1.4, z, 2.5, 0, 0.05, 5, 0.05, STEEL, x, z);
      this.solid(x, z, 1.4, 2.6);
    }
    for (const zn of this.drsZones) this.board('drs', zn.i0, 1, HW(zn.i0) + (mon ? 2 : 4), 3, 1.5, 2.5);
    for (const st of this.straights) {
      if (st.len < 300) continue;
      const out = this.curvature((st.b + 12) % n) > 0 ? 1 : -1;
      for (const m of [3, 2, 1]) this.board('d' + m, (st.b - Math.round((m * 100) / this.spacing) + n) % n, out, HW(st.b) + (mon ? 2 : 4), 1.4, 1.4, 1.6);
      for (let s = 60, k = 0; s < st.len - 60; s += 120, k++) {
        const i = (st.a + Math.round(s / this.spacing)) % n, side = k % 2 ? 1 : -1;
        if (side === ps && inPit(i)) continue;
        const [x, z] = this.at(i, side * (HW(i) + (mon ? 3 : 12))), h = this.h(i);
        if (!this.free(x, z, i, mon ? 2 : 10)) continue;
        for (const u of [-4, 4]) this.putL('box', x, z, h, u, 0, 1.6, 0, 0.2, 3.2, 0.2, STEEL);
        this.putL('bb' + (k % 3), x, z, h, 0, 0, 3.8, 0, 0.25, 2.6, 10, 0xffffff);
        this.solidL(x, z, h, 0, 0, 1, 5);
      }
    }
  }

  private dressPits() {
    const n = this.n, ps = this.pit.side, W = F1Track.PIT_W;
    const cnt = (this.pit.i1 - this.pit.i0 + n) % n, entry = Math.round(70 / this.spacing), exit = Math.round(50 / this.spacing);
    for (let s = 0; s <= cnt; s += 2) {
      const i = (this.pit.i0 + s) % n, h = this.h(i), hw = this.hw[i];
      if (s < entry) {
        // white pit-entry line peeling off the track edge
        const [x, z] = this.at(i, ps * (hw + 0.2 + (s / entry) * 1.2));
        this.put('paint', x, z, 0.05, h, 0.3, 0.03, this.spacing * 2 + 0.1, WHITE);
      } else if (s < cnt - exit) {
        const [x, z] = this.at(i, ps * (hw + 1.4));
        if (s % 6 === 0) this.put('fence', x, z, 2.8, h, 0.05, 3.2, this.spacing * 6, WHITE);
        this.post('pitwall', i, x, z, F1_BARRIERS.pitWallR, 1.2, (cx, cz, hh, len) => this.put('box', cx, cz, 0.6, hh, 0.8, 1.2, len, CONCRETE));
      }
      // pit lane speed line + garages
      if (s % 8 === 0) {
        const [lx, lz] = this.at(i, ps * (hw + 6.5));
        this.put('paint', lx, lz, 0.05, h, 0.2, 0.03, this.spacing * 4, 0xffd23f);
      }
      if (s >= entry && s < cnt - exit && s % 8 === 0) {
        const [gx, gz] = this.at(i, ps * (hw + W + 9));
        this.put('garage', gx, gz, 5, h, 18, 10, this.spacing * 8 + 0.2, 0xffffff);
        this.put('box', gx, gz, 10.3, h, 19, 0.6, this.spacing * 8 + 0.4, 0x3b4048);
        this.solid(gx, gz, 8, 10);
      }
    }
  }

  /** Long curved roof over the pit building (Silverstone "Wing", Barcelona). */
  private dressPitRoof() {
    const n = this.n, ps = this.pit.side, cnt = (this.pit.i1 - this.pit.i0 + n) % n;
    for (let s = Math.round(70 / this.spacing); s < cnt - Math.round(50 / this.spacing); s += 8) {
      const i = (this.pit.i0 + s) % n, [x, z] = this.at(i, ps * (this.hw[i] + F1Track.PIT_W + 9));
      this.put('arch', x, z, 10.6, this.h(i), 11, 4.5, this.spacing * 8 + 0.3, 0xdfe6ee);
    }
  }

  private dressTrees(kind: 'pine' | 'park') {
    const n = this.n;
    for (let i = 0; i < n; i += 5)
      for (const side of [-1, 1]) {
        const r = hash01(i, side, 0x7ee), off = this.hw[i] + 22 + r * 50;
        if (hash01(i, side * 3, 0x51) > (kind === 'pine' ? 0.75 : 0.45)) continue;
        const [x, z] = this.at(i + Math.round(r * 4), side * off);
        if (!this.free(x, z, i, 18)) continue;
        const sc = 1.2 + r * 1.4;
        this.put('trunk', x, z, 1.1 * sc, 0, sc, sc, sc, 0x7a5232);
        if (kind === 'pine') this.put('pine', x, z, 2.2 * sc + 1.4 * sc, r * TAU, sc * 1.3, sc * 2.2, sc * 1.3, r < 0.5 ? 0x2f6e43 : 0x285e3a);
        else this.put('blob', x, z, 2.2 * sc + 1.2 * sc, r * TAU, sc * 1.4, sc * 1.2, sc * 1.4, r < 0.5 ? 0x4caf50 : 0x5d8f3a);
        this.solid(x, z, 0.6 * sc, 6 * sc);
      }
  }

  private dressFloodlights() {
    const n = this.n;
    for (let i = 0, k = 0; i < n; i += Math.round(70 / this.spacing), k++) {
      const side = k % 2 ? 1 : -1, [x, z] = this.at(i, side * (this.hw[i] + 18));
      if (!this.free(x, z, i, 15)) continue;
      const face = Math.atan2(this.px[i] - x, this.pz[i] - z);
      this.put('cyl', x, z, 13, 0, 0.35, 26, 0.35, STEEL);
      this.putL('lamp', x, z, face, 0.6, 0, 26.5, 0, 5, 2.4, 0.4, 0xfff6dd);
      this.putL('box', x, z, face, 0.3, 0, 26.5, 0, 5.4, 2.8, 0.3, 0x2b2f38);
      this.solid(x, z, 0.8, 27);
    }
  }

  /** Monza: a stretch of the old high-speed banking beside Curva Grande. */
  private dressMonza() {
    for (let s = 850; s < 1500; s += 6) {
      const i = this.idx(s), hw = this.hw[i], out = this.curvature(i) > 0 ? 1 : -1, [x, z] = this.at(i, out * (hw + 48));
      if (!this.free(x, z, i, 30)) continue;
      this.put('box', x, z, 3.2, this.h(i), 14, 0.6, 6.4, CONCRETE, x, z, { r: out * 0.55 });
      const [fx, fz] = this.at(i, out * (hw + 54));
      this.put('box', fx, fz, 6.8, this.h(i), 0.3, 1.2, 6.4, STEEL, x, z);
      this.solid(x, z, 4, 6);
    }
  }

  /** Blocks of buildings lining a street circuit (both sides), `gap` metres back from the kerb. */
  private buildings(step: number, gap: number, minLv: number, maxLv: number, keep = 1) {
    const n = this.n, TINT = [0xffffff, 0xf2d9c4, 0xe9e0c9, 0xf4c9b0, 0xdfe6d8];
    for (let i = 0; i < n; i += Math.round(step / this.spacing))
      for (const side of [-1, 1]) {
        if (hash01(i, side * 5, 0x3e) > keep) continue;
        const r = hash01(i, side, 0x3c), w = 12 + r * 6, [x, z] = this.at(i, side * (this.hw[i] + gap + w / 2));
        if (!this.free(x, z, i, w * 0.7 + 1, w * 0.55 + 1) || this.rects.some((q) => rectDist(q, x, z) < w)) continue;
        const lv = minLv + Math.floor(hash01(side, i, 0x3d) * (maxLv - minLv + 1)), h = this.h(i);
        for (let l = 0; l < lv; l++) this.put('facade', x, z, 6 + l * 12, h, w, 12, w, TINT[Math.floor(r * 50) % TINT.length], x, z);
        this.put('box', x, z, lv * 12 + 0.4, h, w + 0.6, 0.8, w + 0.6, 0xb5452e, x, z);
        this.solid(x, z, w * 0.55, lv * 12);
      }
  }

  /** Monaco: buildings both sides, the tunnel roof, yachts in the harbour. */
  private dressMonaco() {
    const n = this.n;
    const tunnel = (i: number) => this.inRange(i, this.idx(MONACO_TUNNEL[0]), this.idx(MONACO_TUNNEL[1]));
    this.buildings(18, 4, 2, 5);
    for (let i = 0; i < n; i += 3) {
      if (!tunnel(i)) continue;
      const h = this.h(i), hw = this.hw[i], [x, z] = this.at(i, 0);
      this.put('box', x, z, 7, h, 2 * hw + 4, 1, this.spacing * 3 + 0.2, CONCRETE);
      this.put('lamp', x, z, 6.4, h, 0.6, 0.15, this.spacing * 2, 0xfff1c4, x, z);
      for (const side of [-1, 1]) { const [wx, wz] = this.at(i, side * (hw + 2)); this.put('box', wx, wz, 3.5, h, 1, 7, this.spacing * 3 + 0.2, 0xbdb6a8, x, z); }
    }
    const R = MONACO_HARBOUR;
    for (let k = 0; k < 14; k++) {
      const x = R.x0 + 25 + hash01(k, 1, 0x9a) * (R.x1 - R.x0 - 50), z = R.z0 + 25 + hash01(k, 2, 0x9a) * (R.z1 - R.z0 - 50), h = hash01(k, 3, 0x9a) * TAU, L = 14 + hash01(k, 4, 0x9a) * 22;
      this.putL('box', x, z, h, 0, 0, 0.5, 0, L * 0.28, 2.6, L, WHITE, { abs: true });
      this.putL('box', x, z, h, -L * 0.08, 0, 2.6, 0, L * 0.2, 1.8, L * 0.45, 0xe8ecef, { abs: true });
      this.putL('glass', x, z, h, L * 0.06, 0, 2.7, 0, L * 0.205, 0.6, L * 0.2, 0xffffff, { abs: true });
      if (k % 3 === 0) this.putL('cyl', x, z, h, 0, 0, 9, 0, 0.12, 14, 0.12, WHITE, { abs: true });
    }
  }

  /** City street circuits (Singapore, Baku, Las Vegas, Interlagos): a lighter ring of taller blocks set further back. */
  private dressCity() {
    const street = !!this.cfg.street;
    this.buildings(street ? 30 : 40, street ? 8 : 40, street ? 3 : 2, street ? 8 : 4, street ? 0.7 : 0.45);
  }

  /**
   * Suzuka: the crossover bridge (the back straight passes over the run to the hairpin) and the ferris wheel.
   * The terrain is one height field, so both roads meet at one height at the crossing: the bridge deck is dressing.
   */
  private dressSuzuka() {
    const [il, iu] = this.crossings[0] ?? [this.idx(2320), this.idx(4690)], hw = Math.max(this.hw[iu], this.hw[il]);
    const ax = (this.px[iu] + this.px[il]) / 2, az = (this.pz[iu] + this.pz[il]) / 2, h = this.h(iu), L = 2 * hw + 10, Wd = 2 * hw + 3;
    this.putL('box', ax, az, h, 0, 0, 6.8, 0, Wd, 1.2, L, CONCRETE);
    for (const v of [-1, 1]) this.putL('box', ax, az, h, 0, v * (Wd / 2), 7.9, 0, 0.4, 1.1, L, 0xe8e9ec);
    for (const u of [-1, 1]) for (const v of [-1, 1]) {
      const s = Math.sin(h), co = Math.cos(h), x = ax + s * u * (L / 2 - 0.6) + co * v * (Wd / 2 - 0.6), z = az + co * u * (L / 2 - 0.6) - s * v * (Wd / 2 - 0.6);
      if (this.nearest(x, z).d < hw + 0.8) continue;
      this.put('box', x, z, 3.1, h, 1, 6.2, 1, CONCRETE, ax, az);
      this.solid(x, z, 0.8, 6.2);
    }
    this.ferrisWheel(this.idx(320), -this.pit.side, 110);
  }

  /** Ferris wheel `off` metres out from sample i on `side` (Suzuka's Motopia wheel, the Singapore Flyer). */
  private ferrisWheel(i: number, side: number, off: number) {
    let [fx, fz] = this.at(i, side * (this.hw[i] + off));
    if (!this.free(fx, fz, i, 40)) {
      [fx, fz] = this.at(i, -side * (this.hw[i] + off));
      if (!this.free(fx, fz, i, 40)) return;
    }
    const fh = this.h(i), R = 30, cy = R + 5;
    this.putL('ring', fx, fz, fh, 0, 0, cy, 0, R, R, 40, 0xe8e9ec);
    this.putL('ring', fx, fz, fh, 0, 0, cy, 0, R * 0.97, R * 0.97, 40, 0xd8322a);
    for (let k = 0; k < 8; k++) this.putL('box', fx, fz, fh, 0, 0, cy, 0, 0.3, 2 * R, 0.3, 0xc9ced4, { r: (k * PI) / 8 });
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU, col = [0xd8322a, 0x2c6fb7, 0xffd23f, 0x2e8b57][k % 4];
      this.putL('box', fx, fz, fh, 0, Math.cos(a) * R, cy + Math.sin(a) * R - 1.6, 0, 2, 2.4, 2, col);
    }
    for (const u of [-3, 3]) for (const v of [-1, 1]) this.putL('box', fx, fz, fh, u, v * 9, cy / 2, 0, 0.8, cy / Math.cos(0.27), 0.8, STEEL, { r: -v * 0.27 });
    this.putL('cylZ', fx, fz, fh, 0, 0, cy, 0, 1.5, 1.5, 7, STEEL);
    this.solid(fx, fz, 10, cy);
  }

  /** Circuit of the Americas: the red observation tower beside Turn 1. */
  private dressTower() {
    const c = this.corners[0] ?? this.idx(300);
    for (const off of [70, 110]) for (const side of [-1, 1]) {
      const [x, z] = this.at(c, side * (this.hw[c] + off));
      if (!this.free(x, z, c, 40)) continue;
      this.put('cyl', x, z, 38, 0, 1.6, 76, 1.6, CONCRETE);
      for (let k = 0; k < 10; k++) this.putL('box', x, z, (k * TAU) / 10, 0, 6, 38, 0, 0.35, 76, 0.35, RED, { r: 0.08 });
      this.put('cyl', x, z, 77, 0, 7, 3, 7, 0xe8e9ec);
      this.put('cyl', x, z, 79.5, 0, 7.5, 0.6, 7.5, RED);
      this.solid(x, z, 4, 80);
      return;
    }
  }

  /** Las Vegas: a big glowing sphere arena beside the Strip straight. */
  private dressSphere() {
    const st = this.straights[0], i = st ? (st.a + Math.round(st.len / 2 / this.spacing)) % this.n : this.idx(this.length / 2);
    for (const side of [1, -1]) {
      const [x, z] = this.at(i, side * (this.hw[i] + 120));
      if (!this.free(x, z, i, 80)) continue;
      this.put('sphere', x, z, 52, 0, 60, 56, 60, 0xffffff);
      this.solid(x, z, 58, 100);
      return;
    }
  }

  /** Zandvoort: sand dunes with marram grass around the track. */
  private dressDunes() {
    const n = this.n;
    for (let i = 0; i < n; i += 9)
      for (const side of [-1, 1]) {
        const r = hash01(i, side, 0xd0), off = this.hw[i] + 28 + r * 60;
        if (hash01(i, side * 7, 0xd1) > 0.4) continue;
        const [x, z] = this.at(i, side * off);
        if (!this.free(x, z, i, 22)) continue;
        const sc = 5 + r * 9;
        this.put('blob', x, z, 0, r * TAU, sc * 1.6, sc * 0.55, sc, SAND);
        this.put('blob', x, z, sc * 0.45, r * 3, sc * 0.9, sc * 0.18, sc * 0.6, 0x9aa858);
      }
  }
}

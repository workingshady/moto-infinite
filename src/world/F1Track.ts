// Real Formula 1 circuits at true 1:1 scale, with trackside furniture (kerbs, gravel, armco, pits, grandstands, start lights).
//
// Circuit centre lines are derived from "f1-circuits" by Tomislav Bacinger (github.com/bacinger/f1-circuits),
// MIT License, Copyright (c) Tomislav Bacinger. Lon/lat converted to local metres (equirectangular around each
// circuit's centroid: x = east, z = -north), smoothed with a centripetal Catmull-Rom, resampled every ~8 m, rounded to
// 0.1 m. Index 0 is the start/finish line and points run in race direction (Monaco rotated so it starts on Bd Albert 1er).
import * as THREE from 'three';
import type { Noise } from '../utils/noise';
import type { Game } from '../core/Game';
import type { Chunk, Obstacle } from './Chunks';
import { hash01, type Poi, type Pose, type RoadLayout, type RoadPointFn } from './layout';
import { G, M, MAT, canvasTex } from '../entities/assets';
import { F1_BARRIERS, ROAD } from '../config';
import { clamp, PI, TAU } from '../utils/math';

export type F1TrackId = 'monza' | 'silverstone' | 'spa' | 'monaco' | 'suzuka' | 'bahrain';

export const F1_TRACKS: {
  id: F1TrackId;
  name: string;
  country: string;
  lengthKm: number;
  laps: number;
  blurb: string;
  time: 'day' | 'dawn' | 'sunset' | 'night';
  weather: 'clear' | 'cloudy' | 'rain' | 'fog';
  theme: 'mixed' | 'desert' | 'forest' | 'alpine' | 'islands';
}[] = [
  { id: 'monza', name: 'Monza', country: 'Italy', lengthKm: 5.793, laps: 3, blurb: 'The Temple of Speed: flat-out straights, the Rettifilo chicane, Lesmos, Ascari and the Parabolica.', time: 'day', weather: 'clear', theme: 'forest' },
  { id: 'silverstone', name: 'Silverstone', country: 'Great Britain', lengthKm: 5.891, laps: 3, blurb: 'Old airfield, fast and flowing: Copse, Maggotts, Becketts and Chapel at full commitment.', time: 'day', weather: 'cloudy', theme: 'mixed' },
  { id: 'spa', name: 'Spa-Francorchamps', country: 'Belgium', lengthKm: 7.004, laps: 2, blurb: 'Seven kilometres of Ardennes forest: La Source, Eau Rouge-Raidillon, Kemmel, Pouhon and Blanchimont.', time: 'day', weather: 'rain', theme: 'forest' },
  { id: 'monaco', name: 'Monaco', country: 'Monaco', lengthKm: 3.337, laps: 5, blurb: 'Armco inches away, the Casino, the tunnel and the harbour chicane. No room for error.', time: 'day', weather: 'clear', theme: 'islands' },
  { id: 'suzuka', name: 'Suzuka', country: 'Japan', lengthKm: 5.807, laps: 3, blurb: 'The figure-8: the Esses, Degner, the Hairpin, Spoon and 130R, crossing over itself.', time: 'sunset', weather: 'clear', theme: 'mixed' },
  { id: 'bahrain', name: 'Bahrain', country: 'Bahrain', lengthKm: 5.412, laps: 3, blurb: 'Desert night race under floodlights. Big stops into Turn 1, 4 and 10.', time: 'night', weather: 'clear', theme: 'desert' },
];

interface Cfg {
  hw: number;
  base: number;
  /** [distance from the line (m), height offset (m)] keyframes, smoothed along the lap */
  elev: [number, number][];
  drs: number;
  /** pit lane range around the line, metres [before, after] */
  pit: [number, number];
  trees?: 'pine' | 'park';
  lights?: boolean;
}
const CFG: Record<F1TrackId, Cfg> = {
  monza: { hw: 7.5, base: 6, elev: [[0, 0], [1500, 3], [3000, 6], [4500, 2], [5788, 0]], drs: 2, pit: [380, 260], trees: 'park' },
  silverstone: { hw: 7.5, base: 6, elev: [[0, 0], [2000, 4], [4000, 2], [5884, 0]], drs: 2, pit: [380, 260] },
  spa: { hw: 7.5, base: 35, elev: [[0, 0], [300, -2], [650, -18], [900, 10], [1900, 18], [2600, 2], [3500, -14], [4300, -28], [5300, -18], [6300, -5], [6984, 0]], drs: 2, pit: [330, 200], trees: 'pine' },
  monaco: { hw: 5.5, base: 4, elev: [[0, 0], [170, 1], [520, 16], [860, 28], [1100, 22], [1400, 14], [1750, 4], [1900, 1], [3330, 0]], drs: 1, pit: [260, 140] },
  suzuka: { hw: 7.5, base: 6, elev: [[0, 0], [1200, 4], [2320, 2], [3500, 6], [4696, 2], [5400, 1], [5817, 0]], drs: 1, pit: [380, 260] },
  bahrain: { hw: 7.5, base: 6, elev: [[0, 0], [1500, 3], [3000, -2], [4500, 2], [5425, 0]], drs: 3, pit: [380, 260], lights: true },
};
/** Monaco harbour (water), local metres. */
const MONACO_HARBOUR = { x0: -180, z0: 95, x1: 170, z1: 450, y: -4 };
/** Monaco tunnel and the Suzuka crossover, metres from the line. */
const MONACO_TUNNEL: [number, number] = [1840, 2280];
const SUZUKA_X: [number, number] = [4696, 2320]; // upper (back straight over the bridge), lower (after Degner)

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

/** Raw centre line of a circuit as [x0, z0, x1, z1, ...] (metres, ~8 m apart, index 0 = start line). */
export function f1Outline(id: F1TrackId): readonly number[] { return DATA[id]; }

/** Draw a circuit fitted into a w x h canvas area (menu preview). Uses the current stroke style/width. */
export function drawF1Map(ctx: CanvasRenderingContext2D, id: F1TrackId, w: number, h: number, pad = 8) {
  const d = DATA[id];
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
  readonly halfWidth: number;
  readonly drsZones: { i0: number; i1: number }[] = [];
  readonly pit: { i0: number; i1: number; side: 1 | -1 };
  /** Start-light gantry (built when the chunk holding the line is dressed). */
  startLights: THREE.Group | null = null;
  private pods: THREE.MeshBasicMaterial[] = [];
  private greens: THREE.MeshBasicMaterial[] = [];
  private lightState = { lit: 0, green: false };
  private readonly elevH: Float32Array;
  private readonly cfg: Cfg;
  private readonly rects: Rect[] = [];
  private readonly cells = new Map<number, number[]>();
  private readonly CELL = 32;
  private readonly props: Prop[] = [];
  private readonly solids: Obstacle[] = [];
  private static readonly PIT_W = 13;

  constructor(_noise: Noise, readonly id: F1TrackId) {
    const cfg = (this.cfg = CFG[id]), d = DATA[id], cps: THREE.Vector3[] = [];
    for (let i = 0; i < d.length; i += 2) cps.push(new THREE.Vector3(d[i], 0, d[i + 1]));
    const curve = new THREE.CatmullRomCurve3(cps, true, 'centripetal');
    curve.arcLengthDivisions = cps.length * 10;
    this.length = curve.getLength();
    const n = (this.n = Math.round(this.length / 2));
    this.spacing = this.length / n;
    this.halfWidth = cfg.hw;
    const pts = curve.getSpacedPoints(n);
    this.px = new Float32Array(n); this.pz = new Float32Array(n);
    this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.px[i] = pts[i].x; this.pz[i] = pts[i].z; }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      const dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a], l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
      const key = this.key(Math.floor(this.px[i] / this.CELL), Math.floor(this.pz[i] / this.CELL));
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(i);
    }

    // elevation: cosine-eased keyframes along the lap, then a ±60 m moving average
    const raw = new Float32Array(n), E = cfg.elev, total = E[E.length - 1][0];
    for (let i = 0; i < n; i++) {
      const s = (i / n) * total;
      let k = 0;
      while (k < E.length - 2 && E[k + 1][0] < s) k++;
      const [s0, h0] = E[k], [s1, h1] = E[k + 1], u = clamp((s - s0) / (s1 - s0 || 1), 0, 1);
      raw[i] = h0 + (h1 - h0) * (0.5 - 0.5 * Math.cos(u * PI));
    }
    this.elevH = new Float32Array(n);
    const W = Math.round(60 / this.spacing);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = -W; j <= W; j++) s += raw[(i + j + n) % n];
      this.elevH[i] = cfg.base + s / (2 * W + 1);
    }
    if (id === 'monaco') this.rects.push(MONACO_HARBOUR);

    // pit lane on the side of the main straight with more room
    const clear = (side: number) => {
      let m = 1e9;
      for (const s of [-150, 0, 100]) {
        const i = this.idx(s), [x, z] = this.at(i, side * 45), r = this.nearest(x, z, true);
        m = Math.min(m, this.near(r.i, i, 40) ? 1e9 : r.d);
        m = Math.min(m, this.edgeAt(x, z, i));
      }
      return m;
    };
    const side: 1 | -1 = clear(1) >= clear(-1) ? 1 : -1;
    this.pit = { i0: this.idx(-cfg.pit[0]), i1: this.idx(cfg.pit[1]), side };

    this.buildStraights();
    this.dressCommon();
    if (id === 'monza') this.dressMonza();
    else if (id === 'silverstone') this.dressPitRoof();
    else if (id === 'monaco') this.dressMonaco();
    else if (id === 'suzuka') this.dressSuzuka();
    if (cfg.trees) this.dressTrees(cfg.trees);
    if (cfg.lights) this.dressFloodlights();
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

  /** Course + pit lane distance (asphalt inside the full width and the pit lane strip). */
  private dist0(x: number, z: number) {
    const r = this.nearest(x, z);
    if (r.i < 0) return 1e9;
    let d = Math.max(0, r.d - this.halfWidth + ROAD.asphalt);
    if (this.inRange(r.i, this.pit.i0, this.pit.i1)) {
      const lat = ((x - this.px[r.i]) * this.tz[r.i] - (z - this.pz[r.i]) * this.tx[r.i]) * this.pit.side;
      if (lat > 0) d = Math.min(d, Math.max(0, lat - (this.halfWidth + F1Track.PIT_W) + ROAD.asphalt));
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

  /** F1 grid: two columns, staggered by 4 m, rows 8 m apart, behind the line, facing race direction. */
  spawn(i: number): Pose {
    const row = Math.floor(i / 2), back = 8 + row * 8 + (i % 2) * 4, side = (i % 2 ? 1 : -1) * Math.min(2.6, this.halfWidth * 0.45);
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
    return lat > this.halfWidth + 1 && lat < this.halfWidth + F1Track.PIT_W;
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
      ch.obs.push(...[-1, 1].map((s) => { const [x, z] = this.at(0, s * (this.halfWidth + 2.2)); return { x, z, r: 0.45, top: g.position.y + 8 }; }));
    }
  }

  private buildGantry(y: number) {
    const g = new THREE.Group(), hw = this.halfWidth, steel = M(0x3b4048, { metalness: 0.5, roughness: 0.4 });
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

  private inRange(i: number, i0: number, i1: number) { return i0 <= i1 ? i >= i0 && i <= i1 : i >= i0 || i <= i1; }
  private near(a: number, b: number, m: number) { const d = Math.abs(a - b); return Math.min(d, this.n - d) * this.spacing < m; }
  private idx(s: number) { return ((Math.round(s / this.spacing) % this.n) + this.n) % this.n; }
  private h(i: number) { return Math.atan2(this.tx[i], this.tz[i]); }
  /** Point offset sideways from sample i (positive = right-hand side of race direction). */
  private at(i: number, off: number): [number, number] { i = ((i % this.n) + this.n) % this.n; return [this.px[i] + this.tz[i] * off, this.pz[i] - this.tx[i] * off]; }
  /** Distance beyond the track edge, ignoring the part of the track around sample `own`. */
  private edgeAt(x: number, z: number, own: number) {
    let bd = 1e18;
    const cx = Math.floor(x / this.CELL), cz = Math.floor(z / this.CELL);
    for (let a = -2; a <= 2; a++)
      for (let b = -2; b <= 2; b++) {
        const list = this.cells.get(this.key(cx + a, cz + b));
        if (!list) continue;
        for (const i of list) {
          if (this.near(i, own, 90)) continue;
          const dx = x - this.px[i], dz = z - this.pz[i], d = dx * dx + dz * dz;
          if (d < bd) bd = d;
        }
      }
    return Math.sqrt(bd) - this.halfWidth;
  }
  /** Clear of every other part of the track (and of the pit lane / harbour). */
  private free(x: number, z: number, own: number, m: number, rad = 0) {
    if (this.edgeAt(x, z, own) < m) return false;
    const r = this.nearest(x, z);
    if (r.i >= 0 && r.d - rad < this.halfWidth + 0.5) return false;
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
    const hw = this.halfWidth;
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
    return lat > this.halfWidth + F1_BARRIERS.gravel[0] && lat < this.halfWidth + F1_BARRIERS.gravel[1] ? 2 : 1;
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

  // ------------------------------------------------------------------ straights, DRS, braking boards, corners

  private straights: { a: number; b: number; len: number }[] = [];

  private buildStraights() {
    const n = this.n, K = Math.round(20 / this.spacing), ang = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - K + n) % n, b = (i + K) % n;
      ang[i] = Math.abs(Math.atan2(this.tx[a] * this.tz[b] - this.tz[a] * this.tx[b], this.tx[a] * this.tx[b] + this.tz[a] * this.tz[b]));
    }
    const runs = (pred: (v: number) => boolean) => {
      let s0 = 0;
      while (s0 < n && pred(ang[s0])) s0++;
      const out: { a: number; b: number; len: number }[] = [];
      let cur = -1;
      for (let k = 1; k <= n; k++) {
        const i = (s0 + k) % n;
        if (pred(ang[i])) { if (cur < 0) cur = k; }
        else if (cur >= 0) { out.push({ a: (s0 + cur) % n, b: (s0 + k - 1) % n, len: (k - cur) * this.spacing }); cur = -1; }
      }
      return out;
    };
    this.straights = runs((v) => v < 0.12).filter((r) => r.len >= 250).sort((p, q) => q.len - p.len);
    for (const r of this.straights.slice(0, this.cfg.drs))
      this.drsZones.push({ i0: (r.a + Math.round(Math.min(80, r.len * 0.15) / this.spacing)) % n, i1: (r.b - Math.round(Math.min(120, r.len * 0.2) / this.spacing) + n) % n });
    // corners (for numbering + furniture)
    let corners = runs((v) => v > 0.35).filter((r) => r.len >= 8);
    corners = corners.filter((r, k) => !corners.slice(0, k).some((q) => this.near(q.b, r.a, 40)));
    this.corners = corners.sort((p, q) => p.a - q.a).map((r) => r.a);
  }
  private corners: number[] = [];

  // ------------------------------------------------------------------ dressing

  private dressCommon() {
    const n = this.n, hw = this.halfWidth, mon = this.id === 'monaco', ps = this.pit.side, B = F1_BARRIERS;
    const inPit = (i: number) => this.inRange(i, (this.pit.i0 - 10 + n) % n, (this.pit.i1 + 10) % n);
    this.gravel = new Int8Array(n);
    const armco = (x: number, z: number, h: number, len: number) => this.put('box', x, z, 0.6, h, 0.15, 0.7, len, 0xc9ced4);
    const fence = (x: number, z: number, h: number, len: number) => this.put('fence', x, z, 3, h, 0.05, 4, len, WHITE);
    // kerbs (both sides of a corner), gravel + tyre walls on the outside, armco + catch fence beyond
    for (let i = 0; i < n; i += 2) {
      const k = this.curvature(i), h = this.h(i), out = k > 0 ? 1 : -1;
      if (Math.abs(k) > 0.1)
        for (const side of [-1, 1]) {
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
    this.put('checker', this.px[0], this.pz[0], 0.04, this.h(0), 2 * hw, 0.02, 1.4, 0xffffff);
    for (let k = 0; k < 20; k++) {
      const p = this.spawn(k), i = this.nearest(p.x, p.z, true).i, [x, z] = [p.x + Math.sin(p.h) * 1.8, p.z + Math.cos(p.h) * 1.8];
      this.put('paint', x, z, 0.04, this.h(i), 2.2, 0.03, 0.3, WHITE);
    }
    this.dressPits();
    // grandstands: opposite the pits on the main straight, and outside the sharpest corners
    for (let s = -220; s <= 140; s += 34) {
      const i = this.idx(s), [x, z] = this.at(i, -ps * (hw + (mon ? 6 : 16)));
      if (this.free(x, z, i, mon ? 4 : 12, 9)) this.stand(x, z, this.h(i) - ps * PI / 2, 30);
    }
    const sharp = [...this.corners].sort((a, b) => Math.abs(this.curvature(b + 4)) - Math.abs(this.curvature(a + 4))).slice(0, 4);
    for (const c of sharp)
      for (const ds of [0, 20]) {
        const i = (c + ds) % n, out = this.curvature(i) > 0 ? 1 : -1, [x, z] = this.at(i, out * (hw + (mon ? 7 : 30)));
        if (this.free(x, z, i, mon ? 5 : 24, 9)) this.stand(x, z, this.h(i) + out * PI / 2, 26);
      }
    // corner numbers, marshal posts, DRS boards, braking boards, billboards
    this.corners.forEach((c, k) => { const out = this.curvature((c + 6) % n) > 0 ? 1 : -1; this.board('n' + (k + 1), (c - 10 + n) % n, out, hw + (mon ? 2 : 5), 1.6, 1.6, 2); });
    for (let s = 200, k = 0; s < this.length - 150; s += 350, k++) {
      const i = this.idx(s), side = k % 2 ? 1 : -1, [x, z] = this.at(i, side * (hw + (mon ? 2.5 : 11)));
      if (!this.free(x, z, i, mon ? 1.5 : 9)) continue;
      this.put('box', x, z, 1.2, this.h(i), 2, 2.4, 2, 0xff8a1f);
      this.put('box', x, z, 2.5, this.h(i), 2.3, 0.2, 2.3, 0x3b4048);
      this.put('cyl', x + 1.4, z, 2.5, 0, 0.05, 5, 0.05, STEEL, x, z);
      this.solid(x, z, 1.4, 2.6);
    }
    for (const zn of this.drsZones) this.board('drs', zn.i0, 1, hw + (mon ? 2 : 4), 3, 1.5, 2.5);
    for (const st of this.straights) {
      if (st.len < 300) continue;
      const out = this.curvature((st.b + 12) % n) > 0 ? 1 : -1;
      for (const m of [3, 2, 1]) this.board('d' + m, (st.b - Math.round((m * 100) / this.spacing) + n) % n, out, hw + (mon ? 2 : 4), 1.4, 1.4, 1.6);
      for (let s = 60, k = 0; s < st.len - 60; s += 120, k++) {
        const i = (st.a + Math.round(s / this.spacing)) % n, side = k % 2 ? 1 : -1;
        if (side === ps && inPit(i)) continue;
        const [x, z] = this.at(i, side * (hw + (mon ? 3 : 12))), h = this.h(i);
        if (!this.free(x, z, i, mon ? 2 : 10)) continue;
        for (const u of [-4, 4]) this.putL('box', x, z, h, u, 0, 1.6, 0, 0.2, 3.2, 0.2, STEEL);
        this.putL('bb' + (k % 3), x, z, h, 0, 0, 3.8, 0, 0.25, 2.6, 10, 0xffffff);
        this.solidL(x, z, h, 0, 0, 1, 5);
      }
    }
  }

  private dressPits() {
    const n = this.n, hw = this.halfWidth, ps = this.pit.side, W = F1Track.PIT_W;
    const cnt = (this.pit.i1 - this.pit.i0 + n) % n, entry = Math.round(70 / this.spacing), exit = Math.round(50 / this.spacing);
    for (let s = 0; s <= cnt; s += 2) {
      const i = (this.pit.i0 + s) % n, h = this.h(i);
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

  /** Silverstone "Wing": a long curved roof over the pit building. */
  private dressPitRoof() {
    const n = this.n, hw = this.halfWidth, ps = this.pit.side, cnt = (this.pit.i1 - this.pit.i0 + n) % n;
    for (let s = Math.round(70 / this.spacing); s < cnt - Math.round(50 / this.spacing); s += 8) {
      const i = (this.pit.i0 + s) % n, [x, z] = this.at(i, ps * (hw + F1Track.PIT_W + 9));
      this.put('arch', x, z, 10.6, this.h(i), 11, 4.5, this.spacing * 8 + 0.3, 0xdfe6ee);
    }
  }

  private dressTrees(kind: 'pine' | 'park') {
    const n = this.n, hw = this.halfWidth;
    for (let i = 0; i < n; i += 5)
      for (const side of [-1, 1]) {
        const r = hash01(i, side, 0x7ee), off = hw + 22 + r * 50;
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
    const n = this.n, hw = this.halfWidth;
    for (let i = 0, k = 0; i < n; i += Math.round(70 / this.spacing), k++) {
      const side = k % 2 ? 1 : -1, [x, z] = this.at(i, side * (hw + 18));
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
    const hw = this.halfWidth;
    for (let s = 850; s < 1500; s += 6) {
      const i = this.idx(s), out = this.curvature(i) > 0 ? 1 : -1, [x, z] = this.at(i, out * (hw + 48));
      if (!this.free(x, z, i, 30)) continue;
      this.put('box', x, z, 3.2, this.h(i), 14, 0.6, 6.4, CONCRETE, x, z, { r: out * 0.55 });
      const [fx, fz] = this.at(i, out * (hw + 54));
      this.put('box', fx, fz, 6.8, this.h(i), 0.3, 1.2, 6.4, STEEL, x, z);
      this.solid(x, z, 4, 6);
    }
  }

  /** Monaco: buildings both sides, the tunnel roof, yachts in the harbour. */
  private dressMonaco() {
    const n = this.n, hw = this.halfWidth, TINT = [0xffffff, 0xf2d9c4, 0xe9e0c9, 0xf4c9b0, 0xdfe6d8];
    const tunnel = (i: number) => this.inRange(i, this.idx(MONACO_TUNNEL[0]), this.idx(MONACO_TUNNEL[1]));
    for (let i = 0; i < n; i += Math.round(18 / this.spacing))
      for (const side of [-1, 1]) {
        const r = hash01(i, side, 0x3c), w = 12 + r * 6, [x, z] = this.at(i, side * (hw + 4 + w / 2));
        if (!this.free(x, z, i, w * 0.7 + 1, w * 0.55 + 1) || rectDist(MONACO_HARBOUR, x, z) < w) continue;
        const lv = 2 + Math.floor(hash01(side, i, 0x3d) * 4), h = this.h(i);
        for (let l = 0; l < lv; l++) this.put('facade', x, z, 6 + l * 12, h, w, 12, w, TINT[Math.floor(r * 50) % TINT.length], x, z);
        this.put('box', x, z, lv * 12 + 0.4, h, w + 0.6, 0.8, w + 0.6, 0xb5452e, x, z);
        this.solid(x, z, w * 0.55, lv * 12);
      }
    for (let i = 0; i < n; i += 3) {
      if (!tunnel(i)) continue;
      const h = this.h(i), [x, z] = this.at(i, 0);
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

  /** Suzuka: the crossover bridge and the ferris wheel. */
  private dressSuzuka() {
    const hw = this.halfWidth, iu = this.idx(SUZUKA_X[0]), il = this.idx(SUZUKA_X[1]);
    const ax = (this.px[iu] + this.px[il]) / 2, az = (this.pz[iu] + this.pz[il]) / 2, h = this.h(iu), L = 2 * hw + 10, Wd = 2 * hw + 3;
    this.putL('box', ax, az, h, 0, 0, 6.8, 0, Wd, 1.2, L, CONCRETE);
    for (const v of [-1, 1]) this.putL('box', ax, az, h, 0, v * (Wd / 2), 7.9, 0, 0.4, 1.1, L, 0xe8e9ec);
    for (const u of [-1, 1]) for (const v of [-1, 1]) {
      const s = Math.sin(h), co = Math.cos(h), x = ax + s * u * (L / 2 - 0.6) + co * v * (Wd / 2 - 0.6), z = az + co * u * (L / 2 - 0.6) - s * v * (Wd / 2 - 0.6);
      if (this.nearest(x, z).d < hw + 0.8) continue;
      this.put('box', x, z, 3.1, h, 1, 6.2, 1, CONCRETE, ax, az);
      this.solid(x, z, 0.8, 6.2);
    }
    // ferris wheel behind the main straight, opposite the pits
    const i = this.idx(320), [fx, fz] = this.at(i, -this.pit.side * (hw + 110));
    if (!this.free(fx, fz, i, 40)) return;
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
}

/** Embedded circuit centre lines (see header for source and licence). */
const DATA: Record<F1TrackId, number[]> = {
  monza: [-417.2,494.3,-416.4,486.4,-415.6,478.4,-414.8,470.5,-414.1,462.5,-413.3,454.5,-412.6,446.6,-411.9,438.6,-411.2,430.7,-410.5,422.7,-409.8,414.7,-409.1,406.8,-408.4,398.8,-407.7,390.8,-407,382.9,-406.4,374.9,-405.7,366.9,-405,359,-404.4,351,-403.7,343,-403,335.1,-402.4,327.1,-401.7,319.1,-401.1,311.2,-400.4,303.2,-399.7,295.2,-399.1,287.3,-398.4,279.3,-397.8,271.3,-397.1,263.4,-396.5,255.4,-395.8,247.4,-395.2,239.4,-394.5,231.5,-393.9,223.5,-393.3,215.5,-392.6,207.6,-392,199.6,-391.3,191.6,-390.7,183.7,-390,175.7,-389.3,167.7,-388.7,159.8,-388,151.8,-387.4,143.8,-386.7,135.9,-386.1,127.9,-385.4,119.9,-384.7,112,-384.1,104,-383.4,96,-382.7,88.1,-382,80.1,-381.3,72.1,-380.6,64.2,-379.9,56.2,-379.2,48.2,-378.5,40.3,-377.8,32.3,-377.2,24.3,-376.5,16.4,-375.8,8.4,-375.1,0.4,-374.4,-7.5,-373.8,-15.5,-373.1,-23.5,-372.4,-31.4,-371.7,-39.4,-371,-47.4,-370.3,-55.3,-369.6,-63.3,-368.9,-71.2,-368.1,-79.2,-367.3,-87.2,-366.5,-95.1,-365.7,-103.1,-364.7,-111,-363.5,-118.9,-358.8,-125.1,-351.1,-126.9,-343.2,-125.9,-335.2,-125.4,-327.5,-126.6,-321.9,-132.3,-319.5,-139.8,-320.1,-147.7,-321.9,-155.5,-323.9,-163.2,-326,-170.9,-328.2,-178.6,-330.3,-186.3,-332.5,-194,-334.7,-201.7,-336.8,-209.4,-339,-217.1,-341,-224.9,-343,-232.6,-344.8,-240.4,-346.4,-248.2,-347.6,-256.1,-348.5,-264.1,-349.2,-272,-349.9,-280,-350.3,-288,-350.4,-296,-349.9,-304,-349.2,-311.9,-348.5,-319.9,-348,-327.9,-347.4,-335.8,-346.9,-343.8,-346.4,-351.8,-345.8,-359.8,-345.3,-367.7,-344.8,-375.7,-344.2,-383.7,-343.6,-391.7,-343.1,-399.6,-342.5,-407.6,-341.9,-415.6,-341.2,-423.6,-340.6,-431.5,-339.8,-439.5,-338.9,-447.4,-337.8,-455.4,-336.3,-463.2,-334.7,-471,-332.9,-478.8,-331,-486.6,-328.7,-494.3,-326.2,-501.8,-323.5,-509.4,-320.6,-516.8,-317.6,-524.2,-314.5,-531.6,-311.2,-538.9,-307.8,-546.1,-304.1,-553.2,-300.1,-560.1,-295.9,-566.9,-291.5,-573.6,-286.9,-580.1,-282.1,-586.5,-277.1,-592.8,-271.9,-598.9,-266.6,-604.9,-261.2,-610.8,-255.7,-616.5,-250,-622.2,-244.2,-627.6,-238.2,-632.9,-232.1,-638.1,-225.9,-643.1,-219.5,-647.9,-213,-652.7,-206.5,-657.2,-199.8,-661.6,-193,-665.8,-186.1,-669.8,-179.1,-673.7,-172.1,-677.5,-165,-681.3,-157.9,-685,-150.8,-688.6,-143.5,-691.9,-136.1,-695,-128.6,-697.7,-121,-700.3,-113.4,-702.7,-105.8,-705.1,-98.2,-707.4,-90.5,-709.7,-82.8,-711.8,-75,-713.7,-67.2,-715.4,-59.4,-716.9,-51.5,-718.3,-43.6,-719.5,-35.7,-720.7,-27.7,-721.6,-19.8,-722.4,-11.8,-723,-3.8,-723.7,4.1,-724.3,12.1,-725,20.1,-725.7,28,-726.5,36,-727.2,44,-727.9,51.9,-728.6,59.9,-729.3,67.8,-730.1,75.8,-730.8,83.8,-731.5,91.7,-732.2,99.7,-732.9,107.7,-733.6,115.6,-734.2,123.6,-734.9,131.6,-735.5,139.5,-736.2,147.5,-736.8,155.5,-737.4,163.4,-738,171.4,-738.6,179.4,-739.1,187.4,-739.7,195.4,-740.2,203.3,-740.7,211.3,-741.2,219.3,-741.6,227.3,-742.1,235.3,-742.6,243.2,-743.1,251.2,-743.5,259.2,-744,267.2,-744.4,275.2,-744.9,283.2,-745.3,291.1,-745.8,299.1,-746.2,307.1,-746.6,315.1,-747.1,323.1,-747.5,331,-748,339,-748.5,347,-748.9,355,-749.5,363,-749.9,370.8,-751.4,377.3,-756,381.2,-762.8,383.3,-770.6,385.1,-778.3,387.7,-785.9,392.9,-791.8,400.4,-794.4,408.3,-796.1,416.2,-797.4,424,-798.8,431.9,-800.3,439.7,-801.8,447.5,-803.5,455.3,-805.4,463,-807.6,470.6,-810,478.2,-812.6,485.8,-815.2,493.3,-817.7,500.9,-820.2,508.5,-822.8,516.1,-825.3,523.7,-827.9,531.2,-830.5,538.8,-833.1,546.3,-835.7,553.9,-838.3,561.5,-840.8,569,-843.4,576.6,-846,584.2,-848.6,591.7,-851.2,599.3,-853.8,606.9,-856.4,614.4,-858.9,622,-861.5,629.6,-864.1,637.2,-866.6,644.7,-869.2,652.3,-871.7,659.9,-874.1,667.5,-876.6,675.2,-878.9,682.9,-881.1,690.7,-882.9,698.6,-883.6,706.6,-883.4,714.5,-882.3,722.3,-880.5,729.8,-877.6,736.8,-873.9,743.6,-869.6,750.2,-865.1,755.9,-859.6,761.2,-853.6,766,-847.2,769.9,-840.2,772.8,-832.7,774.7,-825,775.9,-817.1,776.8,-809.1,777.6,-801.2,778.3,-793.2,779,-785.3,779.7,-777.3,780.3,-769.3,781,-761.4,781.7,-753.4,782.4,-745.4,783.1,-737.5,783.8,-729.5,784.6,-721.5,785.4,-713.6,786.3,-705.6,787.1,-697.7,788,-689.7,788.8,-681.8,789.7,-673.8,790.6,-665.9,791.5,-658,792.3,-650,793.2,-642.1,794,-634.1,794.9,-626.2,795.7,-618.2,796.4,-610.2,797.2,-602.3,797.9,-594.3,798.4,-586.3,798.6,-578.3,798.1,-570.4,796,-562.7,792.7,-555.4,786.9,-550,780.4,-545.3,773.6,-541.1,766.6,-537.2,759.6,-533.3,752.6,-529.5,745.6,-525.7,738.5,-521.9,731.5,-518.1,724.4,-514.4,717.4,-510.6,710.3,-506.9,703.3,-503.1,696.2,-499.3,689.2,-495.6,682.1,-491.8,675.1,-488,668,-484.2,661,-480.4,654,-476.5,647,-472.7,640,-468.8,633,-464.9,626.1,-461,619.1,-457.1,612.1,-453.1,605.2,-449.2,598.2,-445.3,591.2,-441.4,584.3,-437.4,577.3,-433.5,570.3,-429.6,563.4,-425.7,556.4,-421.8,549.4,-417.9,542.4,-414.1,535.3,-410.2,528.3,-406.4,521.3,-402.6,514.3,-398.7,507.3,-394.8,500.4,-390.9,493.4,-387,486.4,-383.1,479.5,-379.1,472.7,-374.9,466,-370.6,459.4,-366,452.9,-361.4,446.4,-356.7,439.9,-352,433.5,-347.3,427.1,-342.5,420.8,-337.6,414.5,-332.6,408.5,-327.4,402.5,-322,396.6,-316.7,390.5,-311.5,384.4,-306.3,378.4,-301.1,372.3,-295.9,366.2,-290.7,360.1,-285.5,354,-280.3,347.9,-275.1,341.9,-269.9,335.8,-264.7,329.7,-259.5,323.6,-254.3,317.6,-249.1,311.5,-243.9,305.5,-238.7,299.4,-233.4,293.4,-228.2,287.4,-222.9,281.5,-217.6,275.5,-212.2,269.6,-206.8,263.7,-201.5,257.8,-196,251.9,-190.6,246,-185.2,240.1,-179.8,234.2,-174.4,228.3,-169.1,222.4,-163.7,216.4,-158.4,210.5,-153,204.5,-147.7,198.5,-142.4,192.5,-137.1,186.5,-131.8,180.5,-126.6,174.5,-121.3,168.5,-116,162.5,-110.7,156.5,-105.4,150.5,-100.2,144.5,-94.9,138.4,-89.6,132.4,-84.4,126.4,-79.1,120.4,-73.8,114.4,-68.6,108.4,-63.3,102.3,-58.1,96.3,-52.8,90.3,-47.5,84.3,-42.3,78.3,-37,72.3,-31.7,66.3,-26.5,60.3,-21.2,54.2,-15.9,48.2,-10.6,42.2,-5.4,36.2,-0.1,30.1,5.1,24.1,10.4,18.1,15.6,12.1,20.9,6,26.1,0,31.4,-6,36.6,-12,41.9,-18,47.2,-24,52.5,-29.9,57.9,-35.8,63.3,-41.6,68.8,-47.2,74.5,-52.1,80.8,-55,88.2,-55.5,96.1,-55.3,104.1,-54.2,112,-52.9,119.9,-51.9,127.9,-51.2,135.8,-51,143.8,-51,151.8,-51.7,159.8,-53.3,167.6,-55.8,175.2,-58.5,182.7,-61.5,190.1,-65.5,197,-70,203.6,-74.9,210,-80.1,216.1,-85.7,221.7,-91.8,226.9,-98,231.9,-104.5,236.7,-110.6,241.8,-115.6,248,-119.2,255.2,-121.6,262.8,-123.3,270.6,-124.7,278.5,-125.8,286.4,-126.9,294.3,-127.8,302.2,-128.7,310.2,-129.6,318.1,-130.5,326.1,-131.4,334,-132.3,342,-133.2,349.9,-134.1,357.8,-135.1,365.8,-136.1,373.7,-137.1,381.6,-138.1,389.6,-139,397.5,-140,405.4,-140.9,413.4,-141.9,421.3,-142.8,429.3,-143.7,437.2,-144.5,445.2,-145.4,453.1,-146.3,461.1,-147.1,469,-148,477,-148.8,484.9,-149.7,492.9,-150.5,500.8,-151.3,508.8,-152.2,516.7,-153,524.7,-153.8,532.6,-154.7,540.6,-155.5,548.5,-156.3,556.5,-157.1,564.4,-158,572.4,-158.8,580.3,-159.6,588.3,-160.4,596.2,-161.3,604.2,-162.1,612.1,-162.9,620.1,-163.7,628,-164.5,636,-165.4,644,-166.2,651.9,-167,659.9,-167.8,667.8,-168.6,675.8,-169.4,683.7,-170.3,691.7,-171.1,699.6,-171.9,707.6,-172.7,715.5,-173.5,723.5,-174.3,731.4,-175.1,739.4,-176,747.3,-176.8,755.3,-177.6,763.3,-178.4,771.2,-179.2,779.2,-180,787.1,-180.8,795.1,-181.6,803,-182.5,811,-183.3,818.9,-184.1,826.9,-184.9,834.8,-185.7,842.8,-186.5,850.7,-187.3,858.7,-188.1,866.7,-189,874.6,-189.8,882.6,-190.6,890.5,-191.4,898.5,-192.2,906.4,-193,914.4,-193.8,922.3,-194.6,930.3,-195.4,938.2,-196.3,946.2,-197.1,954.1,-197.9,962.1,-198.7,970.1,-199.5,978,-200.3,986,-201.1,993.9,-201.9,1001.9,-202.8,1009.8,-203.6,1017.8,-204.4,1025.7,-205.2,1033.7,-206,1041.6,-206.8,1049.6,-207.6,1057.5,-208.5,1065.5,-209.3,1073.5,-210.1,1081.4,-210.9,1089.4,-211.7,1097.3,-212.6,1105.3,-213.4,1113.2,-214.2,1121.2,-215,1129.1,-215.9,1137.1,-216.7,1145,-217.5,1153,-218.3,1160.9,-219.2,1168.9,-220,1176.8,-220.9,1184.8,-221.7,1192.7,-222.6,1200.7,-223.4,1208.6,-224.4,1216.6,-225.7,1224.4,-227.6,1232.2,-230.6,1239.6,-234.4,1246.7,-239.2,1253,-244.6,1258.9,-250.3,1264.5,-256.6,1269.5,-263.2,1274,-270.2,1277.8,-277.6,1280.7,-285.3,1282.9,-293.1,1284.7,-301,1285.7,-309,1285.6,-317,1284.6,-324.8,1283.1,-332.5,1281,-340,1278.3,-347.4,1275.2,-354.8,1272.1,-362,1268.7,-368.8,1264.5,-375.3,1259.8,-381.7,1255.1,-388,1250.2,-393.9,1244.7,-399.4,1238.9,-404.6,1232.9,-409.6,1226.6,-414.1,1220,-418.5,1213.3,-422.6,1206.5,-426.4,1199.4,-429.7,1192.2,-432.8,1184.8,-435.6,1177.3,-438.4,1169.8,-441.1,1162.3,-443.5,1154.7,-445.7,1147,-447.7,1139.2,-449.4,1131.4,-450.6,1123.5,-451.6,1115.6,-452.6,1107.6,-453.5,1099.7,-454.4,1091.8,-454.9,1083.8,-455.2,1075.8,-455.3,1067.8,-455.3,1059.8,-455.4,1051.8,-455.5,1043.8,-455.6,1035.8,-455.8,1027.8,-456,1019.8,-456.2,1011.8,-456.4,1003.8,-456.6,995.9,-456.8,987.9,-457,979.9,-457.2,971.9,-457.4,963.9,-457.6,955.9,-457.8,947.9,-458,939.9,-458.1,931.9,-458.1,923.9,-458.1,915.9,-458.1,907.9,-458,899.9,-457.9,891.9,-457.7,883.9,-457.3,876,-456.9,868,-456.4,860,-455.8,852,-455.1,844.1,-454.3,836.1,-453.5,828.1,-452.8,820.2,-452,812.2,-451.2,804.3,-450.4,796.3,-449.7,788.4,-448.9,780.4,-448.1,772.4,-447.3,764.5,-446.5,756.5,-445.7,748.6,-444.9,740.6,-444.1,732.7,-443.3,724.7,-442.5,716.8,-441.7,708.8,-440.8,700.9,-440,692.9,-439.2,684.9,-438.4,677,-437.5,669,-436.7,661.1,-435.8,653.1,-435,645.2,-434.2,637.2,-433.3,629.3,-432.4,621.3,-431.6,613.4,-430.7,605.4,-429.8,597.5,-428.9,589.6,-428,581.6,-427.1,573.7,-426.1,565.7,-425,557.8,-424,549.9,-422.9,542,-421.9,534,-420.8,526.1,-419.9,518.2,-418.9,510.2,-418,502.3],
  silverstone: [68.9,-780.4,76.9,-781.1,84.9,-781.8,92.8,-782.6,100.8,-783.4,108.7,-784.1,116.7,-784.9,124.6,-785.7,132.6,-786.5,140.6,-787.3,148.5,-788.1,156.5,-788.9,164.4,-789.7,172.4,-790.4,180.3,-791.2,188.3,-791.9,196.3,-792.7,204.2,-793.4,212.2,-794,220.2,-794.7,228.1,-795.3,236.1,-795.8,244.1,-796.2,252.1,-796.5,260.1,-796.6,268.1,-796.6,276.1,-796.3,284,-795.4,291.9,-793.9,299.6,-791.8,307.1,-789.2,314.4,-786,321.4,-782.1,327.9,-777.5,333.9,-772.2,339.5,-766.4,344.6,-760.3,349.4,-753.9,353.6,-747.1,357.2,-739.9,360.4,-732.6,363.3,-725.2,366,-717.6,368.3,-710,370.5,-702.3,372.7,-694.6,374.8,-686.9,376.8,-679.2,378.8,-671.4,380.7,-663.7,382.6,-655.9,384.5,-648.1,386.5,-640.4,388.5,-632.6,390.6,-624.9,392.8,-617.3,395,-609.6,397.1,-601.9,399.1,-594.1,401,-586.3,402.6,-578.5,404,-570.6,405.2,-562.7,406.3,-554.8,407.4,-546.9,408.3,-539,409.2,-531,410.2,-523.1,411.1,-515.1,411.9,-507.2,412.7,-499.2,413.4,-491.3,414,-483.3,414.6,-475.3,415.1,-467.3,415.5,-459.4,416,-451.4,416.4,-443.4,416.8,-435.4,417.2,-427.4,417.6,-419.4,418,-411.4,418.3,-403.5,418.7,-395.5,419,-387.5,419.2,-379.5,419.4,-371.5,419.6,-363.5,419.7,-355.5,419.8,-347.5,420,-339.5,420.1,-331.5,420.3,-323.5,420.7,-315.6,421.1,-307.6,421.6,-299.6,422.2,-291.6,423.3,-283.7,425.2,-276,427.9,-268.4,431.1,-261.1,434.5,-253.9,438,-246.7,441.9,-239.7,445.8,-232.7,449.9,-225.8,453.8,-218.9,457.5,-211.8,461,-204.6,464.4,-197.3,467,-189.8,468,-181.9,467.5,-173.9,466.5,-166,465.1,-158.1,463.1,-150.4,460.6,-142.8,457.8,-135.3,454.7,-127.9,451.7,-120.5,448.6,-113.2,445.5,-105.8,442.4,-98.4,439.5,-91,436.7,-83.5,434.1,-75.9,431.9,-68.3,430.3,-60.4,429.4,-52.5,429,-44.5,429.2,-36.5,429.8,-28.5,431,-20.6,432.9,-12.9,435.7,-5.4,439.4,1.7,443.6,8.5,448,15.2,452.7,21.6,457.6,28,462.5,34.3,467.3,40.7,471.9,47.2,476.2,54,479.7,61.1,482.5,68.6,484.3,76.4,485.2,84.3,485.3,92.3,484.7,100.3,483.5,108.2,481.4,115.9,477.9,123.1,473.4,129.7,468.3,135.8,462.7,141.6,456.8,147,450.5,151.8,443.8,156.2,437.1,160.5,430.3,164.8,423.4,168.8,416.4,172.8,409.5,176.7,402.6,180.7,395.6,184.6,388.6,188.4,381.7,192.5,375.2,197.2,369.1,202.4,363.5,208.1,358.4,214.2,353.8,220.7,349.7,227.6,345.7,234.5,341.9,241.6,338,248.5,334.1,255.5,330.3,262.6,326.6,269.6,322.8,276.7,319.1,283.8,315.4,290.8,311.7,297.9,308,305,304.2,312.1,300.5,319.1,296.7,326.2,292.9,333.2,289.1,340.3,285.4,347.3,281.6,354.4,277.8,361.4,274.1,368.5,270.3,375.5,266.5,382.6,262.8,389.6,259,396.7,255.3,403.7,251.5,410.8,247.8,417.9,244,424.9,240.2,432,236.5,439,232.7,446.1,228.9,453.1,225.2,460.2,221.4,467.2,217.7,474.3,213.9,481.3,210.1,488.4,206.3,495.4,202.6,502.5,198.8,509.5,195,516.6,191.2,523.6,187.5,530.7,183.7,537.7,179.9,544.8,176.1,551.8,172.3,558.8,168.5,565.9,164.7,572.9,160.9,579.9,157.1,587,153.3,594,149.5,601,145.7,608.1,141.9,615.1,138,622.1,134.2,629.1,130.4,636.1,126.5,643.1,122.7,650.1,118.8,657.1,114.9,664.1,111.1,671.1,107.2,678.1,103.3,685.1,99.4,692.1,95.5,699.1,91.5,706,87.6,713,83.6,719.9,79.7,726.8,75.6,733.8,71.6,740.7,67.5,747.5,63.4,754.4,59.3,761.2,55.1,768.1,51,774.9,46.7,781.7,42.5,788.4,38.2,795.2,33.9,801.9,29.6,808.7,25.2,815.3,20.8,822,16.4,828.7,11.9,835.3,7.5,842,3,848.6,-1.6,855.2,-6.1,861.7,-10.6,868.3,-15.2,874.9,-20,881.3,-25.2,887.4,-30.7,893.2,-36.6,898.6,-43,903.3,-49.8,907.5,-57,910.9,-64.5,913.9,-72.1,916.3,-79.9,918,-87.9,918.5,-95.8,917.8,-103.7,916.6,-111.6,915.1,-119.3,913.2,-126.9,910.7,-134.3,907.7,-141.4,904,-148,899.5,-154.1,894.4,-159.5,888.4,-164,881.9,-168.2,875,-172.1,868.1,-175.6,860.9,-178.9,853.6,-182.1,846.3,-185.4,839,-188.7,831.7,-192.1,824.5,-195.7,817.3,-199.5,810.3,-203.3,803.3,-207.3,796.3,-211.4,789.5,-215.6,782.7,-220,776,-224.7,769.5,-229.5,763.1,-234.4,756.8,-239.3,750.5,-244.3,744.3,-249.4,738.1,-254.5,732,-259.8,726,-265.1,720,-270.5,714.1,-275.9,708.2,-281.5,702.5,-287.2,696.8,-292.8,691.2,-298.5,685.6,-304,679.8,-309.4,673.9,-314.7,667.9,-319.9,661.8,-325,655.6,-330,649.4,-335,643.2,-340,637,-345.1,630.7,-350.1,624.5,-355.1,618.3,-360.1,612.1,-365.2,605.9,-370.3,599.8,-375.6,593.7,-381,587.9,-387.3,583,-394.9,580.7,-402.8,581.5,-409.8,585.4,-415.9,590.5,-421.7,596.1,-427.3,601.7,-433.1,607.2,-439.2,612.4,-446.3,616,-454.2,617.1,-462.1,615.9,-469.5,613,-475.7,608,-481.3,602.3,-487,596.6,-492.6,591,-497.9,585,-503,578.8,-507.8,572.4,-512.4,565.9,-516.5,559,-520.2,551.9,-523.6,544.7,-526.8,537.4,-529.6,529.9,-532.1,522.3,-534.5,514.7,-536.8,507,-538.9,499.3,-540.7,491.5,-541.9,483.6,-541.6,475.6,-539.9,467.8,-536.2,460.8,-532,454,-527.9,447.1,-523.6,440.4,-519.1,433.8,-514.5,427.3,-509.8,420.8,-505,414.4,-500.2,407.9,-495.5,401.5,-490.7,395.2,-485.8,388.8,-481,382.4,-476.2,376,-471.3,369.7,-466.5,363.3,-461.6,357,-456.8,350.6,-451.9,344.3,-447,337.9,-442.2,331.6,-437.3,325.3,-432.4,318.9,-427.5,312.6,-422.6,306.3,-417.8,299.9,-412.9,293.6,-408,287.3,-403.1,280.9,-398.2,274.6,-393.3,268.3,-388.4,262,-383.5,255.7,-378.6,249.3,-373.7,243,-368.8,236.7,-363.9,230.4,-359,224.1,-354.1,217.8,-349.2,211.4,-344.3,205.1,-339.4,198.8,-334.5,192.5,-329.6,186.2,-324.7,179.9,-319.8,173.5,-314.9,167.2,-310,160.9,-305.1,154.6,-300.2,148.3,-295.3,141.9,-290.5,135.6,-285.6,129.3,-280.7,122.9,-275.8,116.6,-270.9,110.3,-266,104,-261.1,97.6,-256.2,91.3,-251.3,85.1,-246.3,78.8,-241.3,72.6,-235.9,66.7,-229.7,61.6,-223.1,57.2,-215.9,53.6,-208.3,51.2,-200.5,49.6,-192.6,48.5,-184.6,48.2,-176.6,48.3,-168.6,48.7,-160.7,49.5,-152.7,50.4,-144.8,51.4,-136.9,52.6,-129,53.8,-121.1,55.1,-113.2,56.3,-105.3,57.6,-97.4,58.8,-89.5,60.1,-81.6,61.2,-73.6,62.2,-65.7,63.1,-57.7,63.8,-49.8,64.4,-41.8,64.6,-33.8,64.2,-25.8,63.4,-18,62.1,-10.1,60.6,-2.3,59.1,5.5,57.2,13.1,54.6,20.4,51.4,27.3,47.5,34.1,43.1,40.6,38.5,47,33.8,53.4,28.9,59.7,24,66,19.1,72.3,14.1,78.5,9.1,84.7,4.1,91,-0.9,97.2,-5.9,103.4,-11,109.6,-16,115.8,-21.1,122,-26.1,128.2,-31.2,134.4,-36.2,140.6,-41.3,146.8,-46.3,153,-51.4,159.2,-56.4,165.4,-61.4,171.7,-66.3,178.1,-71.2,184.6,-75.7,191.5,-79.8,198.8,-82.9,206.7,-84,214.6,-82.6,221.5,-78.6,227,-72.9,231.1,-66.1,233.9,-58.6,236.1,-50.9,238.2,-43.2,240.2,-35.4,242.2,-27.7,244.2,-19.9,246.2,-12.2,248.2,-4.5,250.4,3.2,252.6,10.9,255.2,18.5,258.6,25.7,263.3,32.1,269.3,37.4,276.7,40.2,284.7,40,292.3,37.6,299,33.3,304,27.1,308,20.2,311.2,12.9,314.1,5.4,316.9,-2.1,319.5,-9.6,322.2,-17.2,324.8,-24.7,327.4,-32.3,329.9,-39.9,332.1,-47.6,334.1,-55.3,335.8,-63.1,337.1,-71,338.2,-78.9,339.1,-86.9,340,-94.8,340.7,-102.8,340.9,-110.8,340.7,-118.8,340.2,-126.7,338.6,-134.6,335.4,-141.9,330.8,-148.4,325.3,-154.2,319.6,-159.8,313.9,-165.4,308.2,-171,302.4,-176.5,296.6,-182,290.8,-187.5,285,-193,279.2,-198.5,273.3,-204,267.5,-209.4,261.7,-214.9,255.8,-220.4,250,-225.8,244.1,-231.3,238.3,-236.7,232.4,-242.2,226.6,-247.6,220.7,-253,214.9,-258.5,209,-263.9,203.1,-269.3,197.3,-274.8,191.4,-280.2,185.5,-285.6,179.6,-291,173.8,-296.5,167.9,-301.9,162,-307.3,156.1,-312.7,150.3,-318.1,144.4,-323.5,138.5,-329,132.6,-334.4,126.7,-339.8,120.8,-345.2,114.9,-350.6,109,-356,103.1,-361.4,97.3,-366.8,91.4,-372.2,85.5,-377.6,79.6,-383,73.7,-388.4,67.8,-393.8,61.9,-399.2,56,-404.6,50,-410,44.1,-415.3,38.2,-420.7,32.3,-426.1,26.4,-431.5,20.5,-436.9,14.6,-442.2,8.7,-447.6,2.7,-453,-3.2,-458.4,-9.1,-463.7,-15,-469.1,-21,-474.4,-26.9,-479.8,-32.8,-485.2,-38.8,-490.5,-44.7,-495.9,-50.7,-501.2,-56.6,-506.5,-62.6,-511.9,-68.5,-517.2,-74.5,-522.5,-80.5,-527.9,-86.4,-533.2,-92.4,-538.5,-98.4,-543.8,-104.4,-549,-110.4,-554.3,-116.5,-559.6,-122.5,-564.8,-128.6,-570,-134.8,-575.1,-141,-580,-147.7,-584.5,-154.7,-588.3,-161.6,-592.3,-168.9,-595.6,-176.6,-597.6,-184.5,-598.7,-192.5,-599,-200.5,-598.7,-208.4,-597.6,-216.1,-595.6,-223.6,-592.6,-230.7,-589,-237.2,-584.4,-242.4,-578.3,-246.3,-571.4,-249,-563.9,-250.8,-556.1,-252,-548.2,-252.9,-540.2,-253.7,-532.3,-254.4,-524.3,-255.2,-516.4,-255.9,-508.4,-256.7,-500.4,-257.7,-492.5,-259,-484.6,-260.9,-476.9,-263.9,-469.5,-268.4,-462.9,-274,-457.2,-280.6,-452.7,-287.8,-449.3,-295.4,-446.8,-303.2,-445.2,-311.2,-444.9,-319.1,-446,-326.8,-448.2,-334.2,-451.3,-340.9,-455.5,-347.1,-460.7,-352.2,-466.8,-356.5,-473.5,-360.4,-480.5,-362.9,-488,-363.6,-496,-363.2,-504,-361.7,-511.8,-359.4,-519.5,-356.3,-526.8,-352.8,-534.1,-349.4,-541.3,-346,-548.5,-342.6,-555.8,-339.2,-563,-335.8,-570.2,-332.3,-577.4,-328.9,-584.6,-325.4,-591.8,-321.9,-599,-318.4,-606.2,-314.9,-613.4,-311.3,-620.5,-307.6,-627.6,-303.9,-634.7,-300.1,-641.8,-296.3,-648.8,-292.2,-655.6,-287.8,-662.3,-283,-668.7,-277.6,-674.6,-272.1,-680.4,-266.7,-686.3,-261.1,-692.1,-255.5,-697.7,-249.6,-703.1,-243.7,-708.5,-237.7,-713.8,-231.6,-718.9,-225.3,-723.9,-219,-728.8,-212.5,-733.5,-205.8,-737.8,-198.7,-741.5,-191.4,-744.7,-184,-747.6,-176.5,-750.4,-169,-753.3,-161.4,-755.9,-153.7,-758,-145.9,-759.6,-138,-760.8,-130.1,-761.8,-122.1,-762.6,-114.1,-763.4,-106.2,-764.2,-98.2,-765,-90.3,-765.9,-82.3,-766.7,-74.4,-767.5,-66.4,-768.2,-58.5,-769,-50.5,-769.7,-42.5,-770.4,-34.6,-771.2,-26.6,-771.9,-18.7,-772.6,-10.7,-773.3,-2.7,-774,5.2,-774.7,13.2,-775.4,21.2,-776.1,29.1,-776.8,37.1,-777.5,45.1,-778.2,53,-778.9,61,-779.6],
  spa: [-258.6,-1067,-262.6,-1073.9,-266.6,-1080.9,-270.6,-1087.8,-274.7,-1094.7,-278.7,-1101.6,-282.8,-1108.5,-286.9,-1115.3,-290.9,-1122.2,-295,-1129.1,-299.1,-1136,-303.2,-1142.9,-307.3,-1149.7,-311.4,-1156.6,-315.5,-1163.5,-319.5,-1170.4,-323.6,-1177.2,-327.7,-1184.1,-331.7,-1191,-335.8,-1197.9,-339.8,-1204.8,-343.8,-1211.8,-347.8,-1218.7,-351.8,-1225.7,-355.7,-1232.6,-359.5,-1239.6,-363.3,-1246.7,-367,-1253.8,-370.4,-1261,-373.1,-1268.6,-372.4,-1276.4,-367.4,-1282.5,-360,-1285.4,-352.1,-1284.7,-344.6,-1281.8,-337.4,-1278.5,-330.3,-1274.8,-323.2,-1271.1,-316.1,-1267.3,-309,-1263.7,-301.8,-1260.3,-294.5,-1256.8,-287.3,-1253.4,-280,-1250.1,-272.8,-1246.7,-265.5,-1243.4,-258.3,-1240,-251,-1236.6,-243.8,-1233.1,-236.6,-1229.6,-229.5,-1226.1,-222.3,-1222.4,-215.3,-1218.6,-208.3,-1214.7,-201.4,-1210.6,-194.6,-1206.4,-187.9,-1202.2,-181.2,-1197.8,-174.5,-1193.3,-167.9,-1188.8,-161.4,-1184.1,-154.9,-1179.4,-148.5,-1174.7,-142.2,-1169.8,-135.8,-1164.9,-129.5,-1160,-123.2,-1155,-117,-1150.1,-110.7,-1145.1,-104.6,-1140,-98.5,-1134.8,-92.5,-1129.4,-86.7,-1123.9,-81.1,-1118.3,-75.6,-1112.5,-70.2,-1106.5,-65,-1100.5,-59.7,-1094.4,-54.4,-1088.4,-49.2,-1082.4,-44,-1076.3,-38.9,-1070.2,-33.7,-1064,-28.6,-1057.9,-23.5,-1051.8,-18.3,-1045.6,-13.2,-1039.5,-8.1,-1033.3,-3,-1027.1,2.1,-1021,7.2,-1014.8,12.3,-1008.7,17.4,-1002.5,22.5,-996.3,27.6,-990.2,32.7,-984,37.8,-977.8,42.9,-971.7,48,-965.5,53.1,-959.3,58.2,-953.2,63.3,-947,68.4,-940.9,73.5,-934.7,78.6,-928.6,83.8,-922.4,88.9,-916.3,94.1,-910.2,99.3,-904.1,104.5,-898,109.7,-892,115,-886,120.5,-880.2,126.3,-874.7,132.7,-869.9,139.5,-865.7,146.4,-861.7,153.2,-857.4,160.1,-853.3,166.9,-849.1,173.7,-844.9,180.3,-840.5,186.8,-835.7,192.9,-830.6,198.6,-825,203.8,-818.9,208.5,-812.4,212.7,-805.6,216.6,-798.6,220.3,-791.5,223.6,-784.2,226.4,-776.7,228.8,-769.1,230.8,-761.4,232.4,-753.5,233.5,-745.6,234.4,-737.7,235.3,-729.7,236.1,-721.7,237.1,-713.8,238.4,-705.9,240.2,-698.1,242.7,-690.5,245.9,-683.2,249.6,-676.1,253.6,-669.2,257.6,-662.3,261.8,-655.4,265.9,-648.6,270.2,-641.8,274.4,-635,278.6,-628.2,282.9,-621.4,287.1,-614.7,291.4,-607.9,295.6,-601.1,299.9,-594.3,304.2,-587.6,308.4,-580.8,312.7,-574.1,317,-567.3,321.3,-560.5,325.5,-553.8,329.8,-547,334.1,-540.2,338.3,-533.4,342.6,-526.7,346.8,-519.9,351.1,-513.2,355.5,-506.4,359.8,-499.7,364.2,-493,368.5,-486.3,372.8,-479.5,377.1,-472.8,381.4,-466,385.6,-459.2,389.7,-452.3,393.6,-445.4,397.4,-438.3,400.9,-431.2,404.3,-423.9,407.4,-416.5,410.6,-409.2,413.7,-401.8,416.7,-394.4,419.4,-386.9,421.9,-379.3,424.2,-371.6,426.3,-363.9,428.5,-356.2,430.7,-348.5,432.9,-340.8,435.1,-333.1,437.3,-325.4,439.5,-317.7,441.7,-310.1,443.9,-302.4,446.1,-294.7,448.3,-287,450.5,-279.3,452.7,-271.6,454.9,-263.9,457.1,-256.2,459.3,-248.5,461.5,-240.8,463.7,-233.1,465.9,-225.4,468.1,-217.8,470.3,-210.1,472.5,-202.4,474.7,-194.7,476.9,-187,479.1,-179.3,481.3,-171.6,483.5,-163.9,485.7,-156.2,487.9,-148.5,490.1,-140.8,492.3,-133.2,494.5,-125.5,496.8,-117.8,499,-110.1,501.2,-102.4,503.4,-94.7,505.6,-87,507.8,-79.3,510.1,-71.7,512.3,-64,514.5,-56.3,516.7,-48.6,519,-40.9,521.2,-33.2,523.4,-25.6,525.7,-17.9,527.9,-10.2,530.1,-2.5,532.3,5.2,534.6,12.9,536.8,20.5,539,28.2,541.3,35.9,543.5,43.6,545.7,51.3,548,58.9,550.2,66.6,552.4,74.3,554.7,82,556.9,89.7,559.1,97.4,561.4,105,563.6,112.7,565.8,120.4,568,128.1,570.3,135.8,572.5,143.5,574.7,151.1,577,158.8,579.2,166.5,581.4,174.2,583.6,181.9,585.8,189.6,588.1,197.3,590.3,204.9,592.5,212.6,594.7,220.3,596.9,228,599.1,235.7,601.3,243.4,603.5,251.1,605.7,258.8,607.9,266.5,610.2,274.1,612.4,281.8,614.7,289.5,617,297.2,619.2,304.8,621.4,312.5,623.6,320.2,625.6,328,627.5,335.7,628.9,343.6,629.6,351.6,629.2,359.6,627.8,367.4,624.4,374.7,619.7,381.1,614.1,386.8,607.9,391.8,601,395.8,593.8,399.4,587.3,404.1,581.9,409.9,577.4,416.5,574,423.8,571.4,431.3,570.2,439.2,570.6,447.2,571.8,455.1,573.4,462.9,575.1,470.7,577,478.5,578.9,486.3,580.9,494.1,582.8,501.8,584.7,509.6,586.6,517.4,588.4,525.1,590.1,533,591.6,540.8,592.5,548.8,592.4,556.8,591.5,564.7,590,572.6,586.9,579.9,582.5,586.6,577.3,592.7,571.5,598.1,565.1,602.9,558.6,607.7,552.2,612.4,545.7,617.1,539.2,621.8,532.7,626.5,526.2,631.1,519.7,635.8,513.2,640.4,506.7,645,500.1,649.7,493.6,654.3,487.1,658.9,480.5,663.5,474,668.1,467.4,672.7,460.9,677.3,454.3,681.9,447.8,686.5,441.2,691.1,434.7,695.6,428.1,700.2,421.5,704.8,414.9,709.3,408.3,713.8,401.8,718.4,395.2,722.9,388.6,727.4,381.9,731.9,375.3,736.4,368.7,740.9,362,745.3,355.4,749.8,348.7,754.2,342,758.5,335.2,762.8,328.4,767,321.4,770.9,314.2,774.2,306.4,776,298.4,776.2,290.5,775.1,282.8,772.9,275.6,769.5,269,764.9,263.4,759.2,258.8,752.7,255.3,745.5,253.3,737.7,252,729.8,251.7,721.9,253.2,714,256.2,706.6,259.8,699.5,264.2,692.8,269.9,687.2,276.4,682.5,283,678.1,289.8,673.8,296.6,669.7,303.5,665.6,310.4,661.5,317.3,657.4,324.1,653.4,331,649.3,337.9,645.2,344.8,641.1,351.6,637,358.5,632.8,365.3,628.6,372,624.3,378.6,619.7,384.8,614.7,390.4,609,395.1,602.5,398.6,595.4,400.7,587.7,401.6,579.7,401.4,571.7,400.2,563.8,398.2,556.1,395.9,548.4,393.4,540.8,390.8,533.3,388.2,525.7,385.5,518.2,382.8,510.6,380.1,503.1,377.3,495.6,374.6,488.1,371.9,480.6,369.2,473,366.5,465.5,363.8,458,361.2,450.4,358.7,442.8,356.4,435.1,354.1,427.5,352,419.8,349.9,412,348,404.3,346.1,396.5,344.4,388.7,342.6,380.9,340.9,373,339.3,365.2,337.7,357.4,336.1,349.5,334.6,341.7,333,333.8,331.5,326,330,318.1,328.5,310.3,327.1,302.4,325.6,294.5,324.1,286.7,322.7,278.8,321.2,270.9,319.8,263.1,318.4,255.2,316.9,247.3,315.5,239.4,314.1,231.6,312.7,223.7,311.3,215.8,310,207.9,308.7,200,307.4,192.1,306.2,184.2,304.9,176.3,303.7,168.4,302.4,160.5,301.2,152.6,299.9,144.7,298.5,136.9,297.1,129,295.5,121.1,293,113.6,289.7,106.3,285.8,99.3,281.2,92.7,276.1,86.6,270.6,80.8,264.7,75.3,258.5,70.3,251.9,65.8,244.9,61.9,237.7,58.5,230.2,55.7,222.5,53.6,214.6,52.3,206.6,51.4,198.7,50.6,190.7,49.8,182.7,49.1,174.8,48.5,166.8,48,158.8,47.5,150.8,47.3,142.8,47.4,134.8,47.9,126.9,48.9,119,50.4,111.3,52.3,103.6,54.7,96.1,57.3,88.6,60.2,81.3,63.5,74.2,67.2,67.5,71.5,61,76.2,54.8,81.2,48.7,86.4,42.9,91.9,37.5,97.8,32.5,104.1,28.1,110.8,24,117.6,19.9,124.5,16.1,131.5,12.6,138.7,9.2,146,6,153.3,2.8,160.6,-0.2,168,-3.3,175.4,-6.3,182.8,-9.2,190.3,-12.2,197.7,-15.1,205.2,-18,212.6,-20.9,220.1,-23.8,227.5,-26.7,235,-29.6,242.4,-32.5,249.9,-35.4,257.3,-38.4,264.8,-41.3,272.2,-44.2,279.7,-47.2,287.1,-50.1,294.5,-53.1,302,-56,309.4,-58.9,316.9,-61.9,324.3,-64.8,331.8,-67.7,339.2,-70.6,346.7,-73.5,354.1,-76.4,361.6,-79.3,369,-82.3,376.5,-85.2,383.9,-88.2,391.3,-91.2,398.7,-94.3,406.1,-97.4,413.5,-100.7,420.8,-104.1,428,-107.7,435.2,-111.8,442,-116.6,448.4,-122.1,454.2,-128.2,459.4,-134.9,463.7,-142,467.4,-149.4,470.4,-157.1,472.6,-165,474.1,-172.9,474.8,-180.9,474.5,-188.8,473.3,-196.6,471.3,-204.1,468.4,-211.2,464.8,-218,460.7,-224.7,456.2,-231.3,451.7,-238.2,447.6,-245.4,444.2,-252.9,441.5,-260.7,439.6,-268.6,438.6,-276.6,438.4,-284.5,439.2,-292.4,440.7,-300.2,442.7,-307.6,445.5,-314.7,449.3,-321.1,454,-326.9,459.5,-331.7,465.9,-336.5,472.3,-341.3,478.7,-345.8,485.3,-350.2,492,-354.5,498.8,-358.8,505.5,-363,512.3,-367.2,519.1,-371.4,525.9,-375.6,532.8,-379.8,539.6,-384,546.4,-388.2,553.2,-392.4,560,-396.6,566.8,-400.8,573.6,-405,580.4,-409.3,587.2,-413.5,594,-417.8,600.7,-422.1,607.5,-426.5,614.2,-430.9,620.8,-435.4,627.5,-440,634,-445.2,640.1,-451.2,645.3,-458,649.6,-465.3,652.7,-473.1,654.7,-481,655.5,-489,655.2,-496.8,653.5,-504,650.1,-510.9,646,-517.6,641.6,-524.1,636.9,-530.6,632.2,-537,627.5,-543.4,622.7,-549.8,617.8,-556.2,613,-562.5,608.2,-568.9,603.4,-575.4,598.7,-581.9,594.1,-588.5,589.5,-595.1,585,-601.6,580.3,-607.9,575.4,-613.7,569.9,-618.6,563.6,-623.1,557,-627.7,550.4,-631.8,543.6,-635,536.2,-637.6,528.7,-639.8,521,-641.3,513.1,-642.2,505.2,-642.4,497.2,-642,489.2,-641.1,481.3,-639.5,473.4,-637.1,465.8,-634.2,458.4,-631.3,450.9,-628.5,443.4,-625.7,435.9,-623,428.4,-620.4,420.8,-617.8,413.2,-615.2,405.7,-612.2,398.3,-608.8,391,-605.2,383.9,-601.4,376.8,-597.4,369.9,-593.3,363,-589.1,356.2,-584.8,349.5,-580.4,342.8,-575.8,336.2,-571.1,329.8,-566.3,323.4,-561.3,317.1,-556.2,310.9,-551,304.9,-545.7,298.9,-540.4,292.9,-534.9,287.1,-529.4,281.3,-523.9,275.5,-518.4,269.7,-512.8,264,-507.2,258.3,-501.5,252.6,-495.8,247,-490.1,241.4,-484.4,235.8,-478.6,230.3,-472.7,224.9,-466.8,219.5,-460.8,214.2,-454.7,209,-448.5,203.9,-442.2,199,-435.8,194.2,-429.3,189.5,-422.7,185.1,-415.9,180.8,-409,176.8,-402,173,-394.9,169.1,-387.9,165.3,-380.8,161.6,-373.8,157.8,-366.7,154.1,-359.6,150.5,-352.5,146.8,-345.3,143.1,-338.2,139.5,-331.1,135.8,-324,132.2,-316.9,128.6,-309.7,124.9,-302.6,121.3,-295.5,117.6,-288.4,114,-281.3,110.3,-274.2,106.6,-267.1,102.9,-260,99.2,-252.9,95.5,-245.8,91.7,-238.8,87.9,-231.8,84,-224.9,80,-218.1,75.8,-211.4,71.4,-204.9,66.7,-198.5,61.9,-192.3,56.9,-186.2,51.7,-180.2,46.5,-174.3,41,-168.6,35.4,-163.2,29.5,-158,23.4,-153,17.2,-148,10.9,-143,4.7,-138.2,-1.7,-133.6,-8.3,-129.4,-15.1,-125.4,-22,-121.6,-29,-117.9,-36.1,-114.2,-43.2,-110.7,-50.4,-107.2,-57.6,-103.8,-64.9,-100.6,-72.2,-97.4,-79.5,-94.1,-86.8,-90.8,-94.1,-87.5,-101.4,-84.2,-108.6,-80.8,-115.9,-77.5,-123.2,-74.2,-130.5,-70.9,-137.8,-67.6,-145,-64.3,-152.3,-61,-159.6,-57.8,-167,-54.7,-174.3,-51.6,-181.7,-48.7,-189.2,-46.2,-196.8,-44.1,-204.5,-42.5,-212.3,-41.4,-220.3,-40.8,-228.2,-40.5,-236.2,-40.7,-244.2,-41.5,-252.2,-42.8,-260.1,-44.7,-267.8,-47.1,-275.5,-49.8,-283,-52.7,-290.5,-55.7,-297.9,-58.8,-305.3,-61.8,-312.7,-64.9,-320.1,-67.8,-327.5,-70.7,-334.9,-73.6,-342.4,-76.5,-349.9,-79.4,-357.3,-82.3,-364.8,-85.1,-372.3,-88,-379.7,-90.9,-387.2,-93.7,-394.7,-96.5,-402.2,-99.4,-409.6,-102.3,-417.1,-105.2,-424.6,-108.1,-432,-110.9,-439.5,-113.8,-447,-116.6,-454.4,-119.4,-462,-122.1,-469.5,-124.7,-477,-127.1,-484.7,-129.3,-492.4,-131.3,-500.1,-133,-507.9,-134.8,-515.7,-136.5,-523.5,-138.2,-531.4,-139.7,-539.2,-141.2,-547.1,-142.5,-555,-143.6,-562.9,-144.7,-570.8,-145.6,-578.8,-146.6,-586.7,-147.5,-594.6,-148.3,-602.6,-149,-610.6,-149.7,-618.5,-150.4,-626.5,-151.1,-634.5,-151.8,-642.5,-152.4,-650.4,-153.1,-658.4,-153.7,-666.4,-154.4,-674.3,-155,-682.3,-155.6,-690.3,-156.2,-698.3,-156.8,-706.3,-157.3,-714.2,-157.8,-722.2,-158.2,-730.2,-158.5,-738.2,-158.7,-746.2,-158.3,-754.2,-155.6,-761.6,-149.5,-766.6,-141.6,-767.8,-133.7,-766.4,-125.8,-765.5,-117.8,-765.4,-109.8,-766.1,-102.4,-768.9,-97.4,-775,-95.7,-782.7,-97.9,-790.4,-101.5,-797.5,-105.4,-804.5,-109.5,-811.3,-113.7,-818.1,-118,-824.9,-122.2,-831.7,-126.5,-838.4,-130.8,-845.2,-135,-852,-139.3,-858.8,-143.5,-865.6,-147.6,-872.4,-151.7,-879.3,-155.8,-886.2,-159.8,-893.1,-163.8,-900,-167.8,-907,-171.8,-913.9,-175.8,-920.8,-179.7,-927.8,-183.7,-934.7,-187.7,-941.7,-191.6,-948.6,-195.6,-955.6,-199.5,-962.6,-203.4,-969.5,-207.4,-976.5,-211.3,-983.5,-215.2,-990.4,-219.2,-997.4,-223.1,-1004.4,-227,-1011.3,-231,-1018.3,-234.9,-1025.3,-238.8,-1032.2,-242.8,-1039.2,-246.7,-1046.1,-250.7,-1053.1,-254.6,-1060],
  monaco: [-327.1,194.1,-327.4,186.1,-327.6,178.1,-327.6,170.1,-327.4,162.1,-327.2,154.1,-326.8,146.1,-326.4,138.1,-325.8,130.1,-325.1,122.1,-324.4,114.1,-323.3,106.2,-321.7,98.4,-319.5,90.7,-317.2,83,-314.6,75.5,-312.1,67.9,-310,60.1,-308.5,52.3,-308.4,44.3,-308.9,36.3,-309.3,28.3,-305.2,21.7,-297.8,18.7,-290.1,16.6,-282.2,15.1,-274.3,14.7,-266.3,14.4,-258.3,13.5,-250.4,12.4,-242.4,11.5,-234.5,10.5,-226.5,9.5,-218.6,8.4,-210.7,7.3,-202.8,6,-194.9,4.4,-187.2,2.6,-179.4,0.5,-171.7,-1.8,-164.1,-4.1,-156.4,-6.4,-148.8,-8.8,-141.1,-11.1,-133.5,-13.4,-125.8,-15.7,-118.1,-17.9,-110.4,-20.1,-102.7,-22.3,-95,-24.3,-87.1,-26.1,-79.3,-27.6,-71.4,-28.9,-63.5,-30.1,-55.5,-31.1,-47.5,-31.6,-39.6,-32,-31.7,-33.3,-24,-35.7,-16.7,-38.8,-9.3,-42,-2.1,-45.4,5.1,-48.9,12.3,-52.4,19.5,-55.9,26.7,-59.4,34,-62.8,41.3,-66.1,48.6,-69.3,56.1,-72.2,63.7,-74.6,71.5,-76.5,79.3,-78.2,87.1,-79.7,95,-81.1,102.9,-82.3,110.9,-83.3,118.8,-84.4,126.7,-85.6,134.6,-86.7,142.5,-88.1,150.3,-90.1,157.9,-92.7,165.1,-96.1,172,-100.2,178.5,-104.8,184.5,-110.1,190,-115.9,195.2,-122,199.9,-128.5,203.8,-135.4,206.5,-143,208,-150.8,207.9,-158.8,207.1,-166.8,205.8,-174.7,203.8,-182.4,201.2,-190,198.1,-197.4,194.9,-204.7,190.5,-211.3,184.1,-216.1,177.8,-221.1,172,-226.6,166.1,-232,160.1,-237.3,155.7,-243.9,152.8,-251.4,151.2,-259.2,152.3,-267.1,155.1,-274.6,158.7,-281.7,162.7,-288.6,167.4,-295.1,172.5,-301.3,177.5,-307.6,182.4,-313.9,187.2,-320.3,192,-326.7,196.8,-333.1,201.5,-339.5,206.3,-346,211.1,-352.4,215.8,-358.9,220.5,-365.3,225.3,-371.8,230,-378.2,234.8,-384.7,239.5,-391.1,244.2,-397.6,248.9,-404,253.7,-410.5,258.4,-417,263.1,-423.4,267.8,-429.9,272.1,-436.7,278.6,-440.9,286.6,-441.1,294,-438.4,300.4,-433.5,305,-427,307.7,-419.5,308.1,-411.5,308.3,-403.5,309.1,-395.6,312.3,-388.3,316.9,-381.8,321.8,-375.4,326.4,-368.9,330.7,-362.1,334.5,-355.1,337.2,-347.6,341.9,-341.3,349.6,-340.8,356.1,-345.3,358.3,-352.8,354.6,-359.7,348,-364.3,342.6,-370.1,337.5,-376.3,332.6,-382.6,327.9,-389.1,323.6,-395.8,321.5,-403.5,323.3,-411.2,327.4,-417.9,334.6,-421.4,342.2,-423.8,350,-425.6,357.6,-428,365.1,-431,372.5,-434,380,-436.8,387.8,-438.6,395.7,-439.1,403.3,-436.7,406.9,-429.8,407.8,-421.9,408,-413.9,408,-405.9,407.7,-397.9,407.4,-389.9,406.9,-381.9,406.4,-373.9,405.8,-365.9,405.1,-357.9,404.3,-350,403.3,-342,402.3,-334.1,401.2,-326.2,400,-318.2,398.7,-310.3,397.3,-302.5,395.8,-294.6,394.3,-286.7,392.7,-278.9,390.9,-271.1,389.1,-263.3,387,-255.6,384.8,-247.9,382.4,-240.2,379.8,-232.7,376.9,-225.2,373.7,-217.9,370.2,-210.6,366.5,-203.5,362.6,-196.6,358.5,-189.7,354.3,-182.9,349.8,-176.3,345.1,-169.8,340.2,-163.5,335.1,-157.3,330,-151.1,324.8,-145,319.7,-138.8,314.6,-132.7,309.3,-126.7,303.8,-120.9,297.9,-115.4,291.7,-110.4,285.2,-105.7,278.5,-101.3,271.7,-97.2,264.7,-93.2,257.7,-89.4,250.7,-85.6,243.6,-81.7,236.5,-78.1,229.3,-74.6,222.1,-71.2,214.8,-67.8,207.6,-64.3,200.4,-60.8,193.2,-57.3,186,-53.9,178.7,-50.5,171.5,-47.2,164.1,-44,156.7,-41.1,149.2,-38.2,141.6,-35.6,134,-33.1,126.3,-30.8,118.6,-28.7,110.9,-26.6,103.1,-24.7,95.3,-22.9,87.5,-21.1,79.7,-19.4,71.8,-17.8,64,-16.4,56.1,-15.1,48.2,-14,40.2,-12.8,32.3,-11.6,24.4,-10.7,16.6,-8.7,12.7,-2.1,12,5.9,8.8,13.1,1.3,15.6,-6.5,17.5,-14.1,15.7,-20.7,11.2,-28.4,9.9,-36.4,10.5,-44.4,11.3,-52.3,12.3,-60.3,13.4,-68.2,14.4,-76.1,15.5,-84.1,16.6,-92,17.8,-99.9,18.9,-107.8,20,-115.7,21.2,-123.7,22.3,-131.6,23.4,-139.5,24.5,-147.5,25.6,-155.4,26.7,-163.3,27.9,-171.2,29.1,-179.1,30.3,-187,31.5,-194.9,32.7,-202.9,34,-210.8,35.2,-218.7,36.5,-226.6,37.7,-234.5,38.9,-242.4,39.9,-248.6,44.8,-252.9,51.6,-256.4,58.8,-259.7,66,-263.1,73.3,-266.3,80.6,-269.3,88.1,-272,95.6,-274.3,103.2,-276.1,111,-277.5,118.9,-278.7,126.8,-279.5,134.8,-280,142.8,-280.1,150.8,-280.2,158.8,-280.1,166.8,-280,174.8,-279.9,182.8,-277.5,190.4,-272.5,196.6,-266.3,201.6,-259.8,206.2,-253.5,211.3,-248.6,217.5,-246.2,225.1,-245.5,233.1,-244.3,241,-243,248.9,-241.7,256.8,-240.4,264.7,-239.1,272.6,-237.7,280.5,-236.4,288.4,-235,296.3,-233.5,304.1,-232.1,312,-230.4,319.8,-228.4,327.6,-226.4,335.3,-227.3,343.1,-232.9,348.8,-239.7,352.9,-246.7,356.7,-248.1,364.5,-246.7,372.3,-244.6,380,-242,387.6,-239.2,395.1,-236.4,402.6,-233.5,410.1,-230.3,417.4,-226.9,424.6,-223.1,431.7,-219,438.5,-214.6,445.2,-209.9,451.8,-204.9,458,-199.6,464,-194,469.7,-187.9,474.9,-181.1,479.2,-174,482.8,-166.8,486.3,-159.5,489.6,-152.2,492.8,-147.5,499.1,-144.7,506.7,-145,514.5,-150.7,519.9,-158.2,522.6,-165.9,524.8,-173.6,526.7,-181.5,528.4,-189.3,530,-197.2,531.2,-205.2,531.8,-213.2,531.5,-221,530,-227.3,525.1,-230.9,518.5,-231,510.5,-232.7,502.7,-235.6,495.3,-240.4,488.9,-245.7,482.9,-250.9,476.8,-255.4,470.2,-259.5,463.3,-263.7,456.5,-268.1,449.9,-272.5,443.2,-276,436,-278.9,428.5,-281.4,420.9,-283.8,413.3,-286.2,405.6,-288.6,398,-290.8,390.3,-293.1,382.6,-295.3,374.9,-297.5,367.2,-299.6,359.5,-301.8,351.8,-303.9,344.1,-306,336.4,-308.1,328.6,-310.1,320.9,-311.9,313.1,-313.5,305.2,-314.8,297.3,-316,289.4,-317.2,281.5,-318.4,273.6,-319.6,265.7,-320.8,257.8,-321.8,249.8,-322.8,241.9,-323.7,233.9,-324.5,226,-325.3,218,-326,210,-326.6,202.1],
  suzuka: [685,138.4,690.1,144.6,695.2,150.8,700.3,156.9,705.4,163.1,710.5,169.2,715.6,175.4,720.8,181.5,725.9,187.7,731,193.8,736.1,200,741.2,206.1,746.4,212.3,751.5,218.4,756.6,224.6,761.7,230.7,766.9,236.8,772,243,777.1,249.1,782.2,255.3,787.3,261.5,792.4,267.6,797.5,273.8,802.6,280,807.7,286.1,812.8,292.3,817.9,298.5,823,304.7,828.1,310.8,833.2,317,838.2,323.2,843.3,329.3,848.4,335.5,853.5,341.7,858.6,347.9,863.7,354,868.8,360.2,873.9,366.4,878.9,372.6,884,378.8,889.1,385,894.2,391.1,899.2,397.3,904.3,403.5,909.3,409.7,914.4,415.9,919.4,422.1,924.5,428.4,929.5,434.6,934.5,440.9,939.5,447.1,944.4,453.4,949.3,459.8,954.1,466.1,958.7,472.7,962.4,479.8,965.3,487.2,967.7,494.9,969.8,502.6,971.3,510.4,971.7,518.4,971.4,526.4,970.6,534.4,969.1,542.2,967,550,964.8,557.6,962.5,565.3,960,572.9,957.5,580.5,954.7,588,951.6,595.4,947.8,602.4,942.8,608.7,936.9,614,930.4,618.7,923.3,622.3,915.6,624.7,907.8,626.2,899.8,626.7,891.9,626,884.1,624.2,876.5,621.5,869.5,617.6,863.1,612.8,857.4,607.3,852.5,600.9,848.3,594.2,844.1,587.3,839.8,580.6,835.5,573.8,831.2,567.1,827,560.3,822.8,553.5,818.6,546.7,814.3,539.9,810.1,533.1,805.9,526.3,801.6,519.5,797.4,512.7,793.1,506,788.8,499.2,784.5,492.5,780.1,485.8,775.7,479.1,771.2,472.5,766.6,466,761.8,459.6,756.7,453.4,751.1,447.6,744.8,442.7,737.7,439.1,730,437.1,722.2,435.3,714.3,433.9,706.4,433,698.4,432.8,690.4,433,682.4,433.3,674.4,433.4,666.4,433,658.5,431.7,650.8,429.7,643.3,426.8,636.4,422.8,630,418,624.2,412.5,619.1,406.3,614.8,399.6,611.9,392.1,609.4,384.5,607.3,376.8,605.3,369.1,603.4,361.3,601.5,353.5,599.6,345.7,597.7,338,595.7,330.2,593.6,322.5,591.3,314.8,588.6,307.3,585.5,299.9,581.6,293,576.9,286.5,571.6,280.5,565.7,275.1,559.2,270.5,552.3,266.4,545.2,262.7,537.8,259.6,530.1,257.4,522.3,256,514.3,255.1,506.3,254.8,498.3,254.8,490.3,255,482.3,255,474.3,255,466.3,254.5,458.4,253.5,450.5,252.1,442.8,250,435.4,247,428.4,243.2,421.6,238.9,415.3,234,409.5,228.5,404.7,222.1,400.5,215.3,396.7,208.2,393.6,200.9,391.1,193.3,389.2,185.5,388,177.6,387.6,169.6,388.1,161.6,389.4,153.7,391.6,146,394.1,138.4,396.8,130.9,399.6,123.4,402.5,115.9,405.3,108.5,408.2,101,411,93.5,413.7,86,416.3,78.4,418.7,70.8,420,62.9,420.5,54.9,420.2,46.9,418.5,39.1,416.2,31.5,413.4,23.9,410,16.7,406,9.8,400.9,3.6,394.7,-1.4,388,-5.8,381.2,-10,374.2,-13.9,367.2,-17.6,360,-21.3,353,-25,345.8,-28.7,338.7,-32.3,331.4,-35.6,324.1,-38.8,316.6,-41.7,309.1,-44.4,301.4,-46.7,293.7,-48.7,285.9,-50.4,278,-51.8,270.1,-52.8,262.1,-53.4,254.1,-53.6,246.1,-53.6,238.1,-53.5,230.1,-53.4,222.1,-53.1,214.2,-51.9,206.4,-49.9,198.8,-47.4,191.4,-44.3,184.1,-41.1,176.7,-38.1,169.3,-35,162.1,-31.7,154.9,-28.1,147.8,-24.3,141,-20.2,134.3,-15.8,127.9,-10.9,121.7,-5.9,115.7,-0.7,109.7,4.7,104,10.2,98.4,16,93,21.9,87.7,27.9,82.5,33.9,77.3,40,72.1,46.1,67,52.3,61.9,58.4,56.8,64.6,51.6,70.7,46.6,76.9,41.5,83.1,36.4,89.2,31.3,95.4,26.2,101.6,21.2,107.8,16.1,114,11.1,120.2,6.1,126.5,1.1,132.7,-3.9,139,-8.4,145.6,-15.7,148.6,-23.6,149.8,-31.5,150.9,-39.5,151.9,-47.4,152.8,-55.4,153.7,-63.3,154.5,-71.3,155.3,-79.2,156.1,-87.2,156.9,-95.2,157.6,-103.1,158.3,-111.1,159,-119.1,159.7,-127.1,160.3,-135,160.9,-143,161.4,-151,161.8,-159,162,-166.9,161,-173.9,157.2,-178.5,150.9,-180.5,143.1,-181.9,135.2,-183.8,127.5,-185.7,119.7,-187.7,111.9,-189.7,104.2,-191.7,96.4,-193.7,88.7,-195.6,80.9,-197.5,73.1,-199.3,65.4,-201,57.5,-202.7,49.7,-204.3,41.9,-205.8,34,-207.2,26.2,-208.7,18.3,-210.1,10.4,-211.5,2.5,-212.8,-5.4,-214.2,-13.2,-215.5,-21.1,-216.8,-29,-218.1,-36.9,-219.4,-44.8,-220.7,-52.7,-222,-60.6,-223.3,-68.5,-224.6,-76.4,-225.9,-84.3,-227.2,-92.2,-228.5,-100.1,-229.9,-108,-231.3,-115.8,-232.8,-123.7,-234.2,-131.6,-235.4,-139.5,-236.1,-147.4,-235.9,-155.4,-235,-163.4,-233.9,-171.3,-232.3,-179.2,-229.9,-186.8,-226.9,-194.2,-223.8,-201.6,-220.6,-208.9,-217.4,-216.2,-214.1,-223.5,-210.9,-230.8,-207.6,-238.1,-204.4,-245.5,-201.2,-252.8,-198.1,-260.2,-195.2,-267.7,-195.2,-275.5,-198.7,-282.7,-204.7,-287.9,-212,-291.2,-219.9,-292,-227.3,-289.3,-233.4,-284.1,-237.8,-277.5,-242,-270.7,-246.1,-263.8,-250.1,-256.9,-254,-249.9,-258,-243,-261.9,-236,-265.9,-229.1,-270,-222.2,-274.1,-215.3,-278.2,-208.5,-282.4,-201.7,-286.7,-194.9,-290.9,-188.1,-295.3,-181.4,-299.7,-174.7,-304.1,-168,-308.6,-161.4,-313.3,-154.9,-318.2,-148.7,-323.4,-142.6,-329,-136.8,-335.1,-131.6,-341.3,-126.5,-347.4,-121.4,-353.6,-116.4,-360.1,-111.7,-366.9,-107.5,-373.9,-103.7,-381.2,-100.3,-388.7,-97.5,-396.4,-95.2,-404.1,-93.4,-412,-91.8,-419.9,-90.5,-427.8,-89.3,-435.7,-88.4,-443.7,-87.5,-451.7,-86.9,-459.7,-86.4,-467.6,-86.1,-475.6,-85.9,-483.6,-86,-491.6,-86.3,-499.6,-86.9,-507.6,-87.8,-515.5,-89.1,-523.3,-90.7,-531.1,-92.5,-538.9,-94.4,-546.6,-96.4,-554.4,-98.4,-562.1,-100.5,-569.8,-102.7,-577.4,-105.1,-585,-107.6,-592.6,-110.3,-600.1,-113,-607.5,-115.9,-615,-118.8,-622.4,-121.9,-629.7,-125,-637,-128.4,-644.2,-131.9,-651.2,-135.7,-658.1,-139.7,-664.9,-144,-671.6,-148.4,-678.1,-153.1,-684.5,-157.9,-690.7,-162.9,-696.8,-168.1,-702.8,-173.3,-708.7,-178.8,-714.4,-184.4,-719.9,-190.2,-725.4,-196.1,-730.6,-202.1,-735.7,-208.3,-740.5,-214.7,-745,-221.3,-749.3,-228.1,-753.5,-234.8,-757.6,-241.7,-761.4,-248.7,-764.8,-256,-768,-263.3,-770.9,-270.8,-773.7,-278.3,-776.4,-285.8,-779.1,-293.3,-781.8,-300.9,-784.5,-308.4,-787.2,-315.9,-789.9,-323.5,-792.7,-331,-795.5,-338.4,-798.6,-345.9,-801.7,-353.2,-804.9,-360.5,-808.3,-367.8,-811.7,-375,-815.3,-382.2,-819,-389.3,-823.1,-396.2,-828.2,-402.3,-834.1,-407.7,-840.8,-412.1,-848,-415.4,-855.6,-417.9,-863.4,-419.7,-871.3,-420.8,-879.3,-421.2,-887.3,-420.9,-895.3,-420.4,-903.3,-419.5,-911.2,-418.3,-919.1,-416.9,-926.9,-415.5,-934.7,-413.7,-942.4,-411.3,-949.9,-408.6,-957.1,-405.2,-964,-401.2,-970.5,-396.5,-976.3,-391,-981.1,-384.6,-985,-377.6,-987.9,-370.1,-989.7,-362.3,-990.2,-354.4,-989.8,-346.4,-988.7,-338.5,-986.6,-330.8,-983.9,-323.2,-981,-315.8,-977.3,-308.7,-972.1,-302.6,-966.5,-296.9,-960.8,-291.3,-955,-285.8,-949.1,-280.4,-943.1,-275.1,-937,-269.9,-930.9,-264.8,-924.7,-259.7,-918.5,-254.6,-912.4,-249.4,-906.4,-244.1,-900.5,-238.8,-894.5,-233.5,-888.4,-228.3,-882.1,-223.3,-875.8,-218.4,-869.4,-213.6,-863,-208.8,-856.5,-204.1,-850,-199.4,-843.5,-194.8,-836.9,-190.3,-830.3,-185.8,-823.7,-181.3,-817,-176.9,-810.3,-172.5,-803.6,-168.1,-796.9,-163.7,-790.2,-159.4,-783.4,-155.2,-776.5,-151.1,-769.5,-147.3,-762.4,-143.6,-755.1,-140.2,-747.9,-136.9,-740.6,-133.5,-733.3,-130.2,-726.1,-126.7,-719,-123.1,-711.9,-119.4,-704.8,-115.6,-697.8,-111.9,-690.6,-108.3,-683.3,-105,-675.9,-101.9,-668.5,-99,-661,-96.2,-653.4,-93.5,-645.9,-90.8,-638.4,-88.1,-630.8,-85.5,-623.2,-82.9,-615.7,-80.3,-608.1,-77.8,-600.5,-75.2,-592.9,-72.6,-585.4,-70,-577.8,-67.3,-570.3,-64.5,-562.9,-61.7,-555.4,-58.8,-548,-55.8,-540.5,-52.9,-533.1,-49.9,-525.7,-46.9,-518.2,-44,-510.8,-41.1,-503.3,-38.3,-495.8,-35.5,-488.3,-32.7,-480.8,-30,-473.2,-27.3,-465.7,-24.6,-458.1,-22,-450.6,-19.3,-443,-16.7,-435.5,-14.1,-427.9,-11.5,-420.3,-9,-412.7,-6.4,-405.1,-3.9,-397.5,-1.4,-389.9,1,-382.3,3.4,-374.6,5.8,-367,8.2,-359.3,10.5,-351.7,12.9,-344.1,15.3,-336.4,17.6,-328.8,20.1,-321.2,22.5,-313.6,25.1,-306,27.6,-298.4,30.2,-290.9,32.7,-283.3,35.4,-275.7,38,-268.2,40.7,-260.7,43.4,-253.2,46.2,-245.7,49,-238.2,51.9,-230.8,54.8,-223.3,57.7,-215.9,60.7,-208.5,63.6,-201,66.5,-193.5,69.4,-186,72.2,-178.5,74.9,-170.9,77.3,-163.1,79.3,-155.2,80.5,-147.2,81,-139.2,80.7,-131.3,79.5,-123.5,77.8,-115.7,75.9,-108,73.9,-100.4,71.5,-92.8,68.8,-85.3,66,-77.9,63.1,-70.5,60,-63.2,56.8,-55.9,53.4,-48.8,49.8,-41.7,46.1,-34.7,42.2,-27.8,38.2,-20.9,34.1,-14.2,29.7,-7.6,25.2,-1.1,20.5,5.2,15.6,11.5,10.6,17.6,5.5,23.6,0.2,29.5,-5.2,35.3,-10.7,41.2,-16.2,46.9,-21.7,52.7,-27.2,58.5,-32.8,64.3,-38.3,70.1,-43.8,76,-49.2,81.8,-54.7,87.6,-60.2,93.4,-65.7,99.2,-71.2,105.1,-76.7,110.9,-82.1,116.7,-87.6,122.6,-93.1,128.5,-98.5,134.4,-103.9,140.4,-109.1,146.5,-114.3,152.7,-119.4,159,-124.3,165.6,-128.9,172.2,-133.4,178.8,-137.9,185.5,-142.2,192.4,-146.2,200.3,-145.9,207,-141.6,212.8,-136.1,218.7,-130.6,224.6,-125.3,230.9,-120.4,238.5,-118,246.4,-118.8,253.5,-122.3,259.9,-127.2,265.8,-132.6,271.6,-138.1,277.7,-143.3,284,-148.2,290.6,-152.8,297.5,-156.8,304.7,-160.3,312.2,-163.1,320,-164.9,327.9,-165.8,335.9,-166.2,343.9,-166.3,351.9,-166.1,359.9,-165.5,367.8,-164.6,375.7,-163.3,383.5,-161.6,391.3,-159.5,398.8,-156.9,406.3,-154,413.6,-150.9,421,-147.7,428.3,-144.4,435.4,-140.7,442.3,-136.7,449,-132.4,455.6,-127.9,462.1,-123.1,468.3,-118.1,474.3,-112.8,480.1,-107.3,485.8,-101.7,491.4,-96,496.9,-90.1,502.2,-84.2,507.5,-78.1,512.7,-72.1,517.9,-66,523,-59.8,528.1,-53.7,533.2,-47.5,538.3,-41.4,543.4,-35.2,548.5,-29,553.6,-22.8,558.6,-16.6,563.7,-10.4,568.8,-4.2,573.8,2,578.9,8.2,583.9,14.4,589,20.6,594,26.8,599.1,33,604.1,39.2,609.1,45.4,614.2,51.6,619.2,57.8,624.3,64.1,629.3,70.3,634.4,76.5,639.4,82.7,644.5,88.9,649.5,95.1,654.6,101.3,659.6,107.5,664.7,113.7,669.8,119.9,674.8,126.1,679.9,132.2],
  bahrain: [-361.6,51.1,-361.2,43.1,-360.8,35.2,-360.5,27.2,-360.2,19.2,-359.9,11.2,-359.6,3.2,-359.3,-4.8,-359,-12.8,-358.8,-20.8,-358.5,-28.8,-358.3,-36.8,-358.1,-44.8,-357.9,-52.8,-357.6,-60.8,-357.4,-68.8,-357.2,-76.8,-357,-84.8,-356.9,-92.8,-356.7,-100.8,-356.5,-108.8,-356.3,-116.8,-356.1,-124.8,-356,-132.8,-355.8,-140.8,-355.6,-148.8,-355.4,-156.8,-355.3,-164.8,-355.1,-172.8,-354.9,-180.8,-354.8,-188.8,-354.6,-196.8,-354.4,-204.8,-354.2,-212.8,-354,-220.8,-353.8,-228.8,-353.6,-236.8,-353.4,-244.8,-353.2,-252.8,-353,-260.8,-352.7,-268.8,-352.5,-276.8,-352.2,-284.8,-351.9,-292.8,-351.7,-300.8,-351.5,-308.8,-351.3,-316.8,-351,-324.8,-350.8,-332.8,-350.7,-340.8,-350.5,-348.8,-350.3,-356.8,-350.1,-364.8,-349.9,-372.7,-349.7,-380.7,-349.6,-388.7,-349.4,-396.7,-349.2,-404.7,-349,-412.7,-348.7,-420.7,-348.5,-428.7,-348.2,-436.7,-348,-444.7,-347.7,-452.7,-347.3,-460.7,-346.9,-468.7,-346.5,-476.7,-345.9,-484.7,-345.2,-492.7,-344.3,-500.6,-342.9,-508.5,-339.9,-515.8,-332.5,-518.1,-324.6,-517,-317.5,-513.5,-311.4,-508.2,-305.9,-502.4,-300.5,-496.6,-295.1,-490.7,-289.7,-484.8,-284.2,-478.9,-278.6,-473.2,-272.7,-467.7,-266.3,-463,-258.9,-460,-251,-459.2,-243.1,-460.3,-235.3,-462.2,-227.7,-464.6,-220.1,-467.1,-212.5,-469.8,-205,-472.4,-197.4,-475.1,-189.9,-477.8,-182.3,-480.4,-174.7,-482.9,-167.1,-485.1,-159.2,-486.9,-151.3,-488,-143.3,-488.3,-135.3,-488.1,-127.4,-487.2,-119.5,-486.1,-111.6,-484.8,-103.7,-483.5,-95.8,-482.2,-87.9,-480.8,-80,-479.4,-72.1,-478,-64.3,-476.6,-56.4,-475.1,-48.5,-473.7,-40.7,-472.2,-32.8,-470.8,-24.9,-469.3,-17.1,-467.9,-9.2,-466.4,-1.3,-464.9,6.5,-463.4,14.4,-461.9,22.2,-460.5,30.1,-459,38,-457.5,45.8,-456,53.7,-454.5,61.5,-453,69.4,-451.5,77.3,-449.9,85.1,-448.4,93,-446.9,100.8,-445.4,108.7,-443.9,116.5,-442.4,124.4,-440.8,132.2,-439.3,140.1,-437.8,148,-436.3,155.8,-434.7,163.7,-433.2,171.5,-431.7,179.4,-430.1,187.2,-428.6,195.1,-427,202.9,-425.5,210.8,-423.9,218.6,-422.4,226.5,-420.8,234.3,-419.3,242.2,-417.7,250,-416.1,257.9,-414.6,265.7,-413,273.5,-411.4,281.4,-409.9,289.2,-408.3,297.1,-406.7,304.9,-405.1,312.8,-403.5,320.6,-401.9,328.4,-400.3,336.3,-398.7,344.1,-397.1,351.9,-395.5,359.8,-393.8,367.6,-392.2,375.4,-390.5,383.2,-388.8,391,-387,398.8,-385.2,406.6,-383.3,413.5,-379.4,419,-373.6,421.9,-366.2,422.6,-358.2,421.7,-350.3,419.4,-342.6,416.1,-335.3,411.8,-328.6,406.6,-322.5,401,-316.9,394.8,-311.7,388.6,-306.8,382.2,-301.9,375.9,-297,369.5,-292.2,363,-287.6,356.4,-282.9,349.9,-278.3,343.3,-273.7,336.8,-269,330.4,-264.3,324,-259.5,317.7,-254.5,311.6,-249.4,305.7,-244,299.9,-238.5,294.3,-232.8,288.7,-227,283.3,-221.2,277.9,-215.3,272.5,-209.3,267.1,-203.4,261.6,-197.6,255.9,-192,250,-186.6,245.1,-180.3,241.1,-173.4,237.4,-166.3,234,-159,230.9,-151.7,227.8,-144.3,224.7,-136.9,221.6,-129.5,218.4,-122.2,214.8,-115.1,210.6,-108.3,205,-102.6,198.2,-98.3,191.4,-94.2,184.3,-90.6,176.5,-88.8,168.5,-88.3,160.5,-88.6,152.6,-89.7,144.7,-91.1,136.9,-92.7,129,-94.3,121.2,-95.8,113.3,-97.2,105.3,-97.9,97.3,-97.7,89.4,-96.8,81.5,-95.4,73.9,-93,66.8,-89.4,60.2,-84.8,54.2,-79.5,48.7,-73.7,43.4,-67.7,38.2,-61.6,33.2,-55.4,28.2,-49.1,23.3,-42.8,18.4,-36.5,13.5,-30.2,8.6,-23.9,3.7,-17.5,-1.2,-11.2,-6,-4.8,-10.9,1.5,-15.8,7.9,-20.6,14.3,-25.5,20.6,-30.4,26.9,-35.2,33.3,-40.1,39.6,-45,45.9,-50,52.2,-55,58.5,-60,64.7,-65.2,70.8,-70.6,76.7,-76.4,82.2,-83.7,85.4,-91.6,86.6,-99.1,84.3,-104.7,78.6,-107.4,71.2,-108.4,63.2,-108.9,55.2,-108.6,47.2,-107.9,39.3,-107.1,31.3,-106,23.4,-104.8,15.5,-103.6,7.6,-102.3,-0.3,-100.9,-8.2,-99.6,-16.1,-98.2,-24,-96.8,-31.9,-95.4,-39.7,-94,-47.6,-92.6,-55.5,-91.2,-63.4,-89.8,-71.2,-88.4,-79.1,-87,-87,-85.6,-94.9,-84.2,-102.8,-82.8,-110.6,-81.5,-118.5,-80.2,-126.4,-78.9,-134.3,-77.7,-142.2,-76.4,-150.1,-75.2,-158,-73.9,-165.9,-72.7,-173.8,-71.4,-181.7,-70.2,-189.7,-69,-197.6,-67.8,-205.5,-66.6,-213.4,-65.5,-221.3,-64.3,-229.2,-63.2,-237.1,-62,-245.1,-61.8,-253,-62.8,-261,-64.4,-268.8,-66.2,-276.6,-68.7,-284.2,-72.2,-291.4,-76.7,-298,-82.1,-303.9,-87.9,-309.4,-93.9,-314.7,-99.9,-320,-106,-325.1,-112.2,-330.2,-118.5,-335.1,-125.1,-339.8,-132.4,-342.5,-139.4,-339.2,-142.5,-331.9,-144.4,-324.1,-145.9,-316.2,-147.1,-308.3,-148.3,-300.4,-149.4,-292.5,-150.5,-284.6,-151.5,-276.6,-152.5,-268.7,-153.4,-260.7,-154.4,-252.8,-155.3,-244.8,-156.1,-236.9,-157,-228.9,-157.8,-221,-158.6,-213,-159.3,-205,-160.1,-197.1,-160.7,-189.1,-161.2,-181.1,-161.6,-173.1,-162,-165.1,-162.4,-157.1,-162.7,-149.1,-163,-141.1,-163.4,-133.2,-163.7,-125.2,-164.2,-117.2,-164.6,-109.2,-165.1,-101.2,-165.5,-93.2,-166,-85.2,-166.4,-77.2,-166.9,-69.2,-167.3,-61.3,-167.8,-53.3,-168.2,-45.3,-168.7,-37.3,-169.1,-29.3,-169.6,-21.3,-170,-13.3,-170.4,-5.3,-170.8,2.7,-171.2,10.6,-171.6,18.6,-172,26.6,-172.4,34.6,-172.7,42.6,-173.1,50.6,-173.4,58.6,-173.7,66.6,-174,74.6,-174.3,82.6,-174.6,90.6,-174.9,98.6,-175.1,106.6,-175.4,114.6,-175.7,122.6,-176,130.6,-176.2,138.6,-176.5,146.6,-176.8,154.6,-177.1,162.6,-177.3,170.5,-177.6,178.5,-177.9,186.5,-178.2,194.5,-178.6,202.5,-178.9,210.5,-179.3,218.5,-179.7,226.5,-180.1,234.5,-180.5,242.5,-180.9,250.5,-181.4,258.5,-181.8,266.5,-182.2,274.4,-182.6,282.4,-183,290.4,-183.3,298.4,-183.7,306.4,-183.9,314.4,-184.2,322.4,-184.3,330.4,-184.3,338.4,-184.1,346.4,-183.8,354.4,-182.5,362.3,-179.5,369.7,-174.9,376.2,-168.8,381.4,-161.7,384.9,-154.1,387.6,-146.3,389.5,-138.4,390.6,-130.4,390.8,-122.5,390.1,-114.5,389,-106.6,387.9,-98.7,386.5,-91,384.6,-83.4,381.9,-76.1,378.6,-69,375,-62.1,371,-55.2,366.8,-48.6,362.3,-42.3,357.5,-36.1,352.3,-30.3,346.9,-24.6,341.2,-19.3,335.3,-14.3,329,-9.8,322.4,-5.8,315.4,-2.2,308.3,1,301,3.9,293.5,6.7,286,9.4,278.5,12.1,271,14.8,263.4,17.6,255.9,20.5,248.5,23.6,241.1,26.9,233.8,30.4,226.6,34.2,219.6,38.5,212.9,43.4,206.6,48.9,200.7,54.6,195.1,60.7,190,67.1,185.1,73.6,180.5,80.3,176,87.3,172.2,94.7,169.2,102.4,166.9,110.2,165.2,118.1,163.9,126,163.1,134,162.6,142,162.6,150,163.1,158,164.1,165.8,165.8,173.4,168.1,180.9,171,188.1,174.4,195.2,178,202.4,181.7,209.6,185.2,216.8,188.6,224,192.1,231.2,195.5,238.4,199,245.7,202.4,252.9,205.9,260,209.4,267.2,213,274.3,216.7,281.4,220.5,288.3,224.5,294.9,229,301.2,233.9,307.2,239.2,313,244.7,318.1,250.8,321.9,257.9,325.7,264.9,330.3,271.5,333.5,278.7,333.9,286.7,332,294.4,328.1,301.4,323.2,307.7,317.4,313.2,311.3,318.4,305.2,323.6,298.8,328.3,292.1,332.8,285.4,337,278.5,341.2,271.7,345.3,264.8,349.4,257.9,353.4,251,357.5,244.1,361.5,237.1,365.5,230.2,369.5,223.3,373.5,216.3,377.4,209.4,381.4,202.4,385.4,195.5,389.3,188.5,393.3,181.5,397.2,174.6,401.2,167.6,405.1,160.6,409,153.7,413,146.7,416.9,139.7,420.8,132.8,424.8,125.8,428.7,118.8,432.6,111.8,436.5,104.9,440.4,97.9,444.3,90.9,448.2,83.9,452.2,76.9,456.1,70,460,63,463.9,56,467.8,49,471.7,42,475.6,35,479.5,28,483.4,21.1,487.3,14.1,491.2,7.1,495,0.1,498.9,-6.9,502.8,-13.9,506.7,-20.9,510.6,-27.9,514.5,-34.9,518.4,-41.9,522.3,-48.9,526.1,-55.9,530,-62.9,533.9,-69.9,537.8,-76.9,541.7,-83.9,545.6,-90.9,549.4,-97.9,553.3,-104.9,557.2,-111.9,561.1,-118.9,564.9,-125.9,568.8,-132.9,572.7,-139.9,576.6,-146.9,580.4,-153.9,584.3,-160.9,588.2,-167.9,592,-174.9,595.9,-181.9,599.8,-188.9,603.6,-195.9,607.5,-202.9,611.4,-209.9,615.2,-216.9,619.1,-223.9,622.9,-230.9,626.8,-237.9,630.7,-244.9,634.5,-252,638.4,-259,642.2,-266,646.1,-273,649.9,-280,653.8,-287,657.6,-294,661.5,-301.1,665.3,-308.1,669.2,-315.1,673,-322.1,676.8,-329,680.9,-336.7,683,-344.7,683.6,-352.3,681.8,-357.7,675.9,-362,669.2,-365.9,662.2,-369.5,655,-373,647.9,-376.4,640.6,-379.6,633.2,-382.5,625.8,-385.1,618.2,-386.8,610.4,-387.4,602.4,-387.6,594.4,-387.8,586.4,-387.8,578.4,-387.6,570.5,-387.3,562.5,-387.1,554.5,-386.9,546.5,-386.7,538.5,-386.6,530.5,-386.4,522.5,-386.2,514.5,-386,506.5,-385.8,498.5,-385.6,490.5,-385.4,482.5,-385.1,474.5,-384.9,466.5,-384.7,458.5,-384.5,450.5,-384.2,442.5,-384,434.5,-383.8,426.5,-383.5,418.5,-383.3,410.5,-383,402.5,-382.7,394.5,-382.4,386.5,-382.1,378.5,-381.8,370.5,-381.5,362.5,-381.2,354.5,-380.9,346.5,-380.6,338.5,-380.2,330.5,-379.8,322.5,-379.4,314.6,-379,306.6,-378.6,298.6,-378.1,290.6,-377.7,282.6,-377.1,274.6,-376.6,266.6,-376.1,258.6,-375.5,250.7,-374.9,242.7,-374.4,234.7,-373.8,226.7,-373.2,218.8,-372.5,210.8,-371.9,202.8,-371.3,194.8,-370.7,186.8,-370.1,178.9,-369.4,170.9,-368.8,162.9,-368.2,154.9,-367.6,147,-367,139,-366.5,131,-365.9,123,-365.3,115,-364.8,107,-364.3,99.1,-363.8,91.1,-363.3,83.1,-362.8,75.1,-362.4,67.1,-362,59.1],
};

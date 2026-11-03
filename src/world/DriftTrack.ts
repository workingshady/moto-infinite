// Drift venues: closed loops with wide drivable pads, named drift zones (score multipliers) and venue dressing.
// Layout ideas from real events: container-yard drift days (walls of stacked boxes, inner/outer clipping points
// judged on line + angle), Japanese touge passes (switchback hairpins with guard rails on the drop side),
// skidpad figure-8s (two constant-radius circles joined by a crossover) and gymkhana arenas
// (slaloms, 180/360 spins around a post, barrier chicanes on one big open pad), plus airfield drift days (Bovingdon,
// Thomson McDuffie), harbour quaysides, car-park drift (Odaiba, Red Bull Car Park Drift) and street circuits (Long Beach).
import * as THREE from 'three';
import type { Noise } from '../utils/noise';
import type { Game } from '../core/Game';
import type { Chunk, Obstacle } from './Chunks';
import { hash01, type Poi, type Pose, type RoadLayout, type RoadPointFn } from './layout';
import { G, M, MAT, canvasTex } from '../entities/assets';
import { ROAD } from '../config';
import { clamp, mulberry32, PI, TAU } from '../utils/math';

export type DriftTrackId = 'docks' | 'touge' | 'skidpad' | 'gymkhana' | 'airfield' | 'harbor' | 'carpark' | 'street' | 'random';

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
  { id: 'airfield', name: 'Airfield Drift', blurb: 'Full-width runway blast, taxiway kink and an apron hairpin between parked jets and hangars.', time: 'sunset', weather: 'clear', theme: 'mixed' },
  { id: 'harbor', name: 'Harbor Quayside', blurb: 'Slide along the quay edge past a moored freighter, round the lighthouse pier and back down warehouse row.', time: 'dawn', weather: 'fog', theme: 'islands' },
  { id: 'carpark', name: 'Car Park Drift', blurb: 'Tight technical course through a night-time mall car park. Parked cars are not crash pads.', time: 'night', weather: 'clear', theme: 'mixed' },
  { id: 'street', name: 'Street Circuit', blurb: 'Concrete walls, catch fences and square city corners. One mistake and you are in the k-rail.', time: 'night', weather: 'clear', theme: 'mixed' },
  { id: 'random', name: 'Random Venue', blurb: 'A seeded mix of corners, walls and clipping points. New every seed.', time: 'day', weather: 'clear', theme: 'mixed' },
];

/** Sample-index range along the centre line (i0 > i1 means it wraps past the start line) and its score multiplier. */
export interface DriftZone { name: string; i0: number; i1: number; mult: number }

// ---------------------------------------------------------------------------------------------
// shared geometry / materials (module level, created once)

type PartId = 'cont' | 'box' | 'paint' | 'crowd' | 'cone' | 'barrel' | 'tyre' | 'cyl' | 'rock' | 'lamp'
  | 'cylZ' | 'coneZ' | 'arch' | 'rw09' | 'rw27' | 'piano' | 'bays' | 'xwalk' | 'facade' | 'fence' | 'neon' | 'glass';

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

const cylZ = new THREE.CylinderGeometry(1, 1, 1, 12).rotateX(PI / 2);
const coneZ = new THREE.ConeGeometry(1, 1, 12).rotateX(PI / 2);
/** Half cylinder (hangar roof), base on y=0, axis along z. */
const archGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, false, PI / 2, PI).rotateX(PI / 2);
/** Flat decal (white marks on transparent) drawn on the top face of a thin box. */
const decal = (w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) =>
  new THREE.MeshStandardMaterial({ map: canvasTex(w, h, draw), transparent: true, alphaTest: 0.4, roughness: 0.6, depthWrite: false });
const digits = (txt: string) => decal(128, 128, (g, w, h) => {
  g.fillStyle = '#ffffff'; g.font = 'bold 112px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save(); g.translate(w / 2, h / 2); g.scale(0.7, 1.15); g.fillText(txt, 0, 4); g.restore();
});
const pianoMat = decal(128, 32, (g, w, h) => { g.fillStyle = '#ffffff'; for (let x = 4; x < w; x += 16) g.fillRect(x, 0, 8, h); });
const baysMat = decal(128, 128, (g, w, h) => {
  g.fillStyle = '#ffffff';
  for (let x = 0; x <= w; x += 32) g.fillRect(Math.min(w - 3, Math.max(0, x - 1.5)), 0, 3, h);
  g.fillRect(0, h / 2 - 1.5, w, 3);
});
const xwalkMat = decal(128, 32, (g, w, h) => { g.fillStyle = '#ffffff'; for (let x = 6; x < w; x += 16) g.fillRect(x, 0, 9, h); });
const facadeTex = canvasTex(64, 48, (g, w, h) => {
  g.fillStyle = '#2a2d36'; g.fillRect(0, 0, w, h);
  let s = 7;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
    s = (s * 16807) % 2147483647;
    g.fillStyle = s % 5 < 2 ? '#ffd98a' : s % 5 === 2 ? '#9fd3ff' : '#141a24';
    g.fillRect(2 + c * 10.4, 3 + r * 16, 7, 10);
  }
});
const facadeMat = new THREE.MeshStandardMaterial({ map: facadeTex, emissive: 0xffffff, emissiveMap: facadeTex, emissiveIntensity: 0.55, roughness: 0.8 });
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
const neonMat = new THREE.MeshBasicMaterial({
  map: canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#120a1c'; g.fillRect(0, 0, w, h);
    g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = '#ff3fd0'; g.shadowBlur = 14; g.fillStyle = '#ff7ae6'; g.fillText('MEGA MALL', w / 2, h / 2 + 2);
    g.shadowColor = '#3ff0ff'; g.strokeStyle = '#7ff6ff'; g.lineWidth = 3; g.strokeRect(5, 5, w - 10, h - 10);
  }),
});
const glassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x6fd6ff, emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.5 });

const PARTS: Record<PartId, { g: THREE.BufferGeometry; m: THREE.Material; shadow: boolean }> = {
  cylZ: { g: cylZ, m: MAT.white, shadow: true },
  coneZ: { g: coneZ, m: MAT.white, shadow: true },
  arch: { g: archGeo, m: contMat, shadow: true },
  rw09: { g: G.box, m: digits('09'), shadow: false },
  rw27: { g: G.box, m: digits('27'), shadow: false },
  piano: { g: G.box, m: pianoMat, shadow: false },
  bays: { g: G.box, m: baysMat, shadow: false },
  xwalk: { g: G.box, m: xwalkMat, shadow: false },
  facade: { g: G.box, m: facadeMat, shadow: true },
  fence: { g: G.box, m: fenceMat, shadow: false },
  neon: { g: G.box, m: neonMat, shadow: false },
  glass: { g: G.box, m: glassMat, shadow: false },
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
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color(), _e = new THREE.Euler();

/** One instanced box/cone/... placed relative to the ground under its anchor (gx, gz). */
interface Prop {
  p: PartId; x: number; z: number; y: number; h: number; sx: number; sy: number; sz: number; c: number; gx: number; gz: number;
  /** pitch (radians, about the local x axis) */
  t?: number;
  /** y is absolute (sea level = 0): things standing in the water */
  abs?: boolean;
}
/** Axis-aligned flat area (whole lot / yard / water basin) the terrain is flattened to at height y. */
interface Rect { x0: number; z0: number; x1: number; z1: number; y: number }

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

/** Airfield: runway straight (z=0) east, sweep north past the hangars, taxiway west with a kink, apron hairpin, back onto the runway. */
function airfieldPts(): V2[] {
  return [[-200, 0], [-60, 0], [80, 0], [220, 0], [295, 4], [345, 38], [342, 100], [292, 142], [200, 146], [135, 140], [95, 170], [48, 146], [-20, 150], [-62, 156], [-112, 190], [-128, 250], [-172, 286], [-220, 262], [-226, 202], [-252, 132], [-318, 72], [-322, 18], [-268, 2]];
}

/** Harbour: quay straight (z=0) with water to the south, a lighthouse pier hairpin, warehouse row back west, ferry-ramp corner. */
function harborPts(): V2[] {
  return [[-150, 0], [0, 0], [150, 0], [238, 2], [280, -32], [283, -100], [290, -150], [311, -170], [333, -152], [340, -100], [338, -32], [366, 14], [372, 80], [332, 134], [200, 140], [50, 128], [-100, 140], [-250, 134], [-330, 100], [-352, 42], [-312, 6], [-240, 0]];
}

/** Car park: tight technical loop inside the lot (mall to the north). */
function carparkPts(): V2[] {
  return [[-70, -90], [30, -90], [105, -80], [130, -40], [110, 0], [60, -10], [20, 15], [40, 55], [100, 65], [125, 100], [95, 125], [40, 115], [-20, 120], [-80, 110], [-130, 90], [-135, 50], [-95, 30], [-120, -5], [-140, -45], [-125, -85]];
}

/** Street circuit corners [x, z, fillet radius]; the start sits mid "Harbor Drive" (z=-150). */
const STREET: [number, number, number][] = [[210, -150, 14], [210, -60, 14], [130, -60, 14], [130, 40, 14], [210, 40, 14], [210, 140, 14], [-60, 140, 14], [-60, 60, 14], [50, 60, 20], [50, 20, 20], [-200, 20, 14], [-200, -150, 14]];
function streetPts(): V2[] {
  const all: [number, number, number][] = [[-100, -150, 0], ...STREET], raw: V2[] = [], L = all.length;
  for (let k = 0; k < L; k++) {
    const [x, z, r] = all[k];
    if (!r) { raw.push([x, z]); continue; }
    const [px, pz] = all[(k - 1 + L) % L], [nx, nz] = all[(k + 1) % L];
    const li = Math.hypot(x - px, z - pz), lo = Math.hypot(nx - x, nz - z);
    const a: V2 = [x - ((x - px) / li) * r, z - ((z - pz) / li) * r], b: V2 = [x + ((nx - x) / lo) * r, z + ((nz - z) / lo) * r];
    for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const u = 1 - t;
      raw.push([u * u * a[0] + 2 * u * t * x + t * t * b[0], u * u * a[1] + 2 * u * t * z + t * t * b[1]]);
    }
  }
  const dense: V2[] = [];
  for (let i = 0; i < raw.length; i++) line(dense, raw[i], raw[(i + 1) % raw.length], 10);
  return dense.filter((p, i) => { const q = dense[(i - 1 + dense.length) % dense.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.5; });
}

const rectDist = (q: Rect, x: number, z: number) => Math.hypot(Math.max(q.x0 - x, 0, x - q.x1), Math.max(q.z0 - z, 0, z - q.z1));

/** Flat areas per venue: land pads first, water basins last (a land pad wins where they touch). */
const RECTS: Partial<Record<DriftTrackId, Rect[]>> = {
  airfield: [{ x0: -300, z0: 170, x1: -20, z1: 330, y: 5 }, { x0: 370, z0: -30, x1: 480, z1: 170, y: 5 }],
  harbor: [{ x0: -420, z0: -16, x1: 420, z1: 260, y: 3 }, { x0: 252, z0: -222, x1: 370, z1: -16, y: 3 }, { x0: -420, z0: -420, x1: 420, z1: -16, y: -6 }],
  carpark: [{ x0: -185, z0: -135, x1: 185, z1: 215, y: 5 }],
  street: [{ x0: -300, z0: -210, x1: 300, z1: 200, y: 5 }],
};

/** Named zones per venue: [name, x, z, mult?, length?]. With a length it is a straight zone centred there; otherwise the bend nearest the point. */
const SPOTS: Partial<Record<DriftTrackId, [string, number, number, number?, number?][]>> = {
  airfield: [['Hangar Sweep', 340, 70], ['Taxiway Kink', 95, 165], ['Apron Hairpin', -172, 262], ['Runway Entry', -310, 30]],
  harbor: [['Quay Edge', 40, 0, 2.2, 240], ['Lighthouse Hairpin', 311, -160], ['Warehouse Row', 100, 135, 1.6, 180], ['Ferry Ramp', -335, 50]],
  carpark: [['Bay Row', 20, -90, 1.5, 130], ['Mall Hairpin', 110, 115], ['Exit Ramp', -125, 40]],
  street: [['Harbor Drive', 20, -150, 1.6, 240], ['Turn 9', -60, 140], ['Turn 10', -60, 60], ['Turn 11 Hairpin', 60, 40]],
};

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
  private readonly base: number;
  private readonly rects: Rect[];
  private climb = 0;
  private iTop = 1;
  private cx = 0;
  private cz = 0;
  private readonly props: Prop[] = [];
  /** Colliders; top is relative to the ground. */
  private readonly solids: Obstacle[] = [];

  constructor(_noise: Noise, readonly id: DriftTrackId, private readonly seed: number) {
    const rng = mulberry32((seed ^ 0xd21f7) >>> 0);
    const GEN: Partial<Record<DriftTrackId, () => V2[]>> = { docks: docksPts, touge: tougePts, skidpad: skidpadPts, gymkhana: gymkhanaPts, airfield: airfieldPts, harbor: harborPts, carpark: carparkPts, street: streetPts };
    const ctrl = GEN[id]?.() ?? randomPts(rng);
    this.base = id === 'harbor' ? 3 : 5;
    this.rects = RECTS[id] ?? [];
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
        : id === 'airfield' ? (Math.abs(this.pz[i]) < 14 && Math.abs(this.px[i]) < 300 ? 28 : 20)
        : id === 'harbor' ? 14 + 4 * clamp(t / 1.2, 0, 1)
        : id === 'carpark' ? 12 + 4 * clamp(t / 1.2, 0, 1)
        : id === 'street' ? 9 + 2 * clamp(t / 1.2, 0, 1)
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
    else if (id === 'airfield') this.dressAirfield();
    else if (id === 'harbor') this.dressHarbor();
    else if (id === 'carpark') this.dressCarpark();
    else if (id === 'street') this.dressStreet();
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
    let d = this.roadDist0(x, z);
    for (const q of this.rects) d = Math.min(d, rectDist(q, x, z));
    return d;
  }

  roadHeight(x: number, z: number) {
    if (this.rects.length) {
      // flat lots / yards / water basins: whichever is closer than the course itself sets the height
      let best = this.roadDist0(x, z), y = NaN;
      if (best > ROAD.asphalt) for (const q of this.rects) { const d = rectDist(q, x, z); if (d < best) { best = d; y = q.y; } }
      if (!Number.isNaN(y)) return y;
    }
    if (!this.climb) return this.base;
    const { i } = this.nearest(x, z);
    if (i < 0) return this.base;
    const f = ((x - this.px[i]) * this.tx[i] + (z - this.pz[i]) * this.tz[i]) / this.spacing;
    return this.elev(i + clamp(f, -1, 1));
  }

  /** Course-only roadDist (no lots). */
  private roadDist0(x: number, z: number) {
    const r = this.nearest(x, z);
    return r.i < 0 ? 1e9 : Math.max(0, r.d - this.halfWidth[r.i] + ROAD.asphalt);
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
      if (gy < 0.5 && !p.abs) continue; // under water
      let b = buckets.get(p.p);
      if (!b) buckets.set(p.p, (b = { m: [], c: [] }));
      if (p.t) _q.setFromEuler(_e.set(p.t, p.h, 0, 'YXZ'));
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
  /** Put a part in a local frame (anchor ax/az, heading h): u forward, v sideways. Ground is taken under the anchor. */
  private putL(p: PartId, ax: number, az: number, h: number, u: number, v: number, y: number, dh: number, sx: number, sy: number, sz: number, c: number, extra?: { t?: number; abs?: boolean }) {
    const s = Math.sin(h), co = Math.cos(h);
    this.props.push({ p, x: ax + s * u + co * v, z: az + co * u - s * v, y, h: h + dh, sx, sy, sz, c, gx: ax, gz: az, ...extra });
  }
  private solidL(ax: number, az: number, h: number, u: number, v: number, r: number, top: number) {
    const s = Math.sin(h), co = Math.cos(h);
    this.solid(ax + s * u + co * v, az + co * u - s * v, r, top);
  }
  private solid(x: number, z: number, r: number, top: number) { this.solids.push({ x, z, r, top }); }
  /**
   * Straight wall from (x, z) to (x2, z2) as capsule colliders (no dents or gaps along it), split into pieces of at
   * most 8 m so every piece is found from the chunks around its start.
   */
  private seg(x: number, z: number, x2: number, z2: number, r: number, top: number) {
    const k = Math.max(1, Math.ceil(Math.hypot(x2 - x, z2 - z) / 8));
    for (let j = 0; j < k; j++)
      this.solids.push({ x: x + ((x2 - x) * j) / k, z: z + ((z2 - z) * j) / k, x2: x + ((x2 - x) * (j + 1)) / k, z2: z + ((z2 - z) * (j + 1)) / k, r, top });
  }
  /** Capsule along heading h centred on (x, z): half core length u. */
  private segH(x: number, z: number, h: number, u: number, r: number, top: number) {
    const s = Math.sin(h) * u, c = Math.cos(h) * u;
    this.seg(x - s, z - c, x + s, z + c, r, top);
  }

  /** A container stack, long axis along heading h. */
  private container(x: number, z: number, h: number, levels: number, key: number, solid: boolean) {
    for (let l = 0; l < levels; l++) {
      const c = CONTAINER_COLS[Math.floor(hash01(key, l, this.seed) * CONTAINER_COLS.length)];
      this.put('cont', x, z, 1.3 + l * 2.6, h + (l % 2 ? 0.02 : 0), 2.44, 2.6, 6.06, c);
    }
    if (solid) this.segH(x, z, h, 1.8, 1.25, levels * 2.6); // 6.06 x 2.44 box
  }
  private barrier(x: number, z: number, h: number, c = CONCRETE, top = 0.9) {
    this.put('box', x, z, 0.45, h, 0.6, 0.9, 3, c);
    this.segH(x, z, h, 1.15, 0.35, top); // the 3 m k-rail itself (a fat circle used to narrow the road and snag)
  }
  private tyreStack(x: number, z: number, levels: number, c: number) {
    for (let l = 0; l < levels; l++) this.put('tyre', x, z, 0.25 + l * 0.5, 0, 1, 1, 1, l % 2 ? WHITE : c);
    this.solid(x, z, 0.8, levels * 0.5);
  }
  private cone(x: number, z: number, c = CONE) { this.put('cone', x, z, 0.38, 0, 1, 0.75, 1, c); }
  private pole(x: number, z: number, faceH: number, ht = 14) {
    this.put('cyl', x, z, ht / 2, 0, 0.2, ht, 0.2, STEEL);
    this.put('lamp', x + Math.sin(faceH) * 0.8, z + Math.cos(faceH) * 0.8, ht + 0.1, faceH, 0.9, 0.3, 1.8, 0xfff1c4, x, z);
    this.solid(x, z, 0.5, ht);
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
    const spots = SPOTS[id];
    const maxZ = spots ? 6 : id === 'skidpad' ? 2 : id === 'gymkhana' || id === 'random' ? 4 : 5;
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
    const len = (r: Run) => (r.k1 - r.k0 + 1) * this.spacing;
    const pad = Math.round(10 / this.spacing);
    const runMult = (r: Run) => clamp(Math.round((1.1 + r.peak * 0.55 + Math.min(0.4, len(r) / 300)) * 10) / 10, 1.2, 2.5);
    if (spots) {
      const used = new Set<Run>();
      for (const [name, x, z, m, L] of spots) {
        const c = this.nearest(x, z, true).i;
        if (L) {
          const w = Math.round(L / 2 / this.spacing);
          this.zones.push({ name, i0: (c - w + n) % n, i1: (c + w) % n, mult: m ?? 1.6 });
          this.apex.push(-1);
          continue;
        }
        let best: Run | null = null, bd = 120;
        for (const r of runs) {
          if (used.has(r)) continue;
          const d = Math.hypot(this.px[r.pi] - x, this.pz[r.pi] - z);
          if (d < bd) { bd = d; best = r; }
        }
        if (best) {
          used.add(best);
          this.zones.push({ name, i0: (s0 + best.k0 - pad + 2 * n) % n, i1: (s0 + best.k1 + pad) % n, mult: m ?? runMult(best) });
          this.apex.push(best.pi);
        } else {
          const w = Math.round(25 / this.spacing);
          let ap = c;
          for (let j = -w; j <= w; j++) { const i = (c + j + n) % n; if (Math.abs(a[i]) > Math.abs(a[ap])) ap = i; }
          this.zones.push({ name, i0: (c - w + n) % n, i1: (c + w) % n, mult: m ?? 1.8 });
          this.apex.push(Math.abs(a[ap]) > 0.3 ? ap : -1);
        }
      }
      return;
    }
    let hp = 0;
    for (const r of runs) if (r.peak > 1.1) r.ord = ++hp;
    const pick = [...runs].sort((p, q) => q.peak * (1 + len(q) / 120) - p.peak * (1 + len(p) / 120)).slice(0, maxZ).sort((p, q) => p.k0 - q.k0);
    const NAMES: Record<DriftTrackId, string[]> = {
      docks: ['Crane Corner', 'Quay Hairpin', 'Container Alley', 'Reefer Bend', 'Gantry Sweep'],
      touge: [],
      skidpad: [],
      gymkhana: ['Slalom Exit', 'Barrier Hook', 'Container Corner', 'Cone Carousel'],
      airfield: [], harbor: [], carpark: [], street: [],
      random: ['Sector A', 'Sector B', 'Sector C', 'Sector D', 'Sector E'],
    };
    pick.forEach((r, k) => {
      const name = id === 'touge' ? (r.ord ? `Hairpin ${r.ord}` : k === pick.length - 1 ? 'Valley Esses' : 'Ridge S-Bends')
        : id === 'skidpad' ? (this.px[r.pi] > 0 ? 'East Circle' : 'West Circle')
        : NAMES[id][k];
      this.zones.push({ name, i0: (s0 + r.k0 - pad + 2 * n) % n, i1: (s0 + r.k1 + pad) % n, mult: runMult(r) });
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
    let railI = -9, railS = 0, railX = 0, railZ = 0;
    for (let i = 0; i < n; i += 2) {
      const t = this.turn[i];
      if (Math.abs(t) < 0.35) continue;
      const side = t > 0 ? 1 : -1, hw = this.halfWidth[i], h = this.h(i);
      // guard rail on the outside of the bend
      const [x, z] = this.at(i, side * (hw + 1));
      if (this.edge(x, z) > 0.4) {
        this.put('box', x, z, 0.75, h, 0.12, 0.34, this.spacing * 2 + 0.2, 0xc9ced4);
        this.put('box', x, z, 0.45, h, 0.16, 0.9, 0.16, 0x8a9199);
        // one continuous rail: link to the previous post on the same side, else a rail-length piece
        if (railI === i - 2 && railS === side) this.seg(railX, railZ, x, z, 0.3, 1);
        else this.segH(x, z, h, this.spacing, 0.3, 1);
        railI = i; railS = side; railX = x; railZ = z;
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

  private dressAirfield() {
    const n = this.n, every = (m: number) => Math.max(1, Math.round(m / this.spacing));
    const onRunway = (i: number) => Math.abs(this.pz[i]) < 14 && Math.abs(this.px[i]) < 300;
    // runway centre-line dashes
    for (let i = 0; i < n; i += every(30)) {
      if (Math.abs(this.pz[i]) > 6 || Math.abs(this.px[i]) > 200) continue;
      this.put('paint', this.px[i], this.pz[i], 0.06, this.h(i), 0.9, 0.04, 15, WHITE);
    }
    // thresholds: piano keys each side of the centre line + runway numbers, readable from the approach
    for (const [tx, num] of [[-245, 'rw09'], [255, 'rw27']] as const) {
      const i = this.nearest(tx, 0, true).i, hw = this.halfWidth[i], h = this.h(i), x = this.px[i], z = this.pz[i];
      for (const side of [-1, 1]) this.putL('piano', x, z, h, 0, side * hw * 0.5, 0.05, 0, hw - 4, 0.03, 30, WHITE);
      this.putL(num, x, z, h, tx < 0 ? 34 : -34, 0, 0.06, tx < 0 ? PI : 0, 14, 0.03, 18, WHITE);
    }
    // edge lights: white on the runway, blue on the taxiways
    for (let i = 0; i < n; i += every(30)) {
      for (const side of [-1, 1]) {
        const [x, z] = this.at(i, side * (this.halfWidth[i] + 0.8));
        if (this.edge(x, z) < 0.5) continue;
        this.put('cyl', x, z, 0.3, 0, 0.08, 0.6, 0.08, STEEL);
        this.put('lamp', x, z, 0.7, 0, 0.3, 0.25, 0.3, onRunway(i) ? 0xfff6dd : 0x3f7bff);
      }
    }
    // cone chicane walls on the runway, from alternate edges (leaves 40 m+ clear)
    for (const [cx, sgn] of [[30, -1], [110, 1]] as const) {
      const i = this.nearest(cx, 0, true).i, hw = this.halfWidth[i];
      for (let o = hw - 1; o > hw - 15; o -= 2) { const [x, z] = this.at(i, sgn * o); this.cone(x, z); }
    }
    // hangars east of the sweep, doors facing the course
    for (const hz of [10, 70, 130]) {
      const hx = 435, h = -PI / 2;
      this.putL('arch', hx, hz, h, 0, 0, 0, 0, 18, 14, 40, 0xb8bec6);
      this.putL('box', hx, hz, h, 20.1, 0, 6, 0, 26, 12, 0.4, 0x4a5058);
      this.putL('box', hx, hz, h, -20.1, 0, 6, 0, 34, 12, 0.4, 0x8a9199);
      for (const u of [-12, 0, 12]) for (const v of [-9, 9]) this.solidL(hx, hz, h, u, v, 9, 14);
    }
    // parked jets on the apron
    const livery = [0xd8322a, 0x2c6fb7, 0x2e8b57];
    let jets = 0;
    for (const [x, z, h] of [[-60, 262, 2.4], [-270, 300, 0.4], [-60, 312, 2.4], [-255, 205, 0.9], [-175, 236, 1.6]]) {
      if (jets >= 3 || this.edge(x, z) < 17) continue;
      this.jet(x, z, h, livery[jets++]);
    }
    // control tower + windsock between runway and taxiway
    this.put('cyl', 0, 75, 13, 0, 2.5, 26, 2.5, 0xd9d6cf);
    this.put('glass', 0, 75, 28.5, PI / 4, 9, 5, 9, 0xffffff);
    this.put('box', 0, 75, 31.4, PI / 4, 10, 0.8, 10, 0x2b2f38);
    this.put('cyl', 0, 75, 34.3, 0, 0.1, 5, 0.1, STEEL);
    this.solid(0, 75, 3, 31);
    const wx = 170, wz = 62, wh = hash01(3, 3, this.seed) * TAU;
    this.put('cyl', wx, wz, 3.5, 0, 0.1, 7, 0.1, STEEL);
    this.putL('coneZ', wx, wz, wh, 1.7, 0, 6.6, 0, 0.6, 0.6, 3.2, CONE);
    this.putL('cylZ', wx, wz, wh, 1.2, 0, 6.6, 0, 0.56, 0.56, 0.5, WHITE);
    this.putL('cylZ', wx, wz, wh, 2.3, 0, 6.6, 0, 0.42, 0.42, 0.5, WHITE);
    this.solid(wx, wz, 0.4, 7);
    this.poles(80, 6);
  }

  /** Low-poly airliner: fuselage, nose/tail cones, low wings with engines, fin and stabiliser. Solid. */
  private jet(x: number, z: number, h: number, c: number) {
    const L = (p: PartId, u: number, v: number, y: number, dh: number, sx: number, sy: number, sz: number, col: number) => this.putL(p, x, z, h, u, v, y, dh, sx, sy, sz, col);
    L('cylZ', 0, 0, 3.2, 0, 1.8, 1.8, 24, WHITE);
    L('coneZ', 14.5, 0, 3.2, 0, 1.8, 1.8, 5, WHITE);
    L('coneZ', -14.5, 0, 3.5, PI, 1.5, 1.5, 5, WHITE);
    L('box', 0, 0, 3.4, 0, 3.66, 0.45, 22, c);
    L('glass', 13.2, 0, 4.2, 0, 2, 0.5, 1.2, 0xffffff);
    L('box', 1, 0, 2.4, 0, 28, 0.35, 5, 0xd8dde3);
    L('box', -14.5, 0, 4, 0, 10, 0.25, 2.6, 0xd8dde3);
    L('box', -14.8, 0, 7.4, 0, 0.35, 6, 3.6, c);
    for (const v of [-6.5, 6.5]) L('cylZ', 2.5, v, 1.5, 0, 0.9, 0.9, 4, 0x9aa3ad);
    for (const u of [-10, -3, 4, 11]) this.solidL(x, z, h, u, 0, 2.2, 5);
    for (const v of [-9, 9]) this.solidL(x, z, h, 1, v, 2.5, 3);
  }

  private dressHarbor() {
    // quay walls with a yellow edge line and bollards wherever land meets the basin
    const wall = (x0: number, z0: number, x1: number, z1: number, ox: number, oz: number) => {
      const k = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 3)), h = Math.atan2(x1 - x0, z1 - z0);
      for (let j = 0; j < k; j++) {
        const t = (j + 0.5) / k, x = x0 + (x1 - x0) * t - ox * 0.5, z = z0 + (z1 - z0) * t - oz * 0.5;
        if (this.edge(x, z) < 0.3) continue;
        this.put('box', x, z, 0.5, h, 0.8, 1, 3.05, CONCRETE);
        this.put('paint', x - ox * 1.1, z - oz * 1.1, 0.05, h, 0.3, 0.04, 3.05, 0xffd23f);
        if (j % 4 === 0) this.put('cyl', x, z, 1.3, 0, 0.3, 0.6, 0.3, 0x2b2f38);
        this.segH(x, z, h, 1.5, 0.45, 1);
      }
    };
    wall(-420, -16, 252, -16, 0, -1);
    wall(370, -16, 420, -16, 0, -1);
    wall(252, -16, 252, -222, -1, 0);
    wall(370, -16, 370, -222, 1, 0);
    wall(252, -222, 370, -222, 0, -1);

    // moored freighter alongside the quay (stands in the water: absolute heights)
    const AX = -80, AZ = -32, AH = PI / 2, abs = { abs: true };
    const S = (p: PartId, u: number, v: number, y: number, dh: number, sx: number, sy: number, sz: number, c: number, t = 0) =>
      this.putL(p, AX, AZ, AH, u, v, y, dh, sx, sy, sz, c, t ? { abs: true, t } : abs);
    S('box', 0, 0, 1.5, 0, 26, 15, 170, 0x26323f);
    S('box', 0, 0, 0.3, 0, 26.2, 1.2, 170.2, 0xa8322a);
    S('box', 85, 0, 1.5, PI / 4, 18, 15, 18, 0x26323f);
    S('box', -68, 0, 17, 0, 22, 16, 16, WHITE);
    S('glass', -61, 0, 23, 0, 22.4, 2, 1, 0xffffff);
    S('box', -63, 0, 25.4, 0, 32, 0.6, 5, WHITE);
    S('box', -78, 0, 29, 0, 5, 8, 6, RED);
    for (let u = -50; u <= 60; u += 6.6)
      for (let k = 0; k < 9; k++) {
        const r = hash01(Math.round(u * 10), k, this.seed), lv = 1 + Math.floor(r * 3);
        for (let l = 0; l < lv; l++) S('cont', u, -10.4 + k * 2.6, 10.3 + l * 2.6, 0, 2.44, 2.6, 6.06, CONTAINER_COLS[Math.floor(hash01(k, l + Math.round(u), this.seed) * CONTAINER_COLS.length)]);
      }
    for (const u of [-35, 5, 45]) {
      S('cyl', u, -11, 13, 0, 1, 8, 1, 0xe6b422);
      S('box', u, -19, 21, -PI / 2, 1, 1, 22, 0xe6b422, -0.45);
    }

    // ferry ramp at the west end of the quay, ferry waiting at the bottom
    this.putL('box', -300, -30, PI, 0, 0, 0.2, 0, 12, 0.6, 30, 0x4a5058, { abs: true, t: 0.2 });
    for (const v of [-6, 6]) this.putL('box', -300, -30, PI, 0, v, 1.1, 0, 0.3, 1.2, 30, 0xffd23f, { abs: true, t: 0.2 });
    this.putL('box', -300, -72, PI, 0, 0, 1, 0, 18, 6, 44, WHITE, abs);
    this.putL('box', -300, -72, PI, -6, 0, 6, 0, 16, 4, 22, 0x2c6fb7, abs);
    this.putL('glass', -300, -72, PI, 4, 0, 6.4, 0, 16.2, 1.2, 1, 0xffffff, abs);

    // lighthouse at the pier end
    const LX = 311, LZ = -208;
    for (let k = 0; k < 6; k++) this.put('cyl', LX, LZ, 1.7 + k * 3.4, 0, 3.2 - k * 0.25, 3.4, 3.2 - k * 0.25, k % 2 ? WHITE : RED, LX, LZ);
    this.put('cyl', LX, LZ, 20.6, 0, 3, 0.4, 3, 0x2b2f38, LX, LZ);
    this.put('lamp', LX, LZ, 22, 0, 2.2, 2.4, 2.2, 0xfff6c0, LX, LZ);
    this.put('cone', LX, LZ, 24.6, 0, 7, 2.8, 7, RED, LX, LZ);
    this.solid(LX, LZ, 3.6, 25);

    // warehouse sheds on the land side of warehouse row
    for (let cx = -324; cx <= 324; cx += 72) {
      if (this.edge(cx, 185) < 4) continue;
      this.put('cont', cx, 205, 7, 0, 60, 14, 40, hash01(cx, 2, this.seed) < 0.5 ? 0xb8c4cc : 0x9fb3a6);
      this.put('box', cx, 205, 14.6, 0, 61, 1.2, 41, 0x6b7078);
      this.put('box', cx, 184.8, 4.5, 0, 12, 9, 0.4, 0x3b4048, cx, 205);
      for (const dx of [-20, 0, 20]) this.solid(cx + dx, 205, 20, 14);
    }
    // reefer stacks in the infield
    for (const zr of [40, 42.6, 45.2, 47.8, 80, 82.6, 85.2, 87.8])
      for (let x = -230; x <= 230; x += 6.6) {
        if (this.edge(x, zr) < 4 || hash01(Math.round(x * 10), Math.round(zr * 10), this.seed) < 0.15) continue;
        const lv = 1 + Math.floor(hash01(Math.round(x), Math.round(zr), this.seed ^ 5) * 3);
        for (let l = 0; l < lv; l++) this.put('cont', x, zr, 1.3 + l * 2.6, PI / 2, 2.44, 2.6, 6.06, (l + Math.round(x)) % 3 ? 0xe8ecef : 0xbfd8e8);
        this.solid(x, zr, 3.2, lv * 2.6);
      }
    // fishing crates and barrels near the quay
    for (const [cx, cz] of [[-210, 26], [-30, 26], [150, 26], [210, 100], [-200, 100]]) {
      for (let k = 0; k < 6; k++) {
        const x = cx + (hash01(cx, k, this.seed) - 0.5) * 8, z = cz + (hash01(cz, k, this.seed) - 0.5) * 6;
        if (this.edge(x, z) < 2) continue;
        if (k % 3 === 2) this.put('barrel', x, z, 0.65, 0, 1, 1, 1, k % 2 ? BLUE : 0x3d7a8c);
        else for (let l = 0; l < 2; l++) this.put('box', x, z, 0.4 + l * 0.8, k * 0.7 + l * 0.2, 1.2, 0.8, 0.9, (k + l) % 2 ? 0x2c6fb7 : 0xe67e22);
        this.solid(x, z, 0.8, 1.6);
      }
    }
    this.poles(50);
  }

  private dressCarpark() {
    const R = this.rects[0], CARS = [0xc0392b, 0x2c5f9e, 0xf4f4f4, 0x1d1d1f, 0x8a9199, 0xe6b422, 0x2e8b57, 0x6b3fa0];
    // painted bays with parked cars (two rows back to back per block, aisles between)
    for (let zc = R.z0 + 12; zc < 140; zc += 17)
      for (let xc = R.x0 + 8; xc < R.x1 - 8; xc += 11.2) {
        const e = this.edge(xc, zc);
        if (e < 8 || e > 50) continue;
        this.put('bays', xc, zc, 0.04, 0, 11.2, 0.03, 11, WHITE);
        for (let k = 0; k < 4; k++)
          for (const side of [-1, 1]) {
            const x = xc - 4.2 + k * 2.8, z = zc + side * 2.75;
            if (hash01(Math.round(x * 10), Math.round(z * 10), this.seed) < 0.28) continue;
            const c = CARS[Math.floor(hash01(Math.round(x), Math.round(z), this.seed ^ 77) * CARS.length)], h = side > 0 ? 0 : PI;
            this.put('box', x, z, 0.65, h, 1.8, 0.8, 4.3, c);
            this.put('box', x, z, 1.35, h, 1.6, 0.6, 2.2, 0x1b2230);
            this.solid(x, z, 1.9, 1.6);
          }
      }
    // lot lights in every other aisle
    for (let zc = R.z0 + 12; zc < 140; zc += 34)
      for (let x = R.x0 + 15; x < R.x1; x += 45) {
        const z = zc + 8.5;
        if (this.edge(x, z) > 2) this.pole(x, z, 0, 10);
      }
    // the mall: facade blocks, glass entrance, neon sign over the door
    for (let x = -108; x <= 108; x += 24) this.put('facade', x, 180, 9, 0, 24, 18, 56, x % 48 ? 0xffffff : 0xe6ddd0, 0, 180);
    this.put('box', 0, 180, 18.4, 0, 242, 0.8, 58, 0x3b4048);
    this.put('glass', 0, 151.6, 3.5, 0, 30, 7, 1, 0xffffff, 0, 180);
    this.put('neon', 0, 151.4, 13.5, PI, 40, 6, 0.6, 0xffffff, 0, 180);
    this.seg(-120, 154, 120, 154, 3, 18);
    for (const x of [-118, 118]) this.seg(x, 159, x, 206, 3, 18);
    // cone gates down the bay row, tyre stacks on the inside of the mall hairpin
    this.zones.forEach((zn, k) => {
      if (zn.name === 'Bay Row') {
        const cnt = (zn.i1 - zn.i0 + this.n) % this.n;
        for (let s = 10; s < cnt; s += Math.round(25 / this.spacing))
          for (const side of [-1, 1]) { const [x, z] = this.at(zn.i0 + s, side * (this.halfWidth[(zn.i0 + s) % this.n] - 1.5)); this.cone(x, z); }
      }
      const ap = this.apex[k];
      if (zn.name === 'Mall Hairpin' && ap >= 0) {
        const inner = this.turn[ap] > 0 ? -1 : 1;
        for (let j = -4; j <= 4; j += 2) {
          const i = (ap + j + this.n) % this.n, [x, z] = this.at(i, inner * (this.halfWidth[i] + 1.5));
          if (this.edge(x, z) > 0.5) this.tyreStack(x, z, 3, RED);
        }
      }
    });
  }

  private dressStreet() {
    const n = this.n, bstep = Math.max(1, Math.round(3 / this.spacing));
    // k-rail on both sides, catch fence behind
    for (let i = 0; i < n; i += bstep) {
      const h = this.h(i), hw = this.halfWidth[i];
      for (const side of [-1, 1]) {
        const [x, z] = this.at(i, side * (hw + 0.8));
        if (this.edge(x, z) < 0.3) continue;
        const [fx, fz] = this.at(i, side * (hw + 1.7)), fence = this.edge(fx, fz) > 1;
        this.barrier(x, z, h, (i / bstep) % 2 ? CONCRETE : 0xe9e6df, fence ? 4.9 : 0.9); // tall: the chase camera stays in front of the catch fence
        if (fence) this.put('fence', fx, fz, 2.9, h, 0.05, 4, bstep * this.spacing + 0.1, WHITE);
      }
    }
    // city blocks: stacked facade sections with lit windows
    const TINTS = [0xffffff, 0xe6ddd0, 0xd0dbe6, 0xe0d0c8];
    for (let gx = -286; gx <= 286; gx += 28)
      for (let gz = -196; gz <= 186; gz += 28) {
        const r = hash01(gx, gz, this.seed), w = 18 + r * 6, e = this.edge(gx, gz);
        if (e < w * 0.72 + 3 || e > 90) continue;
        const lv = 1 + Math.floor(hash01(gz, gx, this.seed ^ 9) * 4), tint = TINTS[Math.floor(r * 97) % TINTS.length];
        for (let l = 0; l < lv; l++) this.put('facade', gx, gz, 6 + l * 12, 0, w, 12, w, tint);
        this.put('box', gx, gz, lv * 12 + 0.4, 0, w + 0.6, 0.8, w + 0.6, 0x3b4048);
        this.solid(gx, gz, w * 0.6, lv * 12);
      }
    // crosswalks before and after every corner
    const all: [number, number, number][] = [[-100, -150, 0], ...STREET], L = all.length;
    for (let k = 1; k < L; k++) {
      const [x, z, r] = all[k], [px, pz] = all[k - 1], [nx, nz] = all[(k + 1) % L];
      const li = Math.hypot(x - px, z - pz), lo = Math.hypot(nx - x, nz - z);
      for (const [cx, cz] of [[x - ((x - px) / li) * (r + 7), z - ((z - pz) / li) * (r + 7)], [x + ((nx - x) / lo) * (r + 7), z + ((nz - z) / lo) * (r + 7)]]) {
        const i = this.nearest(cx, cz, true).i;
        this.put('xwalk', this.px[i], this.pz[i], 0.05, this.h(i), 2 * this.halfWidth[i] - 1, 0.03, 4, WHITE);
      }
    }
    // street lamps, alternating sides
    for (let i = 0, k = 0; i < n; i += Math.round(30 / this.spacing), k++) {
      const side = k % 2 ? 1 : -1, [x, z] = this.at(i, side * (this.halfWidth[i] + 3));
      if (this.edge(x, z) > 2) this.pole(x, z, Math.atan2(this.px[i] - x, this.pz[i] - z), 9);
    }
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

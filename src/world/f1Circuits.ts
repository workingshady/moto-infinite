// F1 circuit catalogue + centre-line geometry. Pure (no DOM / WebGL), so it is unit tested in Node and shared by the
// game (F1Track.ts), the setup menu and the tests.
//
// Real circuits come from "f1-circuits" by Tomislav Bacinger (github.com/bacinger/f1-circuits), MIT License,
// Copyright (c) 2019-2025 Tomislav Bacinger (raw points in f1Data.ts). Pipeline: lon/lat -> local metres on the WGS84
// ellipsoid (x = east, z = -north) -> closed centripetal Catmull-Rom -> resampled every 2 m -> corners tighter than the
// circuit's minimum radius relaxed (a fillet inside the traced vertex, never across the track) -> scaled to the
// official lap length (the trace is within ~0.5%). Official lengths, turn counts and directions: formula1.com circuit
// pages / Wikipedia "List of Formula One circuits"; elevation changes: formula1.com "Highs and lows" (2016).
import * as THREE from 'three';
import { F1_TRACK } from '../config';
import { F1_GEO } from './f1Data';

export type F1TrackId =
  | 'monza' | 'silverstone' | 'spa' | 'monaco' | 'suzuka' | 'bahrain'
  | 'interlagos' | 'cota' | 'redbullring' | 'hungaroring' | 'zandvoort' | 'imola' | 'barcelona' | 'montreal'
  | 'singapore' | 'baku' | 'melbourne' | 'lasvegas' | 'jeddah' | 'academy';
export type F1Difficulty = 'easy' | 'medium' | 'hard';
export const F1_DIFFICULTY: Record<F1Difficulty, { label: string; icon: string; rank: number }> = {
  easy: { label: 'Easy', icon: '🟢', rank: 0 },
  medium: { label: 'Medium', icon: '🟡', rank: 1 },
  hard: { label: 'Hard', icon: '🔴', rank: 2 },
};

export interface F1Circuit {
  id: F1TrackId;
  name: string;
  country: string;
  flag: string;
  /** Official lap length (km); the generated line is scaled to it. */
  lengthKm: number;
  /** Official number of corners. */
  turns: number;
  laps: number;
  difficulty: F1Difficulty;
  /** Not a real venue (clearly labelled in the menu). */
  fictional?: boolean;
  blurb: string;
  time: 'day' | 'dawn' | 'sunset' | 'night';
  weather: 'clear' | 'cloudy' | 'rain' | 'fog';
  theme: 'mixed' | 'desert' | 'forest' | 'alpine' | 'islands';
}

/** Order = menu default order: the classic six first (old saves / boards), then the newer venues, then the rookie track. */
export const F1_TRACKS: F1Circuit[] = [
  { id: 'monza', name: 'Monza', country: 'Italy', flag: '🇮🇹', lengthKm: 5.793, turns: 11, laps: 3, difficulty: 'easy', blurb: 'The Temple of Speed: flat-out straights, the Rettifilo chicane, Lesmos, Ascari and the Parabolica.', time: 'day', weather: 'clear', theme: 'forest' },
  { id: 'silverstone', name: 'Silverstone', country: 'Great Britain', flag: '🇬🇧', lengthKm: 5.891, turns: 18, laps: 3, difficulty: 'medium', blurb: 'Old airfield, fast and flowing: Copse, Maggotts, Becketts and Chapel at full commitment.', time: 'day', weather: 'cloudy', theme: 'mixed' },
  { id: 'spa', name: 'Spa-Francorchamps', country: 'Belgium', flag: '🇧🇪', lengthKm: 7.004, turns: 19, laps: 2, difficulty: 'hard', blurb: 'Seven kilometres of Ardennes forest and 100 m of climb: La Source, Eau Rouge-Raidillon, Kemmel, Pouhon and Blanchimont.', time: 'day', weather: 'rain', theme: 'forest' },
  { id: 'monaco', name: 'Monaco', country: 'Monaco', flag: '🇲🇨', lengthKm: 3.337, turns: 19, laps: 5, difficulty: 'hard', blurb: 'Armco inches away on a 10 m wide street, the climb to the Casino, the hairpin, the tunnel and the harbour chicane.', time: 'day', weather: 'clear', theme: 'islands' },
  { id: 'suzuka', name: 'Suzuka', country: 'Japan', flag: '🇯🇵', lengthKm: 5.807, turns: 18, laps: 3, difficulty: 'hard', blurb: 'The figure-8: the Esses, Degner, the Hairpin, Spoon and 130R, crossing over itself.', time: 'sunset', weather: 'clear', theme: 'mixed' },
  { id: 'bahrain', name: 'Bahrain', country: 'Bahrain', flag: '🇧🇭', lengthKm: 5.412, turns: 15, laps: 3, difficulty: 'easy', blurb: 'Desert night race under floodlights, wide run-offs. Big stops into Turn 1, 4 and 10.', time: 'night', weather: 'clear', theme: 'desert' },
  { id: 'interlagos', name: 'Interlagos', country: 'Brazil', flag: '🇧🇷', lengthKm: 4.309, turns: 15, laps: 3, difficulty: 'medium', blurb: 'Anticlockwise bowl in São Paulo: the Senna S downhill, the infield twists and the long climb to the line.', time: 'day', weather: 'cloudy', theme: 'mixed' },
  { id: 'cota', name: 'Circuit of the Americas', country: 'USA', flag: '🇺🇸', lengthKm: 5.513, turns: 20, laps: 3, difficulty: 'medium', blurb: 'Austin: the steep climb to the Turn 1 hairpin, Silverstone-style esses and a 1 km back straight.', time: 'day', weather: 'clear', theme: 'desert' },
  { id: 'redbullring', name: 'Red Bull Ring', country: 'Austria', flag: '🇦🇹', lengthKm: 4.318, turns: 10, laps: 4, difficulty: 'easy', blurb: 'Short and simple: three uphill straights and ten corners in the Styrian hills. Great first real circuit.', time: 'day', weather: 'clear', theme: 'alpine' },
  { id: 'hungaroring', name: 'Hungaroring', country: 'Hungary', flag: '🇭🇺', lengthKm: 4.381, turns: 14, laps: 3, difficulty: 'medium', blurb: 'Twisty and narrow, "Monaco without the walls": one real straight, then corner after corner in a valley.', time: 'day', weather: 'clear', theme: 'mixed' },
  { id: 'zandvoort', name: 'Zandvoort', country: 'Netherlands', flag: '🇳🇱', lengthKm: 4.259, turns: 14, laps: 3, difficulty: 'medium', blurb: 'Rollercoaster in the dunes by the North Sea, with the banked Hugenholtz and Arie Luyendyk corners.', time: 'day', weather: 'cloudy', theme: 'islands' },
  { id: 'imola', name: 'Imola', country: 'Italy', flag: '🇮🇹', lengthKm: 4.909, turns: 19, laps: 3, difficulty: 'medium', blurb: 'Old-school and anticlockwise: Tamburello, Tosa, Piratella, Acque Minerali and the Rivazza.', time: 'day', weather: 'clear', theme: 'forest' },
  { id: 'barcelona', name: 'Barcelona-Catalunya', country: 'Spain', flag: '🇪🇸', lengthKm: 4.657, turns: 14, laps: 3, difficulty: 'medium', blurb: 'The test track everybody knows: a long main straight, the fast Turn 3 and the flowing final sector.', time: 'day', weather: 'clear', theme: 'mixed' },
  { id: 'montreal', name: 'Gilles Villeneuve', country: 'Canada', flag: '🇨🇦', lengthKm: 4.361, turns: 14, laps: 3, difficulty: 'medium', blurb: 'Island park in Montreal: chicanes, hairpin, the long back straight and the Wall of Champions.', time: 'day', weather: 'clear', theme: 'forest' },
  { id: 'singapore', name: 'Marina Bay', country: 'Singapore', flag: '🇸🇬', lengthKm: 4.94, turns: 19, laps: 3, difficulty: 'hard', blurb: 'Night street race under the lights: 19 corners between the walls, past the Singapore Flyer.', time: 'night', weather: 'clear', theme: 'mixed' },
  { id: 'baku', name: 'Baku City', country: 'Azerbaijan', flag: '🇦🇿', lengthKm: 6.003, turns: 20, laps: 2, difficulty: 'hard', blurb: 'Through the old town and the 7.6 m castle section, then a 2 km flat-out run along the Caspian.', time: 'sunset', weather: 'clear', theme: 'desert' },
  { id: 'melbourne', name: 'Albert Park', country: 'Australia', flag: '🇦🇺', lengthKm: 5.278, turns: 14, laps: 3, difficulty: 'medium', blurb: 'Fast park lap around the lake in Melbourne, with quick chicanes and four straight-mode zones.', time: 'day', weather: 'clear', theme: 'mixed' },
  { id: 'lasvegas', name: 'Las Vegas', country: 'USA', flag: '🇺🇸', lengthKm: 6.201, turns: 17, laps: 2, difficulty: 'medium', blurb: 'Saturday night on the Strip: a 1.9 km flat-out blast past the casinos and the Sphere.', time: 'night', weather: 'clear', theme: 'desert' },
  { id: 'jeddah', name: 'Jeddah Corniche', country: 'Saudi Arabia', flag: '🇸🇦', lengthKm: 6.174, turns: 27, laps: 2, difficulty: 'hard', blurb: 'Fastest street circuit: blind walled sweepers at 250 km/h along the Red Sea, under floodlights.', time: 'night', weather: 'clear', theme: 'desert' },
  { id: 'academy', name: 'Rookie Ring', country: 'Fictional', flag: '🎓', lengthKm: 3.335, turns: 8, laps: 3, difficulty: 'easy', fictional: true, blurb: 'Fictional F1 Academy training track: 16 m wide, gentle corners, long straights and huge run-off. Learn the car here.', time: 'day', weather: 'clear', theme: 'mixed' },
];

// ---------------------------------------------------------------------------------------------- shape parameters

export type F1Dress = 'monza' | 'pitRoof' | 'monaco' | 'suzuka' | 'city' | 'wheel' | 'tower' | 'sphere' | 'dunes';
export interface F1Shape {
  /** Typical track width (m). */
  width: number;
  /** Local width changes: [from m, to m, width m] (e.g. Baku castle section). */
  narrow?: [number, number, number][];
  /** Tightest centre-line radius kept (m); tighter traced vertices are relaxed. */
  minR: number;
  /** Real elevation change (m), max - min over the lap. */
  elevRange: number;
  /** Ground height of the start line above sea level in game metres (keeps the lowest point above water). */
  base: number;
  /** [distance from the line (m), height relative to the line (m)] keyframes; last = lap length. */
  elev: [number, number][];
  /** Number of DRS / straight-mode zones (real count). */
  drs: number;
  /** Pit lane range around the line, metres [before, after]. */
  pit: [number, number];
  /** Raw point index of the start line (default 0) and whether the raw order runs against the race direction. */
  start?: number;
  reverse?: boolean;
  /** Real figure-8 crossovers (count). Any other self-intersection is a bug. */
  crossovers?: number;
  /** Street circuit: walls right at the edge, no gravel traps. */
  street?: boolean;
  trees?: 'pine' | 'park';
  lights?: boolean;
  dress?: F1Dress[];
}

/** Elevation: profiles approximate the real circuits (relative to the start line). */
export const F1_SHAPES: Record<F1TrackId, F1Shape> = {
  monza: { width: 14, minR: 14, elevRange: 12.8, base: 6, elev: [[0, 0], [600, 1], [1600, -4], [2400, -8], [3000, -9], [3700, -5], [4400, 0], [5100, 3.5], [5793, 0]], drs: 2, pit: [380, 300], trees: 'park', dress: ['monza'] },
  silverstone: { width: 15, minR: 14, elevRange: 11.3, base: 6, elev: [[0, 0], [700, -3], [1700, 3], [2600, 7], [3500, 4], [4300, 0], [5000, -4], [5891, 0]], drs: 2, pit: [380, 300], dress: ['pitRoof'] },
  spa: { width: 14, minR: 14, elevRange: 102.2, base: 52, elev: [[0, 0], [280, 4], [700, -36], [1000, -10], [1500, 18], [2100, 56], [2500, 52], [2950, 32], [3400, 8], [4000, -12], [4600, -44], [5300, -38], [5900, -24], [6600, -8], [7004, 0]], drs: 2, pit: [330, 250], trees: 'pine' },
  monaco: { width: 10, street: true, narrow: [[1130, 1240, 8]], minR: 9, elevRange: 42, base: 4, elev: [[0, 0], [200, 1], [450, 14], [650, 30], [850, 42], [1000, 36], [1100, 30], [1180, 28.5], [1320, 26.5], [1450, 12], [1700, 3], [2050, 1], [2400, 0], [3337, 0]], drs: 1, pit: [260, 160], start: 119, dress: ['monaco'] },
  suzuka: { width: 13, minR: 13, elevRange: 40.4, base: 8, elev: [[0, 0], [450, -6], [900, 2], [1500, 14], [1800, 18], [2320, 14], [2700, 6], [3200, 20], [3650, 31], [4100, 28], [4690, 16], [5150, 8], [5807, 0]], drs: 1, pit: [380, 300], crossovers: 1, dress: ['suzuka'] },
  bahrain: { width: 15, minR: 18, elevRange: 16.9, base: 6, elev: [[0, 0], [700, 2], [1400, 9], [2200, 13], [3000, 8], [3800, 1], [4500, -3], [5412, 0]], drs: 3, pit: [380, 300], lights: true },
  interlagos: { width: 13, minR: 14, elevRange: 43, base: 12, elev: [[0, 0], [250, -6], [570, -22], [1300, -36], [1800, -24], [2100, -18], [2400, -24], [2700, -34], [3200, -45], [3700, -24], [4309, 0]], drs: 2, pit: [320, 260], trees: 'park', dress: ['city'] },
  cota: { width: 15, minR: 14, elevRange: 30.9, base: 8, elev: [[0, 0], [300, 28], [550, 20], [1100, 10], [1650, 6], [2200, 0], [3400, -5], [4200, -3], [5000, -2], [5513, 0]], drs: 2, pit: [380, 300], dress: ['tower'] },
  redbullring: { width: 13, minR: 14, elevRange: 63.5, base: 6, elev: [[0, 0], [300, 8], [800, 42], [1240, 66], [1600, 60], [2036, 50], [2500, 36], [2850, 30], [3600, 12], [3850, 6], [4318, 0]], drs: 3, pit: [380, 280], trees: 'pine' },
  hungaroring: { width: 12, minR: 13, elevRange: 34.7, base: 14, elev: [[0, 0], [450, -12], [850, -4], [1500, 12], [2100, 24], [2700, 18], [3300, 6], [3800, -2], [4381, 0]], drs: 2, pit: [380, 260], trees: 'park' },
  zandvoort: { width: 12, minR: 14, elevRange: 15, base: 8, elev: [[0, 0], [400, 2], [850, 10], [1500, 4], [2100, 14], [2800, 6], [3600, 3], [4259, 0]], drs: 2, pit: [330, 260], dress: ['dunes'] },
  imola: { width: 12, minR: 13, elevRange: 32, base: 12, elev: [[0, 0], [700, -2], [1660, 4], [2300, 26], [2800, 10], [3350, 22], [3900, 10], [4200, -8], [4909, 0]], drs: 1, pit: [380, 300], trees: 'park' },
  barcelona: { width: 14, minR: 14, elevRange: 29.6, base: 6, elev: [[0, 0], [700, -6], [1400, 4], [2000, 14], [2700, 22], [3400, 10], [4100, 4], [4657, 0]], drs: 2, pit: [380, 300], dress: ['pitRoof'] },
  montreal: { width: 12, minR: 13, elevRange: 5.2, base: 4, elev: [[0, 0], [1100, 2], [2200, 5.4], [3300, 1], [4361, 0]], drs: 3, pit: [330, 260], trees: 'park' },
  singapore: { width: 12, street: true, minR: 12, elevRange: 5.3, base: 4, elev: [[0, 0], [1200, 2], [2500, 5.5], [3700, 1], [4940, 0]], drs: 3, pit: [330, 260], reverse: true, lights: true, dress: ['city', 'wheel'] },
  baku: { width: 13, street: true, narrow: [[1990, 2420, 7.6], [4570, 4980, 8]], minR: 11, elevRange: 26.8, base: 4, elev: [[0, 0], [1500, 2], [2000, 8], [2420, 24], [2900, 27], [3600, 18], [4200, 22], [4580, 24], [4980, 8], [5400, 2], [6003, 0]], drs: 2, pit: [330, 260], dress: ['city'] },
  melbourne: { width: 13, minR: 14, elevRange: 2.6, base: 4, elev: [[0, 0], [1300, 1], [2600, 2.6], [4000, 1], [5278, 0]], drs: 4, pit: [380, 300], trees: 'park' },
  lasvegas: { width: 15, street: true, minR: 13, elevRange: 3, base: 4, elev: [[0, 0], [2000, 1.5], [4000, 3], [6201, 0]], drs: 2, pit: [380, 300], lights: true, dress: ['city', 'sphere'] },
  jeddah: { width: 13, street: true, minR: 14, elevRange: 3, base: 4, elev: [[0, 0], [2000, 2], [4000, 3], [6174, 0]], drs: 3, pit: [380, 300], lights: true },
  academy: { width: 16, minR: 40, elevRange: 4, base: 6, elev: [[0, 0], [1200, 3], [2300, 4], [3335, 0]], drs: 2, pit: [380, 300], trees: 'park' },
};

/**
 * Rookie Ring (fictional), control points in metres, race direction, index 0 on the main straight. A long oval with a
 * gentle esses section on the back straight and a sweeping double-apex at the far end; every corner >= 40 m radius.
 */
const ACADEMY: readonly number[] = [
  0, 300, 0, 100, 0, -100, 0, -300, 0, -480, 30, -600, 120, -680, 240, -700, 360, -680, 440, -600, 470, -480,
  470, -330, 430, -220, 370, -120, 380, 0, 440, 100, 470, 230, 470, 400, 440, 540, 360, 640, 250, 680, 150, 660,
  90, 600, 60, 520, 20, 420,
];

// ---------------------------------------------------------------------------------------------- projection

/** WGS84 local radii at latitude `lat` (degrees): meridional M and prime-vertical N, metres. */
export function earthRadii(lat: number) {
  const a = 6378137, e2 = 0.00669437999014, s = Math.sin((lat * Math.PI) / 180), w = 1 - e2 * s * s;
  return { M: (a * (1 - e2)) / Math.pow(w, 1.5), N: a / Math.sqrt(w) };
}

/**
 * Raw f1Data entry -> local metres around the stored origin: x = east = dLon·N·cos(lat), z = -north = -dLat·M.
 * (Equirectangular with the ellipsoid's local radii; the error over a 3 km circuit is below a centimetre per 100 m.)
 */
export function projectGeo(raw: readonly number[]): number[] {
  const lat0 = raw[1], { M, N } = earthRadii(lat0), D = Math.PI / 180 / 1e6, kx = N * Math.cos((lat0 * Math.PI) / 180) * D, kz = M * D;
  const out: number[] = [];
  for (let i = 2; i < raw.length; i += 2) out.push(raw[i] * kx, -raw[i + 1] * kz);
  return out;
}

/** Control points in metres, race direction, index 0 = start line. */
export function f1Outline(id: F1TrackId): number[] {
  const S = F1_SHAPES[id];
  let p = id === 'academy' ? [...ACADEMY] : projectGeo(F1_GEO[id]);
  const m = p.length / 2;
  if (S.start) p = [...p.slice(S.start * 2), ...p.slice(0, S.start * 2)];
  if (S.reverse) {
    const q = [p[0], p[1]];
    for (let k = m - 1; k >= 1; k--) q.push(p[2 * k], p[2 * k + 1]);
    p = q;
  }
  return p;
}

// ---------------------------------------------------------------------------------------------- geometry

export interface F1Line {
  id: F1TrackId;
  n: number;
  length: number;
  spacing: number;
  px: Float32Array; pz: Float32Array; tx: Float32Array; tz: Float32Array;
  /** Half width at each sample (m). */
  hw: Float32Array;
  /** Typical half width (m). */
  halfWidth: number;
  /** Road surface height at each sample (game metres). */
  elev: Float32Array;
  /** Self-crossings as sample index pairs [first pass, second pass] (figure-8 bridges). */
  crossings: [number, number][];
  /** Length of the raw trace before scaling to the official length (m). */
  traceLength: number;
  straights: { a: number; b: number; len: number }[];
  drsZones: { i0: number; i1: number }[];
  /** Sample index where each corner starts (in lap order). */
  corners: number[];
  pit: { i0: number; i1: number; side: 1 | -1 };
}

const mod = (i: number, n: number) => ((i % n) + n) % n;

/** Uniformly resample a closed polyline every ~`step` metres. */
function resample(x: number[], z: number[], step: number): { x: number[]; z: number[]; len: number } {
  const n = x.length, cum = [0];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; cum.push(cum[i] + Math.hypot(x[j] - x[i], z[j] - z[i])); }
  const len = cum[n], m = Math.max(8, Math.round(len / step)), ox: number[] = [], oz: number[] = [];
  let k = 0;
  for (let s = 0; s < m; s++) {
    const d = (s / m) * len;
    while (cum[k + 1] < d) k++;
    const j = (k + 1) % n, u = (d - cum[k]) / (cum[k + 1] - cum[k] || 1);
    ox.push(x[k] + (x[j] - x[k]) * u); oz.push(z[k] + (z[j] - z[k]) * u);
  }
  return { x: ox, z: oz, len };
}

/** Radius of the circle through samples i-w, i, i+w (m; 1e9 when straight). */
export function radiusAt(x: ArrayLike<number>, z: ArrayLike<number>, i: number, w = F1_TRACK.radiusWindow) {
  const n = x.length, a = mod(i - w, n), c = mod(i + w, n);
  const ab = Math.hypot(x[i] - x[a], z[i] - z[a]), bc = Math.hypot(x[c] - x[i], z[c] - z[i]), ca = Math.hypot(x[a] - x[c], z[a] - z[c]);
  const cross = Math.abs((x[i] - x[a]) * (z[c] - z[a]) - (z[i] - z[a]) * (x[c] - x[a]));
  return cross < 1e-9 ? 1e9 : (ab * bc * ca) / (2 * cross);
}

const cache = new Map<F1TrackId, F1Line>();

/** Build (once) the game centre line of a circuit. */
export function f1Line(id: F1TrackId): F1Line {
  let L = cache.get(id);
  if (!L) cache.set(id, (L = build(id)));
  return L;
}

function build(id: F1TrackId): F1Line {
  const S = F1_SHAPES[id], meta = F1_TRACKS.find((t) => t.id === id)!, d = f1Outline(id), cps: THREE.Vector3[] = [];
  for (let i = 0; i < d.length; i += 2) cps.push(new THREE.Vector3(d[i], 0, d[i + 1]));
  const curve = new THREE.CatmullRomCurve3(cps, true, 'centripetal');
  curve.arcLengthDivisions = cps.length * 24;
  const traceLength = curve.getLength(), sp = F1_TRACK.spacing;
  const pts = curve.getSpacedPoints(Math.round(traceLength / sp));
  pts.pop(); // closed curve: the last spaced point repeats the first
  let x = pts.map((p) => p.x), z = pts.map((p) => p.z);

  // relax corners tighter than minR: local Laplacian steps pull a traced vertex inwards into a fillet
  // (the smoothed stretch spans ~2 radii either side, so the fillet has room to form instead of shrinking the lap)
  const span = Math.ceil((2 * S.minR) / sp);
  for (let it = 0; it < 400; it++) {
    const n = x.length, mark = new Uint8Array(n);
    let bad = 0;
    for (let i = 0; i < n; i++) if (radiusAt(x, z, i) < S.minR) { bad++; for (let j = -span; j <= span; j++) mark[mod(i + j, n)] = 1; }
    if (!bad) break;
    const nx = x.slice(), nz = z.slice();
    for (let i = 0; i < n; i++) {
      if (!mark[i] || i === 0) continue; // the start line stays put
      const a = mod(i - 1, n), b = mod(i + 1, n);
      nx[i] = x[i] + 0.5 * ((x[a] + x[b]) / 2 - x[i]);
      nz[i] = z[i] + 0.5 * ((z[a] + z[b]) / 2 - z[i]);
    }
    if (it % 4 === 3) { const r = resample(nx, nz, sp); x = r.x; z = r.z; } else { x = nx; z = nz; }
  }
  let r = resample(x, z, sp);
  // scale about the start line to the official length (the trace is a hand-drawn polyline, a fraction of a % off)
  const target = meta.lengthKm * 1000, f = target / r.len;
  if (!meta.fictional && Math.abs(f - 1) < F1_TRACK.lengthTolerance) {
    const x0 = r.x[0], z0 = r.z[0];
    r = resample(r.x.map((v) => x0 + (v - x0) * f), r.z.map((v) => z0 + (v - z0) * f), sp);
  }
  const n = r.x.length, length = r.len, spacing = length / n;
  const px = Float32Array.from(r.x), pz = Float32Array.from(r.z), tx = new Float32Array(n), tz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = mod(i - 1, n), b = mod(i + 1, n), dx = px[b] - px[a], dz = pz[b] - pz[a], l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l;
  }

  // width: typical, with eased local changes
  const hw = new Float32Array(n).fill(S.width / 2);
  for (const [s0, s1, w] of S.narrow ?? []) {
    const ease = 30;
    for (let i = 0; i < n; i++) {
      let s = i * spacing;
      if (s < s0 - ease - length / 2) s += length;
      const u = Math.min(1, Math.max(0, Math.min(s - (s0 - ease), s1 + ease - s) / ease));
      hw[i] = Math.min(hw[i], S.width / 2 + (w / 2 - S.width / 2) * (0.5 - 0.5 * Math.cos(u * Math.PI)));
    }
  }

  const crossings = findCrossings(px, pz);
  const elev = elevation(S, n, spacing, crossings);
  const line: F1Line = {
    id, n, length, spacing, px, pz, tx, tz, hw, halfWidth: S.width / 2, elev, crossings, traceLength,
    straights: [], drsZones: [], corners: [], pit: { i0: 0, i1: 0, side: 1 },
  };
  straightsAndCorners(line, S.drs);
  line.pit = pitLane(line, S.pit);
  return line;
}

/** Cosine-eased keyframes, ±elevSmooth moving average, then each crossover's two levels eased to one height. */
function elevation(S: F1Shape, n: number, spacing: number, crossings: [number, number][]) {
  const raw = new Float32Array(n), E = S.elev, total = E[E.length - 1][0];
  for (let i = 0; i < n; i++) {
    const s = (i / n) * total;
    let k = 0;
    while (k < E.length - 2 && E[k + 1][0] < s) k++;
    const [s0, h0] = E[k], [s1, h1] = E[k + 1], u = Math.min(1, Math.max(0, (s - s0) / (s1 - s0 || 1)));
    raw[i] = h0 + (h1 - h0) * (0.5 - 0.5 * Math.cos(u * Math.PI));
  }
  const out = new Float32Array(n), W = Math.round(F1_TRACK.elevSmooth / spacing);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -W; j <= W; j++) s += raw[mod(i + j, n)];
    out[i] = S.base + s / (2 * W + 1);
  }
  // the terrain is one height field: both levels of a crossover must meet at the same height (see F1Track bridge)
  const B = Math.round(F1_TRACK.crossBlend / spacing);
  for (const [a, b] of crossings) {
    const m = (out[a] + out[b]) / 2;
    for (const c of [a, b]) {
      const dh = m - out[c];
      for (let j = -B; j <= B; j++) out[mod(c + j, n)] += dh * (0.5 + 0.5 * Math.cos((j / B) * Math.PI));
    }
  }
  // keep the lowest point of the lap well above the water line
  let lo = Infinity;
  for (let i = 0; i < n; i++) lo = Math.min(lo, out[i]);
  if (lo < F1_TRACK.minGround) for (let i = 0; i < n; i++) out[i] += F1_TRACK.minGround - lo;
  return out;
}

/** Segment crossings between parts of the line more than 20 samples apart (bucketed). */
export function findCrossings(px: ArrayLike<number>, pz: ArrayLike<number>): [number, number][] {
  const n = px.length, C = 16, grid = new Map<string, number[]>(), out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = Math.floor(Math.min(px[i], px[j]) / C), x1 = Math.floor(Math.max(px[i], px[j]) / C);
    const z0 = Math.floor(Math.min(pz[i], pz[j]) / C), z1 = Math.floor(Math.max(pz[i], pz[j]) / C);
    for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) { const k = a + ',' + b; const l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]); }
  }
  const seen = new Set<string>();
  for (const list of grid.values())
    for (let p = 0; p < list.length; p++)
      for (let q = p + 1; q < list.length; q++) {
        const i = Math.min(list[p], list[q]), j = Math.max(list[p], list[q]);
        if (Math.min(j - i, n - (j - i)) < 20 || seen.has(i + ',' + j)) continue;
        seen.add(i + ',' + j);
        const i2 = (i + 1) % n, j2 = (j + 1) % n;
        const cr = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
        const d1 = cr(px[i], pz[i], px[i2], pz[i2], px[j], pz[j]), d2 = cr(px[i], pz[i], px[i2], pz[i2], px[j2], pz[j2]);
        const d3 = cr(px[j], pz[j], px[j2], pz[j2], px[i], pz[i]), d4 = cr(px[j], pz[j], px[j2], pz[j2], px[i2], pz[i2]);
        if (d1 * d2 < 0 && d3 * d4 < 0 && !out.some(([a, b]) => Math.abs(a - i) < 20 && Math.abs(b - j) < 20)) out.push([i, j]);
      }
  return out;
}

/** Straights (for DRS + braking boards) and corners (numbering + furniture), from the turn over ±20 m. */
function straightsAndCorners(L: F1Line, drs: number) {
  const { n, spacing, tx, tz } = L, K = Math.round(20 / spacing), ang = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = mod(i - K, n), b = mod(i + K, n);
    ang[i] = Math.abs(Math.atan2(tx[a] * tz[b] - tz[a] * tx[b], tx[a] * tx[b] + tz[a] * tz[b]));
  }
  const runs = (pred: (v: number) => boolean) => {
    let s0 = 0;
    while (s0 < n && pred(ang[s0])) s0++;
    const out: { a: number; b: number; len: number }[] = [];
    let cur = -1;
    for (let k = 1; k <= n; k++) {
      const i = (s0 + k) % n;
      if (pred(ang[i])) { if (cur < 0) cur = k; }
      else if (cur >= 0) { out.push({ a: (s0 + cur) % n, b: (s0 + k - 1) % n, len: (k - cur) * spacing }); cur = -1; }
    }
    return out;
  };
  const near = (a: number, b: number, m: number) => { const d = Math.abs(a - b); return Math.min(d, n - d) * spacing < m; };
  L.straights = runs((v) => v < 0.12).filter((r) => r.len >= F1_TRACK.drsMinStraight).sort((p, q) => q.len - p.len);
  // flat-out sweepers (Jeddah, Albert Park) also carry real DRS zones: fall back to gently curving runs
  if (L.straights.length < drs) {
    const over = (r: { a: number; b: number }) => L.straights.some((s) => inLoopRange(r.a, s.a, s.b) || inLoopRange(s.a, r.a, r.b));
    const loose = runs((v) => v < 0.22).filter((r) => r.len >= F1_TRACK.drsMinStraight && !over(r)).sort((p, q) => q.len - p.len);
    L.straights.push(...loose.slice(0, drs - L.straights.length));
  }
  for (const r of L.straights.slice(0, drs))
    L.drsZones.push({ i0: (r.a + Math.round(Math.min(80, r.len * 0.15) / spacing)) % n, i1: mod(r.b - Math.round(Math.min(120, r.len * 0.2) / spacing), n) });
  let corners = runs((v) => v > 0.35).filter((r) => r.len >= 8);
  corners = corners.filter((r, k) => !corners.slice(0, k).some((q) => near(q.b, r.a, 40)));
  L.corners = corners.sort((p, q) => p.a - q.a).map((r) => r.a);
}

/** Distance from (x, z) to the nearest centre-line sample more than `skip` metres (along the lap) from sample `own`. */
export function clearance(L: F1Line, x: number, z: number, own: number, skip: number) {
  let bd = 1e18, bi = -1;
  for (let i = 0; i < L.n; i++) {
    const d0 = Math.abs(i - own);
    if (Math.min(d0, L.n - d0) * L.spacing < skip) continue;
    const dx = x - L.px[i], dz = z - L.pz[i], d = dx * dx + dz * dz;
    if (d < bd) { bd = d; bi = i; }
  }
  return { d: Math.sqrt(bd) - (bi >= 0 ? L.hw[bi] : 0), i: bi };
}

/** Pit lane range around the line, on the side of the main straight with more room. */
function pitLane(L: F1Line, [before, after]: [number, number]): F1Line['pit'] {
  const { n, spacing } = L, i0 = mod(-Math.round(before / spacing), n), i1 = mod(Math.round(after / spacing), n);
  const room = (side: number) => {
    let m = 1e9;
    for (let s = -before; s <= after; s += 20) {
      const i = mod(Math.round(s / spacing), n), off = side * (L.hw[i] + F1_TRACK.pitWidth + 4);
      m = Math.min(m, clearance(L, L.px[i] + L.tz[i] * off, L.pz[i] - L.tx[i] * off, i, 90).d);
    }
    return m;
  };
  return { i0, i1, side: room(1) >= room(-1) ? 1 : -1 };
}

/** Grid slot k (0 = pole): two staggered columns, consecutive slots gridGap metres apart, behind the line. */
export function gridSlot(L: F1Line, k: number): { x: number; z: number; h: number } {
  const back = F1_TRACK.gridFirst + k * F1_TRACK.gridGap, side = (k % 2 ? 1 : -1) * Math.min(F1_TRACK.gridSide, L.hw[0] * 0.45);
  const j = mod(-Math.round(back / L.spacing), L.n), tx = L.tx[j], tz = L.tz[j];
  return { x: L.px[j] + tz * side, z: L.pz[j] - tx * side, h: Math.atan2(tx, tz) };
}

/** Index range test on the loop. */
export const inLoopRange = (i: number, i0: number, i1: number) => (i0 <= i1 ? i >= i0 && i <= i1 : i >= i0 || i <= i1);

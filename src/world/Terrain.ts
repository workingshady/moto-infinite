import * as THREE from 'three';
import type { Noise } from '../utils/noise';
import type { RoadLayout } from './layout';
import { lerp, smooth } from '../utils/math';
import { GEN, ROAD, THEME_DEFS } from '../config';
import { DEFAULT_GEN, type WorldGen, type WorldTheme } from '../../shared/protocol';

export const RAMP = { L: 10, W: 10, H: 3.2 };
const [F0, F1] = ROAD.flatten;

export interface Ramp { x: number; z: number; tx: number; tz: number; y: number }
export interface Pad { x: number; z: number; y: number; cd: number }

const C = {
  road: new THREE.Color(0x4b4f56), shoulder: new THREE.Color(0xcbb48a), sand: new THREE.Color(0xe6d29a), under: new THREE.Color(0xb79f6c),
  d1: new THREE.Color(0xe2b86f), d2: new THREE.Color(0xd49a5a), g1: new THREE.Color(0x6abf4b), g2: new THREE.Color(0x4c9a38),
  f1: new THREE.Color(0x3f8a3a), f2: new THREE.Color(0x2f6e30), rock: new THREE.Color(0x8b8378), snow: new THREE.Color(0xf4f7fb),
};
const _a = new THREE.Color(), _b = new THREE.Color(), _d = new THREE.Color();

/** Height and colour of the ground anywhere in the world. Pure functions of the seed + road layout. */
export class Terrain {
  readonly ramps: Ramp[] = [];
  readonly pads: Pad[] = [];

  private th: (typeof THEME_DEFS)['mixed'];
  private mul: number;
  private ridge: number;
  private sea: number;
  private rivers: boolean;
  readonly flora: number;

  constructor(readonly noise: Noise, readonly layout: RoadLayout, theme: WorldTheme = 'mixed', gen: WorldGen = DEFAULT_GEN) {
    this.th = THEME_DEFS[theme];
    this.mul = GEN.terrain[gen.terrain].mul * this.th.heightMul;
    this.ridge = GEN.terrain[gen.terrain].ridge;
    this.sea = GEN.water[gen.water].sea + this.th.heightAdd;
    this.rivers = GEN.water[gen.water].rivers;
    this.flora = GEN.flora[gen.flora].mul;
  }

  biome(x: number, z: number) {
    return this.noise.fbm(x / 420 + 300, z / 420 - 200, 3) + this.th.biomeShift;
  }

  rawHeight(x: number, z: number) {
    const n = this.noise;
    // domain warping: bend the input space so coasts and valleys flow instead of looking like blobs
    const wx = x + (n.fbm(x / 320 + 5, z / 320 + 9, 2) - 0.5) * 170, wz = z + (n.fbm(x / 320 - 7, z / 320 + 3, 2) - 0.5) * 170;
    const c = n.fbm(wx / 200 + 11, wz / 200 + 7, 4);
    // rolling hills + ridged multifractal mountains (sharp crests) on high ground
    const hills = Math.pow(n.fbm(wx / 90 + 3, wz / 90 + 5, 3), 2.2) * 75 * smooth(0.5, 0.72, c);
    const r = 1 - Math.abs(2 * n.fbm(wx / 140 + 21, wz / 140 - 13, 4) - 1), ridges = r * r * r * 70 * this.ridge * smooth(0.45, 0.68, c);
    let h = ((c - 0.4) * 45 + n.fbm(x / 28, z / 28, 3) * 5 + hills * (1 - this.ridge * 0.35) + ridges) * this.mul + this.sea;
    if (this.rivers) {
      // rivers: a thin band where warped noise crosses 0.5 is carved below sea level
      const band = Math.abs(n.fbm(wx / 380 + 50, wz / 380 - 50, 3) - 0.5);
      h = lerp(h, Math.min(h, -2.5), smooth(0.03, 0.008, band));
    }
    return h;
  }

  /** Local snow line: colder regions get snow lower down. */
  snowAt(x: number, z: number) {
    return this.th.snowLine + (this.noise.fbm(x / 700 + 90, z / 700 - 40, 2) - 0.5) * 34;
  }

  heightAt(x: number, z: number) {
    return lerp(this.rawHeight(x, z), this.layout.roadHeight(x, z), smooth(F0, F1, this.layout.roadDist(x, z)));
  }

  /** Like heightAt but includes ramps. Used for all physics. */
  groundAt(x: number, z: number) {
    const rd = this.layout.roadDist(x, z);
    let g = lerp(this.rawHeight(x, z), this.layout.roadHeight(x, z), smooth(F0, F1, rd));
    if (rd < ROAD.shoulder)
      for (const r of this.ramps) {
        const dx = x - r.x, dz = z - r.z;
        if (dx * dx + dz * dz > 160) continue;
        const u = dx * r.tx + dz * r.tz, v = -dx * r.tz + dz * r.tx;
        if (Math.abs(u) <= RAMP.L && Math.abs(v) <= RAMP.W / 2) g = Math.max(g, r.y + RAMP.H * (1 - Math.abs(u) / RAMP.L));
      }
    return g;
  }

  get snowLine() {
    return this.th.snowLine;
  }

  onRoad(x: number, z: number) {
    return this.layout.roadDist(x, z) < ROAD.onRoad;
  }

  /** Is (x,z) on top of a ramp? Used to count ramp launches. */
  onRamp(x: number, z: number) {
    for (const r of this.ramps) {
      const dx = x - r.x, dz = z - r.z;
      if (dx * dx + dz * dz < 140) return true;
    }
    return false;
  }

  colorAt(x: number, y: number, z: number, col: THREE.Color) {
    const rd = this.layout.roadDist(x, z);
    if (y > 0.5 && rd < ROAD.asphalt) return col.copy(C.road);
    if (y > 0.5 && rd < ROAD.shoulder) return col.copy(C.shoulder);
    if (y < 0.4) return col.copy(C.under);
    if (y < 1.8) return col.copy(C.sand);
    const b = this.biome(x, z), n = this.noise.vnoise(x / 9, z / 9);
    _d.copy(C.d1).lerp(C.d2, n);
    _a.copy(C.g1).lerp(C.g2, n);
    _b.copy(C.f1).lerp(C.f2, n);
    col.copy(_d).lerp(_a, smooth(0.36, 0.42, b)).lerp(_b, smooth(0.58, 0.64, b));
    const sl = this.snowAt(x, z);
    if (y > sl - 12) col.lerp(C.rock, smooth(sl - 12, sl - 7, y));
    if (y > sl) col.lerp(C.snow, smooth(sl, sl + 3, y));
    return col;
  }
}

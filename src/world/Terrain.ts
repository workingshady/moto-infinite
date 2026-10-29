import * as THREE from 'three';
import type { Noise } from '../utils/noise';
import type { RoadLayout } from './layout';
import { lerp, smooth } from '../utils/math';
import { ROAD } from '../config';

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

  constructor(readonly noise: Noise, readonly layout: RoadLayout) {}

  biome(x: number, z: number) {
    return this.noise.fbm(x / 420 + 300, z / 420 - 200, 3);
  }

  rawHeight(x: number, z: number) {
    const n = this.noise, c = n.fbm(x / 200 + 11, z / 200 + 7, 4);
    const m = Math.pow(n.fbm(x / 90 + 3, z / 90 + 5, 4), 2.2) * 75 * smooth(0.5, 0.72, c);
    return (c - 0.4) * 45 + n.fbm(x / 28, z / 28, 3) * 5 + m;
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
    if (y > 22) col.lerp(C.rock, smooth(22, 27, y));
    if (y > 34) col.lerp(C.snow, smooth(34, 37, y));
    return col;
  }
}

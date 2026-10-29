// Streams 64 m terrain chunks around every local player. Scenery is instanced per chunk, ramps/pads share
// geometry, and only one chunk is generated per frame so riding never hitches.
import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Pad, Ramp } from './Terrain';
import { RAMP } from './Terrain';
import { FEATURES, DRONES, QUALITY, ROAD, WORLD } from '../config';
import { G, MAT, mesh } from '../entities/assets';
import { mulberry32, PI, TAU } from '../utils/math';

export interface Obstacle { x: number; z: number; r: number; top: number }
export interface Chunk { cx: number; cz: number; obs: Obstacle[]; ramps: Ramp[]; pads: (Pad & { m: THREE.Mesh })[]; meshes: THREE.Object3D[]; terrain: THREE.Mesh }

const CH = WORLD.chunk;
const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _base = new THREE.Matrix4(), _t = new THREE.Matrix4(), _s = new THREE.Matrix4();
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _sc = new THREE.Vector3(), _e = new THREE.Euler();
const PINE_COLOR = new THREE.Color(0x2f6e43), SNOW_PINE = new THREE.Color(0xe8f0f4);
const CURB_RED = new THREE.Color(0xd8322a), CURB_WHITE = new THREE.Color(0xf4f4f4);
const LEAVES = [0x4caf50, 0x5dbb3f, 0x3e9a48, 0x7cc142, 0x8bc34a].map((c) => new THREE.Color(c));

interface Part { g: THREE.BufferGeometry; m: THREE.Material; mats: number[]; cols: THREE.Color[] }

export class ChunkManager {
  private chunks = new Map<number, Chunk>();
  view: number;

  constructor(private game: Game) {
    this.view = QUALITY[game.opts.quality].view;
  }

  at(x: number, z: number) {
    return this.chunks.get(key(Math.floor(x / CH), Math.floor(z / CH)));
  }

  /** Visit the 3x3 chunks around a point (no allocation). */
  forNear(x: number, z: number, fn: (c: Chunk) => boolean | void) {
    const cx = Math.floor(x / CH), cz = Math.floor(z / CH);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const c = this.chunks.get(key(cx + i, cz + j));
        if (c && fn(c)) return;
      }
  }

  stream(focus: { x: number; z: number }[], budget: number) {
    const V = this.view, need: [number, number, number][] = [];
    for (const f of focus) {
      const pcx = Math.floor(f.x / CH), pcz = Math.floor(f.z / CH);
      for (let i = -V; i <= V; i++)
        for (let j = -V; j <= V; j++) {
          if (i * i + j * j > V * V + 2) continue;
          if (!this.chunks.has(key(pcx + i, pcz + j))) need.push([pcx + i, pcz + j, i * i + j * j]);
        }
    }
    if (need.length) {
      need.sort((a, b) => a[2] - b[2]);
      for (let n = 0; n < Math.min(budget, need.length); n++) if (!this.chunks.has(key(need[n][0], need[n][1]))) this.build(need[n][0], need[n][1]);
    }
    for (const ch of this.chunks.values()) {
      let keep = false;
      for (const f of focus) {
        if (Math.abs(ch.cx - Math.floor(f.x / CH)) <= V + 1 && Math.abs(ch.cz - Math.floor(f.z / CH)) <= V + 1) { keep = true; break; }
      }
      if (!keep) this.unload(ch);
    }
  }

  private build(cx: number, cz: number) {
    const g = this.game, T = g.terrain, x0 = cx * CH, z0 = cz * CH;
    const rng = mulberry32(g.opts.seed ^ Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663));

    // terrain: flat-shaded triangles coloured per face
    let geo: THREE.BufferGeometry = new THREE.PlaneGeometry(CH, CH, WORLD.chunkSeg, WORLD.chunkSeg);
    geo.rotateX(-PI / 2);
    geo.translate(x0 + CH / 2, 0, z0 + CH / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, T.heightAt(p.getX(i), p.getZ(i)));
    const indexed = geo;
    geo = geo.toNonIndexed();
    indexed.dispose();
    const pa = geo.attributes.position.array as Float32Array, cols = new Float32Array(pa.length), col = new THREE.Color();
    for (let i = 0; i < pa.length; i += 9) {
      T.colorAt((pa[i] + pa[i + 3] + pa[i + 6]) / 3, (pa[i + 1] + pa[i + 4] + pa[i + 7]) / 3, (pa[i + 2] + pa[i + 5] + pa[i + 8]) / 3, col);
      col.multiplyScalar(0.95 + rng() * 0.07);
      for (let k = 0; k < 3; k++) { cols[i + k * 3] = col.r; cols[i + k * 3 + 1] = col.g; cols[i + k * 3 + 2] = col.b; }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, MAT.terrain);
    terrain.receiveShadow = true;
    g.scene.add(terrain);
    const ch: Chunk = { cx, cz, obs: [], ramps: [], pads: [], meshes: [terrain], terrain };

    this.scenery(ch, rng, x0, z0);
    this.markings(ch, x0, z0);
    const F = FEATURES[g.opts.mode];
    g.layout.forEachRoadPoint(x0, z0, CH, (x, z, tx, tz, along) => {
      if (along >= 0 && along < 60) return; // keep the race start straight clear
      this.feature(ch, rng, F, x, z, tx, tz);
    });

    if (g.opts.mode === 'open') {
      const sp = g.spawnPoints[0], far = Math.hypot(x0, z0);
      if (Math.hypot(x0 + CH / 2 - sp.x, z0 + CH / 2 - sp.z) > DRONES.safeRadius && rng() < DRONES.chance + DRONES.farChance * Math.min(1, far / DRONES.farDist))
        g.entities.add('drone', x0 + rng() * CH, z0 + rng() * CH, { chunk: ch });
    }
    this.chunks.set(key(cx, cz), ch);
  }

  private scenery(ch: Chunk, rng: () => number, x0: number, z0: number) {
    const T = this.game.terrain, parts: Record<string, Part> = {};
    const add = (k: string, g: THREE.BufferGeometry, m: THREE.Material, mat: THREE.Matrix4, c?: THREE.Color) => {
      const q = parts[k] ?? (parts[k] = { g, m, mats: [], cols: [] });
      q.mats.push(...mat.elements);
      if (c) q.cols.push(c);
    };
    const base = (x: number, y: number, z: number, s: number) =>
      _base.compose(_p.set(x, y, z), _q.setFromAxisAngle(UP, rng() * TAU), _sc.set(s, s, s));
    const child = (tx: number, ty: number, tz: number, s = 1) => _m.copy(_base).multiply(_t.makeTranslation(tx, ty, tz)).multiply(_s.makeScale(s, s, s));
    const rock = (x: number, y: number, z: number, s: number, sy: number, sz: number) => {
      add('rock', G.rock, MAT.rock, _m.compose(_p.set(x, y + 0.2, z), _q.setFromEuler(_e.set(rng(), rng() * 6, 0)), _sc.set(s, sy, sz)));
    };
    const pine = (snowy: boolean) =>
      ([[2.4, 1], [3.6, 0.8], [4.7, 0.58]] as const).forEach(([yy, k]) => add('pine', G.cone, MAT.white, child(0, yy, 0, k), snowy ? SNOW_PINE : PINE_COLOR));

    for (let t = 0; t < WORLD.scenery; t++) {
      const x = x0 + rng() * CH, z = z0 + rng() * CH, y = T.heightAt(x, z), rd = T.layout.roadDist(x, z);
      if (rd < ROAD.clear || y < 1.8) continue;
      const b = T.biome(x, z), roll = rng(), s = 0.8 + rng() * 0.6;
      if (y > T.snowLine - 4) {
        if (roll < 0.18) {
          base(x, y, z, s);
          add('trunk', G.trunk, MAT.trunk, child(0, 1.1, 0));
          pine(y > T.snowLine + 2);
          ch.obs.push({ x, z, r: 0.6 * s, top: y + 6 });
        } else if (roll < 0.3) {
          rock(x, y, z, s * 1.4, s, s * 1.2);
          ch.obs.push({ x, z, r: 1.4 * s, top: y + 2 });
        }
        continue;
      }
      if (b < 0.4) {
        if (roll < 0.12) {
          base(x, y, z, s);
          add('cactus', G.cactus, MAT.cactus, child(0, 1.6, 0));
          add('cactus', G.arm, MAT.cactus, child(0.55, 1.9, 0));
          add('cactus', G.arm, MAT.cactus, child(-0.5, 1.4, 0));
          ch.obs.push({ x, z, r: 0.5 * s, top: y + 3.5 });
        } else if (roll < 0.18) {
          rock(x, y, z, s * 1.3, s * 0.8, s);
          ch.obs.push({ x, z, r: 1.3 * s, top: y + 2 });
        }
      } else {
        const forest = b > 0.6, pTree = forest ? 0.85 : 0.3;
        if (roll < pTree) {
          base(x, y, z, s);
          add('trunk', G.trunk, MAT.trunk, child(0, 1.1, 0));
          if (forest && rng() < 0.6) pine(false);
          else {
            const c = LEAVES[Math.floor(rng() * LEAVES.length)];
            add('leaf', G.blob, MAT.white, child(0, 3.2, 0), c);
            add('leaf', G.blob, MAT.white, child(0.7, 2.6, 0.3, 0.65), c);
          }
          ch.obs.push({ x, z, r: 0.6 * s, top: y + 6 });
        } else if (roll < pTree + 0.05) {
          rock(x, y, z, s * 1.3, s * 0.8, s);
          ch.obs.push({ x, z, r: 1.3 * s, top: y + 2 });
        }
      }
    }
    for (const q of Object.values(parts)) {
      const n = q.mats.length / 16, im = new THREE.InstancedMesh(q.g, q.m, n);
      (im.instanceMatrix.array as Float32Array).set(q.mats);
      q.cols.forEach((c, i) => im.setColorAt(i, c));
      im.castShadow = im.receiveShadow = true;
      this.game.scene.add(im);
      ch.meshes.push(im);
    }
  }

  /** Painted centre dashes on every road and red/white curbs on race circuits (instanced, 1-2 draw calls per chunk). */
  private markings(ch: Chunk, x0: number, z0: number) {
    const g = this.game, T = g.terrain, dashes: number[] = [], curbs: number[] = [], cols: THREE.Color[] = [];
    const circuit = g.layout.kind === 'circuit';
    let k = 0;
    g.layout.forEachRoadPoint(x0, z0, CH, (x, z, tx, tz) => {
      const h = Math.atan2(tx, tz);
      _q.setFromAxisAngle(UP, h);
      dashes.push(..._m.compose(_p.set(x, T.heightAt(x, z) + 0.07, z), _q, _sc.set(0.32, 1, 3.2)).elements);
      if (!circuit) return;
      for (const side of [-1, 1]) {
        const cx = x + tz * side * ROAD.asphalt, cz = z - tx * side * ROAD.asphalt;
        for (let j = -1; j <= 1; j++) {
          const px = cx + tx * j * 2.7, pz = cz + tz * j * 2.7;
          curbs.push(..._m.compose(_p.set(px, T.heightAt(px, pz) + 0.08, pz), _q, _sc.set(1.1, 0.22, 2.6)).elements);
          cols.push((k + j) % 2 ? CURB_RED : CURB_WHITE);
        }
      }
      k++;
    });
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material, mats: number[], colors: THREE.Color[] | null) => {
      if (!mats.length) return;
      const im = new THREE.InstancedMesh(geo, mat, mats.length / 16);
      (im.instanceMatrix.array as Float32Array).set(mats);
      colors?.forEach((c, i) => im.setColorAt(i, c));
      im.receiveShadow = true;
      g.scene.add(im);
      ch.meshes.push(im);
    };
    make(G.dash, MAT.dash, dashes, null);
    make(G.box, MAT.white, curbs, cols);
  }

  private feature(ch: Chunk, rng: () => number, F: (typeof FEATURES)['open'], x: number, z: number, tx: number, tz: number) {
    const g = this.game, T = g.terrain, E = g.entities, r = rng(), nx = -tz, nz = tx, y = T.heightAt(x, z);
    const nearSpawn = g.spawnPoints.some((s) => Math.hypot(x - s.x, z - s.z) < 40);
    if (r < F.ramp) {
      if (nearSpawn || T.ramps.some((q) => Math.hypot(q.x - x, q.z - z) < 50)) return;
      const m = mesh(G.ramp, MAT.ramp);
      m.position.set(x, y - 0.05, z);
      m.rotation.y = Math.atan2(-tz, tx);
      g.scene.add(m);
      ch.meshes.push(m);
      const rp: Ramp = { x, z, tx, tz, y };
      ch.ramps.push(rp);
      T.ramps.push(rp);
      for (const [u, h] of [[1, 4], [2.3, 5.2], [3.6, 4]]) {
        const s2 = u * 5;
        E.add('gem', x + tx * s2, z + tz * s2, { y: y + RAMP.H + h, chunk: ch });
        E.add('gem', x - tx * s2, z - tz * s2, { y: y + RAMP.H + h, chunk: ch });
      }
    } else if (r < F.pad) {
      if (nearSpawn) return;
      const m = new THREE.Mesh(G.pad, MAT.pad);
      m.position.set(x, y + 0.08, z);
      m.rotation.y = Math.atan2(tx, tz);
      m.receiveShadow = true;
      g.scene.add(m);
      ch.meshes.push(m);
      const pd = { x, z, y, cd: 0, m };
      ch.pads.push(pd);
      T.pads.push(pd);
    } else if (r < F.gem) {
      const o = (rng() - 0.5) * 8;
      E.add('gem', x + nx * o, z + nz * o, { chunk: ch });
    } else if (nearSpawn) {
      return;
    } else if (r < F.cones) {
      const o = (rng() - 0.5) * 4;
      for (let i = -1; i <= 1; i++) E.add('cone', x + nx * (o + i * 1.4), z + nz * (o + i * 1.4), { chunk: ch });
    } else if (r < F.crate) {
      const o = (rng() - 0.5) * 8;
      E.add('crate', x + nx * o, z + nz * o, { chunk: ch });
    } else if (r < F.barrel) {
      const o = (rng() - 0.5) * 8;
      E.add('barrel', x + nx * o, z + nz * o, { chunk: ch });
    } else if (r < F.pile) {
      const side = rng() < 0.5 ? -1 : 1, o = side * (ROAD.shoulder + 1 + rng() * 4), n = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) E.add(rng() < 0.3 ? 'barrel' : 'crate', x + nx * o + (rng() - 0.5) * 4, z + nz * o + (rng() - 0.5) * 4, { chunk: ch });
    } else if (r < F.powerup) {
      E.add('powerup', x, z, { chunk: ch });
    }
  }

  private unload(ch: Chunk) {
    const g = this.game, T = g.terrain;
    for (const m of ch.meshes) {
      g.scene.remove(m);
      if (m instanceof THREE.InstancedMesh) m.dispose();
    }
    ch.terrain.geometry.dispose();
    for (const r of ch.ramps) T.ramps.splice(T.ramps.indexOf(r), 1);
    for (const p of ch.pads) T.pads.splice(T.pads.indexOf(p), 1);
    g.entities.removeChunk(ch);
    this.chunks.delete(key(ch.cx, ch.cz));
  }

  /** Is the spot blocked by water, a cliff or a tree/rock? */
  blocked(nx: number, nz: number, r: number, y: number, maxStep: number): false | 'water' | 'wall' | 'tree' {
    const gy = this.game.terrain.groundAt(nx, nz);
    if (gy < 0.2) return 'water';
    if (gy - y > maxStep) return 'wall';
    let hit = false;
    this.forNear(nx, nz, (c) => {
      for (const o of c.obs) {
        const dx = nx - o.x, dz = nz - o.z, rr = r + o.r;
        if (dx * dx + dz * dz < rr * rr && y < o.top) return (hit = true);
      }
    });
    return hit ? 'tree' : false;
  }
}

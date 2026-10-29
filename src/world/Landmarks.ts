// Hand-shaped places generated at crossroads (open world) and trackside dressing (race circuits).
// Everything is deterministic from the seed, so every online player sees the same village in the same spot.
import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Chunk } from './Chunks';
import type { Circuit, Poi } from './layout';
import { RAMP, type Ramp } from './Terrain';
import { G, M, MAT, canvasTex, mesh } from '../entities/assets';
import { ROAD } from '../config';
import { mulberry32, PI, TAU } from '../utils/math';

const WALLS = [0xf2e3c6, 0xe9c9a0, 0xd8e2ea, 0xf0d0c0, 0xcfe0c3].map((c) => M(c));
const ROOFS = [0xb5452e, 0x8a4a32, 0x3c6e9c, 0x6a3d6e].map((c) => M(c));
const roof = new THREE.ConeGeometry(1, 1, 4).rotateY(PI / 4);
const tyreGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.5, 10);
const steel = M(0x9aa3ad, { metalness: 0.5, roughness: 0.4 });
const beacon = new THREE.MeshBasicMaterial({ color: 0xff2a3a });
const crowdMat = new THREE.MeshStandardMaterial({
  map: canvasTex(128, 32, (g, w, h) => {
    g.fillStyle = '#39404d';
    g.fillRect(0, 0, w, h);
    const cols = ['#e2483d', '#3c8dff', '#ffd23f', '#39c46a', '#ffffff', '#ff7ad9'];
    for (let i = 0; i < 160; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect((i * 37) % w, ((i * 13) % 4) * 8 + 2, 4, 5); }
  }),
  roughness: 0.9,
});

/** Things that need a per-frame tick (windmill blades). */
export interface Spinner { obj: THREE.Object3D; speed: number; chunk: Chunk }
/** Areas with an effect when a rider is inside (gas station refuel). */
export interface Zone { x: number; z: number; r: number; kind: 'fuel'; chunk: Chunk }

export function buildPoi(game: Game, ch: Chunk, poi: Poi, spinners: Spinner[], zones: Zone[]) {
  const T = game.terrain, rng = mulberry32(poi.id ^ game.opts.seed);
  const fx = Math.sin(poi.h), fz = Math.cos(poi.h); // along one road
  const nx = fz, nz = -fx; // across it
  const add = (o: THREE.Object3D) => { game.scene.add(o); ch.meshes.push(o); return o; };
  const solid = (x: number, z: number, r: number, top: number) => ch.obs.push({ x, z, r, top });
  // a corner spot next to the crossroads, off both roads
  const corner = (dist: number, side: number, along: number) => {
    const x = poi.x + nx * dist * side + fx * along, z = poi.z + nz * dist * side + fz * along;
    return T.layout.roadDist(x, z) > ROAD.clear ? { x, z, y: T.heightAt(x, z) } : null;
  };

  switch (poi.kind) {
    case 'village': {
      for (let i = 0; i < 9; i++) {
        const a = rng() * TAU, d = 22 + rng() * 26, x = poi.x + Math.cos(a) * d, z = poi.z + Math.sin(a) * d;
        if (T.layout.roadDist(x, z) < ROAD.clear + 2) continue;
        const y = T.heightAt(x, z);
        if (y < 0.8) continue;
        const w = 4 + rng() * 3, dpt = 4 + rng() * 3, h = 3 + rng() * 1.5, house = new THREE.Group();
        house.position.set(x, y, z);
        house.rotation.y = poi.h + Math.round(rng() * 4) * (PI / 2);
        const body = mesh(G.box, WALLS[Math.floor(rng() * WALLS.length)], 0, h / 2 - 0.6, 0);
        body.scale.set(w, h + 1.2, dpt);
        const top = mesh(roof, ROOFS[Math.floor(rng() * ROOFS.length)], 0, h + 0.6 + 1, 0);
        top.scale.set(Math.max(w, dpt) * 0.78, 2.2, Math.max(w, dpt) * 0.78);
        const door = mesh(G.box, MAT.trunk, 0, 0.6, dpt / 2 + 0.02, false);
        door.scale.set(1, 2, 0.1);
        house.add(body, top, door);
        add(house);
        solid(x, z, Math.max(w, dpt) * 0.6, y + h + 3);
      }
      for (let i = 0; i < 4; i++) game.entities.add('gem', poi.x + (rng() - 0.5) * 30, poi.z + (rng() - 0.5) * 30, { chunk: ch });
      game.entities.add('powerup', poi.x + nx * 6, poi.z + nz * 6, { chunk: ch });
      break;
    }
    case 'fuel': {
      const c = corner(15, rng() < 0.5 ? 1 : -1, 12);
      if (!c) break;
      const st = new THREE.Group();
      st.position.set(c.x, c.y, c.z);
      st.rotation.y = poi.h;
      const canopy = mesh(G.box, M(0xe2483d), 0, 5.2, 0);
      canopy.scale.set(11, 0.6, 8);
      st.add(canopy);
      for (const [px, pz] of [[-4.5, -3], [4.5, -3], [-4.5, 3], [4.5, 3]]) { const p = mesh(G.box, steel, px, 2.5, pz); p.scale.set(0.4, 5, 0.4); st.add(p); }
      for (const px of [-2, 2]) { const pump = mesh(G.box, M(0xf4f4f4), px, 0.9, 0); pump.scale.set(0.8, 1.8, 0.6); st.add(pump); }
      const shop = mesh(G.box, WALLS[2], 0, 1.2, -8);
      shop.scale.set(9, 4, 5);
      st.add(shop);
      add(st);
      solid(c.x - fz * 8, c.z + fx * 8, 4.5, c.y + 4);
      zones.push({ x: c.x, z: c.z, r: 7, kind: 'fuel', chunk: ch });
      game.entities.add('powerup', c.x, c.z, { chunk: ch, power: 'heal' });
      break;
    }
    case 'windmill': {
      const c = corner(24, rng() < 0.5 ? 1 : -1, 0);
      if (!c) break;
      const mill = new THREE.Group();
      mill.position.set(c.x, c.y, c.z);
      const tower = mesh(new THREE.CylinderGeometry(1.4, 2.4, 14, 8), WALLS[0], 0, 7, 0);
      const cap = mesh(new THREE.ConeGeometry(1.9, 2.5, 8), ROOFS[0], 0, 15.2, 0);
      const hub = new THREE.Group();
      hub.position.set(0, 12.5, 2.2);
      for (let i = 0; i < 4; i++) {
        const blade = mesh(G.box, M(0xf4f0e6), 0, 4, 0);
        blade.scale.set(1.2, 8, 0.15);
        const arm = new THREE.Group();
        arm.rotation.z = (i * PI) / 2;
        arm.add(blade);
        hub.add(arm);
      }
      mill.add(tower, cap, hub);
      mill.rotation.y = poi.h + PI / 2;
      add(mill);
      spinners.push({ obj: hub, speed: 0.8 + rng() * 0.6, chunk: ch });
      solid(c.x, c.z, 2.6, c.y + 16);
      break;
    }
    case 'stunt': {
      // a ramp chain down one road: pad → ramp → gap → ramp, with gem arcs over each jump
      for (const [along, pad] of [[34, true], [78, false]] as const) {
        const near = T.layout.nearestRoad(poi.x + fx * along, poi.z + fz * along);
        const tx = Math.sin(near.h), tz = Math.cos(near.h), y = T.heightAt(near.x, near.z);
        if (T.ramps.some((q) => Math.hypot(q.x - near.x, q.z - near.z) < 30)) continue;
        const m = mesh(G.ramp, MAT.ramp);
        m.position.set(near.x, y - 0.05, near.z);
        m.rotation.y = Math.atan2(-tz, tx);
        add(m);
        const rp: Ramp = { x: near.x, z: near.z, tx, tz, y };
        ch.ramps.push(rp);
        T.ramps.push(rp);
        for (let k = 1; k <= 4; k++) game.entities.add('gem', near.x + tx * (RAMP.L + k * 6), near.z + tz * (RAMP.L + k * 6), { chunk: ch, y: y + RAMP.H + 3 + Math.sin((k / 5) * PI) * 4 });
        if (pad) {
          const pm = new THREE.Mesh(G.pad, MAT.pad);
          const px = near.x - tx * 20, pz = near.z - tz * 20, py = T.heightAt(px, pz);
          pm.position.set(px, py + 0.08, pz);
          pm.rotation.y = Math.atan2(tx, tz);
          add(pm);
          const pd = { x: px, z: pz, y: py, cd: 0, m: pm };
          ch.pads.push(pd);
          T.pads.push(pd);
        }
      }
      break;
    }
    case 'outpost': {
      const c = corner(20, rng() < 0.5 ? 1 : -1, 6);
      if (!c) break;
      const tower = new THREE.Group();
      tower.position.set(c.x, c.y, c.z);
      const mast = mesh(G.box, MAT.droneBody, 0, 7, 0);
      mast.scale.set(2.4, 14, 2.4);
      const deck = mesh(G.box, MAT.droneBody, 0, 14.3, 0);
      deck.scale.set(5, 0.6, 5);
      const light = new THREE.Mesh(G.sph, beacon);
      light.position.y = 15.4;
      light.scale.setScalar(0.6);
      tower.add(mast, deck, light);
      add(tower);
      solid(c.x, c.z, 2.2, c.y + 15);
      if (game.opts.mode === 'open' && !game.opts.tutorial)
        for (let i = 0; i < 2; i++) game.entities.add('drone', c.x + (rng() - 0.5) * 10, c.z + (rng() - 0.5) * 10, { chunk: ch, force: true, kind: i ? 'gunner' : 'bomber' });
      game.entities.add('crate', c.x + 5, c.z + 5, { chunk: ch });
      game.entities.add('barrel', c.x - 5, c.z + 4, { chunk: ch });
      break;
    }
  }
}

/** Grandstands along the start straight and tyre walls on the outside of sharp corners. */
export function dressCircuit(game: Game, ch: Chunk, track: Circuit, x0: number, z0: number, size: number) {
  const T = game.terrain, tyres: number[] = [], cols: THREE.Color[] = [];
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const red = new THREE.Color(0xd8322a), black = new THREE.Color(0x1d1d1f), white = new THREE.Color(0xf4f4f4);
  const step = Math.max(1, Math.round(4 / track.spacing));
  for (let i = 0; i < track.n; i += step) {
    const x = track.px[i], z = track.pz[i];
    if (x < x0 || x >= x0 + size || z < z0 || z >= z0 + size) continue;
    const tx = track.tx[i], tz = track.tz[i], along = i * track.spacing;
    // grandstands: 20-80 m after the start line, both sides
    if (along > 20 && along < 80 && i % (step * 6) === 0) {
      for (const side of [-1, 1]) {
        const d = ROAD.shoulder + 7, gx = x + tz * side * d, gz = z - tx * side * d, gy = T.heightAt(gx, gz), stand = new THREE.Group();
        stand.position.set(gx, gy, gz);
        stand.rotation.y = Math.atan2(tx, tz) + (side > 0 ? -PI / 2 : PI / 2);
        for (let r = 0; r < 4; r++) {
          const h = 1.2 + r * 1.1, row = mesh(G.box, r % 2 ? crowdMat : MAT.gate, 0, h / 2, r * 1.3);
          row.scale.set(12, h, 1.4);
          stand.add(row);
        }
        game.scene.add(stand);
        ch.meshes.push(stand);
        ch.obs.push({ x: gx, z: gz, r: 6, top: gy + 6 });
      }
    }
    // tyre walls where the track bends hard
    const k = track.curvature(i);
    if (Math.abs(k) < 0.22) continue;
    const side = k > 0 ? 1 : -1, d = ROAD.shoulder + 1.6;
    for (let j = -1; j <= 1; j++) {
      const px = x + tz * side * d + tx * j * 1.3, pz = z - tx * side * d + tz * j * 1.3, py = T.heightAt(px, pz);
      for (let h = 0; h < 2; h++) {
        tyres.push(..._m.compose(_p.set(px, py + 0.3 + h * 0.55, pz), _q.setFromAxisAngle(UP, 0), _s.set(1, 1, 1)).elements);
        cols.push(h ? (i / step) % 2 ? red : white : black);
      }
    }
    ch.obs.push({ x: x + tz * side * d, z: z - tx * side * d, r: 1.6, top: T.heightAt(x, z) + 1.4 });
  }
  if (tyres.length) {
    const im = new THREE.InstancedMesh(tyreGeo, MAT.white, tyres.length / 16);
    (im.instanceMatrix.array as Float32Array).set(tyres);
    cols.forEach((c, i) => im.setColorAt(i, c));
    im.castShadow = im.receiveShadow = true;
    game.scene.add(im);
    ch.meshes.push(im);
  }
}

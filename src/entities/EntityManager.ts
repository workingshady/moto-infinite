// World pickups, props and enemies. Each entity belongs to a chunk and disappears with it.
import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Chunk } from '../world/Chunks';
import type { Player } from './Player';
import { G, MAT, mesh } from './assets';
import { buildDrone } from './models';
import { AIM, DRONES, DRONE_TYPES, POWERUPS, type DroneKind, type PowerupKind } from '../config';
import { clamp, lerp, TAU } from '../utils/math';

export type EntityType = 'gem' | 'crate' | 'barrel' | 'cone' | 'drone' | 'powerup';

export interface Entity {
  type: EntityType;
  mesh: THREE.Group;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number; // velocity, used to lead shots
  hp: number; maxHp: number; r: number;
  kind?: DroneKind;
  chunk: Chunk | null;
  alive: boolean;
  t: number; cool: number; ang: number; fuse: number; hitFlash: number;
  engaged: boolean;
  power?: PowerupKind;
  drone?: ReturnType<typeof buildDrone>;
  bob?: THREE.Object3D;
}

const powerMats = Object.fromEntries(
  Object.entries(POWERUPS).map(([k, v]) => [k, new THREE.MeshStandardMaterial({ color: v.color, emissive: v.color, emissiveIntensity: 0.7, roughness: 0.3 })]),
) as Record<PowerupKind, THREE.MeshStandardMaterial>;

export class EntityManager {
  readonly list: Entity[] = [];
  private drones = 0;
  private attacking = 0;

  constructor(private game: Game) {}

  add(type: EntityType, x: number, z: number, o: { y?: number; chunk?: Chunk | null; power?: PowerupKind; force?: boolean; kind?: DroneKind } = {}): Entity | null {
    const gy = this.game.terrain.groundAt(x, z);
    if (gy < 0.5 && type !== 'drone') return null;
    if (type === 'drone' && this.drones >= DRONES.maxAlive + (o.force ? 3 : 0)) return null;
    if (type === 'drone' && this.game.opts.tutorial && !this.game.tutorial?.complete) return null; // no enemies while learning
    let inner: THREE.Object3D, hp = 1, r = 0.8, y = gy;
    const e = { type, x, z, vx: 0, vy: 0, vz: 0, chunk: o.chunk ?? null, alive: true, t: Math.random() * 10, cool: 2 + Math.random() * 2, ang: Math.random() * TAU, fuse: 0, hitFlash: 0, engaged: false } as Entity;
    if (type === 'gem') {
      inner = mesh(G.gem, MAT.gem, 0, 0, 0, false);
      y = o.y ?? gy + 1.4;
      r = 1;
      e.bob = inner;
    } else if (type === 'crate') {
      inner = mesh(G.box, MAT.crate);
      inner.scale.setScalar(1.7);
      inner.position.y = 0.85;
      hp = 30; r = 1.1;
    } else if (type === 'barrel') {
      inner = new THREE.Group();
      inner.add(mesh(G.barrel, MAT.barrel, 0, 0.65, 0), mesh(G.band, MAT.band, 0, 0.35, 0, false), mesh(G.band, MAT.band, 0, 0.95, 0, false));
      hp = 15;
    } else if (type === 'cone') {
      inner = new THREE.Group();
      inner.add(mesh(G.tcone, MAT.cone, 0, 0.5, 0, false));
      const b = mesh(G.box, MAT.coneBase, 0, 0.04, 0, false);
      b.scale.set(0.8, 0.08, 0.8);
      inner.add(b);
      r = 0.45;
    } else if (type === 'powerup') {
      const kind = o.power ?? (['heal', 'shield', 'magnet', 'xp2'] as PowerupKind[])[Math.floor(Math.random() * 4)];
      e.power = kind;
      inner = new THREE.Group();
      const core = mesh(G.sph, powerMats[kind], 0, 0, 0, false);
      core.scale.setScalar(0.55);
      const ring = mesh(G.torus, powerMats[kind], 0, 0, 0, false);
      inner.add(core, ring);
      y = gy + 1.5;
      r = 1.2;
      e.bob = inner;
    } else {
      // further from spawn = tougher mix of drones
      const far = Math.hypot(x - this.game.spawnPoints[0].x, z - this.game.spawnPoints[0].z), roll = Math.random();
      const kind: DroneKind = o.kind ?? (roll < 0.35 - Math.min(0.2, far / 8000) ? 'scout' : roll < 0.85 - Math.min(0.3, far / 6000) ? 'gunner' : 'bomber');
      const D = DRONE_TYPES[kind], d = buildDrone(D.color, D.scale, D.bomb);
      e.drone = d;
      e.kind = kind;
      inner = d.root;
      y = gy + 7;
      hp = D.hp;
      r = 1.4 * D.scale;
      this.drones++;
    }
    const holder = new THREE.Group();
    holder.add(inner);
    holder.position.set(x, y, z);
    holder.rotation.y = Math.random() * TAU;
    this.game.scene.add(holder);
    Object.assign(e, { mesh: holder, y, hp, maxHp: hp, r });
    this.list.push(e);
    return e;
  }

  /** Spawn n entities ahead of a player (used by challenges). */
  spawnNear(p: Player, type: EntityType, n: number, minD = 35, maxD = 70) {
    const P = p.P;
    for (let i = 0; i < n; i++) {
      const a = P.h + (Math.random() - 0.5) * 1.6, d = minD + Math.random() * (maxD - minD);
      const x = P.x + Math.sin(a) * d, z = P.z + Math.cos(a) * d, c = this.game.chunks.at(x, z);
      if (c) this.add(type, x, z, { chunk: c, force: true });
    }
  }

  private remove(e: Entity) {
    if (!e.alive) return;
    e.alive = false;
    this.game.scene.remove(e.mesh);
    if (e.type === 'drone') {
      this.drones--;
      if (e.engaged) this.attacking--;
    }
  }

  removeChunk(ch: Chunk) {
    for (const e of this.list) if (e.chunk === ch) this.remove(e);
  }

  damage(e: Entity, dmg: number, by: Player | null) {
    if (!e.alive || e.type === 'gem' || e.type === 'powerup') return;
    e.hp -= dmg;
    e.hitFlash = 0.12;
    if (e.hp <= 0) this.destroy(e, by);
  }

  destroy(e: Entity, by: Player | null) {
    if (!e.alive) return;
    this.remove(e);
    const g = this.game, { x, y, z } = e, who = by ?? g.nearestPlayer(x, z);
    if (e.type === 'crate') {
      g.effects.debris(x, y + 0.8, z, MAT.crate, 7, 0.55, 7);
      g.fx.burst(x, y + 0.8, z, { n: 14, speed: 5, life: 0.9, size: [1.2, 2.5], colors: [0xb9853f, 0x8a6030], gravity: 4, drag: 2, smoke: true, alpha: 0.7 });
      who?.addXP(15, x, y + 2, z);
      if (who) g.events.emit('progress', { player: who, id: 'crate', value: 1 });
      g.audio.play('crate');
      const roll = Math.random();
      if (roll < 0.15) this.add('powerup', x, z, { chunk: e.chunk });
      else if (roll < 0.5) this.add('gem', x, z, { chunk: e.chunk });
    } else if (e.type === 'barrel') {
      g.combat.explode(x, y + 0.7, z, 8, 60, by, null, 1, e);
      who?.addXP(20, x, y + 2, z);
      if (who) g.events.emit('progress', { player: who, id: 'barrel', value: 1 });
    } else if (e.type === 'cone') {
      g.effects.debris(x, y + 0.4, z, MAT.cone, 2, 0.35, 6);
      g.audio.play('cone');
    } else if (e.type === 'drone') {
      g.combat.explode(x, y, z, 5, 20, by, null, 0.6, e);
      g.effects.debris(x, y, z, MAT.droneBody, 6, 0.45, 9);
      who?.addXP(DRONE_TYPES[e.kind ?? 'gunner'].xp, x, y + 2, z);
      if (who) { g.events.emit('progress', { player: who, id: 'drone', value: 1 }); who.s.kills++; }
      if (Math.random() < 0.6) this.add('gem', x, z, { chunk: e.chunk });
    }
  }

  /** Best auto-aim target in front of a player. */
  findTarget(px: number, pz: number, h: number): Entity | null {
    let best: Entity | null = null, score = 1e9;
    const fx = Math.sin(h), fz = Math.cos(h);
    for (const e of this.list) {
      if (!e.alive || e.type === 'gem' || e.type === 'cone' || e.type === 'powerup') continue;
      const dx = e.x - px, dz = e.z - pz, d = Math.hypot(dx, dz);
      if (d > (e.type === 'drone' ? AIM.droneRange : AIM.propRange) || d < 2) continue;
      const ang = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1));
      if (ang > AIM.cone) continue;
      const s = ang * 40 + d * (e.type === 'drone' ? 0.5 : 1);
      if (s < score) { score = s; best = e; }
    }
    return best;
  }

  /** Solid prop the bike/walker would run into. */
  hitTest(x: number, y: number, z: number, r: number): Entity | null {
    for (const e of this.list) {
      if (!e.alive || e.type === 'gem' || e.type === 'drone' || e.type === 'powerup') continue;
      const dx = x - e.x, dz = z - e.z, rr = r + e.r;
      if (dx * dx + dz * dz < rr * rr && y < e.y + 1.8) return e;
    }
    return null;
  }

  update(dt: number) {
    const g = this.game, T = g.time;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.alive) { this.list.splice(i, 1); continue; }
      e.t += dt;
      if (e.fuse > 0) { e.fuse -= dt; if (e.fuse <= 0) { this.destroy(e, null); continue; } }
      if (e.hitFlash > 0) { e.hitFlash -= dt; e.mesh.scale.setScalar(1 + e.hitFlash * 1.5); }
      else if (e.mesh.scale.x !== 1) e.mesh.scale.setScalar(1);

      if (e.type === 'gem' || e.type === 'powerup') {
        e.mesh.rotation.y += dt * 2.5;
        e.bob!.position.y = Math.sin(e.t * 2.5) * 0.3;
        for (const p of g.players) {
          if (p.s.dead) continue;
          const P = p.P, dx = P.x - e.x, dy = P.y + 1.2 - e.y, dz = P.z - e.z, d = Math.hypot(dx, dy, dz);
          const magnet = e.type === 'gem' ? p.magnetRange() : 3;
          if (d < magnet && d > 0.01) {
            const s = Math.min(d, 25 * dt);
            e.x += (dx / d) * s; e.y += (dy / d) * s; e.z += (dz / d) * s;
            e.mesh.position.set(e.x, e.y, e.z);
          }
          if (d < 1.8) {
            this.remove(e);
            if (e.type === 'gem') p.collectGem(e.x, e.y, e.z);
            else p.collectPowerup(e.power!, e.x, e.y, e.z);
            break;
          }
        }
      } else if (e.type === 'drone') this.updateDrone(e, dt, T);
    }
  }

  private updateDrone(e: Entity, dt: number, T: number) {
    const g = this.game, u = e.drone!, D = DRONE_TYPES[e.kind ?? 'gunner'];
    u.rotors.forEach((r, j) => (r.rotation.y += dt * 40 * (j % 2 ? 1 : -1)));
    const target = g.nearestPlayer(e.x, e.z, true);
    let tx = e.x, tz = e.z, ty = g.terrain.groundAt(e.x, e.z) + 7 + Math.sin(e.t * 2) * 0.6;
    const d = target ? Math.hypot(target.P.x - e.x, target.P.z - e.z) : 1e9;
    const wantEngage = !!target && d < DRONES.engageDist;
    if (wantEngage && !e.engaged && this.attacking < DRONES.maxAttacking) { e.engaged = true; this.attacking++; }
    if (!wantEngage && e.engaged) { e.engaged = false; this.attacking--; }
    if (e.engaged && target) {
      const P = target.P, diff = clamp(Math.hypot(P.x, P.z) / 2500, 0, 1);
      e.ang += dt * 0.5 * D.speed;
      tx = P.x + Math.sin(e.ang) * D.orbit;
      tz = P.z + Math.cos(e.ang) * D.orbit;
      ty = Math.max(g.terrain.groundAt(tx, tz), P.y) + (D.bomb ? 11 : 6) + Math.sin(e.t * 2) * 0.6;
      e.cool -= dt;
      u.eye.scale.setScalar(e.cool < 0.5 ? 1.6 + Math.sin(T * 40) * 0.3 : 1);
      if (e.cool <= 0 && d < DRONES.fireDist) {
        e.cool = (lerp(DRONES.cooldownEasy, DRONES.cooldownHard, diff) + Math.random() * 0.6) * D.cool;
        g.combat.droneShot(e, target);
      }
      e.mesh.lookAt(P.x, e.y, P.z);
    }
    const sp = Math.min(1, dt * 1.6 * D.speed), dx = (tx - e.x) * sp, dy = (ty - e.y) * sp, dz = (tz - e.z) * sp;
    e.x += dx; e.y += dy; e.z += dz;
    e.vx = dx / dt; e.vy = dy / dt; e.vz = dz / dt;
    e.mesh.position.set(e.x, e.y, e.z);
    e.mesh.rotation.z = Math.sin(e.t * 3) * 0.1;
  }

  /** Minimap dots. */
  forEachVisible(fn: (e: Entity) => void) {
    for (const e of this.list) if (e.alive && (e.type === 'gem' || e.type === 'drone' || e.type === 'powerup')) fn(e);
  }
}

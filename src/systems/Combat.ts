// Projectiles, beams, mines, explosions and enemy orbs. Meshes and materials are pooled per weapon.
import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Player } from '../entities/Player';
import type { Entity } from '../entities/EntityManager';
import type { Vec3 } from '../../shared/protocol';
import { WEAPONS, type WeaponDef } from '../data/weapons';
import { G, MAT } from '../entities/assets';
import { AIM, DRONES, DRONE_TYPES } from '../config';
import { clamp, rnd } from '../utils/math';

interface Shot {
  m: THREE.Mesh;
  w: WeaponDef;
  wi: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  dmg: number;
  owner: Player | null; // local shooter
  remote: string | null; // remote shooter id
  target: Entity | null;
  armed: number;
}

interface Orb { m: THREE.Mesh; p: THREE.Vector3; v: THREE.Vector3; life: number; g: number; dmg: number; bomb: boolean }

const _d = new THREE.Vector3(), _o = new THREE.Vector3(), _t = new THREE.Vector3(), _end = new THREE.Vector3();

export class Combat {
  private shots: Shot[] = [];
  private orbs: Orb[] = [];
  private free = new Map<number, THREE.Mesh[]>();
  private mats: THREE.MeshBasicMaterial[];

  constructor(private game: Game) {
    this.mats = WEAPONS.map((w) => new THREE.MeshBasicMaterial({ color: w.color, transparent: true, blending: THREE.AdditiveBlending }));
  }

  private meshFor(wi: number) {
    const pool = this.free.get(wi);
    const m = pool?.pop();
    if (m) { m.visible = true; return m; }
    const w = WEAPONS[wi];
    const geo = w.id === 'rocket' ? G.rocket : w.mine ? G.mine : w.pellets > 1 ? G.pellet : G.bolt;
    const mesh = new THREE.Mesh(geo, this.mats[wi]);
    this.game.scene.add(mesh);
    return mesh;
  }

  private release(s: Shot) {
    s.m.visible = false;
    let pool = this.free.get(s.wi);
    if (!pool) this.free.set(s.wi, (pool = []));
    pool.push(s.m);
  }

  /** Local player pulls the trigger. */
  fire(p: Player) {
    const g = this.game, wi = p.s.weapon, w = WEAPONS[wi];
    p.s.fireCd = 1 / (w.rate * p.stats.fire);
    const P = p.P, fx = Math.sin(P.h), fz = Math.cos(P.h);
    const dirs: Vec3[] = [];
    if (w.mine) {
      _o.set(P.x - fx * 2.2, g.terrain.groundAt(P.x - fx * 2.2, P.z - fz * 2.2) + 0.15, P.z - fz * 2.2);
      this.spawn(wi, _o, _d.set(0, 0, 0), p, null, p.aimTarget);
      dirs.push([0, 0, 0]);
    } else {
      _o.set(P.x + fx * 1.6, P.y + (p.riding ? 2.1 : 1.6), P.z + fz * 1.6);
      const t = p.aimTarget;
      if (t) {
        // lead the target: aim where it will be when the shot arrives
        _d.set(t.x, t.y + (t.type === 'drone' ? 0 : 0.8), t.z);
        if (AIM.lead && w.speed > 0) {
          const flight = _d.distanceTo(_o) / w.speed;
          _d.x += t.vx * flight; _d.y += t.vy * flight; _d.z += t.vz * flight;
        }
        _d.sub(_o).normalize();
      }
      else _d.set(fx, p.riding ? -p.B.pitch * 0.5 : 0, fz).normalize();
      for (let i = 0; i < w.pellets; i++) {
        const sp = w.spread * (t && w.pellets === 1 ? 1 - AIM.assist : 1);
        _t.copy(_d).add(_end.set(rnd(sp), rnd(sp), rnd(sp))).normalize();
        dirs.push([_t.x, _t.y, _t.z]);
        if (w.beam) this.beam(_o, _t, w, p, null);
        else this.spawn(wi, _o, _t, p, null, t);
      }
      g.fx.burst(_o.x, _o.y, _o.z, { n: 8, speed: 8, life: 0.15, size: [0.6, 0.1], colors: [w.color, 0xffffff], drag: 4 });
    }
    g.audio.play(w.sfx);
    if (w.shake) p.cam.shake = Math.max(p.cam.shake, w.shake);
    g.net?.send({ t: 'fire', w: wi, o: [_o.x, _o.y, _o.z], d: dirs });
  }

  /** A remote player fired: replay the shots locally (they can hurt local players when PvP is on). */
  fireRemote(id: string, wi: number, o: Vec3, dirs: Vec3[]) {
    const w = WEAPONS[wi];
    if (!w) return;
    _o.set(o[0], o[1], o[2]);
    for (const d of dirs.slice(0, 12)) {
      _t.set(d[0], d[1], d[2]);
      if (w.beam) this.beam(_o, _t, w, null, id);
      else this.spawn(wi, _o, _t, null, id, null);
    }
    this.game.fx.burst(_o.x, _o.y, _o.z, { n: 6, speed: 8, life: 0.15, size: [0.6, 0.1], colors: [w.color, 0xffffff], drag: 4 });
  }

  private spawn(wi: number, o: THREE.Vector3, d: THREE.Vector3, owner: Player | null, remote: string | null, target: Entity | null) {
    const w = WEAPONS[wi], m = this.meshFor(wi);
    m.position.copy(o);
    if (!w.mine) m.lookAt(_end.copy(o).add(d));
    else m.rotation.set(0, 0, 0);
    const v = d.clone().multiplyScalar(w.speed);
    if (owner && owner.riding && !w.mine) {
      v.x += Math.sin(owner.B.moveH) * owner.B.v;
      v.z += Math.cos(owner.B.moveH) * owner.B.v;
    }
    this.shots.push({ m, w, wi, p: o.clone(), v, life: w.life, dmg: w.dmg * (owner?.stats.dmg ?? 1), owner, remote, target: w.homing ? target : null, armed: w.mine ? 0.7 : 0 });
  }

  /** Railgun: instant piercing hitscan. */
  private beam(o: THREE.Vector3, d: THREE.Vector3, w: WeaponDef, owner: Player | null, remote: string | null) {
    const g = this.game, dmg = w.dmg * (owner?.stats.dmg ?? 1), hitSet = new Set<Entity>(), hitPlayers = new Set<Player>();
    _end.copy(o);
    for (let len = 0; len < 140; len += 1.5) {
      _end.copy(o).addScaledVector(d, len);
      if (_end.y < g.terrain.groundAt(_end.x, _end.z)) break;
      if (owner) {
        for (const e of g.entities.list) {
          if (!e.alive || hitSet.has(e) || e.type === 'gem' || e.type === 'powerup') continue;
          const cy = e.type === 'drone' ? e.y : e.y + 0.8;
          if ((_end.x - e.x) ** 2 + (_end.y - cy) ** 2 + (_end.z - e.z) ** 2 < (e.r + 0.4) ** 2) hitSet.add(e);
        }
      }
      if (this.canHurt(owner, remote)) for (const p of g.players) if (p !== owner && !p.s.dead && this.nearPlayer(_end, p)) hitPlayers.add(p);
    }
    hitPlayers.forEach((p) => p.hurt(dmg * 0.6, owner?.name));
    for (const e of hitSet) {
      g.entities.damage(e, dmg, owner);
      if (e.alive) owner?.hud.float(String(Math.round(dmg)), e.x, e.y + 2, e.z, '#fff', 13);
    }
    if (hitSet.size) { g.audio.play('hit'); owner?.hud.hitMarker([...hitSet].some((e) => !e.alive)); }
    g.effects.beam(o, _end, w.color);
    g.fx.burst(_end.x, _end.y, _end.z, { n: 16, speed: 9, life: 0.4, size: [0.6, 0.05], colors: [w.color, 0xffffff], gravity: 6, drag: 2 });
  }

  private canHurt(owner: Player | null, remote: string | null) {
    return this.game.opts.pvp && (!!owner || !!remote);
  }

  private nearPlayer(p: THREE.Vector3, pl: Player, r = 1.3) {
    const P = pl.P;
    return (p.x - P.x) ** 2 + (p.y - (P.y + 1.2)) ** 2 + (p.z - P.z) ** 2 < r * r;
  }

  droneShot(e: Entity, target: Player) {
    const D = DRONE_TYPES[e.kind ?? 'gunner'];
    if (D.bomb) return this.dropBomb(e, target, D.dmg);
    const P = target.P, d = Math.hypot(P.x - e.x, P.z - e.z), lead = d / 34;
    const vx = target.riding ? Math.sin(target.B.moveH) * target.B.v : 0, vz = target.riding ? Math.cos(target.B.moveH) * target.B.v : 0;
    const p = new THREE.Vector3(e.x, e.y, e.z);
    const v = new THREE.Vector3(P.x + vx * lead * 0.7, P.y + 1.2, P.z + vz * lead * 0.7).sub(p).normalize().multiplyScalar(DRONES.orbSpeed);
    const m = new THREE.Mesh(G.pellet, MAT.orb);
    m.scale.setScalar(2.6);
    m.position.copy(p);
    this.game.scene.add(m);
    this.orbs.push({ m, p, v, life: 4, g: 0, dmg: D.dmg, bomb: false });
    this.game.audio.play('orb');
  }

  /** Bomber drones lob a bomb that lands where the target is heading. */
  private dropBomb(e: Entity, target: Player, dmg: number) {
    const P = target.P, t = 1.3, gr = 20;
    const vx = target.riding ? Math.sin(target.B.moveH) * target.B.v : 0, vz = target.riding ? Math.cos(target.B.moveH) * target.B.v : 0;
    const tx = P.x + vx * t, tz = P.z + vz * t, ty = this.game.terrain.groundAt(tx, tz);
    const p = new THREE.Vector3(e.x, e.y - 1, e.z);
    const v = new THREE.Vector3((tx - p.x) / t, (ty - p.y + 0.5 * gr * t * t) / t, (tz - p.z) / t);
    const m = new THREE.Mesh(G.mine, MAT.orb);
    m.scale.setScalar(1.3);
    m.position.copy(p);
    this.game.scene.add(m);
    this.orbs.push({ m, p, v, life: 4, g: gr, dmg, bomb: true });
    this.game.audio.play('mine');
  }

  explode(x: number, y: number, z: number, r: number, dmg: number, owner: Player | null, remote: string | null, scale = 1, src: Entity | null = null, broadcast = true) {
    const g = this.game, fx = g.fx;
    fx.burst(x, y, z, { n: 60 * scale, speed: 16 * scale, life: 0.7, size: [2.2 * scale, 0.2], colors: [0xffd060, 0xff8a2a, 0xff5520, 0xffffff], gravity: -2, drag: 2.2 });
    fx.burst(x, y, z, { n: 30 * scale, speed: 30 * scale, life: 0.6, size: [0.35, 0.05], colors: [0xffe08a, 0xffffff], gravity: 22, drag: 0.8 });
    fx.burst(x, y, z, { n: 28 * scale, speed: 5 * scale, life: 2.2, size: [2 * scale, 6 * scale], colors: [0x3a3a3a, 0x555555, 0x6a6a6a], gravity: -1.5, drag: 1.2, smoke: true, alpha: 0.7 });
    g.effects.ring(x, Math.max(y - 0.5, g.terrain.groundAt(x, z) + 0.2), z, r * 1.6, 0xffa040);
    g.env.boomLight.position.set(x, y + 1, z);
    g.env.boomLight.intensity = 8 * scale;
    let closest = 1e9;
    for (const p of g.players) {
      const P = p.P, pd = Math.hypot(P.x - x, P.y + 1 - y, P.z - z);
      closest = Math.min(closest, pd);
      p.cam.shake = Math.max(p.cam.shake, clamp(1.1 - pd / 50, 0, 1) * 0.9 * scale);
      if (r <= 0 || pd >= r) continue;
      const self = owner === p;
      const allowed = !owner && !remote ? true : self ? pd < r * 0.5 : g.opts.pvp;
      if (allowed) {
        p.hurt(dmg * 0.45 * (1 - pd / r), owner?.name);
        p.knock(1 - pd / r);
      }
    }
    g.audio.play('boom', clamp(1.2 - closest / 120, 0.2, 1) * scale);
    if (remote) return;
    for (const e of g.entities.list) {
      if (!e.alive || e === src || e.type === 'gem' || e.type === 'powerup') continue;
      const d = Math.hypot(e.x - x, e.y - y, e.z - z);
      if (d < r) {
        if (e.type === 'barrel') e.fuse = 0.12 + Math.random() * 0.12;
        else g.entities.damage(e, dmg * (1 - d / r), owner);
      }
    }
    if (broadcast && owner && r > 0) g.net?.send({ t: 'boom', p: [x, y, z], r, dmg });
  }

  update(dt: number) {
    const g = this.game;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.life -= dt;
      let hit = false, hitE: Entity | null = null;
      if (s.w.mine) {
        s.armed -= dt;
        if (s.armed <= 0) {
          if (s.owner) for (const e of g.entities.list) {
            if (!e.alive || e.type === 'gem' || e.type === 'powerup') continue;
            if ((s.p.x - e.x) ** 2 + (s.p.z - e.z) ** 2 < 6.25 && Math.abs(s.p.y - e.y) < 8) { hit = true; break; }
          }
          if (g.opts.pvp) for (const p of g.players) if (p !== s.owner && !p.s.dead && this.nearPlayer(s.p, p, 2.5)) hit = true;
          if (g.remotes && s.owner) g.remotes.forEach((r) => { if ((s.p.x - r.x) ** 2 + (s.p.z - r.z) ** 2 < 6.25) hit = true; });
        }
        s.m.rotation.y += dt * 3;
      } else {
        if (s.w.homing && s.target?.alive) {
          _t.set(s.target.x, s.target.y + (s.target.type === 'drone' ? 0 : 0.8), s.target.z).sub(s.p).normalize();
          const sp = s.v.length();
          s.v.normalize().lerp(_t, Math.min(1, s.w.homing * dt)).normalize().multiplyScalar(sp);
          s.m.lookAt(_end.copy(s.p).add(s.v));
        }
        const steps = Math.max(1, Math.ceil((s.v.length() * dt) / 1.2)), sdt = dt / steps;
        for (let k = 0; k < steps && !hit; k++) {
          s.p.addScaledVector(s.v, sdt);
          if (s.w.drop) s.v.y -= s.w.drop * sdt;
          if (s.owner)
            for (const e of g.entities.list) {
              if (!e.alive || e.type === 'gem' || e.type === 'powerup') continue;
              const cy = e.type === 'drone' ? e.y : e.y + 0.8;
              if ((s.p.x - e.x) ** 2 + (s.p.y - cy) ** 2 + (s.p.z - e.z) ** 2 < (e.r + 0.35) ** 2) { hit = true; hitE = e; break; }
            }
          if (!hit && this.canHurt(s.owner, s.remote))
            for (const p of g.players) {
              if (p === s.owner || p.s.dead || !this.nearPlayer(s.p, p)) continue;
              hit = true;
              if (!s.w.splash) p.hurt(s.dmg * 0.6, s.owner?.name);
              break;
            }
          if (!hit && s.owner && g.remotes) g.remotes.forEach((r) => { if (!hit && (s.p.x - r.x) ** 2 + (s.p.y - r.y - 1.2) ** 2 + (s.p.z - r.z) ** 2 < 1.7) hit = true; });
          if (!hit && s.p.y < g.terrain.groundAt(s.p.x, s.p.z)) hit = true;
          if (!hit) {
            const c = g.chunks.at(s.p.x, s.p.z);
            if (c) for (const o of c.obs) if ((s.p.x - o.x) ** 2 + (s.p.z - o.z) ** 2 < o.r * o.r + 0.3 && s.p.y < o.top) { hit = true; break; }
          }
        }
        if (s.w.id === 'rocket' || s.w.homing) {
          g.fx.emit(s.p.x, s.p.y, s.p.z, rnd(0.5), rnd(0.5) + 0.5, rnd(0.5), 0.9, 0.4, 1.6, 0xbbbbbb, 0.5, -0.5, 1, true);
          g.fx.emit(s.p.x, s.p.y, s.p.z, 0, 0, 0, 0.12, 0.7, 0.2, s.w.color, 1);
        }
      }
      s.m.position.copy(s.p);
      if (hit || s.life <= 0) {
        if (s.w.splash) this.explode(s.p.x, s.p.y, s.p.z, s.w.splash, s.dmg, s.owner, s.remote, s.w.mine ? 0.9 : 0.8, null, false);
        else if (hit) {
          g.fx.burst(s.p.x, s.p.y, s.p.z, { n: 10, speed: 7, life: 0.3, size: [0.4, 0.05], colors: [s.w.color, 0xffffff], gravity: 8, drag: 2 });
          if (hitE) g.audio.play('hit');
        }
        if (hitE) s.owner?.hud.hitMarker(!hitE.alive || hitE.hp <= s.dmg);
        if (hitE && !s.w.splash) {
          g.entities.damage(hitE, s.dmg, s.owner);
          if (hitE.alive) s.owner?.hud.float(String(Math.round(s.dmg)), hitE.x, hitE.y + 2, hitE.z, '#fff', 13);
        }
        this.release(s);
        this.shots.splice(i, 1);
      }
    }
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.life -= dt;
      o.v.y -= o.g * dt;
      o.p.addScaledVector(o.v, dt);
      o.m.position.copy(o.p);
      if (o.bomb) o.m.rotation.x += dt * 6;
      g.fx.emit(o.p.x, o.p.y, o.p.z, rnd(0.5), rnd(0.5), rnd(0.5), 0.3, 1, 0.1, 0xff3355, 0.9);
      let victim: Player | null = null;
      for (const p of g.players) if (!p.s.dead && this.nearPlayer(o.p, p, 1.5)) victim = p;
      if (victim || o.life <= 0 || o.p.y < g.terrain.groundAt(o.p.x, o.p.z)) {
        if (o.bomb) this.explode(o.p.x, o.p.y, o.p.z, 6, o.dmg * 2.2, null, null, 0.7, null, false);
        else if (victim) {
          victim.hurt(o.dmg || DRONES.orbDamage);
          g.fx.burst(o.p.x, o.p.y, o.p.z, { n: 20, speed: 8, life: 0.4, size: [0.6, 0.05], colors: [0xff3355, 0xffffff], gravity: 4, drag: 2 });
        }
        this.orbs.splice(i, 1);
        g.scene.remove(o.m);
      }
    }
  }
}

// Open-world traffic with Burnout-style risk rewards. Civilian cars drive in the right-hand lane of the
// road grid around every local player (pooled models, streamed in out of sight). Threading past them
// fast earns NEAR MISS chains (oncoming traffic pays double) that refill nitro and give XP; tucking in
// behind a car charges nitro from its slipstream. Hitting one is a crash.
import type { Game } from '../core/Game';
import type { Player } from '../entities/Player';
import { buildVehicleModel, type VehicleModel } from '../entities/vehicleModels';
import type { VehicleModelId } from '../data/vehicles';
import { clamp, lerp, lerpAngle, wrapPi } from '../utils/math';
import type { ModeFeature, ReplayVisit } from './index';

export const TRAFFIC = {
  /** Cars per local player for density 1 (light) and 2 (heavy). */
  perPlayer: [0, 7, 13],
  lane: 3.1, // metres right of the road centre line
  speed: [13, 21] as [number, number], // m/s cruise range (47..76 km/h)
  spawnMin: 110, spawnMax: 190, despawn: 250,
  carRadius: 2.2,
  nearMissSide: 3.6, closeShave: 2.5, nearMissMinSpeed: 14,
  chainWindow: 4, xp: 30, nitro: 9,
  draftDist: 16, draftNitro: 7,
};

const MODELS: VehicleModelId[] = ['hatch', 'roadster', 'touring', 'muscle', 'rally', 'drift_coupe', 'touring', 'hatch', 'rotary', 'trophy', 'gt'];
const PAINT = [0xd8d8d8, 0x2b2f38, 0x9c1f1f, 0x1f4f9c, 0xe6e1d0, 0x3f6b3a, 0xc9a227, 0x6d6f75, 0x7a2f8a, 0xf0f0f0, 0x153a5c];

interface Car {
  model: VehicleModel;
  id: VehicleModelId;
  paint: number;
  active: boolean;
  x: number; y: number; z: number; h: number;
  v: number; cruise: number; stun: number; wheel: number;
  /** Per local player: which side of the player the car was last frame (+ ahead / - behind), NaN = unknown. */
  along: number[];
  /** Per local player: this pass already ended in a collision. */
  hit: boolean[];
}

interface Chain { n: number; t: number; pts: number; el: HTMLDivElement; text: HTMLDivElement; draft: HTMLDivElement; hitCd: number; drafting: boolean; hideT: number }

export class Traffic implements ModeFeature {
  private cars: Car[] = [];
  private chains: Chain[] = [];
  private spawnT = 0;

  constructor(private game: Game, density: number) {
    const n = TRAFFIC.perPlayer[clamp(Math.round(density), 0, 2)] * game.players.length;
    for (let i = 0; i < n; i++) {
      const model = buildVehicleModel(MODELS[i % MODELS.length], PAINT[(i * 7) % PAINT.length]);
      // 10+ spotlights would blow the light budget: traffic drives on body lights only
      model.headlight.parent?.remove(model.headlight);
      model.headlight.target.parent?.remove(model.headlight.target);
      if (model.driver) model.driver.visible = true;
      model.root.visible = false;
      game.scene.add(model.root);
      this.cars.push({ model, id: MODELS[i % MODELS.length], paint: PAINT[(i * 7) % PAINT.length], active: false, x: 0, y: 0, z: 0, h: 0, v: 0, cruise: 15, stun: 0, wheel: 0, along: game.players.map(() => NaN), hit: game.players.map(() => false) });
    }
    for (const p of game.players) {
      const el = document.createElement('div');
      el.className = 'md-traffic';
      el.innerHTML = '<div class="md-nm"></div><div class="md-draft">💨 SLIPSTREAM · nitro charging</div>';
      p.hud.root.appendChild(el);
      this.chains.push({ n: 0, t: 0, pts: 0, el, text: el.firstElementChild as HTMLDivElement, draft: el.lastElementChild as HTMLDivElement, hitCd: 0, drafting: false, hideT: 0 });
    }
  }

  update(dt: number) {
    const g = this.game;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.4;
      const free = this.cars.find((c) => !c.active);
      if (free) this.spawn(free);
    }
    for (const c of this.cars) if (c.active) this.drive(c, dt);
    g.players.forEach((p, i) => this.interact(p, i, dt));
  }

  /** Replay: every pooled car is an actor (inactive ones are hidden roots, so they simply don't show). */
  replayActors(visit: ReplayVisit) {
    for (const c of this.cars) visit(c, c.model, 'Traffic', c.paint, c.id);
  }

  private spawn(c: Car) {
    const g = this.game, ps = g.players;
    if (!ps.length) return;
    const p = ps[Math.floor(Math.random() * ps.length)];
    // mostly ahead of the player, where they are heading
    const ang = p.P.h + (Math.random() < 0.75 ? (Math.random() - 0.5) * 1.6 : Math.random() * Math.PI * 2);
    const d = TRAFFIC.spawnMin + Math.random() * (TRAFFIC.spawnMax - TRAFFIC.spawnMin);
    const road = g.layout.nearestRoad(p.P.x + Math.sin(ang) * d, p.P.z + Math.cos(ang) * d);
    for (const q of ps) if (Math.hypot(q.P.x - road.x, q.P.z - road.z) < TRAFFIC.spawnMin * 0.8) return;
    if (g.terrain.heightAt(road.x, road.z) < 0.5) return; // flooded / water crossing
    const h = road.h + (Math.random() < 0.5 ? Math.PI : 0);
    for (const o of this.cars) if (o.active && Math.hypot(o.x - road.x, o.z - road.z) < 25) return;
    c.h = h;
    c.x = road.x - Math.cos(h) * TRAFFIC.lane;
    c.z = road.z + Math.sin(h) * TRAFFIC.lane;
    c.y = g.terrain.heightAt(c.x, c.z);
    c.cruise = TRAFFIC.speed[0] + Math.random() * (TRAFFIC.speed[1] - TRAFFIC.speed[0]);
    c.v = c.cruise;
    c.stun = 0;
    c.active = true;
    c.along.fill(NaN);
    c.hit.fill(false);
    c.model.root.visible = true;
  }

  private drive(c: Car, dt: number) {
    const g = this.game, L = TRAFFIC.lane;
    let far = true;
    for (const p of g.players) if (Math.hypot(p.P.x - c.x, p.P.z - c.z) < TRAFFIC.despawn) far = false;
    if (far) { c.active = false; c.model.root.visible = false; return; }
    // keep a gap to whatever is ahead in the lane (other cars, a stopped player)
    let target = c.stun > 0 ? 0 : c.cruise;
    c.stun -= dt;
    const fx = Math.sin(c.h), fz = Math.cos(c.h);
    for (const o of this.cars) {
      if (o === c || !o.active) continue;
      const dx = o.x - c.x, dz = o.z - c.z, a = dx * fx + dz * fz, s = Math.abs(dx * fz - dz * fx);
      if (a > 0 && a < 16 && s < 2.2) target = Math.min(target, a < 8 ? 0 : o.v);
    }
    for (const p of g.players) {
      const dx = p.P.x - c.x, dz = p.P.z - c.z, a = dx * fx + dz * fz, s = Math.abs(dx * fz - dz * fx);
      if (a > 0 && a < 14 && s < 2.4 && Math.abs(p.P.v) < c.v) target = Math.min(target, a < 6 ? 0 : Math.max(0, p.P.v));
    }
    c.v += clamp(target - c.v, -14 * dt, 5 * dt);
    // follow the road: snap to the lane on the nearest road unless that road crosses ours (junction: go straight)
    const nx = c.x + fx * c.v * dt, nz = c.z + fz * c.v * dt;
    const road = g.layout.nearestRoad(nx + Math.cos(c.h) * L, nz - Math.sin(c.h) * L);
    let rh = road.h;
    if (Math.cos(rh - c.h) < 0) rh += Math.PI;
    if (Math.abs(wrapPi(rh - c.h)) < 0.55) {
      c.h = lerpAngle(c.h, rh, Math.min(1, dt * 5));
      const k = Math.min(1, dt * 6);
      c.x = lerp(nx, road.x - Math.cos(rh) * L, k);
      c.z = lerp(nz, road.z + Math.sin(rh) * L, k);
    } else { c.x = nx; c.z = nz; }
    const y = g.terrain.heightAt(c.x, c.z), ahead = g.terrain.heightAt(c.x + fx * 2.5, c.z + fz * 2.5);
    c.y = lerp(c.y, y, Math.min(1, dt * 12));
    c.wheel += (c.v * dt) / c.model.wheelRadius;
    const m = c.model;
    m.wheels.forEach((w) => (w.rotation.x = c.wheel));
    m.root.position.set(c.x, c.y, c.z);
    m.root.rotation.set(-Math.atan2(ahead - y, 2.5), c.h, 0, 'YXZ');
  }

  private interact(p: Player, i: number, dt: number) {
    const ch = this.chains[i], B = p.B, T = TRAFFIC;
    ch.hitCd -= dt;
    if (ch.hideT > 0 && (ch.hideT -= dt) <= 0) ch.el.classList.remove('show');
    if (ch.n && (ch.t -= dt) <= 0) this.endChain(ch);
    let drafting = false;
    const riding = p.riding && !p.s.dead;
    const fx = Math.sin(B.h), fz = Math.cos(B.h), speed = Math.abs(B.v);
    for (const c of this.cars) {
      if (!c.active) continue;
      const dx = c.x - B.x, dz = c.z - B.z, dist = Math.hypot(dx, dz);
      if (dist > 30) { c.along[i] = NaN; continue; }
      // contact
      const R = T.carRadius + (p.isCar ? 0.9 : 0.4);
      if (riding && dist < R && Math.abs(B.y - c.y) < 2) {
        const nxv = dist > 0.01 ? dx / dist : 1, nzv = dist > 0.01 ? dz / dist : 0;
        B.x -= nxv * (R - dist);
        B.z -= nzv * (R - dist);
        const rvx = Math.sin(B.moveH) * B.v - Math.sin(c.h) * c.v, rvz = Math.cos(B.moveH) * B.v - Math.cos(c.h) * c.v, rel = Math.hypot(rvx, rvz);
        if (rel > 7 && ch.hitCd <= 0) this.crash(p, c, rel, ch);
        else B.v *= 0.97;
        c.hit[i] = true;
      } else if (!p.riding && !p.s.dead && dist < T.carRadius + 0.5) {
        p.W.x -= (dx / Math.max(dist, 0.01)) * (T.carRadius + 0.5 - dist); // shove pedestrians aside
        p.W.z -= (dz / Math.max(dist, 0.01)) * (T.carRadius + 0.5 - dist);
      }
      const along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
      // near miss: the car went from ahead of us to behind us, close at the side, at speed, untouched
      if (riding && !B.air && c.along[i] > 0 && along <= 0 && side < T.nearMissSide && speed > T.nearMissMinSpeed && !c.hit[i]) this.nearMiss(p, c, side, ch);
      if (along <= 0) c.hit[i] = false;
      c.along[i] = along;
      // slipstream: close behind a car going the same way (on the ground: no drafting from a thruster flight overhead)
      if (riding && !B.air && along > 3 && along < T.draftDist && side < 1.8 && Math.cos(c.h - B.h) > 0.8 && speed > 12) drafting = true;
    }
    if (drafting) p.s.nitro = Math.min(p.stats.nitroMax, p.s.nitro + T.draftNitro * dt);
    if (drafting !== ch.drafting) { ch.drafting = drafting; ch.draft.classList.toggle('on', drafting); }
  }

  private nearMiss(p: Player, c: Car, side: number, ch: Chain) {
    const g = this.game, T = TRAFFIC;
    const oncoming = Math.cos(c.h - p.B.h) < -0.3, close = side < T.closeShave;
    ch.n = ch.t > 0 ? ch.n + 1 : 1;
    ch.t = T.chainWindow;
    const mult = Math.min(ch.n, 8), pts = Math.round(T.xp * (oncoming ? 2 : 1) * (close ? 1.5 : 1) * mult);
    ch.pts += pts;
    g.career?.feat('nearMiss', ch.n);
    p.s.nitro = Math.min(p.stats.nitroMax, p.s.nitro + T.nitro * (oncoming ? 2 : 1));
    p.addXP(pts, c.x, c.y + 2.2, c.z);
    g.audio.play('whoosh');
    if (mult >= 3) g.audio.play('trick');
    p.hud.flash(oncoming ? '#ff9a3d' : '#46e3ff', 0.08);
    p.cam.shake = Math.max(p.cam.shake, 0.12);
    const label = `${close ? 'CLOSE SHAVE' : 'NEAR MISS'}${oncoming ? ' · ONCOMING' : ''}`;
    ch.text.innerHTML = `<b>${label}</b><span>x${mult} · ${ch.pts.toLocaleString()} pts</span>`;
    ch.el.classList.remove('pop');
    void ch.el.offsetWidth;
    ch.el.classList.add('pop', 'show');
    ch.hideT = 0;
  }

  private endChain(ch: Chain) {
    if (ch.n >= 3) ch.text.innerHTML = `<b>CHAIN BANKED</b><span>${ch.n} near misses · ${ch.pts.toLocaleString()} pts</span>`;
    ch.hideT = ch.n >= 3 ? 1.6 : 0.3;
    ch.n = 0;
    ch.pts = 0;
  }

  private crash(p: Player, c: Car, rel: number, ch: Chain) {
    const g = this.game;
    ch.hitCd = 1.2;
    if (ch.n) { ch.text.innerHTML = '<b class="bad">CHAIN LOST</b><span>hit traffic</span>'; ch.n = 0; ch.pts = 0; ch.t = 0; ch.hideT = 1.2; }
    p.hud.banner('CRASH!', 'hit traffic', '#ff4d5e');
    g.replay?.mark(p, 'crash', 'TRAFFIC'); // replay event + instant replay prompt
    g.audio.play('crash');
    g.audio.play('clank');
    p.cam.shake = 0.9;
    p.hud.flash('#ff3040', 0.25);
    p.B.v *= 0.35;
    p.s.combo = 0;
    p.hurt(clamp(rel * 1.1, 8, 40), 'traffic', true);
    c.stun = 3;
    c.v *= 0.2;
    g.fx.burst((p.B.x + c.x) / 2, c.y + 0.8, (p.B.z + c.z) / 2, { n: 26, speed: 7, life: 0.9, size: [0.5, 0.1], colors: [0xffd27a, 0xffffff, 0x888888], gravity: 6, drag: 1.5 });
  }

  dispose() {
    for (const c of this.cars) this.game.scene.remove(c.model.root);
    this.chains.forEach((c) => c.el.remove());
  }
}

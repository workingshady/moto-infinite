// Vehicle-vs-vehicle contact in every mode: local riders (split screen too), AI racers, open-world traffic and online
// players. Each physics step every vehicle is gathered into a pooled capsule body (world/collide.ts); overlapping pairs
// are pushed apart along the contact normal and exchange a mass-weighted impulse with friction and a yaw kick. Each
// owner writes the result back to its own vehicle (AiRacers / Traffic implement ContactOwner). Online players take part
// in the maths but are never moved here: their own client owns their car and its interpolation is left alone.
// Local riders get sparks, sound, shake (→ rumble) and damage scaled by the closing speed, rate-limited per vehicle;
// a bike hit hard enough throws its rider.
import type { Game } from '../core/Game';
import type { Player } from '../entities/Player';
import type { VehicleDef } from '../data/vehicles';
import { vehicleById } from '../data/vehicles';
import { ASSIST, CONTACT } from '../config';
import { prefs } from '../core/prefs';
import { collidePair, massFromSpec, newBody, resetOutputs, type Body, type ContactParams } from '../world/collide';
import type { Remote } from '../net/RemotePlayers';

export type ContactKind = 'player' | 'ai' | 'traffic' | 'remote';

/** Something that owns vehicles in the contact pass and applies the result to them. */
export interface ContactOwner {
  applyContact(ref: object, b: Body): void;
}

interface Slot { body: Body; kind: ContactKind; ref: object; owner: ContactOwner | null; name: string; bike: boolean }

const PARAMS: ContactParams = {
  restitution: CONTACT.restitution, friction: CONTACT.friction, maxPush: CONTACT.maxPush, slowPush: CONTACT.slowPush,
  spin: CONTACT.spin, maxSpin: CONTACT.maxSpin, maxDy: CONTACT.maxDy,
};

const massCache = new WeakMap<VehicleDef, number>();
/** Mass (kg, with rider/driver) of a garage vehicle, parsed once from its spec. */
export function vehicleMass(def: VehicleDef) {
  let m = massCache.get(def);
  if (m === undefined) massCache.set(def, (m = massFromSpec(def.kind, def.spec?.weight, def.f1?.mass)));
  return m;
}
/** Contact capsule (half width r, half core length a) for a vehicle. */
export function vehicleShape(def: VehicleDef) {
  return def.f1 ? CONTACT.shape.f1 : def.kind === 'bike' ? CONTACT.shape.bike : CONTACT.shape.car;
}

export class Contacts {
  private slots: Slot[] = [];
  private n = 0;
  private cd = new WeakMap<object, number>();
  private readonly bumpEv = { player: null as unknown as Player, kind: 'ai' as ContactKind, ref: {} as object, impact: 0 };

  constructor(private game: Game) {}

  /** Add a vehicle to this step's contact pass (pooled: no allocation once warmed up). */
  add(kind: ContactKind, ref: object, owner: ContactOwner | null, name: string, def: VehicleDef | null, x: number, z: number, y: number, h: number, vx: number, vz: number, apply = true) {
    let s = this.slots[this.n];
    if (!s) this.slots.push((s = { body: newBody(), kind, ref, owner, name, bike: false }));
    this.n++;
    const b = s.body, shape = def ? vehicleShape(def) : CONTACT.shape.traffic;
    s.kind = kind; s.ref = ref; s.owner = owner; s.name = name; s.bike = def?.kind === 'bike';
    b.x = x; b.z = z; b.y = y; b.h = h; b.vx = vx; b.vz = vz;
    b.m = def ? vehicleMass(def) : 1400;
    b.r = shape.r; b.a = shape.a; b.apply = apply;
    resetOutputs(b);
    return b;
  }

  private addRemote = (r: Remote) => {
    const s = r.state;
    if (!s || !s.riding || s.dead || r.away || !r.bike.root.visible) return;
    const h = r.bike.root.rotation.y;
    this.add('remote', r, null, r.name, vehicleById(r.vehicle), r.x, r.z, r.y, h, Math.sin(h) * s.v, Math.cos(h) * s.v, false);
  };

  /** One physics step: gather, resolve every touching pair, apply. */
  step(dt: number) {
    const g = this.game;
    this.n = 0;
    for (const p of g.players) {
      if (!p.riding || p.s.dead) continue;
      const B = p.B;
      this.add('player', p, null, p.name, p.def, B.x, B.z, B.y, B.h, Math.sin(B.moveH) * B.v, Math.cos(B.moveH) * B.v);
    }
    g.ai?.contactBodies(this);
    for (const m of g.modes) m.contactBodies?.(this);
    g.remotes?.forEach(this.addRemote);
    const n = this.n, S = this.slots;
    if (n < 2) return;
    for (let i = 0; i < n; i++) {
      const a = S[i];
      for (let j = i + 1; j < n; j++) {
        const b = S[j];
        // only pairs where someone local can move: AI vs AI and anything vs a local rider (traffic keeps its own gaps)
        if (a.kind !== 'player' && b.kind !== 'player' && !(a.kind === 'ai' && b.kind === 'ai')) continue;
        collidePair(a.body, b.body, PARAMS);
      }
    }
    for (let i = 0; i < n; i++) {
      const s = S[i], b = s.body;
      const cd = Math.max(0, (this.cd.get(s.ref) ?? 0) - dt);
      this.cd.set(s.ref, cd);
      if (!b.apply || (b.dvx === 0 && b.dvz === 0 && b.px === 0 && b.pz === 0 && b.spin === 0)) continue;
      if (!Number.isFinite(b.dvx + b.dvz + b.px + b.pz + b.spin)) continue; // never let a NaN into a vehicle
      if (s.kind === 'player') this.applyPlayer(s, cd);
      else {
        s.owner?.applyContact(s.ref, b);
        if (b.impact > CONTACT.fxMin && cd <= 0 && s.kind === 'ai' && b.other && this.slotOf(b.other)?.kind === 'ai') {
          this.cd.set(s.ref, CONTACT.cooldown);
          this.sparks(b, b.impact);
        }
      }
    }
  }

  private slotOf(b: Body) {
    for (let i = 0; i < this.n; i++) if (this.slots[i].body === b) return this.slots[i];
    return null;
  }

  private sparks(b: Body, impact: number) {
    const g = this.game, k = Math.min(1, impact / 25);
    g.fx.burst(b.cx, b.y + 0.6, b.cz, { n: Math.round(8 + 22 * k), speed: 4 + 6 * k, life: 0.5, size: [0.35, 0.06], colors: [0xffd27a, 0xffffff, 0xff9a3d], gravity: 9, drag: 1.5 });
  }

  private applyPlayer(s: Slot, cd: number) {
    const p = s.ref as Player, b = s.body, g = this.game;
    p.applyContact(b.dvx, b.dvz, b.px, b.pz, b.spin);
    const imp = b.impact, other = b.other ? this.slotOf(b.other) : null;
    if (!other || imp < CONTACT.fxMin) return;
    // the traffic mode (near-miss chains) and anything else listening hears about every real hit
    const ev = this.bumpEv;
    ev.player = p; ev.kind = other.kind; ev.ref = other.ref; ev.impact = imp;
    g.events.emit('bump', ev);
    if (cd > 0) return;
    this.cd.set(s.ref, CONTACT.cooldown);
    this.sparks(b, imp);
    const hard = imp > 9;
    g.audio.play(hard ? 'crash' : 'thud');
    if (hard && p.isCar) g.audio.play('clank');
    p.cam.shake = Math.max(p.cam.shake, Math.min(0.9, 0.12 + imp / 30)); // also drives controller rumble
    if (imp > CONTACT.damageMin) {
      const share = (2 * other.body.m) / (other.body.m + b.m), A = ASSIST[prefs.assist] ?? ASSIST[1];
      p.hurt((imp - CONTACT.damageMin) * CONTACT.damage * share * (1 - p.stats.crashArmor) * A.crash, other.name, true);
    }
    if (s.bike && imp > CONTACT.bikeCrash && !p.s.dead) p.crash(`Knocked off by ${other.name}`);
    else if (hard) g.replay?.mark(p, 'crash', 'CONTACT');
  }
}

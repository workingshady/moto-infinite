// Computer-driven opponents for circuit races and Formula 1 (local games only).
// Every AI drives the same vehicle physics as the player (entities/vehiclePhysics.ts) through src/ai: a learned racing
// line, a speed profile from the car's real limits, pure-pursuit steering, racecraft, mistakes, damage, recovery and
// (F1) tyre strategy, pit stops, DRS and ERS. This class adapts the Game to the bot world, runs a fixed-step loop with
// distance LOD, resolves car contact, and renders the models.
import type { Game } from '../core/Game';
import type { TrackLine } from '../world/layout';
import { buildVehicleModel, type VehicleModel } from '../entities/vehicleModels';
import { VEHICLES, type VehicleDef } from '../data/vehicles';
import { AI, CONTACT, F1, PLAYER_COLORS, ROAD, WEATHER_DEFS, type TyreCompound } from '../config';
import { toSpeedHeading, type Body } from '../world/collide';
import type { ContactOwner, Contacts } from './Contacts';
import { activeWeathers } from '../../shared/protocol';
import { clamp, lerp } from '../utils/math';
import { damage, makeBot, placeBot, stepBot, trackIndex, type Bot, type BotWorld, type WallKind } from '../ai/driver';
import { makeField, type AiLevel } from '../ai/personality';
import { halfWidthOf, lapEstimate, speedProfile, type HalfWidthFn } from '../ai/racingLine';
import { tactics, trackGap, type Car } from '../ai/tactics';
import { chooseCompound, shouldPit } from '../ai/strategy';
import { botNames, buildLearned, disciplineOf, fetchLeaderGhost, playerRating, SkillTracker } from '../ai/racecraft';
import type { Learned } from '../ai/learn';
import { learnedProfile } from '../ai/learn';

export interface AiRacer extends Bot {
  name: string;
  color: number;
  model: VehicleModel;
  wheel: number;
}

const COMPOUNDS = ['soft', 'medium', 'hard'] as const;

export class AiRacers implements ContactOwner {
  readonly list: AiRacer[] = [];
  /** Every bot that started (Elimination removes knocked-out bots from `list`; the rating still counts them). */
  readonly field = new Map<string, AiRacer>();
  readonly level: AiLevel;
  readonly world: BotWorld;
  readonly skill: SkillTracker;
  learned: Learned;
  private cars: Car[] = [];
  private carOf = new Map<object, Car>();
  private acc = 0;
  private tacT = 0;
  private catchT = 0;
  private stratLap = new Map<string, number>();
  private justPitted = new Map<string, number>();
  private readonly hw: HalfWidthFn;
  private readonly L: number;
  private disposed = false;
  /** AI CPU time per frame (smoothed) and the worst frame, in ms. */
  cpuMs = 0;
  cpuMax = 0;

  constructor(private game: Game, private track: TrackLine, count: number, private f1: boolean, halfWidth: number, private laps: number, firstSlot: number) {
    const me = game.players[0]?.def, kindPool = VEHICLES.filter((v) => !v.f1 && v.kind === (me?.kind ?? 'car') && !v.ev?.thrusters);
    // same class as the player first (a muscle car races muscle cars), then the rest of its kind
    const pool = f1 ? VEHICLES.filter((v) => v.f1 && v.id === me?.id) : [...kindPool.filter((v) => v.cls === me?.cls), ...kindPool.filter((v) => v.cls !== me?.cls)];
    const fallback = VEHICLES.filter((v) => (f1 ? !!v.f1 : !v.f1));
    this.level = game.opts.aiLevel ?? 'adaptive';
    this.hw = halfWidthOf(track, halfWidth);
    this.L = track.n * track.spacing;
    const ref: VehicleDef = me && (f1 ? !!me.f1 : !me.f1) ? me : (pool[0] ?? fallback[0]);
    this.learned = buildLearned(game.opts.trackId, track, this.hw, ref);
    if (!f1 && pool.length > 1) {
      // close racing: the rides whose ideal lap on THIS track is nearest the player's (same machinery wins first)
      const lapOf = (d: VehicleDef) => lapEstimate(this.learned.line, d, speedProfile(this.learned.line, d)), mine = lapOf(ref);
      const ranked = pool.map((d) => ({ d, e: Math.abs(lapOf(d) / mine - 1) - (d.cls === ref.cls ? 0.01 : 0) })).sort((a, b) => a.e - b.e);
      pool.length = 0;
      pool.push(...ranked.slice(0, Math.max(3, Math.min(6, count))).map((r) => r.d));
    }
    this.world = this.makeWorld();
    this.skill = new SkillTracker(game);
    const profiles = makeField(count, this.level, playerRating(disciplineOf(game.opts)));
    const names = botNames(count, f1);
    const startTyre = (game.opts.tyre ?? 'medium') as TyreCompound;
    for (let i = 0; i < count; i++) {
      const def = (pool.length ? pool : fallback)[i % (pool.length || fallback.length)];
      const color = PLAYER_COLORS[(i + 2) % PLAYER_COLORS.length] ^ ((i * 0x1f3a5) & 0x1f1f1f);
      const model = buildVehicleModel(def.id, color);
      model.headlight.visible = false; // 19 extra spot lights would cost every phone a lot of fragment work
      const prof = profiles[i];
      // F1 grid: a strategic mix of starting compounds (the player's choice for some, others the alternatives)
      const compound: TyreCompound | null = f1 ? (i % 3 === 0 ? startTyre : COMPOUNDS[(COMPOUNDS.indexOf(startTyre) + (i % 3)) % 3]) : null;
      if (compound) model.tyreBands?.color.setHex(F1.tyres[compound].color);
      game.scene.add(model.root);
      const pose = game.layout.spawn(firstSlot + i);
      const vmax = learnedProfile(this.learned, def, 0.92 + 0.16 * prof.aggression);
      const b = makeBot('ai' + i, def, prof, vmax, pose.x, pose.z, pose.h, compound) as AiRacer;
      Object.assign(b, { name: names[i], color, model, wheel: 0 });
      if (b.f1) {
        b.f1.pitWear = AI.f1.pitWear + (prof.aggression - 0.5) * 0.12 + (Math.random() - 0.5) * 0.06;
        const n = track.n, p = this.world.pit;
        if (p) { const span = (p.i1 - p.i0 + n) % n; b.f1.box = (p.i0 + Math.round(span * (0.3 + (0.45 * i) / Math.max(1, count)))) % n; }
      }
      placeBot(b, this.world, pose.x, pose.z, pose.h);
      this.list.push(b);
      this.field.set(b.id, b);
    }
    // leaderboard #1 ghost: fetched lazily in the background; offline = skipped. Applied if it lands before the start.
    void fetchLeaderGhost(game.opts, ref).then((got) => {
      if (!got || this.disposed || game.race?.started) return;
      this.learned = buildLearned(game.opts.trackId, track, this.hw, ref);
      for (const b of this.list) b.vmax = learnedProfile(this.learned, b.def, 0.92 + 0.16 * b.prof.aggression);
      Object.assign(this.world, { line: this.learned.line });
    });
  }

  /** The bots' view of the game world. Collision call sites live here (swap in another contact model in one place). */
  private makeWorld(): BotWorld {
    const g = this.game, lay = g.layout as unknown as { inDrs?(i: number): boolean; runoff?(x: number, z: number): number; pit?: { i0: number; i1: number; side: 1 | -1 } };
    const ws = activeWeathers(g.opts);
    const w: BotWorld = {
      track: this.track, line: this.learned.line, hw: this.hw, envGrip: 1, wet: 0,
      onRoad: (x, z) => g.terrain.onRoad(x, z),
      roadDist: (x, z) => g.layout.roadDist(x, z),
      // collision call sites (world/collide.ts via ChunkManager): the same swept barrier test and contact normal as the player
      blocked: (x, z, r) => g.chunks.blocked(x, z, r, this.yAt, 1.3),
      sweep: (x0, z0, x1, z1, r) => g.chunks.sweep(x0, z0, x1, z1, r, this.yAt, 1.3),
      contact: (x, z, r, kind: WallKind, fx, fz) => g.chunks.contact(x, z, r, this.yAt, kind, fx, fz),
      surface: (x, z) => (lay.runoff ? lay.runoff(x, z) : g.terrain.onRoad(x, z) ? 0 : 1),
      inDrs: lay.inDrs ? (i) => lay.inDrs!(i) : undefined,
      pit: this.f1 && lay.pit ? lay.pit : null,
    };
    w.wet = Math.max(0, ...ws.map((x) => WEATHER_DEFS[x].rain));
    return w;
  }
  /** Ground height of the bot being stepped (for step-height checks against walls). */
  private yAt = 0;

  /** Move a racer to a grid slot (index for layout.spawn). */
  place(r: AiRacer, slot: number) {
    const pose = this.game.layout.spawn(slot);
    placeBot(r, this.world, pose.x, pose.z, pose.h);
    if (r.f1) {
      const p = this.world.pit, n = this.track.n;
      if (p) { const span = (p.i1 - p.i0 + n) % n; r.f1.box = (p.i0 + Math.round(span * (0.3 + 0.45 * ((slot * 0.37) % 1)))) % n; }
    }
    this.render(r, 0);
  }

  progress(r: AiRacer) {
    return r.s / this.L;
  }

  update(dt: number, started: boolean, raceTime: number) {
    const g = this.game, w = this.world;
    w.envGrip = g.env.grip;
    w.wet = clamp((1 - g.env.grip) / 0.12, 0, 1); // rain / snow show up as lower grip (dynamic weather follows it live)
    const t0 = performance.now();
    this.syncCars();
    // racecraft ~10 Hz
    this.tacT -= dt;
    if (this.tacT <= 0) {
      this.tacT = 0.1;
      for (const b of this.list) {
        const me = this.carOf.get(b)!;
        tactics(b, me, this.cars, w, 0.1);
        this.slip(b);
      }
      if (this.f1 && started) this.strategy();
    }
    if (started) this.catchUp(dt, raceTime);
    // fixed-step physics with distance LOD (far bots: half rate, same rules)
    this.acc = Math.min(this.acc + dt, 0.25); // never more than 15 steps a frame (no spiral of death on slow phones)
    const h = AI.step;
    while (this.acc >= h) {
      this.acc -= h;
      for (const b of this.list) {
        const far = this.farFromPlayers(b);
        if (far) { b.lodAcc += h; if (b.lodAcc < h * 2 - 1e-6) continue; }
        const step = far ? b.lodAcc : h;
        b.lodAcc = 0;
        this.yAt = b.y;
        stepBot(b, w, step, raceTime, started);
        this.pitStop(b, step);
        if (!b.finished && b.s >= this.laps * this.L) { b.finished = true; b.finishTime = raceTime; }
      }
    }
    for (const b of this.list) this.render(b, dt);
    if (started) this.skill.update(dt);
    const ms = performance.now() - t0;
    this.cpuMs += (ms - this.cpuMs) * 0.05; // smoothed AI cost per frame (debug / perf tests)
    this.cpuMax = Math.max(this.cpuMax, ms);
  }

  /** Common car list: bots and local players (reused objects). */
  private syncCars() {
    const g = this.game, out = this.cars;
    out.length = 0;
    for (const b of this.list) {
      let c = this.carOf.get(b);
      if (!c) this.carOf.set(b, (c = { id: b.id, s: 0, lat: 0, v: 0, x: 0, z: 0, h: 0, bot: b }));
      c.s = b.s; c.lat = b.lat; c.v = b.v; c.x = b.x; c.z = b.z; c.h = b.moveH;
      out.push(c);
    }
    for (const p of g.players) {
      let c = this.carOf.get(p);
      if (!c) this.carOf.set(p, (c = { id: String(p.index), s: 0, lat: 0, v: 0, x: 0, z: 0, h: 0, bot: null }));
      const t = this.track, i = t.nearest(p.B.x, p.B.z, true).i;
      c.lat = (p.B.x - t.px[i]) * t.tz[i] - (p.B.z - t.pz[i]) * t.tx[i];
      c.s = p.race.prog >= -1 ? p.race.prog * this.L : i * t.spacing;
      c.v = p.B.v; c.x = p.B.x; c.z = p.B.z; c.h = p.B.moveH;
      out.push(c);
    }
  }

  private farFromPlayers(b: Bot) {
    const d2 = AI.lodDist * AI.lodDist;
    for (const p of this.game.players) if ((p.B.x - b.x) ** 2 + (p.B.z - b.z) ** 2 < d2) return false;
    return this.game.players.length > 0;
  }

  /** F1 slipstream flag (same cone rule as the player's). */
  private slip(b: Bot) {
    if (!b.f1) return;
    const fx = Math.sin(b.moveH), fz = Math.cos(b.moveH);
    let on = false;
    if (Math.abs(b.v) > 25)
      for (const c of this.cars) {
        if (c.bot === b) continue;
        const dx = c.x - b.x, dz = c.z - b.z, d = Math.hypot(dx, dz);
        if (d > 3 && d < F1.slipDist && (dx * fx + dz * fz) / d > Math.cos(F1.slipAngle)) { on = true; break; }
      }
    b.f1.slip = on;
  }

  /**
   * Fair, subtle catch-up (Rookie, Amateur, Adaptive only; never Pro/Legend): each bot's pace eases by at most ±3 %
   * toward keeping the race close to the player. Pace is capped at the bot's physical limit (effectivePace ≤ 1) and
   * nothing ever moves a car: it only changes how hard it drives.
   */
  private catchUp(dt: number, raceTime: number) {
    const p = this.game.players[0], C = AI.catchUp;
    if (!p || raceTime < 5) return;
    this.catchT += dt;
    const ps = this.carOf.get(p)?.s ?? 0, avg = Math.max(15, Math.abs(p.B.v) || 30);
    for (const b of this.list) {
      if (!b.prof.catchUp || b.finished) { b.adj = 0; continue; }
      const gapS = (ps - b.s) / avg; // > 0: the bot is behind the player
      const want = clamp(gapS / C.gapFull, -1, 1) * C.max;
      b.adj += clamp(want - b.adj, -C.rate * dt, C.rate * dt);
    }
  }

  /** F1: decide on approach to the pit entry; the pit stop itself runs in pitStop(). */
  private strategy() {
    const w = this.world, p = w.pit, n = this.track.n;
    if (!p) return;
    for (const b of this.list) {
      const f = b.f1;
      if (!f || f.pit || b.finished) continue;
      const toEntry = (p.i0 - b.idx + n) % n, lap = Math.floor(b.s / this.L);
      if (toEntry * this.track.spacing > 900 || toEntry * this.track.spacing < 300 || this.stratLap.get(b.id) === lap) continue;
      this.stratLap.set(b.id, lap);
      const ahead = this.carAhead(b), behind = this.carBehind(b);
      const wet = w.wet > 0.5;
      const d = shouldPit({
        lap: lap + 1, laps: this.laps, lapLen: this.L, compound: f.compound, startCompound: f.startCompound, wear: f.wear, stops: f.stops, pitWear: f.pitWear,
        gapAhead: b.gapAhead, gapBehind: b.gapBehind, aheadPitted: !!ahead?.f1 && ahead.f1.stops > f.stops, behindJustPitted: !!behind && (this.justPitted.get(behind.id) ?? -9) >= lap - 0, wet,
      });
      if (d.pit) {
        f.pit = 1;
        f.next = chooseCompound({ lap: lap + 1, laps: this.laps, lapLen: this.L, startCompound: f.startCompound, compound: f.compound, wet });
      }
    }
  }
  private carAhead(b: Bot) { let best: Bot | null = null, bg = 1e9; for (const o of this.list) { if (o === b) continue; const gp = trackGap(b.s, o.s, this.L); if (gp > 0 && gp < bg) { bg = gp; best = o; } } return best; }
  private carBehind(b: Bot) { let best: Bot | null = null, bg = -1e9; for (const o of this.list) { if (o === b) continue; const gp = trackGap(b.s, o.s, this.L); if (gp < 0 && gp > bg) { bg = gp; best = o; } } return best; }

  /** Pit box: stop, tyres off/on, ERS full, then leave through the lane (limiter in driver.ts). */
  private pitStop(b: Bot, dt: number) {
    const f = b.f1, p = this.world.pit, n = this.track.n;
    if (!f || !p || !f.pit) return;
    if (f.pit === 1) {
      const toBox = (f.box - b.idx + n) % n;
      if ((toBox <= 1 || toBox > n - 3) && Math.abs(b.v) < 1.5 && this.inPitRange(b.idx)) { f.pit = 2; f.pitT = F1.pitStop + Math.random() * 0.8; b.v = 0; }
      else if (!this.inPitRange(b.idx) && (b.idx - p.i1 + n) % n < n / 2 && (b.idx - p.i1 + n) % n > 5) f.pit = 0; // missed the entry: next lap
    } else if (f.pit === 2) {
      b.v = 0;
      f.pitT -= dt;
      if (f.pitT <= 0) {
        f.compound = f.next;
        f.wear = 0;
        f.ers = 100;
        f.stops++;
        f.pit = 3;
        f.lastPitLap = Math.floor(b.s / this.L);
        this.justPitted.set(b.id, f.lastPitLap);
        (b as AiRacer).model.tyreBands?.color.setHex(F1.tyres[f.compound].color);
        b.damage = 0; // front wing / bodywork fixed in the stop
        f.wing = 0;
        b.hp = AI.hp;
      }
    } else if (f.pit === 3 && !this.inPitRange(b.idx)) f.pit = 0;
  }
  private inPitRange(i: number) {
    const p = this.world.pit!;
    return p.i0 <= p.i1 ? i >= p.i0 && i <= p.i1 : i >= p.i0 || i <= p.i1;
  }

  /** Contact pass (systems/Contacts.ts, every physics step): each bot as a capsule with its real velocity. */
  contactBodies(c: Contacts) {
    for (const b of this.list) c.add('ai', b, this, b.name, b.def, b.x, b.z, b.y, b.h, Math.sin(b.moveH) * b.v, Math.cos(b.moveH) * b.v);
  }

  /** Contact result for one bot: position correction (never into a barrier), velocity change, yaw kick, damage. */
  applyContact(ref: object, c: Body) {
    const b = ref as AiRacer, w = this.world, r = 1;
    this.yAt = b.y;
    if (c.px || c.pz) {
      if (!w.blocked(b.x + c.px, b.z + c.pz, r)) { b.x += c.px; b.z += c.pz; }
      else if (!w.blocked(b.x + c.px * 0.5, b.z + c.pz * 0.5, r)) { b.x += c.px * 0.5; b.z += c.pz * 0.5; }
    }
    if (c.dvx || c.dvz) {
      const o = toSpeedHeading(Math.sin(b.moveH) * b.v + c.dvx, Math.cos(b.moveH) * b.v + c.dvz, b.h, b.moveH, this._sh);
      b.v = o.v;
      b.moveH = o.moveH;
    }
    if (c.spin) { b.yawV += c.spin; b.h += c.spin * CONTACT.heading; }
    if (c.impact > CONTACT.damageMin && b.wallCd <= 0) { damage(b, (c.impact - CONTACT.damageMin) * CONTACT.damage); b.wallCd = CONTACT.cooldown; }
  }
  private readonly _sh = { v: 0, moveH: 0 };

  private render(b: AiRacer, dt: number) {
    const g = this.game, m = b.model;
    b.y = g.terrain.groundAt(b.x, b.z);
    b.wheel += (b.v * dt) / m.wheelRadius;
    m.wheels.forEach((wh) => (wh.rotation.x = b.wheel));
    m.steer.forEach((wh) => (wh.rotation.y = b.steer * 0.45));
    m.root.position.set(b.x, b.y, b.z);
    m.root.rotation.set(0, b.h, b.lean);
    m.brakeMat.emissiveIntensity = b.brk > 0.1 ? 2.6 : 0.6;
    if (m.rearFlap) m.rearFlap.rotation.x = lerp(m.rearFlap.rotation.x, b.f1?.aeroOpen ? 0.5 : 0, Math.min(1, dt * 10));
    if (m.frontFlap) m.frontFlap.rotation.x = lerp(m.frontFlap.rotation.x, b.f1?.aeroOpen ? 0.25 : 0, Math.min(1, dt * 10));
  }

  /** Standings extras: personality icon, F1 tyre and pit state. */
  badge(r: AiRacer) {
    const f = r.f1;
    return { icon: r.prof.arch.icon, persona: r.prof.arch.name, level: r.prof.level, tyre: f ? f.compound : undefined, pit: !!f && f.pit > 0 && this.inPitRange(r.idx), stops: f?.stops ?? 0 };
  }

  /** Metres along the line for any world point (used for blocking/overtakes). */
  trackPos(x: number, z: number) {
    return this.track.nearest(x, z, true).i * this.track.spacing;
  }

  /** Is any racer just ahead of (x,z) facing h within the slipstream cone? */
  slipstreamFor(x: number, z: number, h: number) {
    const fx = Math.sin(h), fz = Math.cos(h);
    for (const r of this.list) {
      const dx = r.x - x, dz = r.z - z, d = Math.hypot(dx, dz);
      if (d > 3 && d < F1.slipDist && (dx * fx + dz * fz) / d > Math.cos(F1.slipAngle)) return true;
    }
    return false;
  }

  /** Off the road distance for HUD / tests. */
  offTrack(b: Bot) {
    return this.game.layout.roadDist(b.x, b.z) - ROAD.asphalt;
  }

  /** Re-sync after a bot was moved by someone else (tests, debug). */
  resync(b: Bot) {
    trackIndex(b, this.world);
  }

  dispose() {
    this.disposed = true;
    for (const r of this.list) this.game.scene.remove(r.model.root);
  }
}

// One local rider: bike physics, walking, tricks, health/XP, camera and HUD.
// Everything per-player lives here, so split screen and online need no special cases.
import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Controller } from '../core/Input';
import type { Engine } from '../core/Audio';
import type { Entity } from './EntityManager';
import type { Pose } from '../world/layout';
import type { NetState } from '../../shared/protocol';
import { ASSIST, BIKE, LEVELING, CONTROL, LANDING, PHYS, PLAYER, POWERUPS, ROAD, type PowerupKind } from '../config';
import { clamp, damp, lerp, rnd, TAU, wrapPi } from '../utils/math';
import { buildBike, buildRider, seatRider, type BikeModel, type RiderModel } from './models';
import { WEAPONS } from '../data/weapons';
import { MILESTONES, TIERS, UPGRADES, type Card } from '../data/upgrades';
import { Hud } from '../ui/Hud';
import { PlayerChallenges } from '../systems/Challenges';
import { STORY } from '../data/story';
import { prefs } from '../core/prefs';

type Style = 'NO-HANDER' | 'SUPERMAN' | 'HEEL CLICKER';

/** Power-curve XP requirement: quick early levels, slower later. */
const xpNeed = (level: number) => Math.round(LEVELING.base * Math.pow(level, LEVELING.exp));

export class Player {
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.3, 900);
  readonly bike: BikeModel;
  readonly rider: RiderModel;
  readonly hud: Hud;
  readonly challenges: PlayerChallenges | null;

  readonly B = {
    x: 0, z: 0, y: 0, h: 0, moveH: 0, v: 0, vy: 0, lean: 0, pitch: 0, pitchV: 0, steer: 0,
    air: false, airT: 0, lastG: 0, wheel: 0, flipAcc: 0, spinAcc: 0, pad: 0, wasN: false, impact: 0, fromRamp: false,
    latch: { up: false, down: false, left: false, right: false },
  };
  readonly W = { x: 0, z: 0, y: 0, h: 0, vy: 0, ground: true, phase: 0, amt: 0 };
  readonly stats = {
    top: BIKE.top, accel: BIKE.accel, nitroMax: BIKE.nitroMax, nitroRegen: BIKE.nitroRegen, grip: BIKE.grip,
    hpMax: PLAYER.hpMax, fire: 1, dmg: 1, magnet: PLAYER.magnet, xpMul: 1, armor: 0, crashArmor: 0, trickMul: 1,
  };
  readonly s = {
    hp: PLAYER.hpMax, nitro: BIKE.nitroMax, xp: 0, level: 1, score: 0, gems: 0, dist: 0, weapon: 0, fireCd: 0,
    lastHurt: -9, combo: 0, comboT: 0, bestCombo: 0, pendingLevels: 0, dead: false, kills: 0,
  };
  readonly buffs: Record<PowerupKind, number> = { heal: 0, shield: 0, magnet: 0, xp2: 0 };
  readonly cam = { yaw: 0, shake: 0, fovKick: 0, boost: 0, pos: new THREE.Vector3(), look: new THREE.Vector3() };
  readonly race = { lap: 0, nextCp: 0, lapStart: 0, lastLap: 0, best: 0, finished: false, finishTime: 0, prog: -1, place: 1 };
  /** Position used by everything else: bike when riding, rider when walking. */
  readonly P = { x: 0, y: 0, z: 0, h: 0, v: 0 };

  riding = false;
  controlsLocked = false;
  aimTarget: Entity | null = null;
  cards: Card[] = [];
  /** Cards on screen (false = folded into the "upgrade ready" badge). */
  cardsOpen = false;
  private cardT = 0;
  private rerolls = LEVELING.rerolls;
  private sinceRare = 0;
  readonly stacks: Record<string, number> = {};
  private flame = 0x66ccff;
  private respawnT = 0;
  private engine: Engine | null = null;
  private _v = new THREE.Vector3();
  private nitroOn = false;
  private style: Style | null = null;
  private styleT = 0;
  private styleDone: Style[] = [];

  constructor(readonly game: Game, readonly index: number, readonly ctrl: Controller, readonly name: string, readonly color: number, spawn: Pose, mounted: boolean) {
    this.bike = buildBike(color);
    this.rider = buildRider(color);
    game.scene.add(this.bike.root, this.rider.root);
    this.hud = new Hud(game, this);
    this.challenges = game.opts.mode === 'open' ? new PlayerChallenges(this) : null;
    const B = this.B, W = this.W;
    Object.assign(B, { x: spawn.x, z: spawn.z, h: spawn.h, moveH: spawn.h });
    B.y = B.lastG = game.terrain.groundAt(B.x, B.z);
    Object.assign(W, { x: spawn.x + Math.cos(spawn.h) * 2.5, z: spawn.z - Math.sin(spawn.h) * 2.5, h: spawn.h });
    W.y = game.terrain.groundAt(W.x, W.z);
    if (mounted) this.mount();
    this.syncP();
    this.cam.pos.set(B.x - Math.sin(B.h) * 12, B.y + 7, B.z - Math.cos(B.h) * 12);
    this.cam.look.set(B.x, B.y, B.z);
    this.camera.position.copy(this.cam.pos);
  }

  // ---------------------------------------------------------------- per frame (input edges)
  handleInput() {
    const c = this.ctrl, s = this.s;
    if (this.cards.length) {
      if (c.hit('upgrade')) this.setCardsOpen(!this.cardsOpen);
      if (this.cardsOpen) {
        (['pick1', 'pick2', 'pick3'] as const).forEach((a, i) => c.hit(a) && this.pickCard(i));
        if (c.hit('reroll')) this.reroll();
      }
    }
    if (this.game.paused) return;
    if (this.controlsLocked) return;
    if (c.hit('ride')) this.toggleRide();
    if (c.hit('respawn')) this.respawn();
    if (c.hit('weapon')) {
      let w = s.weapon;
      do w = (w + 1) % WEAPONS.length; while (WEAPONS[w].unlock > s.level);
      this.setWeapon(w);
    }
    this.cam.yaw += c.lookDelta;
    c.lookDelta = 0;
  }

  setWeapon(i: number) {
    this.s.weapon = i;
    this.game.audio.play('weapon', i);
  }

  // ---------------------------------------------------------------- per physics step
  update(dt: number) {
    const s = this.s, g = this.game;
    if (s.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        s.dead = false;
        s.hp = this.stats.hpMax;
        this.respawn();
      }
    }
    this.updateBike(dt);
    if (!this.riding) this.updateWalker(dt);
    this.syncP();
    this.aimTarget = g.entities.findTarget(this.P.x, this.P.z, this.P.h);
    s.fireCd -= dt;
    if (this.ctrl.is('fire') && s.fireCd <= 0 && !s.dead && !this.controlsLocked) g.combat.fire(this);
    if (g.time - s.lastHurt > PLAYER.regenDelay && !s.dead) s.hp = Math.min(this.stats.hpMax, s.hp + PLAYER.regenRate * dt);
    if (s.comboT > 0) { s.comboT -= dt; if (s.comboT <= 0) s.combo = 0; }
    for (const k of Object.keys(this.buffs) as PowerupKind[]) if (this.buffs[k] > 0) this.buffs[k] = Math.max(0, this.buffs[k] - dt);
  }

  private syncP() {
    const P = this.P;
    if (this.riding) Object.assign(P, { x: this.B.x, y: this.B.y, z: this.B.z, h: this.B.moveH, v: this.B.v });
    else Object.assign(P, { x: this.W.x, y: this.W.y, z: this.W.z, h: this.W.h, v: 0 });
  }

  private updateBike(dt: number) {
    const B = this.B, st = this.stats, s = this.s, g = this.game, c = this.ctrl, T = g.terrain;
    const onRoad = T.onRoad(B.x, B.z);
    const active = this.riding && !s.dead && !this.controlsLocked;
    const up = active && c.is('up'), down = active && c.is('down'), left = active && c.is('left'), right = active && c.is('right');
    let boosting = false;
    if (this.riding && !s.dead) {
      if (prefs.nitroToggle && active && c.hit('nitro')) this.nitroOn = !this.nitroOn;
      if (s.nitro <= 1) this.nitroOn = false;
      const wantN = active && (prefs.nitroToggle ? this.nitroOn : c.is('nitro')) && s.nitro > 1;
      if (wantN) {
        if (!B.wasN) { g.audio.play('nitro'); this.cam.shake = Math.max(this.cam.shake, 0.25); this.cam.fovKick = 8; }
        s.nitro -= BIKE.nitroBurn * dt;
        boosting = true;
      }
      B.wasN = wantN;
      if (B.pad > 0) boosting = true;
      const top = st.top * (boosting ? BIKE.nitroTopMul : 1) * (onRoad ? 1 : BIKE.offroadTop);
      if (!B.air) {
        if (up) B.v += (B.v < 0 ? 40 : st.accel * (boosting ? BIKE.nitroAccelMul : 1)) * dt;
        else if (boosting) B.v += st.accel * BIKE.nitroAccelMul * dt; // nitro drives by itself: Space + ←/→ is enough
        if (down) B.v -= (B.v > 0 ? BIKE.brake : BIKE.reverse) * dt;
        if (!up && !down && !boosting) B.v *= 1 - BIKE.coastDrag * dt;
        if (!onRoad) B.v *= 1 - BIKE.offroadDrag * dt;
        if (g.env.grip < 1 && Math.abs(B.steer) > 0.6 && Math.abs(B.v) > 20) B.v *= 1 - (1 - g.env.grip) * dt; // wet roads scrub speed in corners
        if (B.v > top) B.v -= Math.min(B.v - top, 30 * dt);
        B.v = Math.max(B.v, -BIKE.maxReverse);
        // steering eases in and re-centres smoothly instead of snapping
        const want = (left ? 1 : 0) - (right ? 1 : 0);
        B.steer = lerp(B.steer, want, damp(dt, want ? CONTROL.steerIn : CONTROL.steerOut));
        // full steering at any speed (it used to fade out at nitro speed), a little extra while boosting
        B.h += B.steer * st.grip * g.env.grip * clamp(Math.abs(B.v) / 6, 0, 1) * Math.sign(B.v) * dt * (boosting ? CONTROL.boostSteer : 1);
        this.assistSteer(dt, want);
        B.moveH = B.h;
        B.lean = lerp(B.lean, -B.steer * clamp(Math.abs(B.v) / 22, 0, 1) * 0.55, damp(dt, 6));
        // keys held while leaving the ground must be released before they do tricks
        B.latch.up = up; B.latch.down = down; B.latch.left = left; B.latch.right = right;
      } else {
        const L = B.latch;
        if (!up) L.up = false;
        if (!down) L.down = false;
        if (!left) L.left = false;
        if (!right) L.right = false;
        const trick = active && c.is('trick') && B.airT > 0.15;
        if (trick) {
          // C in the air: ↑ = Superman, ↓ = Heel Clicker, nothing = No-Hander (↑↓ pick the pose instead of flipping)
          const want: Style = up ? 'SUPERMAN' : down ? 'HEEL CLICKER' : 'NO-HANDER';
          if (want !== this.style) { this.style = want; this.styleT = 0; }
          this.styleT += dt;
          if (this.styleT > 0.35 && !this.styleDone.includes(want)) this.styleDone.push(want);
        } else this.style = null;
        this.poseStyle();
        const pitchIn = trick ? 0 : (up && !L.up ? 1 : 0) - (down && !L.down ? 1 : 0);
        const spinIn = (left && !L.left ? 1 : 0) - (right && !L.right ? 1 : 0);
        B.pitchV += pitchIn * BIKE.flipAccel * dt;
        B.pitchV *= 1 - 1.8 * dt;
        const dp = B.pitchV * dt;
        B.pitch += dp;
        B.flipAcc += dp;
        // auto-level: with no input the bike settles nose-level and facing its travel direction
        if (!pitchIn && Math.abs(B.pitchV) < 2) {
          const lv = clamp(-B.vy * 0.025, -0.45, 0.35), cur = wrapPi(B.pitch);
          B.pitch += (lv - cur) * Math.min(1, dt * CONTROL.airAssist);
          B.pitchV *= 1 - Math.min(1, dt * 3);
        }
        // small hops and the start of a jump: ←/→ keeps steering the bike's direction (air control)
        const airSteer = !B.fromRamp || B.airT < CONTROL.airSteerTime;
        if (airSteer) {
          const want = (left ? 1 : 0) - (right ? 1 : 0);
          B.steer = lerp(B.steer, want, damp(dt, want ? CONTROL.steerIn : CONTROL.steerOut));
          const turn = B.steer * st.grip * CONTROL.airSteer * (boosting ? CONTROL.boostSteer : 1) * dt * Math.sign(B.v || 1);
          B.h += turn;
          B.moveH += turn;
          L.left = left;
          L.right = right; // holding a direction through the hop won't start a spin
        } else {
          const ds = spinIn * BIKE.spinRate * dt;
          B.h += ds;
          B.spinAcc += ds;
          B.steer = 0;
        }
        if (!spinIn || airSteer) B.h -= wrapPi(B.h - B.moveH) * Math.min(1, dt * CONTROL.yawAssist);
        B.lean = lerp(B.lean, airSteer ? -B.steer * 0.3 : 0, damp(dt, 3));
        if (boosting) B.v += 8 * dt;
      }
    } else {
      B.v *= 1 - 3 * dt;
      B.lean = lerp(B.lean, 0.22, damp(dt, 4));
      B.wasN = false;
    }
    s.nitro = clamp(s.nitro + st.nitroRegen * dt, 0, st.nitroMax);
    if (Math.abs(B.v) < 0.03) B.v = 0;
    B.pad = Math.max(0, B.pad - dt);
    this.cam.boost = lerp(this.cam.boost, boosting && this.riding ? 1 : 0, damp(dt, 6));

    // horizontal move + collisions
    const nx = B.x + Math.sin(B.moveH) * B.v * dt, nz = B.z + Math.cos(B.moveH) * B.v * dt;
    if (B.v !== 0) {
      const blk = g.chunks.blocked(nx, nz, 1, B.y, B.air ? 99 : 1.3);
      let glanced = false;
      if (blk === 'tree' || blk === 'wall') {
        // try sliding past at a small angle before treating it as a head-on hit
        const A = ASSIST[prefs.assist] ?? ASSIST[1];
        for (const turn of [0.35, -0.35, 0.7, -0.7]) {
          const h2 = B.moveH + turn, sx = B.x + Math.sin(h2) * B.v * dt, sz = B.z + Math.cos(h2) * B.v * dt;
          if (!g.chunks.blocked(sx, sz, 1, B.y, B.air ? 99 : 1.3)) {
            B.h += turn * 0.5;
            B.moveH = B.h;
            B.v *= A.glance;
            B.x = sx;
            B.z = sz;
            this.cam.shake = Math.max(this.cam.shake, 0.15);
            glanced = true;
            break;
          }
        }
        if (glanced) {
          g.audio.play('thud');
          g.fx.burst(B.x, B.y + 0.6, B.z, { n: 8, speed: 4, life: 0.5, size: [0.8, 1.6], colors: [0x9a8a70], gravity: -1, drag: 2, smoke: true, alpha: 0.5 });
        }
      }
      if (glanced) {
        // slid past the obstacle, position already updated
      } else if (blk) {
        if (Math.abs(B.v) > LANDING.wallDamageSpeed) {
          this.cam.shake = 0.5;
          g.audio.play('crash');
          this.hurt(Math.abs(B.v) * 0.3 * (1 - st.crashArmor) * (ASSIST[prefs.assist] ?? ASSIST[1]).crash, undefined, true);
          g.fx.burst(nx, B.y + 1, nz, { n: 20, speed: 6, life: 0.8, size: [1, 3], colors: [0x9a8a70], gravity: -1, drag: 2, smoke: true, alpha: 0.6 });
        }
        B.v *= -0.25;
      } else {
        const e = g.entities.hitTest(nx, B.y, nz, 0.9);
        if (e) {
          if (e.type === 'cone') { g.entities.destroy(e, this); B.v *= 0.97; }
          else if (e.type === 'barrel') g.entities.destroy(e, this);
          else if (e.type === 'crate') {
            if (Math.abs(B.v) > 16) { g.entities.destroy(e, this); B.v *= 0.8; this.cam.shake = Math.max(this.cam.shake, 0.2); }
            else { B.v *= -0.3; g.audio.play('thud'); }
          }
        } else {
          if (this.riding) {
            const d = Math.abs(B.v) * dt;
            s.dist += d;
            g.events.emit('progress', { player: this, id: 'dist', value: d });
          }
          B.x = nx;
          B.z = nz;
        }
      }
    }
    // vertical
    const gy = T.groundAt(B.x, B.z);
    B.vy -= PHYS.gravity * dt;
    B.y += B.vy * dt;
    if (B.y <= gy) {
      const wasAir = B.air, impactVy = B.vy;
      B.y = gy;
      B.vy = clamp((gy - B.lastG) / dt, -40, B.fromRamp || T.onRamp(B.x, B.z) ? 22 : (ASSIST[prefs.assist] ?? ASSIST[1]).crest);
      B.air = false;
      if (wasAir) { B.impact = -impactVy; this.land(); }
    } else if (!B.air && B.y - gy > (T.onRamp(B.x, B.z) ? 0.3 : CONTROL.airborneGap)) {
      B.air = true;
      B.airT = 0;
      B.flipAcc = B.spinAcc = 0;
      B.pitchV = 0;
      this.styleDone = [];
      B.fromRamp = T.onRamp(B.x, B.z);
      if (B.fromRamp && this.riding) g.events.emit('progress', { player: this, id: 'ramp', value: 1 });
    }
    if (B.air) B.airT += dt;
    B.lastG = gy;
    if (!B.air) B.pitch = lerp(wrapPi(B.pitch), this.slopePitch(), damp(dt, 12));
    B.wheel += (B.v * dt) / 0.62;
    this.bike.wheels.forEach((w) => (w.rotation.x = B.wheel));
    this.bike.root.position.set(B.x, B.y, B.z);
    this.bike.root.rotation.set(B.pitch, B.h, B.lean);

    // boost pads
    for (const pd of T.pads) {
      if (pd.cd > 0 || Math.hypot(pd.x - B.x, pd.z - B.z) > 3.6 || Math.abs(B.y - pd.y) > 1.5) continue;
      pd.cd = 1.2;
      B.pad = BIKE.padTime;
      B.v = Math.max(B.v, st.top * BIKE.padTopMul);
      g.audio.play('pad');
      this.cam.fovKick = 12;
      this.cam.shake = Math.max(this.cam.shake, 0.3);
      this.hud.banner('BOOST PAD!', '', '#3cc8ff');
      g.events.emit('progress', { player: this, id: 'pad', value: 1 });
      g.fx.burst(pd.x, pd.y + 0.5, pd.z, { n: 40, speed: 10, life: 0.8, size: [0.7, 0.1], colors: [0x3cc8ff, 0xffffff], drag: 2 });
    }
    // exhaust flame, dust, tyre smoke
    const fx = Math.sin(B.h), fz = Math.cos(B.h), boost = this.cam.boost;
    this.bike.flame.scale.set(1, lerp(this.bike.flame.scale.y, boost > 0.1 ? 1.4 + Math.random() * 1.2 : 0.01, 0.5), 1);
    if (B.pad > 0) this.bike.flameMat.color.setHex(0xff66ff);
    else if (this.flame < 0) this.bike.flameMat.color.setHSL((g.time * 0.6) % 1, 1, 0.6);
    else this.bike.flameMat.color.setHex(this.flame);
    this.bike.headlight.intensity = g.env.night * 2.4;
    if (boost > 0.1) {
      const ex = B.x - fx * 1.7 + Math.cos(B.h) * 0.33, ez = B.z - fz * 1.7 - Math.sin(B.h) * 0.33;
      for (const col of [0x66ccff, 0x8a7dff, 0xffffff]) g.fx.emit(ex, B.y + 0.65, ez, -fx * 10 + rnd(2), rnd(1.5) + 1, -fz * 10 + rnd(2), 0.35, 0.9, 0.1, col, 1, 0, 2);
    }
    if (this.riding && !B.air && Math.abs(B.v) > 8 && !onRoad && Math.random() < 0.8)
      g.fx.emit(B.x - fx * 1.1 + rnd(0.3), B.y + 0.2, B.z - fz * 1.1 + rnd(0.3), -fx * 2 + rnd(1), 1.5, -fz * 2 + rnd(1), 1.1, 0.8, 2.6, T.biome(B.x, B.z) < 0.4 ? 0xd9b47a : 0x8a7a5a, 0.55, -0.5, 1.5, true);
    // tyre marks when braking hard or leaning hard
    if (this.riding && !B.air && ((down && B.v > 12) || (Math.abs(B.lean) > 0.3 && Math.abs(B.v) > 18)))
      g.effects.skid(B.x - fx * 1.05, B.z - fz * 1.05, B.h);
    if (this.riding && !B.air && Math.abs(B.lean) > 0.35 && Math.abs(B.v) > 20 && onRoad)
      g.fx.emit(B.x - fx * 1.1, B.y + 0.15, B.z - fz * 1.1, rnd(1), 1, rnd(1), 0.9, 0.6, 2.2, 0xdddddd, 0.35, -0.4, 1.5, true);
  }

  private slopePitch() {
    const B = this.B, T = this.game.terrain, fx = Math.sin(B.moveH), fz = Math.cos(B.moveH);
    return -Math.atan2(T.groundAt(B.x + fx * 1.05, B.z + fz * 1.05) - T.groundAt(B.x - fx * 1.05, B.z - fz * 1.05), 2.1);
  }

  private land() {
    const B = this.B, g = this.game, air = B.airT, slope = this.slopePitch();
    const pErr = wrapPi(B.pitch - slope), yawErr = wrapPi(B.h - B.moveH);
    const posing = this.style !== null;
    this.style = null;
    this.poseStyle();
    if (this.riding && posing && air > LANDING.minAir) {
      this.crash('Bail! Let go of the trick key before landing');
    } else if (this.riding && air > LANDING.minAir && (Math.abs(pErr) > LANDING.maxPitchErr * this.assist.landing || Math.abs(yawErr) > LANDING.maxYawErr * this.assist.landing)) {
      this.crash(Math.abs(pErr) > LANDING.maxPitchErr * this.assist.landing ? 'Land your flips straight!' : 'Land facing forward!');
    } else if (this.riding) {
      const flips = Math.round(Math.abs(B.flipAcc) / TAU), spins = Math.round(Math.abs(B.spinAcc) / TAU), tricks: string[] = [];
      let pts = 0;
      if (flips > 0) {
        tricks.push((B.flipAcc < 0 ? 'BACKFLIP' : 'FRONTFLIP') + (flips > 1 ? ' x' + flips : ''));
        pts += 250 * flips;
        g.events.emit('progress', { player: this, id: 'flip', value: flips });
      }
      if (spins > 0) {
        tricks.push(spins * 360 + ' SPIN');
        pts += 180 * spins;
        g.events.emit('progress', { player: this, id: 'spin', value: spins });
      }
      for (const st of this.styleDone) {
        tricks.push(st);
        pts += st === 'NO-HANDER' ? 150 : 220;
      }
      if (this.styleDone.length) g.events.emit('progress', { player: this, id: 'style', value: this.styleDone.length });
      if (flips > 0 && spins > 0) { tricks.push('CORKSCREW'); pts += 200; }
      if (air > 0.9) { tricks.push('BIG AIR ' + air.toFixed(1) + 's'); pts += Math.round(air * 80); }
      if (Math.abs(pErr) < 0.15 && tricks.length) { tricks.push('PERFECT'); pts += 100; }
      g.events.emit('progress', { player: this, id: 'air', value: air });
      if (tricks.length) {
        const s = this.s;
        s.combo = s.comboT > 0 ? s.combo + 1 : 1;
        s.comboT = PLAYER.comboWindow;
        s.bestCombo = Math.max(s.bestCombo, s.combo);
        g.events.emit('progress', { player: this, id: 'combo', value: s.combo });
        pts = Math.round(pts * s.combo * this.stats.trickMul);
        g.audio.play('trick');
        this.hud.banner(tricks.join(' + '), `+${Math.round(pts * this.stats.xpMul * (this.buffs.xp2 > 0 ? 2 : 1))} XP${s.combo > 1 ? ` · COMBO x${s.combo}` : ''}`, flips ? '#ff7ad9' : '#ffd23f');
        this.addXP(pts);
        s.nitro = Math.min(this.stats.nitroMax, s.nitro + 20 * tricks.length * this.stats.trickMul);
        g.fx.burst(B.x, B.y + 1, B.z, { n: 50, speed: 14, life: 1, size: [0.6, 0.1], colors: [0xffd23f, 0xff7ad9, 0xffffff], gravity: 6 });
      }
      B.moveH = B.h;
    }
    B.pitch = slope;
    B.pitchV = 0;
    B.flipAcc = B.spinAcc = 0;
    B.airT = 0;
    if (B.impact > 8) {
      this.cam.shake = Math.max(this.cam.shake, clamp(B.impact * 0.025, 0, 0.6));
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        g.fx.emit(B.x, B.y + 0.2, B.z, Math.cos(a) * 7, 1, Math.sin(a) * 7, 1, 1, 3.5, 0xb8a98c, 0.6, 0, 2.5, true);
      }
      g.audio.play('thud');
    }
  }

  private get assist() {
    return ASSIST[prefs.assist] ?? ASSIST[1];
  }

  /**
   * Riding assist: with no steering input the bike follows the road's curve, and near the edge it is
   * nudged back towards the asphalt. Never acts against an active steer.
   */
  private assistSteer(dt: number, steerInput: number) {
    const A = this.assist, B = this.B;
    if ((!A.follow && !A.edge) || Math.abs(B.v) < 8) return;
    const T = this.game.terrain, rd = T.layout.roadDist(B.x, B.z);
    if (rd > ROAD.shoulder + 4) return; // off-road: you're on your own
    const road = T.layout.nearestRoad(B.x, B.z);
    // the road runs both ways: follow the direction closest to where we're heading
    let target = road.h;
    if (Math.abs(wrapPi(target - B.h)) > Math.PI / 2) target += Math.PI;
    const err = wrapPi(target - B.h);
    if (!steerInput && Math.abs(err) < 0.6) B.h += err * Math.min(1, dt * A.follow);
    // edge guard: heading outward near the edge -> steer back toward the centre line
    if (rd > ROAD.asphalt - 1.5 && A.edge) {
      const toCx = road.x - B.x, toCz = road.z - B.z, toward = Math.atan2(toCx, toCz);
      const out = wrapPi(toward - B.h);
      if (Math.abs(out) > 0.2 && steerInput * out <= 0) B.h += clamp(out, -0.5, 0.5) * Math.min(1, dt * A.edge) * clamp((rd - ROAD.asphalt + 1.5) / 3, 0, 1);
    }
  }

  /** Rider pose for style tricks (applied on top of the seated pose). */
  private poseStyle() {
    const r = this.rider, st = this.style;
    if (!this.riding) return;
    if (st === 'SUPERMAN') {
      r.legL.rotation.set(0.3, 0, 0.25); r.legR.rotation.set(0.3, 0, -0.25);
      r.torso.rotation.x = 0.9; r.armL.rotation.set(-1.4, 0, -0.1); r.armR.rotation.set(-1.4, 0, 0.1);
    } else if (st === 'HEEL CLICKER') {
      r.legL.rotation.set(-1.9, 0, -0.5); r.legR.rotation.set(-1.9, 0, 0.5);
      r.torso.rotation.x = -0.1; r.armL.rotation.set(-1.15, 0, -0.15); r.armR.rotation.set(-1.15, 0, 0.15);
    } else if (st === 'NO-HANDER') {
      r.armL.rotation.set(0, 0, -2.4); r.armR.rotation.set(0, 0, 2.4);
      r.torso.rotation.x = 0.05; r.legL.rotation.set(-1.35, 0, 0.12); r.legR.rotation.set(-1.35, 0, -0.12);
    } else {
      r.legL.rotation.set(-1.35, 0, 0.12); r.legR.rotation.set(-1.35, 0, -0.12);
      r.armL.rotation.set(-1.15, 0, -0.15); r.armR.rotation.set(-1.15, 0, 0.15);
      r.torso.rotation.x = 0.25;
    }
  }

  /** True while nitro is switched on in toggle mode (HUD). */
  get nitroLatched() {
    return prefs.nitroToggle && this.nitroOn;
  }

  private crash(reason: string) {
    const B = this.B, g = this.game;
    this.hud.banner('CRASH!', reason, '#ff4d5e');
    g.audio.play('crash');
    this.cam.shake = 0.9;
    this.hud.flash('#ff3040', 0.25);
    B.v *= 0.3; // keep some momentum so a crash isn't a full stop
    B.h = B.moveH;
    this.s.combo = 0;
    this.hurt(LANDING.crashDamage * (1 - this.stats.crashArmor) * this.assist.crash, undefined, true);
    g.fx.burst(B.x, B.y + 0.5, B.z, { n: 30, speed: 6, life: 1.4, size: [1.5, 4], colors: [0x9a8a70, 0x7a6a55], gravity: -1, drag: 1.5, smoke: true, alpha: 0.7 });
  }

  private updateWalker(dt: number) {
    const W = this.W, B = this.B, c = this.ctrl, g = this.game, r = this.rider, s = this.s;
    const active = !s.dead && !this.controlsLocked;
    r.torso.rotation.x = 0;
    r.legL.rotation.z = r.legR.rotation.z = r.armL.rotation.z = r.armR.rotation.z = 0;
    const turn = active ? (c.is('left') ? 1 : 0) - (c.is('right') ? 1 : 0) : 0;
    W.h += turn * 2.7 * dt;
    const f = active ? (c.is('up') ? 1 : 0) - (c.is('down') ? 1 : 0) : 0;
    const spd = f * (c.is('nitro') && !c.is('jump') ? PHYS.runSpeed : PHYS.walkSpeed) * (f < 0 ? 0.55 : 1);
    const nx = W.x + Math.sin(W.h) * spd * dt, nz = W.z + Math.cos(W.h) * spd * dt;
    if (spd !== 0 && !g.chunks.blocked(nx, nz, 0.45, W.y, 0.9) && !g.entities.hitTest(nx, W.y, nz, 0.4) && !(Math.hypot(nx - B.x, nz - B.z) < 1.3 && W.y < B.y + 1.5)) {
      W.x = nx;
      W.z = nz;
    }
    if (active && c.hit('jump') && W.ground) { W.vy = PHYS.jump; W.ground = false; g.audio.play('jump'); }
    const gy = g.terrain.groundAt(W.x, W.z);
    W.vy -= PHYS.walkGravity * dt;
    W.y += W.vy * dt;
    if (W.y <= gy || (W.ground && W.y - gy < 0.6 && W.vy <= 0)) { W.y = gy; W.vy = 0; W.ground = true; } else W.ground = false;
    W.amt = lerp(W.amt, spd !== 0 && W.ground ? 1 : 0, damp(dt, 10));
    W.phase += dt * Math.abs(spd) * 1.5;
    const sw = Math.sin(W.phase) * 0.9 * W.amt;
    r.legL.rotation.x = W.ground ? sw : -0.5;
    r.legR.rotation.x = W.ground ? -sw : 0.3;
    r.armL.rotation.x = -sw * 0.8;
    r.armR.rotation.x = c.is('fire') || this.aimTarget ? -1.45 : sw * 0.8;
    r.root.position.set(W.x, W.y + Math.abs(Math.cos(W.phase)) * 0.08 * W.amt, W.z);
    r.root.rotation.set(0, W.h, 0);
  }

  // ---------------------------------------------------------------- riding
  private mount() {
    this.riding = true;
    seatRider(this.rider, this.bike);
  }

  private toggleRide() {
    const W = this.W, B = this.B, g = this.game;
    if (!this.riding && Math.hypot(W.x - B.x, W.z - B.z) < BIKE.mountDist) {
      this.mount();
      g.audio.play('mount');
    } else if (this.riding) {
      for (const side of [1, -1]) {
        const rx = Math.cos(B.moveH) * side, rz = -Math.sin(B.moveH) * side, nx = B.x - rx * 2, nz = B.z - rz * 2;
        if (!g.chunks.blocked(nx, nz, 0.5, B.y, 1.5) || side === -1) {
          this.riding = false;
          g.scene.add(this.rider.root);
          Object.assign(W, { x: nx, z: nz, y: Math.max(g.terrain.groundAt(nx, nz), B.y), h: B.moveH, vy: 0 });
          this.rider.helmet.visible = false;
          this.rider.hair.visible = true;
          break;
        }
      }
    }
  }

  respawn() {
    const r = this.game.layout.nearestRoad(this.P.x, this.P.z), B = this.B;
    Object.assign(B, { x: r.x, z: r.z, h: r.h, moveH: r.h, v: 0, vy: 0, pitch: 0, pitchV: 0, flipAcc: 0, spinAcc: 0, airT: 0, air: false, steer: 0 });
    B.y = B.lastG = this.game.terrain.groundAt(B.x, B.z);
    if (!this.riding) this.mount();
    this.syncP();
  }

  private inFuel = false;
  /** Gas stations refill nitro and repair while you're parked under the canopy. */
  checkZones(zones: { x: number; z: number; r: number }[], dt: number) {
    const P = this.P;
    const inside = zones.some((z) => (P.x - z.x) ** 2 + (P.z - z.z) ** 2 < z.r * z.r);
    if (inside) {
      this.s.nitro = Math.min(this.stats.nitroMax, this.s.nitro + 60 * dt);
      this.s.hp = Math.min(this.stats.hpMax, this.s.hp + 25 * dt);
      if (!this.inFuel) { this.hud.banner('REFUELING', 'nitro + repair', '#5dff8a'); this.game.audio.play('power'); }
    }
    this.inFuel = inside;
  }

  /** Explosion knock-up. */
  knock(f: number) {
    if (this.riding) { this.B.vy += 11 * f; this.B.air = true; }
    else this.W.vy += 8 * f;
  }

  // ---------------------------------------------------------------- health, XP, pickups
  hurt(n: number, by?: string, physical = false) {
    const s = this.s, g = this.game;
    if (s.dead || n <= 0) return;
    if (this.buffs.shield > 0) {
      g.fx.burst(this.P.x, this.P.y + 1.2, this.P.z, { n: 12, speed: 6, life: 0.4, size: [0.6, 0.1], colors: [0x7ad7ff, 0xffffff], drag: 2 });
      return;
    }
    if (!physical) n *= 1 - this.stats.armor;
    s.hp -= n;
    s.lastHurt = g.time;
    this.hud.hurt();
    this.cam.shake = Math.max(this.cam.shake, 0.3);
    g.audio.play('hurt');
    if (s.hp <= 0) this.wreck(by);
  }

  private wreck(by?: string) {
    const s = this.s, P = this.P;
    s.dead = true;
    s.hp = 0;
    s.combo = 0;
    this.respawnT = PLAYER.respawnDelay;
    this.hud.banner('WRECKED', by ? `by ${by}` : 'respawning…', '#ff4d5e');
    this.game.audio.play('crash');
    this.game.combat.explode(P.x, P.y + 1, P.z, 0, 0, null, null, 0.8, null, false);
  }

  magnetRange() {
    return this.stats.magnet * 2.2 * (this.buffs.magnet > 0 ? 3 : 1);
  }

  collectGem(x: number, y: number, z: number) {
    const g = this.game, s = this.s;
    s.gems++;
    s.nitro = Math.min(this.stats.nitroMax, s.nitro + 12);
    g.audio.play('gem');
    g.fx.burst(x, y, z, { n: 28, speed: 9, life: 0.7, size: [0.55, 0.05], colors: [0x46e3ff, 0xffffff, 0x8af0ff], gravity: 2, drag: 2 });
    g.effects.ring(x, y, z, 3, 0x46e3ff);
    this.hud.flash('#46e3ff', 0.12);
    this.addXP(25, x, y + 1, z);
    g.events.emit('progress', { player: this, id: 'gem', value: 1 });
  }

  collectPowerup(kind: PowerupKind, x: number, y: number, z: number) {
    const def = POWERUPS[kind], g = this.game;
    if (kind === 'heal') this.s.hp = Math.min(this.stats.hpMax, this.s.hp + def.amount);
    else this.buffs[kind] = def.time;
    g.audio.play('power');
    g.fx.burst(x, y, z, { n: 40, speed: 10, life: 0.8, size: [0.7, 0.05], colors: [def.color, 0xffffff], gravity: 2, drag: 2 });
    g.effects.ring(x, y, z, 4, def.color);
    this.hud.banner(def.label, def.time ? `${def.time}s` : `+${def.amount} health`, '#' + def.color.toString(16).padStart(6, '0'));
    g.events.emit('progress', { player: this, id: 'powerup', value: 1 });
  }

  addXP(n: number, x?: number, y?: number, z?: number) {
    const s = this.s;
    n = Math.round(n * this.stats.xpMul * (this.buffs.xp2 > 0 ? 2 : 1));
    s.xp += n;
    s.score += n;
    if (x !== undefined) this.hud.float('+' + n, x, y!, z!, '#ffd23f', 16);
    while (s.xp >= xpNeed(s.level)) {
      s.xp -= xpNeed(s.level);
      s.level++;
      s.pendingLevels++;
      this.levelReward(s.level);
      const chapter = STORY.chapters.find((c) => c.level === s.level);
      if (chapter && this.game.opts.mode === 'open') this.storyBeat(chapter.title, chapter.text);
      const unlocked = WEAPONS.findIndex((w) => w.unlock === s.level);
      if (unlocked >= 0) {
        this.hud.banner('NEW WEAPON', WEAPONS[unlocked].name + ' unlocked', '#c77dff');
        this.game.audio.play('unlock');
      }
    }
    // races are never interrupted: upgrades are only dealt in open world
    if (s.pendingLevels && !this.cards.length && !this.game.opts.attract && this.game.opts.mode === 'open') this.dealCards(true);
  }

  /** Every level: heal, refill nitro, celebrate. Milestones recolour the exhaust. */
  private levelReward(level: number) {
    const s = this.s, g = this.game;
    s.hp = Math.min(this.stats.hpMax, s.hp + this.stats.hpMax * LEVELING.healOnLevel);
    s.nitro = this.stats.nitroMax;
    g.audio.play('level');
    g.fx.burst(this.P.x, this.P.y + 1.5, this.P.z, { n: 120, speed: 20, life: 1.4, size: [0.7, 0.1], colors: [0xffd23f, 0xffffff, 0xffa53f], gravity: 8 });
    g.effects.ring(this.P.x, this.P.y + 0.3, this.P.z, 9, 0xffd23f);
    this.cam.fovKick = 10;
    const m = MILESTONES.find((x) => x.level === level);
    if (m) this.flame = m.flame;
    this.hud.levelUp(level, m?.title ?? (g.opts.mode === 'race' ? 'Upgrades wait until the race is over' : ''));
  }

  /** Story chapter reached: big banner + objective line in the HUD. */
  storyBeat(title: string, text: string) {
    this.hud.story(title, text);
    this.game.audio.play('story');
  }

  xpNeed() {
    return xpNeed(this.s.level);
  }

  /** Roll 3 different upgrades (skipping maxed ones) with rarity; guarantees a Rare+ every few levels. */
  private dealCards(open: boolean) {
    const pool = UPGRADES.filter((u) => (this.stacks[u.id] ?? 0) < u.max).sort(() => Math.random() - 0.5).slice(0, 3);
    if (!pool.length) { this.s.pendingLevels = 0; return; }
    const total = TIERS.reduce((a, t) => a + t.weight, 0);
    this.cards = pool.map((u) => {
      let r = Math.random() * total, tier = 0;
      for (let i = 0; i < TIERS.length; i++) if ((r -= TIERS[i].weight) <= 0) { tier = i; break; }
      return { u, tier };
    });
    if (this.cards.some((c) => c.tier > 0)) this.sinceRare = 0;
    else if (++this.sinceRare >= LEVELING.pityEvery) {
      this.cards[Math.floor(Math.random() * this.cards.length)].tier = Math.random() < 0.25 ? 2 : 1;
      this.sinceRare = 0;
    }
    this.setCardsOpen(open);
  }

  private setCardsOpen(open: boolean) {
    this.cardsOpen = open && this.cards.length > 0;
    this.cardT = 0;
    if (this.cardsOpen) this.hud.showCards(this.cards, (i) => this.pickCard(i), () => this.reroll(), this.rerolls, this.stacks);
    else this.hud.foldCards(this.cards.length ? this.s.pendingLevels : 0);
    this.game.onCardsChanged();
  }

  private reroll() {
    if (this.rerolls <= 0 || !this.cards.length) return;
    this.rerolls--;
    this.game.audio.play('select');
    this.dealCards(true);
  }

  /** Real-time tick (not slowed by slow motion): open cards fold away after a while. */
  tickCards(dt: number) {
    if (!this.cardsOpen) return;
    this.cardT += dt;
    if (this.cardT > LEVELING.foldAfter) this.setCardsOpen(false);
  }

  pickCard(i: number) {
    const card = this.cards[i];
    if (!card) return;
    const tier = TIERS[card.tier];
    card.u.apply(this, tier.mul);
    this.stacks[card.u.id] = (this.stacks[card.u.id] ?? 0) + 1;
    this.buffs.shield = Math.max(this.buffs.shield, LEVELING.pickShield); // no unfair hits right after choosing
    this.s.pendingLevels--;
    this.cards = [];
    this.game.audio.play('unlock');
    this.hud.banner(`${card.u.icon} ${card.u.title.toUpperCase()}`, `${tier.name} · ${card.u.desc(tier.mul)}`, tier.color);
    if (this.s.pendingLevels > 0) this.dealCards(true);
    else this.setCardsOpen(false);
  }

  // ---------------------------------------------------------------- camera, audio, network
  updateCamera(dt: number, aspect: number) {
    const P = this.P, cam = this.cam, c = this.ctrl, B = this.B, speedKmh = Math.abs(B.v) * 3.6;
    if (c.is('up') || c.is('down')) cam.yaw *= Math.exp(-dt * 2.5);
    const zoom = c.zoom;
    const dist = (this.riding ? 9 + Math.abs(B.v) * 0.06 - cam.boost * 1.2 : 7) * zoom, ht = (this.riding ? 3.8 : 3.2) * zoom, a = P.h + cam.yaw;
    cam.pos.set(P.x - Math.sin(a) * dist, P.y + ht, P.z - Math.cos(a) * dist);
    cam.pos.y = Math.max(cam.pos.y, this.game.terrain.groundAt(cam.pos.x, cam.pos.z) + 1.2);
    this.camera.position.lerp(cam.pos, damp(dt, this.riding ? 7 : 6));
    cam.look.lerp(this._v.set(P.x, P.y + 1.6, P.z), damp(dt, 12));
    this.camera.lookAt(cam.look);
    if (cam.shake > 0) {
      this.camera.position.x += rnd(cam.shake);
      this.camera.position.y += rnd(cam.shake);
      this.camera.position.z += rnd(cam.shake);
      cam.shake = Math.max(0, cam.shake - dt * 1.6);
    }
    cam.fovKick = Math.max(0, cam.fovKick - dt * 12);
    const fovT = 62 + (this.riding ? clamp(speedKmh - 40, 0, 140) * 0.11 : 0) + cam.boost * 10 + cam.fovKick;
    this.camera.fov = lerp(this.camera.fov, fovT, damp(dt, 5));
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    if (!this.engine) this.engine = this.game.audio.createEngine();
    this.engine?.set(45 + Math.abs(B.v) * 3.2 + cam.boost * 40 + (B.air ? 30 : 0), 400 + Math.abs(B.v) * 25, this.riding ? 0.045 / this.game.players.length + cam.boost * 0.03 : 0);
  }

  netState(): NetState {
    const B = this.B, W = this.W, r = (v: number) => Math.round(v * 100) / 100;
    return {
      bx: r(B.x), by: r(B.y), bz: r(B.z), bh: r(B.h), bp: r(B.pitch), bl: r(B.lean),
      wx: r(W.x), wy: r(W.y), wz: r(W.z), wh: r(W.h),
      v: r(B.v), riding: this.riding, boost: r(this.cam.boost), dead: this.s.dead, score: this.s.score,
      lap: this.race.lap, prog: r(this.race.prog * 1000) / 1000,
    };
  }

  dispose() {
    this.engine?.stop();
    this.hud.dispose();
  }
}

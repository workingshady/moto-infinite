// One local rider: bike physics, walking, tricks, health/XP, camera and HUD.
// Everything per-player lives here, so split screen and online need no special cases.
import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Controller } from '../core/Input';
import type { Engine } from '../core/Audio';
import type { EngineSound } from '../core/EngineSound';
import type { Entity } from './EntityManager';
import type { Pose } from '../world/layout';
import type { NetState } from '../../shared/protocol';
import { ASSIST, BIKE, DRIFT, F1, type TyreCompound, LEVELING, CONTROL, LANDING, PHYS, PLAYER, POWERUPS, ROAD, WHEELIE, type PowerupKind } from '../config';
import { clamp, damp, lerp, rnd, TAU, wrapPi } from '../utils/math';
import { buildRider, seatRider, type RiderModel } from './models';
import { buildVehicleModel, type VehicleModel } from './vehicleModels';
import { vehicleById, type VehicleDef } from '../data/vehicles';
import { WEAPONS } from '../data/weapons';
import { MILESTONES, TIERS, UPGRADES, type Card } from '../data/upgrades';
import { Hud } from '../ui/Hud';
import { PlayerChallenges } from '../systems/Challenges';
import { STORY } from '../data/story';
import { prefs, savePrefs } from '../core/prefs';
import { CAM_LABEL, CAM_VIEWS, isCamView, type CamView } from '../core/cameraViews';

type Style = 'NO-HANDER' | 'SUPERMAN' | 'HEEL CLICKER';

/** Power-curve XP requirement: quick early levels, slower later. */
const xpNeed = (level: number) => Math.round(LEVELING.base * Math.pow(level, LEVELING.exp));

export class Player {
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.3, 900);
  /** The ride: motorbike or car model (name kept as `bike` for history). */
  readonly bike: VehicleModel;
  readonly def: VehicleDef;
  readonly rider: RiderModel;
  readonly hud: Hud;
  readonly challenges: PlayerChallenges | null;

  readonly B = {
    x: 0, z: 0, y: 0, h: 0, moveH: 0, v: 0, vy: 0, lean: 0, pitch: 0, pitchV: 0, steer: 0,
    air: false, airT: 0, lastG: 0, wheel: 0, flipAcc: 0, spinAcc: 0, pad: 0, wasN: false, impact: 0, fromRamp: false,
    latch: { up: false, down: false, left: false, right: false },
    wheelie: 0, wheelieV: 0, wheelieT: 0, wheeliePerfect: 0, wheelieD: 0, yawV: 0, flick: 0, lastSteerSign: 0, lastSteerT: 0, wasUp: false, close: false, tandem: false,
  };
  /** Live drift chain: points build while sliding, banked after a short straight. */
  /** Formula 1 state: tyres, aero, pit stops. */
  readonly f1 = {
    compound: 'medium' as TyreCompound, wear: 0, aeroOpen: false, slip: false, inPit: false, pitT: 0, stops: 0, penalty: 0,
    gripMul: 1, stillT: 0, overtake: false, limits: 0, limitT: 0, offT: 0,
  };
  readonly drift = { on: false, pts: 0, t: 0, cool: 0, angle: 0, total: 0, best: 0, zone: '', zoneMult: 1, jitter: 0, prevAngle: 0 };
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
  private engine: EngineSound | null = null;
  private screech: Engine | null = null;
  private _v = new THREE.Vector3();
  private nitroOn = false;
  private style: Style | null = null;
  private styleT = 0;
  private styleDone: Style[] = [];
  /** Chosen camera view (cycled with the camera key, remembered per player slot). */
  view: CamView = 'chase';
  /** Camera view actually used this frame (on foot / wrecked fall back to a third-person view). */
  activeView: CamView = 'chase';
  private cine = { x: 0, y: 0, z: 0, set: false, side: 1 };
  private camQ = new THREE.Quaternion();
  private headParts: THREE.Object3D[] | null = null;
  private headHidden = false;
  /** Vehicle bounds in model space (hood camera placement). */
  private dims = new THREE.Box3();

  constructor(readonly game: Game, readonly index: number, readonly ctrl: Controller, readonly name: string, readonly color: number, spawn: Pose, mounted: boolean, vehicle = 'street') {
    this.def = vehicleById(vehicle);
    this.bike = buildVehicleModel(this.def.id, color);
    this.dims.setFromObject(this.bike.root); // still at the origin, unrotated, no rider yet
    const d = this.def, st = this.stats;
    Object.assign(st, { top: d.top, accel: d.accel, grip: d.grip, hpMax: PLAYER.hpMax + d.hp });
    this.s.hp = st.hpMax;
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
    const saved = Array.isArray(prefs.cams) ? prefs.cams[index] : undefined;
    this.view = isCamView(saved) ? saved : 'chase';
  }

  /** Next camera view; remembered in prefs for this player slot. */
  cycleCamera() {
    this.view = CAM_VIEWS[(CAM_VIEWS.indexOf(this.view) + 1) % CAM_VIEWS.length];
    if (!Array.isArray(prefs.cams)) prefs.cams = ['chase', 'chase'];
    prefs.cams[this.index] = this.view;
    savePrefs();
    this.cine.set = false;
    this.cam.yaw = 0;
    this.hud.camLabel(`🎥 ${CAM_LABEL[this.view]}${!this.riding && (this.view === 'fp' || this.view === 'hood') ? ' · when riding' : ''}`);
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
    if (c.hit('camera')) this.cycleCamera();
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
    if (this.ctrl.is('fire') && s.fireCd <= 0 && !s.dead && !this.controlsLocked && g.opts.mode !== 'f1') g.combat.fire(this); // no weapons in F1
    if (g.time - s.lastHurt > PLAYER.regenDelay && !s.dead) s.hp = Math.min(this.stats.hpMax, s.hp + PLAYER.regenRate * dt);
    if (s.comboT > 0) { s.comboT -= dt; if (s.comboT <= 0) s.combo = 0; }
    for (const k of Object.keys(this.buffs) as PowerupKind[]) if (this.buffs[k] > 0) this.buffs[k] = Math.max(0, this.buffs[k] - dt);
  }

  get isCar() {
    return this.def.kind === 'car';
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
        if (!B.wasN) { g.audio.play('nitro'); g.audio.play('whoosh'); this.cam.shake = Math.max(this.cam.shake, 0.25); this.cam.fovKick = 8; }
        s.nitro -= BIKE.nitroBurn * dt;
        boosting = true;
      }
      B.wasN = wantN;
      if (B.pad > 0) boosting = true;
      const F = this.def.f1;
      if (F) this.f1Step(dt, active && c.is('trick'), down);
      const top = st.top * (boosting ? BIKE.nitroTopMul : 1) * (onRoad ? 1 : lerp(BIKE.offroadTop, 1, this.def.offroad));
      if (!B.air) {
        // mid-wheelie the throttle stays on (holding C = gas) and ↓ only lowers the front instead of braking
        const inWheelie = B.wheelie > WHEELIE.active;
        const gas = up || (inWheelie && active && c.is('trick'));
        if (F) this.f1Longitudinal(dt, gas || boosting, down, boosting, onRoad);
        else {
          if (gas) B.v += (B.v < 0 ? 40 : st.accel * (boosting ? BIKE.nitroAccelMul : 1)) * dt;
          else if (boosting) B.v += st.accel * BIKE.nitroAccelMul * dt; // nitro drives by itself: Space + ←/→ is enough
          if (down && !inWheelie) B.v -= (B.v > 0 ? BIKE.brake : BIKE.reverse) * dt;
          if (!gas && !down && !boosting) B.v *= 1 - BIKE.coastDrag * dt;
          if (!onRoad) B.v *= 1 - BIKE.offroadDrag * (1 - this.def.offroad) * dt;
          if (B.v > top) B.v -= Math.min(B.v - top, 30 * dt);
        }
        if (g.env.grip < 1 && Math.abs(B.steer) > 0.6 && Math.abs(B.v) > 20) B.v *= 1 - (1 - g.env.grip) * dt; // wet roads scrub speed in corners
        B.v = Math.max(B.v, -BIKE.maxReverse);
        // steering eases in and re-centres smoothly instead of snapping
        const want = (left ? 1 : 0) - (right ? 1 : 0);
        B.steer = lerp(B.steer, want, damp(dt, want ? CONTROL.steerIn : CONTROL.steerOut));
        const handbrake = active && c.is('drift') && Math.abs(B.v) > 6;
        const wheelie = this.updateWheelie(dt, active && c.is('trick'), up, down);
        // yaw with inertia: the yaw rate eases toward what the steering asks for (heavier cars respond slower)
        const yawTarget = B.steer * st.grip * g.env.grip * clamp(Math.abs(B.v) / 6, 0, 1) * Math.sign(B.v)
          * (boosting ? CONTROL.boostSteer : 1) * (handbrake ? 1.55 : 1) * (wheelie ? 0.8 : 1);
        // F1: the cornering limit (lateral g) grows with downforce ~ v², so yaw rate is capped at aLat / v
        let yawGoal = yawTarget;
        if (F) {
          // lateral limit = μ·g·(1 + downforce/weight); turning faster than aLat / v just washes wide (understeer)
          const v = Math.max(Math.abs(B.v), 6), aLat = F.mu * 9.81 * (1 + this.downforceRatio(v)) * this.f1.gripMul * g.env.grip * (onRoad ? 1 : 0.55);
          yawGoal = clamp(yawTarget, -aLat / v, aLat / v);
        }
        B.yawV = lerp(B.yawV, yawGoal, damp(dt, this.isCar ? DRIFT.yawInertia.car : DRIFT.yawInertia.bike));
        B.h += B.yawV * dt;
        // weight transfer: a quick left-right flick, lifting off, or braking mid-turn makes the rear light
        const steerSign = Math.sign(want);
        if (steerSign && steerSign !== B.lastSteerSign) {
          if (B.lastSteerSign && g.time - B.lastSteerT < DRIFT.flickWindow && Math.abs(B.v) > 16 && this.isCar) B.flick = DRIFT.flickTime;
          B.lastSteerSign = steerSign;
          B.lastSteerT = g.time;
        } else if (steerSign) B.lastSteerT = g.time;
        B.flick = Math.max(0, B.flick - dt);
        const slip = wrapPi(B.h - B.moveH);
        if (!handbrake && Math.abs(slip) < 0.15) this.assistSteer(dt, want);
        // drift model: the travel direction chases the heading at the vehicle's traction rate.
        // Handbrake and power oversteer (throttle on a low-traction car) let the tail step out;
        // counter-steering (steering against the slide) catches it faster.
        let trac = (handbrake ? this.def.slideTraction : this.def.traction) * g.env.grip * this.f1.gripMul;
        const turning = Math.abs(B.steer) > 0.4 && Math.abs(B.v) > 14;
        if (this.isCar && (up || boosting) && Math.abs(slip) > 0.1 && this.def.traction < 6) trac *= 0.75; // power oversteer
        if (B.flick > 0) trac *= DRIFT.flickTraction; // feint / Scandinavian flick
        if (this.isCar && turning && B.wasUp && !up && !down) trac *= DRIFT.liftTraction; // lift-off oversteer
        if (this.isCar && turning && down && B.v > 0) trac *= DRIFT.brakeTraction; // trail braking
        if (Math.sign(B.steer) === -Math.sign(slip) && Math.abs(B.steer) > 0.3) trac *= 1.6; // counter-steer catches it
        B.wasUp = up;
        B.moveH += wrapPi(B.h - B.moveH) * Math.min(1, dt * trac);
        // throttle steers the angle mid-drift: power pushes the tail out, lifting tucks it in
        const slip2 = wrapPi(B.h - B.moveH);
        if (Math.abs(slip2) > DRIFT.minAngle && this.isCar) B.h += Math.sign(slip2) * (up || boosting ? 1 : -0.6) * DRIFT.throttleAngle * 0.12 * dt;
        // angle limit: assist holds the slide, on Pro you spin out past the limit
        const hold = DRIFT.holdAngle[prefs.assist] ?? DRIFT.holdAngle[1], sl = wrapPi(B.h - B.moveH);
        if (Math.abs(sl) > DRIFT.spinAngle && prefs.assist === 0 && Math.abs(B.v) > 10) this.spinOut();
        else if (Math.abs(sl) > hold) B.h = B.moveH + Math.sign(sl) * lerp(Math.abs(sl), hold, damp(dt, 6));
        if (handbrake) B.v -= Math.sign(B.v) * 6 * dt;
        B.v *= 1 - Math.abs(Math.sin(slip)) * DRIFT.scrub * (up || boosting ? 0.5 : 1) * dt; // sideways = slower, power holds speed
        if (this.isCar) B.lean = lerp(B.lean, -B.steer * clamp(Math.abs(B.v) / 30, 0, 1) * 0.06, damp(dt, 5)); // body roll
        else B.lean = lerp(B.lean, -B.steer * clamp(Math.abs(B.v) / 22, 0, 1) * 0.55, damp(dt, 6));
        // keys held while leaving the ground must be released before they do tricks
        B.latch.up = up; B.latch.down = down; B.latch.left = left; B.latch.right = right;
      } else {
        const L = B.latch;
        if (!up) L.up = false;
        if (!down) L.down = false;
        if (!left) L.left = false;
        if (!right) L.right = false;
        const trick = active && !this.isCar && c.is('trick') && B.airT > 0.15;
        if (trick) {
          // C in the air: ↑ = Superman, ↓ = Heel Clicker, nothing = No-Hander (↑↓ pick the pose instead of flipping)
          const want: Style = up ? 'SUPERMAN' : down ? 'HEEL CLICKER' : 'NO-HANDER';
          if (want !== this.style) { this.style = want; this.styleT = 0; }
          this.styleT += dt;
          if (this.styleT > 0.35 && !this.styleDone.includes(want)) this.styleDone.push(want);
        } else this.style = null;
        this.poseStyle();
        const pitchIn = trick || this.isCar ? 0 : (up && !L.up ? 1 : 0) - (down && !L.down ? 1 : 0);
        const spinIn = this.isCar ? 0 : (left && !L.left ? 1 : 0) - (right && !L.right ? 1 : 0);
        B.wheelie = lerp(B.wheelie, 0, damp(dt, 6));
        B.wheelieV = 0;
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
        const airSteer = this.isCar || !B.fromRamp || B.airT < CONTROL.airSteerTime;
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
    // F1: ERS harvests energy under braking; everything else regenerates nitro over time
    const regen = this.def.f1 ? (down && Math.abs(B.v) > 10 ? F1.ersRegen : F1.ersIdle) : st.nitroRegen;
    s.nitro = clamp(s.nitro + regen * dt, 0, st.nitroMax);
    if (Math.abs(B.v) < 0.03) B.v = 0;
    B.pad = Math.max(0, B.pad - dt);
    this.cam.boost = lerp(this.cam.boost, boosting && this.riding ? 1 : 0, damp(dt, 6));

    // crosswind gusts nudge the heading sideways (a = push * sideways share of the wind; turn rate = a / v)
    const E = g.env;
    if (!B.air && E.windPush > 0.05 && Math.abs(B.v) > 3) B.moveH += (E.windPush * Math.sin(E.windDir - B.moveH) / Math.max(12, Math.abs(B.v))) * Math.sign(B.v) * dt;

    // horizontal move + collisions
    const nx = B.x + Math.sin(B.moveH) * B.v * dt, nz = B.z + Math.cos(B.moveH) * B.v * dt;
    if (B.v !== 0) {
      const rad = this.isCar ? 1.5 : 1;
      const blk = g.chunks.blocked(nx, nz, rad, B.y, B.air ? 99 : 1.3);
      let glanced = false;
      if (blk === 'tree' || blk === 'wall') {
        // try sliding past at a small angle before treating it as a head-on hit
        const A = ASSIST[prefs.assist] ?? ASSIST[1];
        for (const turn of [0.35, -0.35, 0.7, -0.7]) {
          const h2 = B.moveH + turn, sx = B.x + Math.sin(h2) * B.v * dt, sz = B.z + Math.cos(h2) * B.v * dt;
          if (!g.chunks.blocked(sx, sz, rad, B.y, B.air ? 99 : 1.3)) {
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
        this.failDrift();
        if (Math.abs(B.v) > LANDING.wallDamageSpeed) {
          this.cam.shake = 0.5;
          g.audio.play('crash');
          this.hurt(Math.abs(B.v) * 0.3 * (1 - st.crashArmor) * (ASSIST[prefs.assist] ?? ASSIST[1]).crash, undefined, true);
          g.fx.burst(nx, B.y + 1, nz, { n: 20, speed: 6, life: 0.8, size: [1, 3], colors: [0x9a8a70], gravity: -1, drag: 2, smoke: true, alpha: 0.6 });
        }
        B.v *= -0.25;
      } else {
        const e = g.entities.hitTest(nx, B.y, nz, this.isCar ? 1.4 : 0.9);
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
            // tyre wear: distance, plus extra when sliding or braking hard
            if (this.def.f1) this.f1.wear = Math.min(1, this.f1.wear + (d / F1.tyres[this.f1.compound].life) * (1 + Math.abs(wrapPi(B.h - B.moveH)) * 4 + (down ? 0.6 : 0)));
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
    const M = this.bike;
    B.wheel += (B.v * dt) / M.wheelRadius;
    M.wheels.forEach((w) => (w.rotation.x = B.wheel));
    M.steer.forEach((w) => (w.rotation.y = B.steer * 0.45));
    const wl = B.wheelie, rear = 1.05; // lift the nose around the rear axle
    M.root.position.set(B.x - Math.sin(B.h) * rear * (1 - Math.cos(wl)), B.y + Math.sin(wl) * rear, B.z - Math.cos(B.h) * rear * (1 - Math.cos(wl)));
    M.root.rotation.set(B.pitch - wl, B.h, B.lean);
    M.brakeMat.emissiveIntensity = active && (down || c.is('drift')) ? 2.6 : 0.6;
    if (this.riding && !B.air) this.updateDrift(dt);

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
    // tyre marks when braking hard, leaning hard or sliding
    const sliding = Math.abs(wrapPi(B.h - B.moveH)) > 0.18 && Math.abs(B.v) > 8;
    if (this.riding && !B.air && ((down && B.v > 12) || sliding || (!this.isCar && Math.abs(B.lean) > 0.3 && Math.abs(B.v) > 18))) {
      if (this.isCar) for (const side of [-0.78, 0.78]) g.effects.skid(B.x - fx * 1.3 + fz * side, B.z - fz * 1.3 - fx * side, B.moveH);
      else g.effects.skid(B.x - fx * 1.05, B.z - fz * 1.05, B.moveH);
    }
    // tyre screech: louder and higher with angle and speed
    const slipA = Math.abs(wrapPi(B.h - B.moveH));
    if (!this.screech) this.screech = g.audio.createScreech();
    this.screech?.set(1200 + Math.abs(B.v) * 30, 0, this.riding && !B.air && slipA > 0.15 && Math.abs(B.v) > 8 ? clamp(slipA * 0.12, 0, 0.09) / g.players.length : 0);
    // sparks when sliding right next to a wall
    if (this.drift.on && B.close && Math.random() < 0.5) {
      for (let i = 0; i < 3; i++) g.fx.emit(B.x + fz * rnd(1.2), B.y + 0.4, B.z - fx * rnd(1.2), rnd(5), 2 + Math.random() * 3, rnd(5), 0.35, 0.25, 0.05, 0xffb03f, 1, 14, 1);
    }
    // drift smoke from the rear tyres, thicker the wider the angle and the faster you go
    if (this.riding && !B.air && sliding && onRoad) {
      const amt = clamp(slipA * 1.5 * clamp(Math.abs(B.v) / 20, 0.5, 1.4), 0.3, 1);
      for (const side of this.isCar ? [-0.78, 0.78] : [0]) {
        const sx = B.x - fx * (this.isCar ? 1.35 : 1.1) + fz * side, sz = B.z - fz * (this.isCar ? 1.35 : 1.1) - fx * side;
        if (Math.random() < amt) g.fx.emit(sx, B.y + 0.3, sz, rnd(1.2), 1.2 + Math.random(), rnd(1.2), 1.6, 1, 4.5, 0xe8e8e8, 0.55 * amt, -0.6, 1.2, true);
      }
    }
    if (this.riding && !B.air && Math.abs(B.lean) > 0.35 && Math.abs(B.v) > 20 && onRoad)
      g.fx.emit(B.x - fx * 1.1, B.y + 0.15, B.z - fz * 1.1, rnd(1), 1, rnd(1), 0.9, 0.6, 2.2, 0xdddddd, 0.35, -0.4, 1.5, true);
  }

  /**
   * Wheelies (bikes only). State: angle B.wheelie and angular velocity B.wheelieV around the rear axle.
   * Hold C on the ground at any speed to lift, release to land. Normal/Easy: wheelie control holds the front at a target
   * angle (↑/↓ nudge it, never brake) and clamps it below the loop-out point. Pro: real balance physics, loop out = crash.
   */
  private updateWheelie(dt: number, hold: boolean, up: boolean, down: boolean) {
    const B = this.B, W = WHEELIE;
    if (!this.def.wheelie || this.isCar) return false;
    const on = hold && B.v > W.minSpeed, a = B.wheelie, v = B.wheelieV, lim = W.limit[prefs.assist] ?? W.limit[1];
    if (!on && a <= 0) { B.wheelie = 0; B.wheelieV = 0; this.endWheelie(); return false; }
    const pro = prefs.assist === 0, gravity = pro ? -W.gravity * Math.sin(W.balance - a) : 0; // Pro: tips forward below balance, backwards past it
    let acc: number;
    if (!on) acc = gravity + W.landOmega ** 2 * (W.land - a) - 2 * W.landOmega * v; // released: the front comes down smoothly
    else if (pro) {
      // Pro: the throttle hand only roughly holds the angle, ↑ adds raw lift (hold it too long and you loop out), ↓ is the rear brake
      acc = gravity + W.proHold * (W.aim - a) - W.proDamp * v + (up ? W.proUp * (this.def.accel / 17) : 0) - (down ? W.brake : 0);
    } else {
      // wheelie control: critically damped spring toward the target angle, same feel at any speed (nitro included)
      const aim = Math.min(W.aim + (up ? W.aimUp : 0) - (down ? W.aimDown : 0), lim - 0.06);
      acc = W.omega ** 2 * (aim - a) - 2 * W.omega * v;
    }
    B.wheelieV += acc * dt;
    B.wheelie += B.wheelieV * dt;
    if (B.wheelie > lim) { B.wheelie = lim; B.wheelieV = Math.min(B.wheelieV, 0); } // electronics catch it before the loop-out
    if (B.wheelie > W.loopOut) {
      B.wheelie = 0;
      B.wheelieV = 0;
      B.wheelieT = 0;
      B.wheeliePerfect = 0;
      B.wheelieD = 0;
      this.crash('Looped out! ↓ lowers the front, or switch Assist to Normal for wheelie control');
      return false;
    }
    if (B.wheelie <= 0) {
      if (B.wheelieV < -W.slam) { this.cam.shake = Math.max(this.cam.shake, 0.25); this.game.audio.play('thud'); }
      B.wheelie = 0;
      B.wheelieV = 0;
      this.endWheelie();
      return false;
    }
    if (B.wheelie > 0.18) {
      B.wheelieT += dt;
      B.wheelieD += Math.abs(B.v) * dt;
      if (Math.abs(B.wheelie - W.balance) < W.perfect) B.wheeliePerfect += dt;
      this.game.events.emit('progress', { player: this, id: 'wheelie', value: B.wheelieT });
    }
    return B.wheelie > 0.18;
  }

  /** Front wheel back down: bank the wheelie (time, perfect balance and high-speed bonuses). */
  private endWheelie() {
    const B = this.B, W = WHEELIE, t = B.wheelieT, perfect = B.wheeliePerfect, dist = B.wheelieD;
    B.wheelieT = 0;
    B.wheeliePerfect = 0;
    B.wheelieD = 0;
    if (t < W.minTime) return;
    const fast = dist / t > W.fastSpeed;
    const xp = Math.round((t * W.xpPerSec + perfect * W.perfectXpPerSec + (fast ? t * W.fastXpPerSec : 0)) * this.stats.trickMul);
    const extras = [fast ? `avg ${Math.round((dist / t) * 3.6)} km/h` : '', perfect > 0.5 ? `PERFECT BALANCE ${perfect.toFixed(1)}s` : ''].filter(Boolean).join(' · ');
    this.hud.banner(`${fast ? 'HIGH-SPEED ' : ''}WHEELIE ${t.toFixed(1)}s · ${Math.round(dist)} m`, `${extras ? extras + ' · ' : ''}+${xp} XP`, fast ? '#ff7ad9' : perfect > 0.5 ? '#7cffb2' : '#ffd23f');
    this.game.audio.play('trick');
    this.addXP(xp);
  }

  /** Drift scoring: angle x speed builds points, the multiplier grows the longer the chain lasts. */
  private updateDrift(dt: number) {
    const B = this.B, d = this.drift, g = this.game, angle = Math.abs(wrapPi(B.h - B.moveH));
    const zone = g.layout.kind === 'drift' ? (g.layout as unknown as { zoneAt(x: number, z: number): { name: string; mult: number } | null }).zoneAt(B.x, B.z) : null;
    if (angle > DRIFT.minAngle && Math.abs(B.v) > DRIFT.minSpeed && angle < 1.7) {
      d.on = true;
      d.cool = 0;
      d.t += dt;
      // fluidity: smooth angle changes score more than see-sawing
      d.jitter = lerp(d.jitter, Math.abs(angle - d.prevAngle) / dt, damp(dt, 3));
      d.prevAngle = angle;
      d.angle = angle;
      d.zone = zone ? zone.name : '';
      d.zoneMult = zone ? zone.mult : 1;
      B.close = this.nearWall();
      B.tandem = this.nearDrifter();
      const speed = Math.min(Math.abs(B.v), DRIFT.speedCap), fluid = 1.15 - clamp(d.jitter / 4, 0, 0.35);
      d.pts += angle * speed * DRIFT.rate * dt * d.zoneMult * fluid * (1 + (B.close ? DRIFT.closeBonus : 0) + (B.tandem ? DRIFT.tandemBonus : 0));
    } else if (d.on) {
      d.cool += dt;
      if (d.cool > DRIFT.bankAfter) this.bankDrift();
    }
  }

  get driftMult() {
    return Math.min(DRIFT.multMax, 1 + Math.floor(this.drift.t / DRIFT.multStep) * 0.5);
  }

  private bankDrift() {
    const d = this.drift, total = Math.round(d.pts * this.driftMult);
    d.on = false;
    if (total >= 100) {
      d.total += total;
      d.best = Math.max(d.best, total);
      this.s.score += total;
      const [, grade, col] = DRIFT.grades.find(([min]) => total >= min)!;
      this.hud.banner(`${grade} ${total.toLocaleString()}`, `x${this.driftMult.toFixed(1)} · ${d.t.toFixed(1)}s${d.zone ? ' · ' + d.zone : ''}`, col);
      if (total >= 4000) this.game.fx.burst(this.B.x, this.B.y + 1, this.B.z, { n: 60, speed: 14, life: 1, size: [0.6, 0.1], colors: [0xff7ad9, 0xffd23f, 0xffffff], gravity: 6 });
      this.game.audio.play('trick');
      this.addXP(total / DRIFT.xpDiv);
      this.game.events.emit('progress', { player: this, id: 'drift', value: total });
    }
    d.pts = d.t = d.cool = 0;
  }

  /** Within a few metres of a wall, container or the edge of a drift venue. */
  private nearWall() {
    const B = this.B, g = this.game, r = DRIFT.closeDist;
    let close = false;
    g.chunks.forNear(B.x, B.z, (c) => {
      for (const o of c.obs) if ((B.x - o.x) ** 2 + (B.z - o.z) ** 2 < (o.r + r) ** 2) return (close = true);
    });
    if (!close && g.layout.kind === 'drift') close = g.layout.roadDist(B.x, B.z) > ROAD.asphalt - r && g.layout.roadDist(B.x, B.z) < ROAD.asphalt + 1;
    return close;
  }

  /** Another rider (local or online) drifting close by: tandem bonus. */
  private nearDrifter() {
    const B = this.B, g = this.game, r2 = DRIFT.tandemDist ** 2;
    for (const o of g.players) if (o !== this && o.drift.on && (o.B.x - B.x) ** 2 + (o.B.z - B.z) ** 2 < r2) return true;
    let t = false;
    // online snapshots don't carry slip angle, so a fast rider right next to you counts as a tandem partner
    g.remotes?.forEach((r) => { if (!t && r.state && Math.abs(r.state.v) > 10 && (r.x - B.x) ** 2 + (r.z - B.z) ** 2 < r2) t = true; });
    return t;
  }

  /** Pro assist: over-rotating spins the car out. */
  private spinOut() {
    const B = this.B;
    this.failDrift();
    B.v *= 0.35;
    B.yawV = 0;
    B.h = B.moveH + Math.PI * 0.9 * Math.sign(wrapPi(B.h - B.moveH));
    B.moveH = B.h;
    this.hud.banner('SPUN OUT!', 'Counter-steer earlier (steer against the slide)', '#ff4d5e');
    this.game.audio.play('crash');
    this.cam.shake = Math.max(this.cam.shake, 0.4);
  }

  /** Hitting something mid-drift loses the chain. */
  private failDrift() {
    const d = this.drift;
    if (d.on && d.pts > 200) {
      this.hud.banner('DRIFT LOST', `${Math.round(d.pts * this.driftMult).toLocaleString()} points gone`, '#ff4d5e');
      this.game.audio.play('fail');
    }
    d.on = false;
    d.pts = d.t = d.cool = 0;
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
        g.replay?.mark(this, 'trick', tricks[0], pts);
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
      g.audio.play('land', clamp(B.impact / 20, 0.4, 1));
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
    // edge guard: heading outward near the edge -> steer back toward the centre line.
    // Only when actually heading away from the centre, and never while the rider steers outward
    // (it used to push against an outward steer, which felt like one direction "not working").
    if (rd > ROAD.asphalt - 1.5 && A.edge) {
      const toCx = road.x - B.x, toCz = road.z - B.z, toward = Math.atan2(toCx, toCz);
      const out = wrapPi(toward - B.h);
      const outward = Math.sin(B.h) * toCx + Math.cos(B.h) * toCz < 0;
      if (outward && Math.abs(out) > 0.2 && steerInput * out >= 0) B.h += clamp(out, -0.5, 0.5) * Math.min(1, dt * A.edge) * clamp((rd - ROAD.asphalt + 1.5) / 3, 0, 1);
    }
  }

  /** Gearbox state from the engine sound (for the F1 dash). */
  get dash() {
    return { gear: this.engine?.gear ?? 1, rpm: this.engine?.rpm ?? 0, redline: this.def.engine.redline };
  }

  /** Seconds to the nearest car ahead (AI or local players), for overtake mode. */
  private gapAhead() {
    const B = this.B, fx = Math.sin(B.moveH), fz = Math.cos(B.moveH), v = Math.max(10, Math.abs(B.v));
    let best = 1e9;
    const consider = (x: number, z: number) => {
      const dx = x - B.x, dz = z - B.z, along = dx * fx + dz * fz;
      if (along > 2 && Math.abs(dx * fz - dz * fx) < 8) best = Math.min(best, along / v);
    };
    this.game.ai?.list.forEach((r) => consider(r.x, r.z));
    for (const o of this.game.players) if (o !== this) consider(o.B.x, o.B.z);
    return best;
  }

  /** Starting tyres for F1 sessions. */
  setTyres(c: TyreCompound) {
    this.f1.compound = c;
    this.f1.wear = 0;
    this.bike.tyreBands?.color.setHex(F1.tyres[c].color);
  }

  /** Downforce as a multiple of the car's weight at speed v: ½ρ·ClA·v² / (m·g). Straight mode sheds some. */
  private downforceRatio(v: number) {
    const F = this.def.f1!;
    return (0.5 * F1.rho * F.cla * v * v * (this.f1.aeroOpen ? F1.straightDown : 1)) / (F.mass * 9.81);
  }

  /**
   * Real longitudinal dynamics: drive = min(power/v, traction), minus aero drag ½ρ·CdA·v² and rolling resistance.
   * Braking = μ·g·(1 + downforce ratio) so F1 cars brake harder from high speed. ERS adds electric power that fades
   * at very high speed; top speed is simply where power meets drag.
   */
  private f1Longitudinal(dt: number, gas: boolean, brake: boolean, ers: boolean, onRoad: boolean) {
    const B = this.B, F = this.def.f1!, f = this.f1, v = Math.max(0, B.v), g = 9.81, dr = this.downforceRatio(v);
    const grip = f.gripMul * this.game.env.grip;
    const cda = F.cda * (f.aeroOpen ? F1.straightDrag : 1) * (f.slip ? F1.slipDrag : 1);
    const drag = (0.5 * F1.rho * cda * v * v) / F.mass + F1.rolling * g;
    let a = -drag;
    if (gas && B.v >= -0.5) {
      const taper = clamp((F1.ersTaperTo - v) / (F1.ersTaperTo - F1.ersTaperFrom), 0, 1);
      const kw = F.power + (ers && F.ers ? F.ers * taper * (f.overtake ? F1.overtakeErs : 1) : 0);
      const traction = F.muLong * g * (1 + dr) * grip;
      a += Math.min((kw * 1000 * F1.drivetrain) / (F.mass * Math.max(v, 4)), traction);
    } else if (!brake) a -= F1.engineBrake;
    if (brake) {
      if (B.v > 0.5) a -= Math.min(F.muBrake * g * (1 + dr) * grip, 6.5 * g);
      else a -= BIKE.reverse; // creep backwards
    }
    if (!onRoad) a -= (this.game.terrain.layout.roadDist(B.x, B.z) > ROAD.shoulder + 3 ? F1.gravelDrag : F1.grassDrag) * v * 0.2;
    B.v = Math.max(B.v + a * dt, B.v > 0 && !brake ? 0 : -BIKE.maxReverse);
    if (B.v > 0 && B.v < 0.05 && !gas) B.v = 0;
  }

  /** F1 per-step: tyre grip, straight-mode wing (DRS), slipstream, pit limiter and pit stops. */
  private f1Step(dt: number, wingKey: boolean, braking: boolean) {
    const f = this.f1, B = this.B, g = this.game, lay = g.layout as unknown as { inDrs?(i: number): boolean; isPit?(x: number, z: number): boolean; nearest?(x: number, z: number, e?: boolean): { i: number } };
    const T = F1.tyres[f.compound];
    f.gripMul = T.grip * lerp(1, F1.wornGrip, f.wear ** 1.4);
    // straight mode / DRS: only inside DRS zones, closes the moment you brake
    const idx = lay.nearest ? lay.nearest(B.x, B.z).i : -1;
    const zone = idx >= 0 && !!lay.inDrs?.(idx);
    const canWing = this.def.f1!.aero === 'active';
    if (canWing && zone && wingKey && !braking) f.aeroOpen = true;
    if (!canWing || !zone || braking) f.aeroOpen = false;
    f.overtake = this.gapAhead() < F1.overtakeGap;
    f.slip = Math.abs(B.v) > 25 && (!!g.ai?.slipstreamFor(B.x, B.z, B.moveH) || g.players.some((o) => o !== this && Math.hypot(o.B.x - B.x, o.B.z - B.z) < F1.slipDist && Math.hypot(o.B.x - B.x, o.B.z - B.z) > 3)); // only at racing speed
    const wing = this.bike.rearFlap;
    if (wing) wing.rotation.x = lerp(wing.rotation.x, f.aeroOpen ? 0.5 : 0, Math.min(1, dt * 10));
    if (this.bike.frontFlap) this.bike.frontFlap.rotation.x = lerp(this.bike.frontFlap.rotation.x, f.aeroOpen ? 0.25 : 0, Math.min(1, dt * 10));
    // track limits: all four wheels well beyond the white line at racing speed = warning, then +5 s
    const off = !f.inPit && g.layout.roadDist(B.x, B.z) > ROAD.asphalt + 1.5 && Math.abs(B.v) > 25 && !!g.race?.started;
    f.offT = off ? f.offT + dt : 0;
    f.limitT = Math.max(0, f.limitT - dt);
    if (f.offT > 0.4 && f.limitT <= 0) {
      f.limits++;
      f.limitT = 3;
      if (f.limits > F1.trackLimits) { f.penalty += F1.trackLimitPenalty; this.hud.banner('TRACK LIMITS', `+${F1.trackLimitPenalty}s time penalty`, '#ff4d5e'); }
      else this.hud.banner(f.limits === F1.trackLimits ? 'BLACK & WHITE FLAG' : 'TRACK LIMITS', `Warning ${f.limits}/${F1.trackLimits}`, '#ffd23f');
    }
    // pit lane: speed limiter, stop in the box for fresh tyres
    f.inPit = !!lay.isPit?.(B.x, B.z);
    if (f.inPit) {
      if (B.v > F1.pitLimit) B.v = lerp(B.v, F1.pitLimit, Math.min(1, dt * 4));
      f.stillT = Math.abs(B.v) < 2 ? f.stillT + dt : 0;
      if (f.stillT > 0.4 && f.pitT <= 0 && f.wear > 0.05) {
        f.pitT = F1.pitStop;
        this.controlsLocked = true;
        g.audio.play('mount');
        this.hud.banner('PIT STOP', 'Tyres off… tyres on!', '#3cc8ff');
      }
    }
    if (f.pitT > 0) {
      f.pitT -= dt;
      B.v = 0;
      if (f.pitT <= 0) {
        const next: TyreCompound = f.compound === 'soft' ? 'medium' : f.compound === 'medium' ? 'hard' : 'soft';
        this.setTyres(next);
        f.stops++;
        this.s.nitro = this.stats.nitroMax;
        this.controlsLocked = false;
        this.hud.banner(`PIT STOP ${F1.pitStop.toFixed(1)}s`, `${F1.tyres[next].label} tyres fitted · ERS full`, '#7cffb2');
        g.audio.play('go');
      }
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
    this.failDrift();
    B.wheelie = 0;
    B.wheelieV = 0;
    B.wheelieT = 0;
    B.wheeliePerfect = 0;
    B.wheelieD = 0;
    this.hud.banner('CRASH!', reason, '#ff4d5e');
    g.replay?.mark(this, 'crash', 'CRASH');
    g.audio.play('crash');
    if (this.isCar) g.audio.play('clank');
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
    if (spd !== 0 && !g.chunks.blocked(nx, nz, 0.45, W.y, 0.9) && !g.entities.hitTest(nx, W.y, nz, 0.4) && !(Math.hypot(nx - B.x, nz - B.z) < (this.isCar ? 2.3 : 1.3) && W.y < B.y + 1.5)) {
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
    this.rider.root.visible = !this.isCar;
    if (this.bike.driver) this.bike.driver.visible = true;
  }

  private toggleRide() {
    const W = this.W, B = this.B, g = this.game;
    if (!this.riding && Math.hypot(W.x - B.x, W.z - B.z) < (this.isCar ? BIKE.carMountDist : BIKE.mountDist)) {
      this.mount();
      g.audio.play('mount');
    } else if (this.riding) {
      for (const side of [1, -1]) {
        const rx = Math.cos(B.moveH) * side, rz = -Math.sin(B.moveH) * side, out = this.isCar ? 2.6 : 2, nx = B.x - rx * out, nz = B.z - rz * out;
        if (!g.chunks.blocked(nx, nz, 0.5, B.y, 1.5) || side === -1) {
          this.riding = false;
          g.scene.add(this.rider.root);
          this.rider.root.visible = true;
          if (this.bike.driver) this.bike.driver.visible = false;
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
  /** Hide this player's own head/helmet (first-person view) without touching what other viewports see. */
  private hideHead(on: boolean) {
    if (on) this.rider.helmet.visible = false;
    if (on === this.headHidden) return;
    this.headHidden = on;
    if (!this.headParts) {
      const parts: THREE.Object3D[] = [];
      for (const o of this.rider.root.children) if (o instanceof THREE.Mesh && o !== this.rider.hair && o.position.y > 1.95) parts.push(o);
      this.bike.driver?.traverse((o) => { if (o instanceof THREE.Mesh && o.geometry instanceof THREE.SphereGeometry) parts.push(o); });
      this.headParts = parts;
    }
    for (const o of this.headParts) o.visible = !on;
    if (!on) this.rider.helmet.visible = this.riding;
  }

  /** Point on the vehicle the attached cameras (hood / first person) sit at, in world space. */
  private eyePoint(view: 'fp' | 'hood', out: THREE.Vector3) {
    const M = this.bike.root, d = this.dims, car = this.isCar;
    M.updateMatrixWorld(true);
    if (view === 'fp') {
      const drv = this.bike.driver;
      if (car && drv) return drv.localToWorld(this.def.f1 ? out.set(0, 0.05, 0.06) : out.set(0, 0.76, 0));
      if (!car) return this.rider.helmet.localToWorld(out.set(0, 0.06, 0.22));
      return M.localToWorld(out.set(0, d.max.y * 0.85, 0));
    }
    return car ? M.localToWorld(out.set(0, d.max.y * 0.72 + 0.25, d.max.z * 0.5)) : M.localToWorld(out.set(0, d.max.y + 0.35, d.max.z * 0.3));
  }

  updateCamera(dt: number, aspect: number) {
    const P = this.P, cam = this.cam, c = this.ctrl, B = this.B, speedKmh = Math.abs(B.v) * 3.6, g = this.game;
    if (c.is('up') || c.is('down')) cam.yaw *= Math.exp(-dt * 2.5);
    const live = this.riding && !this.s.dead;
    const view: CamView = live || (this.view !== 'fp' && this.view !== 'hood') ? this.view : 'chase';
    this.activeView = view;
    // every player renders in turn: show heads in all viewports except our own first-person one
    for (const o of g.players) o.hideHead(o === this && view === 'fp');
    const attached = view === 'fp' || view === 'hood';
    const zoom = c.zoom;
    let fovBase = 62, speedFov = 1, shakeMul = 1, fovOverride = 0;
    if (attached) {
      // locked to the vehicle: lean, pitch (wheelies, flips) and heading come straight from the model
      const eye = this.eyePoint(view, cam.pos);
      eye.y = Math.max(eye.y, g.terrain.groundAt(eye.x, eye.z) + 0.25);
      this.camera.position.copy(eye);
      this.camQ.setFromAxisAngle(this._v.set(0, 1, 0), Math.PI + cam.yaw);
      this.camera.quaternion.copy(this.bike.root.quaternion).multiply(this.camQ);
      cam.look.copy(eye).add(this._v.set(Math.sin(B.h), 0, Math.cos(B.h)).multiplyScalar(10));
      fovBase = view === 'fp' ? 74 : 68;
      speedFov = 0.6;
      shakeMul = view === 'fp' ? 0.25 : 0.4;
    } else if (view === 'cine') {
      // trackside TV camera ahead of the action; slow orbit when (almost) standing still
      const ci = this.cine, fx = Math.sin(P.h), fz = Math.cos(P.h);
      if (Math.abs(P.v) > 6) {
        const dx = P.x - ci.x, dz = P.z - ci.z, dist = Math.hypot(dx, dz), behind = (dx * fx + dz * fz) > 0;
        if (!ci.set || dist > 70 || (behind && dist > 28)) {
          ci.side = -ci.side;
          const ahead = 30 + Math.min(40, Math.abs(P.v) * 0.9), sx = P.x + fx * ahead + fz * 9 * ci.side, sz = P.z + fz * ahead - fx * 9 * ci.side;
          Object.assign(ci, { x: sx, z: sz, y: g.terrain.groundAt(sx, sz) + 2.5 + Math.random() * 3, set: true });
        }
        this.camera.position.set(ci.x, Math.max(ci.y, g.terrain.groundAt(ci.x, ci.z) + 1.5), ci.z);
        cam.look.lerp(this._v.set(P.x, P.y + 1, P.z), damp(dt, 10));
        // zoom to keep the vehicle roughly the same size on screen
        fovOverride = clamp((2 * Math.atan(7 / Math.max(1, Math.hypot(P.x - ci.x, P.z - ci.z))) * 180) / Math.PI, 14, 60);
      } else {
        ci.set = false;
        const a = g.time * 0.25, r = 13 * zoom;
        cam.pos.set(P.x + Math.sin(a) * r, P.y + 4 + Math.sin(g.time * 0.31) * 1.5, P.z + Math.cos(a) * r);
        cam.pos.y = Math.max(cam.pos.y, g.terrain.groundAt(cam.pos.x, cam.pos.z) + 1.2);
        this.camera.position.lerp(cam.pos, damp(dt, 3));
        cam.look.lerp(this._v.set(P.x, P.y + 1.2, P.z), damp(dt, 8));
      }
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(cam.look);
      speedFov = 0;
      shakeMul = 0.3;
    } else {
      const far = view === 'far' ? 1.75 : 1, a = P.h + cam.yaw;
      let dist = (this.riding ? 9 + Math.abs(B.v) * 0.06 - cam.boost * 1.2 : 7) * zoom * far, ht = (this.riding ? 3.8 : 3.2) * zoom * (view === 'far' ? 1.6 : 1);
      if (view === 'top') { dist = 5 * zoom; ht = (34 + Math.abs(B.v) * 0.25) * zoom; }
      cam.pos.set(P.x - Math.sin(a) * dist, P.y + ht, P.z - Math.cos(a) * dist);
      cam.pos.y = Math.max(cam.pos.y, g.terrain.groundAt(cam.pos.x, cam.pos.z) + 1.2);
      this.camera.position.lerp(cam.pos, damp(dt, view === 'top' ? 5 : this.riding ? 7 : 6));
      cam.look.lerp(this._v.set(P.x, P.y + (view === 'top' ? 0 : 1.6), P.z), damp(dt, 12));
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(cam.look);
      if (view === 'top') { speedFov = 0.3; fovBase = 55; }
    }
    if (cam.shake > 0) {
      const k = cam.shake * shakeMul;
      this.camera.position.x += rnd(k);
      this.camera.position.y += rnd(k);
      this.camera.position.z += rnd(k);
      cam.shake = Math.max(0, cam.shake - dt * 1.6);
    }
    cam.fovKick = Math.max(0, cam.fovKick - dt * 12);
    const fovT = fovOverride || fovBase + ((this.riding ? clamp(speedKmh - 40, 0, 140) * 0.11 : 0) + cam.boost * 10 + cam.fovKick) * speedFov;
    this.camera.fov = view === 'cine' && fovOverride ? fovT : lerp(this.camera.fov, fovT, damp(dt, 5));
    const near = attached ? 0.06 : 0.3;
    if (this.camera.near !== near) this.camera.near = near;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    if (!this.engine) this.engine = this.game.audio.createEngineSound(this.def.engine);
    this.engine?.update(dt, {
      speed: Math.abs(B.v), top: this.stats.top, throttle: this.riding && !this.s.dead && (this.ctrl.is('up') || cam.boost > 0.2),
      boost: cam.boost, air: B.air, riding: this.riding && !this.s.dead, offroad: !this.game.terrain.onRoad(B.x, B.z),
      volume: 1 / this.game.players.length,
    });
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
    this.screech?.stop();
    this.hud.dispose();
  }
}

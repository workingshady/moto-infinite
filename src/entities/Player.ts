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
import { ASSIST, BIKE, CONTACT, DRIFT, EV, F1, type TyreCompound, LEVELING, CONTROL, LANDING, PHYS, PLAYER, POWERUPS, ROAD, WALL, WHEELIE, type PowerupKind } from '../config';
import { clamp, damp, lerp, rnd, TAU, wrapPi } from '../utils/math';
import { buildRider, seatRider, type RiderModel } from './models';
import { buildVehicleModel, type VehicleModel } from './vehicleModels';
import { EvDrive, fullBurn } from './EvDrive';
import { sweepSteps, toSpeedHeading } from '../world/collide';
import { arcadeLongitudinal, arcadeTop, driftStep, f1Longitudinal, holdSlide, scrubStep, stepYaw, tyreGrip, tyreWear, wallBounce, yawGoal, type WallOut } from './vehiclePhysics';
import { vehicleById, type VehicleDef } from '../data/vehicles';
import { WEAPONS } from '../data/weapons';
import { MILESTONES, TIERS, UPGRADES, type Card } from '../data/upgrades';
import { Hud } from '../ui/Hud';
import { PlayerChallenges } from '../systems/Challenges';
import { STORY } from '../data/story';
import { prefs, savePrefs } from '../core/prefs';
import { crashFx, godPlay } from '../admin/state';
import { CAM_LABEL, CAM_VIEWS, isCamView, type CamView } from '../core/cameraViews';
import { fmtSpeed, fovOffset, motionScale, settings, shakeScale } from '../core/settings';

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
  /** Electric cars: instant torque, regen, Roadster thrusters (null for everything else). */
  readonly ev: EvDrive | null;

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
    /** Front wing damage 0..1 (a nose-first wall hit): costs WALL.wingDownforce of the downforce until the next stop. */
    wing: 0,
    /** Surface under the car: 0 track, 1 grass / run-off, 2 gravel trap. */
    surface: 0,
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
  readonly race = {
    lap: 0, nextCp: 0, lapStart: 0, lastLap: 0, best: 0, finished: false, finishTime: 0, prog: -1, place: 1,
    /** Thruster lifts (EvDrive.lifts) at the lap start; `lifted` = the last finished lap used flight/hop/kickflip. */
    lapLifts: 0, lifted: false,
  };
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
  /** Wall contact: impact-effect cooldown, recent-contact timer, time spent pinned against a wall. */
  private wallCd = 0;
  private wallTouch = 0;
  private stuckT = 0;
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
  /** Chase-camera pull-back while flying on thrusters (0..1, smoothed). */
  private camFly = 0;
  /** Vehicle bounds in model space (hood camera placement). */
  private dims = new THREE.Box3();

  constructor(readonly game: Game, readonly index: number, readonly ctrl: Controller, readonly name: string, readonly color: number, spawn: Pose, mounted: boolean, vehicle = 'street') {
    this.def = vehicleById(vehicle);
    this.bike = buildVehicleModel(this.def.id, color);
    this.dims.setFromObject(this.bike.root); // still at the origin, unrotated, no rider yet
    this.ev = this.def.ev ? new EvDrive(this) : null;
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
        this.f1.wing = 0;
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
    if (godPlay(g) && !g.opts.attract) { s.nitro = this.stats.nitroMax; s.hp = this.stats.hpMax; } // admin Full Power: endless nitro / N2, full health
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
      const wantN = active && (prefs.nitroToggle ? this.nitroOn : c.is('nitro')) && s.nitro > 1 && !this.ev?.liftKey();
      if (wantN) {
        if (!B.wasN) { if (!this.ev?.thrusters) g.audio.play('nitro'); g.audio.play('whoosh'); this.cam.shake = Math.max(this.cam.shake, 0.25); this.cam.fovKick = 8; }
        s.nitro -= (this.ev?.thrusters ? fullBurn() * (EV.tank.rear + EV.tank.side) : BIKE.nitroBurn) * dt; // Roadster: nitrogen tank
        boosting = true;
      }
      B.wasN = wantN;
      if (B.pad > 0) boosting = true;
      const F = this.def.f1;
      if (F) this.f1Step(dt, active && c.is('trick'), down);
      const top = arcadeTop(st.top, boosting, onRoad, this.def.offroad);
      if (!B.air) {
        // mid-wheelie the throttle stays on (holding C = gas) and ↓ only lowers the front instead of braking
        const inWheelie = B.wheelie > WHEELIE.active;
        const gas = up || (inWheelie && active && c.is('trick'));
        if (F) this.f1Longitudinal(dt, gas || boosting, down, boosting, onRoad);
        else {
          // shared with the computer racers (entities/vehiclePhysics.ts)
          B.v = arcadeLongitudinal(B.v, st.accel, top, this.def.offroad, gas, up ? c.throttle : 1, boosting, down && !inWheelie, down, c.brake, onRoad, dt);
        }
        if (g.env.grip < 1 && Math.abs(B.steer) > 0.6 && Math.abs(B.v) > 20) B.v *= 1 - (1 - g.env.grip) * dt; // wet roads scrub speed in corners
        B.v = Math.max(B.v, -BIKE.maxReverse);
        // steering eases in and re-centres smoothly instead of snapping
        const want = c.steer(left, right);
        B.steer = lerp(B.steer, want, damp(dt, want ? CONTROL.steerIn : CONTROL.steerOut));
        const handbrake = active && c.is('drift') && Math.abs(B.v) > 6;
        const wheelie = this.updateWheelie(dt, active && c.is('trick'), up, down);
        // yaw with inertia: the yaw rate eases toward what the steering asks for (heavier cars respond slower)
        // F1: the cornering limit (lateral g) grows with downforce ~ v², so yaw rate is capped at aLat / v (shared physics)
        stepYaw(B, yawGoal(this.def, B.steer, st.grip, g.env.grip, B.v, boosting, handbrake, wheelie, this.f1, onRoad), this.isCar, dt);
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
        driftStep(B, this.def, this.isCar, g.env.grip, this.f1.gripMul, slip, handbrake, up, down, boosting, dt);
        // angle limit: assist holds the slide, on Pro you spin out past the limit
        const hold = DRIFT.holdAngle[prefs.assist] ?? DRIFT.holdAngle[1], sl = wrapPi(B.h - B.moveH);
        if (Math.abs(sl) > DRIFT.spinAngle && prefs.assist === 0 && Math.abs(B.v) > 10) this.spinOut();
        else holdSlide(B, hold, dt);
        scrubStep(B, slip, handbrake, up || boosting, dt); // sideways = slower, power holds speed
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
          const want = c.steer(left, right);
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
      B.lean = lerp(B.lean, this.isCar ? 0 : 0.22, damp(dt, 4)); // parked: bikes rest on the kickstand, cars sit level
      B.wasN = false;
    }
    if (this.ev) this.ev.step(dt, active, up, down, boosting, B.wasN);
    // F1: ERS harvests energy under braking; everything else regenerates nitro over time
    const regen = this.def.f1 ? (down && Math.abs(B.v) > 10 ? F1.ersRegen : F1.ersIdle) : this.ev?.thrusters && (B.air || this.ev.thrust > 0) ? 0 : st.nitroRegen;
    s.nitro = clamp(s.nitro + regen * dt, 0, st.nitroMax);
    if (Math.abs(B.v) < 0.03) B.v = 0;
    B.pad = Math.max(0, B.pad - dt);
    this.cam.boost = lerp(this.cam.boost, boosting && this.riding ? 1 : 0, damp(dt, 6));

    // crosswind gusts nudge the heading sideways (a = push * sideways share of the wind; turn rate = a / v)
    const E = g.env;
    if (!B.air && E.windPush > 0.05 && Math.abs(B.v) > 3) B.moveH += (E.windPush * Math.sin(E.windDir - B.moveH) / Math.max(12, Math.abs(B.v))) * Math.sign(B.v) * dt;

    // horizontal move + collisions
    if (!Number.isFinite(B.v) || !Number.isFinite(B.moveH) || !Number.isFinite(B.h)) { B.v = 0; B.moveH = B.h = Number.isFinite(B.h) ? B.h : 0; }
    this.wallCd = Math.max(0, this.wallCd - dt);
    this.wallTouch = Math.max(0, this.wallTouch - dt);
    if (B.v !== 0 || this.probeHit(B.x, B.z, B.h) === 'tree') this.move(dt, down);
    if (this.riding) this.wallRecover(dt);
    if (T.walls.length && !B.air) this.onDemoWall(dt);
    // vertical
    const gy = T.groundAt(B.x, B.z);
    B.vy -= PHYS.gravity * dt;
    B.y += B.vy * dt;
    if (B.y <= gy) {
      const wasAir = B.air, impactVy = B.vy;
      B.y = gy;
      B.vy = clamp((gy - B.lastG) / dt, -40, this.ev?.glued ? EV.stick.crest : B.fromRamp || T.onRamp(B.x, B.z) ? 22 : (ASSIST[prefs.assist] ?? ASSIST[1]).crest);
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
    if (boost > 0.1 && !this.ev) {
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
    const extras = [fast ? `avg ${fmtSpeed((dist / t) * 3.6)}` : '', perfect > 0.5 ? `PERFECT BALANCE ${perfect.toFixed(1)}s` : ''].filter(Boolean).join(' · ');
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
    let close = g.chunks.solidAt(B.x, B.z, r, -1e9);
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

  /** Wall/barrier probe radius and the nose/tail probe offset for this vehicle (see WALL.radius / WALL.nose). */
  private get wallShape() {
    const k = this.def.f1 ? 'f1' : this.isCar ? 'car' : 'bike';
    this._ws.r = WALL.radius[k];
    this._ws.nose = WALL.nose[k];
    return this._ws;
  }
  private readonly _ws = { r: 1, nose: 0 };
  private stepH = 1.3;
  /** Which probe touched last: +1 nose, 0 centre, -1 tail. */
  private probeSide = 0;

  /**
   * Is the vehicle blocked at (x, z) facing h? Terrain (water, cliffs) is checked at the centre; obstacles with the
   * body's probes: one circle for bikes, nose + centre + tail circles for cars (so a head-on hit stops the nose at the
   * wall instead of letting the bonnet sink in). Remembers which probe touched in `probeSide`.
   */
  private probeHit(x: number, z: number, h: number): false | 'water' | 'wall' | 'tree' {
    const g = this.game, { r, nose } = this.wallShape, y = this.B.y;
    const gy = g.terrain.groundAt(x, z);
    this.probeSide = 0;
    if (gy < 0.2) return 'water';
    if (gy - y > this.stepH) return 'wall';
    if (g.chunks.solidAt(x, z, r, y)) return 'tree';
    if (nose > 0) {
      const fx = Math.sin(h) * nose, fz = Math.cos(h) * nose;
      if (g.chunks.solidAt(x + fx, z + fz, r, y)) { this.probeSide = 1; return 'tree'; }
      if (g.chunks.solidAt(x - fx, z - fz, r, y)) { this.probeSide = -1; return 'tree'; }
    }
    return false;
  }

  /**
   * Horizontal move for one physics step with a swept collision check: the path is tested in sub-steps no longer
   * than half the probe radius, so even an F1 car at 90 m/s (1.5 m per step) can't skip through a thin barrier. The
   * vehicle stops at the last free sub-step and `hitWall` takes over for the rest of the step.
   */
  private move(dt: number, braking: boolean) {
    const B = this.B, g = this.game;
    this.stepH = B.air ? 99 : this.ev?.glued ? EV.stick.maxStep : 1.3;
    // already overlapping a barrier (respawn, shoved by another car): ease out along the contact normal first
    if (this.probeHit(B.x, B.z, B.h) === 'tree' && !this.depenetrate()) {
      B.x += Math.sin(B.moveH) * B.v * dt; // still stuck after the push: let it move so it can never lock up
      B.z += Math.cos(B.moveH) * B.v * dt;
      return;
    }
    if (B.v === 0) return;
    const dx = Math.sin(B.moveH) * B.v * dt, dz = Math.cos(B.moveH) * B.v * dt;
    const n = sweepSteps(Math.hypot(dx, dz), this.wallShape.r);
    let fx = B.x, fz = B.z;
    for (let k = 1; k <= n; k++) {
      const px = B.x + (dx * k) / n, pz = B.z + (dz * k) / n, kind = this.probeHit(px, pz, B.h);
      if (kind) {
        this.addDist(Math.hypot(fx - B.x, fz - B.z), braking);
        B.x = fx; B.z = fz;
        this.hitWall(kind, px, pz, dt * (1 - (k - 1) / n));
        return;
      }
      fx = px; fz = pz;
    }
    const e = g.entities.hitTest(fx, B.y, fz, this.isCar ? 1.4 : 0.9);
    if (e) {
      if (e.type === 'cone') { g.entities.destroy(e, this); B.v *= 0.97; }
      else if (e.type === 'barrel') g.entities.destroy(e, this);
      else if (e.type === 'crate') {
        if (Math.abs(B.v) > 16) { g.entities.destroy(e, this); B.v *= 0.8; this.cam.shake = Math.max(this.cam.shake, 0.2); }
        else { B.v *= -0.3; g.audio.play('thud'); }
      }
      return;
    }
    this.addDist(Math.hypot(fx - B.x, fz - B.z), braking);
    B.x = fx;
    B.z = fz;
  }

  /**
   * Vehicle contact result (systems/Contacts): velocity change, position correction (never into a wall) and a yaw kick.
   * The travel direction stays on the heading's side, so a shunt from behind pushes you forward, not into "reverse".
   */
  applyContact(dvx: number, dvz: number, px: number, pz: number, spin: number) {
    const B = this.B;
    if (px || pz) {
      if (!this.probeHit(B.x + px, B.z + pz, B.h)) { B.x += px; B.z += pz; }
      else if (!this.probeHit(B.x + px * 0.5, B.z + pz * 0.5, B.h)) { B.x += px * 0.5; B.z += pz * 0.5; }
    }
    if (dvx || dvz) {
      const r = toSpeedHeading(Math.sin(B.moveH) * B.v + dvx, Math.cos(B.moveH) * B.v + dvz, B.h, B.moveH, this._sh);
      B.v = r.v;
      B.moveH = r.moveH;
    }
    if (spin) { B.yawV += spin; B.h += spin * CONTACT.heading; }
    this.syncP();
  }

  /** Distance stats, F1 tyre wear and the distance challenge for a move of d metres. */
  private addDist(d: number, braking: boolean) {
    if (!this.riding || d <= 0) return;
    const B = this.B;
    this.s.dist += d;
    // tyre wear: distance, plus extra when sliding or braking hard
    if (this.def.f1) this.f1.wear = tyreWear(this.f1.wear, this.f1.compound, d, Math.abs(wrapPi(B.h - B.moveH)), braking);
    this.game.events.emit('progress', { player: this, id: 'dist', value: d });
  }

  /** Push the vehicle out of any barrier it overlaps (a few small steps along the contact normal). True when free. */
  private depenetrate(px0 = 0, pz0 = 0) {
    const B = this.B, g = this.game, { r, nose } = this.wallShape;
    for (let it = 0; it < 4; it++) {
      if (this.probeHit(B.x, B.z, B.h) !== 'tree') return true;
      const o = this.probeSide * nose, px = B.x + Math.sin(B.h) * o, pz = B.z + Math.cos(B.h) * o, back = Math.sign(B.v || 1);
      const n = g.chunks.contact(px, pz, r, B.y, 'tree', -Math.sin(B.moveH) * back, -Math.cos(B.moveH) * back);
      // a probe that ended up past a thin wall's centre line would be pushed out the far side: keep to the side we came from
      let nx = n.x, nz = n.z;
      if ((px0 || pz0) && nx * px0 + nz * pz0 < 0) { nx = px0; nz = pz0; }
      const push = Math.min(Math.max(n.depth, 0.02) + 0.01, WALL.maxPush);
      B.x += nx * push;
      B.z += nz * push;
    }
    return this.probeHit(B.x, B.z, B.h) !== 'tree';
  }

  /**
   * Contact with a wall, barrier, tree, cliff or shoreline at the proposed spot (nx, nz). Removes the into-wall part
   * of the velocity (with a small rebound capped at a few m/s), keeps the speed along the wall minus Coulomb friction,
   * swings the heading toward the wall's line a limited amount and slides along it for the rest of the step. Head-on
   * hits stop hard and cost health in proportion to the into-wall speed; F1 noses lose their front wing. Damage, sound
   * and particles are rate-limited so scraping a barrier does not fire them every physics step.
   */
  private hitWall(kind: 'water' | 'wall' | 'tree', nx: number, nz: number, dtLeft: number) {
    const B = this.B, g = this.game, A = this.assist, { r, nose } = this.wallShape;
    const side = kind === 'tree' ? this.probeSide : 0, o = side * nose;
    const mx = Math.sin(B.moveH) * B.v, mz = Math.cos(B.moveH) * B.v, spd = Math.hypot(mx, mz);
    const cpx = nx + Math.sin(B.h) * o, cpz = nz + Math.cos(B.h) * o;
    const n = g.chunks.contact(cpx, cpz, r, B.y, kind, -mx, -mz);
    const nX = n.x, nZ = n.z;
    // shared wall response (entities/vehiclePhysics.ts): remove the into-wall speed (capped rebound), keep the scrape
    const w = wallBounce(mx, mz, nX, nZ, A.glance, LANDING.wallDamageSpeed, this.wallOut), vn = w.vn, vx = w.vx, vz = w.vz;
    if (vn < 0) {
      const hard = w.hard;
      if (hard || -vn > 6) this.failDrift();
      // F1: a nose-first hit at speed breaks the front wing (less downforce until the next pit stop)
      if (this.def.f1 && side >= 0 && -vn > WALL.wingSpeed && -vn > spd * WALL.wingAngle && this.f1.wing < 1) {
        this.f1.wing = 1;
        this.hud.banner('FRONT WING DAMAGE', 'Less grip in fast corners: box for a new nose', '#ff9a3d');
        g.fx.burst(cpx, B.y + 0.4, cpz, { n: 14, speed: 9, life: 1.1, size: [0.35, 0.15], colors: [0x1d1d1f, 0xd8322a, 0xf4f4f4], gravity: 12, drag: 0.8 });
      }
      if (this.wallCd <= 0 && -vn > 4) {
        this.wallCd = WALL.fxCooldown;
        if (hard) {
          this.cam.shake = Math.max(this.cam.shake, clamp(-vn / 40, 0.45, 0.9));
          g.audio.play('crash');
          if (this.isCar) g.audio.play('clank');
          this.hurt(Math.max(0, -vn - WALL.damageMin) * WALL.damage * (1 - this.stats.crashArmor) * A.crash, undefined, true);
          g.fx.burst(cpx, B.y + 1, cpz, { n: 20, speed: 6, life: 0.8, size: [1, 3], colors: [0x9a8a70], gravity: -1, drag: 2, smoke: true, alpha: 0.6 });
          if (kind === 'tree') g.fx.burst(cpx, B.y + 0.5, cpz, { n: 18, speed: 8, life: 0.5, size: [0.35, 0.08], colors: [0xffd27a, 0xffffff, 0xff9a3d], gravity: 9, drag: 1.2 });
        } else {
          this.cam.shake = Math.max(this.cam.shake, 0.15);
          g.audio.play('thud');
          // scraping a barrier: sparks along the wall
          g.fx.burst(cpx, B.y + 0.5, cpz, { n: 8, speed: 5, life: 0.4, size: [0.3, 0.06], colors: [0xffd27a, 0xffffff], gravity: 9, drag: 1.5 });
        }
      }
    }
    // back to a signed speed along a travel direction that stays on the heading's side (no 180° "slide" after a rebound)
    const res = toSpeedHeading(vx, vz, B.h, B.moveH, this._sh);
    const sp = Math.min(Math.abs(res.v), spd);
    if (sp > 0.05) {
      B.moveH = res.moveH;
      B.v = Math.sign(res.v) * sp;
      // the nose swings toward the wall's line, a limited amount per impact
      const gap = wrapPi(B.moveH - B.h);
      if (Math.abs(gap) < Math.PI / 2 && vn < 0) {
        const h0 = B.h;
        B.h += clamp(gap * WALL.align, -WALL.maxSpin, WALL.maxSpin);
        if (kind === 'tree' && this.probeHit(B.x, B.z, B.h)) B.h = h0; // never swing the nose or tail into the wall
        B.yawV *= 0.3;
      }
    } else B.v = 0;
    this.wallTouch = 0.25;
    // slide along the wall for the rest of the step if there's room (swept, so the slide can't tunnel either)
    const sx = Math.sin(B.moveH) * B.v * dtLeft, sz = Math.cos(B.moveH) * B.v * dtLeft;
    if (B.v !== 0) {
      const f = g.chunks.sweep(B.x, B.z, B.x + sx, B.z + sz, r, B.y, this.stepH);
      const k = f < 0 ? 1 : Math.max(0, f - 1 / sweepSteps(Math.hypot(sx, sz), r));
      if (k > 0 && !this.probeHit(B.x + sx * k, B.z + sz * k, B.h)) { B.x += sx * k; B.z += sz * k; }
    }
    if (kind === 'tree') this.depenetrate(nX, nZ);
  }
  private readonly _sh = { v: 0, moveH: 0 };
  private readonly wallOut: WallOut = { vx: 0, vz: 0, vn: 0, hard: false };

  /**
   * Auto-recovery: pinned against a wall (barely moving or reversing) for a couple of seconds, the car turns back to the
   * road direction on its own instead of grinding there until the player respawns.
   */
  private wallRecover(dt: number) {
    const B = this.B, g = this.game;
    const pinned = this.wallTouch > 0 && (Math.abs(B.v) < WALL.stuckSpeed || B.v < 0);
    this.stuckT = pinned ? this.stuckT + dt : Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT < WALL.stuckTime || B.air) return;
    const road = g.layout.nearestRoad(B.x, B.z);
    let target = road.h;
    // circuits have a race direction; open-world roads run both ways, so take the one we're closer to facing
    if (g.layout.kind === 'grid' && Math.abs(wrapPi(target - B.h)) > Math.PI / 2) target += Math.PI;
    const err = wrapPi(target - B.h), step = clamp(err, -WALL.realignRate * dt, WALL.realignRate * dt);
    B.h += step;
    B.moveH = B.h;
    B.yawV = 0;
    if (B.v < 0) B.v = Math.min(0, B.v + 20 * dt);
    // drift off the wall toward the road centre while turning
    const dx = road.x - B.x, dz = road.z - B.z, dl = Math.hypot(dx, dz);
    if (dl > 0.5) {
      const px = B.x + (dx / dl) * 2 * dt, pz = B.z + (dz / dl) * 2 * dt;
      if (!this.probeHit(px, pz, B.h)) { B.x = px; B.z = pz; }
    }
    if (Math.abs(err) < 0.05) this.stuckT = 0;
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

  /**
   * Thruster demo wall: the body banks with the cross-slope, and past EV.stick.free radians of bank the car slides back
   * down unless the Roadster's thrusters glue it to the face.
   */
  private onDemoWall(dt: number) {
    const B = this.B, g = this.game, T = g.terrain;
    if (T.wallHeight(B.x, B.z) <= 0.02) return;
    const d = 0.8, gx = (T.groundAt(B.x + d, B.z) - T.groundAt(B.x - d, B.z)) / (2 * d), gz = (T.groundAt(B.x, B.z + d) - T.groundAt(B.x, B.z - d)) / (2 * d);
    const grad = Math.hypot(gx, gz), ang = Math.atan(grad);
    if (grad < 1e-3) return;
    // bank: cross-slope relative to the heading (ground rising to the right = right side up = positive lean)
    const rx = Math.cos(B.h), rz = -Math.sin(B.h), cross = Math.atan(gx * rx + gz * rz);
    if (!this.ev?.kicking) B.lean = lerp(B.lean, cross, damp(dt, 10));
    if (this.ev?.glued || ang <= EV.stick.free) return;
    const k = EV.stick.slide * (ang - EV.stick.free) * dt, px = B.x - (gx / grad) * k, pz = B.z - (gz / grad) * k;
    if (!g.chunks.blocked(px, pz, this.isCar ? 1.5 : 1, B.y, 99)) { B.x = px; B.z = pz; }
    B.v *= 1 - 0.5 * dt;
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
    const ev = this.ev?.onLand(air); // Roadster: kickflips, hard touchdowns after a flight
    if (this.riding && ev?.crash) {
      this.crash(ev.crash);
    } else if (this.riding && posing && air > LANDING.minAir) {
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
      for (const [name, p] of ev?.tricks ?? []) { tricks.unshift(name); pts += p; }
      // a powered thruster flight is not a jump: no BIG AIR / airtime challenge credit (it feeds bestFlight instead)
      if (air > 0.9 && !ev?.flew) { tricks.push('BIG AIR ' + air.toFixed(1) + 's'); pts += Math.round(air * 80); }
      if (Math.abs(pErr) < 0.15 && tricks.length) { tricks.push('PERFECT'); pts += 100; }
      if (!ev?.flew) g.events.emit('progress', { player: this, id: 'air', value: air });
      if (tricks.length) {
        const s = this.s;
        s.combo = s.comboT > 0 ? s.combo + 1 : 1;
        s.comboT = PLAYER.comboWindow;
        s.bestCombo = Math.max(s.bestCombo, s.combo);
        g.events.emit('progress', { player: this, id: 'combo', value: s.combo });
        pts = Math.round(pts * s.combo * this.stats.trickMul);
        g.audio.play('trick');
        this.hud.banner(tricks.join(' + '), `+${Math.round(pts * this.stats.xpMul * (this.buffs.xp2 > 0 ? 2 : 1))} XP${s.combo > 1 ? ` · COMBO x${s.combo}` : ''}`, flips || ev?.tricks.length ? '#ff7ad9' : '#ffd23f');
        this.addXP(pts);
        g.replay?.mark(this, 'trick', tricks[0], pts);
        if (!this.ev?.thrusters) s.nitro = Math.min(this.stats.nitroMax, s.nitro + 20 * tricks.length * this.stats.trickMul); // tricks don't refill a gas tank
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

  /**
   * Real longitudinal dynamics: drive = min(power/v, traction), minus aero drag ½ρ·CdA·v² and rolling resistance.
   * Braking = μ·g·(1 + downforce ratio) so F1 cars brake harder from high speed. ERS adds electric power that fades
   * at very high speed; top speed is simply where power meets drag.
   */
  private f1Longitudinal(dt: number, gas: boolean, brake: boolean, ers: boolean, onRoad: boolean) {
    const B = this.B;
    B.v = f1Longitudinal(B.v, this.def.f1!, this.f1, this.game.env.grip, dt, gas, brake, ers, onRoad);
  }

  /** F1 per-step: tyre grip, straight-mode wing (DRS), slipstream, pit limiter and pit stops. */
  private f1Step(dt: number, wingKey: boolean, braking: boolean) {
    const f = this.f1, B = this.B, g = this.game, lay = g.layout as unknown as { runoff?(x: number, z: number): number; inDrs?(i: number): boolean; isPit?(x: number, z: number): boolean; nearest?(x: number, z: number, e?: boolean): { i: number } };
    f.surface = lay.runoff ? lay.runoff(B.x, B.z) : g.terrain.onRoad(B.x, B.z) ? 0 : 1;
    f.gripMul = tyreGrip(f.compound, f.wear);
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
      if (f.stillT > 0.4 && f.pitT <= 0 && (f.wear > 0.05 || f.wing > 0)) {
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
        f.wing = 0; // new nose
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

  /** Throw the rider off / spin the car out (bad landing, loop-out, hit by another vehicle). */
  crash(reason: string) {
    const B = this.B, g = this.game;
    if (godPlay(g) && !crashFx()) return; // admin Full Power with crash effects off: ride on
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
    Object.assign(B, { x: r.x, z: r.z, h: r.h, moveH: r.h, v: 0, vy: 0, pitch: 0, pitchV: 0, flipAcc: 0, spinAcc: 0, airT: 0, air: false, steer: 0, yawV: 0, lean: 0, wheelie: 0, wheelieV: 0, wheelieT: 0, flick: 0 });
    B.y = B.lastG = this.game.terrain.groundAt(B.x, B.z);
    this.stuckT = this.wallTouch = 0;
    this.ev?.reset();
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
    if (s.dead || n <= 0 || godPlay(g)) return; // admin Full Power: no damage, no wrecks
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
    n = Math.round(n * this.stats.xpMul * (this.buffs.xp2 > 0 ? 2 : 1) * (godPlay(this.game) ? 5 : 1)); // Full Power: fast in-run levels
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

  /** Chase camera: a wall, fence or building between the vehicle and the camera pulls the camera in front of it. */
  private unclip(P: { x: number; y: number; z: number }, pos: THREE.Vector3) {
    const dx = pos.x - P.x, dz = pos.z - P.z, y0 = P.y + 1.6, dy = pos.y - y0, L = Math.hypot(dx, dz);
    if (L < 2.5) return;
    const n = Math.ceil(L / 0.5), ch = this.game.chunks;
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      if (!ch.solidAt(P.x + dx * f, P.z + dz * f, 0.3, y0 + dy * f)) continue;
      const fb = Math.max((k - 1) / n, 2.5 / L);
      pos.set(P.x + dx * fb, Math.max(y0 + dy * fb, y0 + 1), P.z + dz * fb);
      return;
    }
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
      const far = view === 'far' ? 1.75 : 1, a = P.h + cam.yaw, cd = settings.camDist, ch = settings.camHeight; // Settings → Camera
      let dist = (this.riding ? 9 + Math.abs(B.v) * 0.06 - cam.boost * 1.2 : 7) * zoom * far * cd, ht = (this.riding ? 3.8 : 3.2) * zoom * (view === 'far' ? 1.6 : 1) * ch;
      const fly = this.riding && this.ev?.flying ? clamp(this.ev.alt / 12, 0.35, 1) : 0; // thruster flight: pull back a little
      this.camFly = lerp(this.camFly, fly, damp(dt, 2));
      dist += EV.flight.camBack * this.camFly * zoom;
      ht += EV.flight.camUp * this.camFly * zoom;
      if (view === 'top') { dist = 5 * zoom; ht = (34 + Math.abs(B.v) * 0.25) * zoom * cd; }
      cam.pos.set(P.x - Math.sin(a) * dist, P.y + ht, P.z - Math.cos(a) * dist);
      cam.pos.y = Math.max(cam.pos.y, g.terrain.groundAt(cam.pos.x, cam.pos.z) + 1.2);
      if (view !== 'top') this.unclip(P, cam.pos);
      this.camera.position.lerp(cam.pos, damp(dt, view === 'top' ? 5 : this.riding ? 7 : 6));
      cam.look.lerp(this._v.set(P.x, P.y + (view === 'top' ? 0 : 1.6), P.z), damp(dt, 12));
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(cam.look);
      if (view === 'top') { speedFov = 0.3; fovBase = 55; }
    }
    fovBase += fovOffset(); speedFov *= motionScale(); shakeMul *= shakeScale(); // Settings: FOV, reduced motion, shake
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
      volume: this.game.paused ? 0 : 1 / this.game.players.length, // pause menu: engine fades out instead of droning on
    });
    if (this.game.paused) this.screech?.set(1200, 0, 0); // physics doesn't run while paused, so silence the tyres here
  }

  netState(): NetState {
    const B = this.B, W = this.W, r = (v: number) => Math.round(v * 100) / 100;
    return {
      bx: r(B.x), by: r(B.y), bz: r(B.z), bh: r(B.h), bp: r(B.pitch), bl: r(B.lean),
      wx: r(W.x), wy: r(W.y), wz: r(W.z), wh: r(W.h),
      v: r(B.v), riding: this.riding, boost: r(this.cam.boost), dead: this.s.dead, score: this.s.score,
      lap: this.race.lap, prog: r(this.race.prog * 1000) / 1000,
      ...(this.ev && this.ev.thrust > 0.05 ? { th: Math.round(this.ev.thrust * 10) / 10 } : {}), // Roadster plumes (omitted when off)
    };
  }

  dispose() {
    this.engine?.stop();
    this.screech?.stop();
    this.ev?.dispose();
    this.hud.dispose();
  }
}

// Electric drivetrain effects for cars with an `ev` spec (data/vehicles.ts): instant-torque launch that fades
// with speed, lift-off regenerative braking that refills the boost meter, Track Mode rear-biased rotation, and
// the Tesla Roadster's cold-gas "SpaceX package" thrusters. For the Roadster the boost meter is the NITROGEN TANK
// (EV.tank: one fill = ~5 s of every thruster at full output) and the thrusters do:
//  - ground boost: rear push, retro-thrust braking, side-thruster grip (as before)
//  - flight: hold the lift key (hover) to lift off; a climb-rate controller holds +climb while held and a gentle
//    descent when released, ↑/↓ push forward/back, ←/→ yaw; empty tank = no thrust, the car falls
//  - kickflip: trick key in the air (or from the ground with a hop) = side-thruster 360° barrel roll
//  - down-force glue: lift key on a steep bank/wall (or boost) presses the car into it: climbs steep faces, sticks
//    over crests. The world is a heightfield, so there is no true upside-down driving (see EV.stick)
// White gas plumes come from the pooled particle system, plus ground dust under a low hover and a hiss loop.
// Called once per physics step from Player.updateBike, after the generic handling and before position integration.
import type { Engine } from '../core/Audio';
import type { EvSpec } from '../data/vehicles';
import type { Player } from './Player';
import { BIKE, EV, LANDING, PHYS } from '../config';
import { clamp, damp, lerp, rnd, TAU, wrapPi } from '../utils/math';

/** Tank units per second with every thruster at full output (one fill = EV.tank.fullSecs). */
export const fullBurn = () => BIKE.nitroMax / EV.tank.fullSecs;

export class EvDrive {
  readonly spec: EvSpec;
  readonly thrusters: boolean;
  /** Thruster flight engaged (lifted off with the lift key, until touchdown). */
  flying = false;
  /** Down-force glue active this step (steep faces, crests). */
  glued = false;
  /** 0..1 share of full thruster output this step (sound, rumble, online plume flag). */
  thrust = 0;
  /** Metres above the ground while airborne. */
  alt = 0;
  /** Seconds of the current flight. */
  flightT = 0;
  /** Counts every thruster lift (flight, hop, kickflip): Time Attack / leaderboards skip laps where it changed. */
  lifts = 0;
  private hiss: Engine | null = null;
  private hissLevel = 0;
  private hopCd = 0;
  private hoverT = 0;
  private lastLift = -9;
  private liftHeld = 0;
  private clock = 0;
  private flew = false;
  private kickT = 0;
  private kickDir = 1;
  private kicks = 0;
  private lift = 0;
  private push = 0;
  private side = 0;

  constructor(private p: Player) {
    this.spec = p.def.ev!;
    this.thrusters = !!this.spec.thrusters;
    // no exhaust on an EV: the generic nitro flame cone stays hidden
    p.bike.flame.visible = false;
  }

  /** Lift key held (thruster cars only; the generic nitro is ignored while it is). */
  liftKey() {
    return this.thrusters && this.p.ctrl.is('hover');
  }

  /** Mid-kickflip: the body roll belongs to the trick. */
  get kicking() {
    return this.kickT > 0;
  }

  /**
   * One physics step. `gas`/`down` are the driver's inputs, `boosting` the generic boost state (nitro or pad),
   * `thrusting` = boost button held with meter left (Roadster: rear thrusters firing).
   */
  step(dt: number, active: boolean, gas: boolean, down: boolean, boosting: boolean, thrusting: boolean) {
    const p = this.p, B = p.B, s = p.s, st = p.stats, sp = this.spec;
    this.clock += dt;
    this.hopCd = Math.max(0, this.hopCd - dt);
    const fwd = B.v >= 0;
    if (!p.riding || s.dead) {
      this.hoverT = this.kickT = 0;
      this.flying = this.glued = false;
      this.thrust = 0;
      this.setHiss(0);
      return;
    }
    if (!B.air) {
      // instant torque: strongest from standstill, fading out by `taper` x top speed
      const top = st.top * (boosting ? BIKE.nitroTopMul : 1);
      if (gas && fwd && B.v < top) {
        const fade = clamp(1 - B.v / Math.max(1, st.top * sp.taper), 0, 1);
        B.v = Math.min(top, B.v + st.accel * (sp.launch - 1) * fade * dt);
      }
      // regenerative braking: lifting off slows the car more than coasting and feeds the boost meter / tank
      if (!gas && !boosting && B.v > EV.regenMinSpeed) {
        if (!down) B.v -= sp.regen * dt;
        s.nitro += sp.regenCharge * (down ? EV.brakeCharge : 1) * dt;
      }
      // Track Mode: rear-biased torque rotates the car on throttle mid-corner
      if (sp.rearBias && gas && !boosting && Math.abs(B.steer) > 0.4 && B.v > EV.rearBiasMinSpeed) B.h += B.steer * sp.rearBias * dt;
    }
    if (this.thrusters) this.thrusterStep(dt, active, gas, down, thrusting && active);
    else this.setHiss(0);
  }

  private thrusterStep(dt: number, active: boolean, gas: boolean, down: boolean, firing: boolean) {
    const p = this.p, B = p.B, s = p.s, st = p.stats, g = p.game, T = EV.thrust, F = EV.flight, c = p.ctrl;
    const gy = g.terrain.groundAt(B.x, B.z);
    this.alt = Math.max(0, B.y - gy);
    this.lift = this.push = this.side = 0;
    const hasGas = s.nitro > 0.5, liftKey = active && c.is('hover');
    this.liftHeld = liftKey ? this.liftHeld + dt : 0;
    const braking = firing && down && !gas && B.v > 2;

    // ---- ground: rear boost, retro brake, side grip (unchanged), down-force glue on steep faces
    // (moving only: standing on a slope the lift key still lifts off)
    const steep = !B.air && Math.abs(B.v) > 4 && this.slope() > EV.stick.steep;
    this.glued = !B.air && hasGas && ((liftKey && steep) || firing);
    if (firing && !B.air) {
      if (braking) B.v = Math.max(0, B.v - (st.accel * BIKE.nitroAccelMul + T.brake) * dt);
      else B.v += T.accel * dt;
      if (Math.abs(B.steer) > 0.2 && Math.abs(B.v) > 6) {
        B.moveH += wrapPi(B.h - B.moveH) * Math.min(1, dt * T.grip);
        B.h += B.steer * T.yaw * Math.sign(B.v) * dt;
      }
      this.push = 1;
      this.side = Math.abs(B.steer) > 0.2 ? 1 : 0;
    }
    if (this.glued && liftKey && !firing) this.lift = EV.stick.burn;

    // ---- hop (double tap of the lift key) and kickflip (trick key)
    // (several physics steps can share one frame's key press: ignore repeats closer than 60 ms)
    if (active && c.hit('hover') && this.clock - this.lastLift > 0.06) {
      if (this.clock - this.lastLift < EV.hop.doubleTap && !B.air && !steep) this.hop(EV.hop.vy, 'HOVER HOP', EV.hop.cost);
      this.lastLift = this.clock;
    }
    if (active && c.hit('trick') && !this.kicking) this.startKick(steep);
    if (this.kicking) this.kickStep(dt);

    // ---- flight
    if (liftKey && !steep && this.liftHeld >= F.holdDelay && s.nitro > EV.tank.min && !this.flying) {
      this.flying = this.flew = true;
      this.flightT = 0;
      this.lifts++;
      B.vy = Math.max(B.vy, F.liftoffVy);
      p.cam.shake = Math.max(p.cam.shake, 0.25);
      g.audio.noise(0.5, 0.25, 5200, 'highpass');
      if (!B.air) p.hud.banner('LIFT-OFF', 'Hold to climb · ↑↓ push · ←→ yaw · release = slow descent', '#dff4ff');
    }
    if (this.flying) this.fly(dt, liftKey, gas, down, hasGas);

    // hop / kickflip float: reduced gravity for a moment
    this.hoverT = Math.max(0, this.hoverT - dt);
    if (this.hoverT > 0 && B.air && !this.flying) {
      B.vy += PHYS.gravity * EV.hop.lift * dt;
      this.lift = Math.max(this.lift, EV.hop.lift / F.lift);
    }

    // ---- tank, sound, plumes
    const E = EV.tank;
    this.thrust = clamp(this.lift * E.lift + this.push * E.rear + this.side * E.side, 0, 1);
    // ground boost burns the meter in Player (rear + side share); everything else burns here
    const burnHere = clamp(this.lift * E.lift + (B.air || !firing ? this.push * E.rear + this.side * E.side : 0), 0, 1);
    if (burnHere > 0) s.nitro = Math.max(0, s.nitro - burnHere * fullBurn() * dt);
    this.setHiss(this.thrust * (braking ? 1.1 : 1));
    if (this.thrust > 0.02) this.plumes(braking, firing);
  }

  /** Thruster flight: lift controller, push/retro, yaw, drag, attitude. */
  private fly(dt: number, liftKey: boolean, gas: boolean, down: boolean, hasGas: boolean) {
    const p = this.p, B = p.B, F = EV.flight, c = p.ctrl;
    this.flightT += dt;
    if (!B.air && this.flightT > 0.4) { this.flying = this.flew = false; return; } // touched down without a proper landing (crest, ramp)
    if (hasGas) {
      // climb-rate controller: hold = climb (fading under the ceiling), release = gentle descent
      const target = liftKey ? F.climb * clamp((F.ceiling - this.alt) / 8, -0.5, 1) : -F.descent;
      const aMax = F.lift * PHYS.gravity, a = clamp(PHYS.gravity + (target - B.vy) * F.response * (target < B.vy && !liftKey ? 0.6 : 1), 0, aMax);
      B.vy += a * dt;
      this.lift = a / aMax;
      // forward / back thrust (rear / front nozzles) and air drag
      const pushIn = gas ? c.throttle : 0, backIn = down ? c.brake : 0;
      if (pushIn) { B.v += F.push * pushIn * dt; this.push = pushIn; }
      if (backIn) { B.v = Math.max(-F.maxBack, B.v - F.retro * backIn * dt); this.push = Math.max(this.push, backIn * 0.8); }
      // side / front nozzles yaw the car; the velocity swings toward the nose (thrust vectoring)
      if (Math.abs(B.steer) > 0.05) {
        B.h += B.steer * F.yaw * dt;
        this.side = Math.max(this.side, Math.abs(B.steer));
      }
    }
    B.v -= (B.v * Math.abs(B.v) * F.dragQ + B.v * F.dragL) * dt;
    B.moveH += wrapPi(B.h - B.moveH) * Math.min(1, dt * F.align);
    if (!this.kicking) {
      const want = gas ? F.pitch : down ? -F.pitch * 0.8 : clamp(-B.vy * 0.01, -0.12, 0.12);
      B.pitch = lerp(wrapPi(B.pitch), want, damp(dt, 4));
      B.pitchV = 0;
    }
  }

  private hop(vy: number, label: string, cost: number) {
    const p = this.p, B = p.B, s = p.s, g = p.game, T = EV.thrust;
    if (this.hopCd > 0) return false;
    if (s.nitro < cost) {
      p.hud.banner('NITROGEN LOW', 'Drive, regen-brake or stop at a gas station to refill', '#9fb6c8');
      this.hopCd = 0.5;
      return false;
    }
    s.nitro -= cost;
    this.lifts++;
    B.vy = Math.max(B.vy, vy);
    this.hoverT = EV.hop.hover;
    this.hopCd = EV.hop.cooldown;
    p.cam.shake = Math.max(p.cam.shake, 0.3);
    p.cam.fovKick = 6;
    g.audio.noise(0.7, 0.32, 5200, 'highpass');
    g.audio.play('whoosh');
    if (label) p.hud.banner(label, 'SpaceX package · cold-gas thrusters', '#dff4ff');
    g.fx.burst(B.x, B.y + 0.2, B.z, { n: 46, speed: 9, life: 0.9, size: [0.8, 3.2], colors: [T.color], gravity: -0.5, drag: 3, smoke: true, alpha: 0.55 });
    return true;
  }

  /** Trick key: kickflip. On the ground it needs a hop first (the reveal car kickflipped off the ground). */
  private startKick(steep: boolean) {
    const p = this.p, B = p.B, s = p.s, K = EV.kick;
    if (s.nitro < K.cost) {
      p.hud.banner('NITROGEN LOW', 'Not enough gas for a kickflip', '#9fb6c8');
      return;
    }
    if (!B.air && (steep || !this.hop(K.vy, '', 0))) return;
    s.nitro -= K.cost;
    this.lifts++;
    this.kickDir = B.steer < -0.2 ? -1 : 1;
    this.kickT = 1e-4;
    this.hoverT = Math.max(this.hoverT, 0.35); // side + down thrusters hold it up through the roll
    p.game.audio.play('whoosh');
    p.game.audio.noise(0.45, 0.3, 6000, 'highpass');
  }

  private kickStep(dt: number) {
    const B = this.p.B, K = EV.kick;
    this.kickT += dt;
    const t = Math.min(1, this.kickT / K.time), e = t * t * (3 - 2 * t);
    B.lean = this.kickDir * TAU * e;
    this.side = 1;
    if (t >= 1) {
      this.kickT = 0;
      B.lean = 0;
      this.kicks++;
      this.p.hud.float('KICKFLIP!', B.x, B.y + 2.5, B.z, '#dff4ff', 22);
    }
  }

  /**
   * Touchdown: finishes or fails a kickflip, ends the flight. Returns a crash reason (null = fine), the tricks
   * to add to Player's landing score and whether this air time was a powered flight (it counts as flight, not as a jump).
   */
  onLand(air: number): { crash: string | null; tricks: [string, number][]; flew: boolean } {
    const B = this.p.B, g = this.p.game, out: { crash: string | null; tricks: [string, number][]; flew: boolean } = { crash: null, tricks: [], flew: this.flew };
    if (!this.thrusters) return out;
    if (this.kicking) {
      if (this.kickT / EV.kick.time > 0.85) this.kicks++; // close enough: the suspension takes the last few degrees
      else out.crash = 'Kickflip not finished! Start it higher, or hover to buy time';
      this.kickT = 0;
      B.lean = 0;
    }
    if (!out.crash && this.flew && B.impact > EV.flight.crashImpact && air > LANDING.minAir) out.crash = 'Hard landing! Keep some nitrogen to cushion the touchdown';
    if (!out.crash && this.kicks) {
      out.tricks.push([this.kicks > 1 ? `KICKFLIP x${this.kicks}` : 'KICKFLIP', EV.kick.pts * this.kicks]);
      g.events.emit('progress', { player: this.p, id: 'kickflip', value: this.kicks });
    }
    if (this.flew && this.flightT > 0) g.events.emit('progress', { player: this.p, id: 'flight', value: this.flightT });
    this.kicks = 0;
    this.flying = this.flew = false;
    this.flightT = 0;
    return out;
  }

  /** Respawn / reset: full tank, no flight. */
  reset() {
    const p = this.p;
    this.flying = this.flew = this.glued = false;
    this.kickT = this.kicks = this.hoverT = this.thrust = this.flightT = 0;
    if (this.thrusters) p.s.nitro = p.stats.nitroMax;
  }

  /** Steepest ground slope under the car (radians). */
  private slope() {
    const B = this.p.B, T = this.p.game.terrain, d = 0.8;
    const gx = T.groundAt(B.x + d, B.z) - T.groundAt(B.x - d, B.z), gz = T.groundAt(B.x, B.z + d) - T.groundAt(B.x, B.z - d);
    return Math.atan(Math.hypot(gx, gz) / (2 * d));
  }

  /** White cold-gas plumes (smoke pool: soft, normal blending) and ground dust under a low hover. */
  private plumes(braking: boolean, firing: boolean) {
    const p = this.p, B = p.B, g = p.game, T = EV.thrust;
    const h = B.h, fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
    const vx = Math.sin(B.moveH) * B.v, vz = Math.cos(B.moveH) * B.v, amt = g.fx.amount * T.puffs;
    // local → world with roll (kickflip) so the side/down nozzles turn with the body
    const cr = Math.cos(B.lean), sr = Math.sin(B.lean);
    const puff = (lx: number, ly: number, lz: number, dx: number, dy: number, dz: number, speed: number, k = 1) => {
      if (Math.random() > amt * k) return;
      const x2 = lx * cr - ly * sr, y2 = lx * sr + ly * cr;
      const wx = B.x + fx * lz + rx * x2, wz = B.z + fz * lz + rz * x2;
      g.fx.emit(wx, B.y + y2, wz, vx * 0.5 + dx * speed + rnd(1.2), B.vy * 0.5 + dy * speed + rnd(0.8), vz * 0.5 + dz * speed + rnd(1.2),
        0.55, 0.35, 2.2, T.color, 0.6, -0.4, 3.2, true);
    };
    if (this.lift > 0.02) {
      // down nozzles: straight down out of the body (rotated with the roll), strength with the lift share
      const dx = sr * rx, dz = sr * rz, dy = -cr;
      for (const [lx, ly, lz] of T.down) puff(lx, ly, lz, dx, dy, dz, 12 + this.lift * 10, 0.4 + this.lift);
      // ground dust kicked up under a low hover
      const F = EV.flight;
      if (B.air && this.alt < F.dust) {
        const k = (1 - this.alt / F.dust) * this.lift, gy = B.y - this.alt, col = g.terrain.onRoad(B.x, B.z) ? 0xb9b4aa : g.terrain.biome(B.x, B.z) < 0.4 ? 0xd9b47a : 0x9a8a68;
        for (let i = 0; i < 3; i++) {
          if (Math.random() > amt * k * 1.5) continue;
          const a = Math.random() * TAU, sp = 6 + Math.random() * 6;
          g.fx.emit(B.x + Math.cos(a) * 1.5, gy + 0.3, B.z + Math.sin(a) * 1.5, Math.cos(a) * sp, 0.6 + Math.random() * 1.5, Math.sin(a) * sp, 1.2, 1, 3.4, col, 0.5, -0.3, 1.6, true);
        }
      }
    }
    if (braking || (this.flying && this.push > 0 && p.ctrl.is('down'))) {
      const [x, y, z] = T.front;
      for (const sx of [-x, x]) puff(sx, y, z, fx, 0, fz, 12);
    } else if (this.push > 0 && (firing || this.flying)) for (const [lx, ly, lz] of T.nozzles) puff(lx, ly, lz, -fx, 0, -fz, 12);
    if (this.side > 0.2) {
      // outside of the turn (or roll direction) pushes the car round
      const [x, y, z] = T.side, sd = this.kicking ? this.kickDir : B.steer > 0 ? -1 : 1;
      puff(sd * x, y, z, rx * sd * cr, sr * sd, rz * sd * cr, 9);
      puff(sd * x, y, -z, rx * sd * cr, sr * sd, rz * sd * cr, 9);
    }
  }

  private setHiss(level: number) {
    if (!this.hiss && level > 0) this.hiss = this.p.game.audio.createHiss();
    if (!this.hiss || (level === 0 && this.hissLevel === 0)) return;
    this.hissLevel = level;
    this.hiss.set(level, 0, (level * EV.thrust.hiss) / this.p.game.players.length);
  }

  dispose() {
    this.hiss?.stop();
    this.hiss = null;
  }
}

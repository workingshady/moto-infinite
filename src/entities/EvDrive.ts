// Electric drivetrain effects for cars with an `ev` spec (data/vehicles.ts): instant-torque launch that fades
// with speed, lift-off regenerative braking that refills the boost meter, Track Mode rear-biased rotation, and
// the Tesla Roadster's cold-gas "SpaceX package" thrusters (boost replacement: push, retro-thrust braking,
// side-thruster grip, a short hover hop) with white gas puffs from the pooled particle system and a hiss loop.
// Called once per physics step from Player.updateBike, after the generic handling and before position integration.
import type { Engine } from '../core/Audio';
import type { EvSpec } from '../data/vehicles';
import type { Player } from './Player';
import { BIKE, EV, PHYS } from '../config';
import { clamp, rnd, wrapPi } from '../utils/math';

export class EvDrive {
  readonly spec: EvSpec;
  readonly thrusters: boolean;
  private hiss: Engine | null = null;
  private hissLevel = 0;
  private hopCd = 0;
  private hoverT = 0;
  private lastJump = -9;
  private clock = 0;

  constructor(private p: Player) {
    this.spec = p.def.ev!;
    this.thrusters = !!this.spec.thrusters;
    // no exhaust on an EV: the generic nitro flame cone stays hidden
    p.bike.flame.visible = false;
  }

  /**
   * One physics step. `gas`/`down` are the driver's inputs, `boosting` the generic boost state (nitro or pad),
   * `thrusting` = boost button held with meter left (Roadster: thrusters firing).
   */
  step(dt: number, active: boolean, gas: boolean, down: boolean, boosting: boolean, thrusting: boolean) {
    const p = this.p, B = p.B, s = p.s, st = p.stats, sp = this.spec;
    this.clock += dt;
    this.hopCd = Math.max(0, this.hopCd - dt);
    const fwd = B.v >= 0;
    const firing = this.thrusters && thrusting && active;
    if (!p.riding || s.dead) {
      this.hoverT = 0;
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
      // regenerative braking: lifting off slows the car more than coasting and feeds the boost meter
      if (!gas && !boosting && B.v > EV.regenMinSpeed) {
        if (!down) B.v -= sp.regen * dt;
        s.nitro += sp.regenCharge * (down ? EV.brakeCharge : 1) * dt;
      }
      // Track Mode: rear-biased torque rotates the car on throttle mid-corner
      if (sp.rearBias && gas && !boosting && Math.abs(B.steer) > 0.4 && B.v > EV.rearBiasMinSpeed) B.h += B.steer * sp.rearBias * dt;
    }
    if (this.thrusters) this.thrust(dt, active, gas, down, firing);
    else this.setHiss(0);
  }

  private thrust(dt: number, active: boolean, gas: boolean, down: boolean, firing: boolean) {
    const p = this.p, B = p.B, s = p.s, st = p.stats, g = p.game, T = EV.thrust, H = EV.hop, c = p.ctrl;
    const braking = firing && down && !gas && B.v > 2;
    if (firing && !B.air) {
      if (braking) {
        // retro-thrust: cancel the boost's own push and fire the front nozzles against the motion
        B.v = Math.max(0, B.v - (st.accel * BIKE.nitroAccelMul + T.brake) * dt);
      } else B.v += T.accel * dt;
      // side thrusters hold the car into the corner: less slide, a little extra turn
      if (Math.abs(B.steer) > 0.2 && Math.abs(B.v) > 6) {
        B.moveH += wrapPi(B.h - B.moveH) * Math.min(1, dt * T.grip);
        B.h += B.steer * T.yaw * Math.sign(B.v) * dt;
      }
    }
    // hover hop: C (trick key), or a double tap of jump
    let hop = active && c.hit('trick');
    // (several physics steps can share one frame's key press: ignore repeats closer than 60 ms)
    if (active && c.hit('jump') && this.clock - this.lastJump > 0.06) {
      if (this.clock - this.lastJump < H.doubleTap) hop = true;
      this.lastJump = this.clock;
    }
    if (hop && !B.air && this.hopCd <= 0) {
      if (s.nitro >= H.cost) {
        s.nitro -= H.cost;
        B.vy = Math.max(B.vy, H.vy);
        this.hoverT = H.hover;
        this.hopCd = H.cooldown;
        p.cam.shake = Math.max(p.cam.shake, 0.3);
        p.cam.fovKick = 6;
        g.audio.noise(0.7, 0.32, 5200, 'highpass');
        g.audio.play('whoosh');
        p.hud.banner('HOVER HOP', 'SpaceX package · cold-gas thrusters', '#dff4ff');
        g.fx.burst(B.x, B.y + 0.2, B.z, { n: 46, speed: 9, life: 0.9, size: [0.8, 3.2], colors: [T.color], gravity: -0.5, drag: 3, smoke: true, alpha: 0.55 });
      } else {
        p.hud.banner('THRUSTERS LOW', 'Lift off or brake to recharge', '#9fb6c8');
        this.hopCd = 0.5;
      }
    }
    this.hoverT = Math.max(0, this.hoverT - dt);
    const hovering = this.hoverT > 0 && B.air;
    if (hovering) B.vy += PHYS.gravity * EV.hop.lift * dt;
    this.setHiss(firing || hovering ? (braking ? 1.1 : 1) : 0);
    if (!firing && !hovering) return;

    // white cold-gas puffs (smoke pool: soft, normal blending)
    const h = B.h, fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
    const vx = Math.sin(B.moveH) * B.v, vz = Math.cos(B.moveH) * B.v, amt = g.fx.amount * T.puffs;
    const puff = (lx: number, ly: number, lz: number, dx: number, dy: number, dz: number, speed: number) => {
      if (Math.random() > amt) return;
      const wx = B.x + fx * lz + rx * lx, wz = B.z + fz * lz + rz * lx;
      g.fx.emit(wx, B.y + ly, wz, vx * 0.55 + dx * speed + rnd(1.2), dy * speed + rnd(0.8), vz * 0.55 + dz * speed + rnd(1.2),
        0.5, 0.3, 1.9, T.color, 0.5, -0.4, 3.5, true);
    };
    if (hovering) for (const [lx, , lz] of T.nozzles) puff(lx, 0.1, lz + 1.2, 0, -1, 0, 10);
    if (braking) {
      const [x, y, z] = T.front;
      for (const sx of [-x, x]) puff(sx, y, z, fx, 0, fz, 12);
    } else if (firing) for (const [lx, ly, lz] of T.nozzles) puff(lx, ly, lz, -fx, 0, -fz, 12);
    if (firing && Math.abs(B.steer) > 0.3) {
      // outside of the turn pushes the car in
      const [x, y, z] = T.side, side = B.steer > 0 ? -1 : 1;
      puff(side * x, y, z, rx * side, 0, rz * side, 9);
      puff(side * x, y, -z, rx * side, 0, rz * side, 9);
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

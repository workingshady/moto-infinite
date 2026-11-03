// Computer-driven opponents for circuit races and Formula 1 (local games only).
// Each AI follows the racing line with a speed profile computed from track curvature, its car's grip
// (plus downforce for F1 cars), and a backwards braking pass; it moves to the inside of corners and
// pulls out to overtake when someone is in the way.
import type { Game } from '../core/Game';
import type { TrackLine } from '../world/layout';
import { buildVehicleModel, type VehicleModel } from '../entities/vehicleModels';
import { VEHICLES, type VehicleDef } from '../data/vehicles';
import { F1, PLAYER_COLORS } from '../config';
import { clamp, lerp, lerpAngle } from '../utils/math';

export interface AiRacer {
  id: string;
  name: string;
  color: number;
  def: VehicleDef;
  model: VehicleModel;
  s: number; // metres along the line since the race start (negative = behind the start line)
  v: number;
  off: number; // lateral offset from the centre line
  skill: number;
  react: number; // start reaction delay
  finished: boolean;
  finishTime: number;
  x: number; y: number; z: number; h: number;
  vmax: Float32Array;
  wheel: number;
}

const COMPOUNDS = ['soft', 'medium', 'hard'] as const;

export class AiRacers {
  readonly list: AiRacer[] = [];

  constructor(private game: Game, private track: TrackLine, count: number, f1: boolean, private halfWidth: number, private laps: number, firstSlot: number) {
    const me = game.players[0]?.def, kindPool = VEHICLES.filter((v) => !v.f1 && v.kind === (me?.kind ?? 'car'));
    // same class as the player first (a muscle car races muscle cars), then the rest of its kind
    const pool = f1 ? VEHICLES.filter((v) => v.f1 && v.id === me?.id) : [...kindPool.filter((v) => v.cls === me?.cls), ...kindPool.filter((v) => v.cls !== me?.cls)];
    const fallback = VEHICLES.filter((v) => (f1 ? !!v.f1 : !v.f1));
    for (let i = 0; i < count; i++) {
      const def = (pool.length ? pool : fallback)[i % (pool.length || fallback.length)];
      const color = PLAYER_COLORS[(i + 2) % PLAYER_COLORS.length] ^ ((i * 0x1f3a5) & 0x1f1f1f);
      const model = buildVehicleModel(def.id, color);
      model.tyreBands?.color.setHex(F1.tyres[COMPOUNDS[i % 3]].color);
      game.scene.add(model.root);
      const pose = game.layout.spawn(firstSlot + i), near = track.nearest(pose.x, pose.z, true);
      const s = near.i * track.spacing - (near.i > track.n / 2 ? track.length : 0);
      const tz = track.tz[near.i], tx = track.tx[near.i];
      const r: AiRacer = {
        id: 'ai' + i, name: F1.aiNames[i % F1.aiNames.length], color, def, model, s, v: 0,
        off: (pose.x - track.px[near.i]) * tz - (pose.z - track.pz[near.i]) * tx, // signed side offset of the grid slot
        skill: 0.86 + Math.random() * 0.12, react: 0.15 + Math.random() * 0.45, finished: false, finishTime: 0,
        x: pose.x, y: 0, z: pose.z, h: pose.h, vmax: new Float32Array(0), wheel: 0,
      };
      r.vmax = this.speedProfile(r);
      this.list.push(r);
    }
  }

  /** Max speed at each sample: cornering limit from curvature, then a backwards braking pass. */
  private speedProfile(r: AiRacer) {
    const t = this.track, n = t.n, out = new Float32Array(n), def = r.def, F = def.f1;
    // F1: top speed where power meets drag; cornering μ·g·(1 + k·v²) with k from the downforce area
    const top = F ? Math.cbrt(((F.power + F.ers * 0.6) * 1000 * F1.drivetrain) / (0.5 * 1.225 * F.cda)) * r.skill : def.top * r.skill;
    const aLat0 = (F ? F.mu * 9.81 : def.grip * 4.8) * (0.9 + r.skill * 0.1), K = F ? (0.5 * 1.225 * F.cla) / (F.mass * 9.81) : 0;
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (let j = -4; j <= 4; j++) k = Math.max(k, Math.abs(Math.asin(clamp(t.curvature((i + j + n) % n), -1, 1))) / (6 * t.spacing));
      const denom = k - aLat0 * K; // downforce: grip grows with v², so fast corners open up
      out[i] = denom <= 0 ? top : Math.min(top, Math.sqrt(aLat0 / denom));
    }
    // braking pass: decel grows with downforce at speed (μ_brake·g·(1 + k·v²)), capped at 6 g
    for (let pass = 0; pass < 2; pass++)
      for (let i = n - 1; i >= 0; i--) {
        const nx = out[(i + 1) % n], dec = F ? Math.min(F.muBrake * 9.81 * (1 + K * nx * nx), 58) * 0.88 : 16;
        out[i] = Math.min(out[i], Math.sqrt(nx * nx + 2 * dec * t.spacing));
      }
    return out;
  }

  /** Move a racer to a grid slot (index for layout.spawn). */
  place(r: AiRacer, slot: number) {
    const t = this.track, pose = this.game.layout.spawn(slot), near = t.nearest(pose.x, pose.z, true);
    r.s = near.i * t.spacing - (near.i > t.n / 2 ? t.length : 0);
    r.off = (pose.x - t.px[near.i]) * t.tz[near.i] - (pose.z - t.pz[near.i]) * t.tx[near.i];
    r.x = pose.x;
    r.z = pose.z;
    r.h = pose.h;
  }

  progress(r: AiRacer) {
    return r.s / this.track.length;
  }

  update(dt: number, started: boolean, raceTime: number) {
    const t = this.track, n = t.n, g = this.game;
    const players = g.players.map((p) => ({ s: this.trackPos(p.B.x, p.B.z), off: this.sideOf(p.B.x, p.B.z), x: p.B.x, z: p.B.z }));
    for (const r of this.list) {
      const idx = (((Math.floor(r.s / t.spacing)) % n) + n) % n;
      if (started && raceTime > r.react && !r.finished) {
        const target = r.vmax[idx], F = r.def.f1;
        if (r.v < target) {
          if (F) {
            // same longitudinal model as the player: power-limited, traction-limited, minus drag
            const K = (0.5 * 1.225 * F.cla) / (F.mass * 9.81), drive = Math.min(((F.power + F.ers * 0.6) * 1000 * F1.drivetrain) / (F.mass * Math.max(r.v, 4)), F.muLong * 9.81 * (1 + K * r.v * r.v));
            r.v += (drive * r.skill - (0.5 * 1.225 * F.cda * r.v * r.v) / F.mass) * dt;
          } else r.v += r.def.accel * r.skill * (1 - (r.v / (r.def.top * 1.1)) ** 2 * 0.7) * dt;
        } else r.v = Math.max(target, r.v - (F ? 40 : 18) * dt);
        r.v = Math.min(r.v, target + 2);
      } else if (r.finished) r.v *= 1 - 0.6 * dt;
      // racing line: inside of the next corner, unless someone is in the way
      const ahead = (idx + Math.round(40 / t.spacing)) % n, curve = t.curvature(ahead);
      let offTarget = clamp(-Math.sign(curve) * Math.min(1, Math.abs(curve) * 6) * this.halfWidth * 0.55, -this.halfWidth * 0.7, this.halfWidth * 0.7);
      const blockers = [...this.list.filter((o) => o !== r).map((o) => ({ s: o.s, off: o.off })), ...players];
      for (const b of blockers) {
        const gap = b.s - r.s;
        if (gap > 0 && gap < 14 && Math.abs(b.off - r.off) < 2.6) {
          offTarget = b.off + (b.off > 0 ? -3.6 : 3.6); // pull out to pass
          r.v = Math.min(r.v, Math.max(0, r.v - 2 * dt)); // lift slightly while side by side
        }
      }
      r.off = lerp(r.off, clamp(offTarget, -this.halfWidth + 1.2, this.halfWidth - 1.2), Math.min(1, dt * 0.9));
      r.s += r.v * dt;
      if (!r.finished && r.s >= this.laps * t.length) { r.finished = true; r.finishTime = raceTime; }
      // world pose, interpolated between samples
      const fi = (((r.s / t.spacing) % n) + n) % n, i0 = Math.floor(fi), i1 = (i0 + 1) % n, f = fi - i0;
      const tx = lerp(t.tx[i0], t.tx[i1], f), tz = lerp(t.tz[i0], t.tz[i1], f);
      const cx = lerp(t.px[i0], t.px[i1], f), cz = lerp(t.pz[i0], t.pz[i1], f);
      r.x = cx + tz * r.off;
      r.z = cz - tx * r.off;
      r.y = g.terrain.groundAt(r.x, r.z);
      r.h = lerpAngle(r.h, Math.atan2(tx, tz), Math.min(1, dt * 8));
      const m = r.model;
      r.wheel += (r.v * dt) / m.wheelRadius;
      m.wheels.forEach((w) => (w.rotation.x = r.wheel));
      m.steer.forEach((w) => (w.rotation.y = clamp(-curve * 3, -0.4, 0.4)));
      m.root.position.set(r.x, r.y, r.z);
      m.root.rotation.set(0, r.h, 0);
      if (m.rearFlap) m.rearFlap.rotation.x = lerp(m.rearFlap.rotation.x, r.v > r.vmax[idx] - 1 && Math.abs(curve) < 0.02 ? 0.5 : 0, Math.min(1, dt * 6));
    }
    // contact: AI cars push the player out instead of overlapping
    for (const p of g.players)
      for (const r of this.list) {
        const dx = p.B.x - r.x, dz = p.B.z - r.z, d = Math.hypot(dx, dz);
        if (d > 0.01 && d < 2.6) {
          const push = (2.6 - d) / d;
          p.B.x += dx * push * 0.6;
          p.B.z += dz * push * 0.6;
          p.B.v *= 0.97;
          r.v *= 0.97;
        }
      }
  }

  /** Metres along the line for any world point (used for blocking/overtakes). */
  trackPos(x: number, z: number) {
    return this.track.nearest(x, z, true).i * this.track.spacing;
  }

  private sideOf(x: number, z: number) {
    const t = this.track, i = t.nearest(x, z, true).i;
    return (x - t.px[i]) * t.tz[i] - (z - t.pz[i]) * t.tx[i];
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

  dispose() {
    for (const r of this.list) this.game.scene.remove(r.model.root);
  }
}


// Pure vehicle physics shared by the human Player and the computer racers (src/ai). Every function here is a
// verbatim extraction of what Player.updateBike used to do inline (vehiclePhysics.test.ts compares them with the
// original formulas), so the player drives exactly as before and the bots obey the very same rules.
import { BIKE, CONTROL, DRIFT, F1, RUNOFF, WALL, type TyreCompound } from '../config';
import type { F1Spec, VehicleDef } from '../data/vehicles';
import { clamp, damp, lerp, wrapPi } from '../utils/math';

/** The part of a vehicle body the shared physics reads and writes (Player.B and AiRacer both have these fields). */
export interface DriveBody { h: number; moveH: number; v: number; yawV: number; steer: number; flick: number; wasUp: boolean }

/** F1 state the physics reads: straight mode, slipstream, overtake ERS, tyre grip, front wing damage 0..1, surface (0 track, 1 grass, 2 gravel). */
export interface AeroState { aeroOpen: boolean; slip: boolean; overtake: boolean; gripMul: number; wing: number; surface: number }

/** Downforce as a multiple of the car's weight at speed v: ½ρ·ClA·v² / (m·g). Straight mode sheds some, a broken front wing too. */
export function downforceRatio(F: F1Spec, v: number, aeroOpen: boolean, wing = 0) {
  return (0.5 * F1.rho * F.cla * v * v * (aeroOpen ? F1.straightDown : 1) * (1 - wing * WALL.wingDownforce)) / (F.mass * 9.81);
}

/**
 * F1 longitudinal dynamics, returns the new speed: drive = min(power/v, traction), minus aero drag and rolling
 * resistance; braking = μ·g·(1 + downforce) capped at 6.5 g; ERS adds electric power that fades at very high speed.
 * `gasAmt` / `brakeAmt` scale drive and brake force (the player always passes 1; bots use analog pedals).
 * Off the road the run-off surface (f.surface) drags: gravel traps bite hard, grass rolls on.
 */
export function f1Longitudinal(v0: number, F: F1Spec, f: AeroState, envGrip: number, dt: number, gas: boolean, brake: boolean, ers: boolean, onRoad: boolean, gasAmt = 1, brakeAmt = 1): number {
  const v = Math.max(0, v0), g = 9.81, dr = downforceRatio(F, v, f.aeroOpen, f.wing);
  const grip = f.gripMul * envGrip;
  if (v0 < -0.05 && !brake) {
    // rolling backwards (e.g. after a wall rebound) without asking to reverse: rolling resistance and engine braking
    // oppose the motion and the throttle brakes it first, so the car comes back forward instead of running away in reverse
    const back = F1.rolling * g + F1.engineBrake + (gas ? Math.max(F.muLong * g * grip, BIKE.brake) : 0);
    return Math.min(0, v0 + back * dt);
  }
  const cda = F.cda * (f.aeroOpen ? F1.straightDrag : 1) * (f.slip ? F1.slipDrag : 1);
  const drag = (0.5 * F1.rho * cda * v * v) / F.mass + F1.rolling * g;
  let a = -drag;
  if (gas && v0 >= -0.5) {
    const taper = clamp((F1.ersTaperTo - v) / (F1.ersTaperTo - F1.ersTaperFrom), 0, 1);
    const kw = F.power + (ers && F.ers ? F.ers * taper * (f.overtake ? F1.overtakeErs : 1) : 0);
    const traction = F.muLong * g * (1 + dr) * grip;
    a += Math.min((kw * 1000 * F1.drivetrain) / (F.mass * Math.max(v, 4)), traction) * gasAmt;
  } else if (!brake) a -= F1.engineBrake;
  if (brake) {
    if (v0 > 0.5) a -= Math.min(F.muBrake * g * (1 + dr) * grip, 6.5 * g) * brakeAmt;
    else a = -BIKE.reverse; // creep backwards (forward-motion drag doesn't apply going backwards)
  }
  if (!onRoad && v > 0) {
    // run-off: gravel traps bite hard and keep biting at low speed, grass is slippery and rolls on
    const R = f.surface === 2 ? RUNOFF.gravel : RUNOFF.grass;
    a -= R.base + R.perV * v;
  }
  let nv = Math.max(v0 + a * dt, v0 > 0 && !brake ? 0 : -BIKE.maxReverse);
  if (nv > 0 && nv < 0.05 && !gas) nv = 0;
  return nv;
}

/**
 * Everything else (bikes and road cars): throttle, nitro, brake/reverse, coasting drag, off-road drag, top speed.
 * `gasAmt` = analog throttle, `brakeAmt` = analog brake; `brake` = braking allowed (↓ and not mid-wheelie), `down` = ↓ held.
 */
export function arcadeLongitudinal(v0: number, accel: number, top: number, offroad: number, gas: boolean, gasAmt: number, boosting: boolean, brake: boolean, down: boolean, brakeAmt: number, onRoad: boolean, dt: number): number {
  let v = v0;
  if (gas) v += (v < 0 ? 40 : accel * (boosting ? BIKE.nitroAccelMul : 1)) * dt * gasAmt; // analog trigger
  else if (boosting) v += accel * BIKE.nitroAccelMul * dt; // nitro drives by itself: Space + ←/→ is enough
  if (brake) v -= (v > 0 ? BIKE.brake : BIKE.reverse) * dt * brakeAmt;
  if (!gas && !down && !boosting) v *= 1 - BIKE.coastDrag * dt;
  if (!onRoad) v *= 1 - BIKE.offroadDrag * (1 - offroad) * dt;
  if (v > top) v -= Math.min(v - top, 30 * dt);
  return v;
}

/** Top speed for the arcade model (nitro, off-road). */
export function arcadeTop(top: number, boosting: boolean, onRoad: boolean, offroad: number) {
  return top * (boosting ? BIKE.nitroTopMul : 1) * (onRoad ? 1 : lerp(BIKE.offroadTop, 1, offroad));
}

/** Lateral grip limit of an F1 car at speed v (m/s²): μ·g·(1 + downforce/weight), less off the road. */
export function f1LateralLimit(F: F1Spec, v: number, f: AeroState, envGrip: number, onRoad: boolean) {
  return F.mu * 9.81 * (1 + downforceRatio(F, v, f.aeroOpen, f.wing)) * f.gripMul * envGrip * (onRoad ? 1 : f.surface === 2 ? RUNOFF.gravel.grip : RUNOFF.grass.grip);
}

/**
 * Yaw rate the steering asks for (rad/s). F1 cars are capped at aLat / v (turning faster just washes wide).
 * `grip` = the vehicle's steering rate (Player.stats.grip, bots use def.grip).
 */
export function yawGoal(def: VehicleDef, steer: number, grip: number, envGrip: number, v: number, boosting: boolean, handbrake: boolean, wheelie: boolean, f: AeroState, onRoad: boolean) {
  const yawTarget = steer * grip * envGrip * clamp(Math.abs(v) / 6, 0, 1) * Math.sign(v)
    * (boosting ? CONTROL.boostSteer : 1) * (handbrake ? 1.55 : 1) * (wheelie ? 0.8 : 1);
  const F = def.f1;
  if (!F) return yawTarget;
  const vv = Math.max(Math.abs(v), 6), aLat = f1LateralLimit(F, vv, f, envGrip, onRoad);
  return clamp(yawTarget, -aLat / vv, aLat / vv);
}

/** Yaw with inertia: the yaw rate eases toward the goal (heavier cars respond slower), then turns the heading. */
export function stepYaw(B: DriveBody, goal: number, isCar: boolean, dt: number) {
  B.yawV = lerp(B.yawV, goal, damp(dt, isCar ? DRIFT.yawInertia.car : DRIFT.yawInertia.bike));
  B.h += B.yawV * dt;
}

/**
 * Drift model: the travel direction chases the heading at the vehicle's traction rate. Handbrake and power
 * oversteer let the tail step out; lift-off and trail braking lighten the rear; counter-steering catches it.
 * Then the throttle steers the angle mid-drift. `slip` = heading − travel direction before this step.
 */
export function driftStep(B: DriveBody, def: VehicleDef, isCar: boolean, envGrip: number, gripMul: number, slip: number, handbrake: boolean, up: boolean, down: boolean, boosting: boolean, dt: number) {
  let trac = (handbrake ? def.slideTraction : def.traction) * envGrip * gripMul;
  const turning = Math.abs(B.steer) > 0.4 && Math.abs(B.v) > 14;
  if (isCar && (up || boosting) && Math.abs(slip) > 0.1 && def.traction < 6) trac *= 0.75; // power oversteer
  if (B.flick > 0) trac *= DRIFT.flickTraction; // feint / Scandinavian flick
  if (isCar && turning && B.wasUp && !up && !down) trac *= DRIFT.liftTraction; // lift-off oversteer
  if (isCar && turning && down && B.v > 0) trac *= DRIFT.brakeTraction; // trail braking
  if (Math.sign(B.steer) === -Math.sign(slip) && Math.abs(B.steer) > 0.3) trac *= 1.6; // counter-steer catches it
  B.wasUp = up;
  B.moveH += wrapPi(B.h - B.moveH) * Math.min(1, dt * trac);
  // throttle steers the angle mid-drift: power pushes the tail out, lifting tucks it in
  const slip2 = wrapPi(B.h - B.moveH);
  if (Math.abs(slip2) > DRIFT.minAngle && isCar) B.h += Math.sign(slip2) * (up || boosting ? 1 : -0.6) * DRIFT.throttleAngle * 0.12 * dt;
}

/** Slide angle beyond `hold` is eased back to it (the assist / electronics holding the slide). */
export function holdSlide(B: DriveBody, hold: number, dt: number) {
  const sl = wrapPi(B.h - B.moveH);
  if (Math.abs(sl) > hold) B.h = B.moveH + Math.sign(sl) * lerp(Math.abs(sl), hold, damp(dt, 6));
}

/** Sideways = slower (power holds speed); the handbrake drags. `slip` = the slip before driftStep. */
export function scrubStep(B: DriveBody, slip: number, handbrake: boolean, power: boolean, dt: number) {
  if (handbrake) B.v -= Math.sign(B.v) * 6 * dt;
  B.v *= 1 - Math.abs(Math.sin(slip)) * DRIFT.scrub * (power ? 0.5 : 1) * dt;
}

/** Wall response result (reused object, no allocation per contact). */
export interface WallOut { vx: number; vz: number; vn: number; hard: boolean }
/**
 * Contact with a wall of normal n: the into-wall velocity is removed (plus a small rebound capped at WALL.maxRebound),
 * the speed along the wall is kept minus Coulomb-style friction; a hard hit keeps only `glance` of it.
 */
export function wallBounce(mx: number, mz: number, nx: number, nz: number, glance: number, hardSpeed: number, out: WallOut): WallOut {
  const vn = mx * nx + mz * nz; // < 0: moving into the wall
  out.vx = mx;
  out.vz = mz;
  out.vn = vn;
  out.hard = false;
  if (vn < 0) {
    const tx = mx - vn * nx, tz = mz - vn * nz, vt = Math.hypot(tx, tz);
    let keep = vt > 1e-4 ? Math.max(0, vt - WALL.friction * -vn) / vt : 0;
    out.hard = -vn > hardSpeed;
    if (out.hard) keep *= glance;
    const rebound = Math.min(WALL.restitution * -vn, WALL.maxRebound);
    out.vx = tx * keep + rebound * nx;
    out.vz = tz * keep + rebound * nz;
  }
  return out;
}

/** F1 tyre grip from compound and wear (0..1). */
export function tyreGrip(c: TyreCompound, wear: number) {
  return F1.tyres[c].grip * lerp(1, F1.wornGrip, wear ** 1.4);
}

/** Tyre wear after `d` metres: distance, plus extra when sliding (slip angle) or braking hard. */
export function tyreWear(wear: number, c: TyreCompound, d: number, slipAbs: number, braking: boolean) {
  return Math.min(1, wear + (d / F1.tyres[c].life) * (1 + slipAbs * 4 + (braking ? 0.6 : 0)));
}

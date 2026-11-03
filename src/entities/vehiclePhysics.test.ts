// Golden test: the shared physics (vehiclePhysics.ts) must give bit-identical results to the formulas Player.updateBike
// used inline before the extraction (copied below as reference implementations), so the human's handling is unchanged.
import { describe, expect, it } from 'vitest';
import { BIKE, CONTROL, DRIFT, F1, LANDING, ROAD, WALL, type TyreCompound } from '../config';
import { VEHICLES, type VehicleDef } from '../data/vehicles';
import { clamp, damp, lerp, mulberry32, wrapPi } from '../utils/math';
import { arcadeLongitudinal, arcadeTop, driftStep, f1Longitudinal, holdSlide, scrubStep, stepYaw, tyreGrip, tyreWear, wallBounce, yawGoal, type DriveBody } from './vehiclePhysics';

const rng = mulberry32(1234);
const r = (a: number, b: number) => a + rng() * (b - a);
const bool = () => rng() < 0.5;
const F1CARS = VEHICLES.filter((v) => v.f1), ROADCARS = VEHICLES.filter((v) => !v.f1);
const pick = <T,>(l: T[]) => l[Math.floor(rng() * l.length)];

// ---- reference: the original inline code -------------------------------------------------------------
function refDown(def: VehicleDef, v: number, aeroOpen: boolean) {
  const F = def.f1!;
  return (0.5 * F1.rho * F.cla * v * v * (aeroOpen ? F1.straightDown : 1)) / (F.mass * 9.81);
}
function refF1Long(B: { v: number }, def: VehicleDef, f: { aeroOpen: boolean; slip: boolean; overtake: boolean; gripMul: number }, envGrip: number, dt: number, gas: boolean, brake: boolean, ers: boolean, onRoad: boolean, roadDist: number) {
  const F = def.f1!, v = Math.max(0, B.v), g = 9.81, dr = refDown(def, v, f.aeroOpen);
  const grip = f.gripMul * envGrip;
  if (B.v < -0.05 && !brake) {
    const back = F1.rolling * g + F1.engineBrake + (gas ? Math.max(F.muLong * g * grip, BIKE.brake) : 0);
    B.v = Math.min(0, B.v + back * dt);
    return;
  }
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
    else a = -BIKE.reverse;
  }
  if (!onRoad) a -= (roadDist > ROAD.shoulder + 3 ? F1.gravelDrag : F1.grassDrag) * v * 0.2;
  B.v = Math.max(B.v + a * dt, B.v > 0 && !brake ? 0 : -BIKE.maxReverse);
  if (B.v > 0 && B.v < 0.05 && !gas) B.v = 0;
}

describe('shared vehicle physics = original Player formulas', () => {
  it('F1 longitudinal model', () => {
    for (let k = 0; k < 4000; k++) {
      const def = pick(F1CARS), f = { aeroOpen: bool(), slip: bool(), overtake: bool(), gripMul: r(0.6, 1.1) };
      const v0 = rng() < 0.15 ? r(-8, 0.6) : r(0, 95), env = r(0.65, 1), dt = r(0.001, 1 / 60), gas = bool(), brake = bool(), ers = bool(), onRoad = rng() < 0.7, rd = r(0, 30);
      const B = { v: v0 };
      refF1Long(B, def, f, env, dt, gas, brake, ers, onRoad, rd);
      expect(f1Longitudinal(v0, def.f1!, f, env, dt, gas, brake, ers, onRoad, onRoad ? 0 : rd)).toBe(B.v);
    }
  });

  it('arcade longitudinal model', () => {
    for (let k = 0; k < 4000; k++) {
      const def = pick(ROADCARS), accel = def.accel * r(0.9, 1.3), boosting = bool(), onRoad = rng() < 0.7;
      const top = st(def.top * r(0.9, 1.2), boosting, onRoad, def.offroad);
      expect(arcadeTop(def.top, boosting, onRoad, def.offroad)).toBe(def.top * (boosting ? BIKE.nitroTopMul : 1) * (onRoad ? 1 : lerp(BIKE.offroadTop, 1, def.offroad)));
      const up = bool(), inWheelie = rng() < 0.2, down = bool(), throttle = r(0, 1), brakeA = r(0, 1), dt = r(0.001, 1 / 60);
      const gas = up || (inWheelie && bool());
      let v = rng() < 0.15 ? r(-8, 0) : r(0, 60);
      const v0 = v;
      if (gas) v += (v < 0 ? 40 : accel * (boosting ? BIKE.nitroAccelMul : 1)) * dt * (up ? throttle : 1);
      else if (boosting) v += accel * BIKE.nitroAccelMul * dt;
      if (down && !inWheelie) v -= (v > 0 ? BIKE.brake : BIKE.reverse) * dt * brakeA;
      if (!gas && !down && !boosting) v *= 1 - BIKE.coastDrag * dt;
      if (!onRoad) v *= 1 - BIKE.offroadDrag * (1 - def.offroad) * dt;
      if (v > top) v -= Math.min(v - top, 30 * dt);
      expect(arcadeLongitudinal(v0, accel, top, def.offroad, gas, up ? throttle : 1, boosting, down && !inWheelie, down, brakeA, onRoad, dt)).toBe(v);
    }
    function st(t: number, b: boolean, o: boolean, off: number) { return t * (b ? BIKE.nitroTopMul : 1) * (o ? 1 : lerp(BIKE.offroadTop, 1, off)); }
  });

  it('yaw, drift, hold and scrub steps', () => {
    for (let k = 0; k < 4000; k++) {
      const def = pick(VEHICLES), isCar = def.kind === 'car', env = r(0.7, 1), gripMul = r(0.7, 1.1), grip = def.grip * r(1, 1.2), dt = r(0.001, 1 / 60);
      const boosting = bool(), handbrake = bool(), wheelie = rng() < 0.2, aeroOpen = bool(), onRoad = rng() < 0.8, up = bool(), down = bool();
      const B: DriveBody = { h: r(-3, 3), moveH: 0, v: r(-5, 80), yawV: r(-2, 2), steer: r(-1, 1), flick: rng() < 0.2 ? r(0, 0.4) : 0, wasUp: bool() };
      B.moveH = B.h + r(-1.2, 1.2);
      const R = { ...B };
      // reference
      const yawTarget = R.steer * grip * env * clamp(Math.abs(R.v) / 6, 0, 1) * Math.sign(R.v) * (boosting ? CONTROL.boostSteer : 1) * (handbrake ? 1.55 : 1) * (wheelie ? 0.8 : 1);
      let goal = yawTarget;
      if (def.f1) {
        const F = def.f1, v = Math.max(Math.abs(R.v), 6), aLat = F.mu * 9.81 * (1 + refDownA(def, v, aeroOpen)) * gripMul * env * (onRoad ? 1 : 0.55);
        goal = clamp(yawTarget, -aLat / v, aLat / v);
      }
      R.yawV = lerp(R.yawV, goal, damp(dt, isCar ? DRIFT.yawInertia.car : DRIFT.yawInertia.bike));
      R.h += R.yawV * dt;
      const slip = wrapPi(R.h - R.moveH);
      let trac = (handbrake ? def.slideTraction : def.traction) * env * gripMul;
      const turning = Math.abs(R.steer) > 0.4 && Math.abs(R.v) > 14;
      if (isCar && (up || boosting) && Math.abs(slip) > 0.1 && def.traction < 6) trac *= 0.75;
      if (R.flick > 0) trac *= DRIFT.flickTraction;
      if (isCar && turning && R.wasUp && !up && !down) trac *= DRIFT.liftTraction;
      if (isCar && turning && down && R.v > 0) trac *= DRIFT.brakeTraction;
      if (Math.sign(R.steer) === -Math.sign(slip) && Math.abs(R.steer) > 0.3) trac *= 1.6;
      R.wasUp = up;
      R.moveH += wrapPi(R.h - R.moveH) * Math.min(1, dt * trac);
      const slip2 = wrapPi(R.h - R.moveH);
      if (Math.abs(slip2) > DRIFT.minAngle && isCar) R.h += Math.sign(slip2) * (up || boosting ? 1 : -0.6) * DRIFT.throttleAngle * 0.12 * dt;
      const hold = DRIFT.holdAngle[1], sl = wrapPi(R.h - R.moveH);
      if (Math.abs(sl) > hold) R.h = R.moveH + Math.sign(sl) * lerp(Math.abs(sl), hold, damp(dt, 6));
      if (handbrake) R.v -= Math.sign(R.v) * 6 * dt;
      R.v *= 1 - Math.abs(Math.sin(slip)) * DRIFT.scrub * (up || boosting ? 0.5 : 1) * dt;
      // shared
      stepYaw(B, yawGoal(def, B.steer, grip, env, B.v, boosting, handbrake, wheelie, aeroOpen, gripMul, onRoad), isCar, dt);
      const s2 = wrapPi(B.h - B.moveH);
      driftStep(B, def, isCar, env, gripMul, s2, handbrake, up, down, boosting, dt);
      holdSlide(B, hold, dt);
      scrubStep(B, s2, handbrake, up || boosting, dt);
      expect(B).toEqual(R);
    }
    function refDownA(def: VehicleDef, v: number, a: boolean) { return refDown(def, v, a); }
  });

  it('wall bounce and tyres', () => {
    const out = { vx: 0, vz: 0, vn: 0, hard: false };
    for (let k = 0; k < 2000; k++) {
      const mx = r(-60, 60), mz = r(-60, 60), a = r(0, 6.3), nx = Math.cos(a), nz = Math.sin(a), glance = r(0.5, 1);
      const vn = mx * nx + mz * nz;
      let vx = mx, vz = mz, hard = false;
      if (vn < 0) {
        const tx = mx - vn * nx, tz = mz - vn * nz, vt = Math.hypot(tx, tz);
        let keep = vt > 1e-4 ? Math.max(0, vt - WALL.friction * -vn) / vt : 0;
        hard = -vn > LANDING.wallDamageSpeed;
        if (hard) keep *= glance;
        vx = tx * keep - WALL.restitution * vn * nx;
        vz = tz * keep - WALL.restitution * vn * nz;
      }
      wallBounce(mx, mz, nx, nz, glance, LANDING.wallDamageSpeed, out);
      expect([out.vx, out.vz, out.vn, out.hard]).toEqual([vx, vz, vn, hard]);
      const c = pick(['soft', 'medium', 'hard'] as TyreCompound[]), wear = r(0, 1), d = r(0, 3), sl = r(0, 1), br = bool();
      expect(tyreGrip(c, wear)).toBe(F1.tyres[c].grip * lerp(1, F1.wornGrip, wear ** 1.4));
      expect(tyreWear(wear, c, d, sl, br)).toBe(Math.min(1, wear + (d / F1.tyres[c].life) * (1 + sl * 4 + (br ? 0.6 : 0))));
    }
  });
});

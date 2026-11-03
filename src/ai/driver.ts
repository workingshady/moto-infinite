// One computer racer driving the REAL vehicle model (entities/vehiclePhysics.ts, the same functions Player uses).
//
// Control (cheap, phone-friendly, no allocation per step):
//  - steering: pure pursuit toward a point on the racing line, lookahead = base + time × speed; the wanted travel
//    turn rate is turned into a heading target that leads the travel direction by the slip the drift model needs,
//    then into a steering input through the vehicle's own steering rate (CONTROL.steerIn smoothing like a player).
//  - speed: predictive target from the speed profile a short preview ahead, PI throttle around it, proportional brake.
//  - humanising: reaction lag, steering noise and lap-to-lap pace jitter from the personality's consistency, and
//    mistakes (run wide, lock-up, missed apex, small spins for low levels) at corner entry.
//  - racecraft: follow gap, overtakes with a committed side, one defensive move to the inside, blue flags, recovery.
// World access goes through BotWorld so this runs in unit tests without WebGL (collision call sites are isolated
// there: swapping in another wall / car contact model only touches the BotWorld adapter in AiRacers.ts).
import { AI, BIKE, CONTROL, DRIFT, F1, LANDING, WALL, type TyreCompound } from '../config';
import type { VehicleDef } from '../data/vehicles';
import type { TrackLine } from '../world/layout';
import { clamp, damp, lerp, wrapPi } from '../utils/math';
import { sweepSteps, toSpeedHeading } from '../world/collide';
import { arcadeLongitudinal, arcadeTop, driftStep, f1Longitudinal, holdSlide, scrubStep, stepYaw, tyreGrip, tyreWear, wallBounce, yawGoal, type DriveBody, type WallOut } from '../entities/vehiclePhysics';
import type { BotProfile } from './personality';
import { topEstimate, type HalfWidthFn, type RacingLine } from './racingLine';
import { drsAllowed, ersDeploy } from './strategy';

export type WallKind = 'water' | 'wall' | 'tree';
/** What a bot needs from the world. */
export interface BotWorld {
  readonly track: TrackLine;
  readonly line: RacingLine;
  readonly hw: HalfWidthFn;
  envGrip: number;
  /** Rain on track (0..1): wet-weather skill matters. */
  wet: number;
  onRoad(x: number, z: number): boolean;
  roadDist(x: number, z: number): number;
  /** Is a body of radius r blocked at (x, z) (water, cliff, barrier / tree)? */
  blocked(x: number, z: number, r: number): false | WallKind;
  /** Swept test from (x0, z0) to (x1, z1): fraction of the path at the first blocked sub-step, < 0 = free. */
  sweep(x0: number, z0: number, x1: number, z1: number, r: number): number;
  /** Outward contact normal + depth at a blocked spot (may return a reused object: read it at once). */
  contact(x: number, z: number, r: number, kind: WallKind, fx: number, fz: number): { x: number; z: number; depth: number };
  /** Surface under the car: 0 track, 1 grass / run-off, 2 gravel trap. */
  surface(x: number, z: number): number;
  inDrs?(i: number): boolean;
  pit?: { i0: number; i1: number; side: 1 | -1 } | null;
}

export type PitPhase = 0 | 1 | 2 | 3; // none, heading to the box, stopped, leaving the lane
export interface BotF1 {
  compound: TyreCompound; startCompound: TyreCompound; wear: number; gripMul: number; ers: number;
  aeroOpen: boolean; slip: boolean; overtake: boolean; stops: number; drsOk: boolean; wing: number; surface: number;
  pit: PitPhase; pitT: number; box: number; next: TyreCompound; wantPit: boolean; pitWear: number; lastPitLap: number;
}

export interface Bot extends DriveBody {
  readonly id: string;
  readonly def: VehicleDef;
  readonly prof: BotProfile;
  readonly isCar: boolean;
  x: number; z: number; y: number; lean: number;
  lastSteerSign: number; lastSteerT: number;
  /** Track sample, unwrapped sample count since the race start, metres since the start, lateral offset. */
  idx: number; sIdx: number; s: number; lat: number;
  vmax: Float32Array;
  /** Flat-out speed estimate (straights cap below Legend pace). */
  top: number;
  // pedals and controller memory
  thr: number; brk: number; integ: number; noise: number; paceLap: number; lapSeen: number;
  /** Catch-up pace adjustment (±AI.catchUp.max, eased). */
  adj: number;
  /** Tactical lateral offset (wanted / smoothed), commit timer, side, defence used on this straight. */
  tact: number; tactCur: number; tactT: number; defended: boolean; defending: boolean; yieldT: number;
  /** Seconds to the car ahead / behind on track (from the last racecraft tick), DRS zone memory. */
  gapAhead: number; gapBehind: number; inZone: boolean;
  /** Speed cap from following / yielding (m/s, Infinity = none). */
  cap: number;
  mistake: number; mistakeT: number; mistakeSide: number;
  stuckT: number; recover: number; recT: number;
  hp: number; wallCd: number; damage: number;
  started: boolean; finished: boolean; finishTime: number; mistakes: number; spins: number;
  f1: BotF1 | null;
  /** Seconds the bot has been far from every player (LOD) and step accumulator. */
  lodAcc: number;
}

const wallOut: WallOut = { vx: 0, vz: 0, vn: 0, hard: false };
/** Body radius against walls and barriers, the same as the player's (WALL.radius). */
const wallRadius = (b: Bot) => (b.def.f1 ? WALL.radius.f1 : b.isCar ? WALL.radius.car : WALL.radius.bike);

export function makeBot(id: string, def: VehicleDef, prof: BotProfile, vmax: Float32Array, x: number, z: number, h: number, compound: TyreCompound | null): Bot {
  return {
    id, def, prof, isCar: def.kind === 'car', h, moveH: h, v: 0, yawV: 0, steer: 0, flick: 0, wasUp: false,
    x, z, y: 0, lean: 0, lastSteerSign: 0, lastSteerT: 0, idx: 0, sIdx: 0, s: 0, lat: 0, vmax, top: topEstimate(def),
    thr: 0, brk: 0, integ: 0, noise: 0, paceLap: prof.pace, lapSeen: -99, adj: 0,
    tact: 0, tactCur: 0, tactT: 0, defended: false, defending: false, yieldT: 0, cap: Infinity, gapAhead: Infinity, gapBehind: Infinity, inZone: false,
    mistake: 0, mistakeT: 0, mistakeSide: 0, stuckT: 0, recover: 0, recT: 0,
    hp: AI.hp, wallCd: 0, damage: 0, started: false, finished: false, finishTime: 0, mistakes: 0, spins: 0,
    f1: compound ? {
      compound, startCompound: compound, wear: 0, gripMul: tyreGrip(compound, 0), ers: 100, aeroOpen: false, slip: false, overtake: false,
      stops: 0, drsOk: false, wing: 0, surface: 0, pit: 0, pitT: 0, box: 0, next: compound, wantPit: false, pitWear: AI.f1.pitWear, lastPitLap: -1,
    } : null,
    lodAcc: 0,
  };
}

/** Put a bot on the track at (x, z) facing h; finds its sample and unwrapped progress (behind the line = negative). */
export function placeBot(b: Bot, w: BotWorld, x: number, z: number, h: number) {
  const t = w.track, near = t.nearest(x, z, true);
  b.x = x; b.z = z; b.h = b.moveH = h; b.v = 0; b.yawV = 0; b.steer = 0;
  b.idx = near.i;
  b.sIdx = near.i > t.n / 2 ? near.i - t.n : near.i;
  b.s = b.sIdx * t.spacing;
  b.lat = (x - t.px[near.i]) * t.tz[near.i] - (z - t.pz[near.i]) * t.tx[near.i];
  b.tactCur = b.tact = b.lat - w.line.off[near.i]; // start from the grid slot, blend onto the line
}

/** Track the nearest centre-line sample with a local search (falls back to the spatial hash when lost). */
export function trackIndex(b: Bot, w: BotWorld) {
  const t = w.track, n = t.n, px = t.px, pz = t.pz;
  let best = b.idx, bd = 1e18;
  for (let k = -4; k <= 8; k++) {
    const i = (b.idx + k + n) % n, dx = b.x - px[i], dz = b.z - pz[i], d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  if (bd > 30 * 30) { const r = t.nearest(b.x, b.z, true); if (r.i >= 0) best = r.i; }
  let di = best - b.idx;
  if (di > n / 2) di -= n;
  else if (di < -n / 2) di += n;
  b.sIdx += di;
  b.idx = best;
  const along = clamp((b.x - px[best]) * t.tx[best] + (b.z - pz[best]) * t.tz[best], -t.spacing, t.spacing);
  b.s = b.sIdx * t.spacing + along;
  b.lat = (b.x - px[best]) * t.tz[best] - (b.z - pz[best]) * t.tx[best];
}

/** Shared random source (tests seed it). */
export let rand: () => number = Math.random;
export const setRand = (f: () => number) => { rand = f; };

/** Pace this bot drives at right now: personal pace × lap jitter × catch-up × damage × weather, never above the limit. */
export function effectivePace(b: Bot, w: BotWorld) {
  const wetCost = w.wet * AI.f1.wetCaution * 0.06 * (1 - b.prof.wet); // no wet tyres in the game: the less skilled lift more
  return Math.min(1, b.paceLap * (1 + b.adj) * (1 - b.damage) * (1 - wetCost));
}

/** Grip factor applied to the profile (computed at grip 1): corner speed ∝ √μ with downforce, ∝ μ for the arcade model. */
const gripScale = (b: Bot, w: BotWorld) => {
  const g = w.envGrip * (b.f1 ? b.f1.gripMul / F1.tyres.medium.grip : 1);
  return b.def.f1 ? Math.sqrt(g) : g;
};

/** Target speed at sample i for this bot: the profile × pace; below Legend pace the straights are not quite flat out either. */
function targetAt(b: Bot, w: BotWorld, i: number, pace: number) {
  const v = b.vmax[i] * pace * gripScale(b, w);
  return pace < 0.995 ? Math.min(v, b.top * (pace + 0.03)) : v;
}

/**
 * One fixed physics step for one bot. `t` = race time (s), `started` = lights out / GO.
 */
export function stepBot(b: Bot, w: BotWorld, dt: number, t: number, started: boolean) {
  const T = w.track, n = T.n, L = w.line, F = b.def.f1, f1 = b.f1, env = w.envGrip;
  trackIndex(b, w);
  // ---- lap jitter (consistency): a new pace each lap
  const lapNow = Math.floor(b.s / (n * T.spacing));
  if (lapNow !== b.lapSeen) {
    b.lapSeen = lapNow;
    const sd = (1 - b.prof.consistency) * 0.018;
    b.paceLap = b.prof.pace * (1 + (rand() + rand() + rand() - 1.5) * sd * 1.4);
  }
  const go = started && !b.finished && t > b.prof.react;
  // ---- controller
  let gas = 0, brake = 0, want = 0;
  const v = b.v, av = Math.abs(v), pace = effectivePace(b, w);
  if (go || b.finished) {
    // lookahead and lateral target
    const S = AI.steer, Ld = Math.min(S.lookMax, S.lookBase + S.lookTime * av), j = (b.idx + Math.max(1, Math.round(Ld / T.spacing))) % n;
    if (b.mistake === 1 && b.mistakeT > 0) b.tact += (b.mistakeSide * 2.6 - b.tact) * Math.min(1, dt * 2); // running wide
    b.tactCur += (b.tact - b.tactCur) * Math.min(1, dt * (1.2 + b.prof.aggression)); // lane changes are smooth
    let lt = L.off[j] + b.tactCur + b.noise;
    const hwj = w.hw(j);
    if (f1 && f1.pit) lt = pitLateral(b, w, j, lt);
    else lt = clamp(lt, -hwj + 1.1, hwj - 1.1);
    const cx = T.px[j] + T.tz[j] * lt, cz = T.pz[j] - T.tx[j] * lt;
    // pure pursuit on the travel direction
    const dx = cx - b.x, dz = cz - b.z, dist = Math.max(1, Math.hypot(dx, dz));
    const alpha = wrapPi(Math.atan2(dx, dz) - b.moveH);
    const omega = (2 * Math.max(av, 3) * Math.sin(alpha)) / dist;
    const trac = Math.max(0.5, b.def.traction * env * (f1 ? f1.gripMul : 1));
    // the heading leads the travel direction by the slip the drift model needs to bend the path at this rate
    const hWant = b.moveH + clamp(omega / trac, -0.35, 0.35), yawWant = omega + 3.2 * wrapPi(hWant - b.h) - S.damp * (b.yawV - omega);
    const steerRate = (b.def.grip * env * clamp(av / 6, 0, 1)) || 0.05;
    want = clamp(yawWant / Math.max(0.05, steerRate) * Math.sign(v || 1), -1, 1);
    // humanising: steering noise (consistency), a lag set by the start reaction of the level
    b.noise += (-b.noise * 0.8 + (rand() - 0.5) * (1 - b.prof.consistency) * 3) * dt;
    // ---- speed target: profile a short preview ahead, minus following / yielding caps
    const prevI = (b.idx + Math.max(1, Math.round((av * AI.speed.preview + 2) / T.spacing))) % n;
    let target = Math.min(targetAt(b, w, prevI, pace), targetAt(b, w, b.idx, pace) + 4);
    if (b.mistake === 1 && b.mistakeT > 0) target *= 1.06; // carried too much speed in
    target = Math.min(target, b.cap);
    if (f1 && f1.pit) target = Math.min(target, pitSpeed(b, w));
    if (b.finished) target = Math.min(target, 22);
    if (b.recover) { target = b.recover === 1 ? -4 : 12; }
    const err = target - v, P = AI.speed;
    if (b.recover === 1) { brake = 1; gas = 0; }
    else if (err > P.band * 3) { gas = 1; b.integ = 0; }
    else if (err > -P.band) {
      b.integ = clamp(b.integ + err * dt, -2, 2);
      gas = clamp(0.55 + P.kp * err + P.ki * b.integ, 0, 1);
    } else {
      b.integ = 0;
      brake = clamp(-err * 0.18 + 0.15, 0, 1);
      if (b.mistake === 2 && b.mistakeT > 0) brake = 1; // lock-up
    }
    // traction-limited launch for nervous drivers
    if (av < 12 && b.prof.consistency < 0.6) gas = Math.min(gas, 0.75);
  }
  // reaction lag on the pedals
  const lag = damp(dt, 10 + b.prof.consistency * 8);
  b.thr = lerp(b.thr, gas, lag);
  b.brk = lerp(b.brk, brake, lag * 1.5);
  if (b.recover === 1) {
    // reversing: swing the nose back toward the race direction (yaw sign follows the speed sign in the shared model)
    b.thr = 0; b.brk = 1;
    const hErr = wrapPi(Math.atan2(T.tx[b.idx], T.tz[b.idx]) - b.h), rate = (b.def.grip * env * clamp(Math.abs(b.v) / 6, 0, 1)) || 0.05;
    want = clamp(((1.5 * hErr) / rate) * Math.sign(b.v || -1), -1, 1);
  }
  // ---- physics: the same model the player drives
  const up = b.thr > 0.05, down = b.brk > 0.05, onRoad = w.onRoad(b.x, b.z), aero = f1 ?? NOAERO;
  if (f1) f1.surface = onRoad ? 0 : w.surface(b.x, b.z);
  // F1 per-step: tyres, DRS, ERS, slipstream flag (set by AiRacers), pit limiter
  let ers = false;
  if (f1 && F) {
    f1.gripMul = tyreGrip(f1.compound, f1.wear);
    const inZone = !!w.inDrs?.(b.idx);
    f1.aeroOpen = drsAllowed(inZone, f1.drsOk ? 0 : 9, down, F.aero === 'active') && b.thr > 0.9;
    const straight = targetAt(b, w, (b.idx + 15) % n, 1) > av + 8;
    ers = !f1.pit && ersDeploy(f1.ers, straight && b.thr > 0.9, down, f1.overtake, b.defending, b.prof.aggression);
    if (ers) f1.ers = Math.max(0, f1.ers - BIKE.nitroBurn * dt);
    f1.ers = clamp(f1.ers + (down && av > 10 ? F1.ersRegen : F1.ersIdle) * dt, 0, 100);
  }
  if (F) b.v = f1Longitudinal(b.v, F, aero, env, dt, up, down, ers, onRoad, b.thr, b.brk);
  else b.v = arcadeLongitudinal(b.v, b.def.accel, arcadeTop(b.def.top, false, onRoad, b.def.offroad), b.def.offroad, up, b.thr, false, down, down, b.brk, onRoad, dt);
  if (f1?.pit && b.v > F1.pitLimit && w.pit && inRange(b.idx, w.pit.i0, w.pit.i1)) b.v = lerp(b.v, F1.pitLimit, Math.min(1, dt * 4)); // pit limiter
  if (env < 1 && Math.abs(b.steer) > 0.6 && Math.abs(b.v) > 20) b.v *= 1 - (1 - env) * dt; // wet roads scrub speed in corners
  b.v = Math.max(b.v, -BIKE.maxReverse);
  b.steer = lerp(b.steer, want, damp(dt, Math.abs(want) > 0.02 ? CONTROL.steerIn : CONTROL.steerOut));
  stepYaw(b, yawGoal(b.def, b.steer, b.def.grip, env, b.v, false, false, false, aero, onRoad), b.isCar, dt);
  // weight transfer flick, like a gamepad with a small dead zone
  const sgn = Math.abs(want) > 0.5 ? Math.sign(want) : 0;
  if (sgn && sgn !== b.lastSteerSign) {
    if (b.lastSteerSign && t - b.lastSteerT < DRIFT.flickWindow && Math.abs(b.v) > 16 && b.isCar) b.flick = DRIFT.flickTime;
    b.lastSteerSign = sgn;
    b.lastSteerT = t;
  } else if (sgn) b.lastSteerT = t;
  b.flick = Math.max(0, b.flick - dt);
  const slip = wrapPi(b.h - b.moveH);
  driftStep(b, b.def, b.isCar, env, f1?.gripMul ?? 1, slip, false, up, down, false, dt);
  // slide limit: low levels can spin past the limit (like Pro assist), everyone else is caught at the Normal hold angle
  const sl = wrapPi(b.h - b.moveH);
  if (Math.abs(sl) > DRIFT.spinAngle && (b.prof.level === 'rookie' || b.prof.level === 'amateur') && Math.abs(b.v) > 10) spin(b);
  else holdSlide(b, DRIFT.holdAngle[1], dt);
  scrubStep(b, slip, false, up, dt);
  if (b.isCar) b.lean = lerp(b.lean, -b.steer * clamp(Math.abs(b.v) / 30, 0, 1) * 0.06, damp(dt, 5));
  else b.lean = lerp(b.lean, -b.steer * clamp(Math.abs(b.v) / 22, 0, 1) * 0.55, damp(dt, 6));
  if (!Number.isFinite(b.v) || !Number.isFinite(b.h) || !Number.isFinite(b.moveH)) { b.v = 0; b.h = b.moveH = Number.isFinite(b.h) ? b.h : 0; }
  // ---- move + walls
  b.wallCd = Math.max(0, b.wallCd - dt);
  if (b.v !== 0) {
    // swept move (the wall test runs in sub-steps no longer than half the radius: an F1 car can't skip a thin barrier)
    const rad = wallRadius(b), dx = Math.sin(b.moveH) * b.v * dt, dz = Math.cos(b.moveH) * b.v * dt;
    const f = w.sweep(b.x, b.z, b.x + dx, b.z + dz, rad);
    if (f < 0) {
      if (f1) f1.wear = tyreWear(f1.wear, f1.compound, Math.abs(b.v) * dt, Math.abs(wrapPi(b.h - b.moveH)), down);
      b.x += dx;
      b.z += dz;
    } else {
      const k = Math.max(0, f - 1 / sweepSteps(Math.hypot(dx, dz), rad)), hx = b.x + dx * f, hz = b.z + dz * f;
      b.x += dx * k;
      b.z += dz * k;
      hitWall(b, w, w.blocked(hx, hz, rad) || 'tree', hx, hz, rad, dt * (1 - k));
    }
  }
  // ---- timers: mistakes, recovery
  if (b.mistakeT > 0) { b.mistakeT -= dt; if (b.mistakeT <= 0) { b.mistake = 0; if (b.tact > 1.5 || b.tact < -1.5) b.tact = 0; } }
  if (go) { maybeMistake(b, w, dt, av); recovery(b, w, dt); }
}

const NOAERO = { aeroOpen: false, slip: false, overtake: false, gripMul: 1, wing: 0, surface: 0 };

const inRange = (i: number, a: number, b: number) => (a <= b ? i >= a && i <= b : i >= a || i <= b);
const fwd = (from: number, to: number, n: number) => (to - from + n) % n;

/** Pit lane lateral target: through lane on the way in/out, the box lane at the box, ramps at both ends. */
function pitLateral(b: Bot, w: BotWorld, j: number, racing: number) {
  const p = w.pit!, f1 = b.f1!, n = w.track.n, hw = w.hw(j), side = p.side;
  const lane = side * (hw + 4.5), boxLane = side * (hw + 9);
  const ramp = Math.round(24 / w.track.spacing);
  if (f1.pit === 1 && !inRange(j, (p.i0 - ramp + n) % n, p.i1)) return clamp(racing, -hw + 1.1, hw - 1.1);
  if (f1.pit === 3) {
    // leaving: lane until the end, then merge back onto the line
    const toEnd = fwd(j, p.i1, n);
    if (!inRange(j, p.i0, p.i1)) return clamp(racing, -hw + 1.1, hw - 1.1);
    if (toEnd < ramp) return lerp(racing, lane, toEnd / ramp);
    return lane;
  }
  const into = fwd((p.i0 - ramp + n) % n, j, n);
  if (into < ramp) return lerp(racing, lane, into / ramp);
  const toBox = fwd(j, f1.box, n);
  if (f1.pit === 1 && toBox < 14 && inRange(j, p.i0, p.i1)) return lerp(lane, boxLane, 1 - toBox / 14);
  if (f1.pit === 2) return boxLane;
  return lane;
}

/** Pit speed: brake for the entry, limiter in the lane, stop on the box. */
function pitSpeed(b: Bot, w: BotWorld) {
  const p = w.pit, f1 = b.f1!, n = w.track.n, sp = w.track.spacing;
  if (!p) return Infinity;
  const toEntry = fwd(b.idx, p.i0, n) * sp;
  let cap = Infinity;
  if (f1.pit === 1 || f1.pit === 3) {
    if (!inRange(b.idx, p.i0, p.i1)) cap = toEntry < 600 ? Math.sqrt(F1.pitLimit ** 2 + 2 * 20 * Math.max(0, toEntry - 30)) : Infinity;
    else cap = F1.pitLimit - 1;
  }
  if (f1.pit === 1 && inRange(b.idx, p.i0, p.i1)) cap = Math.min(cap, Math.sqrt(2 * 7 * Math.max(0, fwd(b.idx, f1.box, n) * sp - 1)));
  if (f1.pit === 2) cap = 0;
  return cap;
}

/**
 * Wall / barrier contact: the player's response (shared wallBounce with the capped rebound, travel kept on the
 * heading's side, nose swung toward the wall's line), then a swept slide along the wall for the rest of the step.
 * Hard hits cost health; an F1 nose-first hit breaks the front wing (less downforce until the next stop).
 */
function hitWall(b: Bot, w: BotWorld, kind: WallKind, nx: number, nz: number, rad: number, dtLeft: number) {
  const mx = Math.sin(b.moveH) * b.v, mz = Math.cos(b.moveH) * b.v, spd = Math.hypot(mx, mz);
  const c = w.contact(nx, nz, rad, kind, -mx, -mz), cnx = c.x, cnz = c.z;
  const r = wallBounce(mx, mz, cnx, cnz, 0.85, LANDING.wallDamageSpeed, wallOut);
  if (r.vn < 0 && b.wallCd <= 0 && -r.vn > 4) {
    b.wallCd = WALL.fxCooldown;
    if (r.hard) damage(b, Math.max(0, -r.vn - WALL.damageMin) * WALL.damage * 2);
    if (b.f1 && -r.vn > WALL.wingSpeed && -r.vn > spd * WALL.wingAngle) b.f1.wing = 1;
  }
  const res = toSpeedHeading(r.vx, r.vz, b.h, b.moveH, sh), sp = Math.min(Math.abs(res.v), spd);
  if (sp > 0.05) {
    b.moveH = res.moveH;
    b.v = Math.sign(res.v) * sp;
    const gap = wrapPi(b.moveH - b.h);
    if (Math.abs(gap) < Math.PI / 2 && r.vn < 0) { b.h += clamp(gap * WALL.align, -WALL.maxSpin, WALL.maxSpin); b.yawV *= 0.3; }
  } else b.v = 0;
  if (b.v !== 0) {
    const sx = Math.sin(b.moveH) * b.v * dtLeft, sz = Math.cos(b.moveH) * b.v * dtLeft, f = w.sweep(b.x, b.z, b.x + sx, b.z + sz, rad);
    const k = f < 0 ? 1 : Math.max(0, f - 1 / sweepSteps(Math.hypot(sx, sz), rad));
    b.x += sx * k;
    b.z += sz * k;
  }
  // still overlapping (shoved in by another car): ease out along the contact normal
  for (let it = 0; it < 3 && w.blocked(b.x, b.z, rad) === 'tree'; it++) {
    const n = w.contact(b.x, b.z, rad, 'tree', cnx, cnz), push = Math.min(Math.max(n.depth, 0.02) + 0.01, WALL.maxPush);
    b.x += n.x * push;
    b.z += n.z * push;
  }
}
const sh = { v: 0, moveH: 0 };

/** Damage: hp down; past 50 % the car is slower (aero / suspension), up to −6 %. */
export function damage(b: Bot, amount: number) {
  b.hp = Math.max(10, b.hp - amount);
  b.damage = clamp((AI.hp * 0.5 - b.hp) / (AI.hp * 0.4), 0, 1) * 0.06;
}

function spin(b: Bot) {
  b.v *= 0.35;
  b.yawV = 0;
  b.h = b.moveH + Math.PI * 0.9 * Math.sign(wrapPi(b.h - b.moveH));
  b.moveH = b.h;
  b.spins++;
}

/** Mistakes at corner entry (Poisson rate from the personality). 1 wide, 2 lock-up, 3 missed apex, 4 spin. */
function maybeMistake(b: Bot, w: BotWorld, dt: number, av: number) {
  if (b.mistake || b.recover || av < 15 || (b.f1 && b.f1.pit)) return;
  const T = w.track, n = T.n, ahead = (b.idx + Math.round((av * 1.2) / T.spacing)) % n;
  if (Math.abs(T.curvature(ahead)) < 0.08) return; // only at a corner entry
  if (rand() > (b.prof.mistakesPerMin / 60) * dt * 3) return; // ~1/3 of the time is corner entry
  const low = b.prof.level === 'rookie' || b.prof.level === 'amateur', r = rand();
  const out = Math.sign(T.curvature(ahead)) || 1; // the inside is -sign(curvature) (as the old line logic), so this is the outside
  b.mistakes++;
  if (low && r < 0.15) { b.mistake = 4; b.mistakeT = 0.3; b.yawV += out * 2.8; return; } // twitch → small spin
  if (r < 0.45) { b.mistake = 1; b.mistakeT = 2.2; b.mistakeSide = out; return; } // runs wide
  if (r < 0.75) { b.mistake = 2; b.mistakeT = 0.45; return; } // lock-up
  b.mistake = 3; b.mistakeT = 1.6; b.tact = out * 1.6; // misses the apex (stays out)
}

/** Stuck / off track / facing backwards: reverse out, then rejoin carefully; reset if it takes too long. */
function recovery(b: Bot, w: BotWorld, dt: number) {
  const T = w.track, hw = w.hw(b.idx), R = AI.recover, dirErr = Math.abs(wrapPi(b.moveH - Math.atan2(T.tx[b.idx], T.tz[b.idx])));
  if (!b.recover) {
    const stuck = Math.abs(b.v) < 2 && b.thr > 0.4 && !(b.f1 && b.f1.pit === 2);
    b.stuckT = stuck || (dirErr > 1.9 && Math.abs(b.v) < 10) ? b.stuckT + dt : Math.max(0, b.stuckT - dt);
    if (b.stuckT > R.stuckTime || (Math.abs(b.lat) > hw + R.offTrack && !(b.f1 && b.f1.pit))) { b.recover = 1; b.recT = 0; b.stuckT = 0; }
    return;
  }
  b.recT += dt;
  if (b.recover === 1 && b.recT > R.reverseTime) b.recover = 2;
  if (b.recover === 2 && Math.abs(b.lat) < hw - 1 && dirErr < 0.5 && Math.abs(b.v) > 6) { b.recover = 0; b.recT = 0; b.tact = 0; }
  if (b.recover === 2 && Math.abs(b.v) < 1 && b.recT > R.reverseTime + 2.5) { b.recover = 1; b.recT = 0; } // try again
  if (b.recT > R.resetTime) resetBot(b, w);
}

/** Last resort: back onto the racing line a few metres back, pointing the right way, standing still. */
export function resetBot(b: Bot, w: BotWorld) {
  const T = w.track, n = T.n, i = (b.idx - 3 + n) % n, o = w.line.off[i];
  b.x = T.px[i] + T.tz[i] * o;
  b.z = T.pz[i] - T.tx[i] * o;
  b.h = b.moveH = Math.atan2(T.tx[i], T.tz[i]);
  b.v = 0; b.yawV = 0; b.steer = 0; b.recover = 0; b.recT = 0; b.stuckT = 0; b.tact = b.tactCur = 0;
  trackIndex(b, w);
}

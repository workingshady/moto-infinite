// Racecraft for the computer racers, run ~10 times a second per bot (cheap: at most ~20 cars, plain loops):
// keep a follow gap, commit to an overtake on one side, one defensive move to the inside (never weaving),
// make room for a car lapping you (blue flag), avoid squeezing a car alongside, and the F1 DRS detection flag.
import { AI, F1 } from '../config';
import { clamp } from '../utils/math';
import type { Bot, BotWorld } from './driver';

/** Everyone on track, bots and humans, in a common shape (reused objects, no allocation per tick). */
export interface Car { id: string; s: number; lat: number; v: number; x: number; z: number; h: number; bot: Bot | null }

/** Signed distance along the lap from a to b (−L/2 .. L/2): > 0 = b is ahead of a on track. */
export function trackGap(a: number, b: number, L: number) {
  let d = (b - a) % L;
  if (d > L / 2) d -= L;
  else if (d < -L / 2) d += L;
  return d;
}

export function tactics(b: Bot, me: Car, cars: Car[], w: BotWorld, dt: number) {
  const T = w.track, n = T.n, L = n * T.spacing, R = AI.race, hw = w.hw(b.idx), off = w.line.off[b.idx], v = Math.max(8, b.v);
  let ahead: Car | null = null, behind: Car | null = null, aGap = 1e9, bGap = -1e9, lapper: Car | null = null, side: Car | null = null;
  for (const c of cars) {
    if (c === me) continue;
    const g = trackGap(me.s, c.s, L);
    if (g > 0 && g < aGap && Math.abs(c.lat - me.lat) < R.clearance * 1.6) { aGap = g; ahead = c; }
    if (g < 0 && g > bGap) { bGap = g; behind = c; }
    if (g > -80 && g < 0 && c.s > me.s + L * 0.5) lapper = c; // a car a lap (or more) up is coming through
    if (Math.abs(g) < 5.5 && Math.abs(c.lat - me.lat) < 3.2) side = c;
  }
  b.gapAhead = ahead ? aGap / v : Infinity;
  b.gapBehind = behind ? -bGap / Math.max(8, behind.v) : Infinity;
  b.cap = Infinity;
  b.defending = false;
  b.tactT = Math.max(0, b.tactT - dt);
  if (b.recover) return;
  const pitting = !!b.f1?.pit;
  const nextCorner = cornerAhead(b, w, 160), inside = nextCorner ? -Math.sign(T.curvature(nextCorner)) : 0;
  const limit = hw - 1.3;

  // blue flag: move off the line and lift a little, no defending against a car lapping you
  if (lapper && !pitting) {
    const out = inside ? -inside : Math.sign(me.lat - lapper.lat) || 1;
    b.tact = clamp(out * 3.2 + me.lat * 0.2, -limit, limit) - off;
    b.cap = b.v * 0.97;
    b.tactT = 1;
    return;
  }

  if (ahead && aGap < 40 && !pitting) {
    const closing = me.v - ahead.v, follow = (R.followGap[0] + (R.followGap[1] - R.followGap[0]) * b.prof.aggression) * v;
    const wantPass = b.tactT > 0 || (closing > 0.5 && aGap < 22 && b.prof.aggression > 0.2 + (b.mistake ? 0.5 : 0)) || (aGap < follow && closing > -1);
    if (wantPass) {
      if (b.tactT <= 0) {
        // pick a side once and commit to it: the inside of the next corner if there is room, else the other side
        let sideSign = inside || (me.lat >= ahead.lat ? 1 : -1);
        const room = (s: number) => Math.abs(ahead!.lat + s * R.passOffset) < limit;
        if (!room(sideSign)) sideSign = -sideSign;
        if (room(sideSign)) { b.tact = clamp(ahead.lat + sideSign * R.passOffset, -limit, limit) - off; b.tactT = R.commit * (0.6 + b.prof.aggression); }
      }
    }
    // still lined up behind (no room beside it yet): never closer than a car length + margin, and arrive at its speed with
    // a braking distance the car can really make, so a queue into a hairpin doesn't turn into bumper cars
    if (Math.abs(me.lat - ahead.lat) < R.clearance) {
      const len = b.def.f1 ? 7 : b.isCar ? 6 : 3.5, dec = b.def.f1 ? 14 : 8;
      b.cap = Math.max(0, ahead.v + Math.sqrt(2 * dec * Math.max(0, aGap - len - follow * 0.25)) - (aGap < len ? 2 : 0));
    }
  } else if (b.tactT <= 0 && !b.mistake) b.tact *= 0.9; // back onto the line

  // defend: one move to the inside when attacked before a corner, held until the corner (no weaving)
  if (!pitting && behind && b.gapBehind < R.defendGap && behind.v > me.v - 1 && nextCorner && b.prof.defending > 0.35) {
    b.defending = true;
    if (!b.defended && inside) {
      b.defended = true;
      b.tact = clamp(inside * Math.min(limit, 2.6 * b.prof.defending + 0.6), -limit, limit) - off;
      b.tactT = 2.5;
    }
  }
  if (!nextCorner) b.defended = false;

  // never squeeze a car that is alongside: hold the current lane toward it
  if (side) {
    const towards = Math.sign(side.lat - me.lat), wantDir = Math.sign(b.tact + off - me.lat);
    if (towards === wantDir && Math.abs(side.lat - me.lat) < R.clearance + 0.6) b.tact = me.lat - towards * 0.4 - off;
  }

  // F1: overtake mode (within 1 s) and DRS detection at the zone entry
  const f1 = b.f1;
  if (f1) {
    f1.overtake = b.gapAhead < F1.overtakeGap;
    const inZone = !!w.inDrs?.(b.idx);
    if (inZone && !b.inZone) f1.drsOk = b.gapAhead < 1; // detection point: gap measured once, at the zone entry
    if (!inZone) f1.drsOk = false;
    b.inZone = inZone;
  }
}

/** Index of the next real corner within `dist` metres (0 = none). */
export function cornerAhead(b: Bot, w: BotWorld, dist: number) {
  const T = w.track, n = T.n, steps = Math.round(dist / T.spacing);
  for (let k = 4; k < steps; k += 3) {
    const i = (b.idx + k) % n;
    if (Math.abs(T.curvature(i)) > 0.12) return i;
  }
  return 0;
}

// Headless test harness: drive bots around a track with no walls (unit tests and tuning). Not used by the game.
import type { TrackLine } from '../world/layout';
import { ROAD, type AiLevelId, type TyreCompound } from '../config';
import { vehicleById } from '../data/vehicles';
import { makeBot, placeBot, stepBot, type Bot, type BotWorld } from './driver';
import { makeField } from './personality';
import { defaultLine, lapEstimate, speedProfile, type HalfWidthFn } from './racingLine';

export function openWorld(track: TrackLine, hw: HalfWidthFn, grip = 1): BotWorld {
  const line = defaultLine(track, hw);
  return {
    track, line, hw, envGrip: grip, wet: 0,
    onRoad: (x, z) => track.nearest(x, z, true).d < hw(0) + 1.5,
    roadDist: (x, z) => track.nearest(x, z, true).d - hw(0) + ROAD.asphalt,
    blocked: () => false,
    contact: () => ({ x: 0, z: 1, depth: 0 }),
  };
}

export interface SimResult { laps: number[]; maxLat: number; ideal: number; bot: Bot }

/** Run one bot for `laps` laps (or until `maxT`), returning lap times. */
export function runBot(w: BotWorld, vehicle: string, level: AiLevelId, laps: number, maxT = 900, compound: TyreCompound | null = null, rnd?: () => number): SimResult {
  const def = vehicleById(vehicle), T = w.track, prof = makeField(1, level, 1000, rnd)[0];
  prof.mistakesPerMin = 0;
  const vmax = speedProfile(w.line, def);
  const i0 = T.n - 4, b = makeBot('t', def, prof, vmax, T.px[i0], T.pz[i0], Math.atan2(T.tx[i0], T.tz[i0]), compound ?? (def.f1 ? 'medium' : null));
  placeBot(b, w, T.px[i0], T.pz[i0], Math.atan2(T.tx[i0], T.tz[i0]));
  const dt = 1 / 60, len = T.n * T.spacing, out: number[] = [];
  let t = 0, lastLap = Math.floor(b.s / len), maxLat = 0;
  const cross: number[] = [];
  // the first crossing ends the standing start; flying laps are measured between later crossings
  while (t < maxT && out.length < laps) {
    t += dt;
    stepBot(b, w, dt, t, true);
    const lap = Math.floor(b.s / len);
    if (lap > lastLap) { cross.push(t); if (cross.length >= 3) out.push(t - cross[cross.length - 2]); lastLap = lap; }
    if (t > 3) maxLat = Math.max(maxLat, Math.abs(b.lat) - w.hw(b.idx));
  }
  return { laps: out, maxLat, ideal: lapEstimate(w.line, def, vmax), bot: b };
}

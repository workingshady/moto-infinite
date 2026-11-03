// Racecraft rating: an Elo-like player skill estimate per discipline (race / F1 / Elimination), updated after every
// race against the computer field. Pure functions (unit-tested); career storage lives in src/ai/racecraft.ts.
//
// Update = K × (pairwise result vs every bot − expected, scaled by the margin) + K × w × (lap pace vs ideal − expected)
// − small costs for crashes and off-tracks, bounded to ±maxStep. K shrinks with the number of races (fast at first,
// stable later), like the provisional K of FIDE / Glicko's rating deviation.
import { AI } from '../config';

export interface Rating { r: number; n: number; at: number }
export type Discipline = 'race' | 'f1' | 'elim';
export const DISCIPLINES: Discipline[] = ['race', 'f1', 'elim'];

export const freshRating = (): Rating => ({ r: AI.rating.start, n: 0, at: 0 });

export interface RaceOutcome {
  /** Each opponent's strength and whether the player finished ahead of it. */
  opponents: { rating: number; beaten: boolean }[];
  /** Seconds behind the winner (0 when the player won). */
  gapToWinner: number;
  /** Seconds the player won by (0 when not first). */
  winMargin: number;
  /** Race length in seconds (scales the gap terms). */
  raceTime: number;
  /** Best lap / ideal lap − 1 (0 = as fast as the ideal pace; NaN = no full lap). */
  lapDelta: number;
  crashes: number;
  offTracks: number;
}

/** Elo expected score of a player rated r against one rated o. */
export const expected = (r: number, o: number) => 1 / (1 + Math.pow(10, (o - r) / 400));

/** K factor: kMax for a new player, halving every kHalfLife races toward kMin. */
export function kFactor(n: number) {
  const R = AI.rating;
  return R.kMin + (R.kMax - R.kMin) * Math.pow(0.5, n / R.kHalfLife);
}

/** Lap pace score 0..1 (1 = at the ideal pace, 0 = 25 % slower) and what a player of rating r is expected to score. */
export const paceScore = (lapDelta: number) => Math.min(1, Math.max(0, 1 - lapDelta / 0.25));
export const expectedPace = (r: number) => Math.min(1, Math.max(0, (r - 500) / 1000));

/** New rating after one race. Never NaN, bounded per race and overall. */
export function updateRating(cur: Rating, o: RaceOutcome, now = Date.now()): Rating & { delta: number } {
  const R = AI.rating, r = Number.isFinite(cur.r) ? cur.r : R.start, n = Math.max(0, Math.floor(cur.n) || 0);
  let pair = 0;
  for (const op of o.opponents) pair += (op.beaten ? 1 : 0) - expected(r, op.rating);
  pair = o.opponents.length ? pair / o.opponents.length : 0;
  // margin: losing by a lot (or winning by a lot) moves the rating a bit further, up to ×1.5
  const len = Math.max(20, o.raceTime || 0);
  const margin = 1 + 0.5 * Math.min(1, ((pair < 0 ? o.gapToWinner : o.winMargin) || 0) / (len * 0.05));
  const perf = Number.isFinite(o.lapDelta) ? paceScore(o.lapDelta) - expectedPace(r) : 0;
  const cost = Math.min(30, (o.crashes || 0) * R.crashCost + (o.offTracks || 0) * R.offCost);
  const K = kFactor(n);
  let delta = K * (pair * margin * 2 + perf * R.perfWeight) - cost;
  delta = Math.max(-R.maxStep, Math.min(R.maxStep, Number.isFinite(delta) ? delta : 0));
  const next = Math.max(R.min, Math.min(R.max, r + delta));
  return { r: next, n: n + 1, at: now, delta: next - r };
}

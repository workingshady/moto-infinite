import { describe, expect, it } from 'vitest';
import { AI } from '../config';
import { mulberry32 } from '../utils/math';
import { expected, freshRating, kFactor, updateRating, type RaceOutcome } from './rating';
import { makeField, paceForRating, ratingForPace } from './personality';

const outcome = (opp: { rating: number; beaten: boolean }[], extra: Partial<RaceOutcome> = {}): RaceOutcome => ({
  opponents: opp, gapToWinner: 0, winMargin: 0, raceTime: 120, lapDelta: NaN, crashes: 0, offTracks: 0, ...extra,
});

describe('Racecraft rating update', () => {
  it('beating everyone raises it, losing to everyone lowers it, within the per-race bound', () => {
    const r0 = freshRating(), field = Array.from({ length: 5 }, () => ({ rating: 1000, beaten: true }));
    const up = updateRating(r0, outcome(field, { winMargin: 30 }));
    const down = updateRating(r0, outcome(field.map((f) => ({ ...f, beaten: false })), { gapToWinner: 40 }));
    expect(up.r).toBeGreaterThan(r0.r);
    expect(down.r).toBeLessThan(r0.r);
    expect(Math.abs(up.delta)).toBeLessThanOrEqual(AI.rating.maxStep);
    expect(Math.abs(down.delta)).toBeLessThanOrEqual(AI.rating.maxStep);
    expect(up.n).toBe(1);
  });

  it('stays within the global bounds and never goes NaN on junk input', () => {
    let r = { r: AI.rating.max - 5, n: 0, at: 0 };
    for (let i = 0; i < 50; i++) r = updateRating(r, outcome([{ rating: 400, beaten: true }], { lapDelta: -1, winMargin: 1e9 }));
    expect(r.r).toBeLessThanOrEqual(AI.rating.max);
    r = { r: NaN, n: NaN, at: 0 };
    r = updateRating(r, outcome([], { lapDelta: NaN, raceTime: NaN, crashes: NaN }));
    expect(Number.isFinite(r.r)).toBe(true);
    for (let i = 0; i < 80; i++) r = updateRating(r, outcome([{ rating: 2500, beaten: false }], { crashes: 9, offTracks: 9, gapToWinner: 1e6 }));
    expect(r.r).toBeGreaterThanOrEqual(AI.rating.min);
  });

  it('an even result against equal bots barely moves it; K shrinks with experience', () => {
    const half = Array.from({ length: 4 }, (_, i) => ({ rating: 1000, beaten: i < 2 }));
    expect(Math.abs(updateRating(freshRating(), outcome(half)).delta)).toBeLessThan(1);
    expect(kFactor(0)).toBeGreaterThan(kFactor(20));
    expect(kFactor(1000)).toBeCloseTo(AI.rating.kMin, 1);
    expect(expected(1000, 1000)).toBeCloseTo(0.5);
  });

  it('converges to a player\'s true strength racing an adaptive field', () => {
    for (const T of [700, 1000, 1300]) {
      const rnd = mulberry32(T);
      let r = freshRating();
      const hist: number[] = [];
      for (let race = 0; race < 120; race++) {
        const field = makeField(7, 'adaptive', r.r, rnd);
        const opp = field.map((b) => ({ rating: b.rating, beaten: rnd() < expected(T, b.rating) }));
        const lapDelta = 0.25 * (1 - Math.min(1, Math.max(0, (T - 500) / 1000))) + (rnd() - 0.5) * 0.03;
        r = updateRating(r, outcome(opp, { lapDelta, gapToWinner: opp.every((o) => o.beaten) ? 0 : 3, winMargin: opp.every((o) => o.beaten) ? 3 : 0 }));
        hist.push(r.r);
      }
      const late = hist.slice(-40), mean = late.reduce((a, b) => a + b, 0) / late.length;
      expect(Math.abs(mean - T)).toBeLessThan(90);
      expect(Math.max(...late) - Math.min(...late)).toBeLessThan(260); // settles (bounded K), no runaway
    }
  });
});

describe('difficulty field', () => {
  it('fixed levels give ordered paces, adaptive follows the rating', () => {
    const avg = (lv: Parameters<typeof makeField>[1], r = 1000) => { const f = makeField(8, lv, r, mulberry32(3)); return f.reduce((a, b) => a + b.pace, 0) / f.length; };
    expect(avg('rookie')).toBeLessThan(avg('amateur'));
    expect(avg('amateur')).toBeLessThan(avg('pro'));
    expect(avg('pro')).toBeLessThan(avg('legend'));
    expect(avg('adaptive', 800)).toBeLessThan(avg('adaptive', 1300));
    for (const b of makeField(19, 'legend', 1000)) { expect(b.pace).toBeLessThanOrEqual(1); expect(b.catchUp).toBe(false); }
    for (const b of makeField(5, 'pro', 1000)) expect(b.catchUp).toBe(false);
    for (const b of makeField(5, 'adaptive', 1000)) expect(b.catchUp).toBe(true);
    expect(ratingForPace(paceForRating(1100))).toBeCloseTo(1100, 3);
  });
});

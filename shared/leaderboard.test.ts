import { describe, expect, it } from 'vitest';
import { LB, LB_CIRCUITS, LB_DRIFT, LB_F1, boardIsTime, boardRule, challengeFor, circuitMinLength } from './leaderboard';

const T = Date.UTC(2026, 10, 3, 12); // a Tuesday

describe('challengeFor', () => {
  it('is the same for everyone on the same day / week', () => {
    expect(challengeFor('daily', T)).toEqual(challengeFor('daily', T + 3600e3));
    expect(challengeFor('weekly', T)).toEqual(challengeFor('weekly', T + 2 * 864e5));
  });
  it('changes with the day and points at a real track and board', () => {
    const a = challengeFor('daily', T), b = challengeFor('daily', T + 864e5);
    expect(a.board).not.toBe(b.board);
    for (const [c, now] of [[a, T], [b, T + 864e5], [challengeFor('weekly', T), T]] as const) {
      if (c.mode === 'f1') expect(LB_F1[c.trackId]).toBeDefined();
      if (c.mode === 'drift') expect(LB_DRIFT[c.trackId]).toBeDefined();
      expect(boardRule(c.board, now + 3600e3)).not.toBeNull();
      expect(c.endsAt).toBeGreaterThan(now);
    }
  });
});

describe('boardRule (plausibility)', () => {
  it('rejects unknown, malformed and expired boards', () => {
    expect(boardRule('track:nowhere:bike')).toBeNull();
    expect(boardRule('track:coast:f1')).toBeNull();
    expect(boardRule('drift:docks:extra')).toBeNull();
    expect(boardRule('DROP TABLE')).toBeNull();
    const old = challengeFor('daily', T - 5 * 864e5), next = challengeFor('daily', T + 864e5);
    expect(boardRule(old.board, T)).toBeNull();
    expect(boardRule(next.board, T)).toBeNull(); // tomorrow's board isn't open yet
  });
  it('accepts yesterday\'s daily just after midnight', () => {
    const y = challengeFor('daily', T);
    expect(boardRule(y.board, T + 864e5)).not.toBeNull();
  });
  it('lap boards: fastest lap = shortest possible loop at the speed cap', () => {
    const id = Object.keys(LB_CIRCUITS)[0], r = boardRule(`track:${id}:bike`)!;
    expect(r.order).toBe('asc');
    expect(r.min).toBeCloseTo(circuitMinLength(LB_CIRCUITS[id].seed) / LB.maxSpeed);
    expect(r.max).toBe(LB.maxLap);
    const f1 = Object.keys(LB_F1)[0], rf = boardRule(`track:${f1}:f1`)!;
    expect(rf.maxSpeed).toBe(LB.maxSpeedF1);
  });
  it('drift boards rank high scores first and cap points per second', () => {
    const r = boardRule(`drift:${Object.keys(LB_DRIFT)[0]}`)!;
    expect(r.order).toBe('desc');
    expect(r.max).toBe(Math.round(LB.driftMaxPps * (LB.driftSeconds + 3)));
    expect(boardIsTime(`drift:${Object.keys(LB_DRIFT)[0]}`)).toBe(false);
    expect(boardIsTime('daily:2026-11-03:drift')).toBe(false);
    expect(boardIsTime('track:coast:car')).toBe(true);
  });
});

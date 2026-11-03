import { describe, expect, it } from 'vitest';
import { CHALLENGE_POOLS, F1_POOL, F1_POOL_V2, LB, LB_CIRCUITS, LB_DRIFT, LB_F1, POOL_V2_FROM, boardIsTime, boardRule, challengeFor, circuitMinLength, roomTrackId } from './leaderboard';

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

describe('challenge vehicle pools', () => {
  const OLD = ['street', 'superbike', 'dirt', 'cafe', 'cruiser', 'gt', 'muscle', 'rally', 'hyper', 'touring', 'roadster', 'trophy', 'drift_coupe', 'rotary', 'hatch', 'f1_2026', 'f1_v10', 'f1_classic'];
  it('periods that started before POOL_V2_FROM keep the original pools (a running challenge never changes)', () => {
    for (let t = POOL_V2_FROM - 120 * 864e5; t < POOL_V2_FROM; t += 864e5) expect(OLD).toContain(challengeFor('daily', t).vehicle);
    // the week before the cutoff, checked late in that week
    expect(OLD).toContain(challengeFor('weekly', POOL_V2_FROM - 3600e3).vehicle);
  });
  it('later periods pick from the expanded pools', () => {
    const all = new Set<string>([...CHALLENGE_POOLS.race, ...CHALLENGE_POOLS.drift, ...CHALLENGE_POOLS.f1]), seen = new Set<string>();
    for (let t = POOL_V2_FROM; t < POOL_V2_FROM + 400 * 864e5; t += 864e5) {
      const c = challengeFor('daily', t);
      expect(all.has(c.vehicle), c.vehicle).toBe(true);
      seen.add(c.vehicle);
    }
    expect([...seen].some((v) => !OLD.includes(v))).toBe(true);
  });
});

describe('F1 circuit pools', () => {
  const ORIGINAL = ['monza', 'silverstone', 'spa', 'monaco', 'suzuka', 'bahrain'];
  it('challenges that started before POOL_V2_FROM only use the original six circuits (same picks as before)', () => {
    expect(F1_POOL).toEqual(ORIGINAL);
    for (let t = POOL_V2_FROM - 200 * 864e5; t < POOL_V2_FROM; t += 864e5) {
      const c = challengeFor('daily', t);
      if (c.mode === 'f1') { expect(ORIGINAL).toContain(c.trackId); expect(c.laps).toBe(c.trackId === 'spa' ? 2 : 3); }
    }
    const w = challengeFor('weekly', POOL_V2_FROM - 3600e3);
    if (w.mode === 'f1') expect(ORIGINAL).toContain(w.trackId);
  });
  it('from POOL_V2_FROM every real circuit can be picked (never the fictional rookie track), each with a valid board', () => {
    expect(F1_POOL_V2).not.toContain('academy');
    expect(F1_POOL_V2.length).toBeGreaterThan(ORIGINAL.length);
    const seen = new Set<string>();
    for (let t = POOL_V2_FROM; t < POOL_V2_FROM + 800 * 864e5; t += 864e5) {
      const c = challengeFor('daily', t);
      if (c.mode !== 'f1') continue;
      expect(F1_POOL_V2).toContain(c.trackId);
      expect(boardRule(c.board, t + 3600e3)).not.toBeNull();
      seen.add(c.trackId);
    }
    expect([...seen].some((id) => !ORIGINAL.includes(id))).toBe(true);
  });
  it('every circuit has a plausible lap board (real length x factor at the F1 speed cap)', () => {
    for (const [id, t] of Object.entries(LB_F1)) {
      const r = boardRule(`track:${id}:f1`)!;
      expect(r.minLen).toBeCloseTo(t.km * 1000 * 0.85);
      expect(r.min).toBeGreaterThan(20);
    }
  });
  it('online rooms only accept known F1 circuits', () => {
    expect(roomTrackId('f1', 'interlagos')).toBe('interlagos');
    expect(roomTrackId('f1', 'nowhere')).toBe('monza');
    expect(roomTrackId('f1', 'constructor')).toBe('monza');
    expect(roomTrackId('race', 'coast')).toBe('coast');
  });
});

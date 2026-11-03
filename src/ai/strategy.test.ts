import { describe, expect, it } from 'vitest';
import { AI } from '../config';
import { chooseCompound, drsAllowed, ersDeploy, shouldPit, wearPerLap, type StratInput } from './strategy';

const base = (o: Partial<StratInput> = {}): StratInput => ({
  lap: 1, laps: 5, lapLen: 2500, compound: 'medium', startCompound: 'medium', wear: 0.3, stops: 0, pitWear: AI.f1.pitWear,
  gapAhead: Infinity, gapBehind: Infinity, aheadPitted: false, behindJustPitted: false, wet: false, ...o,
});

describe('F1 strategy', () => {
  it('never pits on the final lap, and makes the mandatory dry stop at the latest chance', () => {
    expect(shouldPit(base({ lap: 4, wear: 0.95 })).pit).toBe(false); // last lap: run it home
    expect(shouldPit(base({ lap: 3, wear: 0.1 }))).toEqual({ pit: true, why: 'mandatory stop' });
    expect(shouldPit(base({ lap: 3, wear: 0.1, stops: 1 })).pit).toBe(false);
    expect(shouldPit(base({ lap: 3, wear: 0.1, wet: true })).pit).toBe(false); // wet race: no two-compound rule
    expect(shouldPit(base({ laps: 2, lap: 0, wear: 0.2 })).pit).toBe(false); // short race: no mandatory stop
  });

  it('pits when the tyre can not do another lap', () => {
    const per = wearPerLap('soft', 2500);
    expect(shouldPit(base({ compound: 'soft', wear: AI.f1.lastWear - per * 0.5, stops: 1, laps: 10, lap: 2 }))).toEqual({ pit: true, why: 'worn out' });
  });

  it('opens a pit window at the wear threshold; undercut when stuck behind a car that has not stopped', () => {
    const w = base({ laps: 10, lap: 2, wear: AI.f1.pitWear - 0.05, stops: 0 });
    expect(shouldPit(w).pit).toBe(false); // in the window, not yet
    expect(shouldPit({ ...w, gapAhead: 0.8 })).toEqual({ pit: true, why: 'undercut' });
    expect(shouldPit({ ...w, gapAhead: 0.8, aheadPitted: true }).pit).toBe(false); // it already stopped: no undercut to gain
    expect(shouldPit({ ...w, wear: AI.f1.pitWear + 0.01 })).toEqual({ pit: true, why: 'window' });
  });

  it('overcut: stays out a lap when the car behind just pitted and the air is clean', () => {
    const w = base({ laps: 10, lap: 2, wear: AI.f1.pitWear + 0.02, behindJustPitted: true, gapAhead: 5 });
    expect(shouldPit(w)).toEqual({ pit: false, why: 'overcut' });
  });

  it('chooses a compound that lasts and switches compound in the dry', () => {
    expect(chooseCompound({ lap: 8, laps: 10, lapLen: 2500, startCompound: 'medium', compound: 'medium', wet: false })).toBe('soft');
    expect(chooseCompound({ lap: 1, laps: 10, lapLen: 2500, startCompound: 'medium', compound: 'medium', wet: false })).toBe('hard');
    expect(chooseCompound({ lap: 4, laps: 5, lapLen: 2500, startCompound: 'soft', compound: 'soft', wet: false })).not.toBe('soft');
  });

  it('DRS only in a zone, within 1 s at detection, not braking, on cars that have it', () => {
    expect(drsAllowed(true, 0.6, false, true)).toBe(true);
    expect(drsAllowed(true, 1.2, false, true)).toBe(false);
    expect(drsAllowed(false, 0.6, false, true)).toBe(false);
    expect(drsAllowed(true, 0.6, true, true)).toBe(false);
    expect(drsAllowed(true, 0.6, false, false)).toBe(false);
  });

  it('ERS: deploy on straights, never under braking, keep a reserve unless attacking or defending', () => {
    expect(ersDeploy(90, true, false, false, false, 0.5)).toBe(true);
    expect(ersDeploy(90, true, true, true, false, 0.5)).toBe(false); // braking = harvesting
    expect(ersDeploy(90, false, false, true, false, 0.5)).toBe(false); // not on a straight
    expect(ersDeploy(AI.f1.ersReserve + 5, true, false, false, false, 0.5)).toBe(false); // keeps the reserve
    expect(ersDeploy(AI.f1.ersReserve + 5, true, false, true, false, 0.5)).toBe(true); // attack
    expect(ersDeploy(AI.f1.ersReserve + 5, true, false, false, true, 0.5)).toBe(true); // defend
  });
});

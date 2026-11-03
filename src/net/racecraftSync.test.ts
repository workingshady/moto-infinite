// Racecraft rating in the cloud save: validated by sanitizeSave, merged by "more rated races wins".
import { describe, expect, it } from 'vitest';
import { sanitizeSave, type CareerData } from '../../shared/cloudSave';
import { emptyCareer, mergeCareer, mergeRacecraft } from './saveMerge';

const need = (l: number) => 100 * l;
const NOW = Date.UTC(2026, 5, 1);

describe('racecraft in the cloud save', () => {
  it('sanitizeSave keeps valid disciplines, clamps values and drops junk', () => {
    const career = { ...emptyCareer(), racecraft: { race: { r: 1234.56, n: 12, at: NOW }, f1: { r: 99999, n: -3, at: NOW * 10 }, elim: { r: 'x' }, drift: { r: 1000, n: 1, at: NOW } } };
    const s = sanitizeSave({ v: 1, career, sections: {}, ta: {} }, NOW)!;
    expect(s.career.racecraft?.race).toEqual({ r: 1234.6, n: 12, at: NOW });
    expect(s.career.racecraft?.f1?.r).toBe(3000);
    expect(s.career.racecraft?.f1?.n).toBe(0);
    expect(s.career.racecraft?.f1?.at).toBeLessThanOrEqual(NOW + 864e5);
    expect(s.career.racecraft?.elim).toBeUndefined();
    expect((s.career.racecraft as Record<string, unknown>).drift).toBeUndefined();
    // an older save without the block is fine
    const old = sanitizeSave({ v: 1, career: { v: 1, level: 2, xp: 0, credits: 0, earned: 0, stats: {}, unlocked: [], achievements: {} }, sections: {}, ta: {} }, NOW)!;
    expect(old.career.racecraft).toEqual({});
  });

  it('merge: the copy rated over more races wins per discipline, ties go to the newer one, never summed', () => {
    const local: CareerData['racecraft'] = { race: { r: 1100, n: 10, at: 5 }, f1: { r: 900, n: 3, at: 9 } };
    const cloud: CareerData['racecraft'] = { race: { r: 1050, n: 12, at: 4 }, f1: { r: 950, n: 3, at: 7 }, elim: { r: 1200, n: 2, at: 1 } };
    const m = mergeRacecraft(local, cloud);
    expect(m.race).toEqual({ r: 1050, n: 12, at: 4 });
    expect(m.f1).toEqual({ r: 900, n: 3, at: 9 });
    expect(m.elim).toEqual({ r: 1200, n: 2, at: 1 });
    expect(mergeRacecraft(undefined, undefined)).toEqual({});
    const merged = mergeCareer({ ...emptyCareer(), racecraft: local }, { ...emptyCareer(), racecraft: cloud }, null, need);
    expect(merged.racecraft?.race?.r).toBe(1050);
  });
});

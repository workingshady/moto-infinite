import { describe, expect, it } from 'vitest';
import type { CareerData, SaveData } from '../../shared/cloudSave';
import { emptyCareer, fromTotalXp, mergeCareer, mergeSave, mergeSections, mergeTa, totalXp } from './saveMerge';

const need = (l: number) => 100 * l; // level 1→2: 100, 2→3: 200 …
const c = (o: Partial<CareerData> & { stats?: CareerData['stats'] } = {}): CareerData => ({ ...emptyCareer(), ...o, stats: { ...(o.stats ?? {}) } });

describe('career merge', () => {
  it('total XP round-trips through level + XP', () => {
    expect(totalXp(3, 50, need)).toBe(350);
    expect(fromTotalXp(350, need)).toEqual({ level: 3, xp: 50 });
  });

  it('applies only this device’s changes since the last sync: credits never double', () => {
    const base = c({ credits: 1000, earned: 5000 });
    const cloud = c({ credits: 1200, earned: 5200 }); // other device earned 200
    const local = c({ credits: 700, earned: 5000 }); // this device spent 300
    const m = mergeCareer(local, cloud, base, need);
    expect(m.credits).toBe(900);
    expect(m.earned).toBe(5200);
  });

  it('is a no-op when nothing changed locally (re-syncing never inflates)', () => {
    const cloud = c({ level: 4, xp: 10, credits: 500, earned: 900, stats: { distance: 3000, flips: 4, topSpeed: 180 } });
    expect(mergeCareer(cloud, cloud, cloud, need)).toEqual(cloud);
    const m2 = mergeCareer(mergeCareer(cloud, cloud, cloud, need), cloud, cloud, need);
    expect(m2).toEqual(cloud);
  });

  it('adds XP gains from both devices and recomputes the level', () => {
    const base = c({ level: 2, xp: 0 }); // total 100
    const cloud = c({ level: 2, xp: 150 }); // +150
    const local = c({ level: 3, xp: 0 }); // +200
    const m = mergeCareer(local, cloud, base, need);
    expect(totalXp(m.level, m.xp, need)).toBe(450);
    expect(m).toMatchObject({ level: 3, xp: 150 });
  });

  it('sums counters, keeps records as max/min, unions lists and achievements (earliest time)', () => {
    const base = c({ stats: { distance: 1000, flips: 2, bestRank: 0, themes: ['mixed'], weatherDist: { rain: 10 } } });
    const cloud = c({ stats: { distance: 1500, flips: 2, topSpeed: 200, bestRank: 9, themes: ['mixed', 'alpine'], weatherDist: { rain: 20 } }, unlocked: ['gt'], achievements: { a: 50, b: 70 } });
    const local = c({ stats: { distance: 1300, flips: 5, topSpeed: 230, bestRank: 4, themes: ['mixed', 'desert'], weatherDist: { rain: 10, snow: 5 } }, unlocked: ['rally'], achievements: { a: 40, c: 90 } });
    const m = mergeCareer(local, cloud, base, need);
    expect(m.stats.distance).toBe(1800);
    expect(m.stats.flips).toBe(5);
    expect(m.stats.topSpeed).toBe(230);
    expect(m.stats.bestRank).toBe(4);
    expect(m.stats.themes).toEqual(['mixed', 'alpine', 'desert']);
    expect(m.stats.weatherDist).toEqual({ rain: 20, snow: 5 });
    expect(m.unlocked.sort()).toEqual(['gt', 'rally']);
    expect(m.achievements).toEqual({ a: 40, b: 70, c: 90 });
  });

  it('without a base (progress made before signing in) both progressions add up', () => {
    const m = mergeCareer(c({ credits: 100, stats: { distance: 50 } }), c({ credits: 300, stats: { distance: 70 } }), null, need);
    expect(m.credits).toBe(400);
    expect(m.stats.distance).toBe(120);
  });

  it('never goes below zero credits', () => {
    expect(mergeCareer(c({ credits: 0 }), c({ credits: 100 }), c({ credits: 500 }), need).credits).toBe(0);
  });

  it('keeps the challenge window at 20 ids', () => {
    const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`);
    const m = mergeCareer(c({ stats: { challengeKeys: ids(15, 'l') } }), c({ stats: { challengeKeys: ids(15, 'c') } }), null, need);
    expect((m.stats.challengeKeys as string[]).length).toBe(20);
  });
});

describe('sections, Time Attack and whole saves', () => {
  it('the most recent edit wins per section; ties keep the cloud copy', () => {
    const m = mergeSections(
      { settings: { at: 10, data: { fov: 70 } }, prefs: { at: 5, data: { assist: 0 } }, touch: { at: 3, data: { size: 1.2 } } },
      { settings: { at: 8, data: { fov: 60 } }, prefs: { at: 9, data: { assist: 2 } }, touch: { at: 3, data: { size: 0.9 } }, profile: { at: 1, data: { name: 'C' } } },
    );
    expect(m.settings?.data).toEqual({ fov: 70 });
    expect(m.prefs?.data).toEqual({ assist: 2 });
    expect(m.touch?.data).toEqual({ size: 0.9 });
    expect(m.profile?.data).toEqual({ name: 'C' });
  });

  it('Time Attack keeps the faster time and better medal', () => {
    expect(mergeTa({ 'ta:a:x': { best: 60, medal: 2 }, 'ta:b:x': { best: 50, medal: 1 } }, { 'ta:a:x': { best: 62, medal: 3 } })).toEqual({ 'ta:a:x': { best: 60, medal: 3 }, 'ta:b:x': { best: 50, medal: 1 } });
  });

  it('an empty cloud takes the local save as is', () => {
    const local: SaveData = { v: 1, career: c({ credits: 5 }), sections: {}, ta: {} };
    expect(mergeSave(local, null, null, need)).toBe(local);
  });
});

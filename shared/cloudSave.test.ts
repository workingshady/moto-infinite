import { describe, expect, it } from 'vitest';
import { SAVE_LIMITS, sanitizeSave, stableJson } from './cloudSave';

const NOW = Date.UTC(2026, 10, 3);
const career = { v: 1, level: 7, xp: 120, credits: 900, earned: 4000, stats: { distance: 12000, topSpeed: 210, themes: ['alpine'], weatherDist: { rain: 300 } }, unlocked: ['gt'], achievements: { first_km: NOW - 1000 } };

describe('sanitizeSave', () => {
  it('keeps a valid save', () => {
    const s = sanitizeSave({ v: 1, career, sections: { settings: { at: NOW, data: { fov: 70 } } }, ta: { 'ta:coast:street': { best: 61.2345, medal: 3 } } }, NOW)!;
    expect(s.career.level).toBe(7);
    expect(s.career.stats.themes).toEqual(['alpine']);
    expect(s.career.stats.weatherDist).toEqual({ rain: 300 });
    expect(s.sections.settings?.data).toEqual({ fov: 70 });
    expect(s.ta['ta:coast:street']).toEqual({ best: 61.235, medal: 3 });
  });

  it('rejects things that are not saves', () => {
    expect(sanitizeSave(null)).toBeNull();
    expect(sanitizeSave({ v: 2, career })).toBeNull();
    expect(sanitizeSave({ v: 1 })).toBeNull();
    expect(sanitizeSave([1, 2])).toBeNull();
  });

  it('clamps implausible numbers', () => {
    const s = sanitizeSave({ v: 1, career: { ...career, level: 1e9, credits: -5, xp: Infinity, earned: 'lots', stats: { topSpeed: 99999, distance: -1, bestMedal: 9 } }, sections: {}, ta: {} }, NOW)!;
    expect(s.career.level).toBe(SAVE_LIMITS.level);
    expect(s.career.credits).toBe(0);
    expect(s.career.xp).toBe(0);
    expect(s.career.earned).toBe(0);
    expect(s.career.stats.topSpeed).toBe(2000);
    expect(s.career.stats.distance).toBe(0);
    expect(s.career.stats.bestMedal).toBe(4);
  });

  it('drops bad keys, ids, timestamps, oversized sections and unknown Time Attack keys', () => {
    const s = sanitizeSave({
      v: 1,
      career: { ...career, unlocked: ['gt', 'gt', 3, '<script>'], achievements: { ok: NOW, old: 5, 'bad id!': NOW }, stats: { 'bad-key': 1 } },
      sections: { settings: { at: NOW, data: { big: 'x'.repeat(SAVE_LIMITS.sectionBytes + 1) } }, prefs: { at: NOW, data: [1] }, bogus: { at: 1, data: {} } },
      ta: { 'ta:coast:street': { best: 1e9, medal: 2 }, 'other:thing': { best: 1, medal: 1 } },
    }, NOW)!;
    expect(s.career.unlocked).toEqual(['gt']);
    expect(Object.keys(s.career.achievements).sort()).toEqual(['ok', 'old']);
    expect(s.career.achievements.old).toBe(Date.UTC(2024, 0, 1)); // clamped to the earliest plausible time
    expect(s.career.stats['bad-key']).toBeUndefined();
    expect(s.sections).toEqual({});
    expect(s.ta).toEqual({ 'ta:coast:street': { best: SAVE_LIMITS.taBest, medal: 2 } });
  });

  it('stableJson ignores key order', () => {
    expect(stableJson({ b: 1, a: [{ y: 1, x: 2 }] })).toBe(stableJson({ a: [{ x: 2, y: 1 }], b: 1 }));
  });
});

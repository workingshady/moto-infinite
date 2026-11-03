import { describe, expect, it } from 'vitest';
import { activeWeathers, DEFAULT_GEN, DEFAULT_SETTINGS, FIXED_WEATHERS, GEN_MAX, MAX_PLAYERS, ROOM_CODE_RE, WEATHERS, type FixedWeather } from './protocol';

describe('activeWeathers', () => {
  it('dynamic weather means "changing" (no fixed layers)', () => {
    expect(activeWeathers({ weather: 'dynamic' })).toEqual([]);
    expect(activeWeathers({ weather: 'dynamic', weathers: ['rain', 'fog'] })).toEqual([]);
  });

  it('falls back to the single weather when no set is picked', () => {
    expect(activeWeathers({ weather: 'rain' })).toEqual(['rain']);
    expect(activeWeathers({ weather: 'snow', weathers: [] })).toEqual(['snow']);
  });

  it('layers the picked set and drops unknown entries (old clients / tampered rooms)', () => {
    expect(activeWeathers({ weather: 'clear', weathers: ['fog', 'rain', 'storm'] })).toEqual(['fog', 'rain', 'storm']);
    const bad = ['fog', 'lava', 'dynamic'] as unknown as FixedWeather[];
    expect(activeWeathers({ weather: 'clear', weathers: bad })).toEqual(['fog']);
    expect(activeWeathers({ weather: 'hail', weathers: ['nope'] as unknown as FixedWeather[] })).toEqual(['hail']);
  });
});

describe('protocol constants', () => {
  it('fixed weathers are every weather except dynamic', () => {
    expect(FIXED_WEATHERS).not.toContain('dynamic');
    expect(FIXED_WEATHERS.length).toBe(WEATHERS.length - 1);
  });

  it('room codes', () => {
    for (const ok of ['ABCD', 'AB12C', 'Z9Z9Z9Z9']) expect(ROOM_CODE_RE.test(ok)).toBe(true);
    for (const bad of ['abc', 'ABC', 'ABCDEFGHJ', 'AB-CD', '', 'abcd']) expect(ROOM_CODE_RE.test(bad)).toBe(false);
  });

  it('default settings are valid', () => {
    expect(DEFAULT_SETTINGS.maxPlayers).toBeLessThanOrEqual(MAX_PLAYERS);
    expect(WEATHERS).toContain(DEFAULT_SETTINGS.weather);
    for (const k of Object.keys(DEFAULT_GEN) as (keyof typeof DEFAULT_GEN)[]) {
      expect(DEFAULT_GEN[k]).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_GEN[k]).toBeLessThanOrEqual(GEN_MAX[k]);
    }
    expect(DEFAULT_SETTINGS.gen).not.toBe(DEFAULT_GEN); // a copy, so editing settings can't change the default
  });
});

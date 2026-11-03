// prefs.ts reads localStorage once at import time: each case stubs storage and re-imports the module.
import { afterEach, describe, expect, it, vi } from 'vitest';

const DEFAULTS = { nitroToggle: false, onboarded: false, assist: 1, music: 0.6, sfx: 1, cams: ['chase', 'chase'] };

function storage(value: string | null, opts: { throwOnGet?: boolean; throwOnSet?: boolean } = {}) {
  const data = new Map<string, string>();
  if (value !== null) data.set('moto:prefs', value);
  return {
    data,
    getItem: vi.fn((k: string) => { if (opts.throwOnGet) throw new Error('SecurityError'); return data.get(k) ?? null; }),
    setItem: vi.fn((k: string, v: string) => { if (opts.throwOnSet) throw new Error('QuotaExceededError'); data.set(k, v); }),
  };
}

async function load(store: ReturnType<typeof storage>) {
  vi.resetModules();
  vi.stubGlobal('localStorage', store);
  return import('./prefs');
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('prefs', () => {
  it('uses defaults when nothing is saved', async () => {
    const { prefs } = await load(storage(null));
    expect(prefs).toEqual(DEFAULTS);
  });

  it('merges saved values over the defaults', async () => {
    const { prefs } = await load(storage(JSON.stringify({ music: 0.2, onboarded: true })));
    expect(prefs).toEqual({ ...DEFAULTS, music: 0.2, onboarded: true });
  });

  it.each([
    ['broken JSON', '{"music": 0.2'],
    ['null', 'null'],
    ['a number', '42'],
    ['empty string', ''],
  ])('survives corrupt storage: %s', async (_label, raw) => {
    const { prefs } = await load(storage(raw));
    expect(prefs).toMatchObject(DEFAULTS);
  });

  it('survives storage that throws (private mode / blocked cookies)', async () => {
    const { prefs, savePrefs } = await load(storage(null, { throwOnGet: true, throwOnSet: true }));
    expect(prefs).toEqual(DEFAULTS);
    expect(() => savePrefs()).not.toThrow();
  });

  it('savePrefs writes JSON that loads back the same', async () => {
    const s = storage(null);
    const first = await load(s);
    first.prefs.assist = 2;
    first.prefs.cams = ['fp', 'top'];
    first.savePrefs();
    const again = await load(s);
    expect(again.prefs).toEqual({ ...DEFAULTS, assist: 2, cams: ['fp', 'top'] });
  });
});

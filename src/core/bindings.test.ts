// bindings.ts writes into Input's live tables and saves through settings.ts: stub storage + a bare document.
import { afterEach, describe, expect, it, vi } from 'vitest';

function storage(settings?: unknown) {
  const data = new Map<string, string>();
  if (settings !== undefined) data.set('moto:settings', JSON.stringify(settings));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}
async function load(s = storage()) {
  vi.resetModules();
  vi.stubGlobal('localStorage', s);
  vi.stubGlobal('document', { body: null });
  vi.stubGlobal('navigator', {});
  const b = await import('./bindings'), input = await import('./Input');
  return { ...b, ...input, s };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('rebinding', () => {
  it('a key taken by another action is swapped onto it', async () => {
    const { bindKey, BINDINGS } = await load();
    // fire = F, ride = E: put E on fire's first slot → ride gets F
    const msg = bindKey('solo', 'fire', 0, 'KeyE');
    expect(BINDINGS.solo.fire).toEqual(['KeyE']);
    expect(BINDINGS.solo.ride).toEqual(['KeyF']);
    expect(msg).toMatch(/swapped/);
  });
  it('adding a key in a new slot takes it away from the other action', async () => {
    const { bindKey, BINDINGS } = await load();
    bindKey('solo', 'fire', 1, 'KeyQ');
    expect(BINDINGS.solo.fire).toEqual(['KeyF', 'KeyQ']);
    expect(BINDINGS.solo.weapon).toEqual([]);
  });
  it('nitro and jump may share, card picks may share with riding keys', async () => {
    const { bindKey, BINDINGS } = await load();
    bindKey('solo', 'jump', 0, 'ShiftLeft');
    expect(BINDINGS.solo.nitro).toContain('ShiftLeft');
    bindKey('solo', 'pick1', 0, 'KeyW');
    expect(BINDINGS.solo.up).toContain('KeyW');
  });
  it('reserved keys are refused', async () => {
    const { bindKey, BINDINGS } = await load();
    expect(bindKey('solo', 'fire', 0, 'Escape')).toMatch(/reserved/);
    expect(BINDINGS.solo.fire).toEqual(['KeyF']);
  });
  it('warns about fixed feature keys instead of clashing silently', async () => {
    const { bindKey, keyNote } = await load();
    expect(bindKey('solo', 'fire', 0, 'KeyI')).toMatch(/instant replay/);
    expect(keyNote('solo', 'nitro', 'Digit5')).toMatch(/quick chat in online rooms/);
    expect(keyNote('p2', 'pick1', 'Digit8')).toBe(''); // split screen is never online
    expect(keyNote('solo', 'reroll', 'KeyT')).toBe(''); // default sharing, handled by the chat key logic
  });
  it('saves only the differences and loads them back', async () => {
    const first = await load();
    first.bindKey('solo', 'camera', 0, 'KeyJ'); // a free key (G is the Roadster lift)
    const saved = JSON.parse(first.s.data.get('moto:settings')!);
    expect(saved.keys.solo).toEqual({ camera: ['KeyJ'] });
    const again = await load(first.s);
    expect(again.BINDINGS.solo.camera).toEqual(['KeyJ']);
  });
  it('corrupt overrides fall back to the defaults', async () => {
    const { BINDINGS, PAD } = await load(storage({ keys: { solo: { fire: 'KeyF', ride: [1, 2] } }, pad: { fire: 7, jump: ['a'] } }));
    expect(BINDINGS.solo.fire).toEqual(['KeyF']);
    expect(BINDINGS.solo.ride).toEqual(['KeyE']);
    expect(PAD.fire).toEqual([2]);
    expect(PAD.jump).toEqual([1]);
  });
  it('a damaged settings object does not break loading', async () => {
    const { BINDINGS } = await load(storage({ keys: null, pad: 'x', fpsCap: 'fast' }));
    expect(BINDINGS.solo.up).toEqual(['ArrowUp', 'KeyW']);
  });
});

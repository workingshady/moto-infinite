// Display / camera / HUD / controller settings: device defaults, validation of saved values, UI size, frame pacing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAMERA, UI_SIZE } from '../config';

async function load(saved?: unknown, phone = false) {
  vi.resetModules();
  const data = new Map<string, string>();
  if (saved !== undefined) data.set('moto:settings', typeof saved === 'string' ? saved : JSON.stringify(saved));
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: phone && q.includes('coarse') }));
  vi.stubGlobal('screen', phone ? { width: 412, height: 915 } : { width: 1920, height: 1080 });
  vi.stubGlobal('document', { body: null });
  vi.stubGlobal('navigator', {});
  return import('./settings');
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('settings defaults', () => {
  it('phones start with the wider, further camera, 60 fps and auto UI size', async () => {
    const m = await load(undefined, true);
    expect(m.isPhoneScreen()).toBe(true);
    expect(m.settings).toMatchObject({ fov: CAMERA.phone.fov, camDist: CAMERA.phone.dist, camHeight: CAMERA.phone.height, fpsCap: 60, uiSize: 'auto', uiScale: 1, edgePad: 0, hudHide: [], gaugeStyle: 'dial', padPreset: 'default' });
    expect(m.fovOffset()).toBe(CAMERA.phone.fov - CAMERA.baseFov);
  });
  it('desktops keep the classic camera and no frame cap', async () => {
    const m = await load();
    expect(m.settings).toMatchObject({ fov: CAMERA.baseFov, camDist: 1, camHeight: 1, fpsCap: 0 });
    expect(m.fovOffset()).toBe(0);
  });
});

describe('saved settings load safely', () => {
  it('clamps numbers, rejects unknown choices and filters HUD parts', async () => {
    const m = await load({
      fov: 500, camDist: -3, camHeight: 'x', uiScale: 9, edgePad: 999, uiSize: 'huge', fpsCap: 45, gaugeStyle: 'analog', padPreset: 'pro', padSticks: 'left',
      hudHide: ['minimap', 'minimap', 'radar', 3, 'chat'], mapSize: 0, units: 'mph', keys: null,
    });
    const s = m.settings;
    expect(s.fov).toBe(CAMERA.fov[1]);
    expect(s.camDist).toBe(CAMERA.dist[0]);
    expect(s.camHeight).toBe(1);
    expect(s.uiScale).toBe(UI_SIZE.fine[1]);
    expect(s.edgePad).toBe(UI_SIZE.edgePad[1]);
    expect(s).toMatchObject({ uiSize: 'auto', fpsCap: 0, gaugeStyle: 'dial', padPreset: 'default', padSticks: 'normal', mapSize: 0.7, units: 'mph', keys: {} });
    expect(s.hudHide).toEqual(['minimap', 'chat']);
  });
  it('survives unreadable JSON and a non-object', async () => {
    expect((await load('{"fov":')).settings.fov).toBe(CAMERA.baseFov);
    expect((await load([1, 2])).settings.uiSize).toBe('auto');
  });
  it('cleanSettings validates cloud data over the live values', async () => {
    const m = await load();
    const live = { ...m.settings, camDist: 1.3 };
    expect(m.cleanSettings({ camDist: 'far', hudHide: 'all' }, live)).toMatchObject({ camDist: 1.3, hudHide: [] });
  });
});

describe('UI size', () => {
  it('auto is compact on short landscape screens only', async () => {
    const { uiFactor } = await load();
    expect(uiFactor({ uiSize: 'auto', uiScale: 1 }, 915, 412)).toBe(UI_SIZE.presets.compact);
    expect(uiFactor({ uiSize: 'auto', uiScale: 1 }, 800, 360)).toBe(UI_SIZE.presets.compact);
    expect(uiFactor({ uiSize: 'auto', uiScale: 1 }, 412, 915)).toBe(1);
    expect(uiFactor({ uiSize: 'auto', uiScale: 1 }, 1366, 768)).toBe(1);
    expect(uiFactor({ uiSize: 'large', uiScale: 1.2 }, 915, 412)).toBeCloseTo(UI_SIZE.presets.large * 1.2, 3);
  });
  it('compact keeps 13 px menu text at 11 px or more', () => {
    expect(13 * UI_SIZE.presets.compact).toBeGreaterThanOrEqual(11);
  });
});

describe('frame pacing', () => {
  it('a 60 fps cap renders 60 of 90 Hz frames, all of 60 Hz, half of 120 Hz', async () => {
    const { paceFrame } = await load();
    for (const [hz, want] of [[90, 60], [60, 60], [120, 60], [144, 60]] as const) {
      let due = 0, n = 0;
      for (let i = 0; i < hz * 2; i++) {
        const next = paceFrame((i * 1000) / hz, due, 60);
        if (next >= 0) { due = next; n++; }
      }
      expect(n / 2, `${hz} Hz`).toBeGreaterThan(want - 2);
      expect(n / 2, `${hz} Hz`).toBeLessThan(want + 2);
    }
  });
});

describe('controller presets', () => {
  it('racing puts throttle / brake on the triggers, southpaw swaps the sticks, rebinding marks custom', async () => {
    await load();
    const b = await import('./bindings'), input = await import('./Input'), s = await import('./settings');
    b.applyPadPreset('racing');
    expect(input.PAD.up).toEqual([7, 12]);
    expect(input.PAD.down).toEqual([6, 13]);
    expect(input.PAD.up).not.toContain(0);
    expect(s.settings.padPreset).toBe('racing');
    b.applyPadPreset('southpaw');
    expect(s.settings.padSticks).toBe('swapped');
    expect(input.PAD.up).toContain(0);
    b.bindPad('fire', 0, 3);
    expect(s.settings.padPreset).toBe('custom');
    b.resetBindings('pad');
    expect(s.settings).toMatchObject({ padPreset: 'default', padSticks: 'normal' });
  });
});

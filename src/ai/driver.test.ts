// Steering + throttle/brake controllers on real tracks, with the shared vehicle physics: every difficulty completes
// clean laps within a sensible band of the ideal pace, and Legend is faster than Rookie.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Circuit } from '../world/layout';
import { Noise } from '../utils/noise';
import { mulberry32 } from '../utils/math';
import { setRand } from './driver';
import { openWorld, runBot } from './simHarness';

vi.mock('../entities/assets', async () => {
  const T = await import('three');
  return { G: {}, MAT: {}, M: () => new T.MeshBasicMaterial(), canvasTex: () => new T.Texture(), mesh: () => new T.Object3D() };
});
const { F1Track } = await import('../world/F1Track');

beforeAll(() => setRand(mulberry32(7)));

describe('bot controllers on a circuit (road cars and bikes)', () => {
  const track = new Circuit(new Noise(1201), 1201), w = openWorld(track, () => 7.5);
  for (const veh of ['gt', 'muscle', 'street']) {
    it(`${veh}: every level laps cleanly, inside the track, near the ideal pace; Legend beats Rookie`, () => {
      const res: Record<string, number> = {};
      for (const lv of ['rookie', 'amateur', 'pro', 'legend'] as const) {
        const r = runBot(w, veh, lv, 2, 600, null, mulberry32(3));
        expect(r.laps.length, `${veh} ${lv} laps`).toBe(2);
        expect(r.maxLat, `${veh} ${lv} beyond the edge`).toBeLessThan(0.5);
        expect(r.bot.recover).toBe(0);
        const lap = Math.min(...r.laps);
        res[lv] = lap;
        // band: never faster than the ideal profile lap minus a little, never absurdly slow
        expect(lap).toBeGreaterThan(r.ideal * 0.97);
        expect(lap).toBeLessThan(r.ideal * (lv === 'legend' ? 1.08 : lv === 'pro' ? 1.15 : 1.4));
        // consistent: two flying laps within 3 %
        expect(Math.abs(r.laps[0] - r.laps[1]) / lap).toBeLessThan(0.03);
      }
      expect(res.legend).toBeLessThan(res.pro);
      expect(res.pro).toBeLessThan(res.amateur);
      expect(res.amateur).toBeLessThan(res.rookie);
    });
  }
});

describe('bot controllers in Formula 1 (real circuits, downforce, tyres)', () => {
  for (const id of ['monza', 'monaco'] as const) {
    it(`${id}: Legend and Rookie complete a flying lap inside the track; Legend is faster`, () => {
      const t = new F1Track(new Noise(1), id), w = openWorld(t, (i) => t.halfWidthAt(i));
      const leg = runBot(w, 'f1_2026', 'legend', 1, 500, 'medium', mulberry32(1));
      const roo = runBot(w, 'f1_2026', 'rookie', 1, 500, 'medium', mulberry32(1));
      for (const r of [leg, roo]) {
        expect(r.laps.length).toBe(1);
        expect(r.maxLat).toBeLessThan(0.5);
        expect(r.bot.f1!.wear).toBeGreaterThan(0); // the tyres wear like the player's
      }
      expect(leg.laps[0]).toBeLessThan(roo.laps[0]);
      expect(leg.laps[0]).toBeLessThan(leg.ideal * 1.08);
      expect(leg.laps[0]).toBeGreaterThan(leg.ideal * 0.97);
    });
  }
});

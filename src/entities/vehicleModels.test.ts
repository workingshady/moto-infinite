// Builds every garage model in Node: three.js geometry needs no WebGL, only the canvas textures need a stub.
import { beforeAll, describe, expect, it } from 'vitest';
import type * as VM from './vehicleModels';
import { VEHICLES } from '../data/vehicles';

let buildVehicleModel: typeof VM.buildVehicleModel;

beforeAll(async () => {
  // 2D context stub: every method is a no-op, every property assignable
  const gradient = () => ({ addColorStop() {} });
  const ctx = new Proxy({}, {
    get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? gradient : () => undefined),
    set: () => true,
  });
  (globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }) };
  ({ buildVehicleModel } = await import('./vehicleModels'));
});

describe('vehicle models', () => {
  it('every vehicle builds a model of its kind with wheels, a seat and finite geometry', () => {
    for (const v of VEHICLES) {
      const m = buildVehicleModel(v.id, 0x3388ff);
      expect(m.kind, v.id).toBe(v.kind);
      expect(m.wheels.length, v.id).toBeGreaterThanOrEqual(2);
      expect(m.wheelRadius, v.id).toBeGreaterThan(0);
      expect(m.seat, v.id).toBeDefined();
      if (v.f1) expect(m.tyreBands, v.id).toBeDefined();
      let meshes = 0;
      m.root.traverse((o) => {
        const pos = (o as { geometry?: { attributes?: { position?: { array: ArrayLike<number> } } } }).geometry?.attributes?.position;
        if (!pos) return;
        meshes++;
        for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) throw new Error(`${v.id}: non-finite vertex`);
      });
      expect(meshes, v.id).toBeGreaterThan(8);
      // electric drivetrains never show the exhaust flame (player, AI, online, replay all build through here)
      expect(m.flame.visible, v.id).toBe(v.engine.type !== 'electric');
    }
  });
});

import { describe, expect, it } from 'vitest';
import { VEHICLES } from './vehicles';
import { EXTRA_VEHICLE_IDS } from './vehiclesExtra';
import { LOOKS } from './vehicleLooks';
import { CHALLENGE_POOLS } from '../../shared/leaderboard';

const STARTERS = ['street', 'dirt', 'drift_coupe', 'hatch', 'f1_2026'];
const ENGINE_TYPES = ['single', 'twin', 'vtwin', 'i4', 'i6', 'v8', 'v10', 'rotary', 'hybrid', 'twostroke', 'flat', 'v12', 'electric'];

describe('garage data (every vehicle)', () => {
  it('has unique ids the online room and leaderboards accept (worker cleanId: [a-z0-9_], 16 chars)', () => {
    const ids = VEHICLES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(20 + EXTRA_VEHICLE_IDS.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z0-9_]{1,16}$/);
  });

  it('has a usable engine sound profile', () => {
    for (const v of VEHICLES) {
      const e = v.engine;
      expect(ENGINE_TYPES, v.id).toContain(e.type);
      expect(e.cyl, v.id).toBeGreaterThan(0);
      expect(e.gears, v.id).toBeGreaterThanOrEqual(1);
      expect(e.idle, v.id).toBeGreaterThan(0);
      expect(e.redline, v.id).toBeGreaterThan(e.idle);
      if (e.type === 'electric') {
        expect(e.gears, v.id).toBe(1);
        expect(e.crackle ?? 0, v.id).toBe(0);
        expect(e.turbo ?? false, v.id).toBe(false);
      }
    }
  });

  it('is a starter or has a sane career unlock', () => {
    for (const v of VEHICLES) {
      if (STARTERS.includes(v.id)) {
        expect(v.unlock, v.id).toBeUndefined();
        continue;
      }
      expect(v.unlock, v.id).toBeDefined();
      expect(v.unlock!.level, v.id).toBeGreaterThanOrEqual(2);
      expect(v.unlock!.level, v.id).toBeLessThanOrEqual(15);
      expect(v.unlock!.price, v.id).toBeGreaterThan(0);
      expect(Number.isInteger(v.unlock!.price), v.id).toBe(true);
    }
    // every class keeps a starter: bikes, cars and F1 are playable on a fresh save
    expect(VEHICLES.some((v) => !v.unlock && v.kind === 'bike')).toBe(true);
    expect(VEHICLES.some((v) => !v.unlock && v.kind === 'car' && !v.f1)).toBe(true);
    expect(VEHICLES.some((v) => !v.unlock && v.f1)).toBe(true);
  });

  it('expansion vehicles have a look of the right kind; Formula 1 class = f1 spec', () => {
    for (const id of EXTRA_VEHICLE_IDS) {
      const v = VEHICLES.find((x) => x.id === id)!, look = LOOKS[id];
      expect(look, id).toBeDefined();
      expect(look.kind, id).toBe(v.kind === 'bike' ? 'bike' : v.f1 ? 'formula' : 'car');
    }
    for (const v of VEHICLES) {
      expect(!!v.f1, v.id).toBe(v.cls === 'Formula 1');
      if (v.f1) expect(v.kind, v.id).toBe('car');
    }
  });

  it('only electric cars have an EV drive, only the Roadster has thrusters', () => {
    for (const v of VEHICLES) {
      if (v.ev) expect(v.engine.type, v.id).toBe('electric');
      expect(!!v.ev?.thrusters, v.id).toBe(v.id === 'tesla_roadster');
    }
  });

  it('daily/weekly challenge pools pick real vehicles that fit the mode', () => {
    const by = (id: string) => VEHICLES.find((v) => v.id === id);
    for (const id of CHALLENGE_POOLS.f1) expect(by(id)?.f1, id).toBeDefined();
    for (const id of CHALLENGE_POOLS.drift) {
      expect(by(id)?.kind, id).toBe('car');
      expect(by(id)?.f1, id).toBeUndefined();
    }
    for (const id of CHALLENGE_POOLS.race) {
      expect(by(id), id).toBeDefined();
      expect(by(id)!.f1, id).toBeUndefined();
      expect(by(id)!.ev?.thrusters, id).toBeFalsy();
    }
  });
});

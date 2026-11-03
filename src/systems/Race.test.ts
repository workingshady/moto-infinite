// Race logic (countdown, checkpoints, laps, progress, standings) without WebGL: scene meshes are stubbed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Circuit } from '../world/layout';
import { Noise } from '../utils/noise';
import { RACE } from '../config';
import type { Game } from '../core/Game';

vi.mock('../entities/assets', async () => {
  const T = await import('three');
  return { G: {}, MAT: {}, mesh: () => new T.Object3D() };
});
vi.mock('../entities/models', async () => {
  const T = await import('three');
  return { buildGhost: () => new T.Group() };
});

const { Race, fmt } = await import('./Race');

const track = new Circuit(new Noise(21), 21);

function fakePlayer(index: number) {
  return {
    index, name: `P${index + 1}`, color: 0xff0000 + index, controlsLocked: false,
    P: { x: 0, z: 0 },
    race: { lap: 0, nextCp: 0, lapStart: 0, lastLap: 0, best: 0, finished: false, finishTime: 0, prog: -1, place: 1 },
    hud: { countdown: vi.fn(), banner: vi.fn() },
    f1: { stops: 0, penalty: 0 },
  };
}
type FakePlayer = ReturnType<typeof fakePlayer>;

function fakeGame(players: FakePlayer[]) {
  return {
    layout: track, players, net: null, ai: null, remotes: null, time: 0,
    scene: new THREE.Scene(),
    terrain: { heightAt: () => 0 },
    audio: { play: vi.fn() },
    hooks: { onRaceResults: vi.fn() },
    opts: { weather: 'clear', session: 'race' },
  };
}

const DT = 0.05;
function step(race: InstanceType<typeof Race>, g: ReturnType<typeof fakeGame>) {
  g.time += DT;
  race.update(DT);
}
function startRace(race: InstanceType<typeof Race>, g: ReturnType<typeof fakeGame>) {
  for (let t = 0; t < RACE.countdown + 1.5 && !race.started; t += DT) step(race, g);
}
/** Moves a player along the racing line sample by sample (forwards). */
function drive(race: InstanceType<typeof Race>, g: ReturnType<typeof fakeGame>, p: FakePlayer, from: number, samples: number, each?: () => void) {
  for (let k = 0; k <= samples; k++) {
    const i = (from + k) % track.n;
    p.P.x = track.px[i];
    p.P.z = track.pz[i];
    step(race, g);
    each?.();
  }
}

describe('Race', () => {
  let p: FakePlayer, g: ReturnType<typeof fakeGame>, race: InstanceType<typeof Race>;
  beforeEach(() => {
    p = fakePlayer(0);
    g = fakeGame([p]);
    race = new Race(g as unknown as Game, track, 2, 'random');
  });

  it('places evenly spread checkpoints, the first on the start line', () => {
    expect(race.cps).toHaveLength(RACE.checkpoints);
    expect(race.cps[0]).toBe(0);
    for (let i = 1; i < race.cps.length; i++) expect(race.cps[i]).toBeGreaterThan(race.cps[i - 1]);
  });

  it('locks controls during the countdown and releases them on GO', () => {
    expect(p.controlsLocked).toBe(true);
    step(race, g);
    expect(race.started).toBe(false);
    startRace(race, g);
    expect(race.started).toBe(true);
    expect(p.controlsLocked).toBe(false);
    expect(p.hud.countdown).toHaveBeenCalledWith('GO!');
    expect(p.hud.countdown).toHaveBeenCalledWith('3');
  });

  it('counts gates in order, progress grows steadily, and two laps finish the race', () => {
    startRace(race, g);
    drive(race, g, p, 0, 0);
    expect(p.race.lap).toBe(1); // crossing the start line starts lap 1
    expect(p.race.nextCp).toBe(1);
    let last = p.race.prog;
    drive(race, g, p, 1, track.n - 2, () => {
      expect(p.race.prog).toBeGreaterThanOrEqual(last - 1e-9);
      last = p.race.prog;
    });
    expect(p.race.lap).toBe(1);
    expect(p.race.prog).toBeGreaterThan(0.95);
    expect(p.race.prog).toBeLessThan(1);
    drive(race, g, p, track.n - 1, track.n); // over the line, lap 2, back to the line
    expect(p.race.lap).toBe(2);
    expect(p.race.lastLap).toBeGreaterThan(0);
    expect(p.race.best).toBe(p.race.lastLap);
    expect(p.race.finished).toBe(false);
    let flagAt = -1;
    drive(race, g, p, 0, track.n, () => { if (p.race.finished && flagAt < 0) flagAt = g.time; }); // finish
    expect(p.race.finished).toBe(true);
    expect(p.race.finishTime).toBeCloseTo(flagAt - race.startTime, 6);
    expect(race.over).toBe(true);
    for (let t = 0; t < RACE.resultsDelay + 0.5; t += DT) step(race, g);
    expect(g.hooks.onRaceResults).toHaveBeenCalledTimes(1);
  });

  it('skipping checkpoints (cutting the track) does not count', () => {
    startRace(race, g);
    drive(race, g, p, 0, 2);
    const cut = Math.round(track.n * 0.75);
    drive(race, g, p, cut, 5); // teleport three quarters round the lap
    expect(p.race.nextCp).toBe(1);
    expect(p.race.prog).toBeLessThanOrEqual(race.cps[1] / track.n + 1e-9);
  });

  it('standings: finished riders by time first, then by progress', () => {
    const a = fakePlayer(0), b = fakePlayer(1), c = fakePlayer(2);
    const g2 = fakeGame([a, b, c]);
    const r2 = new Race(g2 as unknown as Game, track, 3, 'random');
    a.race.prog = 1.2;
    b.race.prog = 2.5;
    c.race.prog = 0.4;
    expect(r2.standings().map((s) => s.name)).toEqual(['P2', 'P1', 'P3']);
    c.race.finished = true;
    c.race.finishTime = 95;
    a.race.finished = true;
    a.race.finishTime = 90;
    expect(r2.standings().map((s) => s.name)).toEqual(['P1', 'P3', 'P2']);
    expect(r2.standings()[2].time).toBeNull();
  });
});

describe('fmt', () => {
  it('formats lap times as m:ss.cc', () => {
    expect(fmt(0)).toBe('0:00.00');
    expect(fmt(5.5)).toBe('0:05.50');
    expect(fmt(83.456)).toBe('1:23.46');
    expect(fmt(600)).toBe('10:00.00');
  });
});

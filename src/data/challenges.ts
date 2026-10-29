import type { EntityType } from '../entities/EntityManager';

export type ChallengeId =
  | 'gem' | 'air' | 'speed' | 'crate' | 'drone' | 'flip' | 'barrel' | 'dist'
  | 'pad' | 'combo' | 'spin' | 'nohit' | 'powerup' | 'ramp' | 'style';

export interface ChallengeDef {
  id: ChallengeId;
  mode: 'sum' | 'max'; // add up progress, or keep the best single value
  text: (n: number) => string;
  target: () => number;
  time: number; // seconds
  fmt?: (v: number) => string;
  spawn?: { type: EntityType; extra: number; minD?: number; maxD?: number }; // entities placed ahead of the player
}

const pick = (min: number, steps: number, step = 1) => min + step * Math.floor(Math.random() * steps);

export const CHALLENGES: ChallengeDef[] = [
  { id: 'gem', mode: 'sum', text: (n) => `Collect ${n} gems`, target: () => pick(6, 5), time: 40 },
  { id: 'air', mode: 'max', text: (n) => `Stay airborne ${n}s in one jump`, target: () => 1.4, time: 50, fmt: (v) => v.toFixed(1) + 's' },
  { id: 'speed', mode: 'max', text: (n) => `Hit ${n} km/h`, target: () => pick(130, 4, 10), time: 30 },
  { id: 'crate', mode: 'sum', text: (n) => `Smash ${n} crates`, target: () => pick(4, 3), time: 45, spawn: { type: 'crate', extra: 2 } },
  { id: 'drone', mode: 'sum', text: (n) => `Destroy ${n} drone${n > 1 ? 's' : ''}`, target: () => pick(1, 2), time: 60, spawn: { type: 'drone', extra: 0, minD: 40, maxD: 80 } },
  { id: 'flip', mode: 'sum', text: (n) => `Land ${n} flip${n > 1 ? 's' : ''}`, target: () => pick(1, 2), time: 60 },
  { id: 'barrel', mode: 'sum', text: (n) => `Blow up ${n} barrels`, target: () => 3, time: 45, spawn: { type: 'barrel', extra: 2 } },
  { id: 'dist', mode: 'sum', text: (n) => `Ride ${n} m`, target: () => pick(500, 4, 100), time: 40, fmt: (v) => Math.floor(v) + ' m' },
  { id: 'pad', mode: 'sum', text: (n) => `Hit ${n} boost pads`, target: () => pick(2, 2), time: 60 },
  { id: 'combo', mode: 'max', text: (n) => `Reach a x${n} trick combo`, target: () => pick(2, 2), time: 60, fmt: (v) => 'x' + v },
  { id: 'spin', mode: 'sum', text: (n) => `Land ${n} 360 spin${n > 1 ? 's' : ''}`, target: () => 1, time: 60 },
  { id: 'nohit', mode: 'max', text: (n) => `Survive ${n}s without damage`, target: () => pick(25, 3, 5), time: 60, fmt: (v) => Math.floor(v) + 's' },
  { id: 'powerup', mode: 'sum', text: (n) => `Grab ${n} power-up${n > 1 ? 's' : ''}`, target: () => 1, time: 50, spawn: { type: 'powerup', extra: 1 } },
  { id: 'style', mode: 'sum', text: (n) => `Land ${n} style trick${n > 1 ? 's' : ''} (C in the air)`, target: () => pick(1, 2), time: 60 },
  { id: 'ramp', mode: 'sum', text: (n) => `Launch off ${n} ramps`, target: () => pick(2, 2), time: 60 },
];

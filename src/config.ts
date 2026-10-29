// Every tunable number of the game lives here. Change gameplay feel, spawn rates or graphics in one place.
import type { GameMode } from '../shared/protocol';

export const QUALITY = {
  low: { label: 'Low (fastest)', pixelRatio: 1, antialias: false, shadows: false, shadowMap: 1024, view: 3, fogFar: 185, particles: 0.5 },
  medium: { label: 'Medium', pixelRatio: 1.5, antialias: true, shadows: true, shadowMap: 1024, view: 4, fogFar: 240, particles: 0.8 },
  high: { label: 'High', pixelRatio: 2, antialias: true, shadows: true, shadowMap: 2048, view: 5, fogFar: 300, particles: 1 },
} as const;
export type QualityName = keyof typeof QUALITY;

export const WORLD = {
  grid: 260, // distance between parallel roads in open world
  chunk: 64, // chunk size in metres
  chunkSeg: 24, // terrain grid resolution per chunk
  scenery: 85, // scenery placement attempts per chunk
  buildsPerFrame: 1, // chunks generated per frame while riding (more = faster pop-in, more hitching)
  fogNear: 110,
  waterSize: 700,
  waterSeg: 48,
  clouds: 22,
};

/** Road size in metres from the centre line. */
export const ROAD = {
  asphalt: 7.5, // grey road surface
  shoulder: 9.5, // sandy edge
  onRoad: 9, // counts as "on road" for speed/grip
  flatten: [24, 9] as [number, number], // terrain blends into the road between these distances
  clear: 13, // no trees/rocks closer than this
};

/** Input feel: steering eases in and re-centres instead of snapping. */
export const CONTROL = { steerIn: 7, steerOut: 10, airAssist: 3.2, yawAssist: 2.2 };

/** Auto-aim: targets inside the cone get locked, shots lead moving targets. */
export const AIM = { cone: 0.5, droneRange: 110, propRange: 65, lead: true, assist: 0.85 };

export const PHYS ={ gravity: 30, walkGravity: 26, walkSpeed: 6.5, runSpeed: 12, jump: 9.5, maxSubstep: 1 / 60, maxDt: 0.05 };

export const BIKE = {
  top: 30, accel: 17, brake: 38, reverse: 10, maxReverse: 8,
  coastDrag: 1, offroadDrag: 0.25, offroadTop: 0.8,
  nitroMax: 100, nitroBurn: 28, nitroRegen: 2, nitroTopMul: 1.6, nitroAccelMul: 1.9,
  grip: 1.9, padTopMul: 1.55, padTime: 1.6,
  flipAccel: 13, spinRate: 4.2, mountDist: 3.5,
};

export const LANDING = {
  minAir: 0.6, // shorter hops never crash
  maxPitchErr: 1.35, // radians off the ground slope you may land at (~77°)
  maxYawErr: 1.25, // ~72° sideways
  crashDamage: 8,
  wallDamageSpeed: 14,
};

export const PLAYER = { hpMax: 100, regenDelay: 4, regenRate: 8, magnet: 3, respawnDelay: 1.8, comboWindow: 5 };

export const DRONES = {
  chance: 0.035, // per chunk near spawn
  farChance: 0.05, // extra chance far from spawn
  farDist: 6000,
  maxAlive: 5, // hard cap on roaming drones
  maxAttacking: 2, // how many may shoot at once
  safeRadius: 110,
  hp: 50, engageDist: 80, fireDist: 60,
  orbSpeed: 30, orbDamage: 8,
  cooldownEasy: 2.8, cooldownHard: 1.6,
};

/** Cumulative probabilities for what appears at each road sample point (every ~8 m). */
export const FEATURES: Record<GameMode, { ramp: number; pad: number; gem: number; cones: number; crate: number; barrel: number; pile: number; powerup: number }> = {
  open: { ramp: 0.05, pad: 0.085, gem: 0.3, cones: 0.33, crate: 0.355, barrel: 0.37, pile: 0.42, powerup: 0.432 },
  race: { ramp: 0.065, pad: 0.12, gem: 0.32, cones: 0.335, crate: 0.34, barrel: 0.345, pile: 0.345, powerup: 0.36 },
};

export const POWERUPS = {
  heal: { color: 0x5dff8a, label: 'REPAIR', amount: 40, time: 0 },
  shield: { color: 0x7ad7ff, label: 'SHIELD', amount: 0, time: 10 },
  magnet: { color: 0xffd23f, label: 'MAGNET', amount: 0, time: 15 },
  xp2: { color: 0xff7ad9, label: 'DOUBLE XP', amount: 0, time: 20 },
};
export type PowerupKind = keyof typeof POWERUPS;

export const RACE = { checkpoints: 8, countdown: 3, ghostHz: 10, resultsDelay: 2.5 };

export const NET = { sendHz: 15, interpDelay: 0.12 };

export const PLAYER_COLORS = [0xe2483d, 0x3c8dff, 0x39c46a, 0xffb020, 0xb05cff, 0xff5fa8, 0x22c7c7, 0xf2f2f2];

export const TRACKS = [
  { id: 'coast', name: 'Coastline Loop', seed: 1201 },
  { id: 'canyon', name: 'Canyon Run', seed: 7781 },
  { id: 'alpine', name: 'Alpine Ring', seed: 4410 },
  { id: 'random', name: 'Random', seed: 0 },
];

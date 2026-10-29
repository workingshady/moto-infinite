// Every tunable number of the game lives here. Change gameplay feel, spawn rates or graphics in one place.
import type { GameMode, TimeOfDay, Weather, WorldTheme } from '../shared/protocol';

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
export const CONTROL = {
  steerIn: 7, steerOut: 10, airAssist: 3.2, yawAssist: 2.2,
  boostSteer: 1.2, // extra turn rate while nitro/boost pad is on, so you can still dodge at top speed
  airSteer: 0.7, // ←/→ keeps steering on small hops and the first moments of a jump
  airSteerTime: 0.4, // after this long off a ramp, ←/→ switches to spin tricks
  airborneGap: 0.6, // metres above ground before a bump counts as being airborne
};

/** Auto-aim: targets inside the cone get locked, shots lead moving targets. */
export const AIM = { cone: 0.5, droneRange: 110, propRange: 65, lead: true, assist: 0.85 };

/**
 * Riding assist levels (Settings). Road-follow only acts when you are NOT steering, so it never fights you.
 * crest = max upward speed a road crest can give the bike (lower = sticks to the road).
 */
export const ASSIST = [
  { label: 'Pro', follow: 0, edge: 0, glance: 0.5, crest: 22, landing: 1, crash: 1 },
  { label: 'Normal', follow: 1.2, edge: 1.5, glance: 0.85, crest: 14, landing: 1.15, crash: 0.8 },
  { label: 'Easy', follow: 2.6, edge: 3.5, glance: 0.95, crest: 9, landing: 1.4, crash: 0.5 },
];

export const PHYS = { gravity: 30, walkGravity: 26, walkSpeed: 6.5, runSpeed: 12, jump: 9.5, maxSubstep: 1 / 60, maxDt: 0.05 };

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

/**
 * Leveling: XP needed for the next level = base * level^exp (power curve: quick early levels, slower later).
 * Cards never freeze a race; in solo they slow time instead of pausing, then fold into a badge.
 */
export const LEVELING = {
  base: 250, exp: 1.5,
  healOnLevel: 0.25, // fraction of max health restored per level
  rerolls: 2, // per run
  pityEvery: 3, // guarantee a Rare+ card at least this often
  slowmo: 0.25, // solo time scale while cards are open
  foldAfter: 8, // seconds before open cards fold into the "upgrade ready" badge
  pickShield: 1.5, // seconds of shield after picking
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

export interface TrackDef { id: string; name: string; seed: number; theme: WorldTheme; time: TimeOfDay; weather: Weather; blurb: string }
export const TRACKS: TrackDef[] = [
  { id: 'coast', name: 'Coastline Loop', seed: 1201, theme: 'islands', time: 'day', weather: 'clear', blurb: 'Fast sweepers along the beaches. Watch the water.' },
  { id: 'canyon', name: 'Canyon Run', seed: 7781, theme: 'desert', time: 'sunset', weather: 'clear', blurb: 'Dusty desert switchbacks under a burning sky.' },
  { id: 'alpine', name: 'Alpine Ring', seed: 4410, theme: 'alpine', time: 'dawn', weather: 'snow', blurb: 'Snowy mountain pass with big elevation changes.' },
  { id: 'forest', name: 'Midnight Forest', seed: 9090, theme: 'forest', time: 'night', weather: 'rain', blurb: 'Rain-soaked forest loop, headlights only.' },
  { id: 'storm', name: 'Storm Valley', seed: 3355, theme: 'mixed', time: 'cycle', weather: 'storm', blurb: 'Thunder, lightning and a sun that never stops moving.' },
  { id: 'random', name: 'Random', seed: 0, theme: 'mixed', time: 'day', weather: 'dynamic', blurb: 'A brand-new circuit every time.' },
];

/** World themes bend the terrain generator: biome bias, height scale, sea level, snow line. */
export const THEME_DEFS: Record<WorldTheme, { label: string; biomeShift: number; heightMul: number; heightAdd: number; snowLine: number; blurb: string }> = {
  mixed: { label: 'Mixed', biomeShift: 0, heightMul: 1, heightAdd: 0, snowLine: 34, blurb: 'Deserts, meadows, forests and mountains.' },
  desert: { label: 'Desert', biomeShift: -0.3, heightMul: 0.8, heightAdd: 2, snowLine: 99, blurb: 'Sand, cactus and red rock.' },
  forest: { label: 'Forest', biomeShift: 0.28, heightMul: 1, heightAdd: 1, snowLine: 40, blurb: 'Dense pine woods.' },
  alpine: { label: 'Alpine', biomeShift: 0.2, heightMul: 1.45, heightAdd: 3, snowLine: 18, blurb: 'High peaks and snowfields.' },
  islands: { label: 'Islands', biomeShift: 0.05, heightMul: 0.9, heightAdd: -7, snowLine: 34, blurb: 'Lots of sea, beaches and bridges.' },
};

/** Sky colours, light and sun angle at key hours; everything in between is blended. */
export const SKY_KEYS: { h: number; sky: number; sun: number; sunI: number; hemi: number; ground: number }[] = [
  { h: 0, sky: 0x070b1e, sun: 0x6f88ff, sunI: 0.12, hemi: 0.16, ground: 0x10162a },
  { h: 5, sky: 0x1a2045, sun: 0x8a90ff, sunI: 0.15, hemi: 0.2, ground: 0x1a2235 },
  { h: 6.5, sky: 0xf2a07a, sun: 0xffb27a, sunI: 0.7, hemi: 0.42, ground: 0x5a4a40 },
  { h: 9, sky: 0x9fd6f2, sun: 0xfff0d8, sunI: 1.1, hemi: 0.6, ground: 0x5a7a40 },
  { h: 16, sky: 0x9fd6f2, sun: 0xfff0d8, sunI: 1.1, hemi: 0.6, ground: 0x5a7a40 },
  { h: 18.5, sky: 0xf08a5d, sun: 0xff8a50, sunI: 0.75, hemi: 0.42, ground: 0x5a4030 },
  { h: 20, sky: 0x2a2a5a, sun: 0x8a7dff, sunI: 0.2, hemi: 0.22, ground: 0x1a1a30 },
  { h: 24, sky: 0x070b1e, sun: 0x6f88ff, sunI: 0.12, hemi: 0.16, ground: 0x10162a },
];
export const TIME_HOURS: Record<Exclude<TimeOfDay, 'cycle'>, number> = { day: 12, dawn: 6.6, sunset: 18.4, night: 23 };
export const DAY_LENGTH = 480; // seconds for a full 24 h in "cycle" mode

export const WEATHER_DEFS: Record<Exclude<Weather, 'dynamic'>, { label: string; rain: number; snow: number; fogFar: number; dark: number; clouds: number; lightning: boolean }> = {
  clear: { label: 'Clear', rain: 0, snow: 0, fogFar: 1, dark: 0, clouds: 0.6, lightning: false },
  cloudy: { label: 'Cloudy', rain: 0, snow: 0, fogFar: 0.85, dark: 0.15, clouds: 1, lightning: false },
  rain: { label: 'Rain', rain: 1, snow: 0, fogFar: 0.7, dark: 0.3, clouds: 1, lightning: false },
  fog: { label: 'Fog', rain: 0, snow: 0, fogFar: 0.4, dark: 0.15, clouds: 0.7, lightning: false },
  snow: { label: 'Snow', rain: 0, snow: 1, fogFar: 0.65, dark: 0.1, clouds: 1, lightning: false },
  storm: { label: 'Storm', rain: 1, snow: 0, fogFar: 0.55, dark: 0.5, clouds: 1, lightning: true },
};
export const WEATHER_CHANGE = 90; // seconds between changes in "dynamic" weather
/** Wet or snowy roads reduce grip. */
export const WEATHER_GRIP = { rain: 0.88, snow: 0.8 };

export const DRONE_TYPES = {
  scout: { hp: 25, speed: 2.6, orbit: 14, cool: 0.7, dmg: 5, color: 0x3cc8ff, scale: 0.8, xp: 40, bomb: false },
  gunner: { hp: 50, speed: 1.6, orbit: 18, cool: 1, dmg: 8, color: 0xff2a3a, scale: 1, xp: 60, bomb: false },
  bomber: { hp: 110, speed: 1, orbit: 6, cool: 1.5, dmg: 22, color: 0xffa53f, scale: 1.4, xp: 120, bomb: true },
};
export type DroneKind = keyof typeof DRONE_TYPES;

/** World generator levels, indexed by the WorldGen values chosen in the menu. */
export const GEN = {
  terrain: [
    { label: 'Flat', mul: 0.45, ridge: 0 },
    { label: 'Rolling', mul: 1, ridge: 0.6 },
    { label: 'Hilly', mul: 1.25, ridge: 1 },
    { label: 'Mountains', mul: 1.5, ridge: 1.6 },
  ],
  water: [
    { label: 'Dry', sea: 6, rivers: false },
    { label: 'Normal', sea: 0, rivers: false },
    { label: 'Rivers & lakes', sea: -2, rivers: true },
  ],
  flora: [
    { label: 'Sparse', mul: 0.45 },
    { label: 'Normal', mul: 1 },
    { label: 'Dense', mul: 1.6 },
  ],
  roads: [
    { label: 'Wide grid', spacing: 380, curve: 0.8 },
    { label: 'Normal', spacing: 260, curve: 1 },
    { label: 'Twisty', spacing: 230, curve: 1.9 },
  ],
  poi: [
    { label: 'Off', chance: 0 },
    { label: 'Some', chance: 0.35 },
    { label: 'Many', chance: 0.7 },
  ],
};

export type PoiKind = 'village' | 'fuel' | 'windmill' | 'stunt' | 'outpost';
export const POI_KINDS: { kind: PoiKind; weight: number; label: string; color: string }[] = [
  { kind: 'village', weight: 3, label: 'Village', color: '#ffb03f' },
  { kind: 'fuel', weight: 2, label: 'Gas station', color: '#5dff8a' },
  { kind: 'windmill', weight: 2, label: 'Windmill', color: '#ffffff' },
  { kind: 'stunt', weight: 2, label: 'Stunt zone', color: '#ff7ad9' },
  { kind: 'outpost', weight: 2, label: 'Vex outpost', color: '#ff3355' },
];

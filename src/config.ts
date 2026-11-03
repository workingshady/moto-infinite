// Every tunable number of the game lives here. Change gameplay feel, spawn rates or graphics in one place.
import type { FixedWeather, GameMode, TimeOfDay, Weather, WorldTheme } from '../shared/protocol';

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
  flipAccel: 13, spinRate: 4.2, mountDist: 3.5, carMountDist: 4.5,
};

export const LANDING = {
  minAir: 0.6, // shorter hops never crash
  maxPitchErr: 1.35, // radians off the ground slope you may land at (~77°)
  maxYawErr: 1.25, // ~72° sideways
  crashDamage: 8,
  wallDamageSpeed: 14,
};

/**
 * Wall / barrier / tree contact response for the player vehicle. The into-wall velocity is removed (plus a small
 * rebound), the speed along the wall is kept minus friction, and the heading swings toward the wall at most `maxSpin`.
 */
export const WALL = {
  restitution: 0.15, // share of the into-wall speed bounced back out
  maxRebound: 2.5, // m/s: the bounce never throws you back across the track (crumple zones eat the rest)
  friction: 0.35, // tangential speed lost per unit of into-wall speed (Coulomb-style scrape)
  maxSpin: 0.6, // rad: biggest heading change one impact can cause
  align: 0.55, // share of the heading-to-travel gap closed per impact
  fxCooldown: 0.35, // s between impact sounds/particles/damage while scraping a wall
  stuckTime: 2, // s pinned against a wall (slow or reversing) before the auto-recovery re-aligns you
  stuckSpeed: 5, // m/s: slower than this while touching a wall counts as stuck
  realignRate: 2.2, // rad/s the recovery turns the car toward the road direction
  /** Body radius against walls/barriers (m): about half the vehicle's width, plus a nose probe ahead for cars. */
  radius: { bike: 0.7, car: 1.05, f1: 1.05 },
  /** Cars: a second probe this far ahead of the centre (m) so the nose meets a head-on wall instead of sinking in. */
  nose: { bike: 0, car: 1.2, f1: 1.6 },
  damageMin: 8, // m/s into the wall before it costs health
  damage: 0.55, // health per m/s of into-wall speed above damageMin (a 216 km/h head-on ≈ 29)
  /** F1: nose-first hit (into-wall share of the speed above this) at more than wingSpeed breaks the front wing. */
  wingAngle: 0.45, wingSpeed: 14,
  wingDownforce: 0.3, // share of downforce a broken front wing loses (fixed at the next pit stop)
  maxPush: 0.6, // m per step the depenetration may move the body out of a wall
};

/**
 * Off-track surfaces on Formula 1 circuits (extra deceleration, m/s², on top of drag): gravel traps bite hard and
 * keep biting at low speed; grass is slippery but rolls on. Other vehicles use BIKE.offroadDrag.
 */
export const RUNOFF = {
  gravel: { base: 3.5, perV: 0.28, grip: 0.45 },
  grass: { base: 0.6, perV: 0.12, grip: 0.6 },
};

/**
 * Vehicle-vs-vehicle contact (systems/Contacts.ts). Each vehicle is a capsule along its heading; masses come from the
 * garage spec (bikes ~ 250-400 kg with rider, cars ~ 1-2.7 t, F1 800 kg).
 */
export const CONTACT = {
  /** Half width (capsule radius) and half core length (m) per class. */
  shape: { bike: { r: 0.45, a: 0.6 }, car: { r: 0.95, a: 1.3 }, f1: { r: 1.0, a: 1.75 }, traffic: { r: 0.95, a: 1.35 } },
  restitution: 0.12, friction: 0.35,
  maxPush: 0.35, slowPush: 0.04, // m per physics step (slowPush: two cars spawned on the same spot ease apart)
  spin: 0.6, maxSpin: 2.2,
  maxDy: 1.8,
  fxMin: 2.5, // m/s closing speed for sparks + sound
  cooldown: 0.35, // s between effects/damage per vehicle (scraping doesn't drain health every frame)
  damageMin: 5, // m/s closing speed before a hit costs health
  damage: 0.9, // health per m/s above damageMin, scaled by the other vehicle's share of the total mass (x2)
  bikeCrash: 9, // m/s: a bike hit harder than this throws the rider off
  stunTraffic: 6, // m/s: traffic hit harder than this stops and puts its hazards on for a moment
  aiLatDecay: 3, // 1/s: how fast an AI car's sideways shove dies out
  heading: 0.05, // share of a contact's yaw kick (rad/s) applied to the heading at once; the rest arrives as yaw rate
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

/** Drone amount option: multiplies spawn chance and the alive cap. */
export const DRONE_LEVELS = [
  { label: 'Off', mul: 0 },
  { label: 'Few', mul: 0.45 },
  { label: 'Normal', mul: 1 },
  { label: 'Many', mul: 1.8 },
];

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
  f1: { ramp: 0, pad: 0, gem: 0, cones: 0, crate: 0, barrel: 0, pile: 0, powerup: 0 },
  drift: { ramp: 0, pad: 0.02, gem: 0.12, cones: 0.16, crate: 0.16, barrel: 0.16, pile: 0.16, powerup: 0.17 },
  race: { ramp: 0.065, pad: 0.12, gem: 0.32, cones: 0.335, crate: 0.34, barrel: 0.345, pile: 0.345, powerup: 0.36 },
};

export const POWERUPS = {
  heal: { color: 0x5dff8a, label: 'REPAIR', amount: 40, time: 0 },
  shield: { color: 0x7ad7ff, label: 'SHIELD', amount: 0, time: 10 },
  magnet: { color: 0xffd23f, label: 'MAGNET', amount: 0, time: 15 },
  xp2: { color: 0xff7ad9, label: 'DOUBLE XP', amount: 0, time: 20 },
};
export type PowerupKind = keyof typeof POWERUPS;

/** Drift scoring: points/s = angle * speed * rate, multiplier grows with chain time, banked after a short straight. */
export const DRIFT = {
  minAngle: 0.22, // radians of slip before it counts
  minSpeed: 10,
  rate: 9,
  multStep: 2, // seconds of continuous drift per +0.5 multiplier
  multMax: 5,
  bankAfter: 0.7, // seconds without sliding before points are banked
  xpDiv: 8, // XP = points / xpDiv
  scrub: 0.55, // speed lost while sideways (halved on throttle: power keeps the drift alive)
  speedCap: 31, // speed bonus stops growing here (~70 mph, like Forza)
  yawInertia: { car: 5.5, bike: 9 }, // how fast the yaw rate follows the steering (lower = heavier)
  flickWindow: 0.35, // seconds: left-right reversal within this starts a weight-transfer flick
  flickTime: 0.45, flickTraction: 0.45, // rear goes light for this long, traction x this
  liftTraction: 0.7, // lifting off the throttle mid-corner
  brakeTraction: 0.75, // trail braking mid-corner
  throttleAngle: 0.9, // throttle pushes the angle out, lifting brings it back
  /** Max slip angle per assist level before the assist holds it (Pro: beyond spinAngle you spin out). */
  holdAngle: [1.25, 1.05, 0.9], spinAngle: 1.45,
  closeDist: 3, closeBonus: 0.25, // within this many metres of a wall/obstacle while drifting
  tandemDist: 12, tandemBonus: 0.5,
  grades: [[8000, 'INSANE!', '#ff3355'], [4000, 'GREAT!', '#ff7ad9'], [1500, 'NICE', '#ffd23f'], [0, 'DRIFT', '#ffffff']] as [number, string, string][],
};
/**
 * Wheelies (bikes): hold the trick key (C) on the ground at any speed, release to land.
 * Normal/Easy: "wheelie control" like a modern superbike: a balance controller lifts the front to a comfortable
 * angle and holds it there, ↑/↓ only nudge the target angle (↓ does NOT brake), and the angle is clamped below
 * the loop-out point so you can never flip. Pro: real balance physics around the rear axle (gravity tips the bike
 * forward below the balance point and over backwards past it), ↓ is the rear brake for the angle, loop out = crash.
 * While the front is up the throttle stays on (C implies gas) and nitro keeps working, so no speed is lost.
 */
export const WHEELIE = {
  balance: 0.62, // rad: centre of mass right above the rear contact patch (middle of the green band)
  minSpeed: 4.2, // m/s (~15 km/h) to lift the front
  // Normal/Easy controller (critically damped spring toward the target angle)
  aim: 0.6, // rad: default hold angle (inside the green band)
  aimUp: 0.36, // ↑ raises the target (towards the red, the controller still pulls it back)
  aimDown: 0.3, // ↓ lowers the target (never brakes during a wheelie)
  omega: 8, // rad/s: lift/settle stiffness (~0.5 s to the target)
  landOmega: 7, // rad/s: how quickly the front comes down on release
  land: -0.3, // rad: target below the ground on release, so the front drops smoothly instead of hovering
  limit: [Infinity, 1.08, 0.98], // max angle per assist level (Pro, Normal, Easy): Normal/Easy can't loop out
  // Pro physics
  gravity: 6.5, // tipping torque strength (unstable around the balance point)
  proHold: 30, // how hard the throttle hand pulls toward the default angle while C is held
  proDamp: 5,
  proUp: 14, // ↑ raw lift torque (x bike power): tap it, holding it loops you out
  brake: 11, // rear-brake (↓) torque pulling the front down
  loopOut: 1.2, // rad: past this you flip over backwards (Pro only)
  active: 0.15, // rad: above this the wheelie counts as on (↓ stops braking, gas stays on)
  slam: 2.2, // front drop speed (rad/s) that counts as a hard landing
  perfect: 0.13, // within this of the balance point = perfect balance
  minTime: 0.8, xpPerSec: 60, perfectXpPerSec: 90,
  fastSpeed: 120 / 3.6, // m/s average for a HIGH-SPEED WHEELIE
  fastXpPerSec: 80,
};

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

/**
 * Per-weather look and feel. Several picked weathers are layered: the strongest rain/snow/hail/dust/wind/dark wins,
 * the shortest fog distance wins and grips multiply.
 * rain/snow/hail/dust = particle density 0..1 · fogFar = view-distance multiplier · dark = overcast dimming
 * wind = gust strength 0..1 (pushes vehicles sideways, blows particles) · grip = tyre grip multiplier · tint = fog/sky colour cast
 */
export interface WeatherDef { label: string; icon: string; rain: number; snow: number; hail: number; dust: number; fogFar: number; dark: number; clouds: number; wind: number; grip: number; lightning: boolean; tint?: number; blurb: string }
export const WEATHER_DEFS: Record<FixedWeather, WeatherDef> = {
  clear: { label: 'Clear', icon: '☀️', rain: 0, snow: 0, hail: 0, dust: 0, fogFar: 1, dark: 0, clouds: 0.6, wind: 0.1, grip: 1, lightning: false, blurb: 'Dry road, full grip, long views.' },
  cloudy: { label: 'Cloudy', icon: '☁️', rain: 0, snow: 0, hail: 0, dust: 0, fogFar: 0.85, dark: 0.15, clouds: 1, wind: 0.2, grip: 1, lightning: false, blurb: 'Grey sky, softer light.' },
  drizzle: { label: 'Drizzle', icon: '🌦️', rain: 0.35, snow: 0, hail: 0, dust: 0, fogFar: 0.85, dark: 0.15, clouds: 1, wind: 0.2, grip: 0.94, lightning: false, blurb: 'Light rain: the road gets greasy.' },
  rain: { label: 'Rain', icon: '🌧️', rain: 1, snow: 0, hail: 0, dust: 0, fogFar: 0.7, dark: 0.3, clouds: 1, wind: 0.35, grip: 0.88, lightning: false, blurb: 'Wet road, less grip, brake earlier.' },
  storm: { label: 'Storm', icon: '⛈️', rain: 1, snow: 0, hail: 0, dust: 0, fogFar: 0.55, dark: 0.5, clouds: 1, wind: 0.75, grip: 0.84, lightning: true, blurb: 'Lightning, thunder and strong gusts.' },
  fog: { label: 'Fog', icon: '🌫️', rain: 0, snow: 0, hail: 0, dust: 0, fogFar: 0.4, dark: 0.15, clouds: 0.7, wind: 0, grip: 0.97, lightning: false, blurb: 'Very short view distance, damp road.' },
  snow: { label: 'Snow', icon: '❄️', rain: 0, snow: 1, hail: 0, dust: 0, fogFar: 0.65, dark: 0.1, clouds: 1, wind: 0.2, grip: 0.8, lightning: false, blurb: 'Snowfall, slippery road.' },
  blizzard: { label: 'Blizzard', icon: '🌨️', rain: 0, snow: 1, hail: 0, dust: 0, fogFar: 0.3, dark: 0.35, clouds: 1, wind: 1, grip: 0.74, lightning: false, tint: 0xdfe8f2, blurb: 'Whiteout: snow, strong wind, almost no view.' },
  hail: { label: 'Hail', icon: '🧊', rain: 0.3, snow: 0, hail: 1, dust: 0, fogFar: 0.7, dark: 0.35, clouds: 1, wind: 0.4, grip: 0.82, lightning: false, blurb: 'Ice pellets hammer down, icy road.' },
  wind: { label: 'Windy', icon: '🌬️', rain: 0, snow: 0, hail: 0, dust: 0.2, fogFar: 0.95, dark: 0.05, clouds: 0.8, wind: 1, grip: 1, lightning: false, blurb: 'Crosswind gusts push you sideways.' },
  sandstorm: { label: 'Sandstorm', icon: '🏜️', rain: 0, snow: 0, hail: 0, dust: 1, fogFar: 0.3, dark: 0.25, clouds: 0.3, wind: 0.9, grip: 0.9, lightning: false, tint: 0xc8945a, blurb: 'Orange dust wall, sand on the road, strong wind.' },
};
export const WEATHER_CHANGE = 90; // seconds between changes in "dynamic" weather

/** Layer several weathers into one target (see WEATHER_DEFS). */
export function combineWeather(list: FixedWeather[]): WeatherDef {
  const defs = (list.length ? list : (['clear'] as FixedWeather[])).map((w) => WEATHER_DEFS[w]);
  if (defs.length === 1) return defs[0];
  const max = (k: 'rain' | 'snow' | 'hail' | 'dust' | 'dark' | 'clouds' | 'wind') => Math.max(...defs.map((d) => d[k]));
  return {
    label: defs.map((d) => d.label).join(' + '), icon: defs.map((d) => d.icon).join(''),
    rain: max('rain'), snow: max('snow'), hail: max('hail'), dust: max('dust'), dark: Math.min(0.7, max('dark') + 0.05 * (defs.length - 1)),
    clouds: max('clouds'), wind: max('wind'), lightning: defs.some((d) => d.lightning), tint: defs.find((d) => d.tint !== undefined)?.tint,
    fogFar: Math.min(...defs.map((d) => d.fogFar)) * Math.pow(0.92, defs.length - 1),
    grip: Math.max(0.65, defs.reduce((g, d) => g * d.grip, 1)), blurb: '',
  };
}

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

/** Formula 1 mode. Tyres wear with distance, sliding and braking; pit lane has a speed limiter. */
/**
 * Formula 1 trackside barriers (world/F1Track.ts), all relative to the circuit's own half width so new circuits get
 * them automatically. Offsets are run-off in metres beyond the track edge; walls pull in (shrink factors) where
 * another part of the circuit runs close, never closer than minRunoff (street circuits use `street`).
 */
export const F1_BARRIERS = {
  runoff: 9, runoffOut: 14.6, street: 0.9, minRunoff: 2,
  shrink: [1, 0.75, 0.55, 0.4, 0.25, 0],
  pitBack: 0.3, // armco this far behind the pit lane's outer edge
  armcoR: 0.3, tyreR: 0.6, pitWallR: 0.45, // capsule radii (≈ half the visual thickness + a little)
  maxStretch: 2.4, // posts further apart than this x their spacing are not linked
  gravel: [2, 12] as [number, number], // gravel traps span this far beyond the edge (outside of big corners)
};

export const F1 = {
  tyres: {
    soft: { label: 'Soft', color: 0xe8282e, grip: 1.07, life: 9000 }, // metres to fully worn
    medium: { label: 'Medium', color: 0xf5d020, grip: 1, life: 16000 },
    hard: { label: 'Hard', color: 0xf2f2f2, grip: 0.94, life: 26000 },
  },
  wornGrip: 0.72, // grip multiplier at 100% wear
  pitLimit: 22, // m/s (80 km/h)
  pitStop: 2.6, // seconds stationary
  slipDist: 34, slipAngle: 0.3, slipDrag: 0.7, // slipstream: drag x this within slipDist behind a car
  straightDrag: 0.72, straightDown: 0.6, // 2026 straight mode: drag x 0.72, downforce x 0.6
  overtakeGap: 1, overtakeErs: 1.35, // 2026 overtake mode: within 1 s of a car ahead, extra electric deployment
  ersTaperFrom: 80, ersTaperTo: 95, // m/s: electric power fades out between these (2026 rules taper deployment at high speed)
  rho: 1.225, rolling: 0.012, engineBrake: 1.6, drivetrain: 0.82, // 82% of engine power reaches the road
  trackLimits: 3, trackLimitPenalty: 5, // warnings before a 5 s penalty
  mandatoryStopPenalty: 10, // dry races of 3+ laps: no pit stop = +10 s
  ersRegen: 22, ersIdle: 0.6, // nitro (ERS) recharge: per second under braking / otherwise
  lightsGap: 1, lightsHoldMin: 0.4, lightsHoldMax: 2.6, jumpPenalty: 5,
  aiNames: ['M. Verstappo', 'L. Hamiltone', 'C. Leclair', 'L. Norrison', 'O. Piastro', 'G. Russo', 'F. Alonzo', 'C. Sainte', 'P. Gaslee', 'Y. Tsunami', 'A. Albone', 'E. Ocone'],
};
export type TyreCompound = keyof typeof F1.tyres;

/**
 * Computer racers (src/ai). Bots drive the same vehicle physics as the player (entities/vehiclePhysics.ts) with a
 * pure-pursuit steering controller and a predictive throttle/brake that tracks a speed profile along a learned racing line.
 */
export const AI = {
  /** Difficulty levels: pace = share of the physical corner/braking limit, mistakes per minute, start reaction (s),
   *  Elo-like strength used by the Racecraft rating. Adaptive picks a pace from the player's rating. */
  levels: {
    rookie: { label: 'Rookie', icon: '🐣', pace: 0.8, mistakes: 1.6, react: [0.45, 0.9], rating: 750, catchUp: true },
    amateur: { label: 'Amateur', icon: '🙂', pace: 0.88, mistakes: 0.8, react: [0.3, 0.6], rating: 950, catchUp: true },
    pro: { label: 'Pro', icon: '😤', pace: 0.95, mistakes: 0.3, react: [0.2, 0.4], rating: 1150, catchUp: false },
    legend: { label: 'Legend', icon: '👑', pace: 1, mistakes: 0.08, react: [0.12, 0.25], rating: 1350, catchUp: false },
  },
  /** Racecraft rating: start value, bounds, K factor shrinking with races, biggest change per race. */
  rating: { start: 1000, min: 500, max: 1700, kMax: 64, kMin: 16, kHalfLife: 8, maxStep: 70, perfWeight: 0.35, crashCost: 6, offCost: 2 },
  /** In-race catch-up (Rookie, Amateur, Adaptive only): pace change ±max, reached at `gapFull` seconds of gap, eased at `rate` /s. */
  catchUp: { max: 0.03, gapFull: 6, rate: 0.01 },
  /** Speed profile: safety margin on the physical limit, braking decel share, slip budget for arcade cornering (rad). */
  profile: { margin: 0.96, brakeShare: 0.82, arcadeBrake: 30, slipMax: 0.16, steerShare: 0.85, f1MaxBrake: 6.2 * 9.81 },
  /** Racing line optimiser: car half width + safety (m), smoothing iterations, neighbour stride (samples). */
  line: { margin: 1.6, iters: 600, strides: [8, 4, 2, 1], cacheTracks: 10 },
  /** Ghost learning: lateral blend weight per good ghost lap, speed blend, quality exponent, off-track rejection (m beyond edge). */
  learn: { lineWeight: 0.6, speedWeight: 0.5, qualityExp: 6, offTrack: 2.5, minCover: 0.9 },
  /** Steering: pure pursuit lookahead = base + time × speed (m), heading damping. */
  steer: { lookBase: 7, lookTime: 0.55, lookMax: 70, damp: 0.25 },
  /** Throttle/brake: speed error band (m/s) and PI gains; preview time for the target speed. */
  speed: { band: 1.2, kp: 0.35, ki: 0.15, preview: 0.25 },
  /** Racecraft: follow gap (s) scaled by aggression, overtake offset (m), side-by-side clearance (m). */
  race: { followGap: [0.55, 0.25], passOffset: 3.2, clearance: 2.4, commit: 1.6, defendGap: 0.9, blueGap: 2.5 },
  /** Recovery: stuck after this long slow (s), reverse time, reset after this long (s). */
  recover: { stuckTime: 1.6, reverseTime: 1.4, resetTime: 9, offTrack: 6 },
  /** Fixed physics step for bots; far bots (beyond lodDist from every player) step at half rate. */
  step: 1 / 60, lodDist: 260,
  hp: 100,
  /** F1 strategy: pit when wear passes this (personal ±0.08), undercut gap (s), ERS reserve kept for defending (%). */
  f1: { pitWear: 0.62, lastWear: 0.86, undercutGap: 1.6, ersReserve: 22, ersDeployMin: 30, pitLane: 6.5, wetCaution: 0.5 },
};
export type AiLevelId = keyof typeof AI.levels;

/** Persistent career (src/core/career.ts): credits and career XP earned across sessions. */
export const CAREER = {
  xpBase: 600, xpExp: 1.45, // career XP for level n → n+1 = base × n^exp
  xpPerScore: 0.25, // career XP per in-session score point
  creditsPerGem: 3,
  creditsPerScore: 0.02, // trickle from every point scored
  creditsPerDrift: 1 / 150, // per banked drift point
  creditsPerWheelieSec: 4,
  creditsPerKm: 6,
  creditsPerDrone: 15,
  raceStart: 20, // credits for taking part in a race against at least one rival
  racePlace: [250, 150, 90], // podium credits (P1, P2, P3)
  raceXp: [600, 350, 200], // podium career XP
  medalCredits: [60, 120, 250, 500], // Time Attack: first time a track x vehicle reaches Bronze / Silver / Gold / Ace
  medalXp: [100, 200, 400, 800],
  elimWin: [200, 400], // credits, career XP for winning an Elimination race
  challenge: [150, 300], // credits, career XP for the first finished run of each daily / weekly challenge
  saveEvery: 10, // seconds between autosaves while playing
  toastTime: 4.2, // seconds an achievement toast stays up
};

// Replay, photo mode and clips (systems/Replay.ts, ui/ReplayPanel.ts, ui/PhotoMode.ts)
export const REPLAY = {
  seconds: 60, hz: 30, // ring buffer length and sample rate (~60 B per vehicle per sample)
  maxActors: 24, maxEvents: 64,
  nitroGap: 3, // s between two nitro markers of one rider
  instantBack: 10, // s an instant replay rewinds
  promptSecs: 4.5, promptTrickPts: 400, // instant replay prompt after a crash or a trick worth this many points
  clipMax: 20, clipFps: 30, // clip length cap (s of playback) and capture rate
  speeds: [0.25, 0.5, 1, 2],
  photoMaxDist: 40, photoMinDist: 1.5, photoOrbitMax: 30, // photo camera: how far from the rider it may fly / orbit
};

/**
 * Electric cars (data/vehicles.ts `ev`) and the Tesla Roadster's cold-gas "SpaceX package" thrusters.
 * Thrusters replace nitro: the boost meter becomes the NITROGEN TANK (s.nitro, 0..nitroMax = one fill).
 * Reveal (15 Oct 2026, McGregor TX): an uncrewed, remotely driven car launched over a line of Teslas with a mid-air
 * "kickflip", rotated with thrusters and drove a ramp upside down (held by suction fans). Claimed, not shown: Thrust trim
 * = 4 rear thrusters, 200 L COPV at ~10,000 psi in the trunk, ~5 s of thrust per fill, refill 2-7 h (aim 30 min);
 * Rocket trim = 10 thrusters (4 rear, 4 down at the corners, 2 front for yaw) + a 400 L tank in place of the passenger seat.
 * The game gives the Roadster the Rocket set so it can fly; numbers below are game units (PHYS.gravity = 30 m/s²).
 */
export const EV = {
  regenMinSpeed: 3, // m/s: below this lifting off just coasts
  brakeCharge: 0.6, // share of regenCharge also harvested while braking (blended brakes)
  rearBiasMinSpeed: 14,
  thrust: {
    accel: 9, // m/s² on top of the normal boost
    brake: 26, // m/s² of retro-thrust while braking with thrusters held
    grip: 5, // extra rate the travel direction locks to the heading (less slide)
    yaw: 0.35, // extra turn rate (rad/s at full steer) from the side thrusters
    hiss: 0.16, // loop level at full thrust
    puffs: 1, // particles per nozzle per physics step (scaled by quality)
    color: 0xf4f8ff,
    nozzles: [[-0.62, 0.4, -2.36], [-0.3, 0.4, -2.36], [0.3, 0.4, -2.36], [0.62, 0.4, -2.36]] as [number, number, number][],
    side: [1.0, 0.35, 1.95] as [number, number, number], // side nozzle (x mirrored), local metres
    front: [0.7, 0.3, 2.36] as [number, number, number], // retro nozzles for thrust braking (x mirrored)
    down: [[-0.82, 0.22, 1.55], [0.82, 0.22, 1.55], [-0.82, 0.22, -1.6], [0.82, 0.22, -1.6]] as [number, number, number][], // lift nozzles
  },
  /** Nitrogen tank = the boost meter (0..BIKE.nitroMax). One fill = `fullSecs` of every thruster at full output. */
  tank: {
    fullSecs: 5, // claimed ~5 s of thrust per 200 L / 10,000 psi fill
    // share of the full flow each thruster group uses at 100 %: lift (4 down) + rear (4) + side/front (2-4), capped at 1
    lift: 1, rear: 0.5, side: 0.3,
    min: 2, // meter units needed to start the lift thrusters
  },
  /** Thruster flight: hold the hover/lift key. Lift is a climb-rate controller, so it stays controllable. */
  flight: {
    mass: 1700, // kg (claimed target weight)
    lift: 2.6, // max lift thrust / weight (4 corner nozzles); hovering uses ~1/2.6 of it
    climb: 8, // m/s climb rate while the key is held
    descent: 3.5, // m/s gentle assisted descent when released (tank permitting)
    response: 4, // 1/s: how fast vertical speed follows the target
    ceiling: 38, // m above ground: climb fades out over the last 8 m
    holdDelay: 0.12, // s the key must be held before lift-off (a quick double tap = hop instead)
    liftoffVy: 4, // m/s kick at lift-off
    push: 14, // m/s² forward (↑, rear nozzles)
    retro: 14, // m/s² backward (↓, front nozzles)
    maxBack: 12, // m/s flying backwards
    dragQ: 0.0016, dragL: 0.06, // horizontal air drag: v² and linear terms (1/m, 1/s)
    yaw: 1.3, // extra rad/s at full steer (side/front nozzles)
    align: 3, // 1/s: velocity swings toward the nose (thrust vectoring)
    pitch: 0.2, // rad nose down/up while pushing / braking
    crashImpact: 30, // m/s vertical impact that wrecks a landing after a flight (soft landings are fine)
    camBack: 4, // extra chase-camera distance at full altitude
    camUp: 1.6,
    dust: 9, // m: ground dust from the lift nozzles below this height
    rumble: 0.28,
  },
  /** Kickflip: side-thruster barrel roll (trick key) in the air, or from the ground with a hop. */
  kick: {
    time: 0.85, // s for 360°
    cost: 7, // tank units
    vy: 12, // hop when started on the ground
    pts: 450,
  },
  /** Down-force glue: thrusters firing on a steep bank/wall press the car into it (heightfield: no true inverted driving). */
  stick: {
    steep: 0.55, // rad (~31°): above this the lift key presses into the surface instead of lifting off
    maxStep: 4.5, // m per step the car may climb while glued (normal: 1.3)
    crest: 3, // m/s max upward speed a crest can give while glued (sticks over the lip)
    burn: 0.45, // share of full flow while gluing
    slide: 9, // m/s² down-slope slide on the demo wall when NOT glued, per radian over `free`
    free: 0.6, // rad of bank anyone can hold without thrusters
  },
  /** Thruster demo wall near the open-world spawn: a curved bank beside the road (quarter-pipe profile). */
  wall: {
    ahead: 45, length: 110, // m from the spawn along its road; wall length
    offset: 13, // m from the spawn line to the foot of the bank
    radius: 8, // quarter-pipe radius: top lip ~6 m high at ~76°
    deck: 3, back: 5, taper: 18, // flat top, back slope, height fade at both ends
  },
  hop: {
    vy: 11, // m/s launch
    hover: 0.9, // seconds of reduced gravity after the hop
    lift: 0.72, // share of gravity cancelled while hovering
    cost: 10, // tank units
    cooldown: 1.2,
    doubleTap: 0.3, // seconds between two lift-key presses
  },
};

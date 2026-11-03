// Persistent career: level + XP, credits, lifetime stats, garage unlocks and achievements.
// Saved in localStorage ('moto:career'), versioned; unknown/missing fields fall back to defaults so old saves keep loading.
// In-run XP/levels/upgrades stay on Player and reset each session; the career accumulates separately.
import { CAREER } from '../config';
import { VEHICLES, vehicleById } from '../data/vehicles';
import { ACHIEVEMENTS, type AchievementDef } from '../data/achievements';

export interface CareerStats {
  distance: number; // metres ridden
  topSpeed: number; // km/h
  playTime: number; // seconds in sessions (unpaused)
  sessions: number;
  racesStarted: number; // circuit + F1 races against at least one rival
  racesWon: number;
  podiums: number;
  f1Started: number;
  f1Won: number;
  bestDrift: number;
  driftTotal: number;
  longestWheelie: number; // seconds
  wheelieTime: number;
  flips: number;
  spins: number;
  styleTricks: number;
  kickflips: number; // Roadster side-thruster rolls
  bestFlight: number; // seconds of one thruster flight
  bestAir: number; // seconds
  bestCombo: number;
  drones: number;
  crates: number;
  barrels: number;
  gems: number;
  powerups: number;
  ramps: number;
  bestRunLevel: number; // highest in-session level
  nightDist: number;
  /** Metres ridden per weather (layered weathers each count). */
  weatherDist: Record<string, number>;
  /** Open-world themes ridden, F1 circuits raced, drift venues visited. */
  themes: string[];
  f1Tracks: string[];
  driftVenues: string[];
}

export interface Career {
  v: number;
  level: number;
  xp: number; // towards the next level
  credits: number; // spendable (fractional internally, shown floored)
  earned: number; // lifetime credits
  stats: CareerStats;
  unlocked: string[]; // bought vehicles (starters are always owned)
  achievements: Record<string, number>; // id → unlock timestamp (ms)
}

const KEY = 'moto:career';
const VERSION = 1;

const freshStats = (): CareerStats => ({
  distance: 0, topSpeed: 0, playTime: 0, sessions: 0, racesStarted: 0, racesWon: 0, podiums: 0, f1Started: 0, f1Won: 0,
  bestDrift: 0, driftTotal: 0, longestWheelie: 0, wheelieTime: 0, flips: 0, spins: 0, styleTricks: 0, kickflips: 0, bestFlight: 0, bestAir: 0, bestCombo: 0,
  drones: 0, crates: 0, barrels: 0, gems: 0, powerups: 0, ramps: 0, bestRunLevel: 0, nightDist: 0,
  weatherDist: {}, themes: [], f1Tracks: [], driftVenues: [],
});

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Merge a saved (possibly older or damaged) career onto defaults. */
function migrate(raw: unknown): Career {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Career>;
  const st = freshStats(), rs = (r.stats && typeof r.stats === 'object' ? r.stats : {}) as unknown as Record<string, unknown>;
  for (const k of Object.keys(st) as (keyof CareerStats)[]) {
    const def = st[k];
    if (typeof def === 'number') (st as unknown as Record<string, number>)[k] = num(rs[k]);
    else if (Array.isArray(def)) (st as unknown as Record<string, string[]>)[k] = strs(rs[k]);
  }
  if (rs.weatherDist && typeof rs.weatherDist === 'object') {
    for (const [w, d] of Object.entries(rs.weatherDist as Record<string, unknown>)) st.weatherDist[w] = num(d);
  }
  const ach: Record<string, number> = {};
  if (r.achievements && typeof r.achievements === 'object') for (const [id, t] of Object.entries(r.achievements)) ach[id] = num(t, Date.now());
  return {
    v: VERSION, level: Math.max(1, Math.floor(num(r.level, 1))), xp: Math.max(0, num(r.xp)), credits: Math.max(0, num(r.credits)), earned: Math.max(0, num(r.earned)),
    stats: st, unlocked: strs(r.unlocked), achievements: ach,
  };
}

function load(): Career {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return migrate(JSON.parse(s));
  } catch {
    /* corrupt or blocked storage: start fresh */
  }
  const c = migrate(null);
  // first career on this browser: keep the rides the player already picked before careers existed
  try {
    const p = JSON.parse(localStorage.getItem('moto:profile') ?? '{}') as Record<string, unknown>;
    for (const id of [p.vehicle, p.vehicle2, p.f1car]) if (typeof id === 'string' && vehicleById(id).id === id && vehicleById(id).unlock && !c.unlocked.includes(id)) c.unlocked.push(id);
  } catch {
    /* no profile yet */
  }
  return c;
}

export const career: Career = load();

export function saveCareer() {
  try {
    localStorage.setItem(KEY, JSON.stringify(career));
  } catch {
    /* not persisted */
  }
}

/** Career XP needed to go from `level` to the next. */
export const careerXpNeed = (level: number) => Math.round(CAREER.xpBase * Math.pow(level, CAREER.xpExp));

// ---------------------------------------------------------------- session summary (what this ride earned)
export interface SessionEarnings { credits: number; xp: number; levels: number; achievements: string[]; time: number }
const blank = (): SessionEarnings => ({ credits: 0, xp: 0, levels: 0, achievements: [], time: 0 });
/** The running (or last finished) session. `null` until the first session of this page load. */
export let sessionEarnings: SessionEarnings | null = null;
export function beginSession() {
  sessionEarnings = blank();
}

/** Add career XP and credits; returns the number of career levels gained. */
export function earn(xp: number, credits: number): number {
  const c = career;
  c.credits += credits;
  c.earned += credits;
  c.xp += xp;
  let ups = 0;
  while (c.xp >= careerXpNeed(c.level)) {
    c.xp -= careerXpNeed(c.level);
    c.level++;
    ups++;
  }
  if (sessionEarnings) {
    sessionEarnings.credits += credits;
    sessionEarnings.xp += xp;
    sessionEarnings.levels += ups;
  }
  return ups;
}

// ---------------------------------------------------------------- garage
export function isUnlocked(id: string) {
  const v = vehicleById(id);
  return !v.unlock || career.unlocked.includes(v.id);
}

export type LockState = 'owned' | 'level' | 'credits' | 'buy';
/** Why a vehicle is (not) available: owned, needs a higher level, needs more credits, or can be bought now. */
export function lockState(id: string): LockState {
  const u = vehicleById(id).unlock;
  if (isUnlocked(id) || !u) return 'owned';
  if (career.level < u.level) return 'level';
  if (Math.floor(career.credits) < u.price) return 'credits';
  return 'buy';
}

export function buyVehicle(id: string): boolean {
  const v = vehicleById(id);
  if (v.id !== id || lockState(id) !== 'buy' || !v.unlock) return false;
  career.credits -= v.unlock.price;
  career.unlocked.push(v.id);
  checkAchievements([]); // garage achievements (saves)
  saveCareer();
  return true;
}

export const ownedCount = () => VEHICLES.filter((v) => isUnlocked(v.id)).length;

// ---------------------------------------------------------------- achievements
/** Unlock every achievement whose condition is now met; returns the new ones (rewards are paid). */
export function checkAchievements(out: AchievementDef[]): AchievementDef[] {
  out.length = 0;
  for (const a of ACHIEVEMENTS) {
    if (career.achievements[a.id] || !a.test(career.stats, career)) continue;
    career.achievements[a.id] = Date.now();
    earn(a.xp, a.credits);
    sessionEarnings?.achievements.push(a.id);
    out.push(a);
  }
  if (out.length) saveCareer();
  return out;
}

/** Add a unique string to a list stat (themes, tracks, venues). */
export function addUnique(list: string[], v: string) {
  if (v && !list.includes(v)) list.push(v);
}

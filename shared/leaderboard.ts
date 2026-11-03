// Online leaderboards + daily/weekly seed challenges. Shared by the game client (src/net/leaderboard.ts,
// src/ui/LeaderboardPanel.ts) and the Worker (worker/Leaderboard.ts) so both pick the same challenge for a date
// and agree on which board ids and values are plausible.
import { FIXED_WEATHERS, THEMES, type FixedWeather, type TimeOfDay, type WorldTheme } from './protocol';

/** Board ids: `daily:YYYY-MM-DD:<mode>`, `weekly:YYYY-Www:<mode>`, `track:<trackId>:<class>`, `drift:<venue>`. */
export type ChallengeMode = 'race' | 'f1' | 'drift';
export type VehicleClass = 'bike' | 'car' | 'f1';

export const LB = {
  /** Fastest any vehicle can plausibly average over a lap, m/s (bikes/cars on nitro, F1 on a straight). */
  maxSpeed: 95,
  maxSpeedF1: 112,
  /** Lap times longer than this are not worth a row. */
  maxLap: 900,
  /** Timed drift run length (seconds) for drift boards. */
  driftSeconds: 120,
  /** Upper bound of drift points per second: max angle x speed cap x rate x zone x fluid x close+tandem x chain multiplier. */
  driftMaxPps: 1.7 * 31 * 9 * 3 * 1.15 * 1.75 * 5,
  /** Ghost samples per second (matches RACE.ghostHz) and floats per sample (x, y, z, heading, pitch). */
  ghostHz: 10,
  ghostStride: 5,
  /** Ghost float cap (~13 minutes of lap). */
  ghostMax: 40000,
  nameMax: 16,
  topMax: 50,
  /** Rows kept per board; ghosts kept for the top few only. */
  rowsMax: 2000,
  ghostsKept: 10,
} as const;

export const NAME_RE = /^[\p{L}\p{N} _.\-!?'#]{1,16}$/u;
export const PID_RE = /^[a-z0-9]{16,40}$/;
export const BOARD_RE = /^[a-z0-9:_-]{3,64}$/;

/** Named circuits (config TRACKS) by track seed; the Circuit is generated from it. */
export const LB_CIRCUITS: Record<string, { name: string; seed: number }> = {
  coast: { name: 'Coastline Loop', seed: 1201 },
  canyon: { name: 'Canyon Run', seed: 7781 },
  alpine: { name: 'Alpine Ring', seed: 4410 },
  forest: { name: 'Midnight Forest', seed: 9090 },
  storm: { name: 'Storm Valley', seed: 3355 },
};
/** Real F1 circuits (world/F1Track.ts) at 1:1 scale. */
export const LB_F1: Record<string, { name: string; km: number }> = {
  monza: { name: 'Monza', km: 5.793 },
  silverstone: { name: 'Silverstone', km: 5.891 },
  spa: { name: 'Spa-Francorchamps', km: 7.004 },
  monaco: { name: 'Monaco', km: 3.337 },
  suzuka: { name: 'Suzuka', km: 5.807 },
  bahrain: { name: 'Bahrain', km: 5.412 },
};
/** Drift venues (world/DriftTrack.ts), without the random one. */
export const LB_DRIFT: Record<string, string> = {
  docks: 'Container Port', touge: 'Mountain Pass', skidpad: 'Figure-8 Skidpad', gymkhana: 'Gymkhana Arena',
  airfield: 'Airfield Drift', harbor: 'Harbor Quayside', carpark: 'Car Park Drift',
};
/** Vehicle pools the challenge picks from (ids from src/data/vehicles.ts). */
const RACE_VEHICLES = ['street', 'superbike', 'dirt', 'cafe', 'cruiser', 'gt', 'muscle', 'rally', 'hyper', 'touring', 'roadster', 'trophy', 'drift_coupe', 'rotary'];
const DRIFT_VEHICLES = ['drift_coupe', 'hatch', 'rotary', 'muscle', 'roadster'];
const F1_CARS = ['f1_2026', 'f1_v10', 'f1_classic'];
const CHALLENGE_TIMES: TimeOfDay[] = ['day', 'dawn', 'sunset', 'night'];
/** Fair, readable weathers only (no sandstorm/blizzard white-outs on a ranked run). */
const CHALLENGE_WEATHERS: FixedWeather[] = FIXED_WEATHERS.filter((w) => w === 'clear' || w === 'cloudy' || w === 'drizzle' || w === 'rain' || w === 'fog' || w === 'snow' || w === 'wind');

export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** FNV-1a 32-bit. */
export function hashStr(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * Lower bound of a generated Circuit's length: the closed polygon through its control points. The Catmull-Rom
 * loop passes through every control point, so it can never be shorter. Mirrors the rng order in world/layout.ts Circuit.
 */
export function circuitMinLength(seed: number) {
  const rng = mulberry32(seed ^ 0x5eed);
  const N = 14, R = 300 + rng() * 120, aspect = 0.8 + rng() * 0.4;
  const xs: number[] = [], zs: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, r = R * (0.72 + rng() * 0.5);
    xs.push(Math.sin(a) * r * aspect);
    zs.push(Math.cos(a) * r);
  }
  let len = 0;
  for (let i = 0; i < N; i++) { const j = (i + 1) % N; len += Math.hypot(xs[j] - xs[i], zs[j] - zs[i]); }
  return len;
}

// ---------------------------------------------------------------- dates
export const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
/** ISO week key, e.g. 2026-W45 (weeks start Monday, UTC). */
export function isoWeek(t: number) {
  const d = new Date(t), dayNum = d.getUTCDay() || 7;
  const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - dayNum)); // the week's Thursday decides its year
  const y = thu.getUTCFullYear(), week = Math.ceil(((thu.getTime() - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}
/** When the current daily (next UTC midnight) or weekly (next Monday 00:00 UTC) challenge resets. */
export function resetAt(kind: 'daily' | 'weekly', t: number) {
  const d = new Date(t), mid = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return kind === 'daily' ? mid : mid + ((7 - ((d.getUTCDay() + 6) % 7) - 1) * 864e5);
}

// ---------------------------------------------------------------- challenges
export interface Challenge {
  kind: 'daily' | 'weekly';
  /** Date or week key the challenge belongs to. */
  key: string;
  seed: number;
  mode: ChallengeMode;
  /** Circuit: generated `ch-<key>` id (own ghost slot); F1: circuit id; drift: venue id. */
  trackId: string;
  trackName: string;
  laps: number;
  time: TimeOfDay;
  weather: FixedWeather;
  theme: WorldTheme;
  vehicle: string;
  board: string;
  endsAt: number;
}

const pick = <T>(rng: () => number, list: readonly T[]) => list[Math.floor(rng() * list.length) % list.length];

export function challengeFor(kind: 'daily' | 'weekly', t = Date.now()): Challenge {
  const key = kind === 'daily' ? utcDay(t) : isoWeek(t);
  const seed = hashStr(`moto:${kind}:${key}`), rng = mulberry32(seed);
  const roll = rng(), mode: ChallengeMode = roll < 0.5 ? 'race' : roll < 0.7 ? 'f1' : 'drift';
  const time = pick(rng, CHALLENGE_TIMES), weather = pick(rng, CHALLENGE_WEATHERS), theme = pick(rng, THEMES);
  let trackId: string, trackName: string, vehicle: string, laps = 3;
  if (mode === 'race') {
    trackId = `ch-${key.toLowerCase()}`;
    trackName = `${kind === 'daily' ? 'Daily' : 'Weekly'} circuit #${seed % 10000}`;
    vehicle = pick(rng, RACE_VEHICLES);
  } else if (mode === 'f1') {
    trackId = pick(rng, Object.keys(LB_F1));
    trackName = LB_F1[trackId].name;
    vehicle = pick(rng, F1_CARS);
    laps = trackId === 'spa' ? 2 : 3;
  } else {
    trackId = pick(rng, Object.keys(LB_DRIFT));
    trackName = LB_DRIFT[trackId];
    vehicle = pick(rng, DRIFT_VEHICLES);
    laps = 0;
  }
  return { kind, key, seed: seed % 1e9, mode, trackId, trackName, laps, time, weather, theme, vehicle, board: `${kind}:${key.toLowerCase()}:${mode}`, endsAt: resetAt(kind, t) };
}

/** Lower is better for lap times, higher for drift scores. */
export interface BoardRule { order: 'asc' | 'desc'; min: number; max: number; /** Minimum lap length in metres (ghost check). */ minLen: number; maxSpeed: number }

const lapRule = (minLen: number, maxSpeed: number): BoardRule => ({ order: 'asc', min: minLen / maxSpeed, max: LB.maxLap, minLen, maxSpeed });
const driftRule = (): BoardRule => ({ order: 'desc', min: 100, max: Math.round(LB.driftMaxPps * (LB.driftSeconds + 3)), minLen: 0, maxSpeed: LB.maxSpeed });

/** Validates a board id and returns what values it accepts; null = unknown/expired board. `now` lets the server allow yesterday's run finishing after midnight. */
export function boardRule(board: string, now = Date.now()): BoardRule | null {
  if (!BOARD_RE.test(board)) return null;
  const [kind, a, b, extra] = board.split(':');
  if (extra !== undefined) return null;
  if (kind === 'daily' || kind === 'weekly') {
    // the current or the previous period only
    const ok = [now, now - (kind === 'daily' ? 864e5 : 7 * 864e5)].map((t) => challengeFor(kind, t)).find((c) => c.board === board);
    if (!ok) return null;
    return ruleFor(ok.mode, ok.mode === 'race' ? ok.seed : 0, ok.trackId);
  }
  if (kind === 'track') {
    if (LB_CIRCUITS[a] && (b === 'bike' || b === 'car')) return lapRule(circuitMinLength(LB_CIRCUITS[a].seed), LB.maxSpeed);
    if (LB_F1[a] && b === 'f1') return lapRule(LB_F1[a].km * 1000 * 0.85, LB.maxSpeedF1);
    return null;
  }
  if (kind === 'drift' && LB_DRIFT[a] && b === undefined) return driftRule();
  return null;
}

function ruleFor(mode: ChallengeMode, seed: number, trackId: string): BoardRule {
  if (mode === 'drift') return driftRule();
  if (mode === 'f1') return lapRule(LB_F1[trackId].km * 1000 * 0.85, LB.maxSpeedF1);
  return lapRule(circuitMinLength(seed), LB.maxSpeed);
}

export const boardIsTime = (board: string) => !board.startsWith('drift:') && !board.endsWith(':drift');

// ---------------------------------------------------------------- API shapes
/** `verified`: posted by a signed-in (Google) account; the name is still the rider name they chose. */
export interface LbRow { rank: number; name: string; value: number; vehicle: string; me?: boolean; ghost?: boolean; verified?: boolean }
export interface LbTop { board: string; rows: LbRow[]; you: LbRow | null; total: number }
/** `fp`: sent honestly by the client when the admin "Full Power" mode is on (the server rejects those). */
export interface LbSubmit { board: string; pid: string; name: string; value: number; vehicle: string; ghost?: number[]; fp?: boolean }
export interface LbSubmitResult { ok: boolean; error?: string; improved?: boolean; rank?: number; best?: number; total?: number }
export interface LbGhost { name: string; value: number; vehicle: string; s: number[] }

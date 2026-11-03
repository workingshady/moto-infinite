// Messages exchanged between the game client (src/net) and the room server (worker/Room.ts).
// Shared by both sides so a change here is type-checked everywhere.

export type GameMode = 'open' | 'race' | 'drift' | 'f1';
export type TimeOfDay = 'day' | 'dawn' | 'sunset' | 'night' | 'cycle';
export type Weather = 'clear' | 'cloudy' | 'drizzle' | 'rain' | 'storm' | 'fog' | 'snow' | 'blizzard' | 'hail' | 'wind' | 'sandstorm' | 'dynamic';
export type FixedWeather = Exclude<Weather, 'dynamic'>;
export type WorldTheme = 'mixed' | 'desert' | 'forest' | 'alpine' | 'islands';
/** World generator knobs (0 = least, highest = most). */
export interface WorldGen { terrain: number; water: number; flora: number; roads: number; poi: number }
export type Phase = 'lobby' | 'playing';
export type Vec3 = [number, number, number];

export interface LobbySettings {
  mode: GameMode;
  trackId: string;
  laps: number;
  pvp: boolean;
  seed: number;
  time: TimeOfDay;
  weather: Weather;
  /** Several weathers picked at once are layered together (e.g. fog + rain + storm). Empty/absent = just `weather`. */
  weathers?: FixedWeather[];
  theme: WorldTheme;
  gen: WorldGen;
  /** Room size chosen by the host (2..MAX_PLAYERS). */
  maxPlayers: number;
  /** Locked rooms refuse new players. */
  locked: boolean;
  /** Enemy drones in open world: 0 off, 1 few, 2 normal, 3 many. */
  drones: number;
  /** Computer-driven opponents in races (local games only). */
  ai: number;
  /** Formula 1 session: full race or time trial. */
  session: 'race' | 'quali';
  /** Starting tyre compound. */
  tyre: 'soft' | 'medium' | 'hard';
  /** Circuit race format (local games only, see src/modes): classic, time attack with medals, elimination. */
  variant?: RaceVariant;
  /** Computer racer difficulty (local games only, src/ai): rookie, amateur, pro, legend or adaptive (default). */
  aiLevel?: 'rookie' | 'amateur' | 'pro' | 'legend' | 'adaptive';
  /** Open-world traffic density, 0 off .. 2 heavy (local games only). */
  traffic?: number;
}
export type RaceVariant = 'classic' | 'attack' | 'elim';

export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
  /** Vehicle id from src/data/vehicles.ts. */
  vehicle: string;
  host: boolean;
  /** Ready in the lobby (the host always counts as ready). */
  ready: boolean;
  /** Round-trip time to the room in ms (latest heartbeat). */
  ping?: number;
  /** Connection dropped: the slot is kept for a short while so they can come back. */
  away?: boolean;
  /** Joined while a race was running: watches until the next start. */
  spec?: boolean;
}

/** One chat line; `id` is empty for room notices. Quick-chat lines carry their QUICK_CHAT index in `q`. */
export interface ChatLine { id: string; name: string; color: number; text: string; at: number; q?: number }

/** Snapshot of one rider, sent ~15x per second. */
export interface NetState {
  bx: number; by: number; bz: number; bh: number; bp: number; bl: number; // bike position, heading, pitch, lean
  wx: number; wy: number; wz: number; wh: number; // rider on foot
  v: number;
  riding: boolean;
  boost: number;
  dead: boolean;
  score: number;
  lap: number;
  prog: number; // race progress (laps + fraction)
  th?: number; // Tesla Roadster thruster output 0..1 (omitted when off): remote plumes
}

export type ClientMsg =
  | { t: 'hello'; name: string; color: number; vehicle: string; resume?: string }
  | { t: 'profile'; name: string; color: number; vehicle: string }
  | { t: 'kick'; id: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'settings'; settings: LobbySettings }
  | { t: 'start' }
  | { t: 'back' }
  | { t: 'state'; s: NetState }
  | { t: 'fire'; w: number; o: Vec3; d: Vec3[] }
  | { t: 'boom'; p: Vec3; r: number; dmg: number }
  | { t: 'finish'; time: number }
  | { t: 'ping'; c: number; rtt?: number }
  | { t: 'chat'; text: string }
  | { t: 'emote'; e: number }
  | { t: 'bye' };

export type ServerMsg =
  | { t: 'welcome'; you: string; players: PlayerInfo[]; settings: LobbySettings; phase: Phase; token?: string; resumed?: boolean; round?: number; chat?: ChatLine[] }
  | { t: 'players'; players: PlayerInfo[] }
  | { t: 'settings'; settings: LobbySettings }
  | { t: 'start'; settings: LobbySettings; round?: number }
  | { t: 'back' }
  | { t: 'state'; id: string; s: NetState }
  | { t: 'fire'; id: string; w: number; o: Vec3; d: Vec3[] }
  | { t: 'boom'; id: string; p: Vec3; r: number; dmg: number }
  | { t: 'finish'; id: string; time: number }
  | { t: 'kicked' }
  | { t: 'pong'; c: number; pings: Record<string, number> }
  | { t: 'chat'; line: ChatLine }
  | { t: 'error'; msg: string };

export const MAX_PLAYERS = 8;
export const DEFAULT_GEN: WorldGen = { terrain: 1, water: 1, flora: 1, roads: 1, poi: 1 };
export const GEN_MAX: WorldGen = { terrain: 3, water: 2, flora: 2, roads: 2, poi: 2 };
export const ROOM_CODE_RE = /^[A-Z0-9]{4,8}$/;
export const DEFAULT_SETTINGS: LobbySettings = { mode: 'open', trackId: 'coast', laps: 3, pvp: false, seed: 1, time: 'day', weather: 'clear', theme: 'mixed', gen: { ...DEFAULT_GEN }, maxPlayers: 8, locked: false, drones: 2, ai: 5, session: 'race', tyre: 'medium' };
export const TIMES: TimeOfDay[] = ['day', 'dawn', 'sunset', 'night', 'cycle'];
export const WEATHERS: Weather[] = ['clear', 'cloudy', 'drizzle', 'rain', 'storm', 'fog', 'snow', 'blizzard', 'hail', 'wind', 'sandstorm', 'dynamic'];
export const FIXED_WEATHERS = WEATHERS.filter((w): w is FixedWeather => w !== 'dynamic');
/** The weathers a session actually layers: the picked set, or the single `weather` ([] = changing). */
export function activeWeathers(s: { weather: Weather; weathers?: FixedWeather[] }): FixedWeather[] {
  if (s.weather === 'dynamic') return [];
  const list = (s.weathers ?? []).filter((w) => FIXED_WEATHERS.includes(w));
  return list.length ? list : [s.weather];
}
export const THEMES: WorldTheme[] = ['mixed', 'desert', 'forest', 'alpine', 'islands'];

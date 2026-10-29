// Messages exchanged between the game client (src/net) and the room server (worker/Room.ts).
// Shared by both sides so a change here is type-checked everywhere.

export type GameMode = 'open' | 'race';
export type TimeOfDay = 'day' | 'dawn' | 'sunset' | 'night' | 'cycle';
export type Weather = 'clear' | 'cloudy' | 'rain' | 'fog' | 'snow' | 'storm' | 'dynamic';
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
  theme: WorldTheme;
  gen: WorldGen;
  /** Room size chosen by the host (2..MAX_PLAYERS). */
  maxPlayers: number;
  /** Locked rooms refuse new players. */
  locked: boolean;
}

export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
  host: boolean;
}

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
}

export type ClientMsg =
  | { t: 'hello'; name: string; color: number }
  | { t: 'profile'; name: string; color: number }
  | { t: 'kick'; id: string }
  | { t: 'settings'; settings: LobbySettings }
  | { t: 'start' }
  | { t: 'back' }
  | { t: 'state'; s: NetState }
  | { t: 'fire'; w: number; o: Vec3; d: Vec3[] }
  | { t: 'boom'; p: Vec3; r: number; dmg: number }
  | { t: 'finish'; time: number };

export type ServerMsg =
  | { t: 'welcome'; you: string; players: PlayerInfo[]; settings: LobbySettings; phase: Phase }
  | { t: 'players'; players: PlayerInfo[] }
  | { t: 'settings'; settings: LobbySettings }
  | { t: 'start'; settings: LobbySettings }
  | { t: 'back' }
  | { t: 'state'; id: string; s: NetState }
  | { t: 'fire'; id: string; w: number; o: Vec3; d: Vec3[] }
  | { t: 'boom'; id: string; p: Vec3; r: number; dmg: number }
  | { t: 'finish'; id: string; time: number }
  | { t: 'kicked' }
  | { t: 'error'; msg: string };

export const MAX_PLAYERS = 8;
export const DEFAULT_GEN: WorldGen = { terrain: 1, water: 1, flora: 1, roads: 1, poi: 1 };
export const GEN_MAX: WorldGen = { terrain: 3, water: 2, flora: 2, roads: 2, poi: 2 };
export const ROOM_CODE_RE = /^[A-Z0-9]{4,8}$/;
export const DEFAULT_SETTINGS: LobbySettings = { mode: 'open', trackId: 'coast', laps: 3, pvp: false, seed: 1, time: 'day', weather: 'clear', theme: 'mixed', gen: { ...DEFAULT_GEN }, maxPlayers: 8, locked: false };
export const TIMES: TimeOfDay[] = ['day', 'dawn', 'sunset', 'night', 'cycle'];
export const WEATHERS: Weather[] = ['clear', 'cloudy', 'rain', 'fog', 'snow', 'storm', 'dynamic'];
export const THEMES: WorldTheme[] = ['mixed', 'desert', 'forest', 'alpine', 'islands'];

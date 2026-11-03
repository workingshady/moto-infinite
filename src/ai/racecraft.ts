// Game-facing glue for src/ai: bot names, the learned racing line per track (ghost laps + localStorage cache), the
// lazy leaderboard #1 ghost fetch, the player's skill tracking during a race and the Racecraft rating update after it.
import type { Game, SessionOptions } from '../core/Game';
import type { Standing } from '../systems/Race';
import type { VehicleDef } from '../data/vehicles';
import type { TrackLine } from '../world/layout';
import { AI, F1, ROAD } from '../config';
import { career, saveCareer } from '../core/career';
import { progressPaused } from '../admin/state';
import { fetchGhost } from '../net/leaderboard';
import { LB, LB_CIRCUITS, LB_F1 } from '../../shared/leaderboard';
import { loadGhost } from '../systems/Race';
import { paceProfile } from '../modes/pace';
import { learnLine, learnSig, loadLearned, saveLearned, type GhostLap, type Learned } from './learn';
import { lapEstimate, speedProfile, type HalfWidthFn } from './racingLine';
import { freshRating, updateRating, type Discipline, type RaceOutcome } from './rating';
import type { BotProfile } from './personality';

// ---------------------------------------------------------------- names
const RACE_NAMES = ['Rex Torque', 'Mila Apex', 'Juno Slide', 'Kai Redline', 'Nova Brake', 'Otto Kerb', 'Zara Drift', 'Finn Boost', 'Lena Chicane', 'Ivo Gravel', 'Suki Throttle', 'Bo Hairpin'];
const F1_EXTRA = ['K. Magnusen', 'N. Hulkenbird', 'V. Bottaz', 'Z. Guanyo', 'S. Perezz', 'L. Strollo', 'A. Kimi-Toni', 'O. Bearmon'];
export function botNames(count: number, f1: boolean): string[] {
  const pool = f1 ? [...F1.aiNames, ...F1_EXTRA] : RACE_NAMES, out: string[] = [];
  for (let i = 0; i < count; i++) out.push(pool[i % pool.length] + (i >= pool.length ? ` ${Math.floor(i / pool.length) + 1}` : ''));
  return out;
}

// ---------------------------------------------------------------- discipline + rating
export function disciplineOf(o: Pick<SessionOptions, 'mode' | 'variant'>): Discipline {
  return o.mode === 'f1' ? 'f1' : o.variant === 'elim' ? 'elim' : 'race';
}
export function playerRating(d: Discipline) {
  const r = career.racecraft?.[d]?.r;
  return typeof r === 'number' && Number.isFinite(r) ? r : AI.rating.start;
}

// ---------------------------------------------------------------- learned line
const cls = (def: VehicleDef) => (def.f1 ? 'f1' : def.kind);
const lbGhostKey = (board: string) => 'moto:aighost:' + board;

function boardFor(o: Pick<SessionOptions, 'mode' | 'trackId'>, def: VehicleDef) {
  if (o.mode === 'f1') return LB_F1[o.trackId] ? `track:${o.trackId}:f1` : null;
  return LB_CIRCUITS[o.trackId] ? `track:${o.trackId}:${def.kind === 'bike' ? 'bike' : 'car'}` : null;
}

/** Ghost laps available for this track: the player's local best and the cached leaderboard #1. */
export function ghostsFor(trackId: string, mode: SessionOptions['mode'], def: VehicleDef): GhostLap[] {
  const out: GhostLap[] = [];
  if (trackId === 'random') return out;
  const local = loadGhost(trackId);
  // local ghosts saved before vehicles were recorded: the line still teaches, speeds don't (vehicle unknown)
  if (local) out.push({ time: local.time, s: local.s, vehicle: local.v, src: 'local' });
  const board = boardFor({ mode, trackId }, def);
  if (board) {
    try {
      const g = JSON.parse(localStorage.getItem(lbGhostKey(board)) ?? 'null') as { time?: number; s?: number[]; vehicle?: string } | null;
      if (g && typeof g.time === 'number' && Array.isArray(g.s)) out.push({ time: g.time, s: g.s, vehicle: typeof g.vehicle === 'string' ? g.vehicle : undefined, src: 'lb' });
    } catch {
      /* damaged cache */
    }
  }
  return out;
}

/** Learned line for this track and vehicle class: from the cache when the ghosts are unchanged, else rebuilt + cached. */
export function buildLearned(trackId: string, track: TrackLine, hw: HalfWidthFn, def: VehicleDef, mode?: SessionOptions['mode']): Learned {
  const m = mode ?? (def.f1 ? 'f1' : 'race');
  const ghosts = ghostsFor(trackId, m, def), key = `${trackId}:${cls(def)}`, sig = learnSig(track.n, ghosts, cls(def));
  if (trackId !== 'random') {
    const hit = loadLearned(track, hw, key, sig);
    if (hit) return hit;
  }
  const l = learnLine(track, hw, ghosts, def);
  if (trackId !== 'random') saveLearned(key, sig, l);
  return l;
}

const FETCH_EVERY = 6 * 3600e3;
/**
 * Fetch the leaderboard #1 ghost for this track in the background (at most every 6 h per board). Resolves true when
 * a new ghost was cached (the learned line changes), false when nothing changed, offline or the server failed.
 */
export async function fetchLeaderGhost(o: Pick<SessionOptions, 'mode' | 'trackId'>, def: VehicleDef): Promise<boolean> {
  const board = boardFor(o, def);
  if (!board || typeof fetch !== 'function') return false;
  try {
    const tKey = lbGhostKey(board) + ':t', last = Number(localStorage.getItem(tKey) ?? 0);
    if (Date.now() - last < FETCH_EVERY) return false;
    const g = await fetchGhost(board, 1);
    if (g) localStorage.setItem(tKey, String(Date.now())); // offline / server error: try again next race
    if (!g || !Array.isArray(g.s) || g.s.length > LB.ghostMax || !(g.value > 0)) return false;
    const prev = JSON.parse(localStorage.getItem(lbGhostKey(board)) ?? 'null') as { time?: number } | null;
    if (prev?.time === g.value) return false;
    localStorage.setItem(lbGhostKey(board), JSON.stringify({ time: g.value, s: g.s, vehicle: g.vehicle }));
    return true;
  } catch {
    return false; // offline, storage blocked or full: the bots just use what they have
  }
}

// ---------------------------------------------------------------- the player's race: crashes and off-tracks
export class SkillTracker {
  crashes = 0;
  offTracks = 0;
  private t = 0;
  private lastV = 0;
  private lastHp = 0;
  private off = false;
  constructor(private game: Game) {}

  update(dt: number) {
    const p = this.game.players[0];
    if (!p || p.race.finished) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const v = Math.abs(p.B.v), hp = p.s.hp;
    if ((this.lastV - v > 12 && this.lastV > 15) || hp < this.lastHp - 4) this.crashes++;
    const off = !p.f1.inPit && this.game.layout.roadDist(p.B.x, p.B.z) > ROAD.asphalt + 1.5 && v > 15;
    if (off && !this.off) this.offTracks++;
    this.off = off;
    this.lastV = v;
    this.lastHp = hp;
  }
}

// ---------------------------------------------------------------- rating after the race
export interface RacecraftResult { d: Discipline; before: number; after: number; delta: number; n: number }
let last: RacecraftResult | null = null;
/** The rating change of the most recent rated race (results screen). */
export const lastRacecraft = () => last;

/** Ideal flying lap for the player's vehicle on this track (modes/pace.ts for road vehicles, the F1 physics profile for F1). */
export function idealLap(game: Game, def: VehicleDef) {
  const ai = game.ai, track = game.layout as unknown as TrackLine;
  if (def.f1 && ai) return lapEstimate(ai.learned.line, def, speedProfile(ai.learned.line, def));
  return paceProfile(track, def, 1).lap;
}

/**
 * Update the Racecraft rating from a finished race (single local player vs the AI field only).
 * `field` = every bot that started (knocked-out ones included).
 */
export function recordRace(game: Game, rows: Standing[], field: Map<string, { prof: BotProfile }>): RacecraftResult | null {
  const p = game.players[0], ai = game.ai;
  last = null;
  if (!p || !ai || game.players.length !== 1 || game.net || progressPaused() || !field.size) return null;
  const me = rows.findIndex((r) => r.local && r.id === '0');
  if (me < 0) return null;
  const opponents: RaceOutcome['opponents'] = [];
  rows.forEach((r, i) => { const b = field.get(r.id); if (b) opponents.push({ rating: b.prof.rating, beaten: me < i }); });
  if (!opponents.length) return null;
  const myT = rows[me].time, winT = rows[0].time, secondT = rows[1]?.time ?? null;
  const ideal = idealLap(game, p.def);
  const outcome: RaceOutcome = {
    opponents,
    gapToWinner: me > 0 && myT !== null && winT !== null ? myT - winT : me > 0 ? 10 : 0,
    winMargin: me === 0 && myT !== null && secondT !== null ? secondT - myT : 0,
    raceTime: myT ?? game.time,
    lapDelta: p.race.best > 0 && ideal > 0 ? p.race.best / ideal - 1 : NaN,
    crashes: ai.skill.crashes,
    offTracks: ai.skill.offTracks + p.f1.limits,
  };
  const d = disciplineOf(game.opts), cur = career.racecraft[d] ?? freshRating();
  const next = updateRating(cur, outcome);
  career.racecraft[d] = { r: next.r, n: next.n, at: next.at };
  saveCareer();
  last = { d, before: cur.r, after: next.r, delta: next.delta, n: next.n };
  return last;
}

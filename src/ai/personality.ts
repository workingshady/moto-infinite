// Difficulty levels and named personalities for the computer racers. A personality is a handful of numbers the
// driver model reads (src/ai/driver.ts): pace, consistency, aggression, defending, mistake rate, start reaction and
// wet-weather skill. A difficulty level sets the base pace / mistakes; the personality nudges them.
import { AI, type AiLevelId } from '../config';

export type AiLevel = AiLevelId | 'adaptive';
export const AI_LEVEL_IDS: AiLevel[] = ['rookie', 'amateur', 'pro', 'legend', 'adaptive'];
export const LEVEL_IDS = Object.keys(AI.levels) as AiLevelId[];

export interface Archetype {
  id: string; name: string; icon: string; blurb: string;
  /** Added to the level's pace (share of the physical limit). */
  pace: number;
  /** 1 = the same lap every lap, 0 = big lap-to-lap swings. */
  consistency: number;
  /** Brakes later, follows closer, commits to moves (0..1). */
  aggression: number;
  /** Covers the inside when attacked (0..1). One move, never weaves. */
  defending: number;
  /** Multiplies the level's mistake rate. */
  mistakes: number;
  /** Multiplies the level's start reaction time. */
  react: number;
  /** Wet-weather skill (0..1): how little pace a wet track costs. */
  wet: number;
}

export const ARCHETYPES: Archetype[] = [
  { id: 'late', name: 'Late Braker', icon: '🔥', blurb: 'Brakes deep, dives up the inside', pace: 0.005, consistency: 0.7, aggression: 0.95, defending: 0.35, mistakes: 1.35, react: 1, wet: 0.4 },
  { id: 'smooth', name: 'Smooth Operator', icon: '🧈', blurb: 'Clean lines, metronome laps', pace: 0, consistency: 0.97, aggression: 0.35, defending: 0.5, mistakes: 0.45, react: 1, wet: 0.65 },
  { id: 'rookie', name: 'Rookie', icon: '🐣', blurb: 'Nervous, runs wide, late off the line', pace: -0.02, consistency: 0.5, aggression: 0.45, defending: 0.2, mistakes: 1.8, react: 1.4, wet: 0.3 },
  { id: 'defender', name: 'Defender', icon: '🛡️', blurb: 'Covers the inside, hard to pass', pace: -0.004, consistency: 0.85, aggression: 0.4, defending: 1, mistakes: 0.8, react: 1, wet: 0.5 },
  { id: 'wet', name: 'Wet-weather Ace', icon: '🌧️', blurb: 'Comes alive when it rains', pace: -0.004, consistency: 0.85, aggression: 0.6, defending: 0.6, mistakes: 0.8, react: 1, wet: 1 },
  { id: 'charger', name: 'Charger', icon: '⚡', blurb: 'Rocket starts, all-out attack', pace: 0.008, consistency: 0.6, aggression: 0.85, defending: 0.3, mistakes: 1.2, react: 0.65, wet: 0.4 },
  { id: 'veteran', name: 'Veteran', icon: '🦉', blurb: 'Patient, picks the right moment', pace: 0, consistency: 0.92, aggression: 0.55, defending: 0.75, mistakes: 0.6, react: 0.9, wet: 0.7 },
  { id: 'wild', name: 'Wildcard', icon: '🎲', blurb: 'Brilliant one lap, in the gravel the next', pace: 0.006, consistency: 0.35, aggression: 0.8, defending: 0.45, mistakes: 1.6, react: 1, wet: 0.45 },
];

/** Everything the driver model needs for one bot. */
export interface BotProfile {
  level: AiLevelId;
  arch: Archetype;
  /** Share of the physical corner/braking limit this bot drives at. */
  pace: number;
  consistency: number;
  aggression: number;
  defending: number;
  mistakesPerMin: number;
  react: number;
  wet: number;
  /** Strength on the Racecraft rating scale. */
  rating: number;
  /** In-race catch-up allowed (never on Pro / Legend). */
  catchUp: boolean;
}

const anchors = () => LEVEL_IDS.map((id) => AI.levels[id]);

/** Pace that matches a rating (piecewise linear through the level anchors, a bit beyond Rookie below). */
export function paceForRating(r: number) {
  const A = anchors();
  if (r <= A[0].rating) return Math.max(0.68, A[0].pace - ((A[0].rating - r) / 200) * 0.05);
  for (let i = 1; i < A.length; i++) if (r <= A[i].rating) return A[i - 1].pace + ((r - A[i - 1].rating) / (A[i].rating - A[i - 1].rating)) * (A[i].pace - A[i - 1].pace);
  return A[A.length - 1].pace;
}
/** Inverse of paceForRating (rating a bot of this pace is worth). */
export function ratingForPace(p: number) {
  const A = anchors();
  if (p <= A[0].pace) return A[0].rating - ((A[0].pace - p) / 0.05) * 200;
  for (let i = 1; i < A.length; i++) if (p <= A[i].pace) return A[i - 1].rating + ((p - A[i - 1].pace) / (A[i].pace - A[i - 1].pace)) * (A[i].rating - A[i - 1].rating);
  return A[A.length - 1].rating;
}
/** Mistakes per minute at a pace (interpolated across levels). */
function mistakesFor(p: number) {
  const A = anchors();
  if (p <= A[0].pace) return A[0].mistakes;
  for (let i = 1; i < A.length; i++) if (p <= A[i].pace) { const f = (p - A[i - 1].pace) / (A[i].pace - A[i - 1].pace); return A[i - 1].mistakes + f * (A[i].mistakes - A[i - 1].mistakes); }
  return A[A.length - 1].mistakes;
}
/** Nearest named level for a pace (what an adaptive bot is shown as). */
export function levelForPace(p: number): AiLevelId {
  let best: AiLevelId = 'rookie', d = 9;
  for (const id of LEVEL_IDS) { const e = Math.abs(AI.levels[id].pace - p); if (e < d) { d = e; best = id; } }
  return best;
}
export const ratingTier = (r: number) => AI.levels[levelForPace(paceForRating(r))];

/**
 * A field of `count` bots. Fixed levels: everyone at that level ± their personality. Adaptive: centred on the player's
 * rating with a spread so a few bots are a touch quicker and a few slower (close racing all through the field).
 */
export function makeField(count: number, level: AiLevel, playerRating: number, rnd: () => number = Math.random): BotProfile[] {
  const out: BotProfile[] = [], order = ARCHETYPES.map((a) => ({ a, k: rnd() })).sort((p, q) => p.k - q.k).map((x) => x.a);
  const adaptive = level === 'adaptive', centre = adaptive ? paceForRating(playerRating) : AI.levels[level].pace;
  for (let i = 0; i < count; i++) {
    const arch = order[i % order.length];
    // adaptive spread: -2.5% .. +1.5% around the target, evenly through the grid, so the player meets battles everywhere
    const spread = adaptive ? (count > 1 ? -0.025 + (0.04 * i) / (count - 1) : 0) : (rnd() - 0.5) * 0.012;
    const pace = Math.min(1, Math.max(0.68, centre + spread + arch.pace));
    const lv = adaptive ? levelForPace(pace) : (level as AiLevelId), L = AI.levels[lv];
    const reactBase = L.react[0] + rnd() * (L.react[1] - L.react[0]);
    out.push({
      level: lv, arch, pace,
      consistency: arch.consistency, aggression: arch.aggression, defending: arch.defending,
      mistakesPerMin: (adaptive ? mistakesFor(pace) : L.mistakes) * arch.mistakes,
      react: reactBase * arch.react, wet: arch.wet,
      rating: ratingForPace(pace),
      catchUp: adaptive || (L.catchUp && level !== 'pro' && level !== 'legend'),
    });
  }
  return out;
}

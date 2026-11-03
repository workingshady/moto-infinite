// Merging this device's save with the cloud save (pure functions, unit-tested in saveMerge.test.ts).
//
// Career: a three-way merge against `base` = the career as it was at this device's last successful sync.
//  - credits:            cloud + (local − base). Only what this device earned or spent since the last sync is applied,
//                        so credits never double and a purchase made here is still paid for. Never below 0.
//  - level + XP:         as total career XP: cloud total + max(0, local total − base total), then back to level + XP.
//  - lifetime counters:  (distance, races, flips, earned …) cloud + max(0, local − base).
//  - records:            (top speed, best drift, best air …) the higher value; best leaderboard rank the lower.
//  - lists:              (vehicles bought, themes, tracks, challenge ids) union.
//  - achievements:       union, keeping the earliest unlock time.
// Without a base (first sync of progress made before signing in) base = an empty career: both progressions add up.
// Settings, prefs, touch layout, profile: the section edited most recently wins as a whole.
// Time Attack bests: the faster time and the better medal per track x vehicle.
// Racecraft rating: per discipline the copy rated over more races wins (ties: the newer one).
import type { CareerData, SaveData, Section, SectionName, TaBest } from '../../shared/cloudSave';
import { RACECRAFT_KEYS, SECTIONS } from '../../shared/cloudSave';

/** Records where the higher value wins (never summed). */
export const MAX_STATS = new Set(['topSpeed', 'bestDrift', 'longestWheelie', 'bestFlight', 'bestAir', 'bestCombo', 'bestRunLevel', 'bestMedal', 'bestNearChain']);
/** Records where the lower non-zero value wins. */
export const MIN_STATS = new Set(['bestRank']);
/** challengeKeys is a rolling window in the career (core/career.ts keeps the last 20). */
const LIST_CAP: Record<string, number> = { challengeKeys: 20 };

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const isList = (v: unknown): v is string[] => Array.isArray(v);
const isRec = (v: unknown): v is Record<string, number> => !!v && typeof v === 'object' && !Array.isArray(v);
const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

export function emptyCareer(): CareerData {
  return { v: 1, level: 1, xp: 0, credits: 0, earned: 0, stats: {}, unlocked: [], achievements: {}, racecraft: {} };
}

/** Total career XP for a level + XP pair (`need(l)` = XP from level l to l+1). */
export function totalXp(level: number, xp: number, need: (l: number) => number) {
  let t = num(xp);
  for (let l = 1; l < Math.min(999, Math.max(1, Math.floor(level))); l++) t += need(l);
  return t;
}
export function fromTotalXp(total: number, need: (l: number) => number) {
  let level = 1, xp = Math.max(0, total);
  while (level < 999 && xp >= need(level)) {
    xp -= need(level);
    level++;
  }
  return { level, xp };
}

/** cloud + this device's gain since base (never negative). */
const gain = (local: unknown, cloud: unknown, base: unknown) => num(cloud) + Math.max(0, num(local) - num(base));

export function mergeCareer(local: CareerData, cloud: CareerData, base: CareerData | null, need: (l: number) => number): CareerData {
  const b = base ?? emptyCareer();
  const stats: CareerData['stats'] = {};
  for (const k of new Set([...Object.keys(cloud.stats), ...Object.keys(local.stats)])) {
    const l = local.stats[k], c = cloud.stats[k], bs = b.stats[k];
    if (isList(l) || isList(c)) {
      const u = union(isList(c) ? c : [], isList(l) ? l : []);
      stats[k] = LIST_CAP[k] ? u.slice(-LIST_CAP[k]) : u;
    } else if (isRec(l) || isRec(c)) {
      const lr = isRec(l) ? l : {}, cr = isRec(c) ? c : {}, br = isRec(bs) ? bs : {}, o: Record<string, number> = {};
      for (const kk of new Set([...Object.keys(cr), ...Object.keys(lr)])) o[kk] = gain(lr[kk], cr[kk], br[kk]);
      stats[k] = o;
    } else if (MAX_STATS.has(k)) stats[k] = Math.max(num(l), num(c));
    else if (MIN_STATS.has(k)) {
      const vals = [num(l), num(c)].filter((v) => v > 0);
      stats[k] = vals.length ? Math.min(...vals) : 0;
    } else stats[k] = gain(l, c, bs);
  }
  const achievements: Record<string, number> = { ...cloud.achievements };
  for (const [id, t] of Object.entries(local.achievements)) achievements[id] = achievements[id] ? Math.min(achievements[id], t) : t;
  const lv = fromTotalXp(totalXp(cloud.level, cloud.xp, need) + Math.max(0, totalXp(local.level, local.xp, need) - totalXp(b.level, b.xp, need)), need);
  return {
    racecraft: mergeRacecraft(local.racecraft, cloud.racecraft),
    v: Math.max(cloud.v, local.v),
    level: lv.level,
    xp: lv.xp,
    credits: Math.max(0, num(cloud.credits) + num(local.credits) - num(b.credits)),
    earned: gain(local.earned, cloud.earned, b.earned),
    stats,
    unlocked: union(cloud.unlocked, local.unlocked),
    achievements,
  };
}

/**
 * Racecraft rating (a skill estimate, not a counter): per discipline the copy rated over more races wins (it has seen
 * more of the player); equal race counts → the most recently updated one. Never summed or averaged.
 */
export function mergeRacecraft(local: CareerData['racecraft'], cloud: CareerData['racecraft']): NonNullable<CareerData['racecraft']> {
  const out: NonNullable<CareerData['racecraft']> = { ...(cloud ?? {}) };
  for (const k of RACECRAFT_KEYS) {
    const l = local?.[k], c = out[k];
    if (!l) continue;
    if (!c || l.n > c.n || (l.n === c.n && l.at > c.at)) out[k] = { ...l };
  }
  return out;
}

export function mergeTa(local: Record<string, TaBest>, cloud: Record<string, TaBest>): Record<string, TaBest> {
  const out: Record<string, TaBest> = { ...cloud };
  for (const [k, l] of Object.entries(local)) {
    const c = out[k];
    if (!c) { out[k] = l; continue; }
    const best = [l.best, c.best].filter((v) => v > 0);
    out[k] = { best: best.length ? Math.min(...best) : 0, medal: Math.max(l.medal, c.medal) };
  }
  return out;
}

/** Latest edit wins per section; ties keep the cloud copy (it is what other devices already have). */
export function mergeSections(local: SaveData['sections'], cloud: SaveData['sections']): SaveData['sections'] {
  const out: Partial<Record<SectionName, Section>> = {};
  for (const n of SECTIONS) {
    const l = local[n], c = cloud[n];
    const pick = !l ? c : !c ? l : l.at > c.at ? l : c;
    if (pick) out[n] = pick;
  }
  return out;
}

export function mergeSave(local: SaveData, cloud: SaveData | null, base: CareerData | null, need: (l: number) => number): SaveData {
  if (!cloud) return local;
  return { v: 1, career: mergeCareer(local.career, cloud.career, base, need), sections: mergeSections(local.sections, cloud.sections), ta: mergeTa(local.ta, cloud.ta) };
}

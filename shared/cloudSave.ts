// Cloud save format + validation, shared by the client (src/net/cloudSave.ts) and the Worker (worker/Account.ts).
// The server never trusts a save: sanitizeSave() keeps only known shapes, clamps every number to a plausible range
// and caps list / text sizes. The client re-checks what it applies with its own loaders (core/career.ts migrate,
// utils/store.ts mergeSaved), so a damaged cloud save can never break the game.

/** Career as saved by core/career.ts (kept loose here: the client's migrate() fills defaults). */
export interface CareerData {
  v: number;
  level: number;
  xp: number;
  credits: number;
  earned: number;
  stats: Record<string, number | string[] | Record<string, number>>;
  unlocked: string[];
  achievements: Record<string, number>;
}

/** A settings-like blob plus when it was last changed on the device that wrote it (latest wins). */
export interface Section { at: number; data: Record<string, unknown> }
export type SectionName = 'settings' | 'prefs' | 'touch' | 'profile';
export const SECTIONS: SectionName[] = ['settings', 'prefs', 'touch', 'profile'];

/** Time Attack personal best per `ta:<track>:<vehicle>` (localStorage moto:ta:…). */
export interface TaBest { best: number; medal: number }

export interface SaveData {
  v: 1;
  career: CareerData;
  sections: Partial<Record<SectionName, Section>>;
  ta: Record<string, TaBest>;
}

/** GET /api/save. `wids`: ids of the latest writes, so a client can tell whether a write whose answer it never saw landed. */
export interface SaveEnvelope { rev: number; updatedAt: number; save: SaveData | null; wids: string[] }
/** PUT /api/save body. `rev` = the revision the client based its save on (0 = none yet). */
export interface SavePut { rev: number; wid: string; save: SaveData }
export interface SavePutResult { ok: boolean; rev?: number; updatedAt?: number; error?: string }

export const SAVE_LIMITS = {
  /** Whole JSON body. */
  bytes: 200 * 1024,
  sectionBytes: 16 * 1024,
  level: 999,
  xp: 5e7,
  credits: 1e8,
  earned: 1e9,
  /** Any lifetime counter (metres, seconds, counts). */
  stat: 1e10,
  listItems: 300,
  strLen: 64,
  achievements: 500,
  taEntries: 1000,
  taBest: 3600,
  wids: 32,
} as const;

/** Stats with a tighter, physical upper bound. */
const STAT_CAPS: Record<string, number> = {
  topSpeed: 2000, longestWheelie: 3600, bestFlight: 3600, bestAir: 600, bestRunLevel: 1000, bestMedal: 4, bestRank: 1e6,
  bestCombo: 1e6, bestNearChain: 1e5, bestDrift: 1e9,
};

export const WID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const ID_RE = /^[A-Za-z0-9_:.-]{1,64}$/;
const TA_RE = /^ta:[a-z0-9_-]{1,40}:[a-z0-9_]{1,24}$/;
/** Earliest plausible achievement time (the game did not exist before). */
const EPOCH = Date.UTC(2024, 0, 1);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const clamp = (v: unknown, max: number, min = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min);
const idList = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && ID_RE.test(x)))].slice(0, SAVE_LIMITS.listItems) : []);

function sanitizeCareer(raw: unknown, now: number): CareerData | null {
  if (!isObj(raw)) return null;
  const stats: CareerData['stats'] = {};
  if (isObj(raw.stats)) {
    let n = 0;
    for (const [k, v] of Object.entries(raw.stats)) {
      if (!KEY_RE.test(k) || ++n > 100) continue;
      if (typeof v === 'number') stats[k] = clamp(v, STAT_CAPS[k] ?? SAVE_LIMITS.stat);
      else if (Array.isArray(v)) stats[k] = idList(v);
      else if (isObj(v)) {
        const o: Record<string, number> = {};
        for (const [kk, vv] of Object.entries(v).slice(0, 40)) if (ID_RE.test(kk)) o[kk] = clamp(vv, SAVE_LIMITS.stat);
        stats[k] = o;
      }
    }
  }
  const achievements: Record<string, number> = {};
  if (isObj(raw.achievements)) {
    for (const [id, t] of Object.entries(raw.achievements).slice(0, SAVE_LIMITS.achievements)) {
      if (ID_RE.test(id)) achievements[id] = Math.round(clamp(t, now + 864e5, EPOCH));
    }
  }
  return {
    v: Math.round(clamp(raw.v, 100, 1)),
    level: Math.floor(clamp(raw.level, SAVE_LIMITS.level, 1)),
    xp: clamp(raw.xp, SAVE_LIMITS.xp),
    credits: clamp(raw.credits, SAVE_LIMITS.credits),
    earned: clamp(raw.earned, SAVE_LIMITS.earned),
    stats,
    unlocked: idList(raw.unlocked),
    achievements,
  };
}

/** Plain JSON object, no deeper than a few levels, within the size cap. */
function sanitizeSection(raw: unknown, now: number): Section | null {
  if (!isObj(raw) || !isObj(raw.data)) return null;
  let text: string;
  try {
    text = JSON.stringify(raw.data);
  } catch {
    return null;
  }
  if (text.length > SAVE_LIMITS.sectionBytes || depth(raw.data) > 5) return null;
  return { at: Math.round(clamp(raw.at, now + 864e5)), data: JSON.parse(text) as Record<string, unknown> };
}
function depth(v: unknown): number {
  if (!v || typeof v !== 'object') return 0;
  let d = 0;
  for (const x of Object.values(v as Record<string, unknown>)) d = Math.max(d, depth(x));
  return d + 1;
}

/** Validates and normalises a save from an untrusted source; null when it is not a save at all. */
export function sanitizeSave(raw: unknown, now = Date.now()): SaveData | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  const career = sanitizeCareer(raw.career, now);
  if (!career) return null;
  const sections: SaveData['sections'] = {};
  if (isObj(raw.sections)) {
    for (const name of SECTIONS) {
      const s = sanitizeSection(raw.sections[name], now);
      if (s) sections[name] = s;
    }
  }
  const ta: Record<string, TaBest> = {};
  if (isObj(raw.ta)) {
    for (const [k, v] of Object.entries(raw.ta).slice(0, SAVE_LIMITS.taEntries)) {
      if (!TA_RE.test(k) || !isObj(v)) continue;
      ta[k] = { best: Math.round(clamp(v.best, SAVE_LIMITS.taBest) * 1000) / 1000, medal: Math.round(clamp(v.medal, 4)) };
    }
  }
  return { v: 1, career, sections, ta };
}

/** JSON with sorted keys: equal saves give equal strings whatever order their keys were written in. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

// Safe loading of saved JSON (localStorage can hold anything: old versions, hand edits, half-written values).

/** True when `v` has the same JSON shape as `d`: arrays stay arrays, objects stay objects, numbers stay finite. */
export function sameShape(v: unknown, d: unknown): boolean {
  if (Array.isArray(d)) return Array.isArray(v);
  if (d === null || v === null || Array.isArray(v)) return false;
  if (typeof d === 'number') return typeof v === 'number' && Number.isFinite(v);
  return typeof v === typeof d;
}

/** Saved values over the defaults, keeping only known keys whose value has the default's shape. */
export function mergeSaved<T extends object>(base: T, raw: unknown): T {
  const out = { ...base } as Record<string, unknown>, b = base as Record<string, unknown>;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out as T;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (k in b && sameShape(v, b[k])) out[k] = v;
  return out as T;
}

/** JSON.parse that never throws (null on anything unreadable). */
export function parseJson(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

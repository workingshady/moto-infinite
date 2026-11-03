// Tiny change feed for cloud save (src/net/cloudSave.ts): the save functions of career, settings, prefs, touch,
// profile and Time Attack call markChanged(). Settings-like sections also remember WHEN they changed on this device
// (moto:sync:at) so a merge can let the latest edit win. No imports: anything may import this without cycles.
import type { SectionName } from '../../shared/cloudSave';

export type Changed = 'career' | 'ta' | SectionName;

const KEY = 'moto:sync:at';
let quiet = 0;
let listener: ((what: Changed) => void) | null = null;

function readTimes(): Partial<Record<SectionName, number>> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Partial<Record<SectionName, number>>) : {};
  } catch {
    return {};
  }
}

/** When each settings-like section last changed on this device (0 = never: defaults, any saved copy wins). */
export function sectionTime(name: SectionName): number {
  const t = readTimes()[name];
  return typeof t === 'number' && Number.isFinite(t) ? t : 0;
}

export function setSectionTime(name: SectionName, at: number) {
  const all = readTimes();
  all[name] = at;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* not persisted */
  }
}

/** Called by every local save. Changes made while applying a cloud save (quietly) are not echoed back. */
export function markChanged(what: Changed) {
  if (quiet) return;
  if (what !== 'career' && what !== 'ta') setSectionTime(what, Date.now());
  listener?.(what);
}

export function onLocalChange(cb: (what: Changed) => void) {
  listener = cb;
}

export function quietly(fn: () => void) {
  quiet++;
  try {
    fn();
  } finally {
    quiet--;
  }
}

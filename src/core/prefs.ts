// Player preferences that persist in the browser (not part of a game session).

export interface Prefs {
  /** Tap nitro to switch it on/off instead of holding it: helps keyboards that drop 3+ keys at once. */
  nitroToggle: boolean;
  onboarded: boolean;
  /** Riding assist level, index into ASSIST (0 Pro, 1 Normal, 2 Easy). */
  assist: number;
}

const KEY = 'moto:prefs';

export const prefs: Prefs = (() => {
  const base: Prefs = { nitroToggle: false, onboarded: false, assist: 1 };
  try {
    return { ...base, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return base;
  }
})();

export function savePrefs() {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* not persisted */
  }
}

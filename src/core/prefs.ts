// Player preferences that persist in the browser (not part of a game session).
import type { CamView } from './cameraViews';

export interface Prefs {
  /** Tap nitro to switch it on/off instead of holding it: helps keyboards that drop 3+ keys at once. */
  nitroToggle: boolean;
  onboarded: boolean;
  /** Riding assist level, index into ASSIST (0 Pro, 1 Normal, 2 Easy). */
  assist: number;
  /** 0..1 */
  music: number;
  sfx: number;
  /** Last camera view per local player (index 0 = solo / P1, 1 = P2). */
  cams: CamView[];
}

const KEY = 'moto:prefs';

export const prefs: Prefs = (() => {
  const base: Prefs = { nitroToggle: false, onboarded: false, assist: 1, music: 0.6, sfx: 1, cams: ['chase', 'chase'] };
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

// Admin career tools: explicit "write to my career" actions (the UI asks for confirmation first). Unlike Full Power,
// these really change the saved career (and therefore the cloud save).
import { ACHIEVEMENTS } from '../data/achievements';
import { career, saveCareer } from '../core/career';
import { isAdmin } from './state';

export function giveCredits(n: number) {
  if (!isAdmin() || !(n > 0)) return false;
  career.credits += n;
  career.earned += n;
  saveCareer();
  return true;
}

export function setCareerLevel(level: number) {
  if (!isAdmin() || !(level >= 1)) return false;
  career.level = Math.min(999, Math.floor(level));
  career.xp = 0;
  saveCareer();
  return true;
}

/** Marks every achievement unlocked (no rewards paid). */
export function unlockAllAchievements() {
  if (!isAdmin()) return 0;
  let n = 0;
  for (const a of ACHIEVEMENTS) if (!career.achievements[a.id]) { career.achievements[a.id] = Date.now(); n++; }
  saveCareer();
  return n;
}
